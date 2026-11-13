import {
  type ExifOrientation,
  type ImageFormat,
  longerThan,
  MAX_METADATA_LENGTH,
} from "../../core/model/source.js";
import { invalid } from "./bytes.js";

/**
 * What the probe takes from an EXIF block: the orientation, presence flags
 * and the keepable fields, nothing else (ADR 0005).
 *
 * @internal
 */
export interface ExifSummary {
  orientation: ExifOrientation;
  location: boolean;
  camera: boolean;
  timestamps: boolean;
  thumbnail: boolean;
  other: boolean;
  title: string;
  description: string;
  artist: string;
  copyright: string;
}

/** @internal */
export function emptyExif(): ExifSummary {
  return {
    orientation: 1,
    location: false,
    camera: false,
    timestamps: false,
    thumbnail: false,
    other: false,
    title: "",
    description: "",
    artist: "",
    copyright: "",
  };
}

/**
 * An EXIF ASCII value: UTF-8 where it's valid UTF-8, as most writers now
 * store non-ASCII text, including the SDK's own; otherwise Latin-1.
 */
function asciiText(raw: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    return new TextDecoder("latin1").decode(raw);
  }
}

/** The most IFDs one EXIF block may hold, and the most entries in one IFD. */
const MAX_IFDS = 8;
const MAX_ENTRIES = 1_000;

const CAMERA_TAGS = new Set([0x010f, 0x0110, 0xa431, 0xa433, 0xa434, 0xa435, 0x927c]);
const TIMESTAMP_TAGS = new Set([0x0132, 0x9003, 0x9004, 0x9010, 0x9011, 0x9012]);
const STRUCTURE_TAGS = new Set([0x8769, 0x8825, 0xa005, 0x0201, 0x0202]);
const SIZE_OF_TYPE: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
};

/**
 * Reads the TIFF structure of an EXIF block, as found after JPEG's
 * `Exif\0\0` or in PNG's `eXIf` chunk. Every offset is checked against the
 * block, IFDs that loop are an error, and the number of IFDs and entries is
 * capped (ADR 0001).
 *
 * @internal
 */
export function readExif(block: Uint8Array, format: ImageFormat): ExifSummary {
  const summary = emptyExif();
  if (block.length < 8) {
    throw invalid(format, "the EXIF block is too short");
  }
  const little = block[0] === 0x49 && block[1] === 0x49;
  if (!little && !(block[0] === 0x4d && block[1] === 0x4d)) {
    throw invalid(format, "the EXIF byte order is unknown");
  }
  const u16 = (at: number) =>
    little
      ? (block[at] ?? 0) | ((block[at + 1] ?? 0) << 8)
      : ((block[at] ?? 0) << 8) | (block[at + 1] ?? 0);
  const u32 = (at: number) =>
    (little
      ? (block[at] ?? 0) |
        ((block[at + 1] ?? 0) << 8) |
        ((block[at + 2] ?? 0) << 16) |
        ((block[at + 3] ?? 0) << 24)
      : ((block[at] ?? 0) << 24) |
        ((block[at + 1] ?? 0) << 16) |
        ((block[at + 2] ?? 0) << 8) |
        (block[at + 3] ?? 0)) >>> 0;
  if (u16(2) !== 42) {
    throw invalid(format, "the EXIF block isn't TIFF");
  }

  const text = (type: number, count: number, valueAt: number, utf16: boolean): string => {
    const bytes = count * (SIZE_OF_TYPE[type] ?? 1);
    const at = bytes <= 4 ? valueAt : u32(valueAt);
    if (at + bytes > block.length) {
      throw invalid(format, "an EXIF value ends past the block");
    }
    const raw = block.subarray(at, at + bytes);
    const decoded = utf16 ? new TextDecoder("utf-16le").decode(raw) : asciiText(raw);
    const trimmed = decoded.replace(/\0+$/, "");
    // At most the limit's code points, never half of a surrogate pair.
    return longerThan(trimmed, MAX_METADATA_LENGTH)
      ? [...trimmed].slice(0, MAX_METADATA_LENGTH).join("")
      : trimmed;
  };

  const visited = new Set<number>();
  const queue: { offset: number; kind: "main" | "exif" | "gps" | "next" }[] = [
    { offset: u32(4), kind: "main" },
  ];
  while (queue.length > 0) {
    const { offset, kind } = queue.shift() as (typeof queue)[number];
    if (offset === 0) continue;
    if (visited.has(offset)) {
      throw invalid(format, "EXIF directories loop");
    }
    if (visited.size >= MAX_IFDS) {
      throw invalid(format, "the EXIF block has too many directories");
    }
    visited.add(offset);
    if (offset + 2 > block.length) {
      throw invalid(format, "an EXIF directory starts past the block");
    }
    const entries = u16(offset);
    if (entries > MAX_ENTRIES || offset + 2 + entries * 12 + 4 > block.length) {
      throw invalid(format, "an EXIF directory ends past the block");
    }
    if (kind === "gps" && entries > 0) {
      summary.location = true;
    }
    for (let i = 0; i < entries; i += 1) {
      const at = offset + 2 + i * 12;
      const tag = u16(at);
      const type = u16(at + 2);
      const count = u32(at + 4);
      const valueAt = at + 8;
      if (kind === "gps") continue;
      if (tag === 0x0112 && kind === "main") {
        const value = u16(valueAt);
        summary.orientation = value >= 1 && value <= 8 ? (value as ExifOrientation) : 1;
      } else if (tag === 0x8769) {
        queue.push({ offset: u32(valueAt), kind: "exif" });
      } else if (tag === 0x8825) {
        summary.location = true;
        queue.push({ offset: u32(valueAt), kind: "gps" });
      } else if (kind === "next") {
        summary.thumbnail = true;
      } else if (tag === 0x010e && type === 2) {
        summary.description = text(type, count, valueAt, false);
      } else if (tag === 0x013b && type === 2) {
        summary.artist = text(type, count, valueAt, false);
      } else if (tag === 0x8298 && type === 2) {
        summary.copyright = text(type, count, valueAt, false);
      } else if (tag === 0x9c9b && (type === 1 || type === 7)) {
        summary.title = text(1, count, valueAt, true);
      } else if (CAMERA_TAGS.has(tag)) {
        summary.camera = true;
      } else if (TIMESTAMP_TAGS.has(tag)) {
        summary.timestamps = true;
      } else if (!STRUCTURE_TAGS.has(tag)) {
        summary.other = true;
      }
    }
    if (kind === "main") {
      queue.push({ offset: u32(offset + 2 + entries * 12), kind: "next" });
    } else if (kind === "next") {
      summary.thumbnail = true;
    }
  }
  return summary;
}
