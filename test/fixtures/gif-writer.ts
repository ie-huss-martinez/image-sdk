/**
 * Writes real GIF files for the decoder's tests (docs/adr/0011): every
 * field the decoder reads is set here by hand, and the pixel data is
 * compressed by a small LZW encoder of the tests' own, so a fixture's
 * pixels are known before any decoder sees them.
 */

/** One frame of a {@link GifFixture}. */
export interface GifFixtureFrame {
  /** Its rectangle; by default the whole screen. */
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  /** A colour index for each pixel of the rectangle, row by row. */
  readonly pixels: readonly number[];
  /** In hundredths of a second. With `disposal` and `transparent`, written as a graphic control extension. */
  readonly delay?: number;
  readonly disposal?: number;
  readonly transparent?: number;
  readonly interlaced?: boolean;
  /** Its own colour table, as `[r, g, b]` colours: 2, 4, 8, … of them. */
  readonly palette?: readonly (readonly [number, number, number])[];
  /** The LZW minimum code size; by default the smallest the palette needs, at least 2. */
  readonly codeSize?: number;
  /** Replaces the compressed data's bytes, before they're split into sub-blocks. */
  readonly data?: readonly number[];
  /** Leaves out the end code. */
  readonly noEnd?: boolean;
  /** How many bytes each data sub-block holds, the last excepted: 255 by default, as encoders write them. */
  readonly subBlockSize?: number;
}

/** A GIF to write. */
export interface GifFixture {
  readonly width: number;
  readonly height: number;
  /** The file's colour table, or none. */
  readonly palette?: readonly (readonly [number, number, number])[];
  /** `undefined`: no loop extension. Otherwise the count it holds. */
  readonly loop?: number;
  /** The name of the loop extension. */
  readonly loopName?: string;
  readonly frames: readonly GifFixtureFrame[];
  /** A comment extension before the frames. */
  readonly comment?: string;
}

const le16 = (value: number) => [value & 0xff, (value >>> 8) & 0xff];
const latin1 = (text: string) => [...text].map((char) => char.charCodeAt(0));

/** How many bits index a palette of this size: `2^(bits)` colours. */
function paletteBits(colours: number): number {
  const bits = Math.max(1, Math.ceil(Math.log2(colours)));
  if (2 ** bits !== colours) throw new Error("A palette holds 2, 4, 8, … colours.");
  return bits;
}

/**
 * Compresses colour indexes as GIF's LZW: a clear code, then codes of
 * growing width, a clear when the table fills, and an end code.
 */
export function lzwEncode(pixels: readonly number[], codeSize: number, end = true): number[] {
  const clear = 1 << codeSize;
  const stop = clear + 1;
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  let width = codeSize + 1;
  const emit = (code: number) => {
    buffer |= code << bits;
    bits += width;
    while (bits >= 8) {
      out.push(buffer & 0xff);
      buffer >>>= 8;
      bits -= 8;
    }
  };
  let table = new Map<string, number>();
  let next = stop + 1;
  const reset = () => {
    table = new Map();
    next = stop + 1;
    width = codeSize + 1;
  };
  emit(clear);
  let current: number | undefined;
  for (const pixel of pixels) {
    if (current === undefined) {
      current = pixel;
      continue;
    }
    const key = `${current},${pixel}`;
    const known = table.get(key);
    if (known !== undefined) {
      current = known;
      continue;
    }
    emit(current);
    if (next < 4_096) {
      table.set(key, next);
      // The decoder adds its entry one code later, so its width grows one code later too.
      if (next === 1 << width && width < 12) width += 1;
      next += 1;
    } else {
      emit(clear);
      reset();
    }
    current = pixel;
  }
  if (current !== undefined) emit(current);
  if (end) emit(stop);
  if (bits > 0) out.push(buffer & 0xff);
  return out;
}

/** Bytes as data sub-blocks of at most 255, with the terminator. */
export function subBlocks(data: readonly number[], size = 255): number[] {
  const out: number[] = [];
  for (let at = 0; at < data.length; at += size) {
    const block = data.slice(at, at + size);
    out.push(block.length, ...block);
  }
  out.push(0);
  return out;
}

/** Rows in the order an interlaced frame stores them. */
function interlace(pixels: readonly number[], width: number, height: number): number[] {
  const out: number[] = [];
  for (const [start, step] of [
    [0, 8],
    [4, 8],
    [2, 4],
    [1, 2],
  ] as const) {
    for (let row = start; row < height; row += step) {
      out.push(...pixels.slice(row * width, (row + 1) * width));
    }
  }
  return out;
}

/** The bytes of a GIF. */
export function writeGif(spec: GifFixture): Uint8Array {
  const bytes: number[] = [...latin1("GIF89a"), ...le16(spec.width), ...le16(spec.height)];
  if (spec.palette) {
    bytes.push(0x80 | (paletteBits(spec.palette.length) - 1), 0, 0, ...spec.palette.flat());
  } else {
    bytes.push(0, 0, 0);
  }
  if (spec.loop !== undefined) {
    bytes.push(
      0x21,
      0xff,
      11,
      ...latin1(spec.loopName ?? "NETSCAPE2.0"),
      3,
      1,
      ...le16(spec.loop),
      0,
    );
  }
  if (spec.comment !== undefined) {
    bytes.push(0x21, 0xfe, ...subBlocks(latin1(spec.comment)));
  }
  for (const frame of spec.frames) {
    const width = frame.width ?? spec.width;
    const height = frame.height ?? spec.height;
    if (
      frame.delay !== undefined ||
      frame.disposal !== undefined ||
      frame.transparent !== undefined
    ) {
      bytes.push(
        0x21,
        0xf9,
        4,
        ((frame.disposal ?? 0) << 2) | (frame.transparent === undefined ? 0 : 1),
        ...le16(frame.delay ?? 0),
        frame.transparent ?? 0,
        0,
      );
    }
    bytes.push(0x2c, ...le16(frame.x ?? 0), ...le16(frame.y ?? 0), ...le16(width), ...le16(height));
    const colours = frame.palette?.length ?? spec.palette?.length ?? 2;
    bytes.push(
      (frame.palette ? 0x80 | (paletteBits(frame.palette.length) - 1) : 0) |
        (frame.interlaced ? 0x40 : 0),
    );
    if (frame.palette) bytes.push(...frame.palette.flat());
    const codeSize = frame.codeSize ?? Math.max(2, paletteBits(colours));
    const stored = frame.interlaced ? interlace(frame.pixels, width, height) : frame.pixels;
    bytes.push(codeSize);
    // One at a time: a large frame's data is more than a spread's arguments can hold.
    const data = frame.data ?? lzwEncode(stored, codeSize, !frame.noEnd);
    for (const byte of subBlocks(data, frame.subBlockSize)) {
      bytes.push(byte);
    }
  }
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}
