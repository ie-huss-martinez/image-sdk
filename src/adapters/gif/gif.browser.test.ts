import { describe, expect, it } from "vitest";
import { type GifFixture, writeGif } from "../../../test/fixtures/gif-writer.js";
import { createGifComposer } from "./compose.js";
import { readGifFrames } from "./frames.js";

const RED = [255, 0, 0] as const;
const GREEN = [0, 255, 0] as const;
const BLUE = [0, 0, 255] as const;
const WHITE = [255, 255, 255] as const;
const FOUR = [RED, GREEN, BLUE, WHITE] as const;

/** A file's first frame, as the browser's own decoder draws it. */
async function byTheBrowser(bytes: Uint8Array): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(new Blob([bytes.slice()], { type: "image/gif" }));
  const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d", {
    willReadFrequently: true,
  });
  if (!context) throw new Error("no 2D canvas");
  context.drawImage(bitmap, 0, 0);
  const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return data;
}

/** A file's first frame, as our decoder composes it. */
function byOurs(bytes: Uint8Array): Uint8ClampedArray {
  return createGifComposer(bytes, readGifFrames(bytes)).next();
}

/** Indexes for a `width × height` frame that vary along both axes. */
const pattern = (width: number, height: number, colours: number) =>
  Array.from(
    { length: width * height },
    (_, i) => ((i % width) + Math.floor(i / width) * 3) % colours,
  );

const FIXTURES: Readonly<Record<string, GifFixture>> = {
  "one opaque frame": {
    width: 6,
    height: 5,
    palette: FOUR,
    frames: [{ pixels: pattern(6, 5, 4) }],
  },
  "a transparent colour": {
    width: 6,
    height: 5,
    palette: FOUR,
    frames: [{ pixels: pattern(6, 5, 4), transparent: 2 }],
  },
  "an interlaced frame": {
    width: 7,
    height: 11,
    palette: FOUR,
    frames: [{ pixels: pattern(7, 11, 4), interlaced: true }],
  },
  "a frame's own colour table": {
    width: 4,
    height: 4,
    palette: FOUR,
    frames: [{ pixels: pattern(4, 4, 2), palette: [BLUE, WHITE] }],
  },
  "a frame smaller than the screen": {
    width: 8,
    height: 6,
    palette: FOUR,
    frames: [{ x: 2, y: 1, width: 4, height: 3, pixels: pattern(4, 3, 4) }],
  },
  "256 colours, through a table that fills": {
    width: 80,
    height: 80,
    palette: Array.from({ length: 256 }, (_, i) => [i, 255 - i, (i * 7) % 256] as const),
    frames: [{ pixels: Array.from({ length: 6_400 }, (_, i) => (i * 37 + (i >> 3)) % 256) }],
  },
  "the first of an animation's frames": {
    width: 4,
    height: 4,
    palette: FOUR,
    loop: 0,
    frames: [
      { pixels: pattern(4, 4, 4), delay: 10, disposal: 2 },
      { pixels: pattern(4, 4, 2), delay: 10 },
    ],
  },
};

describe("our GIF decoder and the browser's (docs/adr/0011)", () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    it(`draws the same first frame: ${name}`, async () => {
      const bytes = writeGif(fixture);
      const ours = byOurs(bytes);
      const theirs = await byTheBrowser(bytes);
      expect(ours.length).toBe(theirs.length);
      // Every pixel is opaque or transparent, so nothing is premultiplied away.
      let different = 0;
      for (let i = 0; i < ours.length; i += 4) {
        const clear = ours[i + 3] === 0 && theirs[i + 3] === 0;
        if (clear) continue;
        for (let channel = 0; channel < 4; channel += 1) {
          if (ours[i + channel] !== theirs[i + channel]) {
            different += 1;
            break;
          }
        }
      }
      expect(different).toBe(0);
      // And it isn't two empty images agreeing.
      expect(ours.some((value) => value !== 0)).toBe(true);
    });
  }

  it("leaves the screen outside a small frame transparent, as the browser does", async () => {
    const bytes = writeGif(FIXTURES["a frame smaller than the screen"] as GifFixture);
    const ours = byOurs(bytes);
    const theirs = await byTheBrowser(bytes);
    // The top-left pixel is outside the frame.
    expect([...ours.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    expect(theirs[3]).toBe(0);
  });
});
