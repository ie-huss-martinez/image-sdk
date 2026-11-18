import { describe, expect, it } from "vitest";
import { type GifFixture, lzwEncode, writeGif } from "../../../test/fixtures/gif-writer.js";
import { isImageError } from "../../core/errors/image-error.js";
import { createGifComposer } from "./compose.js";
import { readGifFrames } from "./frames.js";
import { checkGifFrames } from "./source.js";

/**
 * Holding a GIF with all its frames (docs/adr/0011): each is decoded once
 * when the file is opened, and the animation ends at the frame before the
 * first that can't be.
 */

const PALETTE = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 255],
] as const;
const FRAMES = 6;
const ANIMATION: GifFixture = {
  width: 5,
  height: 4,
  palette: PALETTE,
  loop: 3,
  frames: Array.from({ length: FRAMES }, (_, n) => ({
    pixels: Array.from({ length: 20 }, (_, i) => (i + n) % 4),
    delay: n * 7,
    disposal: n % 4,
  })),
};
const BYTES = writeGif(ANIMATION);
const live = () => new AbortController().signal;
const check = (bytes: Uint8Array, options: Partial<Parameters<typeof checkGifFrames>[2]> = {}) =>
  checkGifFrames(bytes, readGifFrames(bytes), { signal: live(), ...options });

describe("checking a GIF's frames (docs/adr/0011)", () => {
  it("holds every frame of a sound file, with the file's timing", async () => {
    const seen: [number, number][] = [];
    const source = await check(BYTES, { progress: (done, total) => seen.push([done, total]) });
    expect(source).toMatchObject({
      width: 5,
      height: 4,
      frames: FRAMES,
      incomplete: false,
      loop: 3,
      delays: [0, 7, 14, 21, 28, 35],
    });
    // One report for each frame, in order.
    expect(seen).toEqual(Array.from({ length: FRAMES }, (_, n) => [n + 1, FRAMES]));
    // And every frame is the one playing through gives.
    const composer = createGifComposer(BYTES, readGifFrames(BYTES));
    for (let index = 0; index < FRAMES; index += 1) {
      expect([...source.store.frame(index)]).toEqual([...composer.next()]);
    }
  });

  it("counts what it holds: the file, a screen, and the cache at its fullest", async () => {
    const source = await check(BYTES);
    const screen = 5 * 4 * 4;
    // Three of these frames restore, so a snapshot may be two screens.
    expect(source.bytes).toBe(BYTES.byteLength + screen + FRAMES * screen * 2);
  });

  it("ends at the frame before one that can't be decoded, and says the file was incomplete", async () => {
    for (const bad of [1, 3, 5]) {
      const bytes = writeGif({
        ...ANIMATION,
        frames: ANIMATION.frames.map((frame, n) =>
          n === bad ? { ...frame, data: lzwEncode(frame.pixels.slice(0, 3), 2) } : frame,
        ),
      });
      const seen: number[] = [];
      const source = await check(bytes, { progress: (done) => seen.push(done) });
      expect(source.frames, `frame ${bad}`).toBe(bad);
      expect(source.incomplete).toBe(true);
      expect(source.delays).toHaveLength(bad);
      // Nothing is reported for the frame that failed, or for those after it.
      expect(seen).toEqual(Array.from({ length: bad }, (_, n) => n + 1));
      // The frames it holds can all be drawn.
      for (let index = 0; index < bad; index += 1) expect(source.store.frame(index)).toBeDefined();
    }
  });

  it("refuses a file whose first frame can't be decoded: there's nothing to open", async () => {
    const bytes = writeGif({
      ...ANIMATION,
      frames: ANIMATION.frames.map((frame, n) =>
        n === 0 ? { ...frame, data: lzwEncode(frame.pixels.slice(0, 3), 2) } : frame,
      ),
    });
    const error = await check(bytes).catch((thrown: unknown) => thrown);
    expect(isImageError(error, "INVALID_IMAGE")).toBe(true);
  });

  it("says a file that ends before its trailer is incomplete, with the frames it has", async () => {
    expect(readGifFrames(BYTES).complete).toBe(true);
    const cut = BYTES.slice(0, -1);
    expect(readGifFrames(cut).complete).toBe(false);
    const source = await check(cut);
    expect(source).toMatchObject({ frames: FRAMES, incomplete: true });
    // Cut inside the last frame: the frames before it.
    const shorter = await check(BYTES.slice(0, -4));
    expect(shorter).toMatchObject({ frames: FRAMES - 1, incomplete: true });
  });

  it("stops when it's cancelled, before the next frame", async () => {
    // Already cancelled: nothing is decoded.
    const aborted = new AbortController();
    aborted.abort(new DOMException("stop", "AbortError"));
    const seen: number[] = [];
    await expect(
      check(BYTES, { signal: aborted.signal, progress: (done) => seen.push(done) }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(seen).toEqual([]);
    // Cancelled while it runs, as a message would between two frames.
    const controller = new AbortController();
    const reported: number[] = [];
    await expect(
      check(BYTES, {
        signal: controller.signal,
        progress: (done) => {
          reported.push(done);
          if (done === 2) controller.abort(new DOMException("stop", "AbortError"));
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(reported).toEqual([1, 2]);
  });

  it("pauses for other work once a slice of decoding has taken long enough, and only then", async () => {
    // A clock that moves 5 ms for each frame: a pause after every third.
    let time = 0;
    let pauses = 0;
    const paused: number[] = [];
    let done = 0;
    await check(BYTES, {
      now: () => time,
      progress: (frames) => {
        done = frames;
        time += 5;
      },
      pause: async () => {
        pauses += 1;
        paused.push(done);
      },
    });
    expect(paused).toEqual([3]);
    expect(pauses).toBe(1);
    // A fast decode never pauses; a slow one pauses between every two frames, never after the last.
    let quick = 0;
    await check(BYTES, {
      now: () => 0,
      pause: async () => {
        quick += 1;
      },
    });
    expect(quick).toBe(0);
    let slow = 0;
    let clock = 0;
    await check(BYTES, {
      now: () => {
        clock += 100;
        return clock;
      },
      pause: async () => {
        slow += 1;
      },
    });
    expect(slow).toBe(FRAMES - 1);
  });

  it("sees a cancel that arrives during a pause", async () => {
    const controller = new AbortController();
    const reported: number[] = [];
    let clock = 0;
    await expect(
      check(BYTES, {
        signal: controller.signal,
        now: () => {
          clock += 100;
          return clock;
        },
        progress: (frames) => reported.push(frames),
        pause: async () => controller.abort(new DOMException("stop", "AbortError")),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(reported).toEqual([1]);
  });
});
