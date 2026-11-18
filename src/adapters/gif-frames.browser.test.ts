import { afterEach, describe, expect, it } from "vitest";
import { type GifFixture, lzwEncode, writeGif } from "../../test/fixtures/gif-writer.js";
import { type ImageError, isImageError } from "../core/errors/image-error.js";
import { imageLimits } from "../core/errors/image-limits.js";
import { createPlan, type ImagePlan } from "../core/model/plan.js";
import type { ImageEngine } from "../core/ports/image-engine.js";
import { fittedView } from "../core/ports/image-renderer.js";
import { createImageEngine, engineInternals } from "./image-engine.js";
import { createImageProcessor } from "./image-processor.js";
import { createImageRenderer, rendererInternals } from "./image-renderer.js";

/**
 * A GIF held with all its frames, through the real engine and its worker
 * (docs/adr/0011): registering checks every frame, and the processor and
 * the renderer draw any one of a plan's frames. Each frame is held to what
 * the browser's own decoder composes.
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

/** Five frames that depend on each other: small frames, transparency, each way of disposing. */
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
      disposal: 3,
    },
    { x: 5, y: 3, width: 7, height: 6, pixels: pattern(7, 6, 4, 2), delay: 25, disposal: 2 },
    { x: 0, y: 0, width: 4, height: 4, pixels: pattern(4, 4, 4, 3), delay: 65_535, disposal: 1 },
    { x: 3, y: 2, width: 8, height: 6, pixels: pattern(8, 6, 3), transparent: 0, delay: 7 },
  ],
};
const BYTES = writeGif(ANIMATION);

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

async function pixelsOf(source: Blob | ImageBitmap | VideoFrame) {
  const image = source instanceof Blob ? await createImageBitmap(source) : source;
  const width = "displayWidth" in image ? image.displayWidth : image.width;
  const height = "displayHeight" in image ? image.displayHeight : image.height;
  const context = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2D canvas");
  context.drawImage(image, 0, 0);
  image.close();
  return { width, height, data: context.getImageData(0, 0, width, height).data };
}

