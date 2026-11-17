import { afterEach, describe, expect, it } from "vitest";
import { type GifFixture, lzwEncode, writeGif } from "../../test/fixtures/gif-writer.js";
import { type ImageError, isImageError } from "../core/errors/image-error.js";
import { createPlan } from "../core/model/plan.js";
import type { ImageEngine } from "../core/ports/image-engine.js";
import { readGifFrames } from "./gif/frames.js";
import { createImageEngine } from "./image-engine.js";
import { createImageProcessor } from "./image-processor.js";

/**
 * Opening a GIF through the real engine and its worker (docs/adr/0011): the
 * SDK's own decoder draws its first frame, where `createImageBitmap` used
 * to. These hold what users see to what they saw, and hostile files to an
 * error code.
 */

const RED = [255, 0, 0] as const;
const GREEN = [0, 255, 0] as const;
const BLUE = [0, 0, 255] as const;
const WHITE = [255, 255, 255] as const;
const FOUR = [RED, GREEN, BLUE, WHITE] as const;
const pattern = (width: number, height: number, colours: number) =>
  Array.from(
    { length: width * height },
    (_, i) => ((i % width) + Math.floor(i / width) * 3) % colours,
  );

const WRITTEN: Readonly<Record<string, GifFixture>> = {
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
  "an animation of three frames": {
    width: 5,
    height: 4,
    palette: FOUR,
    loop: 0,
    frames: [
      { pixels: pattern(5, 4, 4), delay: 10, disposal: 2 },
      { pixels: pattern(5, 4, 2), delay: 10, disposal: 3 },
      { x: 1, y: 1, width: 2, height: 2, pixels: [3, 3, 3, 3], delay: 10 },
    ],
  },
  "no end code": {
    width: 4,
    height: 4,
    palette: FOUR,
    frames: [{ pixels: pattern(4, 4, 4), noEnd: true }],
  },
  "a first frame larger than the screen, at its corner": {
    width: 10,
    height: 8,
    palette: FOUR,
    frames: [{ width: 16, height: 12, pixels: pattern(16, 12, 4) }],
  },
  "a first frame wider than the screen and as tall, with a transparent colour": {
    width: 10,
    height: 8,
    palette: FOUR,
    frames: [{ width: 16, height: 8, pixels: pattern(16, 8, 4), transparent: 1 }],
  },
  "a first frame larger than the screen, then one that fits the screen": {
    width: 10,
    height: 8,
    palette: FOUR,
    loop: 0,
    frames: [
      { width: 16, height: 12, pixels: pattern(16, 12, 4), delay: 10 },
      { width: 10, height: 8, pixels: pattern(10, 8, 2), delay: 10 },
    ],
  },
};

/** The GIF files the repository keeps: what the capability matrix and the end-to-end tests open. */
const FILES = ["primary.gif", "large.gif"] as const;
const fileBytes = async (name: string) =>
  new Uint8Array(
    await (await fetch(new URL(`../../e2e/fixtures/${name}`, import.meta.url))).arrayBuffer(),
  );

const engines: ImageEngine[] = [];
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.destroy();
});
function engine(): ImageEngine {
  const created = createImageEngine();
  engines.push(created);
  return created;
}

const blobOf = (bytes: Uint8Array) => new Blob([bytes.slice()], { type: "image/gif" });

async function pixelsOf(source: Blob | ImageBitmap) {
  const bitmap = source instanceof Blob ? await createImageBitmap(source) : source;
  const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d", {
    willReadFrequently: true,
  });
  if (!context) throw new Error("no 2D canvas");
  context.drawImage(bitmap, 0, 0);
  const { width, height } = bitmap;
  bitmap.close();
  return { width, height, data: context.getImageData(0, 0, width, height).data };
}

/** What opening the file and exporting it unedited gives: what the editor shows. */
async function opened(bytes: Uint8Array) {
  const own = engine();
  const file = blobOf(bytes);
  const probe = await own.probe(file);
  await own.register("s", file, probe);
  const exported = await createImageProcessor(own).export({
    plan: createPlan("s"),
    format: { type: "png" },
  });
  return { probe, pixels: await pixelsOf(exported) };
}

/** How many pixels differ, counting two fully transparent pixels as the same. */
function differing(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] === 0 && b[i + 3] === 0) continue;
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) {
      count += 1;
    }
  }
  return count;
}

