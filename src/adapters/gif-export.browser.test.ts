import { afterEach, describe, expect, it } from "vitest";
import StalledJobWorker from "../../test/browser/fixtures/stalled-job.worker.ts?worker";
import { type GifFixture, writeGif } from "../../test/fixtures/gif-writer.js";
import { type ImageError, isImageError } from "../core/errors/image-error.js";
import { imageLimits } from "../core/errors/image-limits.js";
import { createPlan, type ImagePlan } from "../core/model/plan.js";
import type { ImageEngine } from "../core/ports/image-engine.js";
import type { ImageProcessor } from "../core/ports/image-processor.js";
import { createGifComposer } from "./gif/compose.js";
import { readGifFrames } from "./gif/frames.js";
import { createEngine, createImageEngine } from "./image-engine.js";
import { createImageProcessor } from "./image-processor.js";
import { createInlineJobWorker } from "./job-worker/inline-job-worker.js";
import { createInlineWorker } from "./render-worker/inline-worker.js";

/**
 * Exporting to GIF through the real engine, its render worker and the job
 * worker (docs/adr/0011): every frame of the plan, whole, with its timing,
 * read back by the SDK's own decoder and held to the frames the processor
 * exports one at a time as PNG.
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

const ANIMATION: GifFixture = {
  width: 12,
  height: 9,
  palette: FOUR,
  loop: 2,
  frames: [
    { pixels: pattern(12, 9, 4), delay: 10, disposal: 1 },
    {
      x: 2,
      y: 1,
      width: 6,
      height: 5,
      pixels: pattern(6, 5, 4, 1),
      transparent: 1,
      delay: 0,
      disposal: 2,
    },
    { x: 5, y: 3, width: 7, height: 6, pixels: pattern(7, 6, 4, 2), delay: 25, disposal: 3 },
    { pixels: pattern(12, 9, 4, 3), delay: 7 },
  ],
};

const engines: ImageEngine[] = [];
const processors: ImageProcessor[] = [];
afterEach(async () => {
  for (const processor of processors.splice(0)) await processor.destroy();
  for (const engine of engines.splice(0)) await engine.destroy();
});
const blobOf = (bytes: Uint8Array) => new Blob([bytes.slice()], { type: "image/gif" });

async function opened(bytes: Uint8Array, own: ImageEngine = createImageEngine()) {
  engines.push(own);
  const file = blobOf(bytes);
  await own.register("s", file, await own.probe(file), { frames: "all" });
  const processor = createImageProcessor(own);
  processors.push(processor);
  return { own, processor };
}

/** A plan that plays these frames of the source, with these delays. */
const playing = (
  frames: readonly (readonly [number, number])[],
  loop: number | null = 0,
): ImagePlan => ({
  ...createPlan("s"),
  animation: {
    loop,
    frames: frames.map(([frame, delay], index) => ({ key: `k${index}`, frame, delay })),
  },
});

/** A GIF's frames as our decoder composes them, with its table. */
async function framesOf(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const file = readGifFrames(bytes);
  const composer = createGifComposer(bytes, file);
  return { file, bytes, frames: file.frames.map(() => composer.next().slice()) };
}

async function pixelsOf(blob: Blob): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(blob);
  const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d", {
    willReadFrequently: true,
  });
  if (!context) throw new Error("no 2D canvas");
  context.drawImage(bitmap, 0, 0);
  const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return data;
}

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

