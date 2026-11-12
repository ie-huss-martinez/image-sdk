import { deserializeError, isSdkError, SdkError, serializeError } from "@hussmartinez/sdk-core";
import { describe, expect, it } from "vitest";
import { ImageError, isImageError } from "./image-error.js";

describe("ImageError", () => {
  it("carries a code, details and cause, as an SdkError", () => {
    const cause = new DOMException("The source image could not be decoded.", "InvalidStateError");
    const error = new ImageError("DECODE_FAILED", "The browser couldn't decode the file.", {
      details: { format: "heif" },
      cause,
    });
    expect(error).toBeInstanceOf(SdkError);
    expect(error).toMatchObject({
      name: "ImageError",
      code: "DECODE_FAILED",
      details: { format: "heif" },
      cause,
    });
    expect(isSdkError(error, "DECODE_FAILED")).toBe(true);
  });

  it("keeps its class, code and details across a worker boundary", () => {
    const original = new ImageError("IMAGE_TOO_LARGE", "Too many pixels.", {
      details: {
        limit: "maxImagePixels",
        maximum: 50_000_000,
        actual: 900_000_000,
        unit: "pixels",
      },
    });
    // What a worker posts, cloned as postMessage would.
    const received = structuredClone(serializeError(original));
    const rebuilt = deserializeError(received, { errorClasses: { ImageError } });
    expect(rebuilt).toBeInstanceOf(ImageError);
    expect(isImageError(rebuilt, "IMAGE_TOO_LARGE")).toBe(true);
    expect(rebuilt.details).toEqual(original.details);
  });
});

describe("isImageError", () => {
  it("recognises an ImageError, and checks its code when given one", () => {
    const error = new ImageError("INVALID_IMAGE", "Truncated header.");
    expect(isImageError(error)).toBe(true);
    expect(isImageError(error, "INVALID_IMAGE")).toBe(true);
    expect(isImageError(error, "UNSUPPORTED_FORMAT")).toBe(false);
  });

  it("rejects other SDK errors and plain values", () => {
    expect(isImageError(new SdkError("ABORTED", "Stopped."))).toBe(false);
    expect(isImageError(new Error("INVALID_IMAGE"))).toBe(false);
    expect(isImageError({ name: "ImageError", code: "INVALID_IMAGE", message: "forged" })).toBe(
      false,
    );
    expect(isImageError(undefined)).toBe(false);
  });
});
