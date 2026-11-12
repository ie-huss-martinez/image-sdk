import { describe, expect, it } from "vitest";
import { describeImageEngineContract } from "../../test/contracts/image-engine.contract.js";
import { concat, exif, png, pngChunk, webp, webpChunk } from "../../test/fixtures/image-writers.js";
import { isImageError } from "../core/errors/image-error.js";
import type { ExifOrientation } from "../core/model/source.js";
import { calibrate } from "./decode/calibration.js";
import { decodeUpright } from "./decode/decode.js";
import {
  classifyQuadrants,
  orientBitmap,
  QUADRANT_COLOURS,
  quadrantCentres,
} from "./decode/orientation.js";
import { createImageEngine } from "./image-engine.js";

const ORIENTATIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/** A 48 × 32 four-colour canvas: red, green, blue and yellow quadrants. */
function quadrants(): OffscreenCanvas {
  const canvas = new OffscreenCanvas(48, 32);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2D canvas");
  QUADRANT_COLOURS.forEach(([r, g, b], quadrant) => {
    context.fillStyle = `rgb(${r} ${g} ${b})`;
    context.fillRect((quadrant % 2) * 24, Math.floor(quadrant / 2) * 16, 24, 16);
  });
  return canvas;
}

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
const app1 = (block: Uint8Array) => {
  const payload = concat([Array.from("Exif\0\0", (c) => c.charCodeAt(0)), block]);
  return concat([[0xff, 0xe1, (payload.length + 2) >>> 8, (payload.length + 2) & 0xff], payload]);
};

/**
 * A JPEG the browser encodes, with an EXIF block after its JFIF APP0:
 * Firefox refuses its own encoder's output with APP1 before APP0.
 */
async function jpegWith(canvas: OffscreenCanvas, block?: Uint8Array): Promise<Blob> {
  const jpeg = await bytesOf(await canvas.convertToBlob({ type: "image/jpeg", quality: 1 }));
  const at = jpeg[3] === 0xe0 ? 4 + (((jpeg[4] ?? 0) << 8) | (jpeg[5] ?? 0)) : 2;
  return new Blob([
    (block ? concat([jpeg.subarray(0, at), app1(block), jpeg.subarray(at)]) : jpeg).slice(),
  ]);
}

const fixture = async (name: string) =>
  bytesOf(await (await fetch(new URL(`../../e2e/fixtures/${name}`, import.meta.url))).blob());

describeImageEngineContract("createImageEngine", {
  createEngine: () => createImageEngine(),
  async file(spec) {
    const canvas = new OffscreenCanvas(spec.width, spec.height);
    canvas.getContext("2d")?.fillRect(0, 0, spec.width, spec.height);
    return jpegWith(
      canvas,
      exif({
        orientation: spec.orientation ?? 1,
        ...(spec.metadata?.location ? { gps: true } : {}),
        ...(spec.metadata?.camera ? { make: "Camera Co" } : {}),
        ...(spec.keepable?.title === undefined ? {} : { xpTitle: spec.keepable.title }),
      }),
    );
  },
  async lyingHeader() {
    // IDAT runs past the end of the file.
    const bytes = png({ width: 4, height: 4 });
    return new Blob([bytes.slice(0, bytes.length - 16)]);
  },
  async malformed() {
    return new Blob([Uint8Array.of(0xff, 0xd8, 0xff, 0xc0, 0, 2)]);
  },
  async unknown() {
    return new Blob(["not an image the SDK reads"]);
  },
});

/** Registers a file and reads its upright pixels back through a thumbnail at full size. */
async function decodedOrientation(file: Blob) {
  const engine = createImageEngine();
  try {
    const probe = await engine.probe(file);
    await engine.register("a", file, probe);
    const thumbnail = (await engine.thumbnail("a", 10_000)) as unknown as ImageBitmap;
    const shown = classifyQuadrants(thumbnail, quadrantCentres(thumbnail), probe.stored);
    thumbnail.close();
    return { probe, shown };
  } finally {
    await engine.destroy();
  }
}

describe("sources are upright, pixel for pixel (docs/adr/0005)", () => {
  it.each(ORIENTATIONS)("JPEG with EXIF orientation %i", async (orientation) => {
    const { probe, shown } = await decodedOrientation(
      await jpegWith(quadrants(), exif({ orientation })),
    );
    expect(probe.orientation).toBe(orientation);
    expect(shown).toBe(orientation);
  });

  it.each(ORIENTATIONS)("PNG with eXIf orientation %i before IDAT", async (orientation) => {
    const stored = await bytesOf(await quadrants().convertToBlob());
    const at = 8 + 8 + 13 + 4;
    const file = new Blob([
      concat([
        stored.subarray(0, at),
        pngChunk("eXIf", exif({ orientation })),
        stored.subarray(at),
      ]).slice(),
    ]);
    const { probe, shown } = await decodedOrientation(file);
    expect(probe.orientation).toBe(orientation);
    expect(shown).toBe(orientation);
  });

  it("WebP with an EXIF orientation opens as stored, as browsers show it", async () => {
    const lossless = await fixture("quadrants.webp");
    const file = new Blob([
      webp({
        canvas: { width: 48, height: 32 },
        chunks: [lossless.subarray(12), webpChunk("EXIF", exif({ orientation: 7 }))],
      }).slice(),
    ]);
    expect(await decodedOrientation(file)).toMatchObject({ shown: 1, probe: { orientation: 1 } });
  });

  it.each([
    ["quadrants-irot1.avif", 8],
    ["quadrants-imir0.avif", 4],
    ["quadrants-imir1.avif", 2],
    ["quadrants-irot1-imir0.avif", 5],
    ["quadrants-exif6-irot2.avif", 3],
  ] as const)("AVIF %s, orientation %i", async (name, orientation) => {
    const { probe, shown } = await decodedOrientation(new Blob([await fixture(name)]));
    expect(probe.orientation).toBe(orientation);
    expect(shown).toBe(orientation);
  });

  it("HEIC either decodes upright or fails with DECODE_FAILED", async () => {
    const file = new Blob([await fixture("quadrants-rotate-cw90.heic")]);
    try {
      const { shown } = await decodedOrientation(file);
      expect(shown).toBe(6);
    } catch (error) {
      expect(isImageError(error, "DECODE_FAILED"), String(error)).toBe(true);
    }
  });
});

