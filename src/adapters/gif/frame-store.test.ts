import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type GifFixture, lzwEncode, writeGif } from "../../../test/fixtures/gif-writer.js";
import { isImageError } from "../../core/errors/image-error.js";
import { createGifComposer } from "./compose.js";
import { createGifFrameStore, GIF_CACHE_BYTES } from "./frame-store.js";
import { readGifFrames } from "./frames.js";

/**
 * The frame store (docs/adr/0011): any frame of a GIF, composed, from a
 * cache bounded in bytes. Whatever the cache holds and whatever order
 * frames are asked for in, a frame is the one playing through from the
 * start gives.
 */

const PALETTE = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 255],
] as const;
const WIDTH = 6;
const HEIGHT = 5;
const SCREEN = WIDTH * HEIGHT * 4;

/** Twelve frames that depend on each other: every disposal method, small frames, transparency. */
const ANIMATION: GifFixture = {
  width: WIDTH,
  height: HEIGHT,
  palette: PALETTE,
  loop: 0,
  frames: Array.from({ length: 12 }, (_, n) => {
    const width = 2 + (n % 4);
    const height = 1 + (n % 5);
    return {
      x: n % (WIDTH - width + 1),
      y: n % (HEIGHT - height + 1),
      width,
      height,
      pixels: Array.from({ length: width * height }, (_, i) => (i + n) % 4),
      delay: n,
      disposal: n % 4,
      ...(n % 3 === 0 ? { transparent: n % 4 } : {}),
    };
  }),
};
const BYTES = writeGif(ANIMATION);
const FILE = readGifFrames(BYTES);

/** Every frame, by playing through from the start: what any access must match. */
function played(bytes: Uint8Array): number[][] {
  const file = readGifFrames(bytes);
  const composer = createGifComposer(bytes, file);
  return file.frames.map(() => [...composer.next()]);
}
const EXPECTED = played(BYTES);

describe("the GIF frame store (docs/adr/0011)", () => {
  it("gives every frame as playing from the start does, whatever its cache holds", () => {
    // No cache, one screen, a few, and room for every frame twice over.
    for (const cacheBytes of [0, SCREEN, SCREEN * 2, SCREEN * 5, SCREEN * 100]) {
      const store = createGifFrameStore(BYTES, FILE, { cacheBytes });
      expect(store.frames).toBe(12);
      for (let index = 0; index < 12; index += 1) {
        expect([...store.frame(index)], `forward, ${cacheBytes}`).toEqual(EXPECTED[index]);
      }
      for (let index = 11; index >= 0; index -= 1) {
        expect([...store.frame(index)], `backward, ${cacheBytes}`).toEqual(EXPECTED[index]);
      }
      expect(store.cached).toBeLessThanOrEqual(cacheBytes);
    }
  });

  it("gives any frame in any order, within its cache's bound", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: SCREEN * 30 }),
        fc.array(fc.nat(11), { minLength: 1, maxLength: 40 }),
        (cacheBytes, order) => {
          const store = createGifFrameStore(BYTES, FILE, { cacheBytes });
          for (const index of order) {
            expect([...store.frame(index)]).toEqual(EXPECTED[index]);
            expect(store.cached).toBeLessThanOrEqual(cacheBytes);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("plans its cache from the file: every frame when there's room, spaced when there isn't", () => {
    // This file has frames that restore, so a snapshot may be two screens.
    expect(createGifFrameStore(BYTES, FILE, { cacheBytes: SCREEN * 24 }).spacing).toBe(1);
    expect(createGifFrameStore(BYTES, FILE, { cacheBytes: SCREEN * 12 }).spacing).toBe(2);
    expect(createGifFrameStore(BYTES, FILE, { cacheBytes: SCREEN * 4 }).spacing).toBe(6);
    expect(createGifFrameStore(BYTES, FILE, { cacheBytes: SCREEN * 2 }).spacing).toBe(12);
    expect(createGifFrameStore(BYTES, FILE, { cacheBytes: SCREEN }).spacing).toBe(0);
    // A file with no frame that restores needs one screen for each snapshot.
    const plain = writeGif({
      ...ANIMATION,
      frames: ANIMATION.frames.map((frame) => ({ ...frame, disposal: 1 })),
    });
    const table = readGifFrames(plain);
    expect(createGifFrameStore(plain, table, { cacheBytes: SCREEN * 12 }).spacing).toBe(1);
    expect(createGifFrameStore(plain, table, { cacheBytes: SCREEN * 3 }).spacing).toBe(4);
    // The default holds 64 MiB.
    expect(GIF_CACHE_BYTES).toBe(67_108_864);
    expect(createGifFrameStore(BYTES, FILE).spacing).toBe(1);
  });

  it("decodes one frame for each frame played, none for a frame asked for again, and a bounded few for a jump", () => {
    const store = createGifFrameStore(BYTES, FILE, { cacheBytes: SCREEN * 8 });
    expect(store.spacing).toBe(3);
    for (let index = 0; index < 12; index += 1) store.frame(index);
    expect(store.decoded).toBe(12);
    store.frame(11);
    expect(store.decoded).toBe(12);
    // Once played through, a jump anywhere costs less than the spacing.
    for (const index of [0, 7, 2, 10, 4, 9, 1, 5, 11, 3, 8, 6]) {
      const before = store.decoded;
      expect([...store.frame(index)]).toEqual(EXPECTED[index]);
      expect(store.decoded - before, `to frame ${index}`).toBeLessThan(3);
    }
    // A snapshot's own frame costs nothing.
    store.frame(11);
    const before = store.decoded;
    store.frame(6);
    expect(store.decoded).toBe(before);
    // With room for every frame, nothing is decoded twice.
    const roomy = createGifFrameStore(BYTES, FILE, { cacheBytes: SCREEN * 100 });
    for (const index of [11, 0, 5, 11, 3, 3, 9, 0]) roomy.frame(index);
    expect(roomy.decoded).toBe(12);
  });

  it("with no cache, goes back by playing again from the start", () => {
    const store = createGifFrameStore(BYTES, FILE, { cacheBytes: 0 });
    store.frame(8);
    expect(store.decoded).toBe(9);
    store.frame(9);
    expect(store.decoded).toBe(10);
    store.frame(4);
    expect(store.decoded).toBe(15);
    expect(store.cached).toBe(0);
  });

  it("refuses a frame the file doesn't have", () => {
    const store = createGifFrameStore(BYTES, FILE);
    for (const index of [-1, 12, 1.5, Number.NaN]) {
      expect(() => store.frame(index)).toThrow(RangeError);
    }
  });

  it("fails at a frame that can't be decoded, and still gives the frames before it", () => {
    const broken = writeGif({
      ...ANIMATION,
      frames: ANIMATION.frames.map((frame, n) =>
        n === 7 ? { ...frame, data: lzwEncode(frame.pixels.slice(0, 1), 2) } : frame,
      ),
    });
    const expected = EXPECTED.slice(0, 7);
    for (const cacheBytes of [0, SCREEN * 4, SCREEN * 100]) {
      const store = createGifFrameStore(broken, readGifFrames(broken), { cacheBytes });
      // Asked for directly, for one after it, and again: an error code each time, never a partial frame.
      for (const index of [7, 10, 7]) {
        let error: unknown;
        try {
          store.frame(index);
        } catch (thrown) {
          error = thrown;
        }
        expect(isImageError(error, "INVALID_IMAGE"), `${index}`).toBe(true);
      }
      for (const index of [6, 0, 3, 6]) {
        expect([...store.frame(index)], `${index}, ${cacheBytes}`).toEqual(expected[index]);
      }
    }
  });
});
