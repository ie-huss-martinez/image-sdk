import { checkFile, coreLimits } from "@hussmartinez/sdk-core";
import { describe, expect, it } from "vitest";
import { EMPTY_KEEPABLE_METADATA, type ImageProbe, NO_METADATA } from "../model/source.js";
import { isImageError } from "./image-error.js";
import {
  ANIMATION_LIMITS,
  animationLimits,
  checkFileLimits,
  imageLimitDefinitions,
  imageLimits,
} from "./image-limits.js";

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

describe("imageLimits", () => {
  it("keeps every core limit, with its code and unit", () => {
    for (const [name, definition] of Object.entries(coreLimits)) {
      expect(imageLimitDefinitions).toHaveProperty(name);
      const image = imageLimitDefinitions[name as keyof typeof coreLimits];
      expect(image.code, name).toBe(definition.code);
      expect(image.unit, name).toBe(definition.unit);
    }
  });

  it("names the pixel limit as pdf-sdk does: maxImagePixels, IMAGE_TOO_LARGE, in pixels", () => {
    expect(imageLimitDefinitions.maxImagePixels).toMatchObject({
      code: "IMAGE_TOO_LARGE",
      unit: "pixels",
    });
  });

  it("has the image defaults of ADR 0004", () => {
    const infinity = Number.POSITIVE_INFINITY;
    expect(imageLimits.resolve().limits).toEqual({
      maxFileSize: { maximum: 100_000_000, warning: 50_000_000 },
      maxFiles: { maximum: 20, warning: infinity },
      maxDecodedSize: { maximum: 1_000_000_000, warning: 400_000_000 },
      maxProcessingTime: { maximum: 120_000, warning: infinity },
      maxImagePixels: { maximum: 50_000_000, warning: 24_000_000 },
      maxImageDimension: { maximum: 16_384, warning: infinity },
      maxFrames: { maximum: 300, warning: 100 },
      maxAnimationPixels: { maximum: 8_000_000, warning: 2_000_000 },
      maxSessionSize: { maximum: 1_000_000_000, warning: 500_000_000 },
      maxLayers: { maximum: 256, warning: infinity },
      maxDrawingPoints: { maximum: 200_000, warning: 100_000 },
    });
  });

  it("throws an ImageError naming the limit, and warns from the threshold", () => {
    const policy = imageLimits.resolve();
    expect(policy.check("maxImagePixels", 24_000_000 - 1)).toBeUndefined();
    expect(policy.check("maxImagePixels", 24_000_000)).toBe("warning");
    expect(policy.check("maxImagePixels", 50_000_000)).toBe("warning");

    // A 30000 × 30000 decompression bomb.
    const thrown = thrownBy(() => policy.check("maxImagePixels", 900_000_000));
    expect(isImageError(thrown, "IMAGE_TOO_LARGE")).toBe(true);
    expect((thrown as { details?: unknown }).details).toEqual({
      limit: "maxImagePixels",
      maximum: 50_000_000,
      actual: 900_000_000,
      unit: "pixels",
    });
  });

  it.each([
    ["maxImageDimension", 16_385, "IMAGE_DIMENSION_TOO_LARGE"],
    ["maxFrames", 301, "TOO_MANY_FRAMES"],
    ["maxSessionSize", 1_000_000_001, "SESSION_TOO_LARGE"],
    ["maxLayers", 257, "TOO_MANY_LAYERS"],
    ["maxDrawingPoints", 200_001, "TOO_MANY_POINTS"],
  ] as const)("throws %s violations with their own code", (limit, actual, code) => {
    const policy = imageLimits.resolve();
    expect(
      isImageError(
        thrownBy(() => policy.check(limit, actual)),
        code,
      ),
    ).toBe(true);
  });

  it("throws core limit violations as ImageError too", () => {
    const policy = imageLimits.resolve({ maxFileSize: 10 });
    const file = new Blob([new Uint8Array(11)]);
    expect(() => checkFile(policy, file)).toThrow(
      expect.objectContaining({ name: "ImageError", code: "FILE_TOO_LARGE" }),
    );
    expect(
      isImageError(
        thrownBy(() => imageLimits.resolve().check("maxDecodedSize", 1_000_000_001)),
        "DECODED_SIZE_TOO_LARGE",
      ),
    ).toBe(true);
  });

  it("applies a host's settings, and rejects unknown names and invalid values", () => {
    const policy = imageLimits.resolve({
      maxImagePixels: 100_000_000,
      maxDecodedSize: { maximum: 2e9, warning: 800e6 },
    });
    expect(policy.limits.maxImagePixels).toEqual({ maximum: 100_000_000, warning: 24_000_000 });
    expect(policy.limits.maxDecodedSize).toEqual({ maximum: 2e9, warning: 800e6 });

    // A typo, or another SDK's name for the limit, must not silently leave
    // the default in place (ADR 0020).
    expect(() => imageLimits.resolve({ maxPixels: 10 } as never)).toThrow(TypeError);
    expect(() => imageLimits.resolve({ maxFrames: 0 })).toThrow(RangeError);
    expect(() => imageLimits.resolve({ maxLayers: { maximum: 10, warn: 5 } as never })).toThrow(
      TypeError,
    );
  });
});

