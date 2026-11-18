import { ImageError, isImageError } from "../../core/errors/image-error.js";
import { ascii, invalid, u16le } from "../probe/bytes.js";

/**
 * The most frames the decoder keeps a table of, whatever the file policy
 * allows (docs/adr/0011): the table is memory sized by the file.
 */
export const MAX_GIF_FRAMES = 4_096;

/** The most blocks a file may have: a few per frame. */
const MAX_BLOCKS = 4 * MAX_GIF_FRAMES + 1_024;

/** Where a colour table is in the file, and how many colours it has. */
export interface GifColourTable {
  readonly offset: number;
  /** 2 to 256 colours, three bytes each. */
  readonly size: number;
}

/**
 * What happens to a frame's rectangle before the next frame (GIF89a): 0 and
 * 1 keep it, 2 clears it to transparent, 3 restores what was there before
 * the frame.
 */
export type GifDisposal = 0 | 1 | 2 | 3;

/** One frame, as the file describes it: nothing is decoded yet. */
export interface GifFrame {
  /** Its rectangle, inside the logical screen. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** In hundredths of a second, as the file has it: 0 to 65,535. */
  readonly delay: number;
  readonly disposal: GifDisposal;
  /** The colour index that isn't drawn, or `null`. */
  readonly transparent: number | null;
  readonly interlaced: boolean;
  /** Its own colour table, or `null` to use the file's, which may be `null` too: no colours. */
  readonly table: GifColourTable | null;
  /** The LZW minimum code size: 1 to 8. */
  readonly codeSize: number;
  /** Where its first data sub-block starts. */
  readonly data: number;
}

/** A GIF's frame table (docs/adr/0011): what the decoder needs, bounded, with nothing decoded. */
export interface GifFile {
  /** The logical screen, or the first frame when it's at the screen's corner and covers it. */
  readonly width: number;
  readonly height: number;
  /** `null`: play once. 0: for ever. Otherwise that many repeats. */
  readonly loop: number | null;
  /** The file's colour table, or `null`. */
  readonly table: GifColourTable | null;
  readonly frames: readonly GifFrame[];
  /**
   * Whether the frames end at the file's trailer. `false` when they end
   * where the file stopped being a GIF: it was cut short, or damaged.
   */
  readonly complete: boolean;
}

/** The end of a chain of data sub-blocks that starts at `start`: the offset after its terminator. */
function afterSubBlocks(bytes: Uint8Array, start: number): number {
  let offset = start;
  for (;;) {
    if (offset >= bytes.length)
      throw invalid("gif", "a data sub-block ends past the end of the file");
    const length = bytes[offset] as number;
    offset += 1;
    if (length === 0) return offset;
    if (offset + length > bytes.length) {
      throw invalid("gif", "a data sub-block ends past the end of the file");
    }
    offset += length;
  }
}

/** Checks that `length` bytes at `offset` are in the file. */
function need(bytes: Uint8Array, offset: number, length: number, what: string): void {
  if (offset + length > bytes.length) throw invalid("gif", `${what} ends past the end of the file`);
}

/** A colour table of `2^(bits + 1)` colours at `offset`, which must be in the file. */
function tableAt(bytes: Uint8Array, offset: number, bits: number): GifColourTable {
  const size = 2 ** (bits + 1);
  need(bytes, offset, 3 * size, "a colour table");
  return { offset, size };
}

/**
 * Reads a GIF's frame table by walking its blocks (docs/adr/0011), as the
 * probe does, and recording for each frame its rectangle, delay, disposal,
 * transparent colour, interlacing, and where its colour table and data
 * are. Image data isn't decompressed.
 *
 * The file's frames end at its trailer, or where it stops being a GIF
 * after at least one whole frame: the end of the file, a block cut short,
 * a block that isn't one, or a frame the format doesn't allow. Browsers
 * show such a file, so the frames before that point are its frames, and
 * nothing after it is read. A file with no whole frame is `INVALID_IMAGE`.
 * The probe ends a file at the same place by the same rules: change them
 * together.
 *
 * It's hostile-input code: every offset and length is checked against the
 * file before it's used, the table is bounded at {@link MAX_GIF_FRAMES},
 * and a malformed file fails with `INVALID_IMAGE`, never a hang.
 *
 * @param only - `"first"` stops after the first frame, for a file held as
 *   a still: then `complete` is `false`, since the rest isn't read, and a
 *   file of any number of frames is read.
 * @throws `ImageError` with `INVALID_IMAGE`, or `TOO_MANY_FRAMES` past 4,096 frames.
 */
