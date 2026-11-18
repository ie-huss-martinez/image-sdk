import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createGifComposer } from "./compose.js";
import { createGifWriter, MAX_FRAME_COLOURS } from "./encode.js";
import { type GifFile, readGifFrames } from "./frames.js";

/**
 * Writing a GIF (docs/adr/0011): every frame whole, with its own palette,
 * cleared before the next. What's written is read back by the SDK's own
 * decoder, which trusts nothing, so a file the writer makes is one the
 * reader opens.
 */

const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];
const BLUE = [0, 0, 255, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];
const rgba = (...pixels: number[][]) => Uint8ClampedArray.from(pixels.flat());

/** A file's table, and every frame composed, as lists of RGBA pixels. */
function read(bytes: Uint8Array): { file: GifFile; frames: number[][][] } {
  const file = readGifFrames(bytes);
  const composer = createGifComposer(bytes, file);
  const frames = file.frames.map(() => {
    const screen = composer.next();
    const pixels: number[][] = [];
    for (let i = 0; i < screen.length; i += 4) pixels.push([...screen.subarray(i, i + 4)]);
    return pixels;
  });
  return { file, frames };
}

function written(
  frames: readonly (readonly [Uint8ClampedArray, number])[],
  options: { width: number; height: number; loop: number | null },
): Uint8Array {
  const writer = createGifWriter(options);
  for (const [pixels, delay] of frames) writer.frame(pixels, delay);
  return writer.finish();
}