describe("an animation's limits (docs/adr/0011)", () => {
  const probe: ImageProbe = {
    format: "gif",
    stored: { width: 100, height: 50 },
    oriented: { width: 100, height: 50 },
    orientation: 1,
    frames: 10,
    hasAlpha: false,
    decodedPixelBound: 10 * 100 * 50,
    metadata: NO_METADATA,
    keepable: EMPTY_KEEPABLE_METADATA,
  };

  it("counts every frame of a file held with its frames, and one of a still", () => {
    const policy = imageLimits.resolve({ maxFrames: 9, maxDecodedSize: 100_000 });
    // As an animation: ten frames, 200,000 bytes.
    expect(() => checkFileLimits(policy, 1, probe)).toThrow(/maxFrames/);
    expect(() => checkFileLimits(policy, 1, probe, "all")).toThrow(/maxFrames/);
    // As a still: one frame, 20,000 bytes.
    expect(checkFileLimits(policy, 1, probe, "first")).toEqual([]);
    // A still is held to its own size.
    const small = imageLimits.resolve({ maxDecodedSize: 19_999 });
    expect(() => checkFileLimits(small, 1, probe, "first")).toThrow();
    // And it's warned of by its own size: 20,000 bytes reaches a warning at 20,000.
    const near = imageLimits.resolve({ maxDecodedSize: { maximum: 30_000, warning: 20_000 } });
    expect(checkFileLimits(near, 1, probe, "first")).toEqual(["maxDecodedSize"]);
  });

  it("says which of an animation's limits a file is over and near, without throwing", () => {
    expect(ANIMATION_LIMITS).toEqual(["maxFrames", "maxDecodedSize", "maxAnimationPixels"]);
    expect(animationLimits(imageLimits.resolve(), probe)).toEqual({ over: [], near: [] });
    expect(
      animationLimits(
        imageLimits.resolve({
          maxFrames: 9,
          maxDecodedSize: { maximum: 1_000_000, warning: 200_000 },
          maxAnimationPixels: 4_999,
        }),
        probe,
      ),
    ).toEqual({ over: ["maxFrames", "maxAnimationPixels"], near: ["maxDecodedSize"] });
    // At a limit exactly is within it.
    expect(
      animationLimits(
        imageLimits.resolve({ maxFrames: 10, maxDecodedSize: 200_000, maxAnimationPixels: 5_000 }),
        probe,
      ).over,
    ).toEqual([]);
    // The engine's own ceiling on frames counts as the frames limit, whatever the policy allows.
    const generous = imageLimits.resolve({ maxFrames: 100_000 });
    expect(animationLimits(generous, probe, 9).over).toEqual(["maxFrames"]);
    expect(animationLimits(generous, probe, 10).over).toEqual([]);
  });
});
