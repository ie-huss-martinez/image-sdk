import { describe, expect, it } from "vitest";
import { type GifFixture, writeGif } from "../../../test/fixtures/gif-writer.js";
import { createGifWriter } from "./encode.js";
import { createGifFrameStore } from "./frame-store.js";
import { readGifFrames } from "./frames.js";

/**
 * Every frame of an animation, as our decoder composes it and as the
 * browser's does (docs/adr/0011). A worker sees a browser's later frames
 * only through WebCodecs' `ImageDecoder`, which the three pinned engines
 * have. These hold composition, frame by frame, to what users see play in
 * a page: each disposal method, the reserved ones among them, and the
 * files of the corpus.
 */

const RED = [255, 0, 0] as const;
const GREEN = [0, 255, 0] as const;
const BLUE = [0, 0, 255] as const;
const WHITE = [255, 255, 255] as const;
const FOUR = [RED, GREEN, BLUE, WHITE] as const;
const pattern = (width: number, height: number, colours: number, shift = 0) =>
  Array.from(
    { length: width * height },
    (_, i) => ((i % width) + Math.floor(i / width) * 3 + shift) % colours,
  );

/** Every frame of a file, as the browser's decoder composes them. */
async function byTheBrowser(bytes: Uint8Array): Promise<Uint8ClampedArray[]> {
  const decoder = new ImageDecoder({ data: bytes.slice().buffer, type: "image/gif" });
  // The tracks are known once the data is read: before that, a count of 0.
  await decoder.tracks.ready;
  await decoder.completed;
  const count = decoder.tracks.selectedTrack?.frameCount ?? 0;
  const frames: Uint8ClampedArray[] = [];
  for (let frameIndex = 0; frameIndex < count; frameIndex += 1) {
    const { image } = await decoder.decode({ frameIndex });
    const context = new OffscreenCanvas(image.displayWidth, image.displayHeight).getContext("2d", {
      willReadFrequently: true,
    });
    if (!context) throw new Error("no 2D canvas");
    context.drawImage(image, 0, 0);
    frames.push(context.getImageData(0, 0, image.displayWidth, image.displayHeight).data);
    image.close();
  }
  decoder.close();
  return frames;
}

/** How many pixels differ, counting two fully transparent pixels as the same. */
function differing(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] === 0 && b[i + 3] === 0) continue;
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) {
      count += 1;
    }
  }
  return count;
}

/**
 * Checks every frame against the browser's, last frame first and through a
 * cache of two screens, so the frames come from snapshots and replays, not
 * from one pass.
 */
async function sameFrames(bytes: Uint8Array): Promise<number> {
  const file = readGifFrames(bytes);
  const theirs = await byTheBrowser(bytes);
  expect(file.frames.length).toBe(theirs.length);
  const store = createGifFrameStore(bytes, file, { cacheBytes: file.width * file.height * 4 * 2 });
  for (let index = file.frames.length - 1; index >= 0; index -= 1) {
    expect(
      differing(store.frame(index), theirs[index] as Uint8ClampedArray),
      `frame ${index}`,
    ).toBe(0);
  }
  return file.frames.length;
}

