import type { ImageProbe } from "../../core/model/source.js";
import { EMPTY_KEEPABLE_METADATA, NO_METADATA } from "../../core/model/source.js";
import { ascii, exact, i32le, invalid, u16le, u32le } from "./bytes.js";
import type { WindowReader } from "./window-reader.js";

/** The DIB header sizes browsers decode: core, info, and V2 to V5. */
const HEADER_SIZES = new Set([12, 40, 52, 56, 108, 124]);

/** Whether the first bytes are a BMP signature. */
export function isBmp(head: Uint8Array): boolean {
  return ascii(head, 0, 2) === "BM";
}

/**
 * Probes a BMP file from its file and DIB headers (ADR 0001): the size from
 * `BITMAPCOREHEADER` or `BITMAPINFOHEADER` and later, where a negative
 * height means top-down rows. The pixel data must start inside the file.
 * BMP carries no metadata the editor reads; a V5 colour profile sets the
 * profile flag.
 *
 * @internal
 */
export async function probeBmp(reader: WindowReader): Promise<ImageProbe> {
  const file = await exact(reader, "bmp", 0, 18, "the file header");
  const dataOffset = u32le(file, 10);
  const headerSize = u32le(file, 14);
  if (!HEADER_SIZES.has(headerSize)) {
    throw invalid("bmp", "the DIB header size is unknown");
  }
  const header = await exact(reader, "bmp", 14, headerSize, "the DIB header");
  let width: number;
  let height: number;
  let bitCount: number;
  if (headerSize === 12) {
    width = u16le(header, 4);
    height = u16le(header, 6);
    bitCount = u16le(header, 10);
  } else {
    width = i32le(header, 4);
    height = Math.abs(i32le(header, 8));
    bitCount = u16le(header, 14);
  }
  if (u16le(header, headerSize === 12 ? 8 : 12) !== 1) {
    throw invalid("bmp", "the plane count isn't 1");
  }
  if (width < 1 || height < 1 || width > 0x7fffffff || height > 0x7fffffff) {
    throw invalid("bmp", "the dimensions are out of range");
  }
  if (![1, 4, 8, 16, 24, 32].includes(bitCount)) {
    throw invalid("bmp", "the bit depth is unsupported");
  }
  if (dataOffset < 14 + headerSize || dataOffset >= reader.size) {
    throw invalid("bmp", "the pixel data starts outside the file");
  }
  const colourProfile = headerSize === 124 && [0x4c494e4b, 0x4d424544].includes(u32le(header, 56));
  const size = { width, height };
  return {
    format: "bmp",
    stored: size,
    oriented: size,
    orientation: 1,
    frames: 1,
    hasAlpha: bitCount === 32,
    decodedPixelBound: width * height,
    metadata: { ...NO_METADATA, colourProfile },
    keepable: EMPTY_KEEPABLE_METADATA,
  };
}
