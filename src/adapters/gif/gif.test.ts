import { createWindowReader } from "@hussmartinez/sdk-core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type GifFixture,
  lzwEncode,
  subBlocks,
  writeGif,
} from "../../../test/fixtures/gif-writer.js";
import { type ImageError, isImageError } from "../../core/errors/image-error.js";
import { probeGif } from "../probe/gif.js";
import { createGifComposer, decodeGifFrame } from "./compose.js";
import { MAX_GIF_FRAMES, readGifFrames } from "./frames.js";

const RED = [255, 0, 0] as const;
const GREEN = [0, 255, 0] as const;
const BLUE = [0, 0, 255] as const;
const WHITE = [255, 255, 255] as const;
const FOUR = [RED, GREEN, BLUE, WHITE] as const;
const CLEAR = [0, 0, 0, 0] as const;
const opaque = (colour: readonly number[]) => [...colour, 255];

/** Every frame's composed screen, as lists of RGBA pixels. */
function screens(bytes: Uint8Array): number[][][] {
  const file = readGifFrames(bytes);
  const composer = createGifComposer(bytes, file);
  return file.frames.map(() => {
    const screen = composer.next();
    const pixels: number[][] = [];
    for (let i = 0; i < screen.length; i += 4) pixels.push([...screen.subarray(i, i + 4)]);
    return pixels;
  });
}

/** Reads and composes a whole file: what any input must either do, or be refused for. */
function decodeAll(bytes: Uint8Array): number {
  const file = readGifFrames(bytes);
  const composer = createGifComposer(bytes, file);
  for (const _ of file.frames) composer.next();
  return file.frames.length;
}

/** Why a file is refused. */
function refusal(run: () => unknown): { code: string; problem: unknown } {
  try {
    run();
  } catch (error) {
    if (!isImageError(error)) throw error;
    return { code: error.code, problem: (error as ImageError).details?.["problem"] };
  }
  throw new Error("expected a refusal");
}

/** The smallest GIF: one white pixel, written by hand. */
const SMALLEST = Uint8Array.from([
  // "GIF89a", a 1 × 1 screen, a table of two colours.
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff,
  0x00, 0x00, 0x00,
  // An image at 0, 0, 1 × 1; code size 2; two bytes of data: clear, 0, end.
  0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
]);

const TWO_BY_TWO: GifFixture = {
  width: 2,
  height: 2,
  palette: FOUR,
  frames: [{ pixels: [0, 1, 2, 3] }],
};

