import { orientedSize } from "../../core/model/geometry.js";
import { type ImageProbe, MAX_METADATA_LENGTH } from "../../core/model/source.js";
import { ascii, exact, invalid, u32be } from "./bytes.js";
import { emptyExif, readExif } from "./exif.js";
import type { WindowReader } from "./window-reader.js";

/** PNG's eight signature bytes. */
export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** The largest width or height PNG allows. */
const MAX_SIDE = 2 ** 31 - 1;
/** The most chunks a file may have; real files have tens. */
const MAX_CHUNKS = 100_000;
/** The largest chunk whose contents the probe reads: eXIf and text chunks. */
const MAX_READ_CHUNK = 1 << 20;

const KEEPABLE_TEXT: Record<string, "title" | "description" | "artist" | "copyright"> = {
  Title: "title",
  Description: "description",
  Author: "artist",
  Copyright: "copyright",
};

/**
 * Probes a PNG or APNG file by walking every chunk header (ADR 0001):
 * dimensions from `IHDR`, which must come first; frames from `acTL`,
 * cross-checked against every `fcTL`, each of which must fit inside
 * `IHDR`; presence flags from `eXIf`, text chunks, `iCCP` and `tIME`, and
 * the orientation from an `eXIf` before `IDAT` only, as browsers read it.
 * Image data is never decompressed.
 *
 * @internal
 */
export async function probePng(reader: WindowReader): Promise<ImageProbe> {
  let offset = 8;
  let width = 0;
  let height = 0;
  let hasAlpha = false;
  let declaredFrames: number | undefined;
  let frameControls = 0;
  let sawData = false;
  let sawEnd = false;
  const exif = emptyExif();
  let colourProfile = false;

  for (let count = 0; !sawEnd; count += 1) {
    if (count >= MAX_CHUNKS) {
      throw invalid("png", "the file has too many chunks");
    }
    const header = await exact(reader, "png", offset, 8, "a chunk header");
    const length = u32be(header, 0);
    const type = ascii(header, 4, 4);
    if (length > 0x7fffffff) {
      throw invalid("png", "a chunk length is out of range");
    }
    const dataAt = offset + 8;
    if (dataAt + length + 4 > reader.size) {
      throw invalid("png", "a chunk ends past the end of the file");
    }
    if (count === 0 && type !== "IHDR") {
      throw invalid("png", "IHDR isn't the first chunk");
    }
    const read = async () => {
      if (length > MAX_READ_CHUNK) {
        throw invalid("png", `the ${type} chunk is too large`);
      }
      return reader.bytes(dataAt, length);
    };

    switch (type) {
      case "IHDR": {
        if (count !== 0 || length !== 13) {
          throw invalid("png", "IHDR is repeated or the wrong size");
        }
        const data = await read();
        width = u32be(data, 0);
        height = u32be(data, 4);
        if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) {
          throw invalid("png", "the dimensions are out of range");
        }
        const colourType = data[9];
        hasAlpha = colourType === 4 || colourType === 6;
        break;
      }
      case "acTL": {
        if (sawData || declaredFrames !== undefined || length !== 8) {
          throw invalid("png", "acTL is misplaced, repeated or the wrong size");
        }
        declaredFrames = u32be(await read(), 0);
        if (declaredFrames < 1) {
          throw invalid("png", "acTL declares no frames");
        }
        break;
      }
      case "fcTL": {
        if (length !== 26) {
          throw invalid("png", "an fcTL is the wrong size");
        }
        const data = await read();
        const frameWidth = u32be(data, 4);
        const frameHeight = u32be(data, 8);
        const x = u32be(data, 12);
        const y = u32be(data, 16);
        if (
          frameWidth < 1 ||
          frameHeight < 1 ||
          x + frameWidth > width ||
          y + frameHeight > height
        ) {
          throw invalid("png", "a frame doesn't fit inside the image");
        }
        frameControls += 1;
        break;
      }
      case "IDAT":
        sawData = true;
        break;
      case "tRNS":
        hasAlpha = true;
        break;
      case "iCCP":
      case "sRGB":
      case "cICP":
        colourProfile = colourProfile || type !== "sRGB";
        break;
      case "tIME":
        exif.timestamps = true;
        break;
      case "eXIf": {
        const parsed = readExif(await read(), "png");
        Object.assign(exif, {
          ...parsed,
          // Browsers apply an eXIf orientation only before the image data
          // (docs/capabilities.md), so the probe does the same.
          orientation: sawData ? exif.orientation : parsed.orientation,
          title: exif.title || parsed.title,
          description: exif.description || parsed.description,
          artist: exif.artist || parsed.artist,
          copyright: exif.copyright || parsed.copyright,
        });
        break;
      }
      case "tEXt":
      case "iTXt":
      case "zTXt": {
        const data = await read();
        const keywordEnd = data.indexOf(0);
        const keyword = ascii(data, 0, keywordEnd < 0 ? Math.min(data.length, 79) : keywordEnd);
        const field = KEEPABLE_TEXT[keyword];
        if (field === undefined) {
          exif.other = true;
        } else if (type === "tEXt" && keywordEnd >= 0) {
          exif[field] = new TextDecoder("latin1")
            .decode(data.subarray(keywordEnd + 1))
            .slice(0, MAX_METADATA_LENGTH);
        } else if (type === "iTXt" && keywordEnd >= 0 && data[keywordEnd + 1] === 0) {
          // Uncompressed iTXt: keyword, flag, method, language\0, translated keyword\0, text.
          let at = keywordEnd + 3;
          for (let nulls = 0; nulls < 2 && at < data.length; at += 1) {
            if (data[at] === 0) nulls += 1;
          }
          exif[field] = new TextDecoder().decode(data.subarray(at)).slice(0, MAX_METADATA_LENGTH);
        } else {
          exif.other = true;
        }
        break;
      }
      case "IEND":
        sawEnd = true;
        break;
      default:
        break;
    }
    offset = dataAt + length + 4;
  }

  if (!sawData) {
    throw invalid("png", "there's no image data");
  }
  if (declaredFrames !== undefined && frameControls !== declaredFrames) {
    throw invalid("png", "acTL's frame count doesn't match the frames");
  }
  const frames = declaredFrames ?? 1;
  const stored = { width, height };
  const oriented = orientedSize(stored, exif.orientation);
  return {
    format: "png",
    stored,
    oriented,
    orientation: exif.orientation,
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
