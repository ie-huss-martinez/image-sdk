import { ImageError } from "../../core/errors/image-error.js";
import type { ImageProbe } from "../../core/model/source.js";
import { type Calibration, calibrate } from "./calibration.js";
import { orientBitmap } from "./orientation.js";

/** What decoding needs from the browser, replaceable in tests. */
export interface DecodeEnvironment {
  readonly decode: (file: Blob) => Promise<ImageBitmap>;
  readonly calibrate: (format: ImageProbe["format"]) => Promise<Calibration>;
}

const browser: DecodeEnvironment = {
  decode: (file) =>
    createImageBitmap(file, {
      imageOrientation: "from-image",
      premultiplyAlpha: "none",
      colorSpaceConversion: "default",
    }),
  calibrate,
};

const decodeFailed = (probe: ImageProbe, problem: string) =>
  new ImageError("DECODE_FAILED", "The browser couldn't decode the image.", {
    details: { format: probe.format, problem },
  });

/**
 * Decodes a probed file into an upright bitmap, in the worker (docs/adr/0001,
 * docs/adr/0005):
 *
 * - `createImageBitmap` decodes it, and a refusal is `DECODE_FAILED`;
 * - for a file the probe reads an orientation in, the format's calibration
 *   says whether the browser applied it: if not, the worker draws the bitmap
 *   upright itself, and if the calibration was neither, the decode fails
 *   closed with `DECODE_FAILED`. A file the probe calls upright is never
 *   transformed;
 * - the result must be the probe's oriented size exactly, or it's closed and
 *   the call fails with `INVALID_IMAGE`.
 *
 * @internal
 */
export async function decodeUpright(
  file: Blob,
  probe: ImageProbe,
  environment: DecodeEnvironment = browser,
): Promise<ImageBitmap> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await environment.decode(file);
  } catch (error) {
    throw new ImageError("DECODE_FAILED", "The browser couldn't decode the image.", {
      details: { format: probe.format },
      cause: error,
    });
  }
  if (probe.orientation !== 1) {
    const calibration = await environment.calibrate(probe.format);
    if (calibration === "unknown") {
      bitmap.close();
      throw decodeFailed(probe, "this browser's orientation handling is unknown");
    }
    if (calibration === "not applied") {
      try {
        bitmap = orientBitmap(bitmap, probe.orientation);
      } catch (error) {
        throw new ImageError("DECODE_FAILED", "The browser couldn't decode the image.", {
          details: { format: probe.format, problem: "the worker couldn't orient it" },
          cause: error,
        });
      }
    }
  }
  if (bitmap.width !== probe.oriented.width || bitmap.height !== probe.oriented.height) {
    bitmap.close();
    throw new ImageError(
      "INVALID_IMAGE",
      "The image decoded to another size than its header declares.",
      {
        details: { format: probe.format, problem: "the decoded size differs from the probe" },
      },
    );
  }
  return bitmap;
}
