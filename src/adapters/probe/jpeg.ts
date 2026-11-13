import type { WindowReader } from "@hussmartinez/sdk-core";
import { orientedSize } from "../../core/model/geometry.js";
import type { ImageProbe } from "../../core/model/source.js";
import { ascii, exact, invalid, u16be } from "./bytes.js";
import { emptyExif, readExif } from "./exif.js";

/** JPEG's start-of-image marker. */
export const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const;

/** The most segments before the first scan; real files have tens. */
const MAX_SEGMENTS = 10_000;

/** Start-of-frame markers: C0–CF, except DHT (C4), JPG (C8) and DAC (CC). */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/**
 * Probes a JPEG file by walking every marker segment up to the first scan
 * (ADR 0001). Its dimensions come from the frame header the scan follows,
 * never from EXIF. Orientation and presence flags come from `APP1` EXIF and
 * XMP, `APP2` ICC profiles and comments. Entropy-coded data is never read.
 * Secondary images (MPF, gain maps) and EXIF thumbnails are flagged; ADR
 * 0001's capability matrix checks that browsers decode only the primary.
 *
 * @internal
 */
export async function probeJpeg(reader: WindowReader): Promise<ImageProbe> {
  let offset = 2;
  let frame: { width: number; height: number; components: number } | undefined;
  let sawScan = false;
  const exif = emptyExif();
  let sawExif = false;
  let colourProfile = false;

  for (let count = 0; !sawScan; count += 1) {
    if (count >= MAX_SEGMENTS) {
      throw invalid("jpeg", "the file has too many segments");
    }
    const head = await exact(reader, "jpeg", offset, 2, "a marker");
    if (head[0] !== 0xff) {
      throw invalid("jpeg", "a marker is missing");
    }
    const marker = head[1] ?? 0;
    if (marker === 0xff) {
      // Fill bytes before a marker: skip one, always advancing.
      offset += 1;
      continue;
    }
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      (marker >= 0xd0 && marker <= 0xd7) ||
      marker === 0x01
    ) {
      if (marker === 0xd9) {
        throw invalid("jpeg", "the image ends before its first scan");
      }
      offset += 2;
      continue;
    }
    const lengthBytes = await exact(reader, "jpeg", offset + 2, 2, "a segment length");
    const length = u16be(lengthBytes, 0);
    if (length < 2) {
      throw invalid("jpeg", "a segment length is out of range");
    }
    const dataAt = offset + 4;
    const dataLength = length - 2;
    if (dataAt + dataLength > reader.size) {
      throw invalid("jpeg", "a segment ends past the end of the file");
    }

    if (isStartOfFrame(marker)) {
      if (frame !== undefined) {
        throw invalid("jpeg", "there's more than one frame header before the scan");
      }
      if (dataLength < 6) {
        throw invalid("jpeg", "the frame header is too short");
      }
      const data = await reader.bytes(dataAt, dataLength);
      const height = u16be(data, 1);
      const width = u16be(data, 3);
      const components = data[5] ?? 0;
      if (height === 0) {
        throw invalid("jpeg", "the height is only defined after the scan");
      }
      if (width === 0 || components < 1 || components > 4 || dataLength < 6 + components * 3) {
        throw invalid("jpeg", "the frame header is invalid");
      }
      frame = { width, height, components };
    } else if (marker === 0xda) {
      if (frame === undefined) {
        throw invalid("jpeg", "the scan comes before a frame header");
      }
      sawScan = true;
    } else if (marker === 0xe1 && dataLength >= 6) {
      const data = await reader.bytes(dataAt, Math.min(dataLength, 64));
      if (ascii(data, 0, 6) === "Exif\0\0") {
        if (sawExif) {
          exif.other = true;
        } else {
          sawExif = true;
          const parsed = readExif((await reader.bytes(dataAt, dataLength)).subarray(6), "jpeg");
          Object.assign(exif, parsed);
        }
      } else {
        // XMP and other APP1 payloads: presence only.
        exif.other = true;
      }
    } else if (marker === 0xe2 && dataLength >= 12) {
      const data = await reader.bytes(dataAt, 12);
      if (ascii(data, 0, 12) === "ICC_PROFILE\0") {
        colourProfile = true;
      } else {
        exif.other = true;
      }
    } else if ((marker >= 0xe3 && marker <= 0xef) || marker === 0xfe) {
      // Other APPn segments (such as Photoshop's
      // APP13 and Ultra HDR's gain map metadata) and comments.
      exif.other = true;
    }
    offset = dataAt + dataLength;
  }

  const stored = { width: frame?.width ?? 0, height: frame?.height ?? 0 };
  const oriented = orientedSize(stored, exif.orientation);
  return {
    format: "jpeg",
    stored,
    oriented,
    orientation: exif.orientation,
    frames: 1,
    hasAlpha: false,
    decodedPixelBound: stored.width * stored.height,
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
