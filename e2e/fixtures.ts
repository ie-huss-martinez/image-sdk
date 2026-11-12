import { readFileSync } from "node:fs";
import { concat, exif, pngChunk, webp, webpChunk } from "../test/fixtures/image-writers.js";

/**
 * The encoded images of the capability matrix: real encoders' output from
 * tools/generate-capability-fixtures.sh, and files assembled from it here,
 * whose structure no encoder writes on request. The primary image is always
 * red, and every secondary image blue and larger, so the matrix can tell
 * which one a browser decoded.
 */
export const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

const latin1 = (text: string) => Array.from(text, (c) => c.charCodeAt(0) & 0xff);
const be16 = (v: number) => [(v >>> 8) & 0xff, v & 0xff];
const be32 = (v: number) => [...be16(v >>> 16), ...be16(v & 0xffff)];

function segment(marker: number, data: readonly number[] | Uint8Array): Uint8Array {
  return concat([[0xff, marker, ...be16(data.length + 2)], data]);
}

/** Inserts segments straight after a JPEG's SOI marker. */
function afterSoi(jpeg: Uint8Array, segments: readonly Uint8Array[]): Uint8Array {
  return concat([jpeg.subarray(0, 2), ...segments, jpeg.subarray(2)]);
}

/** The primary JPEG with EXIF orientation 6: upright, it's 32 × 48. */
export function jpegRotated(): Uint8Array {
  return afterSoi(fixture("primary.jpg"), [
    segment(0xe1, concat([latin1("Exif\0\0"), exif({ orientation: 6 })])),
  ]);
}

/** The primary JPEG with a larger, blue EXIF thumbnail in IFD1. */
export function jpegWithExifThumbnail(): Uint8Array {
  const thumbnail = fixture("secondary.jpg");
  const ifd0 = [...be16(1), ...be16(0x0112), ...be16(3), ...be32(1), ...be16(1), 0, 0, ...be32(26)];
  const ifd1At = 26;
  const thumbnailAt = ifd1At + 2 + 3 * 12 + 4;
  const ifd1 = [
    ...be16(3),
    ...[...be16(0x0103), ...be16(3), ...be32(1), ...be16(6), 0, 0],
    ...[...be16(0x0201), ...be16(4), ...be32(1), ...be32(thumbnailAt)],
    ...[...be16(0x0202), ...be16(4), ...be32(1), ...be32(thumbnail.length)],
    ...be32(0),
  ];
  const tiff = concat([latin1("MM"), be16(42), be32(8), ifd0, ifd1, thumbnail]);
  return afterSoi(fixture("primary.jpg"), [segment(0xe1, concat([latin1("Exif\0\0"), tiff]))]);
}

/**
 * A Multi-Picture Format file: the primary JPEG, with an `MPF` APP2 segment
 * listing a second, larger blue JPEG appended after it, as cameras store
 * previews and as Ultra HDR stores its gain map.
 */
function multiPicture(
  primaryJpeg: Uint8Array,
  secondary: Uint8Array,
  secondaryAttribute: number,
  before: readonly Uint8Array[] = [],
): Uint8Array {
  const build = (primarySize: number, tiffAt: number) => {
    const entriesAt = 8 + 2 + 3 * 12 + 4;
    const tiff = [
      ...latin1("MM"),
      ...be16(42),
      ...be32(8),
      ...be16(3),
      ...[...be16(0xb000), ...be16(7), ...be32(4), ...latin1("0100")],
      ...[...be16(0xb001), ...be16(4), ...be32(1), ...be32(2)],
      ...[...be16(0xb002), ...be16(7), ...be32(32), ...be32(entriesAt)],
      ...be32(0),
      ...[...be32(0x20030000), ...be32(primarySize), ...be32(0), 0, 0, 0, 0],
      ...[
        ...be32(secondaryAttribute),
        ...be32(secondary.length),
        ...be32(primarySize - tiffAt),
        0,
        0,
        0,
        0,
      ],
    ];
    return afterSoi(primaryJpeg, [...before, segment(0xe2, concat([latin1("MPF\0"), tiff]))]);
  };
  // Sizes and offsets don't change the segment's length, so measure, then build.
  const draft = build(0, 0);
  const tiffAt = 2 + before.reduce((sum, s) => sum + s.length, 0) + 4 + 4;
  return concat([build(draft.length, tiffAt), secondary]);
}

/** A camera-style MPF file whose second image is a large preview. */
export function jpegWithMpfPreview(): Uint8Array {
  return multiPicture(fixture("primary.jpg"), fixture("secondary.jpg"), 0x00010001);
}

const xmp = (description: string) =>
  segment(
    0xe1,
    concat([
      latin1("http://ns.adobe.com/xap/1.0/\0"),
      latin1(
        `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">${description}</rdf:RDF></x:xmpmeta>`,
      ),
    ]),
  );

/**
 * An Ultra HDR file: the SDR primary with `hdrgm` XMP and a Container
 * directory, and a gain-map JPEG with its own `hdrgm` XMP, listed in MPF.
 */
export function jpegUltraHdr(): Uint8Array {
  const gainMap = afterSoi(fixture("secondary.jpg"), [
    xmp(
      '<rdf:Description xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" hdrgm:Version="1.0" hdrgm:GainMapMin="0" hdrgm:GainMapMax="2" hdrgm:Gamma="1" hdrgm:OffsetSDR="0" hdrgm:OffsetHDR="0" hdrgm:HDRCapacityMin="0" hdrgm:HDRCapacityMax="2" hdrgm:BaseRenditionIsHDR="False"/>',
    ),
  ]);
  const primaryXmp = xmp(
    `<rdf:Description xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="http://ns.google.com/photos/1.0/container/item/" xmlns:hdrgm="http://ns.adobe.com/hdr-gain-map/1.0/" hdrgm:Version="1.0"><Container:Directory><rdf:Seq><rdf:li rdf:parseType="Resource"><Container:Item Item:Semantic="Primary" Item:Mime="image/jpeg"/></rdf:li><rdf:li rdf:parseType="Resource"><Container:Item Item:Semantic="GainMap" Item:Mime="image/jpeg" Item:Length="${gainMap.length}"/></rdf:li></rdf:Seq></Container:Directory></rdf:Description>`,
  );
  return multiPicture(fixture("primary.jpg"), gainMap, 0, [primaryXmp]);
}

/**
 * A GIF whose only frame, 96 × 64, overflows its 48 × 32 logical screen,
 * which the SDK's probe refuses (ADR 0001): the matrix records what each
 * browser does with it.
 */
export function gifFrameOutsideScreen(): Uint8Array {
  const bytes = fixture("large.gif").slice();
  bytes.set([...be16(48).reverse(), ...be16(32).reverse()], 6);
  return bytes;
}

/** The primary PNG with an `eXIf` chunk after `IHDR` giving orientation 6: upright, it's 32 × 48. */
export function pngRotated(): Uint8Array {
  const png = fixture("primary.png");
  const afterIhdr = 8 + 8 + 13 + 4;
  return concat([
    png.subarray(0, afterIhdr),
    pngChunk("eXIf", exif({ orientation: 6 })),
    png.subarray(afterIhdr),
  ]);
}

/** The lossless WebP's bitstream in an extended file with EXIF orientation 6: upright, 32 × 48. */
export function webpRotated(): Uint8Array {
  const simple = fixture("primary-lossless.webp");
  return webp({
    canvas: { width: 48, height: 32 },
    chunks: [simple.subarray(12), webpChunk("EXIF", exif({ orientation: 6 }))],
  });
}
