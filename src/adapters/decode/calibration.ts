import type { ImageFormat } from "../../core/model/source.js";
import { probeImage } from "../probe/probe.js";
import { createWindowReader } from "../probe/window-reader.js";
import { AVIF_CALIBRATION, HEIF_CALIBRATION } from "./calibration-files.js";
import { classifyQuadrants, QUADRANT_COLOURS, quadrantCentres } from "./orientation.js";

/**
 * Whether this browser's `createImageBitmap` applies a format's orientation
 * (docs/adr/0005): `applied`, `not applied`, or `unknown` when the
 * calibration image came back in neither form, or didn't decode.
 */
export type Calibration = "applied" | "not applied" | "unknown";

const CALIBRATION_SIZE = { width: 48, height: 32 } as const;

/** A stored 48 × 32 four-colour image, drawn in the worker. */
function quadrantCanvas(): OffscreenCanvas {
  const canvas = new OffscreenCanvas(CALIBRATION_SIZE.width, CALIBRATION_SIZE.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The worker has no 2D canvas.");
  QUADRANT_COLOURS.forEach(([r, g, b], quadrant) => {
    context.fillStyle = `rgb(${r} ${g} ${b})`;
    context.fillRect((quadrant % 2) * 24, Math.floor(quadrant / 2) * 16, 24, 16);
  });
  return canvas;
}

/** A big-endian TIFF block whose only entry is an orientation: the EXIF the probe reads. */
function exifOrientation(orientation: number): Uint8Array {
  return Uint8Array.of(
    ...[0x4d, 0x4d, 0, 42, 0, 0, 0, 8],
    ...[0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0],
    ...[0, 0, 0, 0],
  );
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const be = (value: number, bytes: number) =>
  Array.from({ length: bytes }, (_, i) => (value >>> (8 * (bytes - 1 - i))) & 0xff);

/** A PNG with an `eXIf` chunk straight after `IHDR`, before `IDAT`, as the probe reads it. */
async function pngCalibration(): Promise<Blob> {
  const png = new Uint8Array(await (await quadrantCanvas().convertToBlob()).arrayBuffer());
  const typed = Uint8Array.of(...[0x65, 0x58, 0x49, 0x66], ...exifOrientation(7));
  const chunk = Uint8Array.of(...be(typed.length - 4, 4), ...typed, ...be(crc32(typed), 4));
  const afterIhdr = 8 + 8 + 13 + 4;
  return new Blob([png.slice(0, afterIhdr), chunk, png.slice(afterIhdr)], { type: "image/png" });
}

/**
 * Where an `APP1` segment goes in an encoded JPEG: after a leading JFIF
 * `APP0`, if there is one. Firefox refuses its own encoder's output with
 * `APP1` before `APP0`; the probe reads `APP1` in either place.
 */
function app1At(jpeg: Uint8Array): number {
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) return 4 + (((jpeg[4] ?? 0) << 8) | (jpeg[5] ?? 0));
  return 2;
}

/** A JPEG with EXIF in an `APP1` segment, as the probe reads it. */
async function jpegCalibration(): Promise<Blob> {
  const jpeg = new Uint8Array(
    await (await quadrantCanvas().convertToBlob({ type: "image/jpeg", quality: 1 })).arrayBuffer(),
  );
  const payload = Uint8Array.of(...[0x45, 0x78, 0x69, 0x66, 0, 0], ...exifOrientation(7));
  const app1 = Uint8Array.of(0xff, 0xe1, ...be(payload.length + 2, 2), ...payload);
  const at = app1At(jpeg);
  return new Blob([jpeg.slice(0, at), app1, jpeg.slice(at)], { type: "image/jpeg" });
}

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** The calibration file for a format whose probe reads an orientation, with it. */
async function calibrationFile(format: ImageFormat): Promise<Blob | undefined> {
  switch (format) {
    case "jpeg":
      return jpegCalibration();
    case "png":
      return pngCalibration();
    case "avif":
      return new Blob([fromBase64(AVIF_CALIBRATION)]);
    case "heif":
      return new Blob([fromBase64(HEIF_CALIBRATION)]);
    default:
      // WebP, GIF and BMP never have an orientation the probe reads.
      return undefined;
  }
}

/**
 * Decodes the calibration image and classifies the pixels: the oriented
 * layout the SDK's own probe reads from the file, the stored layout, or
 * anything else, which is `unknown` (docs/adr/0005).
 */
async function measure(format: ImageFormat): Promise<Calibration> {
  try {
    const file = await calibrationFile(format);
    if (!file) return "unknown";
    const probe = await probeImage(createWindowReader(file));
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
      const shown = classifyQuadrants(bitmap, quadrantCentres(bitmap), probe.stored);
      if (probe.orientation !== 1 && shown === probe.orientation) return "applied";
      if (shown === 1) return "not applied";
      return "unknown";
    } finally {
      bitmap.close();
    }
  } catch {
    return "unknown";
  }
}

const calibrations = new Map<ImageFormat, Promise<Calibration>>();

/**
 * Whether this browser applies a format's orientation, measured on the
 * first oriented file of that format and shared by every later one, in this
 * worker's memory only (docs/adr/0005).
 *
 * @internal
 */
export function calibrate(format: ImageFormat): Promise<Calibration> {
  let calibration = calibrations.get(format);
  if (!calibration) {
    calibration = measure(format);
    calibrations.set(format, calibration);
  }
  return calibration;
}
