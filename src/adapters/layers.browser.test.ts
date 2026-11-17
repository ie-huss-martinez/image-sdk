import { afterEach, describe, expect, it } from "vitest";
import { isImageError } from "../core/errors/image-error.js";
import { arrowBounds, drawingBounds } from "../core/model/drawing-geometry.js";
import { applyMatrix, invertMatrix, sceneToLayerSource } from "../core/model/layer-geometry.js";
import {
  createPlan,
  type ImageArrowLayer,
  type ImageDrawingLayer,
  type ImageImageLayer,
  type ImageLayer,
  type ImagePlan,
  type ImageRedaction,
  type ImageShapeLayer,
  type ImageStroke,
  type ImageTextLayer,
  NEUTRAL_DEVELOP,
} from "../core/model/plan.js";
import type { ImageEngine } from "../core/ports/image-engine.js";
import type { ImageExportFormat } from "../core/ports/image-processor.js";
import { fittedView, type ImageRenderer } from "../core/ports/image-renderer.js";
import { createImageEngine } from "./image-engine.js";
import { createImageProcessor } from "./image-processor.js";
import { createImageRenderer, rendererInternals } from "./image-renderer.js";

/**
 * Layers as the render worker draws them (docs/adr/0009). Text is drawn by
 * whatever fonts the browser has, so nothing here compares text with stored
 * pixels or across engines: the tests are that the preview equals the
 * export, and properties that hold for any font.
 */

const WIDTH = 200;
const HEIGHT = 120;
const WHITE = [255, 255, 255, 255];

async function png(
  width: number,
  height: number,
  colour: (x: number, y: number) => readonly number[],
): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2D canvas");
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) image.data.set(colour(x, y), (y * width + x) * 4);
  }
  context.putImageData(image, 0, 0);
  return canvas.convertToBlob();
}

const engines: ImageEngine[] = [];
const renderers: ImageRenderer[] = [];
afterEach(async () => {
  for (const renderer of renderers.splice(0)) await renderer.destroy();
  for (const engine of engines.splice(0)) await engine.destroy();
});

/** An engine with a white base `s`, and any other sources given. */
async function opened(sources: Record<string, Blob> = {}, base?: Blob) {
  const engine = createImageEngine();
  engines.push(engine);
  const files = { s: base ?? (await png(WIDTH, HEIGHT, () => WHITE)), ...sources };
  for (const [id, file] of Object.entries(files)) {
    await engine.register(id, file, await engine.probe(file));
  }
  return { engine, processor: createImageProcessor(engine) };
}

interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  at(x: number, y: number): number[];
}

async function decoded(source: Blob | ImageBitmap): Promise<Pixels> {
  const bitmap = source instanceof Blob ? await createImageBitmap(source) : source;
  const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d", {
    willReadFrequently: true,
  });
  if (!context) throw new Error("no 2D canvas");
  context.drawImage(bitmap, 0, 0);
  const { width, height } = bitmap;
  bitmap.close();
  const { data } = context.getImageData(0, 0, width, height);
  return {
    width,
    height,
    data,
    at: (x, y) => Array.from(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)),
  };
}

const withLayers = (
  layers: readonly ImageLayer[],
  changes: Partial<ImagePlan> = {},
): ImagePlan => ({
  ...createPlan("s"),
  layers,
  ...changes,
});

const common = (
  x: number,
  y: number,
  width: number,
  height: number,
  rotation = 0,
  flipX = false,
) => ({
  name: "",
  visible: true,
  opacity: 100,
  x,
  y,
  width,
  height,
  rotation,
  flipX,
});
const text = (value: string, changes: Partial<ImageTextLayer> = {}): ImageTextLayer => ({
  ...common(20, 30, 160, 60),
  key: "t",
  kind: "text",
  text: value,
  font: "sans-serif",
  bold: false,
  colour: "#000000",
  align: "center",
  ...changes,
});
const shape = (changes: Partial<ImageShapeLayer> = {}): ImageShapeLayer => ({
  ...common(40, 30, 80, 50),
  key: "sh",
  kind: "shape",
  shape: "rectangle",
  fill: "#2060c0",
  stroke: null,
  ...changes,
});

const pen = (runs: number[][], changes: Partial<ImageStroke> = {}): ImageStroke => ({
  colour: "#000000",
  width: 6,
  runs,
  ...changes,
});
const drawing = (
  strokes: readonly ImageStroke[],
  changes: Partial<ImageDrawingLayer> = {},
): ImageDrawingLayer => ({
  key: "d",
  kind: "drawing",
  name: "",
  visible: true,
  opacity: 100,
  x: 0,
  y: 0,
  strokes,
  ...changes,
});
const arrow = (
  from: { x: number; y: number },
  to: { x: number; y: number },
  changes: Partial<ImageArrowLayer> = {},
): ImageArrowLayer => ({
  key: "a",
  kind: "arrow",
  name: "",
  visible: true,
  opacity: 100,
  from,
  to,
  colour: "#000000",
  width: 6,
  ...changes,
});

