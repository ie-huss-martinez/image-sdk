import { createWindowReader } from "@hussmartinez/sdk-core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ALPHA_AUX,
  anmf,
  auxC,
  bmp,
  box,
  clap,
  concat,
  exif,
  GAIN_MAP_AUX,
  gif,
  gridData,
  heif,
  heifExif,
  imir,
  irot,
  jpeg,
  jpegSegment,
  png,
  pngChunk,
  vp8,
  vp8l,
  webp,
  webpChunk,
} from "../../../test/fixtures/image-writers.js";
import { isImageError } from "../../core/errors/image-error.js";
import { probeImage } from "./probe.js";

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

  it("ignores the orientation of an eXIf after the image data, as browsers do, but keeps its flags", async () => {
    const still = png({ width: 40, height: 30 });
    const bytes = concat([
      still.subarray(0, still.length - 12),
      pngChunk("eXIf", exif({ orientation: 6, gps: true })),
      still.subarray(still.length - 12),
    ]);
    expect(await probe(bytes)).toMatchObject({
      oriented: { width: 40, height: 30 },
      orientation: 1,
      metadata: { location: true },
    });
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
      // The stored frame, and one upright frame for the worker's transform.
      decodedPixelBound: 2 * 40 * 30,
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

  it("keeps at most 2,000 code points of a field, never half of a surrogate pair", async () => {
    const result = await probe(
      jpeg({ width: 8, height: 8, exif: exif({ xpTitle: "📷".repeat(2_001) }) }),
    );
    expect(result.keepable.title).toBe("📷".repeat(2_000));
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

describe("probing WebP", () => {
  it("reads a lossy file's size from the VP8 frame header", async () => {
    const result = await probe(webp({ simple: vp8(30, 20) }));
    expect(result).toMatchObject({
      format: "webp",
      stored: { width: 30, height: 20 },
      frames: 1,
      hasAlpha: false,
      decodedPixelBound: 600,
    });
  });

  it("reads a lossless file's size and alpha from the VP8L header", async () => {
    const result = await probe(webp({ simple: vp8l(7, 5, true) }));
    expect(result).toMatchObject({ stored: { width: 7, height: 5 }, hasAlpha: true });
  });

  it("takes an extended file's size from the canvas, and flags but not orientation from EXIF", async () => {
    const result = await probe(
      webp({
        canvas: { width: 30, height: 20, alpha: true },
        chunks: [
          webpChunk("ICCP", [0, 0, 0, 0]),
          vp8(30, 20),
          webpChunk(
            "EXIF",
            concat([
              Array.from("Exif\0\0", (c) => c.charCodeAt(0)),
              exif({ orientation: 6, gps: true, artist: "Ana" }),
            ]),
          ),
        ],
      }),
    );
    expect(result).toMatchObject({
      stored: { width: 30, height: 20 },
      oriented: { width: 30, height: 20 },
      orientation: 1,
      hasAlpha: true,
      metadata: { location: true, colourProfile: true },
      keepable: { artist: "Ana" },
    });
  });

  it("rejects a bitstream whose size differs from the canvas", async () => {
    const bytes = webp({ canvas: { width: 30, height: 20 }, chunks: [vp8(31, 20)] });
    expect(isImageError(await failure(bytes), "INVALID_IMAGE")).toBe(true);
  });

  it("counts every animation frame, and bounds by frames × canvas", async () => {
    const result = await probe(
      webp({
        canvas: { width: 10, height: 10, animated: true },
        chunks: [anmf({ width: 10, height: 10 }), anmf({ width: 4, height: 4, x: 6, y: 6 })],
      }),
    );
    expect(result).toMatchObject({ frames: 2, decodedPixelBound: 200 });
  });

  it.each([
    [
      "a frame outside the canvas",
      webp({
        canvas: { width: 10, height: 10, animated: true },
        chunks: [anmf({ width: 4, height: 4, x: 8 })],
      }),
    ],
    [
      "a frame without the animation flag",
      webp({ canvas: { width: 10, height: 10 }, chunks: [anmf({ width: 10, height: 10 })] }),
    ],
    ["an animation without frames", webp({ canvas: { width: 10, height: 10, animated: true } })],
    ["an extended file without image data", webp({ canvas: { width: 10, height: 10 } })],
    [
      "a first chunk that isn't an image header",
      webp({ chunks: [webpChunk("ICCP", [0, 0]), vp8(2, 2)] }),
    ],
    [
      "a VP8 chunk without its start code",
      webp({ simple: webpChunk("VP8 ", new Array(10).fill(0)) }),
    ],
  ])("rejects %s", async (_, bytes) => {
    expect(isImageError(await failure(bytes), "INVALID_IMAGE")).toBe(true);
  });

  it("rejects a RIFF size larger than the file", async () => {
    const bytes = webp({ simple: vp8(2, 2) });
    bytes[4] = 0xff;
    expect(isImageError(await failure(bytes), "INVALID_IMAGE")).toBe(true);
  });
});

describe("probing GIF", () => {
  it("reads the logical screen, counts frames, and bounds by frames × screen", async () => {
    const result = await probe(
      gif({
        width: 12,
        height: 8,
        transparent: true,
        frames: [
          { width: 12, height: 8 },
          { width: 2, height: 2, x: 10, y: 6 },
          { width: 1, height: 1 },
        ],
      }),
    );
    expect(result).toMatchObject({
      format: "gif",
      stored: { width: 12, height: 8 },
      orientation: 1,
      frames: 3,
      hasAlpha: true,
      decodedPixelBound: 288,
      metadata: { other: false },
    });
  });

  it("flags comments as other metadata", async () => {
    const result = await probe(
      gif({ width: 1, height: 1, comment: "hi", frames: [{ width: 1, height: 1 }] }),
    );
    expect(result.metadata.other).toBe(true);
  });

  it.each([
    [
      "a frame outside the screen",
      gif({ width: 4, height: 4, frames: [{ width: 2, height: 2, x: 3 }] }),
    ],
    ["no frames", gif({ width: 4, height: 4, frames: [] })],
    [
      "an LZW code size above 8",
      gif({ width: 4, height: 4, codeSize: 9, frames: [{ width: 4, height: 4 }] }),
    ],
    ["an empty screen", gif({ width: 0, height: 4, frames: [] })],
  ])("rejects %s", async (_, bytes) => {
    expect(isImageError(await failure(bytes), "INVALID_IMAGE")).toBe(true);
  });

  it("rejects a file without its trailer", async () => {
    const bytes = gif({ width: 4, height: 4, frames: [{ width: 4, height: 4 }] });
    expect(isImageError(await failure(bytes.subarray(0, bytes.length - 1)), "INVALID_IMAGE")).toBe(
      true,
    );
  });
});

describe("probing BMP", () => {
  it("reads the size from BITMAPINFOHEADER, with top-down rows", async () => {
    const result = await probe(bmp({ width: 5, height: -3, bitCount: 32 }));
    expect(result).toMatchObject({
      format: "bmp",
      stored: { width: 5, height: 3 },
      frames: 1,
      hasAlpha: true,
      decodedPixelBound: 15,
    });
  });

  it("reads BITMAPCOREHEADER and a V5 header's embedded profile", async () => {
    expect((await probe(bmp({ width: 4, height: 2, headerSize: 12 }))).stored).toEqual({
      width: 4,
      height: 2,
    });
    const v5 = await probe(bmp({ width: 4, height: 2, headerSize: 124, embeddedProfile: true }));
    expect(v5.metadata.colourProfile).toBe(true);
  });

  it.each([
    ["pixel data past the end of the file", bmp({ width: 4, height: 2, dataOffset: 4096 })],
    ["pixel data inside the headers", bmp({ width: 4, height: 2, dataOffset: 20 })],
    ["an unknown header size", bmp({ width: 4, height: 2, headerSize: 64 })],
    ["a zero width", bmp({ width: 0, height: 2 })],
    ["an unsupported bit depth", bmp({ width: 4, height: 2, bitCount: 7 })],
  ])("rejects %s", async (_, bytes) => {
    expect(isImageError(await failure(bytes), "INVALID_IMAGE")).toBe(true);
  });
});

describe("probing AVIF and HEIF", () => {
  const still = (properties: readonly Uint8Array[] = []) =>
    heif({
      primary: 1,
      items: [{ id: 1, type: "av01", size: { width: 40, height: 30 }, properties }],
    });

  /** A grid primary over `rows × columns` tiles of one size. */
  const grid = (options: {
    rows: number;
    columns: number;
    output: { width: number; height: number };
    tile: { width: number; height: number };
    declared?: { width: number; height: number };
    tileSizes?: readonly { width: number; height: number }[];
  }) => {
    const count = options.rows * options.columns;
    const tiles = Array.from({ length: count }, (_, i) => ({
      id: 2 + i,
      type: "av01",
      size: options.tileSizes?.[i] ?? options.tile,
    }));
    const declared = options.declared ?? options.output;
    return heif({
      primary: 1,
      items: [
        {
          id: 1,
          type: "grid",
          size: options.output,
          data: gridData(options.rows, options.columns, declared.width, declared.height),
        },
        ...tiles,
      ],
      references: [{ type: "dimg", from: 1, to: tiles.map((tile) => tile.id) }],
    });
  };

  it("reads a still image's size from the primary item's ispe", async () => {
    expect(await probe(still())).toMatchObject({
      format: "avif",
      stored: { width: 40, height: 30 },
      oriented: { width: 40, height: 30 },
      orientation: 1,
      frames: 1,
      hasAlpha: false,
      decodedPixelBound: 1200,
    });
  });

  it("names HEIC files heif", async () => {
    const bytes = heif({
      brand: "heic",
      primary: 1,
      items: [{ id: 1, type: "hvc1", size: { width: 2, height: 2 } }],
    });
    expect((await probe(bytes)).format).toBe("heif");
  });

  it.each([
    ["no transform", [], 1],
    ["a quarter turn anticlockwise", [irot(1)], 8],
    ["a half turn", [irot(2)], 3],
    ["three quarter turns", [irot(3)], 6],
    ["a top-to-bottom mirror (axis 0)", [imir(0)], 4],
    ["a left-to-right mirror (axis 1)", [imir(1)], 2],
    ["a turn, then a mirror", [irot(1), imir(0)], 5],
    ["a mirror, then a turn", [imir(0), irot(1)], 7],
  ] as const)("maps %s to EXIF orientation %i", async (_, properties, orientation) => {
    const result = await probe(still(properties));
    expect(result.orientation).toBe(orientation);
    expect(result.oriented).toEqual(
      orientation >= 5 ? { width: 30, height: 40 } : { width: 40, height: 30 },
    );
  });

  it("crops the size to the clean aperture, and bounds by the coded size", async () => {
    // As libheif writes a 48 × 32 HEIC: coded at 64 × 64, cropped by clap.
    const result = await probe(
      heif({
        brand: "heic",
        primary: 1,
        items: [
          {
            id: 1,
            type: "hvc1",
            size: { width: 64, height: 64 },
            properties: [clap(48, 32, -8, -16), irot(1)],
          },
        ],
      }),
    );
    expect(result).toMatchObject({
      stored: { width: 48, height: 32 },
      oriented: { width: 32, height: 48 },
      orientation: 8,
      // The coded image, and one upright frame for the worker's transform.
      decodedPixelBound: 64 * 64 + 32 * 48,
    });
  });

  it.each([
    ["larger than the image", [clap(80, 32)]],
    ["outside the image", [clap(48, 32, 20, 0)]],
    [
      "of a fractional size",
      [
        box(
          "clap",
          [
            0, 0, 0, 3, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0,
            0, 0, 1,
          ],
        ),
      ],
    ],
    [
      "dividing by zero",
      [
        box(
          "clap",
          [
            0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0,
            0, 0, 1,
          ],
        ),
      ],
    ],
    ["after a rotation", [irot(1), clap(48, 32)]],
  ])("rejects a clean aperture %s", async (_, properties) => {
    const bytes = heif({
      primary: 1,
      items: [{ id: 1, type: "av01", size: { width: 64, height: 64 }, properties }],
    });
    expect(isImageError(await failure(bytes), "INVALID_IMAGE")).toBe(true);
  });

  it("bounds a grid by its output and every tile", async () => {
    const result = await probe(
      grid({
        rows: 2,
        columns: 3,
        output: { width: 300, height: 120 },
        tile: { width: 100, height: 64 },
      }),
    );
    expect(result).toMatchObject({
      stored: { width: 300, height: 120 },
      decodedPixelBound: 300 * 120 + 6 * 100 * 64,
    });
  });

  it("counts oversized tiles under a small grid output, rather than the output alone", async () => {
    const result = await probe(
      grid({
        rows: 1,
        columns: 2,
        output: { width: 8, height: 8 },
        tile: { width: 16000, height: 16000 },
      }),
    );
    expect(result.decodedPixelBound).toBe(64 + 2 * 16000 * 16000);
  });

  it("allows a grid of 1,024 tiles and rejects 1,025", async () => {
    const tile = { width: 1, height: 1 };
    expect(
      (await probe(grid({ rows: 32, columns: 32, output: { width: 32, height: 32 }, tile })))
        .decodedPixelBound,
    ).toBe(2048);
    const tooMany = grid({ rows: 25, columns: 41, output: { width: 41, height: 25 }, tile });
    expect(isImageError(await failure(tooMany), "INVALID_IMAGE")).toBe(true);
  });

  it.each([
    [
      "tiles of unequal sizes",
      grid({
        rows: 1,
        columns: 2,
        output: { width: 20, height: 10 },
        tile: { width: 10, height: 10 },
        tileSizes: [
          { width: 10, height: 10 },
          { width: 12, height: 10 },
        ],
      }),
    ],
    [
      "an output larger than its tiles",
      grid({
        rows: 1,
        columns: 2,
        output: { width: 21, height: 10 },
        tile: { width: 10, height: 10 },
      }),
    ],
    [
      "a declared output that differs from the ispe",
      grid({
        rows: 1,
        columns: 2,
        output: { width: 20, height: 10 },
        declared: { width: 20, height: 9 },
        tile: { width: 10, height: 10 },
      }),
    ],
    [
      "fewer tiles than rows × columns",
      heif({
        primary: 1,
        items: [
          { id: 1, type: "grid", size: { width: 20, height: 10 }, data: gridData(1, 2, 20, 10) },
          { id: 2, type: "av01", size: { width: 10, height: 10 } },
        ],
        references: [{ type: "dimg", from: 1, to: [2] }],
      }),
    ],
    [
      "a tile without an ispe",
      heif({
        primary: 1,
        items: [
          { id: 1, type: "grid", size: { width: 10, height: 10 }, data: gridData(1, 1, 10, 10) },
          { id: 2, type: "av01" },
        ],
        references: [{ type: "dimg", from: 1, to: [2] }],
      }),
    ],
    [
      "a grid whose tile is a grid",
      heif({
        primary: 1,
        items: [
          { id: 1, type: "grid", size: { width: 10, height: 10 }, data: gridData(1, 1, 10, 10) },
          { id: 2, type: "grid", size: { width: 10, height: 10 }, data: gridData(1, 1, 10, 10) },
          { id: 3, type: "av01", size: { width: 10, height: 10 } },
        ],
        references: [
          { type: "dimg", from: 1, to: [2] },
          { type: "dimg", from: 2, to: [3] },
        ],
      }),
    ],
    [
      "a reference cycle",
      heif({
        primary: 1,
        items: [
          { id: 1, type: "grid", size: { width: 10, height: 10 }, data: gridData(1, 1, 10, 10) },
          { id: 2, type: "av01", size: { width: 10, height: 10 } },
        ],
        references: [
          { type: "dimg", from: 1, to: [2] },
          { type: "auxl", from: 2, to: [1] },
        ],
      }),
    ],
    [
      "a reference to an undeclared item",
      heif({
        primary: 1,
        items: [{ id: 1, type: "av01", size: { width: 10, height: 10 } }],
        references: [{ type: "auxl", from: 9, to: [1] }],
      }),
    ],
    ["a primary item without an ispe", heif({ primary: 1, items: [{ id: 1, type: "av01" }] })],
    [
      "a primary item that isn't declared",
      heif({ primary: 2, items: [{ id: 1, type: "av01", size: { width: 1, height: 1 } }] }),
    ],
  ])("rejects %s", async (_, bytes) => {
    expect(isImageError(await failure(bytes), "INVALID_IMAGE")).toBe(true);
  });

  it("counts an alpha plane, a gain map and a thumbnail, and flags alpha and the thumbnail", async () => {
    const result = await probe(
      heif({
        primary: 1,
        items: [
          { id: 1, type: "av01", size: { width: 10, height: 10 } },
          {
            id: 2,
            type: "av01",
            size: { width: 4000, height: 4000 },
            properties: [auxC(ALPHA_AUX)],
          },
          {
            id: 3,
            type: "av01",
            size: { width: 5000, height: 5000 },
            properties: [auxC(GAIN_MAP_AUX)],
          },
          { id: 4, type: "av01", size: { width: 3, height: 3 } },
        ],
        references: [
          { type: "auxl", from: 2, to: [1] },
          { type: "auxl", from: 3, to: [1] },
          { type: "thmb", from: 4, to: [1] },
        ],
      }),
    );
    expect(result).toMatchObject({
      hasAlpha: true,
      decodedPixelBound: 100 + 4000 * 4000 + 5000 * 5000 + 9,
      metadata: { thumbnail: true },
    });
  });

  it("counts an ISO gain map reached through a tone-map item that derives from the primary", async () => {
    const result = await probe(
      heif({
        primary: 1,
        items: [
          { id: 1, type: "av01", size: { width: 10, height: 10 } },
          { id: 2, type: "tmap", size: { width: 10, height: 10 } },
          { id: 3, type: "av01", size: { width: 3000, height: 3000 } },
        ],
        references: [{ type: "dimg", from: 2, to: [1, 3] }],
      }),
    );
    expect(result.decodedPixelBound).toBe(100 + 100 + 3000 * 3000);
  });

  it("counts an alpha grid's own tiles", async () => {
    const result = await probe(
      heif({
        primary: 1,
        items: [
          { id: 1, type: "av01", size: { width: 10, height: 10 } },
          {
            id: 2,
            type: "grid",
            size: { width: 10, height: 10 },
            data: gridData(1, 2, 10, 10),
            properties: [auxC(ALPHA_AUX)],
          },
          { id: 3, type: "av01", size: { width: 5, height: 10 } },
          { id: 4, type: "av01", size: { width: 5, height: 10 } },
        ],
        references: [
          { type: "auxl", from: 2, to: [1] },
          { type: "dimg", from: 2, to: [3, 4] },
        ],
      }),
    );
    expect(result).toMatchObject({ hasAlpha: true, decodedPixelBound: 100 + 100 + 50 + 50 });
  });

  it("reads EXIF presence flags and keepable fields, but not its orientation", async () => {
    const result = await probe(
      heif({
        primary: 1,
        items: [
          { id: 1, type: "av01", size: { width: 10, height: 20 }, properties: [irot(3)] },
          {
            id: 2,
            type: "Exif",
            mdat: heifExif(exif({ orientation: 8, gps: true, copyright: "CC" })),
          },
          { id: 3, type: "mime" },
        ],
        references: [{ type: "cdsc", from: 2, to: [1] }],
      }),
    );
    expect(result).toMatchObject({
      orientation: 6,
      metadata: { location: true, other: true },
      keepable: { copyright: "CC" },
    });
  });

  it("refuses image sequences", async () => {
    const bytes = heif({
      brand: "avis",
      primary: 1,
      items: [{ id: 1, type: "av01", size: { width: 10, height: 10 } }],
      after: [box("moov")],
    });
    expect(isImageError(await failure(bytes), "UNSUPPORTED_FORMAT")).toBe(true);
  });

  it("refuses a primary item of a type it doesn't bound", async () => {
    const bytes = heif({
      primary: 1,
      items: [{ id: 1, type: "iovl", size: { width: 10, height: 10 } }],
    });
    expect(isImageError(await failure(bytes), "UNSUPPORTED_FORMAT")).toBe(true);
  });

  it("rejects an EXIF item whose data lies past the end of the file", async () => {
    const bytes = heif({
      primary: 1,
      items: [
        { id: 1, type: "av01", size: { width: 10, height: 10 } },
        { id: 2, type: "Exif", mdat: heifExif(exif({})) },
      ],
    });
    expect(isImageError(await failure(bytes.subarray(0, bytes.length - 4)), "INVALID_IMAGE")).toBe(
      true,
    );
  });
});

describe("unknown formats", () => {
  it.each([
    ["TIFF", [0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0]],
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
    webp: webp({
      canvas: { width: 10, height: 10, alpha: true },
      chunks: [vp8(10, 10), webpChunk("EXIF", exif({ orientation: 3, gps: true }))],
    }),
    "animated WebP": webp({
      canvas: { width: 10, height: 10, animated: true },
      chunks: [anmf({ width: 10, height: 10 }), anmf({ width: 4, height: 4, x: 6, y: 6 })],
    }),
    gif: gif({
      width: 6,
      height: 6,
      comment: "c",
      frames: [
        { width: 6, height: 6 },
        { width: 2, height: 2, x: 4, y: 4 },
      ],
    }),
    bmp: bmp({ width: 4, height: -2, headerSize: 124, embeddedProfile: true }),
    "AVIF grid with alpha": heif({
      primary: 1,
      items: [
        {
          id: 1,
          type: "grid",
          size: { width: 20, height: 10 },
          data: gridData(1, 2, 20, 10),
          properties: [clap(18, 10, -1, 0), irot(1), imir(0)],
        },
        { id: 2, type: "av01", size: { width: 10, height: 10 } },
        { id: 3, type: "av01", size: { width: 10, height: 10 } },
        { id: 4, type: "av01", size: { width: 20, height: 10 }, properties: [auxC(ALPHA_AUX)] },
        { id: 5, type: "Exif", mdat: heifExif(exif({ gps: true, artist: "a" })) },
      ],
      references: [
        { type: "dimg", from: 1, to: [2, 3] },
        { type: "auxl", from: 4, to: [1] },
        { type: "cdsc", from: 5, to: [1] },
      ],
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
        fc.constantFrom(
          fixtures.png.subarray(0, 8),
          Uint8Array.of(0xff, 0xd8, 0xff),
          fixtures.webp.subarray(0, 12),
          fixtures.gif.subarray(0, 6),
          fixtures.bmp.subarray(0, 2),
          fixtures["AVIF grid with alpha"].subarray(0, 12),
        ),
        fc.uint8Array({ maxLength: 512 }),
        async (signature, tail) => {
          await settlesSafely(concat([signature, tail]));
        },
      ),
      { numRuns: 300 },
    );
  });
});