/** Every frame of a file, as the browser's decoder composes them. */
async function byTheBrowser(bytes: Uint8Array) {
  const decoder = new ImageDecoder({ data: bytes.slice().buffer, type: "image/gif" });
  await decoder.tracks.ready;
  await decoder.completed;
  const count = decoder.tracks.selectedTrack?.frameCount ?? 0;
  const frames: Uint8ClampedArray[] = [];
  for (let frameIndex = 0; frameIndex < count; frameIndex += 1) {
    frames.push((await pixelsOf((await decoder.decode({ frameIndex })).image)).data);
  }
  decoder.close();
  return frames;
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

/** A plan that plays the source's first `count` frames in order. */
const playing = (count: number, id = "s"): ImagePlan => ({
  ...createPlan(id),
  animation: {
    loop: 0,
    frames: Array.from({ length: count }, (_, frame) => ({ key: `f${frame}`, frame, delay: 10 })),
  },
});

async function held(bytes: Uint8Array, own = engine()) {
  const file = blobOf(bytes);
  const probe = await own.probe(file);
  const info = await own.register("s", file, probe, { frames: "all" });
  return { own, info, probe };
}

/** Waits until the worker itself has no source with this id: its bitmap was closed and dropped. */
async function expectReleased(own: ImageEngine, id: string) {
  const internals = engineInternals(own);
  if (!internals) throw new Error("not the SDK's engine");
  const deadline = Date.now() + 5_000;
  for (;;) {
    const held = await internals.call("thumbnail", { id, maxSize: 4 }).then(
      (bitmap) => {
        bitmap.close();
        return true;
      },
      () => false,
    );
    if (!held) return;
    if (Date.now() > deadline) throw new Error(`the worker still holds "${id}"`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("a GIF held with all its frames (docs/adr/0011)", () => {
  it("registers every frame, with the file's timing and what it holds", async () => {
    const { info, probe } = await held(BYTES);
    expect(probe.frames).toBe(5);
    expect(info).toMatchObject({
      format: "gif",
      width: 12,
      height: 9,
      frames: 5,
      incomplete: false,
      timing: { loop: 2, delays: [10, 0, 25, 65_535, 7] },
    });
    // The first frame's bitmap, the file, a screen and the cache's ceiling:
    // far under every frame held at once for a long animation, and counted.
    const screen = 12 * 9 * 4;
    expect(info.decodedBytes).toBe(screen + BYTES.byteLength + screen + 5 * screen * 2);
  });

  it("holds the first frame only, as a still, unless it's asked for all", async () => {
    const own = engine();
    const file = blobOf(BYTES);
    const info = await own.register("s", file, await own.probe(file));
    expect(info).toMatchObject({ frames: 1, timing: null, incomplete: false });
    expect(info.decodedBytes).toBe(12 * 9 * 4);
    // And a file with one frame is a still either way.
    const single = blobOf(writeGif({ ...ANIMATION, frames: ANIMATION.frames.slice(0, 1) }));
    const still = await own.register("t", single, await own.probe(single), { frames: "all" });
    expect(still).toMatchObject({ frames: 1, timing: null, incomplete: false });
  });

  it("reports each frame as it's checked, and ends at 1", async () => {
    const own = engine();
    const file = blobOf(BYTES);
    const probe = await own.probe(file);
    const seen: number[] = [];
    await own.register("s", file, probe, {
      frames: "all",
      onProgress: (fraction) => seen.push(fraction),
    });
    // A fifth for each frame, in order; then 1 again as the call resolves.
    expect(seen).toEqual([0.2, 0.4, 0.6, 0.8, 1, 1]);
  });

  it("exports each frame as the browser's decoder composes it", async () => {
    const { own } = await held(BYTES);
    const theirs = await byTheBrowser(BYTES);
    expect(theirs).toHaveLength(5);
    const processor = createImageProcessor(own);
    const plan = playing(5);
    // Not in order: each frame is reached on its own.
    for (const frame of [3, 0, 4, 1, 2, 4, 0]) {
      const exported = await pixelsOf(
        await processor.export({ plan, format: { type: "png" }, frame }),
      );
      expect([exported.width, exported.height]).toEqual([12, 9]);
      expect(differing(exported.data, theirs[frame] as Uint8ClampedArray), `frame ${frame}`).toBe(
        0,
      );
    }
    // No frame given is the first.
    const first = await pixelsOf(await processor.export({ plan, format: { type: "png" } }));
    expect(differing(first.data, theirs[0] as Uint8ClampedArray)).toBe(0);
  });

  it("shows the plan's frame, not the source's: reordered, repeated and trimmed", async () => {
    const { own } = await held(BYTES);
    const theirs = await byTheBrowser(BYTES);
    const processor = createImageProcessor(own);
    const order = [4, 4, 1, 0];
    const plan: ImagePlan = {
      ...createPlan("s"),
      animation: {
        loop: null,
        frames: order.map((frame, index) => ({ key: `k${index}`, frame, delay: 1 })),
      },
    };
    for (const [index, frame] of order.entries()) {
      const exported = await pixelsOf(
        await processor.export({ plan, format: { type: "png" }, frame: index }),
      );
      expect(differing(exported.data, theirs[frame] as Uint8ClampedArray), `at ${index}`).toBe(0);
    }
  });

  it("applies the rest of the plan to the frame shown", async () => {
    const { own } = await held(BYTES);
    const theirs = await byTheBrowser(BYTES);
    const processor = createImageProcessor(own);
    const base = playing(5);
    const plan: ImagePlan = {
      ...base,
      base: { ...base.base, crop: { x: 3, y: 2, width: 6, height: 4 } },
    };
    const exported = await pixelsOf(
      await processor.export({ plan, format: { type: "png" }, frame: 2 }),
    );
    expect([exported.width, exported.height]).toEqual([6, 4]);
    const frame = theirs[2] as Uint8ClampedArray;
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 6; x += 1) {
        const from = ((y + 2) * 12 + (x + 3)) * 4;
        const to = (y * 6 + x) * 4;
        const clear = frame[from + 3] === 0 && exported.data[to + 3] === 0;
        if (!clear) {
          expect([...exported.data.subarray(to, to + 4)], `${x}, ${y}`).toEqual([
            ...frame.subarray(from, from + 4),
          ]);
        }
      }
    }
  });

  it("draws the frame a view shows in the preview", async () => {
    const { own } = await held(BYTES);
    const theirs = await byTheBrowser(BYTES);
    const renderer = createImageRenderer(own);
    const canvas = document.createElement("canvas");
    await renderer.attach(canvas);
    try {
      const plan = playing(5);
      // At one pixel for each pixel, with nothing around the image.
      const view = { ...fittedView(12, 9), inset: 0 };
      for (const frame of [2, 0, 4]) {
        expect(await renderer.render(plan, { ...view, frame })).toBe("drawn");
        // The page can't read a canvas it transferred: the worker hands back a copy.
        const copy = await rendererInternals(renderer)?.snapshot();
        if (!copy) throw new Error("no snapshot");
        const shown = await pixelsOf(copy);
        expect([shown.width, shown.height]).toEqual([12, 9]);
        const expected = theirs[frame] as Uint8ClampedArray;
        // The stage is opaque under a transparent pixel, so only drawn pixels are compared.
        let different = 0;
        let drawn = 0;
        for (let i = 0; i < expected.length; i += 4) {
          if (expected[i + 3] === 0) continue;
          drawn += 1;
          if (
            shown.data[i] !== expected[i] ||
            shown.data[i + 1] !== expected[i + 1] ||
            shown.data[i + 2] !== expected[i + 2]
          ) {
            different += 1;
          }
        }
        expect(different, `frame ${frame}`).toBe(0);
        expect(drawn).toBeGreaterThan(0);
      }
      await expect(renderer.render(plan, { ...view, frame: 5 })).rejects.toBeInstanceOf(RangeError);
    } finally {
      await renderer.destroy();
    }
  });

  it("refuses a frame the plan doesn't have, before the worker", async () => {
    const { own } = await held(BYTES);
    const processor = createImageProcessor(own);
    for (const frame of [5, -1, 1.5, Number.NaN]) {
      await expect(
        processor.export({ plan: playing(5), format: { type: "png" }, frame }),
      ).rejects.toBeInstanceOf(RangeError);
    }
    // A still has only frame 0.
    await expect(
      processor.export({ plan: createPlan("s"), format: { type: "png" }, frame: 1 }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("ends at the frame before one that can't be decoded, and never draws past it", async () => {
    const broken = writeGif({
      ...ANIMATION,
      frames: ANIMATION.frames.map((frame, n) =>
        n === 3 ? { ...frame, data: lzwEncode(frame.pixels.slice(0, 2), 2) } : frame,
      ),
    });
    const seen: number[] = [];
    const own = engine();
    const file = blobOf(broken);
    const probe = await own.probe(file);
    // The probe can't see it: the table lists five frames.
    expect(probe.frames).toBe(5);
    const info = await own.register("s", file, probe, {
      frames: "all",
      onProgress: (fraction) => seen.push(fraction),
    });
    expect(info).toMatchObject({
      frames: 3,
      incomplete: true,
      timing: { loop: 2, delays: [10, 0, 25] },
    });
    expect(seen).toEqual([0.2, 0.4, 0.6, 1]);
    const processor = createImageProcessor(own);
    const theirs = await byTheBrowser(
      writeGif({ ...ANIMATION, frames: ANIMATION.frames.slice(0, 3) }),
    );
    for (const frame of [2, 0, 1]) {
      const exported = await pixelsOf(
        await processor.export({ plan: playing(3), format: { type: "png" }, frame }),
      );
      expect(differing(exported.data, theirs[frame] as Uint8ClampedArray), `frame ${frame}`).toBe(
        0,
      );
    }
    // A plan that names the frame that failed, or one after it, is refused, not drawn as another.
    for (const frame of [3, 4]) {
      const error = await processor
        .export({ plan: playing(5), format: { type: "png" }, frame })
        .then(
          () => undefined,
          (thrown: unknown) => thrown,
        );
      expect(isImageError(error, "UNSUPPORTED_PLAN")).toBe(true);
      expect((error as ImageError).details?.["reason"]).toBe("animation");
    }
  });

  it("says a file with no trailer is incomplete, and holds its whole frames", async () => {
    const { info } = await held(BYTES.slice(0, -1));
    expect(info).toMatchObject({ frames: 5, incomplete: true });
  });

  it("can be cancelled while its frames are checked, and leaves the engine usable", async () => {
    // Enough frames that the check is still running when the cancel arrives.
    const long = writeGif({
      width: 200,
      height: 150,
      palette: FOUR,
      loop: 0,
      frames: Array.from({ length: 60 }, (_, n) => ({ pixels: pattern(200, 150, 4, n), delay: 2 })),
    });
    const own = engine();
    const file = blobOf(long);
    const probe = await own.probe(file);
    const controller = new AbortController();
    const seen: number[] = [];
    const error = await own
      .register("s", file, probe, {
        frames: "all",
        signal: controller.signal,
        onProgress: (fraction) => {
          seen.push(fraction);
          if (seen.length === 1) controller.abort();
        },
      })
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
    expect(isImageError(error, "ABORTED")).toBe(true);
    // It stopped well before the last frame.
    expect(seen.length).toBeLessThan(60);
    // The id is free again, and the same file registers.
    const info = await own.register("s", file, probe, { frames: "all" });
    expect(info.frames).toBe(60);
  });

  it("answers another call while a file's frames are checked", async () => {
    const long = writeGif({
      width: 200,
      height: 150,
      palette: FOUR,
      loop: 0,
      frames: Array.from({ length: 60 }, (_, n) => ({ pixels: pattern(200, 150, 4, n), delay: 2 })),
    });
    const own = engine();
    const small = blobOf(BYTES);
    await own.register("small", small, await own.probe(small));
    const file = blobOf(long);
    const probe = await own.probe(file);
    let checked = 0;
    let answeredAt = -1;
    const registering = own.register("s", file, probe, {
      frames: "all",
      onProgress: () => {
        checked += 1;
      },
    });
    // A thumbnail of another source, asked for while the check runs.
    const thumbnail = own.thumbnail("small", 8).then((bitmap) => {
      answeredAt = checked;
      bitmap.close();
    });
    await Promise.all([registering, thumbnail]);
    // It was answered before the last frame was checked: the check let it in.
    expect(answeredAt).toBeGreaterThanOrEqual(0);
    expect(answeredAt).toBeLessThan(60);
  });

  it("refuses to hold all the frames of a file whose screen is over maxAnimationPixels", async () => {
    const own = engine();
    const file = blobOf(BYTES);
    const probe = await own.probe(file);
    // 12 × 9 is 108 pixels.
    const filePolicy = imageLimits.resolve({ maxAnimationPixels: 100 });
    const error = await own.register("s", file, probe, { frames: "all", filePolicy }).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(isImageError(error, "ANIMATION_TOO_LARGE")).toBe(true);
    expect((error as ImageError).details).toMatchObject({
      limit: "maxAnimationPixels",
      maximum: 100,
      actual: 108,
    });
    // As its first frame it registers under the same policy: the limit is on animations.
    const still = await own.register("s", file, probe, { filePolicy });
    expect(still).toMatchObject({ frames: 1, timing: null });
    // And at the limit exactly, with all its frames.
    const at = await own.register("t", file, probe, {
      frames: "all",
      filePolicy: imageLimits.resolve({ maxAnimationPixels: 108 }),
    });
    expect(at.frames).toBe(5);
  });

  it("holds a file over an animation's limits as its first frame, and refuses it only with all its frames", async () => {
    const own = engine();
    const file = blobOf(BYTES);
    const probe = await own.probe(file);
    // Five frames of 12 × 9: over four frames, and over 1,000 bytes across them.
    for (const [overrides, code] of [
      [{ maxFrames: 4 }, "TOO_MANY_FRAMES"],
      [{ maxDecodedSize: 1_000 }, "DECODED_SIZE_TOO_LARGE"],
    ] as const) {
      const filePolicy = imageLimits.resolve(overrides);
      const error = await own.register("all", file, probe, { frames: "all", filePolicy }).then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
      expect(isImageError(error, code), code).toBe(true);
      // As a still it counts one frame, and registers.
      const still = await own.register(`still-${code}`, file, probe, { filePolicy });
      expect(still).toMatchObject({ frames: 1, timing: null, width: 12, height: 9 });
    }
    // But not when its first frame alone is over a limit.
    const small = imageLimits.resolve({ maxDecodedSize: 400 });
    const error = await own.register("small", file, probe, { filePolicy: small }).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(isImageError(error, "DECODED_SIZE_TOO_LARGE")).toBe(true);
  });

  it("opens the first frame of a file with more frames than any animation holds", async () => {
    // 4,097 frames of one pixel: one more than the frame table keeps.
    const many = writeGif({
      width: 3,
      height: 2,
      palette: FOUR,
      loop: 0,
      frames: [
        { pixels: pattern(3, 2, 4), delay: 1 },
        ...Array.from({ length: 4_096 }, () => ({
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          pixels: [1],
          delay: 1,
        })),
      ],
    });
    const own = engine();
    const file = blobOf(many);
    const probe = await own.probe(file);
    expect(probe.frames).toBe(4_097);
    // The default policy allows 300 frames: as a still, it isn't asked.
    const still = await own.register("s", file, probe);
    expect(still).toMatchObject({ frames: 1, width: 3, height: 2 });
    const exported = await pixelsOf(
      await createImageProcessor(own).export({ plan: createPlan("s"), format: { type: "png" } }),
    );
    const first = await pixelsOf(
      blobOf(
        writeGif({ width: 3, height: 2, palette: FOUR, frames: [{ pixels: pattern(3, 2, 4) }] }),
      ),
    );
    expect(differing(exported.data, first.data)).toBe(0);
    // With all its frames it's refused, whatever the policy allows.
    const generous = imageLimits.resolve({ maxFrames: 10_000 });
    const error = await own
      .register("all", file, probe, { frames: "all", filePolicy: generous })
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
    expect(isImageError(error, "TOO_MANY_FRAMES")).toBe(true);
  });

  it("lets the first frame be drawn as a still while the rest are checked, and nothing more", async () => {
    // Enough frames that the check is still running once the first is ready.
    const long = writeGif({
      width: 160,
      height: 120,
      palette: FOUR,
      loop: 0,
      frames: Array.from({ length: 60 }, (_, n) => ({ pixels: pattern(160, 120, 4, n), delay: 2 })),
    });
    const own = engine();
    const file = blobOf(long);
    const probe = await own.probe(file);
    const renderer = createImageRenderer(own);
    const canvas = document.createElement("canvas");
    await renderer.attach(canvas);
    const processor = createImageProcessor(own);
    let firstFrame = 0;
    let checked = 0;
    let drawnEarly: Promise<unknown> | undefined;
    let exportEarly: Promise<unknown> | undefined;
    const registering = own.register("s", file, probe, {
      frames: "all",
      onProgress: () => {
        checked += 1;
      },
      onFirstFrame: () => {
        firstFrame += 1;
        // Drawn as a still now: its first frame.
        drawnEarly = renderer.render(createPlan("s"), { ...fittedView(160, 120), inset: 0 });
        // Not exported, and not animated, yet: it isn't registered.
        exportEarly = processor.export({ plan: createPlan("s"), format: { type: "png" } }).then(
          () => "exported",
          (error: unknown) => (error instanceof TypeError ? "refused" : String(error)),
        );
      },
    });
    await registering;
    expect(firstFrame).toBe(1);
    expect(await drawnEarly).toBe("drawn");
    expect(await exportEarly).toBe("refused");
    expect(checked).toBeGreaterThan(1);
    const copy = await rendererInternals(renderer)?.snapshot();
    if (!copy) throw new Error("no snapshot");
    const shown = await pixelsOf(copy);
    const first = await pixelsOf(
      blobOf(
        writeGif({
          width: 160,
          height: 120,
          palette: FOUR,
          frames: [{ pixels: pattern(160, 120, 4, 0) }],
        }),
      ),
    );
    expect(differing(shown.data, first.data)).toBe(0);
    await renderer.destroy();
  });

  it("can't be drawn early once its registration is cancelled", async () => {
    const long = writeGif({
      width: 160,
      height: 120,
      palette: FOUR,
      loop: 0,
      frames: Array.from({ length: 60 }, (_, n) => ({ pixels: pattern(160, 120, 4, n), delay: 2 })),
    });
    const own = engine();
    const file = blobOf(long);
    const probe = await own.probe(file);
    const renderer = createImageRenderer(own);
    await renderer.attach(document.createElement("canvas"));
    const controller = new AbortController();
    const error = await own
      .register("s", file, probe, {
        frames: "all",
        signal: controller.signal,
        onFirstFrame: () => controller.abort(),
      })
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
    expect(isImageError(error, "ABORTED")).toBe(true);
    await expect(
      renderer.render(createPlan("s"), { ...fittedView(160, 120), inset: 0 }),
    ).rejects.toBeInstanceOf(TypeError);
    // And the worker let its first frame's bitmap go: asked for it directly,
    // past the page's own check, it has no such source.
    await expectReleased(own, "s");
    await renderer.destroy();
  });

  it("frees a source's frames when it's released", async () => {
    const { own } = await held(BYTES);
    await own.release("s");
    const processor = createImageProcessor(own);
    await expect(
      processor.export({ plan: playing(5), format: { type: "png" }, frame: 1 }),
    ).rejects.toBeInstanceOf(TypeError);
    // Registered again as a still, it no longer plays.
    const file = blobOf(BYTES);
    await own.register("s", file, await own.probe(file));
    const error = await processor
      .export({ plan: playing(5), format: { type: "png" }, frame: 1 })
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
    expect(isImageError(error, "UNSUPPORTED_PLAN")).toBe(true);
  });
});
