import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { concat, exif, pngChunk } from "../../test/fixtures/image-writers.js";
import { isImageError } from "../core/errors/image-error.js";
import { imageLimits } from "../core/errors/image-limits.js";
import { cropRect } from "../core/model/geometry.js";
import {
  createPlan,
  type ImageCrop,
  type ImagePlan,
  type ImageRedaction,
  NEUTRAL_DEVELOP,
} from "../core/model/plan.js";
import { type ImageRect, redactionBlocksInScene } from "../core/model/redaction-geometry.js";
import type { ImageEngine } from "../core/ports/image-engine.js";
import type { ImageExportFormat, ImageProcessor } from "../core/ports/image-processor.js";
import { fittedView, type ImageRenderer, type ImageView } from "../core/ports/image-renderer.js";
import { encodePlan } from "./export/encode.js";
import { drawPreview } from "./export/preview.js";
import { createImageEngine } from "./image-engine.js";
import { createImageProcessor } from "./image-processor.js";
import { createImageRenderer, rendererInternals } from "./image-renderer.js";

/**
 * The proof that redaction destroys pixels (docs/adr/0010): two sources
 * that differ only inside a region export to the same bytes. Equal files
 * leave nowhere for the redacted pixels to be: not in the image, a
 * thumbnail, metadata or any other chunk.
 */

const WIDTH = 64;
const HEIGHT = 48;
const WHOLE: ImageRect = { x: 0, y: 0, width: WIDTH, height: HEIGHT };

/** Opaque noise, the same for the same seed. */
function noise(seed: number, width = WIDTH, height = HEIGHT): Uint8ClampedArray {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) & 0xff;
  };
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels.set([next(), next(), next(), 255], i);
  }
  return pixels;
}

async function png(pixels: Uint8ClampedArray, width = WIDTH, height = HEIGHT): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2D canvas");
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  return canvas.convertToBlob();
}

const inside = (x: number, y: number, rect: ImageRect) =>
  x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;

/** A copy of the pixels with other noise wherever `changed` says. */
function differing(
  pixels: Uint8ClampedArray,
  changed: (x: number, y: number) => boolean,
  seed = 2,
): Uint8ClampedArray {
  const other = noise(seed);
  const copy = new Uint8ClampedArray(pixels);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const at = (y * WIDTH + x) * 4;
      if (changed(x, y)) copy.set(other.subarray(at, at + 4), at);
    }
  }
  return copy;
}

/**
 * A copy whose pixels inside each rectangle are the same pixels in another
 * order, so each rectangle keeps its average.
 */
function shuffledWithin(pixels: Uint8ClampedArray, rects: readonly ImageRect[]): Uint8ClampedArray {
  const copy = new Uint8ClampedArray(pixels);
  for (const rect of rects) {
    const places: number[] = [];
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) places.push((y * WIDTH + x) * 4);
    }
    // Each pixel moves to the place of the one after it.
    places.forEach((to, index) => {
      const from = places[(index + 1) % places.length] as number;
      copy.set(pixels.subarray(from, from + 4), to);
    });
  }
  return copy;
}

const engines: ImageEngine[] = [];
const renderers: ImageRenderer[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const renderer of renderers.splice(0)) await renderer.destroy();
  for (const engine of engines.splice(0)) await engine.destroy();
});

/**
 * Destroys one engine, by reference, and takes it off the list. A property
 * run releases its own engine this way, never the list's last: a run that
 * outlives its test, after a timeout, then can't destroy the engine of the
 * test running next.
 */
async function release(engine: ImageEngine): Promise<void> {
  const at = engines.indexOf(engine);
  if (at >= 0) engines.splice(at, 1);
  await engine.destroy();
}

/** An engine and a processor over sources `a` and `b`. */
async function pair(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  const engine = createImageEngine();
  engines.push(engine);
  for (const [id, pixels] of [
    ["a", a],
    ["b", b],
  ] as const) {
    const file = await png(pixels);
    await engine.register(id, file, await engine.probe(file));
  }
  return { engine, processor: createImageProcessor(engine) };
}

const on = (plan: ImagePlan, source: string): ImagePlan => ({
  ...plan,
  base: { ...plan.base, source },
});
const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

/** The plan's export of each source, or `undefined` where the browser can't encode the format. */
async function exports(processor: ImageProcessor, plan: ImagePlan, format: ImageExportFormat) {
  try {
    return [
      await bytesOf(await processor.export({ plan: on(plan, "a"), format })),
      await bytesOf(await processor.export({ plan: on(plan, "b"), format })),
    ] as const;
  } catch (error) {
    if (isImageError(error, "UNSUPPORTED_FORMAT")) return undefined;
    throw error;
  }
}

