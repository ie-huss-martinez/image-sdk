import type { WindowReader } from "@hussmartinez/sdk-core";
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
 * Skips a chain of data sub-blocks, each a length byte and that many bytes,
 * ending with a zero length, and returns the offset after it.
 */
async function skipSubBlocks(reader: WindowReader, start: number): Promise<number> {
  let offset = start;
  for (;;) {
    const length = (await exact(reader, "gif", offset, 1, "a data sub-block"))[0] ?? 0;
    offset += 1;
    if (length === 0) {
      return offset;
    }
    if (offset + length > reader.size) {
      throw invalid("gif", "a data sub-block ends past the end of the file");
    }
    offset += length;
  }
}

/**
 * Probes a GIF file by walking every block to the trailer (ADR 0001): the
 * size from the logical screen descriptor, and every image descriptor as a
 * frame, which must fit inside the logical screen and declare an LZW
 * minimum code size from 2 to 8. Each frame is composited on the full
 * screen, so the bound is frames × the screen's pixels. Image data is never
 * decompressed. GIF carries no EXIF; comments and application extensions
 * other than looping set the "other" flag.
 *
 * @internal
 */
export async function probeGif(reader: WindowReader): Promise<ImageProbe> {
  const screen = await exact(reader, "gif", 0, 13, "the logical screen descriptor");
  const width = u16le(screen, 6);
  const height = u16le(screen, 8);
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
        const disposal = ((control[1] ?? 0) >>> 2) & 0x07;
        if (disposal > 3) {
          throw invalid("gif", "a frame uses a reserved disposal method");
        }
      } else if (label === 0xff) {
        const application = await exact(reader, "gif", offset + 2, 12, "an application extension");
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
      const codeSize = (await exact(reader, "gif", offset, 1, "an LZW minimum code size"))[0] ?? 0;
      if (codeSize < 2 || codeSize > 8) {
        throw invalid("gif", "a frame's LZW minimum code size is out of range");
      }
      offset = await skipSubBlocks(reader, offset + 1);
      frames += 1;
      continue;
    }
    throw invalid("gif", "an unknown block");
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
