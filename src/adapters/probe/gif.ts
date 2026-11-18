import type { WindowReader } from "@hussmartinez/sdk-core";
import { isImageError } from "../../core/errors/image-error.js";
import type { ImageProbe } from "../../core/model/source.js";
import { EMPTY_KEEPABLE_METADATA, NO_METADATA } from "../../core/model/source.js";
import { ascii, exact, invalid, u16le } from "./bytes.js";

/** The most blocks a file may have: a few per frame, and frames are limited by `maxFrames`. */
const MAX_BLOCKS = 1_000_000;

/** Whether the first bytes are a GIF signature. */
export function isGif(head: Uint8Array): boolean {
  const signature = ascii(head, 0, 6);
  return signature === "GIF87a" || signature === "GIF89a";
}

/**
 * How many bytes of a sub-block chain are looked at per read. A chain's
 * lengths are walked within each view, so a large frame's data takes one
 * read per this many bytes, not one per sub-block of at most 255.
 */
const CHAIN_VIEW = 64 * 1024;

/**
 * Skips a chain of data sub-blocks, each a length byte and that many bytes,
 * ending with a zero length, and returns the offset after it.
 */
async function skipSubBlocks(reader: WindowReader, start: number): Promise<number> {
  let offset = start;
  for (;;) {
    if (offset + 1 > reader.size) {
      throw invalid("gif", "a data sub-block ends past the end of the file");
    }
    // A view from the reader's window: the lengths in it are walked without
    // another read, and the next view starts at the first length past it.
    const view = await reader.bytes(offset, CHAIN_VIEW);
    let at = 0;
    while (at < view.length) {
      const length = view[at] ?? 0;
      offset += 1;
      if (length === 0) {
        return offset;
      }
      if (offset + length > reader.size) {
        throw invalid("gif", "a data sub-block ends past the end of the file");
      }
      offset += length;
      at += 1 + length;
    }
  }
}

/**
 * Probes a GIF file by walking its blocks (ADR 0001): the size from the
 * logical screen descriptor, or from the first frame when it's at the
 * screen's corner and covers it, and every image descriptor as a frame, which
 * must fit inside the logical screen and declare an LZW minimum code size
 * from 1 to 8. Each frame is composited on the full
 * screen, so the bound is frames × the screen's pixels. Image data is never
 * decompressed. GIF carries no EXIF; comments and application extensions
 * other than looping set the "other" flag.
 *
 * The file's frames end at its trailer, or where it stops being a GIF
 * after at least one whole frame: the end of the file, a block cut short,
 * a block that isn't one, or a frame the format doesn't allow
 * (docs/adr/0011). Browsers show such a file. Only the frames before that
 * point are counted, and they're the only ones the decoder reads: its
 * frame table ends at the same place by the same rules, so change them
 * together.
 *
 * @internal
 */
export async function probeGif(reader: WindowReader): Promise<ImageProbe> {
  const screen = await exact(reader, "gif", 0, 13, "the logical screen descriptor");
  let width = u16le(screen, 6);
  let height = u16le(screen, 8);
  if (width < 1 || height < 1) {
    throw invalid("gif", "the logical screen has no pixels");
  }
  const packed = screen[10] ?? 0;
  let offset = 13 + ((packed & 0x80) !== 0 ? 3 * 2 ** ((packed & 0x07) + 1) : 0);

  let frames = 0;
  let hasAlpha = false;
  let other = false;
  for (let count = 0; ; count += 1) {
    if (count >= MAX_BLOCKS) {
      throw invalid("gif", "the file has too many blocks");
    }
    try {
      const introducer = (await exact(reader, "gif", offset, 1, "a block"))[0];
      if (introducer === 0x3b) {
        break;
      }
      if (introducer === 0x21) {
        const label = (await exact(reader, "gif", offset + 1, 1, "an extension label"))[0];
        if (label === 0xf9) {
          // Graphic control extension: a transparent colour means alpha.
          const control = await exact(reader, "gif", offset + 2, 6, "a graphic control extension");
          if (control[0] !== 4) {
            throw invalid("gif", "a graphic control extension is the wrong size");
          }
          if (((control[1] ?? 0) & 0x01) !== 0) {
            hasAlpha = true;
          }
        } else if (label === 0xff) {
          const application = await exact(
            reader,
            "gif",
            offset + 2,
            12,
            "an application extension",
          );
          const name = ascii(application, 1, 11);
          if (name !== "NETSCAPE2.0" && name !== "ANIMEXTS1.0") {
            other = true;
          }
        } else if (label === 0xfe) {
          other = true;
        }
        offset = await skipSubBlocks(reader, offset + 2);
        continue;
      }
      if (introducer === 0x2c) {
        const descriptor = await exact(reader, "gif", offset, 10, "an image descriptor");
        const left = u16le(descriptor, 1);
        const top = u16le(descriptor, 3);
        const frameWidth = u16le(descriptor, 5);
        const frameHeight = u16le(descriptor, 7);
        // A first frame at the screen's corner that covers it and more is
        // the screen: every browser shows the frame alone (docs/adr/0011).
        if (
          frames === 0 &&
          left === 0 &&
          top === 0 &&
          frameWidth >= width &&
          frameHeight >= height
        ) {
          width = frameWidth;
          height = frameHeight;
        }
        if (
          frameWidth < 1 ||
          frameHeight < 1 ||
          left + frameWidth > width ||
          top + frameHeight > height
        ) {
          throw invalid("gif", "a frame doesn't fit inside the logical screen");
        }
        const flags = descriptor[9] ?? 0;
        offset += 10 + ((flags & 0x80) !== 0 ? 3 * 2 ** ((flags & 0x07) + 1) : 0);
        const codeSize =
          (await exact(reader, "gif", offset, 1, "an LZW minimum code size"))[0] ?? 0;
        if (codeSize < 1 || codeSize > 8) {
          throw invalid("gif", "a frame's LZW minimum code size is out of range");
        }
        offset = await skipSubBlocks(reader, offset + 1);
        frames += 1;
        continue;
      }
      throw invalid("gif", "an unknown block");
    } catch (error) {
      // After a whole frame, what can't be read is where the file's frames end.
      if (frames > 0 && isImageError(error) && error.code === "INVALID_IMAGE") break;
      throw error;
    }
  }

  if (frames === 0) {
    throw invalid("gif", "there are no frames");
  }
  const size = { width, height };
  return {
    format: "gif",
    stored: size,
    oriented: size,
    orientation: 1,
    frames,
    hasAlpha,
    decodedPixelBound: frames * width * height,
    metadata: { ...NO_METADATA, other },
    keepable: EMPTY_KEEPABLE_METADATA,
  };
}
