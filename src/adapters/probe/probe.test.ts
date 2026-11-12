import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  concat,
  exif,
  jpeg,
  jpegSegment,
  png,
  pngChunk,
} from "../../../test/fixtures/image-writers.js";
import { isImageError } from "../../core/errors/image-error.js";
import { probeImage } from "./probe.js";
import { createWindowReader } from "./window-reader.js";

const probe = (bytes: Uint8Array, windowSize?: number) =>
  probeImage(
    createWindowReader(new Blob([bytes.slice()]), windowSize === undefined ? {} : { windowSize }),
  );

async function failure(bytes: Uint8Array): Promise<unknown> {
  try {
    await probe(bytes);
  } catch (error) {
    return error;
  }
  throw new Error("expected the probe to fail");
}

/** A probe either succeeds or fails with one of these, never anything else. */
async function settlesSafely(bytes: Uint8Array): Promise<void> {
  try {
    await probe(bytes, 64);
  } catch (error) {
    expect(
      isImageError(error, "INVALID_IMAGE") || isImageError(error, "UNSUPPORTED_FORMAT"),
      String(error),
    ).toBe(true);
  }
}

describe("probing PNG", () => {
  it("reads the size, alpha and a still image's bound from IHDR", async () => {
    expect(await probe(png({ width: 640, height: 480, colourType: 6 }))).toMatchObject({
      format: "png",
      stored: { width: 640, height: 480 },
      oriented: { width: 640, height: 480 },
      orientation: 1,
      frames: 1,
      hasAlpha: true,
      decodedPixelBound: 640 * 480,
    });
  });

  it("counts every APNG frame, and bounds by frames × size", async () => {
    const frames = [
      { width: 10, height: 10 },
      { width: 5, height: 5, x: 5, y: 5 },
      { width: 10, height: 10 },
    ];
    expect(await probe(png({ width: 10, height: 10, frames }))).toMatchObject({
      frames: 3,
      decodedPixelBound: 300,
    });
  });

  it("rejects an acTL that declares fewer frames than the file carries", async () => {
    const frames = [
      { width: 10, height: 10 },
      { width: 10, height: 10 },
      { width: 10, height: 10 },
    ];
    expect(
      isImageError(
        await failure(png({ width: 10, height: 10, frames, declaredFrames: 1 })),
        "INVALID_IMAGE",
      ),
    ).toBe(true);
  });

  it("rejects a frame that doesn't fit inside the image", async () => {
    const frames = [{ width: 10, height: 10, x: 1 }];
    expect(
      isImageError(await failure(png({ width: 10, height: 10, frames })), "INVALID_IMAGE"),
    ).toBe(true);
  });

  it("takes the orientation and presence flags from eXIf, and keepable text from tEXt", async () => {
    const result = await probe(
      png({
        width: 40,
        height: 30,
        exif: exif({ orientation: 6, gps: true, make: "Camera Co", littleEndian: true }),
        text: { Title: "Harbour", Copyright: "© 2026", Software: "Something" },
      }),
    );
    expect(result).toMatchObject({
      stored: { width: 40, height: 30 },
      oriented: { width: 30, height: 40 },
      orientation: 6,
      metadata: { location: true, camera: true, other: true },
      keepable: { title: "Harbour", copyright: "© 2026" },
    });
  });

  it("rejects IHDR that isn't first, zero dimensions and missing image data", async () => {
    const valid = png({ width: 4, height: 4 });
    const signature = valid.subarray(0, 8);
    const ihdr = valid.subarray(8, 8 + 25);
    const rest = valid.subarray(8 + 25);
    expect(
      isImageError(
        await failure(concat([signature, pngChunk("tEXt", [65, 0, 66]), ihdr, rest])),
        "INVALID_IMAGE",
      ),
    ).toBe(true);
    expect(isImageError(await failure(png({ width: 0, height: 4 })), "INVALID_IMAGE")).toBe(true);
    const noData = concat([signature, ihdr, pngChunk("IEND")]);
    expect(isImageError(await failure(noData), "INVALID_IMAGE")).toBe(true);
  });

  it("rejects a chunk that claims more bytes than the file holds", async () => {
    const valid = png({ width: 4, height: 4 });
    const lying = valid.slice();
    // The IDAT chunk's length, claiming 2 GB.
    const idat = lying.findIndex(
      (_, i) => String.fromCharCode(...lying.subarray(i, i + 4)) === "IDAT",
    );
    lying.set([0x7f, 0xff, 0xff, 0xff], idat - 4);
    expect(isImageError(await failure(lying), "INVALID_IMAGE")).toBe(true);
  });
});