describe("every frame, composed as the browser composes it (docs/adr/0011)", () => {
  it("has ImageDecoder to compare with", () => {
    expect(typeof ImageDecoder).toBe("function");
  });

  // What's left where a frame was, for each disposal method: 0 and 1 keep
  // it, 2 clears it, 3 restores what was under it, and of the reserved
  // ones 4 restores and 5 to 7 keep.
  for (let disposal = 0; disposal <= 7; disposal += 1) {
    it(`disposes of a frame as the browser does: method ${disposal}`, async () => {
      const bytes = writeGif({
        width: 8,
        height: 8,
        palette: FOUR,
        loop: 0,
        frames: [
          { pixels: pattern(8, 8, 2), delay: 10, disposal: 1 },
          // Over part of the first, with a colour it leaves undrawn.
          {
            x: 1,
            y: 2,
            width: 6,
            height: 5,
            pixels: pattern(6, 5, 4, 1),
            transparent: 0,
            delay: 10,
            disposal,
          },
          { x: 0, y: 0, width: 3, height: 3, pixels: pattern(3, 3, 4, 2), delay: 10, disposal: 1 },
          { x: 4, y: 4, width: 4, height: 4, pixels: pattern(4, 4, 3), delay: 10, disposal },
          { x: 2, y: 2, width: 2, height: 2, pixels: [3, 3, 3, 3], delay: 10 },
        ],
      });
      expect(await sameFrames(bytes)).toBe(5);
      // And the method made a difference where it should: the pixel under
      // the second frame, once the third is shown.
      const file = readGifFrames(bytes);
      const third = createGifFrameStore(bytes, file).frame(2);
      const at = (6 * 8 + 6) * 4;
      const under = pattern(8, 8, 2)[6 * 8 + 6] === 0 ? RED : GREEN;
      const over = FOUR[pattern(6, 5, 4, 1)[4 * 6 + 5] as number] as readonly number[];
      const expected =
        disposal === 2
          ? [0, 0, 0, 0]
          : disposal === 3 || disposal === 4
            ? [...under, 255]
            : [...over, 255];
      expect([...third.subarray(at, at + 4)]).toEqual(expected);
    });
  }

  const ANIMATIONS: Readonly<Record<string, GifFixture>> = {
    "frames that each replace the last": {
      width: 5,
      height: 4,
      palette: FOUR,
      loop: 0,
      frames: [0, 1, 2, 3].map((n) => ({ pixels: pattern(5, 4, 4, n), delay: 5 })),
    },
    "small frames over a first, with a transparent colour": {
      width: 9,
      height: 7,
      palette: FOUR,
      loop: 3,
      frames: [
        { pixels: pattern(9, 7, 4), delay: 5 },
        { x: 2, y: 1, width: 4, height: 3, pixels: pattern(4, 3, 4, 1), transparent: 1, delay: 5 },
        { x: 5, y: 3, width: 4, height: 4, pixels: pattern(4, 4, 4, 2), transparent: 2, delay: 5 },
        { x: 0, y: 5, width: 9, height: 2, pixels: pattern(9, 2, 4, 3), delay: 5 },
      ],
    },
    "a first frame smaller than the screen, then frames that clear": {
      width: 8,
      height: 6,
      palette: FOUR,
      frames: [
        { x: 2, y: 1, width: 4, height: 3, pixels: pattern(4, 3, 4), delay: 5, disposal: 2 },
        { x: 0, y: 0, width: 5, height: 5, pixels: pattern(5, 5, 4, 1), delay: 5, disposal: 2 },
        { x: 3, y: 2, width: 5, height: 4, pixels: pattern(5, 4, 4, 2), delay: 5 },
      ],
    },
    "interlaced frames with their own colour tables": {
      width: 7,
      height: 9,
      palette: FOUR,
      frames: [
        { pixels: pattern(7, 9, 4), interlaced: true, delay: 5, disposal: 3 },
        { pixels: pattern(7, 9, 2, 1), interlaced: true, palette: [BLUE, WHITE], delay: 5 },
        {
          x: 1,
          y: 1,
          width: 5,
          height: 7,
          pixels: pattern(5, 7, 4, 2),
          interlaced: true,
          delay: 5,
        },
      ],
    },
    "a first frame that restores, with nothing under it": {
      width: 4,
      height: 4,
      palette: FOUR,
      frames: [
        { pixels: pattern(4, 4, 4), delay: 5, disposal: 3 },
        { x: 1, y: 1, width: 2, height: 2, pixels: [0, 1, 2, 3], delay: 5 },
      ],
    },
  };
  for (const [name, fixture] of Object.entries(ANIMATIONS)) {
    it(`plays the same frames: ${name}`, async () => {
      expect(await sameFrames(writeGif(fixture))).toBe(fixture.frames.length);
    });
  }
});