export function readGifFrames(bytes: Uint8Array, only: "all" | "first" = "all"): GifFile {
  need(bytes, 0, 13, "the logical screen descriptor");
  const signature = ascii(bytes, 0, 6);
  if (signature !== "GIF87a" && signature !== "GIF89a") throw invalid("gif", "not a GIF");
  let width = u16le(bytes, 6);
  let height = u16le(bytes, 8);
  if (width < 1 || height < 1) throw invalid("gif", "the logical screen has no pixels");
  const packed = bytes[10] as number;
  let offset = 13;
  let table: GifColourTable | null = null;
  if ((packed & 0x80) !== 0) {
    table = tableAt(bytes, offset, packed & 0x07);
    offset += 3 * table.size;
  }

  const frames: GifFrame[] = [];
  let complete = false;
  let loop: number | null = null;
  // The graphic control extension applies to the next frame only.
  let delay = 0;
  let disposal: GifDisposal = 0;
  let transparent: number | null = null;
  for (let count = 0; ; count += 1) {
    if (count >= MAX_BLOCKS) throw invalid("gif", "the file has too many blocks");
    try {
      need(bytes, offset, 1, "a block");
      const introducer = bytes[offset] as number;
      if (introducer === 0x3b) {
        complete = true;
        break;
      }
      if (introducer === 0x21) {
        need(bytes, offset, 2, "an extension label");
        const label = bytes[offset + 1] as number;
        if (label === 0xf9) {
          need(bytes, offset + 2, 6, "a graphic control extension");
          if (bytes[offset + 2] !== 4) {
            throw invalid("gif", "a graphic control extension is the wrong size");
          }
          const flags = bytes[offset + 3] as number;
          const method = (flags >>> 2) & 0x07;
          // The format reserves 4 to 7. Files have them, and browsers read 4
          // as 3 and the rest as "keep": the same here (docs/adr/0011).
          disposal = method === 4 ? 3 : method > 4 ? 0 : (method as GifDisposal);
          delay = u16le(bytes, offset + 4);
          transparent = (flags & 0x01) !== 0 ? (bytes[offset + 6] as number) : null;
        } else if (label === 0xff) {
          need(bytes, offset + 2, 12, "an application extension");
          const name = ascii(bytes, offset + 3, 11);
          // The loop count: a sub-block of 3 bytes, the first of them 1.
          if (
            bytes[offset + 2] === 11 &&
            (name === "NETSCAPE2.0" || name === "ANIMEXTS1.0") &&
            offset + 18 <= bytes.length &&
            bytes[offset + 14] === 3 &&
            bytes[offset + 15] === 1
          ) {
            loop = u16le(bytes, offset + 16);
          }
        }
        offset = afterSubBlocks(bytes, offset + 2);
        continue;
      }
      if (introducer !== 0x2c) throw invalid("gif", "an unknown block");
      need(bytes, offset, 10, "an image descriptor");
      const x = u16le(bytes, offset + 1);
      const y = u16le(bytes, offset + 3);
      const frameWidth = u16le(bytes, offset + 5);
      const frameHeight = u16le(bytes, offset + 7);
      // A first frame at the screen's corner that covers it and more is the
      // screen: every browser shows the frame alone (docs/adr/0011).
      if (
        frames.length === 0 &&
        x === 0 &&
        y === 0 &&
        frameWidth >= width &&
        frameHeight >= height
      ) {
        width = frameWidth;
        height = frameHeight;
      }
      if (frameWidth < 1 || frameHeight < 1 || x + frameWidth > width || y + frameHeight > height) {
        throw invalid("gif", "a frame doesn't fit inside the logical screen");
      }
      const flags = bytes[offset + 9] as number;
      offset += 10;
      let own: GifColourTable | null = null;
      if ((flags & 0x80) !== 0) {
        own = tableAt(bytes, offset, flags & 0x07);
        offset += 3 * own.size;
      }
      need(bytes, offset, 1, "an LZW minimum code size");
      const codeSize = bytes[offset] as number;
      if (codeSize < 1 || codeSize > 8) {
        throw invalid("gif", "a frame's LZW minimum code size is out of range");
      }
      const data = offset + 1;
      offset = afterSubBlocks(bytes, data);
      if (frames.length >= MAX_GIF_FRAMES) {
        throw new ImageError("TOO_MANY_FRAMES", `A GIF holds at most ${MAX_GIF_FRAMES} frames.`, {
          details: {
            limit: "maxFrames",
            maximum: MAX_GIF_FRAMES,
            actual: frames.length + 1,
            unit: "count",
          },
        });
      }
      frames.push({
        x,
        y,
        width: frameWidth,
        height: frameHeight,
        delay,
        disposal,
        transparent,
        interlaced: (flags & 0x40) !== 0,
        table: own,
        codeSize,
        data,
      });
      delay = 0;
      disposal = 0;
      transparent = null;
      // A still needs its first frame and nothing after it, however many follow.
      if (only === "first") break;
    } catch (error) {
      // After a whole frame, what can't be read is where the file's frames end.
      if (frames.length > 0 && isImageError(error) && error.code === "INVALID_IMAGE") break;
      throw error;
    }
  }
  if (frames.length === 0) throw invalid("gif", "there are no frames");
  return { width, height, loop, table, frames, complete };
}