describe("the GIF frame table (docs/adr/0011)", () => {
  it("reads the smallest GIF, written by hand", () => {
    const file = readGifFrames(SMALLEST);
    expect(file).toEqual({
      width: 1,
      height: 1,
      loop: null,
      table: { offset: 13, size: 2 },
      frames: [
        {
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          delay: 0,
          disposal: 0,
          transparent: null,
          interlaced: false,
          table: null,
          codeSize: 2,
          data: 30,
        },
      ],
      complete: true,
    });
    expect(screens(SMALLEST)).toEqual([[opaque(WHITE)]]);
  });

  it("keeps each frame's delay, disposal and transparent colour as the file has them", () => {
    const file = readGifFrames(
      writeGif({
        width: 2,
        height: 2,
        palette: FOUR,
        frames: [
          { pixels: [0, 0, 0, 0], delay: 0, disposal: 1 },
          { pixels: [1, 1, 1, 1], delay: 7, disposal: 2, transparent: 3 },
          { pixels: [2, 2, 2, 2], delay: 65_535, disposal: 3 },
          // No graphic control extension: the one before it applied to its own frame only.
          { pixels: [3, 3, 3, 3] },
        ],
      }),
    );
    expect(
      file.frames.map(({ delay, disposal, transparent }) => [delay, disposal, transparent]),
    ).toEqual([
      [0, 1, null],
      [7, 2, 3],
      [65_535, 3, null],
      [0, 0, null],
    ]);
  });

  it("reads the reserved disposal methods as browsers do: 4 restores, 5 to 7 keep", () => {
    const disposals = [0, 1, 2, 3, 4, 5, 6, 7].map(
      (disposal) =>
        readGifFrames(writeGif({ ...TWO_BY_TWO, frames: [{ pixels: [0, 1, 2, 3], disposal }] }))
          .frames[0]?.disposal,
    );
    expect(disposals).toEqual([0, 1, 2, 3, 3, 0, 0, 0]);
  });

  it("takes a first frame at the screen's corner that covers it as the screen, as browsers do", async () => {
    const pixels = (width: number, height: number) =>
      Array.from({ length: width * height }, (_, i) => i % 4);
    const first = (width: number, height: number, x = 0, y = 0) =>
      writeGif({ ...TWO_BY_TWO, frames: [{ x, y, width, height, pixels: pixels(width, height) }] });
    // Larger both ways, and larger one way while as large the other.
    for (const [width, height] of [
      [5, 4],
      [5, 2],
      [2, 4],
    ] as const) {
      const bytes = first(width, height);
      const file = readGifFrames(bytes);
      expect([file.width, file.height]).toEqual([width, height]);
      const probed = await probeGif(createWindowReader(new Blob([bytes.slice()])));
      expect(probed).toMatchObject({
        stored: { width, height },
        frames: 1,
        decodedPixelBound: width * height,
      });
      // The frame alone, every pixel of it.
      expect(screens(bytes)[0]).toHaveLength(width * height);
      expect(screens(bytes)[0]?.every((pixel) => pixel[3] === 255)).toBe(true);
    }
    // Wider but not as tall, or away from the corner: browsers don't agree on the size.
    for (const bytes of [first(5, 1), first(1, 5), first(5, 4, 1, 0), first(2, 2, 0, 1)]) {
      expect(refusal(() => readGifFrames(bytes)).problem).toBe(
        "a frame doesn't fit inside the logical screen",
      );
      await expect(probeGif(createWindowReader(new Blob([bytes.slice()])))).rejects.toMatchObject({
        code: "INVALID_IMAGE",
      });
    }
    // Only the first frame is the screen: a later one that's larger ends the file.
    const later = writeGif({
      ...TWO_BY_TWO,
      frames: [{ pixels: [0, 1, 2, 3] }, { width: 5, height: 4, pixels: pixels(5, 4) }],
    });
    expect(readGifFrames(later)).toMatchObject({ width: 2, height: 2, frames: { length: 1 } });
    // And later frames are held to the screen the first one made.
    const grown = writeGif({
      ...TWO_BY_TWO,
      frames: [
        { width: 5, height: 4, pixels: pixels(5, 4) },
        { x: 3, y: 2, width: 2, height: 2, pixels: [0, 1, 2, 3] },
      ],
    });
    expect(readGifFrames(grown)).toMatchObject({ width: 5, height: 4, frames: { length: 2 } });
    expect((await probeGif(createWindowReader(new Blob([grown.slice()])))).frames).toBe(2);
  });

  it("tells an absent loop count from an infinite and a finite one", () => {
    const loopOf = (extra: Partial<GifFixture>) =>
      readGifFrames(writeGif({ ...TWO_BY_TWO, ...extra })).loop;
    expect(loopOf({})).toBeNull();
    expect(loopOf({ loop: 0 })).toBe(0);
    expect(loopOf({ loop: 5 })).toBe(5);
    expect(loopOf({ loop: 65_535 })).toBe(65_535);
    expect(loopOf({ loop: 3, loopName: "ANIMEXTS1.0" })).toBe(3);
    // Another application's extension isn't a loop count.
    expect(loopOf({ loop: 3, loopName: "XMP DataXMP" })).toBeNull();
  });

  it("records a frame's rectangle, interlacing and its own colour table", () => {
    const bytes = writeGif({
      width: 4,
      height: 4,
      palette: FOUR,
      comment: "a comment the decoder skips",
      frames: [
        { pixels: Array.from({ length: 16 }, () => 0) },
        {
          x: 1,
          y: 2,
          width: 2,
          height: 1,
          pixels: [1, 0],
          palette: [BLUE, WHITE],
          interlaced: true,
        },
      ],
    });
    const [, second] = readGifFrames(bytes).frames;
    expect(second).toMatchObject({ x: 1, y: 2, width: 2, height: 1, interlaced: true });
    expect(second?.table?.size).toBe(2);
    expect(readGifFrames(bytes).table?.size).toBe(4);
  });

  it("counts the frames the probe counts", async () => {
    const bytes = writeGif({
      width: 3,
      height: 2,
      palette: FOUR,
      loop: 0,
      frames: [0, 1, 2].map((index) => ({
        pixels: Array.from({ length: 6 }, () => index),
        delay: 4,
      })),
    });
    const probed = await probeGif(createWindowReader(new Blob([bytes.slice()])));
    const file = readGifFrames(bytes);
    expect(file.frames).toHaveLength(probed.frames);
    expect([file.width, file.height]).toEqual([probed.stored.width, probed.stored.height]);
  });

  it("ends a file where it stops being a GIF, once it has a whole frame", () => {
    const first = { pixels: [0, 1, 2, 3] };
    const one = writeGif({ ...TWO_BY_TWO, frames: [first] });
    const withSecond = (second: GifFixture["frames"][number], fixture: Partial<GifFixture> = {}) =>
      writeGif({ ...TWO_BY_TWO, ...fixture, frames: [first, second] });
    const second = { pixels: [3, 2, 1, 0] };
    const two = withSecond(second);
    const secondAt = readGifFrames(two).frames[1]?.data as number;
    const cases: Record<string, Uint8Array> = {
      "no trailer": one.slice(0, -1),
      "bytes after the trailer": Uint8Array.from([...one, 0x21, 0x2c, 0xff, 7]),
      "a block that isn't one": Uint8Array.from([...one.slice(0, -1), 0x00, 0x13, 0x37, 0x3b]),
      "a second frame cut inside its data": two.slice(0, secondAt + 2),
      "a second frame cut inside its descriptor": two.slice(0, secondAt - 4),
      "a second frame without its terminator": two.slice(0, -2),
      "a second frame outside the screen": withSecond({ ...second, x: 1 }),
      "a second frame with a code size of 9": withSecond({ ...second, codeSize: 9 }),
      "a second frame with a code size of 0": withSecond({ ...second, codeSize: 0 }),
    };
    for (const [name, bytes] of Object.entries(cases)) {
      const file = readGifFrames(bytes);
      expect(file.frames, name).toHaveLength(1);
      expect(screens(bytes), name).toEqual(screens(one));
    }
    // The same in the first frame is refused: there's no whole frame to show.
    expect(refusal(() => readGifFrames(one.slice(0, -2))).problem).toBe(
      "a data sub-block ends past the end of the file",
    );
    expect(
      refusal(() => readGifFrames(Uint8Array.from([...one.slice(0, 13 + 12), 0x00, 0x3b]))).problem,
    ).toBe("an unknown block");
  });

  it("ends every file where the probe ends it: truncated, changed, or noise", async () => {
    const valid = writeGif({
      width: 4,
      height: 3,
      palette: FOUR,
      loop: 0,
      comment: "note",
      frames: [
        { pixels: Array.from({ length: 12 }, (_, i) => i % 4), delay: 3 },
        { x: 1, y: 1, width: 2, height: 2, pixels: [0, 1, 2, 3], transparent: 1, disposal: 2 },
        { pixels: Array.from({ length: 12 }, (_, i) => (i * 3) % 4), palette: [BLUE, RED] },
      ],
    });
    /** What a walk makes of a file: its screen and frame count, or the code it refuses with. */
    const probed = async (bytes: Uint8Array) => {
      try {
        const probe = await probeGif(createWindowReader(new Blob([bytes.slice()])));
        return `${probe.stored.width}x${probe.stored.height}, ${probe.frames}`;
      } catch (error) {
        if (!isImageError(error)) throw error;
        return error.code;
      }
    };
    const read = (bytes: Uint8Array) => {
      try {
        const file = readGifFrames(bytes);
        return `${file.width}x${file.height}, ${file.frames.length}`;
      } catch (error) {
        if (!isImageError(error)) throw error;
        return error.code;
      }
    };
    expect(read(valid)).toBe("4x3, 3");
    for (let length = 6; length <= valid.length; length += 1) {
      const cut = valid.slice(0, length);
      expect(read(cut), `${length} bytes`).toBe(await probed(cut));
    }
    for (let at = 6; at < valid.length; at += 1) {
      for (const value of [
        0x00,
        0xff,
        (valid[at] as number) ^ 0x01,
        (valid[at] as number) ^ 0x80,
      ]) {
        const changed = valid.slice();
        changed[at] = value;
        expect(read(changed), `byte ${at} as ${value}`).toBe(await probed(changed));
      }
    }
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.nat(valid.length - 7), fc.nat(255)), { maxLength: 6 }),
        fc.nat(valid.length),
        async (changes, length) => {
          const changed = valid.slice(0, Math.max(6, length));
          for (const [at, value] of changes) if (at + 6 < changed.length) changed[at + 6] = value;
          expect(read(changed)).toBe(await probed(changed));
        },
      ),
      { numRuns: 2_000 },
    );
  });

  it("ends a file where the frame table does when frames' data spans many of the probe's reads", async () => {
    // Noise in 256 colours: each frame's data is a chain of sub-blocks longer
    // than the 64 KiB the probe looks at per read. With the default sub-block
    // size, they meet each view's end exactly; with other sizes, they cross it.
    let seed = 1;
    const noise = (count: number) =>
      Array.from({ length: count }, () => {
        seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
        return (seed >>> 16) % 256;
      });
    const palette = Array.from({ length: 256 }, (_, i) => [i, 255 - i, (i * 7) % 256] as const);
    const valid = writeGif({
      width: 300,
      height: 300,
      palette,
      loop: 0,
      // Sub-blocks of the usual 255 bytes, which meet the probe's views exactly,
      // and of sizes that run across them.
      frames: [
        { pixels: noise(90_000) },
        { pixels: noise(90_000), subBlockSize: 100 },
        { pixels: noise(90_000), subBlockSize: 7 },
      ],
    });
    expect(valid.length).toBeGreaterThan(3 * 64 * 1024);
    const probed = async (bytes: Uint8Array, windowSize?: number) => {
      try {
        const reader = createWindowReader(
          new Blob([bytes.slice()]),
          windowSize === undefined ? {} : { windowSize },
        );
        return `${(await probeGif(reader)).frames}`;
      } catch (error) {
        if (!isImageError(error)) throw error;
        return error.code;
      }
    };
    const read = (bytes: Uint8Array) => {
      try {
        return `${readGifFrames(bytes).frames.length}`;
      } catch (error) {
        if (!isImageError(error)) throw error;
        return error.code;
      }
    };
    expect(await probed(valid)).toBe("3");
    // Cut around every multiple of the probe's view and of the reader's
    // windows, and at random, with the reader's default window, a small one
    // and one that isn't a multiple of anything.
    const cuts = new Set<number>([valid.length]);
    for (let edge = 64 * 1024; edge < valid.length; edge += 4096) {
      for (let near = -3; near <= 3; near += 1) cuts.add(edge + near);
    }
    for (const length of [...cuts].filter((length) => length > 6 && length <= valid.length)) {
      const cut = valid.slice(0, length);
      const expected = read(cut);
      for (const windowSize of [undefined, 4096, 100_003]) {
        expect(await probed(cut, windowSize), `${length} bytes, window ${windowSize}`).toBe(
          expected,
        );
      }
    }
  });

  it("refuses a first frame outside the screen or with a code size out of range, and a file with no frame", () => {
    expect(
      refusal(() =>
        readGifFrames(
          writeGif({ ...TWO_BY_TWO, frames: [{ x: 1, width: 2, height: 1, pixels: [0, 0] }] }),
        ),
      ).problem,
    ).toBe("a frame doesn't fit inside the logical screen");
    expect(refusal(() => readGifFrames(writeGif({ ...TWO_BY_TWO, frames: [] }))).problem).toBe(
      "there are no frames",
    );
    expect(
      refusal(() =>
        readGifFrames(writeGif({ ...TWO_BY_TWO, frames: [{ pixels: [0, 0, 0, 0], codeSize: 9 }] })),
      ).problem,
    ).toBe("a frame's LZW minimum code size is out of range");
    expect(
      refusal(() =>
        readGifFrames(Uint8Array.from([...SMALLEST.slice(0, 5), 0x62, ...SMALLEST.slice(6)])),
      ).problem,
    ).toBe("not a GIF");
  });

  it("keeps a table of at most 4,096 frames, whatever a file policy allows", () => {
    const frame = { width: 1, height: 1, pixels: [0] };
    const most = writeGif({
      width: 1,
      height: 1,
      palette: [RED, GREEN],
      frames: Array.from({ length: MAX_GIF_FRAMES }, () => frame),
    });
    expect(readGifFrames(most).frames).toHaveLength(MAX_GIF_FRAMES);
    const over = writeGif({
      width: 1,
      height: 1,
      palette: [RED, GREEN],
      frames: Array.from({ length: MAX_GIF_FRAMES + 1 }, () => frame),
    });
    expect(refusal(() => readGifFrames(over)).code).toBe("TOO_MANY_FRAMES");
  });
});