describe("opening a GIF with the SDK's own decoder (docs/adr/0011)", () => {
  const cases: [string, () => Promise<Uint8Array>][] = [
    ...Object.entries(WRITTEN).map(
      ([name, fixture]) =>
        [name, async () => writeGif(fixture)] as [string, () => Promise<Uint8Array>],
    ),
    ...FILES.map((name) => [name, () => fileBytes(name)] as [string, () => Promise<Uint8Array>]),
  ];
  for (const [name, bytes] of cases) {
    it(`shows the first frame the browser's decoder showed: ${name}`, async () => {
      const file = await bytes();
      // What users saw before: the browser's own first frame.
      const before = await pixelsOf(blobOf(file));
      const { probe, pixels } = await opened(file);
      expect([pixels.width, pixels.height]).toEqual([before.width, before.height]);
      expect([probe.oriented.width, probe.oriented.height]).toEqual([before.width, before.height]);
      expect(differing(pixels.data, before.data)).toBe(0);
      // And something was drawn: this isn't two empty images agreeing.
      expect(pixels.data.some((value) => value !== 0)).toBe(true);
    });
  }
});

describe("an animated plan, before anything plays one (docs/adr/0011)", () => {
  it("is refused by the real worker, never exported as a still", async () => {
    const own = engine();
    const file = blobOf(writeGif(WRITTEN["an animation of three frames"] as GifFixture));
    const probe = await own.probe(file);
    expect(probe.frames).toBe(3);
    await own.register("s", file, probe);
    const plan = {
      ...createPlan("s"),
      animation: {
        loop: 0,
        frames: [
          { key: "a", frame: 0, delay: 10 },
          { key: "b", frame: 2, delay: 10 },
        ],
      },
    };
    // Format version 4 can say it; the renderer can't draw it yet, and says so
    // instead of drawing the first frame as if it were the plan.
    const error = await createImageProcessor(own)
      .export({ plan, format: { type: "png" } })
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
    expect(isImageError(error, "UNSUPPORTED_PLAN")).toBe(true);
    expect((error as ImageError).details?.["reason"]).toBe("animation");
  });
});

