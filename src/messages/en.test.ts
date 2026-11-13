import { createMessages, sdkCoreMessages } from "@hussmartinez/sdk-core";
import { uiMessages } from "@hussmartinez/ui";
import { describe, expect, it } from "vitest";
import { ImageError, type ImageErrorCode } from "../core/errors/image-error.js";
import { imageLimitDefinitions, imageLimits } from "../core/errors/image-limits.js";
import { imageMessages } from "./en.js";

// Listing every code here makes the type checker fail when a code is added
// to ImageErrorCode without being listed, and the test fail when its text is
// missing from the catalogue.
const ALL_CODES: Record<ImageErrorCode, true> = {
  UNKNOWN: true,
  ABORTED: true,
  TIMEOUT: true,
  WORKER_START_FAILED: true,
  WORKER_PROTOCOL_MISMATCH: true,
  WORKER_CRASHED: true,
  WORKER_TERMINATED: true,
  WORKER_METHOD_NOT_FOUND: true,
  WORKER_DATA_NOT_CLONEABLE: true,
  UNSUPPORTED_ENVIRONMENT: true,
  FILE_TOO_LARGE: true,
  TOO_MANY_FILES: true,
  DECODED_SIZE_TOO_LARGE: true,
  PROCESSING_TIME_EXCEEDED: true,
  INVALID_IMAGE: true,
  UNSUPPORTED_FORMAT: true,
  DECODE_FAILED: true,
  INVALID_COMMAND: true,
  IMAGE_TOO_LARGE: true,
  IMAGE_DIMENSION_TOO_LARGE: true,
  TOO_MANY_FRAMES: true,
  SESSION_TOO_LARGE: true,
  TOO_MANY_LAYERS: true,
};

function violation(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the limit to be exceeded");
}

describe("imageMessages", () => {
  it("has text for every ImageError code and every limit's warning", () => {
    for (const code of Object.keys(ALL_CODES)) {
      expect(imageMessages, code).toHaveProperty(`errors.${code}`);
    }
    for (const limit of Object.keys(imageLimitDefinitions)) {
      expect(imageMessages, limit).toHaveProperty(`warnings.${limit}`);
    }
  });

  it("is a valid catalogue", () => {
    // createMessages throws on a malformed message in the SDK's own catalogue.
    expect(() => createMessages(imageMessages)).not.toThrow();
  });

  it("describes a limit violation with its details, never its message", () => {
    const messages = createMessages(imageMessages);
    const policy = imageLimits.resolve();
    expect(messages.error(violation(() => policy.check("maxImageDimension", 30_000)))).toBe(
      "This image is 30,000 pixels across, which is over the 16,384-pixel limit.",
    );
    expect(messages.error(violation(() => policy.check("maxFrames", 400)))).toBe(
      "This animation has 400 frames, which is over the 300-frame limit.",
    );
    expect(messages.error(violation(() => policy.check("maxSessionSize", 1_200_000_000)))).toBe(
      "The open images would use 1.2 GB of memory, which is over the 1 GB limit. Close an image, or clear the undo history, and try again.",
    );
    expect(messages.error(violation(() => policy.check("maxImagePixels", 900_000_000)))).toBe(
      "This image has more pixels than the editor can handle. Try a smaller version of it.",
    );
    expect(messages.error(new ImageError("INVALID_IMAGE", "<script>from the file</script>"))).toBe(
      "This file isn't a valid image, or it's too damaged to open.",
    );
  });

  it("formats sizes, numbers and plurals for the locale", () => {
    const en = createMessages(imageMessages);
    expect(en.t("warnings.maxLayers", { actual: 1 })).toBe("This image has 1 layer.");
    expect(en.t("errors.TOO_MANY_LAYERS", { maximum: 1_000 })).toBe(
      "An image can have up to 1,000 layers. Merge or delete layers, and try again.",
    );
    expect(en.t("warnings.maxSessionSize", { actual: 600_000_000 })).toBe(
      "The open images use 600 MB of memory. Clearing the undo history frees memory.",
    );
    const de = createMessages(imageMessages, { locale: "de" });
    expect(de.t("warnings.maxFrames", { actual: 1_200 })).toBe(
      "This animation has 1.200 frames, and may be slow to edit and export.",
    );
  });
});

describe("the message catalogue (sdk-core ADR 0046)", () => {
  const shared = new Set([...Object.keys(sdkCoreMessages), ...Object.keys(uiMessages)]);
  const own = Object.keys(imageMessages).filter((key) => !shared.has(key));

  it("includes every sdk-core and ui message, unchanged", () => {
    for (const [key, value] of [
      ...Object.entries(sdkCoreMessages),
      ...Object.entries(uiMessages),
    ]) {
      expect(imageMessages[key as keyof typeof imageMessages], key).toEqual(value);
    }
  });

  it("has keys of its own that collide with neither sdk-core's nor ui's", () => {
    // Spreading catalogues lets a later key silently replace an earlier one,
    // so a bump of sdk-core or ui that would take one of ours fails here.
    expect(Object.keys(sdkCoreMessages).filter((key) => Object.hasOwn(uiMessages, key))).toEqual(
      [],
    );
    expect(own.length).toBeGreaterThan(0);
    const source = Object.keys(imageMessages);
    expect(new Set(source).size).toBe(source.length);
  });

  it("names its own keys by surface, never by one of ui's component prefixes", () => {
    const uiPrefixes = new Set(Object.keys(uiMessages).map((key) => key.split(".")[0]));
    uiPrefixes.delete("errors");
    for (const key of own) {
      expect(uiPrefixes.has(key.split(".")[0]), key).toBe(false);
    }
  });
});
