import type {
  ExifOrientation,
  ImageKeepableMetadata,
  ImageMetadataPresence,
} from "../../src/index.js";

/**
 * The fakes' file format: JSON with the stored pixels, standing in for PNG,
 * JPEG and the rest, so the session and the contract suites can run in Node.
 */
export interface FakeImageFile {
  readonly magic: "FAKEIMG1";
  /** The stored size, before orientation. */
  readonly width: number;
  readonly height: number;
  readonly orientation: ExifOrientation;
  /** RGBA, row by row, of the stored pixels. */
  readonly pixels: readonly number[];
  readonly metadata: ImageMetadataPresence;
  readonly keepable: ImageKeepableMetadata;
  /** A header claiming more pixels than `pixels` holds, as a lying file would. */
  readonly declaredHeight?: number;
  /** A decoder that returns another size than the header's, as a hostile file might cause. */
  readonly decodesAs?: { readonly width: number; readonly height: number };
}

/** The fakes' export format. */
export interface FakeExportFile {
  readonly magic: "FAKEOUT1";
  readonly format: string;
  readonly width: number;
  readonly height: number;
  readonly pixels: readonly number[];
  /** Exactly the metadata written: only non-empty kept fields. */
  readonly metadata: Readonly<Record<string, string>>;
}

export type Rgba = readonly [number, number, number, number];

/** A distinct colour for every stored pixel, so any misplaced pixel shows. */
export function storedColour(x: number, y: number): Rgba {
  return [x * 16 + 1, y * 16 + 2, (x * 7 + y * 3) % 256, 255];
}

export function storedPixels(width: number, height: number): number[] {
  const pixels: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels.push(...storedColour(x, y));
    }
  }
  return pixels;
}

/**
 * Where an upright pixel comes from in the stored pixels, for each EXIF
 * orientation: the reference the contract suites check decoders against.
 */
export function storedPixelFor(
  orientation: ExifOrientation,
  x: number,
  y: number,
  stored: { readonly width: number; readonly height: number },
): { readonly x: number; readonly y: number } {
  const w = stored.width;
  const h = stored.height;
  switch (orientation) {
    case 2:
      return { x: w - 1 - x, y };
    case 3:
      return { x: w - 1 - x, y: h - 1 - y };
    case 4:
      return { x, y: h - 1 - y };
    case 5:
      return { x: y, y: x };
    case 6:
      return { x: y, y: h - 1 - x };
    case 7:
      return { x: w - 1 - y, y: h - 1 - x };
    case 8:
      return { x: w - 1 - y, y: x };
    default:
      return { x, y };
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeJson(value: unknown): Blob {
  return new Blob([encoder.encode(JSON.stringify(value))]);
}

export async function decodeJson(file: Blob): Promise<unknown> {
  return JSON.parse(decoder.decode(await file.arrayBuffer()));
}
