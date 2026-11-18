import { ImageError, isImageError } from "../../core/errors/image-error.js";
import type { ImageProbe } from "../../core/model/source.js";
import { createGifComposer } from "../gif/compose.js";
import { type GifFile, readGifFrames } from "../gif/frames.js";
import { type Calibration, calibrate } from "./calibration.js";
import { orientBitmap } from "./orientation.js";

/** What decoding needs from the browser, replaceable in tests. */
export interface DecodeEnvironment {
  readonly decode: (file: Blob) => Promise<ImageBitmap>;
  /** Makes a bitmap of RGBA pixels that aren't premultiplied: a GIF's composed frame. */
  readonly fromPixels?: (
    pixels: Uint8ClampedArray<ArrayBuffer>,
    width: number,
    height: number,
  ) => Promise<ImageBitmap>;
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

/**
 * A bitmap of RGBA pixels that aren't premultiplied, as files are decoded.
 * The pixels are copied: the bitmap doesn't follow the buffer afterwards.
 *
 * @internal
 */
export const bitmapOf = (
  pixels: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
): Promise<ImageBitmap> =>
  createImageBitmap(new ImageData(pixels, width, height), { premultiplyAlpha: "none" });

/**
 * A GIF's bytes and its frame table, checked against the probe that
 * bounded it (docs/adr/0011): the table the decoder reads must be the one
 * the probe walked.
 *
 * @internal
 */
export async function readGif(
  file: Blob,
  probe: ImageProbe,
): Promise<{ readonly bytes: Uint8Array; readonly gif: GifFile }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const gif = readGifFrames(bytes);
  if (
    gif.frames.length !== probe.frames ||
    gif.width !== probe.stored.width ||
    gif.height !== probe.stored.height
  ) {
    throw new ImageError("INVALID_IMAGE", "The GIF's frames differ from what its probe read.", {
      details: { format: "gif", problem: "the frame table differs from the probe" },
    });
  }
  return { bytes, gif };
}

/**
 * A GIF's first frame, by the SDK's own decoder (docs/adr/0011): the browser's
 * decoder never sees a GIF. The file is read whole, which the file policy's
 * size limit already allowed, its first frame is read and its screen checked
 * against the probe's, and that frame is composed over a transparent screen.
 *
 * A malformed file fails with the decoder's own `INVALID_IMAGE`, never
 * `DECODE_FAILED`: it's our code that refused it, and it says why.
 */
async function decodeGif(
  file: Blob,
  probe: ImageProbe,
  environment: DecodeEnvironment,
): Promise<ImageBitmap> {
  // A still is its first frame: the frames after it aren't read, so a file
  // with more frames than an animation may hold still opens as one.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const gif = readGifFrames(bytes, "first");
  if (gif.width !== probe.stored.width || gif.height !== probe.stored.height) {
    throw new ImageError("INVALID_IMAGE", "The GIF's frames differ from what its probe read.", {
      details: { format: "gif", problem: "the frame table differs from the probe" },
    });
  }
  const screen = createGifComposer(bytes, gif).next();
  return (environment.fromPixels ?? bitmapOf)(screen, gif.width, gif.height);
}

const decodeFailed = (probe: ImageProbe, problem: string) =>
  new ImageError("DECODE_FAILED", "The browser couldn't decode the image.", {
    details: { format: probe.format, problem },
  });

/**
 * Decodes a probed file into an upright bitmap, in the worker (docs/adr/0001,
 * docs/adr/0005):
 *
 * - a GIF is decoded by the SDK's own decoder, its first frame (docs/adr/0011);
 *   anything else by `createImageBitmap`, whose refusal is `DECODE_FAILED`;
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
    bitmap =
      probe.format === "gif"
        ? await decodeGif(file, probe, environment)
        : await environment.decode(file);
  } catch (error) {
    // Our own decoder's refusal is the answer; the browser's is wrapped.
    if (isImageError(error)) throw error;
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