/** A GIF the SDK writes (docs/adr/0011) is one every browser plays as it was written. */
describe("a GIF the SDK writes, read by the browser (docs/adr/0011)", () => {
  it("plays the frames that were written: their pixels, their transparency, with no ghost", async () => {
    const width = 9;
    const height = 7;
    const colours = [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [250, 200, 20, 255],
      [0, 0, 0, 0],
    ];
    // Three frames: opaque, then transparent where the first drew, then mixed.
    const frames = [0, 1, 2].map((n) =>
      Array.from({ length: width * height }, (_, i) => {
        if (n === 0) return colours[i % 4] as number[];
        if (n === 1) return (i % 3 === 0 ? colours[4] : colours[(i + 1) % 4]) as number[];
        return colours[(i * 2 + n) % 5] as number[];
      }),
    );
    const writer = createGifWriter({ width, height, loop: 3 });
    frames.forEach((pixels, n) => {
      writer.frame(Uint8ClampedArray.from(pixels.flat()), 5 + n);
    });
    const bytes = writer.finish();
    const theirs = await byTheBrowser(bytes);
    expect(theirs).toHaveLength(3);
    for (const [n, pixels] of frames.entries()) {
      expect(
        differing(Uint8ClampedArray.from(pixels.flat()), theirs[n] as Uint8ClampedArray),
        `frame ${n}`,
      ).toBe(0);
    }
    // And as the SDK's own decoder reads it.
    expect(await sameFrames(bytes)).toBe(3);
    // The first frame, by the still decoder every browser has.
    const bitmap = await createImageBitmap(new Blob([bytes.slice()], { type: "image/gif" }));
    expect([bitmap.width, bitmap.height]).toEqual([width, height]);
    bitmap.close();
  });
});

/** The corpus's animations (test/fixtures/gif-corpus): every frame of each. */
describe("the corpus's animations, frame by frame (docs/adr/0011)", () => {
  const urls = import.meta.glob<string>("../../../test/fixtures/gif-corpus/*/*.gif", {
    query: "?url",
    import: "default",
    eager: true,
  });
  const files = Object.entries(urls)
    .map(([path, url]) => [path.split("/gif-corpus/")[1] as string, url] as const)
    .sort(([a], [b]) => a.localeCompare(b));

  const load = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());

  /**
   * Frames with no colour table, their own or the file's: Chromium and
   * Firefox draw them in colours of their own, and here they draw nothing.
   */
  const OWN_PICTURE = new Set(["pillow/no_palette.gif", "pillow/no_palette_after_rgb.gif"]);

  it("plays every frame of each as the browser does", async () => {
    let animations = 0;
    let frames = 0;
    for (const [name, url] of files) {
      const bytes = await load(url);
      let file: ReturnType<typeof readGifFrames>;
      try {
        file = readGifFrames(bytes);
      } catch {
        // Refused: gif-open.browser.test.ts names each of those, with its reason.
        continue;
      }
      if (file.frames.length < 2) continue;
      animations += 1;
      frames += file.frames.length;
      const theirs = await byTheBrowser(bytes);
      // The same frames, where the file's frames end.
      expect(file.frames.length, name).toBe(theirs.length);
      if (OWN_PICTURE.has(name)) continue;
      const store = createGifFrameStore(bytes, file, {
        cacheBytes: file.width * file.height * 4 * 2,
      });
      for (let index = file.frames.length - 1; index >= 0; index -= 1) {
        expect(
          differing(store.frame(index), theirs[index] as Uint8ClampedArray),
          `${name}, frame ${index}`,
        ).toBe(0);
      }
    }
    // The corpus hasn't shrunk under the test.
    expect([animations, frames]).toEqual([36, 144]);
  });
});