describe("a GIF with a defect browsers open (docs/adr/0011)", () => {
  const WIDTH = 12;
  const HEIGHT = 9;
  const pixels = pattern(WIDTH, HEIGHT, 4);
  const base = { width: WIDTH, height: HEIGHT, palette: FOUR } as const;
  const one = writeGif({ ...base, frames: [{ pixels }] });
  const second = { pixels: pattern(WIDTH, HEIGHT, 3), delay: 10 };
  const two = writeGif({ ...base, loop: 0, frames: [{ pixels, delay: 10 }, second] });
  const secondData = readGifFrames(two).frames[1]?.data as number;
  const withData = (data: number[]) => writeGif({ ...base, frames: [{ pixels, data }] });
  const withSecond = (frame: GifFixture["frames"][number]) =>
    writeGif({ ...base, loop: 0, frames: [{ pixels, delay: 10 }, frame] });

  /** Each defect, and how many frames are left of the file. */
  const DEFECTS: Readonly<Record<string, readonly [Uint8Array, number]>> = {
    "bytes after the trailer": [Uint8Array.from([...one, 1, 2, 3, 0x21, 0x2c, 0xff]), 1],
    "no trailer": [one.slice(0, -1), 1],
    "a block that isn't one, after the frame": [
      Uint8Array.from([...one.slice(0, -1), 0x00, 0x13, 0x37, 0x3b]),
      1,
    ],
    "more pixels than the frame": [withData(lzwEncode([...pixels, 1, 2, 3, 0, 1], 2)), 1],
    "twice the frame's pixels": [withData(lzwEncode([...pixels, ...pixels], 2)), 1],
    "bytes after the end code": [withData([...lzwEncode(pixels, 2), 9, 9, 9, 9]), 1],
    "no end code": [withData(lzwEncode(pixels, 2, false)), 1],
    "a second frame cut inside its data": [two.slice(0, secondData + 6), 1],
    "a second frame cut after its descriptor": [two.slice(0, secondData), 1],
    "a second frame cut inside its extension": [two.slice(0, secondData - 14), 1],
    "a second frame without its terminator or the trailer": [two.slice(0, -2), 1],
    "a second frame outside the screen": [withSecond({ ...second, x: 3 }), 1],
    "a reserved disposal method": [writeGif({ ...base, frames: [{ pixels, disposal: 6 }] }), 1],
    "a second frame with a reserved disposal method": [withSecond({ ...second, disposal: 4 }), 2],
    "a second frame with a code size of 12": [withSecond({ ...second, codeSize: 12 }), 1],
    "a second frame whose data is wrong": [
      withSecond({ ...second, data: lzwEncode(pixels.slice(0, 20), 2) }),
      2,
    ],
  };

  for (const [name, [bytes, frames]] of Object.entries(DEFECTS)) {
    it(`opens it as its whole first frame: ${name}`, async () => {
      const valid = await pixelsOf(blobOf(one));
      const { probe, pixels: shown } = await opened(bytes);
      expect(probe.frames).toBe(frames);
      expect(probe.decodedPixelBound).toBe(frames * WIDTH * HEIGHT);
      expect([shown.width, shown.height]).toEqual([WIDTH, HEIGHT]);
      // Exactly the sound file's frame: nothing partial, nothing from after the defect.
      expect(differing(shown.data, valid.data)).toBe(0);
    });
  }

  it("opens two colours at a code size of 1, which the format doesn't allow and files have", async () => {
    // Chromium decodes this as here, Firefox refuses it and WebKit draws
    // nothing, so it's held to the pixels written, not to a browser.
    const indexes = pattern(9, 7, 2);
    const { pixels: shown } = await opened(
      writeGif({
        width: 9,
        height: 7,
        palette: [RED, WHITE],
        frames: [{ pixels: indexes, codeSize: 1 }],
      }),
    );
    expect([...shown.data]).toEqual(
      indexes.flatMap((index) => [...(index === 0 ? RED : WHITE), 255]),
    );
  });

  it("refuses a first frame outside the screen that browsers size differently", async () => {
    const first = (width: number, height: number, x = 0, y = 0) =>
      writeGif({
        width: 10,
        height: 8,
        palette: FOUR,
        frames: [{ x, y, width, height, pixels: pattern(width, height, 4) }],
      });
    // Wider but not as tall, taller but not as wide, larger away from the
    // corner, and past the edge: Chromium makes one size of each, Firefox
    // and WebKit another.
    for (const bytes of [first(16, 6), first(6, 12), first(16, 12, 2, 3), first(8, 6, 5, 5)]) {
      const error = await engine()
        .probe(blobOf(bytes))
        .then(
          () => undefined,
          (thrown: unknown) => thrown,
        );
      expect(isImageError(error, "INVALID_IMAGE")).toBe(true);
      expect((error as ImageError).details?.["problem"]).toBe(
        "a frame doesn't fit inside the logical screen",
      );
    }
  });

  it("doesn't draw a pixel that names a colour its table doesn't have, or a frame with no table", async () => {
    const outside = await opened(
      writeGif({
        width: 3,
        height: 1,
        palette: [RED, GREEN],
        frames: [{ pixels: [0, 3, 1], codeSize: 2 }],
      }),
    );
    expect([...outside.pixels.data]).toEqual([255, 0, 0, 255, 0, 0, 0, 0, 0, 255, 0, 255]);
    const none = await opened(writeGif({ width: 2, height: 1, frames: [{ pixels: [0, 1] }] }));
    expect([...none.pixels.data]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

/**
 * Files from other decoders' test suites (test/fixtures/gif-corpus): real
 * files, and the malformed ones their bug reports came with.
 */
describe("the GIF corpus (docs/adr/0011)", () => {
  const urls = import.meta.glob<string>("../../test/fixtures/gif-corpus/*/*.gif", {
    query: "?url",
    import: "default",
    eager: true,
  });
  const files = Object.entries(urls)
    .map(([path, url]) => [path.split("/gif-corpus/")[1] as string, url] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  const load = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());

  /** The files that are refused, each with why. Everything else opens. */
  const REFUSED: Readonly<Record<string, string>> = {
    // The first frame is outside the logical screen, and isn't one at its corner
    // that covers it. Browsers disagree on these: some refuse, and those that
    // open don't agree on the image's size.
    "image/oob.gif": "a frame doesn't fit inside the logical screen",
    "image-gif/issue-117-out-of-range.gif": "a frame doesn't fit inside the logical screen",
    "image-gif/issue-96-small-codesize-2.gif": "a frame doesn't fit inside the logical screen",
    "image-gif/issue-101-infinite-empty-loop.gif": "a frame doesn't fit inside the logical screen",
    "pillow/decompression_bomb.gif": "a frame doesn't fit inside the logical screen",
    // A screen with no pixels: every browser refuses these.
    "image-gif/issue-96-small-codesize.gif": "the logical screen has no pixels",
    "pillow/zero_width.gif": "the logical screen has no pixels",
    // A code size of 11: colours past 255. Chromium refuses it.
    "pillow/issue_2811.gif": "a frame's LZW minimum code size is out of range",
    // Fifteen bytes, with no frame.
    "image/zero-loop-count.gif": "an unknown block",
  };

  /**
   * The files that open with another picture than a browser's: a frame with
   * no colour table, which Chromium and Firefox draw in colours of their
   * own, and which here draws nothing.
   */
  const OWN_PICTURE = new Set(["pillow/no_palette.gif"]);

  it("has the files this test names", () => {
    const names = files.map(([name]) => name);
    expect(names).toHaveLength(80);
    for (const name of [...Object.keys(REFUSED), ...OWN_PICTURE]) expect(names).toContain(name);
  });

  for (const [name, url] of files) {
    const why = REFUSED[name];
    if (why !== undefined) {
      it(`refuses ${name}: ${why}`, async () => {
        const own = engine();
        const error = await own.probe(blobOf(await load(url))).then(
          () => undefined,
          (thrown: unknown) => thrown,
        );
        expect(isImageError(error, "INVALID_IMAGE")).toBe(true);
        expect((error as ImageError).details?.["problem"]).toBe(why);
      });
      continue;
    }
    it(`opens ${name} as the first frame the browser's decoder shows`, async () => {
      const bytes = await load(url);
      const { probe, pixels } = await opened(bytes);
      expect(probe.frames).toBeGreaterThan(0);
      if (OWN_PICTURE.has(name)) return;
      const before = await pixelsOf(blobOf(bytes));
      expect([pixels.width, pixels.height]).toEqual([before.width, before.height]);
      expect(differing(pixels.data, before.data)).toBe(0);
    });
  }
});

describe("hostile GIFs through the real open path (docs/adr/0011)", () => {
  const VALID = writeGif({
    width: 5,
    height: 4,
    palette: FOUR,
    loop: 2,
    frames: [
      { pixels: pattern(5, 4, 4), delay: 5, disposal: 1 },
      { x: 1, y: 1, width: 3, height: 2, pixels: [0, 1, 2, 3, 0, 1], disposal: 3, transparent: 3 },
    ],
  });

  /** Opens bytes as a file, and says how it ended: it must settle, with one of these. */
  async function outcome(bytes: Uint8Array, own: ImageEngine): Promise<string> {
    const file = blobOf(bytes);
    try {
      const probe = await own.probe(file);
      await own.register(`s${Math.random()}`, file, probe);
      return "opened";
    } catch (error) {
      if (isImageError(error)) return error.code;
      throw error;
    }
  }

  it("opens the whole file, and a truncated one only once its first frame is whole", async () => {
    const own = engine();
    expect(await outcome(VALID, own)).toBe("opened");
    // Where the first frame's data ends: after the terminator of its sub-blocks.
    let whole = readGifFrames(VALID).frames[0]?.data as number;
    while (VALID[whole] !== 0) whole += 1 + (VALID[whole] as number);
    whole += 1;
    for (let length = 0; length < VALID.length; length += 1) {
      const result = await outcome(VALID.subarray(0, length), own);
      if (length >= whole) expect(result, `${length} bytes`).toBe("opened");
      // Too short to be told from another format, it's not a GIF at all.
      else expect(["INVALID_IMAGE", "UNSUPPORTED_FORMAT"], `${length} bytes`).toContain(result);
    }
    // The engine still works after every refusal.
    expect(await outcome(VALID, own)).toBe("opened");
  });

  it("refuses a first frame that isn't whole, as an invalid image, never as a decode failure", async () => {
    const own = engine();
    const broken = (data: number[]) =>
      writeGif({ width: 2, height: 2, palette: FOUR, frames: [{ pixels: [0, 0, 0, 0], data }] });
    // Fewer pixels than the frame, none, and a code that isn't defined yet:
    // the probe can't see these, and a frame is never shown partly decoded.
    for (const data of [
      lzwEncode([0, 1, 2], 2),
      lzwEncode([], 2),
      // Clear, 0, then code 7 of three bits: only 6 can be next.
      [0b11000100, 0b00000001],
    ]) {
      expect(await outcome(broken(data), own)).toBe("INVALID_IMAGE");
    }
    expect(await outcome(VALID, own)).toBe("opened");
  });

  it("settles for a file with any one byte changed, and for random bytes after a signature", async () => {
    const own = engine();
    // Opened, refused as malformed, or refused by a limit its header passed:
    // never the browser's decoder failing, which no longer sees a GIF.
    const allowed = [
      "opened",
      "INVALID_IMAGE",
      "UNSUPPORTED_FORMAT",
      "TOO_MANY_FRAMES",
      "IMAGE_DIMENSION_TOO_LARGE",
      "IMAGE_TOO_LARGE",
      "DECODED_SIZE_TOO_LARGE",
    ];
    for (let at = 0; at < VALID.length; at += 1) {
      const changed = VALID.slice();
      changed[at] = (changed[at] as number) ^ 0xff;
      expect(allowed, `byte ${at}`).toContain(await outcome(changed, own));
    }
    let seed = 7;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed & 0xff;
    };
    for (let round = 0; round < 60; round += 1) {
      const noise = Uint8Array.from([
        0x47,
        0x49,
        0x46,
        0x38,
        0x39,
        0x61,
        ...Array.from({ length: 20 + (round % 80) }, random),
      ]);
      expect(allowed, `round ${round}`).toContain(await outcome(noise, own));
    }
    expect(await outcome(VALID, own)).toBe("opened");
  });
});