describe("decoding a frame (docs/adr/0011)", () => {
  it("decodes exactly the pixels a frame holds", () => {
    const bytes = writeGif(TWO_BY_TWO);
    const [frame] = readGifFrames(bytes).frames;
    if (!frame) throw new Error("no frame");
    expect([...decodeGifFrame(bytes, frame)]).toEqual([0, 1, 2, 3]);
    expect(screens(bytes)).toEqual([[opaque(RED), opaque(GREEN), opaque(BLUE), opaque(WHITE)]]);
  });

  it("puts an interlaced frame's rows in order", () => {
    // Ten rows, each of its own colour index: stored as rows 0, 8, 4, 2, 6, 1, 3, 5, 7, 9.
    const pixels = Array.from({ length: 10 * 2 }, (_, i) => Math.floor(i / 2));
    const palette = Array.from({ length: 16 }, (_, i) => [i * 16, 0, 0] as const);
    const bytes = writeGif({
      width: 2,
      height: 10,
      palette,
      frames: [{ pixels, interlaced: true }],
    });
    const [frame] = readGifFrames(bytes).frames;
    if (!frame) throw new Error("no frame");
    expect([...decodeGifFrame(bytes, frame)]).toEqual(pixels);
    // The same pixels as when it isn't interlaced.
    expect(screens(bytes)).toEqual(
      screens(writeGif({ width: 2, height: 10, palette, frames: [{ pixels }] })),
    );
  });

  it("decodes any pixels, at any code size, through a table that fills and is cleared", () => {
    const palette = (bits: number) =>
      Array.from({ length: 2 ** bits }, (_, i) => [i, 255 - i, (i * 7) % 256] as const);
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 1, max: 40 }),
        fc.boolean(),
        fc.infiniteStream(fc.nat(255)),
        (bits, width, height, interlaced, values) => {
          const pixels = [...values.take(width * height)].map((value) => value % 2 ** bits);
          const bytes = writeGif({
            width,
            height,
            palette: palette(bits),
            frames: [{ pixels, interlaced }],
          });
          const [frame] = readGifFrames(bytes).frames;
          if (!frame) throw new Error("no frame");
          expect([...decodeGifFrame(bytes, frame)]).toEqual(pixels);
        },
      ),
    );
    // Noise in 256 colours, 300 × 300: more codes than the table's 4,096, so it's cleared and refilled.
    let seed = 1;
    const noise = Array.from({ length: 300 * 300 }, () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed % 256;
    });
    const large = writeGif({
      width: 300,
      height: 300,
      palette: palette(8),
      frames: [{ pixels: noise }],
    });
    const [frame] = readGifFrames(large).frames;
    if (!frame) throw new Error("no frame");
    expect([...decodeGifFrame(large, frame)]).toEqual(noise);
    // And one colour, 300 × 300: long strings, where a code is used the moment it's defined.
    const flat = Array.from({ length: 300 * 300 }, () => 3);
    const plain = writeGif({ width: 300, height: 300, palette: FOUR, frames: [{ pixels: flat }] });
    const [only] = readGifFrames(plain).frames;
    if (!only) throw new Error("no frame");
    expect(decodeGifFrame(plain, only).every((index) => index === 3)).toBe(true);
  });

  it("takes data with no end code, when it holds exactly the frame's pixels", () => {
    expect(
      screens(writeGif({ ...TWO_BY_TWO, frames: [{ pixels: [0, 1, 2, 3], noEnd: true }] })),
    ).toEqual(screens(writeGif(TWO_BY_TWO)));
  });

  it("stops at a frame's last pixel: what follows it in the data isn't read", () => {
    const expected = [0, 1, 2, 3];
    const decoded = (data: number[]) => {
      const bytes = writeGif({ ...TWO_BY_TWO, frames: [{ pixels: expected, data }] });
      return [...decodeGifFrame(bytes, readGifFrames(bytes).frames[0] as never)];
    };
    // One pixel more, and a frame's worth more.
    expect(decoded(lzwEncode([...expected, 0], 2))).toEqual(expected);
    expect(decoded(lzwEncode([...expected, ...expected, ...expected], 2))).toEqual(expected);
    // A string that starts inside the frame and ends outside it: 2, 3, then 3, 3, 3 as one code.
    expect(decoded(lzwEncode([0, 1, 3, 3, 3, 3, 3, 3], 2))).toEqual([0, 1, 3, 3]);
    // Codes that aren't defined, after the last pixel: they're never reached.
    expect(decoded([...lzwEncode(expected, 2, false), 0xff, 0xff, 0xff])).toEqual(expected);
    // Bytes after the end code.
    expect(decoded([...lzwEncode(expected, 2), 9, 9, 9])).toEqual(expected);
  });

  it("refuses data that holds fewer pixels than the frame: a frame is whole or refused", () => {
    const withData = (pixels: number[]) =>
      writeGif({ ...TWO_BY_TWO, frames: [{ pixels: [0, 0, 0, 0], data: lzwEncode(pixels, 2) }] });
    expect(refusal(() => decodeAll(withData([0, 1, 2]))).problem).toBe(
      "a frame's data holds fewer pixels than the frame",
    );
    expect(refusal(() => decodeAll(withData([]))).problem).toBe(
      "a frame's data holds fewer pixels than the frame",
    );
  });

  it("decodes a frame whose code size is 1, as files in the wild have for two colours", () => {
    const bytes = writeGif({
      width: 3,
      height: 2,
      palette: [RED, GREEN],
      frames: [{ pixels: [0, 1, 1, 0, 0, 1], codeSize: 1 }],
    });
    expect(readGifFrames(bytes).frames[0]?.codeSize).toBe(1);
    expect(screens(bytes)).toEqual([
      [opaque(RED), opaque(GREEN), opaque(GREEN), opaque(RED), opaque(RED), opaque(GREEN)],
    ]);
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 1, max: 40 }),
        fc.infiniteStream(fc.nat(1)),
        (width, height, values) => {
          const pixels = [...values.take(width * height)];
          const file = writeGif({
            width,
            height,
            palette: [RED, GREEN],
            frames: [{ pixels, codeSize: 1 }],
          });
          expect([...decodeGifFrame(file, readGifFrames(file).frames[0] as never)]).toEqual(pixels);
        },
      ),
    );
  });

  it("refuses a code that isn't defined yet, and a first code that isn't a colour", () => {
    // Code size 2: clear is 4, end is 5, and the first code a string can take is 6.
    const codes = (...list: number[]) => {
      const out: number[] = [];
      let buffer = 0;
      let bits = 0;
      for (const code of list) {
        buffer |= code << bits;
        bits += 3;
        while (bits >= 8) {
          out.push(buffer & 0xff);
          buffer >>>= 8;
          bits -= 8;
        }
      }
      if (bits > 0) out.push(buffer & 0xff);
      return writeGif({ ...TWO_BY_TWO, frames: [{ pixels: [0, 0, 0, 0], data: out }] });
    };
    // Clear, then 6: no string has been defined.
    expect(refusal(() => decodeAll(codes(4, 6))).problem).toBe(
      "a frame's data starts with a code that isn't a colour",
    );
    // Clear, 0, then 7: only 6 can be the next.
    expect(refusal(() => decodeAll(codes(4, 0, 7))).problem).toBe(
      "a frame's data uses a code that isn't defined yet",
    );
    // Clear, 0, then 6, the code being defined: the string 0, 0. Then 1.
    expect(screens(codes(4, 0, 6, 1, 5))).toEqual([
      [opaque(RED), opaque(RED), opaque(RED), opaque(GREEN)],
    ]);
  });

  it("doesn't draw a pixel that names a colour its table doesn't have", () => {
    // A table of two colours, and code size 2, whose codes reach 3.
    const frames = (transparent?: number) =>
      writeGif({
        width: 3,
        height: 1,
        palette: [RED, GREEN],
        frames: [
          { pixels: [0, 3, 1], codeSize: 2, ...(transparent === undefined ? {} : { transparent }) },
        ],
      });
    expect(screens(frames())).toEqual([[opaque(RED), [...CLEAR], opaque(GREEN)]]);
    expect(screens(frames(3))).toEqual([[opaque(RED), [...CLEAR], opaque(GREEN)]]);
    // A frame with no table, in a file with none, draws nothing.
    expect(screens(writeGif({ width: 2, height: 1, frames: [{ pixels: [0, 1] }] }))).toEqual([
      [[...CLEAR], [...CLEAR]],
    ]);
    // Over an earlier frame, the pixel under it stays.
    expect(
      screens(
        writeGif({
          width: 3,
          height: 1,
          palette: [RED, GREEN],
          frames: [
            { pixels: [1, 1, 1], codeSize: 2 },
            { pixels: [0, 3, 0], codeSize: 2 },
          ],
        }),
      )[1],
    ).toEqual([opaque(RED), opaque(GREEN), opaque(RED)]);
  });
});

