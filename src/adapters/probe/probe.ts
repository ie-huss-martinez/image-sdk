import { ImageError } from "../../core/errors/image-error.js";
import type { ImageProbe } from "../../core/model/source.js";
import { isBmp, probeBmp } from "./bmp.js";
import { startsWith } from "./bytes.js";
import { isGif, probeGif } from "./gif.js";
import { isHeif, probeHeif } from "./heif.js";
import { JPEG_SIGNATURE, probeJpeg } from "./jpeg.js";
import { PNG_SIGNATURE, probePng } from "./png.js";
import { isWebp, probeWebp } from "./webp.js";
import type { WindowReader } from "./window-reader.js";

/**
 * Probes a file by its signature bytes, never its name or MIME type, and
 * fails closed on anything it doesn't recognise (ADR 0001). It reads PNG,
 * JPEG, WebP, GIF, AVIF, HEIF and BMP.
 *
 * @internal
 */
export async function probeImage(reader: WindowReader): Promise<ImageProbe> {
  const head = await reader.bytes(0, 16);
  if (startsWith(head, PNG_SIGNATURE)) {
    return probePng(reader);
  }
  if (startsWith(head, JPEG_SIGNATURE)) {
    return probeJpeg(reader);
  }
  if (isWebp(head)) {
    return probeWebp(reader);
  }
  if (isGif(head)) {
    return probeGif(reader);
  }
  if (isHeif(head)) {
    return probeHeif(reader);
  }
  if (isBmp(head)) {
    return probeBmp(reader);
  }
  throw new ImageError("UNSUPPORTED_FORMAT", "The file isn't an image format the SDK reads.", {
    details: { format: "unknown" },
  });
}