describe("exporting to GIF (docs/adr/0011)", () => {
  it("writes every frame of the plan, in its order, with its delays and loop count", async () => {
    const { processor } = await opened(writeGif(ANIMATION));
    // Reordered, repeated and trimmed, with delays of the plan's own.
    const plan = playing(
      [
        [3, 4],
        [0, 0],
        [0, 65_535],
        [2, 11],
      ],
      7,
    );
    const seen: number[] = [];
    const gif = await processor.export(
      { plan, format: { type: "gif" } },
      { onProgress: (fraction) => seen.push(fraction) },
    );
    expect(gif.type).toBe("image/gif");
    const { file, frames } = await framesOf(gif);
    expect([file.width, file.height]).toEqual([12, 9]);
    expect(file.loop).toBe(7);
    expect(file.frames.map((frame) => frame.delay)).toEqual([4, 0, 65_535, 11]);
    // Each frame, whole and cleared before the next.
    for (const frame of file.frames) {
      expect(frame).toMatchObject({ x: 0, y: 0, width: 12, height: 9, disposal: 2 });
    }
    // Each is the frame the processor exports on its own, as PNG.
    for (const index of [0, 1, 2, 3]) {
      const png = await pixelsOf(
        await processor.export({ plan, format: { type: "png" }, frame: index }),
      );
      expect(differing(frames[index] as Uint8ClampedArray, png), `frame ${index}`).toBe(0);
    }
    // Progress moves forward, by frame, to 1.
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen.at(-1)).toBe(1);
    expect(seen.length).toBeGreaterThanOrEqual(5);
  });

  it("writes a still as a GIF of one frame that plays once", async () => {
    const { processor } = await opened(writeGif(ANIMATION));
    const still = createPlan("s");
    const { file, frames } = await framesOf(
      await processor.export({ plan: still, format: { type: "gif" } }),
    );
    expect(file.frames).toHaveLength(1);
    expect(file.loop).toBeNull();
    const png = await pixelsOf(await processor.export({ plan: still, format: { type: "png" } }));
    expect(differing(frames[0] as Uint8ClampedArray, png)).toBe(0);
  });

  it("applies the rest of the plan to every frame: a crop and a turn", async () => {
    const { processor } = await opened(writeGif(ANIMATION));
    const base = playing([
      [0, 5],
      [1, 5],
      [2, 5],
    ]);
    const plan: ImagePlan = {
      ...base,
      base: {
        ...base.base,
        crop: { x: 2, y: 1, width: 8, height: 6 },
        orientation: { rotate: 90, flipX: false, flipY: false },
      },
    };
    const { file, frames } = await framesOf(
      await processor.export({ plan, format: { type: "gif" } }),
    );
    expect([file.width, file.height]).toEqual([6, 8]);
    for (const index of [0, 1, 2]) {
      const png = await pixelsOf(
        await processor.export({ plan, format: { type: "png" }, frame: index }),
      );
      expect(differing(frames[index] as Uint8ClampedArray, png), `frame ${index}`).toBe(0);
    }
  });

  it("writes the same bytes for two files that differ only inside a redaction, in every frame or in one", async () => {
    const region = { x: 3, y: 2, width: 5, height: 4 };
    const inside = (index: number, width: number) => {
      const x = index % width;
      const y = Math.floor(index / width);
      return (
        x >= region.x &&
        x < region.x + region.width &&
        y >= region.y &&
        y < region.y + region.height
      );
    };
    // Whole frames, so a pixel's place in the frame is its place in the scene.
    const whole = (shift: number, changed: (frame: number) => boolean): GifFixture => ({
      width: 12,
      height: 9,
      palette: FOUR,
      loop: 0,
      frames: [0, 1, 2].map((frame) => ({
        pixels: pattern(12, 9, 4, frame).map((value, i) =>
          changed(frame) && inside(i, 12) ? (value + shift) % 4 : value,
        ),
        delay: 3,
      })),
    });
    const redacted = (plan: ImagePlan): ImagePlan => ({
      ...plan,
      redactions: [{ key: "r", mode: "solid", ...region, colour: "#102030" }],
    });
    const plan = redacted(
      playing([
        [0, 3],
        [1, 3],
        [2, 3],
      ]),
    );
    for (const changed of [() => true, (frame: number) => frame === 1]) {
      const exports: Uint8Array[] = [];
      for (const shift of [0, 1]) {
        const { processor } = await opened(writeGif(whole(shift, changed)));
        exports.push(
          new Uint8Array(
            await (await processor.export({ plan, format: { type: "gif" } })).arrayBuffer(),
          ),
        );
      }
      expect(exports[0]).toEqual(exports[1]);
      // And the region is the redaction's colour in every frame.
      const { frames } = await framesOf(new Blob([(exports[0] as Uint8Array).slice()]));
      for (const frame of frames) {
        const at = (region.y * 12 + region.x) * 4;
        expect([...frame.subarray(at, at + 4)]).toEqual([16, 32, 48, 255]);
      }
    }
  });

  it("is bounded before it starts: every frame of the output against maxDecodedSize", async () => {
    const { processor } = await opened(writeGif(ANIMATION));
    const plan = playing([
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    // Four frames of 12 × 9 × 4 bytes: 1,728 bytes. One frame is 432.
    const filePolicy = imageLimits.resolve({ maxDecodedSize: 1_000 });
    const error = await processor.export({ plan, format: { type: "gif" } }, { filePolicy }).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(isImageError(error, "DECODED_SIZE_TOO_LARGE")).toBe(true);
    expect((error as ImageError).details).toMatchObject({ actual: 1_728, maximum: 1_000 });
    // The same plan as one frame of PNG is within it.
    expect(
      (await processor.export({ plan, format: { type: "png" } }, { filePolicy })).size,
    ).toBeGreaterThan(0);
    // And all four within a limit that holds them.
    const gif = await processor.export(
      { plan, format: { type: "gif" } },
      { filePolicy: imageLimits.resolve({ maxDecodedSize: 1_728 }) },
    );
    expect((await framesOf(gif)).file.frames).toHaveLength(4);
  });

  it("can be cancelled between frames, and the next export works", async () => {
    // Enough frames that the cancel lands before the last.
    const long: GifFixture = {
      width: 160,
      height: 120,
      palette: FOUR,
      loop: 0,
      frames: Array.from({ length: 30 }, (_, n) => ({ pixels: pattern(160, 120, 4, n), delay: 2 })),
    };
    const { processor } = await opened(writeGif(long));
    const plan = playing(Array.from({ length: 30 }, (_, n) => [n, 2] as const));
    const controller = new AbortController();
    const seen: number[] = [];
    const error = await processor
      .export(
        { plan, format: { type: "gif" } },
        {
          signal: controller.signal,
          onProgress: (fraction) => {
            seen.push(fraction);
            if (seen.length === 2) controller.abort();
          },
        },
      )
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
    expect(isImageError(error, "ABORTED")).toBe(true);
    expect(seen.length).toBeLessThan(30);
    const again = await processor.export({
      plan: playing([
        [0, 1],
        [29, 1],
      ]),
      format: { type: "gif" },
    });
    expect((await framesOf(again)).file.frames).toHaveLength(2);
  });

  it("terminates a job worker that doesn't answer a cancel, and starts another for the next export", async () => {
    let started = 0;
    const engine = createEngine({
      loadWorker: async () => createInlineWorker,
      version: __IMAGE_SDK_VERSION__,
      // The first job worker never answers a frame; the ones after are real.
      loadJobWorker: async () => ({
        start: () => {
          started += 1;
          return started === 1
            ? new StalledJobWorker({ name: "hm-image-job" })
            : createInlineJobWorker();
        },
        asset: "inline",
      }),
    });
    const { processor } = await opened(writeGif(ANIMATION), engine);
    const plan = playing([
      [0, 1],
      [1, 1],
    ]);
    const controller = new AbortController();
    const stalled = processor.export(
      { plan, format: { type: "gif" } },
      { signal: controller.signal },
    );
    // Cancelled while the job worker holds the first frame and says nothing.
    setTimeout(() => controller.abort(), 200);
    const error = await stalled.then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(isImageError(error)).toBe(true);
    // The render worker, which holds the source, is untouched: the next export works.
    const gif = await processor.export({ plan, format: { type: "gif" } });
    expect((await framesOf(gif)).file.frames).toHaveLength(2);
    expect(started).toBe(2);
    // An export that finishes keeps its job worker for the next: no third one starts.
    await processor.export({ plan, format: { type: "gif" } });
    expect(started).toBe(2);
  });

  it("loads the job worker from the host's assets when the engine is self-hosted", async () => {
    const { processor } = await opened(
      writeGif(ANIMATION),
      createImageEngine({ assetsUrl: "/hm-test-assets/" }),
    );
    const gif = await processor.export({
      plan: playing([
        [1, 3],
        [0, 3],
      ]),
      format: { type: "gif" },
    });
    expect((await framesOf(gif)).file.frames.map((frame) => frame.delay)).toEqual([3, 3]);
  });
});