describe("composing frames (docs/adr/0011)", () => {
  /** A 2 × 1 screen: what each frame leaves, as two pixels. */
  const strip = (frames: GifFixture["frames"]) =>
    screens(writeGif({ width: 2, height: 1, palette: FOUR, frames }));

  it("starts transparent, whatever background colour the file names, and skips the transparent colour", () => {
    const bytes = writeGif({
      width: 2,
      height: 1,
      palette: FOUR,
      frames: [{ pixels: [3, 1], transparent: 3 }],
    });
    // Name colour 2 as the background: it isn't drawn.
    bytes[11] = 2;
    expect(screens(bytes)).toEqual([[[...CLEAR], opaque(GREEN)]]);
  });

  it("keeps a frame for disposal 0 and 1: the next is drawn over it", () => {
    for (const disposal of [0, 1]) {
      expect(
        strip([
          { pixels: [0, 0], disposal },
          { x: 1, width: 1, height: 1, pixels: [1] },
          // Its transparent pixel shows what was there.
          { pixels: [3, 2], transparent: 3 },
        ]),
      ).toEqual([
        [opaque(RED), opaque(RED)],
        [opaque(RED), opaque(GREEN)],
        [opaque(RED), opaque(BLUE)],
      ]);
    }
  });

  it("clears a frame's rectangle to transparent for disposal 2, over opaque pixels too", () => {
    expect(
      strip([
        { pixels: [0, 0] },
        // Over the red, in the second pixel only; then cleared.
        { x: 1, width: 1, height: 1, pixels: [1], disposal: 2 },
        { x: 0, width: 1, height: 1, pixels: [2] },
      ]),
    ).toEqual([
      [opaque(RED), opaque(RED)],
      [opaque(RED), opaque(GREEN)],
      // The second pixel is transparent, not red and not a background colour.
      [opaque(BLUE), [...CLEAR]],
    ]);
  });

  it("restores what was under a frame for disposal 3, over transparent and opaque pixels", () => {
    expect(
      strip([
        // Red on the left; the right stays transparent.
        { x: 0, width: 1, height: 1, pixels: [0] },
        { pixels: [1, 1], disposal: 3 },
        { pixels: [3, 3], transparent: 3 },
      ]),
    ).toEqual([
      [opaque(RED), [...CLEAR]],
      [opaque(GREEN), opaque(GREEN)],
      // Back to red and transparent, under a frame that draws nothing.
      [opaque(RED), [...CLEAR]],
    ]);
    // Two frames that restore, one after the other: each puts back what it covered.
    expect(
      strip([
        { pixels: [0, 0] },
        { x: 0, width: 1, height: 1, pixels: [1], disposal: 3 },
        { x: 1, width: 1, height: 1, pixels: [2], disposal: 3 },
        { pixels: [3, 3], transparent: 3 },
      ]).at(-1),
    ).toEqual([opaque(RED), opaque(RED)]);
  });

  it("leaves the screen as it was when a frame is refused, and starts again after a reset", () => {
    const bytes = writeGif({
      width: 2,
      height: 1,
      palette: FOUR,
      frames: [
        { pixels: [0, 1], disposal: 2 },
        { pixels: [2, 2], data: lzwEncode([2], 2) },
      ],
    });
    const file = readGifFrames(bytes);
    const composer = createGifComposer(bytes, file);
    const first = [...composer.next()];
    expect(() => composer.next()).toThrow();
    // Not cleared by the first frame's disposal, and still the first frame.
    expect(composer.shown).toBe(0);
    composer.reset();
    expect(composer.shown).toBe(-1);
    expect([...composer.next()]).toEqual(first);
    const whole = writeGif({ width: 2, height: 1, palette: FOUR, frames: [{ pixels: [0, 1] }] });
    const done = createGifComposer(whole, readGifFrames(whole));
    done.next();
    expect(() => done.next()).toThrow(RangeError);
  });
});