/** Whether two exports are the same file. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

const FORMATS: readonly ImageExportFormat[] = [
  { type: "png" },
  { type: "jpeg", quality: 0.9 },
  { type: "webp", quality: 0.9 },
];

// Regions on, across and outside the source's edges.
const region = fc.record({
  x: fc.integer({ min: -10, max: WIDTH - 1 }),
  y: fc.integer({ min: -10, max: HEIGHT - 1 }),
  width: fc.integer({ min: 1, max: 50 }),
  height: fc.integer({ min: 1, max: 40 }),
});
const crop: fc.Arbitrary<ImageCrop | null> = fc.option(
  fc.record({ x: fc.nat(WIDTH - 8), y: fc.nat(HEIGHT - 8) }).chain(({ x, y }) =>
    fc.record({
      x: fc.constant(x),
      y: fc.constant(y),
      width: fc.integer({ min: 4, max: WIDTH - x }),
      height: fc.integer({ min: 4, max: HEIGHT - y }),
    }),
  ),
  { nil: null },
);
const orientation = fc.record({
  rotate: fc.constantFrom(0 as const, 90 as const, 180 as const, 270 as const),
  flipX: fc.boolean(),
  flipY: fc.boolean(),
});
// Full size, simple fractions, and scales that put edges between pixels.
const output = fc.oneof(
  fc.constant({ kind: "scale" as const, scale: 1 }),
  fc.constantFrom(0.5, 0.25, 0.75).map((scale) => ({ kind: "scale" as const, scale })),
  fc.double({ min: 0.11, max: 0.99, noNaN: true }).map((scale) => ({
    kind: "scale" as const,
    scale,
  })),
  fc.record({
    kind: fc.constant("fit" as const),
    width: fc.integer({ min: 5, max: 70 }),
    height: fc.integer({ min: 5, max: 70 }),
  }),
);
const develop = fc.oneof(
  fc.constant(NEUTRAL_DEVELOP),
  fc
    .record({
      exposure: fc.integer({ min: -60, max: 60 }),
      contrast: fc.integer({ min: -60, max: 60 }),
      saturation: fc.integer({ min: -60, max: 60 }),
      shadows: fc.integer({ min: -60, max: 60 }),
    })
    .map((values) => ({ ...NEUTRAL_DEVELOP, ...values })),
);
const filter = fc.option(
  fc.record({
    preset: fc.constantFrom("mono" as const, "sepia" as const, "vivid" as const),
    strength: fc.integer({ min: 1, max: 100 }),
  }),
  { nil: null },
);
const edits = fc.record({ crop, orientation, output, develop, filter });
type Edits = typeof edits extends fc.Arbitrary<infer T> ? T : never;

const planWith = (edit: Edits, redactions: readonly ImageRedaction[]): ImagePlan => ({
  ...createPlan("a"),
  base: {
    source: "a",
    crop: edit.crop,
    orientation: edit.orientation,
    develop: edit.develop,
    filter: edit.filter,
  },
  output: edit.output,
  redactions,
});

const solid = (rect: ImageRect, key = "r", colour = "#1a2b3c"): ImageRedaction => ({
  key,
  mode: "solid",
  ...rect,
  colour,
});
const pixelated = (rect: ImageRect, key = "p"): ImageRedaction => ({
  key,
  mode: "pixelate",
  ...rect,
});

describe("the redaction tests' own isolation", () => {
  it("lets a property run that outlives its test release only its own engine", async () => {
    // A run of a property that timed out goes on in the background: it makes
    // its engine, and releases it after the next test has made its own.
    let made: () => void = () => {};
    const ownMade = new Promise<void>((resolve) => {
      made = resolve;
    });
    let finish: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const ghost = (async () => {
      const { engine } = await pair(noise(1), noise(2));
      made();
      await gate;
      await release(engine);
    })();
    await ownMade;
    // The next test's engine, made while the ghost run still holds its own.
    const { engine, processor } = await pair(noise(3), noise(4));
    finish();
    await ghost;
    expect(engines).toEqual([engine]);
    const exported = await processor.export({ plan: createPlan("a"), format: { type: "png" } });
    expect(exported.size).toBeGreaterThan(0);
  });
});

describe("redaction doesn't interfere (docs/adr/0010)", () => {
  it("exports the same bytes from sources that differ only inside a solid region, for any plan", async () => {
    const base = noise(1);
    await fc.assert(
      fc.asyncProperty(region, edits, fc.constantFrom(...FORMATS), async (rect, edit, format) => {
        const { engine, processor } = await pair(
          base,
          differing(base, (x, y) => inside(x, y, rect)),
        );
        const both = await exports(processor, planWith(edit, [solid(rect)]), format);
        await processor.destroy();
        await release(engine);
        if (both) expect(sameBytes(...both)).toBe(true);
      }),
      { numRuns: 60 },
    );
  });

  it("exports different bytes without the redaction, so the test can fail", async () => {
    const base = noise(1);
    const rect = { x: 10, y: 8, width: 20, height: 16 };
    const { processor } = await pair(
      base,
      differing(base, (x, y) => inside(x, y, rect)),
    );
    for (const format of FORMATS) {
      const both = await exports(processor, createPlan("a"), format);
      if (both) expect(sameBytes(...both), format.type).toBe(false);
    }
    // And with the redaction one pixel short of the difference.
    const short = await exports(
      processor,
      { ...createPlan("a"), redactions: [solid({ ...rect, width: rect.width - 1 })] },
      { type: "png" },
    );
    expect(short && sameBytes(...short)).toBe(false);
  });

  it("exports the same bytes when only a pixelated region's pixels are rearranged within their blocks", async () => {
    const base = noise(3);
    await fc.assert(
      fc.asyncProperty(region, edits, fc.constantFrom(...FORMATS), async (rect, edit, format) => {
        const rendered = cropRect(edit.crop, WHOLE);
        const blocks = redactionBlocksInScene(rect, rendered);
        // Inside the rendered part, each block keeps its average. The part
        // of the region the crop leaves out is free to differ entirely.
        const rearranged = differing(
          shuffledWithin(base, blocks),
          (x, y) => inside(x, y, rect) && !inside(x, y, rendered),
        );
        const { engine, processor } = await pair(base, rearranged);
        const both = await exports(processor, planWith(edit, [pixelated(rect)]), format);
        await processor.destroy();
        await release(engine);
        if (both) expect(sameBytes(...both)).toBe(true);
      }),
      { numRuns: 60 },
    );
  });

  it("exports different bytes when a pixelated block's average changes, so the test can fail", async () => {
    const base = noise(3);
    const rect = { x: 8, y: 8, width: 32, height: 24 };
    const { processor } = await pair(
      base,
      differing(base, (x, y) => inside(x, y, rect)),
    );
    const both = await exports(
      processor,
      { ...createPlan("a"), redactions: [pixelated(rect)] },
      { type: "png" },
    );
    expect(both && sameBytes(...both)).toBe(false);
  });

  it("leaves no trace of a one-pixel line just inside a region's edge, at any scale", async () => {
    const base = noise(5);
    const rect = { x: 12, y: 9, width: 30, height: 22 };
    const rim = (x: number, y: number) =>
      inside(x, y, rect) &&
      (x === rect.x ||
        y === rect.y ||
        x === rect.x + rect.width - 1 ||
        y === rect.y + rect.height - 1);
    const { processor } = await pair(base, differing(base, rim));
    for (const scale of [1, 0.9, 0.75, 0.61, 0.5, 0.37, 0.25, 0.13]) {
      for (const format of FORMATS) {
        const plan: ImagePlan = {
          ...createPlan("a"),
          output: { kind: "scale", scale },
          redactions: [solid(rect)],
        };
        const both = await exports(processor, plan, format);
        if (both) expect(sameBytes(...both), `${scale} ${format.type}`).toBe(true);
      }
    }
  });

  it("covers the same source pixels after a crop, a turn and a flip: the same file as a source edited by hand", async () => {
    const base = noise(7);
    const rect = { x: 20, y: 14, width: 17, height: 11 };
    // Source b is source a with the region painted in by hand, and no redaction.
    const painted = new Uint8ClampedArray(base);
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) {
        painted.set([0x1a, 0x2b, 0x3c, 255], (y * WIDTH + x) * 4);
      }
    }
    const { processor } = await pair(base, painted);
    await fc.assert(
      fc.asyncProperty(crop, orientation, async (cropped, turned) => {
        const edited = { ...createPlan("a").base, crop: cropped, orientation: turned };
        const redacted = await processor.export({
          plan: { ...createPlan("a"), base: edited, redactions: [solid(rect)] },
          format: { type: "png" },
        });
        const byHand = await processor.export({
          plan: { ...createPlan("b"), base: { ...edited, source: "b" } },
          format: { type: "png" },
        });
        expect(sameBytes(await bytesOf(redacted), await bytesOf(byHand))).toBe(true);
      }),
      { numRuns: 40 },
    );
  });

  it("covers several redactions of both modes at once", async () => {
    const base = noise(9);
    const first = { x: 4, y: 4, width: 20, height: 12 };
    const second = { x: 30, y: 20, width: 24, height: 20 };
    const { processor } = await pair(
      base,
      differing(shuffledWithin(base, redactionBlocksInScene(second, WHOLE)), (x, y) =>
        inside(x, y, first),
      ),
    );
    for (const scale of [1, 0.5, 0.43]) {
      for (const format of FORMATS) {
        const plan: ImagePlan = {
          ...createPlan("a"),
          output: { kind: "scale", scale },
          redactions: [solid(first, "one"), pixelated(second, "two")],
        };
        const both = await exports(processor, plan, format);
        if (both) expect(sameBytes(...both), `${scale} ${format.type}`).toBe(true);
      }
    }
  });
});

describe("metadata with redactions (docs/adr/0005, docs/adr/0010)", () => {
  it("exports nothing of a source's descriptive fields or thumbnail, with a redaction or without", async () => {
    const MARKER = "REDACTED-CANARY-7f3a";
    const latin1 = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
    const stored = await bytesOf(await png(noise(11)));
    const at = 8 + 8 + 13 + 4;
    const file = new Blob([
      concat([
        stored.subarray(0, at),
        pngChunk("eXIf", exif({ orientation: 1, thumbnail: true, make: MARKER })),
        pngChunk("tEXt", [...latin1("Description"), 0, ...latin1(MARKER)]),
        pngChunk("tEXt", [...latin1("Comment"), 0, ...latin1(MARKER)]),
        stored.subarray(at),
      ]).slice(),
    ]);
    const engine = createImageEngine();
    engines.push(engine);
    await engine.register("a", file, await engine.probe(file));
    const processor = createImageProcessor(engine);
    const marker = new TextEncoder().encode(MARKER);
    const contains = (bytes: Uint8Array) =>
      bytes.some((_, i) => marker.every((value, j) => bytes[i + j] === value));
    expect(contains(await bytesOf(file))).toBe(true);
    for (const redactions of [[], [solid({ x: 4, y: 4, width: 20, height: 20 })]]) {
      for (const format of FORMATS) {
        try {
          const bytes = await bytesOf(
            await processor.export({ plan: { ...createPlan("a"), redactions }, format }),
          );
          expect(contains(bytes), format.type).toBe(false);
        } catch (error) {
          if (!isImageError(error, "UNSUPPORTED_FORMAT")) throw error;
        }
      }
    }
  });
});

describe("the sanitised copy follows the plan's redactions exactly (docs/adr/0010)", () => {
  const A = { x: 4, y: 4, width: 20, height: 14 };
  const B = { x: 34, y: 22, width: 22, height: 18 };

  it("never serves a plan from a copy built for more, fewer or other redactions", async () => {
    const base = noise(13);
    const file = await png(base);
    const used = createImageEngine();
    engines.push(used);
    await used.register("a", file, await used.probe(file));
    const processor = createImageProcessor(used);
    // The same source through one worker, with the redactions growing,
    // shrinking and changing, as edits and undos make them.
    const sequence: (readonly ImageRedaction[])[] = [
      [solid(A, "a")],
      [solid(A, "a"), pixelated(B, "b")],
      [solid(A, "a")],
      [],
      [pixelated(B, "b")],
      [solid(B, "b")],
      [solid({ ...B, x: B.x + 1 }, "b")],
      [pixelated(B, "b"), solid(A, "a")],
    ];
    for (const scale of [1, 0.5]) {
      for (const redactions of sequence) {
        const plan: ImagePlan = {
          ...createPlan("a"),
          output: { kind: "scale", scale },
          redactions,
        };
        const reused = await bytesOf(await processor.export({ plan, format: { type: "png" } }));
        // A worker that has never seen another plan gives the reference.
        const fresh = createImageEngine();
        await fresh.register("a", file, await fresh.probe(file));
        const reference = await bytesOf(
          await createImageProcessor(fresh).export({ plan, format: { type: "png" } }),
        );
        await fresh.destroy();
        expect(sameBytes(reused, reference), `${scale} ${JSON.stringify(redactions)}`).toBe(true);
      }
    }
  });

  it("rebuilds the copy when the crop changes the pixels a pixelated block averages", async () => {
    const base = noise(15);
    const file = await png(base);
    const used = createImageEngine();
    engines.push(used);
    await used.register("a", file, await used.probe(file));
    const processor = createImageProcessor(used);
    const region = { x: 10, y: 10, width: 40, height: 30 };
    for (const cropped of [null, { x: 20, y: 15, width: 30, height: 20 }, null]) {
      const plan: ImagePlan = {
        ...createPlan("a"),
        base: { ...createPlan("a").base, crop: cropped },
        redactions: [pixelated(region)],
      };
      const reused = await bytesOf(await processor.export({ plan, format: { type: "png" } }));
      const fresh = createImageEngine();
      await fresh.register("a", file, await fresh.probe(file));
      const reference = await bytesOf(
        await createImageProcessor(fresh).export({ plan, format: { type: "png" } }),
      );
      await fresh.destroy();
      expect(sameBytes(reused, reference)).toBe(true);
    }
  });
});

describe("the preview never shows redacted pixels (docs/adr/0010)", () => {
  async function pixels(renderer: ImageRenderer): Promise<Uint8ClampedArray> {
    const bitmap = await rendererInternals(renderer)?.snapshot();
    if (!bitmap) throw new Error("no snapshot");
    const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d", {
      willReadFrequently: true,
    });
    if (!context) throw new Error("no 2D canvas");
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    bitmap.close();
    return data;
  }

  const VIEWS: readonly ImageView[] = [
    fittedView(WIDTH, HEIGHT),
    fittedView(WIDTH, HEIGHT, 2),
    fittedView(40, 30),
    fittedView(23, 19),
    fittedView(200, 120, 1.5),
    { ...fittedView(WIDTH, HEIGHT), zoom: 3, pan: { x: -11.5, y: 7.25 } },
    { ...fittedView(WIDTH, HEIGHT), zoom: 0.37 },
    { ...fittedView(97, 61, 1.25), zoom: 1.7, pan: { x: 3, y: -2 }, inset: 4 },
  ];

  it("draws the same pixels from sources that differ only inside a region, at any zoom", async () => {
    const base = noise(17);
    const rect = { x: 14, y: 10, width: 26, height: 20 };
    for (const redaction of [solid(rect), pixelated(rect)]) {
      const other =
        redaction.mode === "solid"
          ? differing(base, (x, y) => inside(x, y, rect))
          : shuffledWithin(base, redactionBlocksInScene(rect, WHOLE));
      const { engine } = await pair(base, other);
      const renderer = createImageRenderer(engine);
      renderers.push(renderer);
      await renderer.attach(document.createElement("canvas"));
      for (const view of VIEWS) {
        for (const turned of [
          { rotate: 0, flipX: false, flipY: false },
          { rotate: 90, flipX: true, flipY: false },
        ] as const) {
          const plan: ImagePlan = {
            ...createPlan("a"),
            base: { ...createPlan("a").base, orientation: turned },
            redactions: [redaction],
          };
          // The first render of each is of a plan that already has its
          // redaction, as when a stored plan is opened.
          await renderer.render(on(plan, "a"), view);
          const first = await pixels(renderer);
          await renderer.render(on(plan, "b"), view);
          const second = await pixels(renderer);
          expect(first.length).toBeGreaterThan(0);
          expect(
            first.every((value, index) => value === second[index]),
            `${redaction.mode} ${JSON.stringify(view)} ${turned.rotate}`,
          ).toBe(true);
          // Without the redaction the two previews differ, so this can fail.
          await renderer.render(on({ ...plan, redactions: [] }, "a"), view);
          const bare = await pixels(renderer);
          await renderer.render(on({ ...plan, redactions: [] }, "b"), view);
          const bareOther = await pixels(renderer);
          expect(bare.some((value, index) => value !== bareOther[index])).toBe(true);
        }
      }
    }
  });

  /** A context that records everything drawn into it, with the pixels of each image drawn. */
  function recording() {
    const canvas = new OffscreenCanvas(1, 1);
    const real = canvas.getContext("2d");
    if (!real) throw new Error("no 2D canvas");
    const calls: { name: string; pixels?: Uint8ClampedArray }[] = [];
    const DRAWS = new Set([
      "drawImage",
      "putImageData",
      "fillRect",
      "strokeRect",
      "fill",
      "stroke",
      "fillText",
      "strokeText",
    ]);
    const context = new Proxy(real, {
      get(target, name) {
        const value = Reflect.get(target, name, target);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (typeof name === "string" && DRAWS.has(name)) {
            const image = args[0];
            if (name === "drawImage" && image instanceof OffscreenCanvas) {
              const read = image.getContext("2d");
              calls.push({
                name,
                ...(read
                  ? { pixels: read.getImageData(0, 0, image.width, image.height).data }
                  : {}),
              });
            } else {
              calls.push({ name });
            }
          }
          return Reflect.apply(value, target, args);
        };
      },
      set: (target, name, value) => Reflect.set(target, name, value, target),
    });
    return { context, calls };
  }

  it("gives the visible canvas one finished frame, with no draw before the redaction's last pass", async () => {
    const base = noise(19);
    const rect = { x: 10, y: 6, width: 30, height: 24 };
    const sources = await Promise.all(
      [base, differing(base, (x, y) => inside(x, y, rect))].map(async (data) =>
        createImageBitmap(await png(data)),
      ),
    );
    const views = [fittedView(WIDTH, HEIGHT), fittedView(31, 23), fittedView(160, 120)];
    const edited = {
      ...createPlan("a").base,
      develop: { ...NEUTRAL_DEVELOP, saturation: 40, shadows: 20 },
    };
    // A gesture's transient plan is a plan like any other to the renderer,
    // so this holds while a region is being placed too: the editor's own
    // test of that comes with the Redact tool.
    const plan: ImagePlan = { ...createPlan("a"), base: edited, redactions: [solid(rect)] };
    for (const view of views) {
      const frames: (Uint8ClampedArray | undefined)[] = [];
      for (const source of sources) {
        const { context, calls } = recording();
        await drawPreview(context, source, plan, view);
        // One draw: the finished frame. Nothing reaches the canvas before it.
        expect(calls.map((call) => call.name)).toEqual(["drawImage"]);
        frames.push(calls[0]?.pixels);
      }
      const [first, second] = frames;
      expect(first?.length).toBeGreaterThan(0);
      expect(first?.every((value, index) => value === second?.[index])).toBe(true);
    }
    for (const source of sources) source.close();
  });

  it("draws nothing, and exports nothing, when the sanitised copy can't be made", async () => {
    const base = noise(21);
    const source = await createImageBitmap(await png(base));
    const plan: ImagePlan = {
      ...createPlan("a"),
      output: { kind: "scale", scale: 0.5 },
      redactions: [solid({ x: 4, y: 4, width: 30, height: 20 })],
    };
    // The copy is the only canvas of the source's own size at half scale.
    const Real = OffscreenCanvas;
    vi.stubGlobal(
      "OffscreenCanvas",
      class extends Real {
        constructor(width: number, height: number) {
          if (width === WIDTH && height === HEIGHT) throw new RangeError("out of memory");
          super(width, height);
        }
      },
    );
    const { context, calls } = recording();
    await expect(drawPreview(context, source, plan, fittedView(32, 24))).rejects.toThrow(
      RangeError,
    );
    expect(calls).toEqual([]);
    await expect(encodePlan(source, plan, { type: "png" })).rejects.toThrow(RangeError);
    vi.unstubAllGlobals();
    // The same plan renders once the copy can be made, and without a
    // redaction it never needed one.
    await drawPreview(context, source, plan, fittedView(32, 24));
    expect(calls.map((call) => call.name)).toEqual(["drawImage"]);
    source.close();
  });
});

describe("limits with redactions (docs/adr/0004, docs/adr/0010)", () => {
  it("checks the sanitised copy against the output limits before making it", async () => {
    const base = noise(23);
    const { processor } = await pair(base, base);
    const small: ImagePlan = { ...createPlan("a"), output: { kind: "scale", scale: 0.25 } };
    const limits = { maxImagePixels: 1_000 };
    // The output is 16 × 12, within the limit; the source is 64 × 48, over it.
    const filePolicy = imageLimits.resolve(limits);
    await expect(
      processor.export({ plan: small, format: { type: "png" } }, { filePolicy }),
    ).resolves.toBeInstanceOf(Blob);
    const error = await processor
      .export(
        {
          plan: { ...small, redactions: [solid({ x: 0, y: 0, width: 8, height: 8 })] },
          format: { type: "png" },
        },
        { filePolicy },
      )
      .catch((reason: unknown) => reason);
    expect(isImageError(error, "IMAGE_TOO_LARGE")).toBe(true);
  });
});
