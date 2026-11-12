import type { ImageProbe } from "../../core/model/source.js";
import { ascii, exact, invalid, u24le, u32le } from "./bytes.js";
import { emptyExif, readExif } from "./exif.js";
import type { WindowReader } from "./window-reader.js";

/** The most chunks a file may have; an animation has one per frame, plus a few. */
const MAX_CHUNKS = 100_000;
/** The largest EXIF chunk the probe reads. */
const MAX_EXIF = 1 << 20;

/** Whether the first 12 bytes are a RIFF WebP header. */
export function isWebp(head: Uint8Array): boolean {
  return ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 4) === "WEBP";
}

/**
 * Probes a WebP file by walking its RIFF chunks (ADR 0001): the size from
 * `VP8 `, `VP8L` or the `VP8X` canvas; for animations, every `ANMF` frame,
 * each of which must fit inside the canvas, and whose count must agree with
 * `VP8X`'s animation flag; presence flags from `EXIF`, profiles from
 * `ICCP`. Compressed bitstreams are never decoded.
 *
 * @internal
 */
export async function probeWebp(reader: WindowReader): Promise<ImageProbe> {
  const riff = await exact(reader, "webp", 0, 12, "the RIFF header");
  const riffEnd = 8 + u32le(riff, 4);
  if (riffEnd > reader.size || riffEnd < 12 + 8) {
    throw invalid("webp", "the RIFF size doesn't match the file");
  }

  let width = 0;
  let height = 0;
  let hasAlpha = false;
  let extended: { animated: boolean } | undefined;
  let simple = false;
  let frames = 0;
  const exif = emptyExif();
  let colourProfile = false;

  let offset = 12;
  for (let count = 0; offset < riffEnd; count += 1) {
    if (count >= MAX_CHUNKS) {
      throw invalid("webp", "the file has too many chunks");
    }
    const header = await exact(reader, "webp", offset, 8, "a chunk header");
    const type = ascii(header, 0, 4);
    const length = u32le(header, 4);
    const dataAt = offset + 8;
    if (dataAt + length > riffEnd) {
      throw invalid("webp", "a chunk ends past the RIFF data");
    }
    if (count === 0 && type !== "VP8 " && type !== "VP8L" && type !== "VP8X") {
      throw invalid("webp", "the first chunk isn't an image header");
    }

    switch (type) {
      case "VP8X": {
        if (count !== 0 || length < 10) {
          throw invalid("webp", "VP8X is misplaced or too short");
        }
        const data = await reader.bytes(dataAt, 10);
        const flags = data[0] ?? 0;
        hasAlpha = (flags & 0x10) !== 0;
        extended = { animated: (flags & 0x02) !== 0 };
        width = u24le(data, 4) + 1;
        height = u24le(data, 7) + 1;
        break;
      }
      case "VP8 ": {
        if (count === 0) simple = true;
        if (simple || (extended !== undefined && !extended.animated)) {
          if (length < 10) {
            throw invalid("webp", "the VP8 frame header is too short");
          }
          const data = await reader.bytes(dataAt, 10);
          if (data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) {
            throw invalid("webp", "the VP8 start code is missing");
          }
          const vp8Width = ((data[6] ?? 0) | ((data[7] ?? 0) << 8)) & 0x3fff;
          const vp8Height = ((data[8] ?? 0) | ((data[9] ?? 0) << 8)) & 0x3fff;
          if (simple) {
            width = vp8Width;
            height = vp8Height;
          } else if (vp8Width !== width || vp8Height !== height) {
            throw invalid("webp", "the bitstream's size differs from the canvas");
          }
          frames = 1;
        }
        break;
      }
      case "VP8L": {
        if (count === 0) simple = true;
        if (simple || (extended !== undefined && !extended.animated)) {
          if (length < 5) {
            throw invalid("webp", "the VP8L header is too short");
          }
          const data = await reader.bytes(dataAt, 5);
          if (data[0] !== 0x2f) {
            throw invalid("webp", "the VP8L signature is missing");
          }
          const bits = u32le(data, 1);
          const vp8lWidth = (bits & 0x3fff) + 1;
          const vp8lHeight = ((bits >>> 14) & 0x3fff) + 1;
          if (simple) {
            width = vp8lWidth;
            height = vp8lHeight;
            hasAlpha = ((bits >>> 28) & 1) === 1;
          } else if (vp8lWidth !== width || vp8lHeight !== height) {
            throw invalid("webp", "the bitstream's size differs from the canvas");
          }
          frames = 1;
        }
        break;
      }
      case "ANMF": {
        if (extended?.animated !== true) {
          throw invalid("webp", "an animation frame without the animation flag");
        }
        if (length < 16) {
          throw invalid("webp", "an ANMF header is too short");
        }
        const data = await reader.bytes(dataAt, 16);
        const x = u24le(data, 0) * 2;
        const y = u24le(data, 3) * 2;
        const frameWidth = u24le(data, 6) + 1;
        const frameHeight = u24le(data, 9) + 1;
        if (x + frameWidth > width || y + frameHeight > height) {
          throw invalid("webp", "a frame doesn't fit inside the canvas");
        }
        frames += 1;
        break;
      }
      case "EXIF": {
        if (length > MAX_EXIF) {
          throw invalid("webp", "the EXIF chunk is too large");
        }
        const data = await reader.bytes(dataAt, length);
        // Some writers keep JPEG's "Exif\0\0" prefix.
        const block = ascii(data, 0, 6) === "Exif\0\0" ? data.subarray(6) : data;
        Object.assign(exif, readExif(block, "webp"));
        break;
      }
      case "ICCP":
        colourProfile = true;
        break;
      case "XMP ":
        exif.other = true;
        break;
      default:
        break;
    }
    offset = dataAt + length + (length % 2);
  }

  if (extended?.animated === true && frames === 0) {
    throw invalid("webp", "an animation without frames");
  }
  if (frames === 0 || width < 1 || height < 1) {
    throw invalid("webp", "there's no image data");
  }
  const stored = { width, height };
  return {
    format: "webp",
    stored,
    // No engine applies a WebP's EXIF orientation (docs/capabilities.md),
    // so the probe ignores it too, and the file opens as browsers show it.
    oriented: stored,
    orientation: 1,
    frames,
    hasAlpha,
    decodedPixelBound: frames * width * height,
    metadata: {
      location: exif.location,
      camera: exif.camera,
      timestamps: exif.timestamps,
      thumbnail: exif.thumbnail,
      colourProfile,
      other: exif.other,
    },
    keepable: {
      title: exif.title,
      description: exif.description,
      artist: exif.artist,
      copyright: exif.copyright,
    },
  };
}
