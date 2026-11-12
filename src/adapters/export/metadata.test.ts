import { describe, expect, it } from "vitest";
import {
  exif,
  jpeg,
  jpegSegment,
  png,
  pngChunk,
  vp8,
  webp,
  webpChunk,
} from "../../../test/fixtures/image-writers.js";
import { EMPTY_KEEPABLE_METADATA } from "../../core/model/source.js";
import { probeImage } from "../probe/probe.js";
import { createWindowReader } from "../probe/window-reader.js";
import { keptExif, rewriteJpeg, rewritePng, rewriteWebp } from "./metadata.js";

const probe = (bytes: Uint8Array) => probeImage(createWindowReader(new Blob([bytes.slice()])));
const KEPT = {
  title: "Harbour, à l'aube",
  description: "Boats at first light",
  artist: "Ana Martínez",
  copyright: "© 2026",
};
/** Everything an export must never carry, in one source. */
const EVERYTHING = exif({
  orientation: 6,
  gps: true,
  make: "Camera Co",
  dateTime: "2026:11:12 10:00:00",
  thumbnail: true,
  artist: "From the source",
});
const NOTHING = {
  location: false,
  camera: false,
  timestamps: false,
  thumbnail: false,
  colourProfile: false,
  other: false,
};
const hasBytes = (haystack: Uint8Array, text: string) =>
  new TextDecoder("latin1").decode(haystack).includes(text);

describe("the JPEG rewrite", () => {
  const source = () =>
    jpeg({
      width: 8,
      height: 6,
      exif: EVERYTHING,
      iccProfile: true,
      before: [
        jpegSegment(
          0xfe,
          Array.from("a comment", (c) => c.charCodeAt(0)),
        ),
      ],
    });

  it("keeps only JFIF and the image segments when nothing is kept", async () => {
    const out = rewriteJpeg(source(), EMPTY_KEEPABLE_METADATA);
    expect(await probe(out)).toMatchObject({
      orientation: 1,
      stored: { width: 8, height: 6 },
      metadata: NOTHING,
      keepable: EMPTY_KEEPABLE_METADATA,
    });
    expect(hasBytes(out, "Exif")).toBe(false);
    expect(hasBytes(out, "a comment")).toBe(false);
    expect(hasBytes(out, "JFIF")).toBe(true);
  });

  it("writes the kept fields, and no GPS, camera, time, thumbnail or orientation", async () => {
    const out = rewriteJpeg(source(), KEPT);
    expect(await probe(out)).toMatchObject({ orientation: 1, metadata: NOTHING, keepable: KEPT });
    expect(hasBytes(out, "Camera Co")).toBe(false);
    expect(hasBytes(out, "From the source")).toBe(false);
    // The kept block has one IFD and no pointers: no GPS IFD can follow.
    const block = keptExif(KEPT);
    expect(hasBytes(block, "\x88\x25")).toBe(false);
  });
});

describe("the PNG rewrite", () => {
  const source = () =>
    png({
      width: 8,
      height: 6,
      exif: EVERYTHING,
      text: { Title: "From the source", Software: "Something" },
      extraChunks: [pngChunk("iCCP", [0x73, 0, 0]), pngChunk("tIME", [7, 234, 11, 12, 10, 0, 0])],
    });

  it("keeps only the image chunks when nothing is kept", async () => {
    const out = rewritePng(source(), EMPTY_KEEPABLE_METADATA);
    expect(await probe(out)).toMatchObject({
      orientation: 1,
      metadata: NOTHING,
      keepable: EMPTY_KEEPABLE_METADATA,
    });
    for (const type of ["eXIf", "tEXt", "iTXt", "iCCP", "tIME"])
      expect(hasBytes(out, type), type).toBe(false);
  });

  it("writes the kept fields as UTF-8 iTXt, and nothing else", async () => {
    const out = rewritePng(source(), KEPT);
    expect(await probe(out)).toMatchObject({ orientation: 1, metadata: NOTHING, keepable: KEPT });
    expect(hasBytes(out, "eXIf")).toBe(false);
  });
});

describe("the WebP rewrite", () => {
  it("drops EXIF, ICC and XMP chunks and their flags", async () => {
    const source = webp({
      canvas: { width: 8, height: 6 },
      chunks: [
        webpChunk("ICCP", [0, 0]),
        vp8(8, 6),
        webpChunk("EXIF", EVERYTHING),
        webpChunk("XMP ", [0x3c]),
      ],
    });
    source[20] = (source[20] ?? 0) | 0x20 | 0x08 | 0x04;
    const out = rewriteWebp(source);
    expect(await probe(out)).toMatchObject({ metadata: NOTHING, stored: { width: 8, height: 6 } });
    expect((out[20] ?? 0) & (0x20 | 0x08 | 0x04)).toBe(0);
  });
});