describe("writing a GIF (docs/adr/0011)", () => {
  it("writes frames the decoder reads back: the size, the count, the pixels", () => {
    const first = rgba(RED, GREEN, BLUE, WHITE, RED, GREEN);
    const second = rgba(WHITE, WHITE, RED, RED, BLUE, BLUE);
    const { file, frames } = read(
      written(
        [
          [first, 10],
          [second, 20],
        ],
        { width: 3, height: 2, loop: 0 },
      ),
    );
    expect(file).toMatchObject({ width: 3, height: 2, complete: true });
    expect(file.frames).toHaveLength(2);
    expect(frames[0]).toEqual([RED, GREEN, BLUE, WHITE, RED, GREEN]);
    expect(frames[1]).toEqual([WHITE, WHITE, RED, RED, BLUE, BLUE]);
  });

  it("writes every frame whole, cleared before the next, with its own colours", () => {
    const { file } = read(
      written(
        [
          [rgba(RED, GREEN), 1],
          [rgba(BLUE, WHITE), 1],
          [rgba(RED, RED), 1],
        ],
        { width: 2, height: 1, loop: null },
      ),
    );
    for (const frame of file.frames) {
      expect(frame).toMatchObject({
        x: 0,
        y: 0,
        width: 2,
        height: 1,
        disposal: 2,
        interlaced: false,
      });
    }
  });

  it("leaves no ghost: what one frame drew isn't under the next frame's transparent pixels", () => {
    // The second frame is transparent where the first was opaque.
    const { frames } = read(
      written(
        [
          [rgba(RED, RED, RED, RED), 5],
          [rgba(CLEAR, GREEN, CLEAR, CLEAR), 5],
          [rgba(BLUE, CLEAR, CLEAR, CLEAR), 5],
        ],
        { width: 2, height: 2, loop: 0 },
      ),
    );
    expect(frames[1]).toEqual([CLEAR, GREEN, CLEAR, CLEAR]);
    expect(frames[2]).toEqual([BLUE, CLEAR, CLEAR, CLEAR]);
  });

  it("writes a pixel under half opaque as transparent, and any other as opaque", () => {
    const { frames, file } = read(
      written(
        [[rgba([10, 200, 30, 0], [10, 200, 30, 127], [10, 200, 30, 128], [10, 200, 30, 255]), 1]],
        { width: 4, height: 1, loop: null },
      ),
    );
    expect(frames[0]).toEqual([CLEAR, CLEAR, [10, 200, 30, 255], [10, 200, 30, 255]]);
    // The transparent colour is index 0, and no opaque pixel uses it.
    expect(file.frames[0]?.transparent).toBe(0);
  });

  it("marks no colour transparent in a frame with no transparent pixel, and writes one that's all transparent", () => {
    const { file, frames } = read(
      written(
        [
          [rgba(RED, GREEN), 1],
          [rgba(CLEAR, CLEAR), 1],
        ],
        { width: 2, height: 1, loop: null },
      ),
    );
    expect(file.frames[0]?.transparent).toBeNull();
    expect(file.frames[1]?.transparent).toBe(0);
    expect(frames[1]).toEqual([CLEAR, CLEAR]);
  });

  it("writes each delay and the loop count as they're given", () => {
    const frame = rgba(RED);
    const delays = [0, 1, 7, 100, 65_535];
    for (const loop of [null, 0, 1, 3, 65_535]) {
      const { file } = read(
        written(
          delays.map((delay) => [frame, delay] as const),
          { width: 1, height: 1, loop },
        ),
      );
      expect(file.loop, `loop ${loop}`).toBe(loop);
      expect(file.frames.map((each) => each.delay)).toEqual(delays);
    }
  });

  it("writes a still as a GIF of one frame", () => {
    const { file, frames } = read(
      written([[rgba(WHITE, BLUE), 0]], { width: 1, height: 2, loop: null }),
    );
    expect(file.frames).toHaveLength(1);
    expect(file.loop).toBeNull();
    expect(frames[0]).toEqual([WHITE, BLUE]);
  });

  it("keeps up to 255 distinct colours exactly, and never more than 255 beside the transparent one", () => {
    // 255 colours far enough apart to stay distinct, and a transparent pixel.
    const colours = Array.from({ length: MAX_FRAME_COLOURS }, (_, i) => [
      (i % 8) * 36,
      (Math.floor(i / 8) % 8) * 36,
      Math.floor(i / 64) * 80,
      255,
    ]);
    const exact = read(
      written([[rgba(...colours, CLEAR), 1]], { width: 16, height: 16, loop: null }),
    );
    expect(exact.frames[0]).toEqual([...colours, CLEAR]);
    // 4,096 colours: more than a frame can hold. Each pixel gets a near colour, and stays opaque.
    const many = Array.from({ length: 4_096 }, (_, i) => [
      (i % 16) * 17,
      (Math.floor(i / 16) % 16) * 17,
      Math.floor(i / 256) * 17,
      255,
    ]);
    const { file, frames } = read(
      written([[rgba(...many), 1]], { width: 64, height: 64, loop: null }),
    );
    const used = new Set(frames[0]?.map((pixel) => pixel.join(",")));
    expect(used.size).toBeLessThanOrEqual(MAX_FRAME_COLOURS);
    expect(used.size).toBeGreaterThan(200);
    expect(frames[0]?.every((pixel) => pixel[3] === 255)).toBe(true);
    let worst = 0;
    frames[0]?.forEach((pixel, i) => {
      for (let c = 0; c < 3; c += 1) {
        worst = Math.max(
          worst,
          Math.abs((pixel[c] as number) - ((many[i] as number[])[c] as number)),
        );
      }
    });
    // Sixteen levels a channel, 17 apart, into 255 colours: within a few levels.
    expect(worst).toBeLessThanOrEqual(68);
    expect(file.frames[0]?.transparent).toBeNull();
  });

  it("reads back any frames of a few colours exactly, whatever their size and number", () => {
    const palette = [RED, GREEN, BLUE, WHITE, CLEAR, [40, 40, 40, 255], [250, 200, 20, 255]];
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 5 }),
        fc.infiniteStream(fc.nat(palette.length - 1)),
        fc.option(fc.nat(65_535), { nil: null }),
        (width, height, count, picks, loop) => {
          const frames = Array.from({ length: count }, () =>
            [...picks.take(width * height)].map((pick) => palette[pick] as number[]),
          );
          const { file, frames: back } = read(
            written(
              frames.map((pixels, n) => [rgba(...pixels), n * 3] as const),
              { width, height, loop },
            ),
          );
          expect(back).toEqual(frames);
          expect(file.frames.map((frame) => frame.delay)).toEqual(frames.map((_, n) => n * 3));
          expect(file.loop).toBe(loop);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("doesn't change or keep the pixels it's given", () => {
    const pixels = rgba([1, 2, 3, 200], [4, 5, 6, 100]);
    const copy = pixels.slice();
    const writer = createGifWriter({ width: 2, height: 1, loop: null });
    writer.frame(pixels, 1);
    expect([...pixels]).toEqual([...copy]);
    // Changing them afterwards doesn't change what was written.
    pixels.fill(0);
    expect(read(writer.finish()).frames[0]).toEqual([[1, 2, 3, 255], CLEAR]);
  });

  it("refuses what isn't a frame of the file, and a file with no frame", () => {
    expect(() => createGifWriter({ width: 0, height: 1, loop: null })).toThrow(RangeError);
    expect(() => createGifWriter({ width: 1, height: 65_536, loop: null })).toThrow(RangeError);
    expect(() => createGifWriter({ width: 1, height: 1, loop: -1 })).toThrow(RangeError);
    expect(() => createGifWriter({ width: 1, height: 1, loop: 65_536 })).toThrow(RangeError);
    const writer = createGifWriter({ width: 2, height: 1, loop: null });
    expect(() => writer.frame(rgba(RED), 1)).toThrow(RangeError);
    for (const delay of [-1, 65_536, 1.5]) {
      expect(() => writer.frame(rgba(RED, RED), delay)).toThrow(RangeError);
    }
    expect(() => writer.finish()).toThrow(RangeError);
    expect(writer.frames).toBe(0);
    writer.frame(rgba(RED, RED), 1);
    expect(writer.frames).toBe(1);
    expect(writer.finish().length).toBeGreaterThan(0);
    // Finished: no more frames, and no second file.
    expect(() => writer.frame(rgba(RED, RED), 1)).toThrow();
    expect(() => writer.finish()).toThrow();
  });
});