describe("hostile GIFs (docs/adr/0011)", () => {
  const VALID = writeGif({
    width: 5,
    height: 4,
    palette: FOUR,
    loop: 2,
    comment: "note",
    frames: [
      { pixels: Array.from({ length: 20 }, (_, i) => i % 4), delay: 5, disposal: 1 },
      { x: 1, y: 1, width: 3, height: 2, pixels: [0, 1, 2, 3, 0, 1], disposal: 3, transparent: 3 },
      {
        pixels: Array.from({ length: 20 }, (_, i) => (i * 3) % 4),
        interlaced: true,
        palette: [BLUE, WHITE, RED, GREEN],
        disposal: 2,
      },
    ],
  });

  /** Runs a decode, and says how it ended: it must be one of these, and nothing else may be thrown. */
  const outcome = (bytes: Uint8Array): "decoded" | "INVALID_IMAGE" | "TOO_MANY_FRAMES" => {
    try {
      decodeAll(bytes);
      return "decoded";
    } catch (error) {
      if (isImageError(error, "INVALID_IMAGE")) return "INVALID_IMAGE";
      if (isImageError(error, "TOO_MANY_FRAMES")) return "TOO_MANY_FRAMES";
      throw error;
    }
  };

  it("ends a file truncated at any byte offset at its last whole frame, or refuses it", () => {
    const whole = screens(VALID);
    expect(whole).toHaveLength(3);
    // Where each frame's data ends: after the terminator of its sub-blocks.
    const ends = readGifFrames(VALID).frames.map((frame) => {
      let offset = frame.data;
      while (VALID[offset] !== 0) offset += 1 + (VALID[offset] as number);
      return offset + 1;
    });
    for (let length = 0; length < VALID.length; length += 1) {
      const cut = VALID.slice(0, length);
      const kept = ends.filter((end) => end <= length).length;
      if (kept === 0) {
        expect(outcome(cut), `${length} bytes`).toBe("INVALID_IMAGE");
      } else {
        // The frames that are whole, each exactly as the whole file has it: never a partial one.
        expect(screens(cut), `${length} bytes`).toEqual(whole.slice(0, kept));
      }
    }
  });

  it("ends with a result or a refusal for a file with any one byte changed", () => {
    for (let at = 0; at < VALID.length; at += 1) {
      for (const value of [
        0x00,
        0xff,
        (VALID[at] as number) ^ 0x01,
        (VALID[at] as number) ^ 0x80,
      ]) {
        const changed = VALID.slice();
        changed[at] = value;
        expect(["decoded", "INVALID_IMAGE", "TOO_MANY_FRAMES"]).toContain(outcome(changed));
      }
    }
  });

  it("ends with a result or a refusal for random bytes after a signature, and for random changes", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 400 }), (noise) => {
        const bytes = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...noise]);
        expect(["decoded", "INVALID_IMAGE", "TOO_MANY_FRAMES"]).toContain(outcome(bytes));
      }),
      { numRuns: 500 },
    );
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.nat(VALID.length - 1), fc.nat(255)), { minLength: 1, maxLength: 8 }),
        fc.nat(VALID.length),
        (changes, cut) => {
          const changed = VALID.slice(0, VALID.length - (cut % 6));
          for (const [at, value] of changes) if (at < changed.length) changed[at] = value;
          expect(["decoded", "INVALID_IMAGE", "TOO_MANY_FRAMES"]).toContain(outcome(changed));
        },
      ),
      { numRuns: 1_000 },
    );
  });

  it("ends for random code streams, in bounded time, with no allocation sized by them", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 1, maxLength: 2_000 }),
        fc.integer({ min: 2, max: 8 }),
        (data, codeSize) => {
          const palette = Array.from({ length: 2 ** codeSize }, (_, i) => [i, i, i] as const);
          const bytes = writeGif({
            width: 40,
            height: 40,
            palette,
            frames: [{ pixels: [], codeSize, data: [...data] }],
          });
          expect(["decoded", "INVALID_IMAGE"]).toContain(outcome(bytes));
        },
      ),
      { numRuns: 500 },
    );
  });

  it("refuses a data sub-block that runs past the end of the file, without reading past it", () => {
    const [frame] = readGifFrames(VALID).frames;
    if (!frame) throw new Error("no frame");
    const lying = VALID.slice();
    // The first sub-block claims 255 bytes.
    lying[frame.data] = 255;
    expect(outcome(lying)).toBe("INVALID_IMAGE");
    // Sub-blocks split anywhere decode the same.
    const data = lzwEncode([0, 1, 2, 3], 2);
    const split = (sizes: number[]) => {
      const parts: number[] = [];
      let at = 0;
      for (const size of sizes) {
        parts.push(size, ...data.slice(at, at + size));
        at += size;
      }
      parts.push(0);
      return parts;
    };
    expect(subBlocks(data)).toEqual(split([data.length]));
    const head = writeGif(TWO_BY_TWO);
    const table = readGifFrames(head);
    const start = table.frames[0]?.data ?? 0;
    const rebuilt = Uint8Array.from([
      ...head.slice(0, start),
      ...split([1, data.length - 1]),
      0x3b,
    ]);
    expect(screens(rebuilt)).toEqual(screens(head));
  });
});