describe("the worker's own transform (docs/adr/0005)", () => {
  it.each(ORIENTATIONS)("draws a stored bitmap upright for orientation %i", async (orientation) => {
    const stored = await createImageBitmap(quadrants());
    const upright = orientBitmap(stored, orientation);
    expect(classifyQuadrants(upright, quadrantCentres(upright), { width: 48, height: 32 })).toBe(
      orientation,
    );
    // The stored bitmap is closed as soon as it's drawn.
    expect([stored.width, stored.height]).toEqual([0, 0]);
    upright.close();
  });
});

describe("decoding with each calibration (docs/adr/0005)", () => {
  const probeOf = (orientation: ExifOrientation) => {
    const turned = orientation >= 5;
    return {
      format: "jpeg" as const,
      stored: { width: 48, height: 32 },
      oriented: turned ? { width: 32, height: 48 } : { width: 48, height: 32 },
      orientation,
      frames: 1,
      hasAlpha: false,
      decodedPixelBound: 2 * 48 * 32,
      metadata: {
        location: false,
        camera: false,
        timestamps: false,
        thumbnail: false,
        colourProfile: false,
        other: false,
      },
      keepable: { title: "", description: "", artist: "", copyright: "" },
    };
  };

  it("applies the orientation itself where the browser didn't", async () => {
    const bitmap = await decodeUpright(new Blob(), probeOf(7), {
      decode: () => createImageBitmap(quadrants()),
      calibrate: async () => "not applied",
    });
    expect(classifyQuadrants(bitmap, quadrantCentres(bitmap), { width: 48, height: 32 })).toBe(7);
    bitmap.close();
  });

  it("keeps the browser's bitmap where it applied the orientation", async () => {
    const upright = orientBitmap(await createImageBitmap(quadrants()), 7);
    const bitmap = await decodeUpright(new Blob(), probeOf(7), {
      decode: async () => upright,
      calibrate: async () => "applied",
    });
    expect(bitmap).toBe(upright);
    bitmap.close();
  });

  it("never calibrates or transforms a file the probe calls upright", async () => {
    let calibrated = false;
    const bitmap = await decodeUpright(new Blob(), probeOf(1), {
      decode: () => createImageBitmap(quadrants()),
      calibrate: async () => {
        calibrated = true;
        return "not applied";
      },
    });
    expect(calibrated).toBe(false);
    expect(classifyQuadrants(bitmap, quadrantCentres(bitmap), { width: 48, height: 32 })).toBe(1);
    bitmap.close();
  });

  it("fails closed with DECODE_FAILED when the calibration is unknown", async () => {
    const decoded = await createImageBitmap(quadrants());
    const error = await decodeUpright(new Blob(), probeOf(7), {
      decode: async () => decoded,
      calibrate: async () => "unknown",
    }).catch((reason: unknown) => reason);
    expect(isImageError(error, "DECODE_FAILED")).toBe(true);
    expect(decoded.width).toBe(0);
  });

  it("fails with INVALID_IMAGE when the decode isn't the probe's size, and closes it", async () => {
    const canvas = new OffscreenCanvas(40, 40);
    canvas.getContext("2d")?.fillRect(0, 0, 40, 40);
    const decoded = await createImageBitmap(canvas);
    const error = await decodeUpright(new Blob(), probeOf(1), {
      decode: async () => decoded,
      calibrate: async () => "applied",
    }).catch((reason: unknown) => reason);
    expect(isImageError(error, "INVALID_IMAGE")).toBe(true);
    expect(decoded.width).toBe(0);
  });

  it("fails with DECODE_FAILED when the browser refuses the file", async () => {
    const error = await decodeUpright(new Blob(), probeOf(1), {
      decode: () => Promise.reject(new DOMException("no", "InvalidStateError")),
      calibrate: async () => "applied",
    }).catch((reason: unknown) => reason);
    expect(isImageError(error, "DECODE_FAILED")).toBe(true);
  });

  it.each(["jpeg", "png", "avif"] as const)(
    "calibrates %s in this browser as applied or not applied, never unknown",
    async (format) => {
      expect(["applied", "not applied"]).toContain(await calibrate(format));
    },
  );
});

describe("the self-hosted worker (docs/adr/0002)", () => {
  it("loads from assetsUrl and decodes", async () => {
    const engine = createImageEngine({ assetsUrl: "/hm-test-assets/" });
    const file = await jpegWith(quadrants());
    const source = await engine.register("a", file, await engine.probe(file));
    expect([source.width, source.height]).toEqual([48, 32]);
    await engine.destroy();
  });

  it("refuses a worker from another version with WORKER_START_FAILED", async () => {
    const engine = createImageEngine({ assetsUrl: "/hm-test-assets-stale/" });
    const error = await engine
      .probe(await jpegWith(quadrants()))
      .catch((reason: unknown) => reason);
    expect(isImageError(error, "WORKER_START_FAILED")).toBe(true);
    await engine.destroy();
  });
});
