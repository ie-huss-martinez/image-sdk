import type { ImageKeepableMetadata } from "../../core/model/source.js";

/**
 * The SDK's own minimal metadata writers (docs/adr/0005). An export is the
 * encoder's image data and nothing else, plus only the fields the user
 * kept: every other segment or chunk the browser's encoder wrote, such as
 * an ICC profile, is removed, and no orientation, location, camera detail,
 * timestamp or thumbnail is ever written.
 */

const utf8 = (text: string) => new TextEncoder().encode(text);
const latin1 = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
const be16 = (v: number) => [(v >>> 8) & 0xff, v & 0xff];
const be32 = (v: number) => [...be16(v >>> 16), ...be16(v & 0xffff)];

function concat(parts: readonly (Uint8Array | readonly number[])[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const kept = (metadata: ImageKeepableMetadata) =>
  Object.values(metadata).some((value) => value !== "");

/**
 * A big-endian TIFF block with one IFD of the kept fields only: title as
 * Windows' `XPTitle` in UTF-16, and description, artist and copyright as
 * `ImageDescription`, `Artist` and `Copyright`, in UTF-8. No sub-IFDs, so no
 * GPS, EXIF or thumbnail IFD can exist.
 */
export function keptExif(metadata: ImageKeepableMetadata): Uint8Array {
  const entries: { tag: number; type: number; value: Uint8Array }[] = [];
  if (metadata.description) {
    entries.push({ tag: 0x010e, type: 2, value: concat([utf8(metadata.description), [0]]) });
  }
  if (metadata.artist) {
    entries.push({ tag: 0x013b, type: 2, value: concat([utf8(metadata.artist), [0]]) });
  }
  if (metadata.copyright) {
    entries.push({ tag: 0x8298, type: 2, value: concat([utf8(metadata.copyright), [0]]) });
  }
  if (metadata.title) {
    // UTF-16 code units, so characters outside the BMP keep both surrogates.
    const utf16: number[] = [];
    for (let i = 0; i < metadata.title.length; i += 1) {
      const unit = metadata.title.charCodeAt(i);
      utf16.push(unit & 0xff, unit >>> 8);
    }
    utf16.push(0, 0);
    entries.push({ tag: 0x9c9b, type: 1, value: Uint8Array.from(utf16) });
  }
  const ifdSize = 2 + entries.length * 12 + 4;
  let dataAt = 8 + ifdSize;
  const ifd: number[] = [...be16(entries.length)];
  const data: Uint8Array[] = [];
  for (const { tag, type, value } of entries) {
    ifd.push(...be16(tag), ...be16(type), ...be32(value.length));
    if (value.length <= 4) {
      ifd.push(...value, ...new Array(4 - value.length).fill(0));
    } else {
      ifd.push(...be32(dataAt));
      data.push(value);
      dataAt += value.length + (value.length % 2);
      if (value.length % 2) data.push(Uint8Array.of(0));
    }
  }
  ifd.push(...be32(0));
  return concat([latin1("MM"), be16(42), be32(8), ifd, ...data]);
}

/**
 * A JPEG with only `SOI`, a JFIF `APP0` if the encoder wrote one, the kept
 * fields in an `APP1` EXIF segment, and the image segments from the first
 * non-`APPn`, non-`COM` marker on.
 */
export function rewriteJpeg(jpeg: Uint8Array, metadata: ImageKeepableMetadata): Uint8Array {
  const parts: Uint8Array[] = [jpeg.subarray(0, 2)];
  let at = 2;
  let app1Written = false;
  const writeApp1 = () => {
    if (app1Written || !kept(metadata)) return;
    app1Written = true;
    const payload = concat([latin1("Exif\0\0"), keptExif(metadata)]);
    parts.push(concat([[0xff, 0xe1, ...be16(payload.length + 2)], payload]));
  };
  while (at + 4 <= jpeg.length && jpeg[at] === 0xff) {
    const marker = jpeg[at + 1] ?? 0;
    const isApp = marker >= 0xe0 && marker <= 0xef;
    if (!isApp && marker !== 0xfe) break;
    const length = ((jpeg[at + 2] ?? 0) << 8) | (jpeg[at + 3] ?? 0);
    const segment = jpeg.subarray(at, at + 2 + length);
    // Keep only a JFIF APP0; Firefox refuses an APP1 before it (docs/adr/0005).
    if (marker === 0xe0 && String.fromCharCode(...segment.subarray(4, 9)) === "JFIF\0") {
      parts.push(segment);
    }
    at += 2 + length;
  }
  writeApp1();
  parts.push(jpeg.subarray(at));
  return concat(parts);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typed = concat([latin1(type), data]);
  let c = 0xffffffff;
  for (const byte of typed) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return concat([be32(data.length), typed, be32((c ^ 0xffffffff) >>> 0)]);
}

/** The image chunks of a PNG: everything else, text, time, profiles and EXIF, is dropped. */
const PNG_IMAGE_CHUNKS = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);
const PNG_KEYWORDS: Record<keyof ImageKeepableMetadata, string> = {
  title: "Title",
  description: "Description",
  artist: "Author",
  copyright: "Copyright",
};

/**
 * A PNG with only its image chunks, and the kept fields as uncompressed
 * UTF-8 `iTXt` chunks straight after `IHDR`.
 */
export function rewritePng(png: Uint8Array, metadata: ImageKeepableMetadata): Uint8Array {
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  let at = 8;
  while (at + 12 <= png.length) {
    const length =
      (((png[at] ?? 0) << 24) |
        ((png[at + 1] ?? 0) << 16) |
        ((png[at + 2] ?? 0) << 8) |
        (png[at + 3] ?? 0)) >>>
      0;
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const end = at + 12 + length;
    if (PNG_IMAGE_CHUNKS.has(type)) parts.push(png.subarray(at, end));
    if (type === "IHDR") {
      for (const [field, keyword] of Object.entries(PNG_KEYWORDS)) {
        const value = metadata[field as keyof ImageKeepableMetadata];
        if (value) {
          parts.push(pngChunk("iTXt", concat([latin1(keyword), [0, 0, 0, 0, 0], utf8(value)])));
        }
      }
    }
    at = end;
  }
  return concat(parts);
}

/**
 * A WebP with only its image chunks. WebP exports carry no metadata in the
 * first releases (docs/adr/0005), so an extended file loses its ICC, EXIF
 * and XMP chunks and their flags.
 */
export function rewriteWebp(webp: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let at = 12;
  while (at + 8 <= webp.length) {
    const type = String.fromCharCode(...webp.subarray(at, at + 4));
    const length =
      ((webp[at + 4] ?? 0) |
        ((webp[at + 5] ?? 0) << 8) |
        ((webp[at + 6] ?? 0) << 16) |
        ((webp[at + 7] ?? 0) << 24)) >>>
      0;
    const end = at + 8 + length + (length % 2);
    const chunk = webp.slice(at, end);
    if (type === "VP8X") {
      // Clear the ICC (0x20), EXIF (0x08) and XMP (0x04) flags.
      chunk[8] = (chunk[8] ?? 0) & ~(0x20 | 0x08 | 0x04);
      chunks.push(chunk);
    } else if (
      type === "VP8 " ||
      type === "VP8L" ||
      type === "ALPH" ||
      type === "ANIM" ||
      type === "ANMF"
    ) {
      chunks.push(chunk);
    }
    at = end;
  }
  const body = concat([latin1("WEBP"), ...chunks]);
  const size = body.length;
  return concat([
    latin1("RIFF"),
    [size & 0xff, (size >>> 8) & 0xff, (size >>> 16) & 0xff, size >>> 24],
    body,
  ]);
}