/** The box around every pixel that isn't the background, or `null`. */
function inkBox(pixels: Pixels, background = WHITE) {
  let left = Infinity;
  let top = Infinity;
  let right = -1;
  let bottom = -1;
  let count = 0;
  for (let y = 0; y < pixels.height; y += 1) {
    for (let x = 0; x < pixels.width; x += 1) {
      const i = (y * pixels.width + x) * 4;
      if (background.every((value, channel) => pixels.data[i + channel] === value)) continue;
      count += 1;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return count === 0
    ? null
    : { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1, count };
}

describe("the preview is the export (docs/adr/0009)", () => {
  it("draws every kind of layer the same in the preview and in the PNG, pixel for pixel", async () => {
    const inset = await png(30, 20, (x, y) => [x * 8, y * 12, 90, 255]);
    const { engine, processor } = await opened({ inset });
    const renderer = createImageRenderer(engine);
    renderers.push(renderer);
    await renderer.attach(document.createElement("canvas"));
    const image: ImageImageLayer = {
      // Mirrored, and turned.
      ...common(120, 60, 60, 40, 250, true),
      key: "i",
      kind: "image",
      source: "inset",
      crop: { x: 2, y: 2, width: 24, height: 16 },
    };
    const layers: ImageLayer[] = [
      shape({ shape: "ellipse", stroke: { colour: "#c02020", width: 6 } }),
      shape({
        key: "turned",
        x: 10,
        y: 60,
        rotation: 300,
        flipX: true,
        opacity: 55,
        fill: "#20a040",
      }),
      image,
      text("Hello\nשלום 📷", { bold: true, colour: "#101010", align: "start" }),
      // A drawing of two strokes, one of two runs and one a dot, faded as a group; and an arrow.
      drawing(
        [
          pen(
            [
              [0, 0, 30, 25, 60, 5],
              [60, 5, 90, 40],
            ],
            { colour: "#7030c0", width: 7 },
          ),
          pen([[40, 50]], { colour: "#c07030", width: 13 }),
        ],
        { x: 70, y: 55, opacity: 70 },
      ),
      arrow({ x: 20, y: 100 }, { x: 95, y: 70 }, { colour: "#0060a0", width: 5 }),
      arrow({ x: 180, y: 20 }, { x: 176, y: 23 }, { key: "short", width: 9, opacity: 60 }),
      text("fit", {
        key: "t2",
        x: 130,
        y: 5,
        width: 60,
        height: 30,
        rotation: 3_450,
        flipX: true,
        opacity: 70,
      }),
    ];
    for (const orientation of [
      { rotate: 0, flipX: false, flipY: false },
      { rotate: 90, flipX: false, flipY: false },
      { rotate: 180, flipX: true, flipY: false },
      { rotate: 270, flipX: false, flipY: true },
    ] as const) {
      for (const crop of [null, { x: 30, y: 10, width: 150, height: 100 }]) {
        const plan = withLayers(layers, {
          base: { ...createPlan("s").base, orientation, crop },
          redactions: [
            { key: "r", mode: "solid", x: 60, y: 40, width: 30, height: 20, colour: "#000000" },
          ],
        });
        const exported = await decoded(await processor.export({ plan, format: { type: "png" } }));
        // A view of the export's own size: one screen pixel for each of its pixels.
        await renderer.render(plan, fittedView(exported.width, exported.height));
        const bitmap = await rendererInternals(renderer)?.snapshot();
        if (!bitmap) throw new Error("no snapshot");
        const preview = await decoded(bitmap);
        expect([preview.width, preview.height]).toEqual([exported.width, exported.height]);
        let different = 0;
        for (let i = 0; i < exported.data.length; i += 1) {
          if (exported.data[i] !== preview.data[i]) different += 1;
        }
        expect(different, `${orientation.rotate} ${JSON.stringify(crop)}`).toBe(0);
        // And the layers did draw: this isn't two blank images agreeing.
        expect(inkBox(exported)?.count ?? 0).toBeGreaterThan(2_000);
      }
    }
  });

  it("draws the same export twice, whatever was drawn between", async () => {
    const { processor } = await opened();
    const plan = withLayers([text("Twice"), shape({ opacity: 40 })]);
    const first = new Uint8Array(
      await (await processor.export({ plan, format: { type: "png" } })).arrayBuffer(),
    );
    await processor.export({
      plan: withLayers([text("Other", { bold: true, font: "serif" })]),
      format: { type: "png" },
    });
    const again = new Uint8Array(
      await (await processor.export({ plan, format: { type: "png" } })).arrayBuffer(),
    );
    expect(first.length).toBe(again.length);
    expect(first.every((value, index) => value === again[index])).toBe(true);
  });
});

describe("text layers, for any font (docs/adr/0009)", () => {
  /** The export's pixels for some layers over the white base. */
  async function drawn(layers: readonly ImageLayer[], changes: Partial<ImagePlan> = {}) {
    const { processor } = await opened();
    return decoded(
      await processor.export({ plan: withLayers(layers, changes), format: { type: "png" } }),
    );
  }

  it("keeps its ink inside its box, and as large as fits, in every family and weight", async () => {
    for (const font of ["sans-serif", "serif", "monospace"] as const) {
      for (const bold of [false, true]) {
        for (const [value, box] of [
          ["Hamburg", { x: 20, y: 30, width: 160, height: 60 }],
          // A tall box: the width limits it. A wide one: the height does.
          ["Hamburg", { x: 60, y: 5, width: 60, height: 110 }],
          ["Hi", { x: 5, y: 40, width: 190, height: 40 }],
          ["two\nlines", { x: 30, y: 10, width: 120, height: 100 }],
        ] as const) {
          const ink = inkBox(await drawn([text(value, { ...box, font, bold })]));
          const what = `${font} ${bold} ${value} ${JSON.stringify(box)}`;
          if (!ink) throw new Error(`no ink: ${what}`);
          // Inside the box, give or take a pixel of anti-aliasing and of
          // glyphs that overhang their advance.
          expect(ink.left, what).toBeGreaterThanOrEqual(box.x - 3);
          expect(ink.top, what).toBeGreaterThanOrEqual(box.y - 1);
          expect(ink.right, what).toBeLessThanOrEqual(box.x + box.width + 2);
          expect(ink.bottom, what).toBeLessThanOrEqual(box.y + box.height);
          // As large as fits: it nearly fills the box one way or the other.
          // A line's height includes the space above and below its letters,
          // so ink that's height-limited is shorter than the box.
          const across = ink.width / box.width;
          const down = ink.height / box.height;
          expect(Math.max(across, down), what).toBeGreaterThan(0.5);
          expect(across > 0.85 || down > 0.4, what).toBe(true);
        }
      }
    }
  });

  it("aligns its lines to the start, the centre and the end, by the text's direction", async () => {
    // A wide, short box: the height limits the size, so there's room across.
    const box = { x: 10, y: 45, width: 180, height: 30 };
    const centreOf = async (value: string, align: "start" | "center" | "end") => {
      const ink = inkBox(await drawn([text(value, { ...box, align })]));
      if (!ink) throw new Error("no ink");
      return (ink.left + ink.right) / 2;
    };
    const middle = box.x + box.width / 2;
    // Left to right: start is the left.
    const start = await centreOf("abc", "start");
    const centre = await centreOf("abc", "center");
    const end = await centreOf("abc", "end");
    expect(start).toBeLessThan(centre - 20);
    expect(centre).toBeLessThan(end - 20);
    expect(Math.abs(centre - middle)).toBeLessThan(3);
    expect(Math.abs(start - middle + (end - middle))).toBeLessThan(4);
    // Right to left: start is the right.
    const hebrewStart = await centreOf("אבג", "start");
    const hebrewEnd = await centreOf("אבג", "end");
    expect(hebrewStart).toBeGreaterThan(middle + 20);
    expect(hebrewEnd).toBeLessThan(middle - 20);
  });

  it("breaks lines only at line feeds, and spaces them evenly", async () => {
    // A tall, narrow box, so the width limits one, two and three lines alike: the same size.
    const box = { x: 70, y: 5, width: 60, height: 110 };
    const one = inkBox(await drawn([text("AAAA", box)]));
    const two = inkBox(await drawn([text("AAAA\nAAAA", box)]));
    const three = inkBox(await drawn([text("AAAA\nAAAA\nAAAA", box)]));
    if (!one || !two || !three) throw new Error("no ink");
    expect(two.width).toBe(one.width);
    expect(two.height).toBeGreaterThan(one.height * 1.8);
    // Evenly: the third line adds what the second did, within a pixel.
    expect(Math.abs(three.height - two.height - (two.height - one.height))).toBeLessThanOrEqual(2);
    // A long line is never wrapped: it's drawn smaller.
    const long = inkBox(await drawn([text("AAAAAAAAAAAAAAAA", box)]));
    expect(long?.height ?? 0).toBeLessThan(one.height / 2);
  });

  it("draws nothing for empty text, a hidden layer or no opacity, and fades with opacity", async () => {
    expect(inkBox(await drawn([text("")]))).toBeNull();
    expect(inkBox(await drawn([text("\n\n")]))).toBeNull();
    expect(inkBox(await drawn([text("Hidden", { visible: false })]))).toBeNull();
    expect(inkBox(await drawn([text("Clear", { opacity: 0 })]))).toBeNull();
    const full = await drawn([text("M")]);
    const half = await drawn([text("M", { opacity: 50 })]);
    const darkest = (pixels: Pixels) => {
      let least = 255;
      for (let i = 0; i < pixels.data.length; i += 4)
        least = Math.min(least, pixels.data[i] ?? 255);
      return least;
    };
    expect(darkest(full)).toBeLessThan(10);
    // Black at half opacity over white is mid-grey, nowhere darker.
    expect(Math.abs(darkest(half) - 127)).toBeLessThanOrEqual(3);
    // The same glyphs: the same ink, but for a faint edge pixel or two.
    const [faded, solid] = [inkBox(half)?.count ?? 0, inkBox(full)?.count ?? 0];
    expect(Math.abs(faded - solid)).toBeLessThanOrEqual(solid * 0.02);
  });

  it("uses its colour, and is never developed with the base", async () => {
    const { processor } = await opened();
    const plan = withLayers(
      [text("M", { colour: "#c03010" }), shape({ x: 5, y: 5, width: 20, height: 20 })],
      {
        base: {
          ...createPlan("s").base,
          develop: { ...NEUTRAL_DEVELOP, exposure: -60, saturation: -100 },
          filter: { preset: "sepia", strength: 100 },
        },
      },
    );
    const pixels = await decoded(await processor.export({ plan, format: { type: "png" } }));
    // The base was developed: it's no longer white.
    expect(pixels.at(190, 110)).not.toEqual(WHITE);
    // The shape keeps exactly its colour, and the text has pixels of exactly its own.
    expect(pixels.at(15, 15)).toEqual([0x20, 0x60, 0xc0, 255]);
    let exact = 0;
    for (let i = 0; i < pixels.data.length; i += 4) {
      if (pixels.data[i] === 0xc0 && pixels.data[i + 1] === 0x30 && pixels.data[i + 2] === 0x10) {
        exact += 1;
      }
    }
    expect(exact).toBeGreaterThan(20);
  });

  it("reads on a mirrored image as it does on the image, when it's mirrored back", async () => {
    // The image mirrored left to right, and the layer mirrored in the scene's
    // mirror of its place: the two cancel, and it's drawn as it was.
    const box = { x: 30, y: 40, width: 120, height: 40 };
    for (const rotation of [0, 250]) {
      const plain = await drawn([text("Hamburg", { ...box, rotation })]);
      const mirrored = await drawn(
        [
          text("Hamburg", {
            ...box,
            x: WIDTH - box.x - box.width,
            // A turn seen in a mirror runs the other way.
            rotation: (3_600 - rotation) % 3_600,
            flipX: true,
          }),
        ],
        {
          base: {
            ...createPlan("s").base,
            orientation: { rotate: 0, flipX: true, flipY: false },
          },
        },
      );
      const ink = inkBox(plain);
      expect(ink?.count ?? 0).toBeGreaterThan(200);
      if (rotation === 0) {
        // The same transform to the last digit: the same pixels.
        let different = 0;
        for (let i = 0; i < plain.data.length; i += 1) {
          if (plain.data[i] !== mirrored.data[i]) different += 1;
        }
        expect(different).toBe(0);
      } else {
        // Turned, the transform is the same to rounding: the same ink, within a pixel.
        const other = inkBox(mirrored);
        if (!ink || !other) throw new Error("no ink");
        for (const side of ["left", "top", "right", "bottom"] as const) {
          expect(Math.abs(ink[side] - other[side]), side).toBeLessThanOrEqual(1);
        }
        expect(Math.abs(ink.count - other.count)).toBeLessThanOrEqual(ink.count * 0.02);
      }
      // Mirrored alone, on the image as it is, the text is backwards: other pixels.
      const backwards = await drawn([text("Hamburg", { ...box, rotation, flipX: true })]);
      let changed = 0;
      for (let i = 0; i < plain.data.length; i += 1) {
        if (plain.data[i] !== backwards.data[i]) changed += 1;
      }
      expect(changed).toBeGreaterThan(200);
    }
  });

  it("turns with its box, about the box's centre", async () => {
    // A quarter turn of a wide box: the ink becomes tall, about the same centre.
    const box = { x: 60, y: 45, width: 80, height: 30 };
    const flat = inkBox(await drawn([text("Hamburg", box)]));
    const turned = inkBox(await drawn([text("Hamburg", { ...box, rotation: 900 })]));
    if (!flat || !turned) throw new Error("no ink");
    expect(Math.abs(turned.height - flat.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(turned.width - flat.height)).toBeLessThanOrEqual(2);
    const centre = (ink: NonNullable<ReturnType<typeof inkBox>>) => [
      (ink.left + ink.right) / 2,
      (ink.top + ink.bottom) / 2,
    ];
    expect(Math.abs((centre(turned)[0] ?? 0) - 100)).toBeLessThan(12);
    expect(Math.abs((centre(turned)[1] ?? 0) - 60)).toBeLessThan(12);
  });

  it("stays on the pixels it was placed on when the image is cropped and turned", async () => {
    const box = { x: 100, y: 20, width: 80, height: 40 };
    const whole = inkBox(await drawn([text("Hamburg", box)]));
    // Cropped by 50 and 10: the same ink, 50 left and 10 up.
    const cropped = inkBox(
      await drawn([text("Hamburg", box)], {
        base: { ...createPlan("s").base, crop: { x: 50, y: 10, width: 150, height: 110 } },
      }),
    );
    if (!whole || !cropped) throw new Error("no ink");
    expect([cropped.left, cropped.top, cropped.right, cropped.bottom]).toEqual([
      whole.left - 50,
      whole.top - 10,
      whole.right - 50,
      whole.bottom - 10,
    ]);
    // Turned a quarter clockwise: the 200 × 120 image is 120 × 200, and the
    // ink's box is the whole one's, turned.
    const turned = inkBox(
      await drawn([text("Hamburg", box)], {
        base: {
          ...createPlan("s").base,
          orientation: { rotate: 90, flipX: false, flipY: false },
        },
      }),
    );
    if (!turned) throw new Error("no ink");
    expect([turned.left, turned.top, turned.right, turned.bottom]).toEqual([
      HEIGHT - 1 - whole.bottom,
      whole.left,
      HEIGHT - 1 - whole.top,
      whole.right,
    ]);
  });

  it("scales with the export, from the same layout", async () => {
    const full = inkBox(await drawn([text("Hamburg")]));
    const half = inkBox(await drawn([text("Hamburg")], { output: { kind: "scale", scale: 0.5 } }));
    if (!full || !half) throw new Error("no ink");
    // Half the size, within a pixel each way: not a different line break or fit.
    expect(Math.abs(half.left - full.left / 2)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(half.width - full.width / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(half.height - full.height / 2)).toBeLessThanOrEqual(2);
  });
});

describe("shape and image layers (docs/adr/0009)", () => {
  async function drawn(layers: readonly ImageLayer[], sources: Record<string, Blob> = {}) {
    const { processor } = await opened(sources);
    return decoded(await processor.export({ plan: withLayers(layers), format: { type: "png" } }));
  }
  const FILL = [0x20, 0x60, 0xc0, 255];
  const STROKE = [0xc0, 0x20, 0x20, 255];

  it("draws an ellipse inside its box, and a stroke inside the shape", async () => {
    const box = { x: 40, y: 30, width: 80, height: 50 };
    const pixels = await drawn([
      shape({ ...box, shape: "ellipse", stroke: { colour: "#c02020", width: 6 } }),
    ]);
    const ink = inkBox(pixels);
    // The ellipse touches its box on every side, and nothing is outside it.
    expect(ink).toMatchObject({ left: 40, top: 30, right: 119, bottom: 79 });
    expect(pixels.at(80, 55)).toEqual(FILL);
    // The box's corners aren't part of an ellipse.
    expect(pixels.at(41, 31)).toEqual(WHITE);
    expect(pixels.at(118, 78)).toEqual(WHITE);
    // The stroke is the outermost 6 pixels, inside the box.
    expect(pixels.at(42, 55)).toEqual(STROKE);
    expect(pixels.at(80, 33)).toEqual(STROKE);
    expect(pixels.at(50, 55)).toEqual(FILL);
  });

  it("draws a rectangle's stroke inside its box, to exactly its width", async () => {
    const pixels = await drawn([shape({ stroke: { colour: "#c02020", width: 4 } })]);
    expect(inkBox(pixels)).toMatchObject({ left: 40, top: 30, right: 119, bottom: 79 });
    for (const [x, y] of [
      [40, 30],
      [43, 33],
      [119, 79],
      [80, 30],
      [116, 55],
    ] as const) {
      expect(pixels.at(x, y), `${x},${y}`).toEqual(STROKE);
    }
    expect(pixels.at(44, 34)).toEqual(FILL);
    expect(pixels.at(115, 75)).toEqual(FILL);
    // A stroke with no fill leaves the middle as it was.
    const outline = await drawn([shape({ fill: null, stroke: { colour: "#c02020", width: 4 } })]);
    expect(outline.at(80, 55)).toEqual(WHITE);
    expect(outline.at(41, 55)).toEqual(STROKE);
    // A stroke wider than half the shape fills it, and stays inside the box.
    const thick = await drawn([shape({ stroke: { colour: "#c02020", width: 500 } })]);
    expect(inkBox(thick)).toMatchObject({ left: 40, top: 30, right: 119, bottom: 79 });
    expect(thick.at(80, 55)).toEqual(STROKE);
  });

  it("turns a shape about its centre, by tenths of a degree", async () => {
    // A square turned an eighth: a diamond with the same centre.
    const pixels = await drawn([shape({ x: 70, y: 30, width: 60, height: 60, rotation: 450 })]);
    expect(pixels.at(100, 60)).toEqual(FILL);
    // The square's own corners are outside the diamond; the diamond's points
    // are beyond the square's sides.
    expect(pixels.at(72, 32)).toEqual(WHITE);
    expect(pixels.at(128, 88)).toEqual(WHITE);
    expect(pixels.at(100, 22)).toEqual(FILL);
    expect(pixels.at(140, 60)).toEqual(FILL);
    // A quarter turn of a 80 × 50 box is exactly a 50 × 80 box.
    const quarter = inkBox(await drawn([shape({ rotation: 900 })]));
    expect(quarter).toMatchObject({ left: 55, top: 15, right: 104, bottom: 94 });
  });

  it("fades a shape as one: a stroke doesn't show through its fill", async () => {
    const pixels = await drawn([shape({ opacity: 50, stroke: { colour: "#c02020", width: 6 } })]);
    const blend = (colour: readonly number[]) =>
      colour.slice(0, 3).map((value) => Math.round((value + 255) / 2));
    const close = (got: number[], want: number[]) =>
      // A canvas blends in 8 bits, premultiplied: within two levels.
      want.every((value, channel) => Math.abs((got[channel] ?? 0) - value) <= 2);
    // Where the stroke is, only the stroke's colour, at half; where the
    // fill is, only the fill's.
    expect(close(pixels.at(42, 55), blend(STROKE))).toBe(true);
    expect(close(pixels.at(80, 55), blend(FILL))).toBe(true);
  });

  it("draws an image layer scaled and turned, from its crop of its own source", async () => {
    // Left half red, right half green; the layer draws the green half.
    const halves = await png(40, 20, (x) => (x < 20 ? [200, 0, 0, 255] : [0, 160, 0, 255]));
    const layer: ImageImageLayer = {
      ...common(60, 30, 80, 60, 300),
      key: "i",
      kind: "image",
      source: "halves",
      crop: { x: 20, y: 0, width: 20, height: 20 },
    };
    const pixels = await drawn([layer], { halves });
    expect(pixels.at(100, 60)).toEqual([0, 160, 0, 255]);
    let red = 0;
    for (let i = 0; i < pixels.data.length; i += 4)
      if ((pixels.data[i] ?? 0) > 150 && pixels.data[i + 1] === 0) red += 1;
    expect(red).toBe(0);
    // Its ink is the turned box: wider and taller than the 80 × 60 box.
    const ink = inkBox(pixels);
    expect(ink?.width).toBeGreaterThan(80);
    expect(ink?.height).toBeGreaterThan(60);
  });

  it("mirrors an image layer left to right, about its box, before it's turned", async () => {
    // Left half red, right half green.
    const halves = await png(40, 20, (x) => (x < 20 ? [200, 0, 0, 255] : [0, 160, 0, 255]));
    const RED = [200, 0, 0, 255];
    const GREEN = [0, 160, 0, 255];
    const layer: ImageImageLayer = {
      ...common(60, 30, 80, 60),
      key: "i",
      kind: "image",
      source: "halves",
      crop: null,
    };
    const upright = await drawn([layer], { halves });
    expect([upright.at(70, 60), upright.at(130, 60)]).toEqual([RED, GREEN]);
    const mirrored = await drawn([{ ...layer, flipX: true }], { halves });
    expect([mirrored.at(70, 60), mirrored.at(130, 60)]).toEqual([GREEN, RED]);
    // Its box is where it was.
    expect(inkBox(mirrored)).toMatchObject({ left: 60, top: 30, right: 139, bottom: 89 });
    // Mirrored, then a quarter turn clockwise: the box's own left, now green, is up.
    const turned = await drawn([{ ...layer, flipX: true, rotation: 900 }], { halves });
    expect([turned.at(100, 30), turned.at(100, 90)]).toEqual([GREEN, RED]);
    // With a half turn, it's a mirror top to bottom: left and right as they were.
    const half = await drawn([{ ...layer, flipX: true, rotation: 1_800 }], { halves });
    expect([half.at(70, 60), half.at(130, 60)]).toEqual([RED, GREEN]);
  });

  it("fails on an image layer whose source isn't registered, with nothing exported", async () => {
    const { processor } = await opened();
    const layer: ImageImageLayer = {
      ...common(0, 0, 10, 10),
      key: "i",
      kind: "image",
      source: "missing",
      crop: null,
    };
    await expect(
      processor.export({ plan: withLayers([layer]), format: { type: "png" } }),
    ).rejects.toThrow();
  });
});

describe("drawings and arrows (docs/adr/0014)", () => {
  async function drawn(layers: readonly ImageLayer[], changes: Partial<ImagePlan> = {}) {
    const { processor } = await opened();
    return decoded(
      await processor.export({ plan: withLayers(layers, changes), format: { type: "png" } }),
    );
  }
  const BLACK = [0, 0, 0, 255];
  /** How many pixels differ by more than `by` in some channel. */
  const differing = (a: Pixels, b: Pixels, by: number) => {
    let count = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        if (Math.abs((a.data[i + channel] ?? 0) - (b.data[i + channel] ?? 0)) > by) {
          count += 1;
          break;
        }
      }
    }
    return count;
  };

  it("draws a run as a line of its width, with round ends, from its drawing's origin", async () => {
    // From 40 to 140 across, at 40 down, 10 wide.
    const pixels = await drawn([
      drawing([pen([[20, 0, 120, 0]], { width: 10, colour: "#2060c0" })], { x: 20, y: 40 }),
    ]);
    // Its ink: the line, and half its width past each end.
    expect(inkBox(pixels)).toMatchObject({ left: 35, right: 144, top: 35, bottom: 44 });
    // Exactly its colour, across its width.
    for (const y of [36, 40, 43]) expect(pixels.at(90, y)).toEqual([0x20, 0x60, 0xc0, 255]);
    expect(pixels.at(90, 33)).toEqual(WHITE);
    expect(pixels.at(90, 46)).toEqual(WHITE);
    // A round end: its middle is ink, its corners aren't.
    expect(pixels.at(36, 40)).toEqual([0x20, 0x60, 0xc0, 255]);
    expect(pixels.at(35, 35)).toEqual(WHITE);
    expect(pixels.at(144, 44)).toEqual(WHITE);
  });

  it("draws a run of one point as a disc as wide as the stroke", async () => {
    const pixels = await drawn([drawing([pen([[0, 0]], { width: 20 })], { x: 100, y: 60 })]);
    const ink = inkBox(pixels);
    expect(ink).toMatchObject({ left: 90, right: 109, top: 50, bottom: 69 });
    expect(pixels.at(100, 60)).toEqual(BLACK);
    // A disc, not a square: about π × 10² pixels, and nothing in the corners.
    expect(Math.abs((ink?.count ?? 0) - Math.PI * 100)).toBeLessThan(30);
    expect(pixels.at(91, 51)).toEqual(WHITE);
  });

  it("joins a line's segments round, and never fits a curve through its points", async () => {
    // Right, then down: a corner at 100, 30.
    const pixels = await drawn([drawing([pen([[40, 30, 100, 30, 100, 90]], { width: 12 })])]);
    // The corner's own point is ink; the square corner beyond a round join isn't.
    expect(pixels.at(100, 30)).toEqual(BLACK);
    expect(pixels.at(105, 24)).toEqual(WHITE);
    // The segments are straight: the middle of each is on its line, and the
    // inside of the corner, where a fitted curve would cut across, is empty.
    expect(pixels.at(70, 30)).toEqual(BLACK);
    expect(pixels.at(100, 60)).toEqual(BLACK);
    expect(pixels.at(85, 45)).toEqual(WHITE);
  });

  it("draws runs that meet at a point as one line through it, at any opacity", async () => {
    const one = [pen([[40, 30, 100, 30, 100, 90]], { width: 12 })];
    const two = [
      pen(
        [
          [40, 30, 100, 30],
          [100, 30, 100, 90],
        ],
        { width: 12 },
      ),
    ];
    for (const opacity of [100, 50]) {
      const whole = await drawn([drawing(one, { opacity })]);
      const cut = await drawn([drawing(two, { opacity })]);
      // The same line, pixel for pixel: the renderer continues one path through the cut.
      expect(inkBox(whole)?.count ?? 0, String(opacity)).toBeGreaterThan(1_000);
      expect(differing(whole, cut, 0), String(opacity)).toBe(0);
      // Where the runs meet isn't darker than the line.
      expect(cut.at(100, 30)).toEqual(cut.at(70, 30));
    }
    // Runs that don't meet are two lines, each with its own round ends.
    const apart = await drawn([
      drawing([
        pen(
          [
            [40, 30, 90, 30],
            [110, 30, 160, 30],
          ],
          { width: 12 },
        ),
      ]),
    ]);
    expect(apart.at(100, 30)).toEqual(WHITE);
    expect(apart.at(94, 30)).toEqual(BLACK);
    expect(apart.at(106, 30)).toEqual(BLACK);
    // A dot on the end of a line adds nothing; one elsewhere is a disc.
    const dotted = await drawn([
      drawing([
        pen(
          [
            [40, 30, 90, 30],
            [90, 30],
            [130, 70],
          ],
          { width: 12 },
        ),
      ]),
    ]);
    const line = await drawn([
      drawing([
        pen(
          [
            [40, 30, 90, 30],
            [130, 70],
          ],
          { width: 12 },
        ),
      ]),
    ]);
    expect(differing(dotted, line, 0)).toBe(0);
    expect(dotted.at(130, 70)).toEqual(BLACK);
    expect(dotted.at(130, 78)).toEqual(WHITE);
  });

  it("composites a drawing as one: strokes that cross don't darken each other", async () => {
    const cross = drawing(
      [pen([[40, 60, 160, 60]], { width: 14 }), pen([[100, 20, 100, 100]], { width: 14 })],
      { opacity: 50 },
    );
    const pixels = await drawn([cross]);
    const arm = pixels.at(60, 60);
    // Half black over white: mid grey, on an arm and where they cross alike.
    expect(Math.abs((arm[0] ?? 0) - 128)).toBeLessThanOrEqual(2);
    expect(pixels.at(100, 60)).toEqual(arm);
    expect(pixels.at(100, 30)).toEqual(arm);
    // Hidden, or with no opacity, it draws nothing.
    expect(inkBox(await drawn([{ ...cross, visible: false }]))).toBeNull();
    expect(inkBox(await drawn([{ ...cross, opacity: 0 }]))).toBeNull();
  });

  it("uses each stroke's own colour, in order, and is never developed with the base", async () => {
    const pixels = await drawn(
      [
        drawing([
          pen([[40, 60, 160, 60]], { width: 14, colour: "#c02020" }),
          pen([[100, 20, 100, 100]], { width: 14, colour: "#2020c0" }),
        ]),
      ],
      {
        base: {
          ...createPlan("s").base,
          develop: { ...createPlan("s").base.develop, exposure: -60, saturation: -100 },
          filter: { preset: "sepia", strength: 100 },
        },
      },
    );
    expect(pixels.at(60, 60)).toEqual([0xc0, 0x20, 0x20, 255]);
    // The later stroke is over the earlier one where they cross.
    expect(pixels.at(100, 60)).toEqual([0x20, 0x20, 0xc0, 255]);
    expect(pixels.at(100, 30)).toEqual([0x20, 0x20, 0xc0, 255]);
  });

  it("draws an arrow with its tip on the point it aims at, and nothing past it", async () => {
    const layer = arrow({ x: 30, y: 60 }, { x: 150, y: 60 }, { width: 6, colour: "#c02020" });
    const pixels = await drawn([layer]);
    const RED = [0xc0, 0x20, 0x20, 255];
    // The head is 24 long and 24 across; the shaft 6 across, with a square tail.
    const bounds = arrowBounds(layer);
    expect(bounds).toEqual({ x: 30, y: 48, width: 120, height: 24 });
    const ink = inkBox(pixels);
    expect(ink?.left).toBe(30);
    expect(ink?.right).toBe(149);
    expect(Math.abs((ink?.top ?? 0) - 48)).toBeLessThanOrEqual(1);
    expect(Math.abs((ink?.bottom ?? 0) - 71)).toBeLessThanOrEqual(1);
    // The shaft, exactly its colour across its width, and nothing beside it.
    for (const y of [57, 60, 62]) expect(pixels.at(70, y)).toEqual(RED);
    expect(pixels.at(70, 55)).toEqual(WHITE);
    expect(pixels.at(70, 64)).toEqual(WHITE);
    expect(pixels.at(30, 60)).toEqual(RED);
    // The head widens to its base, at 126, and narrows to the tip.
    expect(pixels.at(128, 51)).toEqual(RED);
    expect(pixels.at(128, 68)).toEqual(RED);
    expect(pixels.at(145, 60)).toEqual(RED);
    expect(pixels.at(145, 52)).toEqual(WHITE);
    // Nothing is drawn at or past the tip's column.
    for (let y = 0; y < HEIGHT; y += 1) {
      if (pixels.at(150, y).join() !== WHITE.join()) throw new Error(`ink past the tip at ${y}`);
    }
  });

  it("draws an arrow in any direction inside its bounds, and one shorter than its head as a head", async () => {
    for (const [from, to, width] of [
      [{ x: 150, y: 100 }, { x: 40, y: 20 }, 5],
      [{ x: 60, y: 20 }, { x: 60, y: 100 }, 8],
      // Shorter than its head of 40: all head.
      [{ x: 100, y: 60 }, { x: 110, y: 66 }, 10],
    ] as const) {
      const layer = arrow(from, to, { width });
      const ink = inkBox(await drawn([layer]));
      const bounds = arrowBounds(layer);
      if (!ink) throw new Error("no ink");
      expect(ink.left).toBeGreaterThanOrEqual(bounds.x);
      expect(ink.top).toBeGreaterThanOrEqual(bounds.y);
      expect(ink.right).toBeLessThan(bounds.x + bounds.width);
      expect(ink.bottom).toBeLessThan(bounds.y + bounds.height);
      // And it fills them, to a pixel's antialiasing each way.
      expect(ink.left - bounds.x).toBeLessThanOrEqual(1);
      expect(bounds.x + bounds.width - 1 - ink.right).toBeLessThanOrEqual(1);
      expect(ink.top - bounds.y).toBeLessThanOrEqual(1);
      expect(bounds.y + bounds.height - 1 - ink.bottom).toBeLessThanOrEqual(1);
    }
  });

  it("keeps a drawing's ink inside its bounds, and scales with the export", async () => {
    const layer = drawing(
      [
        pen([[0, 0, 60, 30, 20, 50]], { width: 8 }),
        pen([[90, 10]], { width: 16, colour: "#c02020" }),
      ],
      { x: 40, y: 30 },
    );
    const bounds = drawingBounds(layer);
    const full = inkBox(await drawn([layer]));
    if (!full) throw new Error("no ink");
    // Inside its bounds, to the pixel of antialiasing a round end's curve may spill.
    expect(full.left).toBeGreaterThanOrEqual(bounds.x - 1);
    expect(full.top).toBeGreaterThanOrEqual(bounds.y - 1);
    expect(full.right).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(full.bottom).toBeLessThanOrEqual(bounds.y + bounds.height);
    // And it reaches them: the bounds aren't loose.
    expect(full.left).toBeLessThanOrEqual(bounds.x + 1);
    expect(full.right).toBeGreaterThanOrEqual(bounds.x + bounds.width - 2);
    // At half size the same drawing is half as large, from the same geometry.
    const half = inkBox(await drawn([layer], { output: { kind: "scale", scale: 0.5 } }));
    if (!half) throw new Error("no ink");
    expect(Math.abs(half.left - full.left / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(half.top - full.top / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(half.width - full.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(half.height - full.height / 2)).toBeLessThanOrEqual(1);
  });

  it("stays on the pixels it was drawn on when the image is cropped, turned and mirrored", async () => {
    const dot = drawing([pen([[0, 0]], { width: 10, colour: "#c02020" })], { x: 150, y: 30 });
    const RED = [0xc0, 0x20, 0x20, 255];
    // Cropped from 100, 10: the dot is 50 across and 20 down.
    const cropped = await drawn([dot], {
      base: { ...createPlan("s").base, crop: { x: 100, y: 10, width: 100, height: 100 } },
    });
    expect(cropped.at(50, 20)).toEqual(RED);
    // Mirrored left to right: 200 − 150 = 50 from the left.
    const mirrored = await drawn([dot], {
      base: { ...createPlan("s").base, orientation: { rotate: 0, flipX: true, flipY: false } },
    });
    expect(mirrored.at(49, 30)).toEqual(RED);
    expect(mirrored.at(150, 30)).toEqual(WHITE);
    // A quarter turn clockwise: the image is 120 × 200, and the dot 120 − 30 across, 150 down.
    const turned = await drawn([dot], {
      base: { ...createPlan("s").base, orientation: { rotate: 90, flipX: false, flipY: false } },
    });
    expect([turned.width, turned.height]).toEqual([120, 200]);
    expect(turned.at(89, 150)).toEqual(RED);
  });
});

describe("image layers under a redaction (docs/adr/0010)", () => {
  const SIZE = { width: 40, height: 30 };
  /** Opaque noise, the same for the same seed. */
  function noise(seed: number): (x: number, y: number) => number[] {
    const values: number[] = [];
    let state = seed >>> 0;
    for (let i = 0; i < SIZE.width * SIZE.height * 3; i += 1) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      values.push(state >>> 24);
    }
    return (x, y) => {
      const i = (y * SIZE.width + x) * 3;
      return [values[i] ?? 0, values[i + 1] ?? 0, values[i + 2] ?? 0, 255];
    };
  }
  const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
  const same = (a: Uint8Array, b: Uint8Array) =>
    a.length === b.length && a.every((value, index) => value === b[index]);
  const FORMATS: readonly ImageExportFormat[] = [
    { type: "png" },
    { type: "jpeg", quality: 0.9 },
    { type: "webp", quality: 0.9 },
  ];

  /** The source pixels of a layer that lie wholly inside a region of the scene. */
  function whollyInside(layer: ImageImageLayer, region: ImageRedaction) {
    const toScene = invertMatrix(sceneToLayerSource(layer, layer.crop ?? { x: 0, y: 0, ...SIZE }));
    const inside = new Set<number>();
    for (let y = 0; y < SIZE.height; y += 1) {
      for (let x = 0; x < SIZE.width; x += 1) {
        const within = [
          [x, y],
          [x + 1, y],
          [x, y + 1],
          [x + 1, y + 1],
        ].every(([cx, cy]) => {
          const at = applyMatrix(toScene, { x: cx as number, y: cy as number });
          // Strictly inside, clear of the edge by more than rounding.
          return (
            at.x > region.x + 0.01 &&
            at.x < region.x + region.width - 0.01 &&
            at.y > region.y + 0.01 &&
            at.y < region.y + region.height - 0.01
          );
        });
        if (within) inside.add(y * SIZE.width + x);
      }
    }
    return inside;
  }

  it("exports the same bytes from layer sources that differ only in pixels a solid region covers whole", async () => {
    const region: ImageRedaction = {
      key: "r",
      mode: "solid",
      x: 70,
      y: 30,
      width: 60,
      height: 50,
      colour: "#1a2b3c",
    };
    for (const geometry of [
      // Twice its size, upright; smaller than its size; and turned, with a crop.
      { ...common(40, 20, 80, 60), crop: null },
      { ...common(60, 25, 30, 22), crop: null },
      { ...common(50, 15, 90, 70, 300), crop: { x: 4, y: 3, width: 30, height: 24 } },
      { ...common(30, 10, 120, 90, 1_370), crop: null },
      // Mirrored: upright, and turned with a crop.
      { ...common(40, 20, 80, 60, 0, true), crop: null },
      { ...common(50, 15, 90, 70, 300, true), crop: { x: 4, y: 3, width: 30, height: 24 } },
    ]) {
      const layer: ImageImageLayer = { ...geometry, key: "i", kind: "image", source: "a" };
      const covered = whollyInside(layer, region);
      expect(covered.size, JSON.stringify(geometry)).toBeGreaterThan(20);
      const first = noise(1);
      const other = noise(2);
      const { processor } = await opened({
        a: await png(SIZE.width, SIZE.height, first),
        b: await png(SIZE.width, SIZE.height, (x, y) =>
          covered.has(y * SIZE.width + x) ? other(x, y) : first(x, y),
        ),
      });
      for (const scale of [1, 0.5, 0.37]) {
        for (const format of FORMATS) {
          const plan = (source: string): ImagePlan =>
            withLayers([{ ...layer, source }], {
              output: { kind: "scale", scale },
              redactions: [region],
            });
          try {
            const a = await bytesOf(await processor.export({ plan: plan("a"), format }));
            const b = await bytesOf(await processor.export({ plan: plan("b"), format }));
            expect(same(a, b), `${JSON.stringify(geometry)} ${scale} ${format.type}`).toBe(true);
          } catch (error) {
            if (!isImageError(error, "UNSUPPORTED_FORMAT")) throw error;
          }
        }
      }
      // Without the redaction the two differ, so this can fail.
      const bare = (source: string) =>
        processor.export({ plan: withLayers([{ ...layer, source }]), format: { type: "png" } });
      expect(same(await bytesOf(await bare("a")), await bytesOf(await bare("b")))).toBe(false);
    }
  });

  it("covers text and shapes over a region exactly, whatever they are", async () => {
    const { processor } = await opened();
    const region = { x: 50, y: 30, width: 100, height: 60 };
    const plan = withLayers(
      [
        shape({ x: 30, y: 20, width: 140, height: 80 }),
        text("Secret", { ...region, bold: true }),
        // A scribble across the region and out of it, and an arrow that ends inside it.
        drawing([pen([[10, 10, 150, 80, 60, 90, 190, 20]], { width: 9, colour: "#e00000" })]),
        arrow({ x: 10, y: 110 }, { x: 100, y: 60 }, { width: 8, colour: "#00a000" }),
      ],
      { redactions: [{ key: "r", mode: "solid", ...region, colour: "#1a2b3c" }] },
    );
    const pixels = await decoded(await processor.export({ plan, format: { type: "png" } }));
    for (let y = region.y; y < region.y + region.height; y += 1) {
      for (let x = region.x; x < region.x + region.width; x += 1) {
        if (pixels.at(x, y).join() !== "26,43,60,255") throw new Error(`${x},${y} shows through`);
      }
    }
    // The shape still shows around the region.
    expect(pixels.at(165, 95)).toEqual([0x20, 0x60, 0xc0, 255]);
    // And so do the scribble and the arrow, outside it.
    expect(pixels.at(10, 10)).toEqual([0xe0, 0, 0, 255]);
    expect(pixels.at(16, 106)).toEqual([0, 0xa0, 0, 255]);
  });

  it("never serves an image layer from a copy built for other redactions or another place", async () => {
    const source = await png(SIZE.width, SIZE.height, noise(5));
    const base = await png(WIDTH, HEIGHT, () => WHITE);
    const used = await opened({ a: source }, base);
    const layer: ImageImageLayer = {
      ...common(40, 20, 80, 60),
      key: "i",
      kind: "image",
      source: "a",
      crop: null,
    };
    const A: ImageRedaction = {
      key: "a",
      mode: "solid",
      x: 50,
      y: 30,
      width: 20,
      height: 20,
      colour: "#000000",
    };
    const B: ImageRedaction = { key: "b", mode: "pixelate", x: 90, y: 40, width: 24, height: 30 };
    const sequence: [ImageImageLayer, readonly ImageRedaction[]][] = [
      [layer, [A]],
      [layer, [A, B]],
      [layer, [A]],
      [layer, []],
      [layer, [B]],
      // The same redaction, the layer moved under it: other pixels are covered.
      [{ ...layer, x: 60 }, [B]],
      [{ ...layer, rotation: 200 }, [B]],
      // Mirrored where it is: the same box covers other pixels of its source.
      [{ ...layer, flipX: true }, [B]],
      [layer, [B]],
      [layer, [B, A]],
    ];
    for (const [placed, redactions] of sequence) {
      const plan = withLayers([placed], { redactions, output: { kind: "scale", scale: 0.5 } });
      const reused = await bytesOf(await used.processor.export({ plan, format: { type: "png" } }));
      const fresh = await opened({ a: source }, base);
      const reference = await bytesOf(
        await fresh.processor.export({ plan, format: { type: "png" } }),
      );
      expect(
        same(reused, reference),
        JSON.stringify([placed.x, placed.rotation, placed.flipX, redactions]),
      ).toBe(true);
    }
  });
});
