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
 * A GIF whose only frame, 96 × 64 at the screen's corner, is larger than
 * its 48 × 32 logical screen. The SDK's probe and decoder take the frame as
 * the image (docs/adr/0011): the matrix holds that every browser does.
 */
export function gifFrameOutsideScreen(): Uint8Array {
  const bytes = fixture("large.gif").slice();
  bytes.set([...be16(48).reverse(), ...be16(32).reverse()], 6);
  return bytes;
}

/**
 * A GIF whose only frame, 96 × 64, starts 8 pixels in from the left of its
 * 96 × 64 logical screen, so it runs past the right edge. The SDK's probe
 * refuses it (docs/adr/0011): the matrix records that the browsers don't
 * agree on the image's size.
 */
export function gifFramePastScreenEdge(): Uint8Array {
  const bytes = fixture("large.gif").slice();
  // The image descriptor follows the header, a table of two colours and a
  // graphic control extension; its left position is the two bytes after 0x2c.
  const descriptor = 13 + 6 + 8;
  if (bytes[descriptor] !== 0x2c) throw new Error("large.gif isn't laid out as expected");
  bytes.set(be16(8).reverse(), descriptor + 1);
  return bytes;
}

/**
 * LZW image data for a frame of one colour index, with a two-bit minimum
 * code size: a clear code before each pixel keeps every code three bits
 * wide, so there's no table to build.
 */
function gifImageData(pixels: number, index: number): number[] {
  const codes = [...Array.from({ length: pixels }, () => [4, index]).flat(), 5];
  const bytes: number[] = [];
  let bits = 0;
  let count = 0;
  for (const code of codes) {
    bits |= code << count;
    count += 3;
    while (count >= 8) {
      bytes.push(bits & 0xff);
      bits >>>= 8;
      count -= 8;
    }
  }
  if (count > 0) bytes.push(bits & 0xff);
  return [2, bytes.length, ...bytes, 0];
}

const le16 = (v: number) => [v & 0xff, (v >>> 8) & 0xff];

/** A GIF frame of one colour index, with its disposal method. */
function gifFrame(
  left: number,
  top: number,
  width: number,
  height: number,
  index: number,
  disposal: number,
): number[] {
  return [
    ...[0x21, 0xf9, 4, disposal << 2, 10, 0, 0, 0],
    ...[0x2c, ...le16(left), ...le16(top), ...le16(width), ...le16(height), 0],
    ...gifImageData(width * height, index),
  ];
}

/**
 * An 8 × 8 GIF whose colour table is red and blue, with blue as its
 * background colour. Its frames are red, opaque, and never reach the
 * bottom-right pixel in the frame the matrix reads: that pixel shows what a
 * browser puts where no frame draws, and after a frame is disposed of
 * (docs/adr/0011).
 *
 * - `"first frame"`: one frame, the top-left 4 × 4.
 * - `"after disposal 2"`: a frame over the whole screen, disposed of by
 *   restoring the background, then the top-left 4 × 4.
 */
export function gifWithBackground(frames: "first frame" | "after disposal 2"): Uint8Array {
  return Uint8Array.from([
    ...latin1("GIF89a"),
    ...le16(8),
    ...le16(8),
    // A global colour table of two colours, and background colour index 1.
    ...[0x80, 1, 0],
    ...[0xff, 0, 0, 0, 0, 0xff],
    ...(frames === "after disposal 2" ? gifFrame(0, 0, 8, 8, 0, 2) : []),
    ...gifFrame(0, 0, 4, 4, 0, 1),
    0x3b,
  ]);
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

/** The four-colour PNG with an `eXIf` chunk, before or after `IDAT`. */
export function quadrantsPng(orientation: number, place: "before IDAT" | "after IDAT"): Uint8Array {
  const png = fixture("quadrants.png");
  const chunk = pngChunk("eXIf", exif({ orientation }));
  // IEND is the last 12 bytes; the encoder writes IHDR and then IDAT.
  const at = place === "before IDAT" ? 8 + 8 + 13 + 4 : png.length - 12;
  return concat([png.subarray(0, at), chunk, png.subarray(at)]);
}

/**
 * The four-colour PNG with a cICP chunk after IHDR: BT.709 primaries and
 * sRGB's transfer, which decodes as the image does, and which the probe
 * reports as a colour profile.
 */
export function quadrantsPngWithColourProfile(): Uint8Array {
  const png = fixture("quadrants.png");
  const at = 8 + 8 + 13 + 4;
  return concat([png.subarray(0, at), pngChunk("cICP", [1, 13, 0, 1]), png.subarray(at)]);
}

/** The four-colour JPEG with EXIF orientation in APP1. */
export function quadrantsJpeg(orientation: number): Uint8Array {
  return afterSoi(fixture("quadrants.jpg"), [
    segment(0xe1, concat([latin1("Exif\0\0"), exif({ orientation })])),
  ]);
}

/** The four-colour lossless WebP in an extended file with an EXIF orientation. */
export function quadrantsWebp(orientation: number): Uint8Array {
  return webp({
    canvas: { width: 48, height: 32 },
    chunks: [fixture("quadrants.webp").subarray(12), webpChunk("EXIF", exif({ orientation }))],
  });
}

/** The primary JPEG with a location, a camera and a timestamp: what an export removes. */
export function jpegWithPrivateMetadata(): Uint8Array {
  return afterSoi(fixture("primary.jpg"), [
    segment(
      0xe1,
      concat([
        latin1("Exif\0\0"),
        exif({ gps: true, make: "Camera", dateTime: "2026:11:13 18:00:00" }),
      ]),
    ),
  ]);
}