describe("probing JPEG", () => {
  it("reads the size from the frame header the scan follows", async () => {
    expect(await probe(jpeg({ width: 4000, height: 3000 }))).toMatchObject({
      format: "jpeg",
      stored: { width: 4000, height: 3000 },
      frames: 1,
      hasAlpha: false,
      decodedPixelBound: 12_000_000,
    });
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "applies EXIF orientation %i to the oriented size",
    async (orientation) => {
      const result = await probe(jpeg({ width: 400, height: 300, exif: exif({ orientation }) }));
      expect(result.orientation).toBe(orientation);
      expect(result.oriented).toEqual(
        orientation >= 5 ? { width: 300, height: 400 } : { width: 400, height: 300 },
      );
    },
  );

  it("flags location, camera, timestamps, thumbnails and profiles, and reads keepable fields", async () => {
    const result = await probe(
      jpeg({
        width: 8,
        height: 8,
        iccProfile: true,
        exif: exif({
          gps: true,
          make: "Camera Co",
          dateTime: "2026:11:12 10:00:00",
          thumbnail: true,
          description: "A harbour at dawn",
          artist: "Someone",
          copyright: "© 2026",
        }),
      }),
    );
    expect(result.metadata).toEqual({
      location: true,
      camera: true,
      timestamps: true,
      thumbnail: true,
      colourProfile: true,
      other: false,
    });
    expect(result.keepable).toMatchObject({ description: "A harbour at dawn", artist: "Someone" });
  });

  it("rejects two frame headers, a scan before a frame, and a height defined after the scan", async () => {
    const sof = jpegSegment(0xc0, [8, 0, 8, 0, 8, 1, 1, 0x11, 0]);
    expect(
      isImageError(await failure(jpeg({ width: 8, height: 8, before: [sof] })), "INVALID_IMAGE"),
    ).toBe(true);
    const scanFirst = concat([[0xff, 0xd8], jpegSegment(0xda, [1, 1, 0, 0, 63, 0]), [0xff, 0xd9]]);
    expect(isImageError(await failure(scanFirst), "INVALID_IMAGE")).toBe(true);
    expect(isImageError(await failure(jpeg({ width: 8, height: 0 })), "INVALID_IMAGE")).toBe(true);
  });

  it("rejects EXIF directories that loop", async () => {
    const looping = exif({ orientation: 6 });
    // Point IFD0's next-IFD offset back at IFD0.
    const nextAt = 8 + 2 + 12;
    looping.set([0, 0, 0, 8], nextAt);
    expect(
      isImageError(await failure(jpeg({ width: 8, height: 8, exif: looping })), "INVALID_IMAGE"),
    ).toBe(true);
  });
});

describe("unknown formats", () => {
  it.each([
    ["GIF", [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
    ["SVG", Array.from("<svg xmlns='http://www.w3.org/2000/svg'/>", (c) => c.charCodeAt(0))],
    ["empty", []],
  ])("fail closed with UNSUPPORTED_FORMAT: %s", async (_, bytes) => {
    expect(isImageError(await failure(Uint8Array.from(bytes)), "UNSUPPORTED_FORMAT")).toBe(true);
  });
});

describe("the probes are hostile-input code", () => {
  const fixtures = {
    png: png({
      width: 16,
      height: 9,
      colourType: 6,
      exif: exif({ orientation: 8, gps: true }),
      text: { Title: "x" },
    }),
    apng: png({
      width: 10,
      height: 10,
      frames: [
        { width: 10, height: 10 },
        { width: 4, height: 4, x: 6, y: 6 },
      ],
    }),
    jpeg: jpeg({
      width: 32,
      height: 24,
      iccProfile: true,
      exif: exif({ orientation: 6, thumbnail: true, artist: "a" }),
    }),
  };

  it.each(Object.entries(fixtures))(
    "settles safely when %s is truncated at every byte",
    async (_, bytes) => {
      for (let length = 0; length < bytes.length; length += 1) {
        await settlesSafely(bytes.subarray(0, length));
      }
    },
  );

  it.each(Object.entries(fixtures))("settles safely on mutated %s files", async (_, bytes) => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ at: fc.nat(bytes.length - 1), value: fc.nat(255) }), {
          minLength: 1,
          maxLength: 8,
        }),
        async (edits) => {
          const mutated = bytes.slice();
          for (const { at, value } of edits) mutated[at] = value;
          await settlesSafely(mutated);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("settles safely on random bytes behind a valid signature", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(fixtures.png.subarray(0, 8), Uint8Array.of(0xff, 0xd8, 0xff)),
        fc.uint8Array({ maxLength: 512 }),
        async (signature, tail) => {
          await settlesSafely(concat([signature, tail]));
        },
      ),
      { numRuns: 300 },
    );
  });
});
