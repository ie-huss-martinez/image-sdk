import { compositionSize, compositionToSource, cropRect } from "../../core/model/geometry.js";
import { createImageKey } from "../../core/model/keys.js";
import { newLayerBox } from "../../core/model/layer-placement.js";
import {
  type ImageArrowLayer,
  type ImageLayer,
  type ImagePlan,
  type ImageShapeLayer,
  type ImageTextLayer,
  MAX_STROKE_WIDTH,
} from "../../core/model/plan.js";
import type { ImageSize } from "../../core/model/source.js";

/** The colour a new text layer and a new shape's outline take. */
export const DEFAULT_TEXT_COLOUR = "#000000";
export const DEFAULT_SHAPE_COLOUR = "#e02020";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A key no layer or redaction of the plan has. */
export function newLayerKey(plan: ImagePlan): string {
  return createImageKey(new Set([...plan.layers, ...plan.redactions].map((item) => item.key)));
}

const common = (plan: ImagePlan) => ({
  key: newLayerKey(plan),
  name: "",
  visible: true,
  opacity: 100,
});

/**
 * A new text layer, with no text yet: half the image wide and a fifth of it
 * tall, as it's shown. Text is drawn as large as fits its box.
 */
export function newTextLayer(plan: ImagePlan, source: ImageSize): ImageTextLayer {
  const { width, height } = compositionSize(plan, source);
  return {
    ...common(plan),
    kind: "text",
    text: "",
    font: "sans-serif",
    bold: false,
    colour: DEFAULT_TEXT_COLOUR,
    align: "center",
    ...newLayerBox(plan, source, { width: width / 2, height: height / 5 }),
  };
}

/** The outline a shape takes when it's given one: a hundredth of the image's shorter side, at least 2 pixels. */
export function defaultStrokeWidth(plan: ImagePlan, source: ImageSize): number {
  const { width, height } = compositionSize(plan, source);
  return clamp(Math.round(Math.min(width, height) / 100), 2, MAX_STROKE_WIDTH);
}

/**
 * A new shape: an outline with no fill, a quarter of the image each way, to
 * put around something.
 */
export function newShapeLayer(
  plan: ImagePlan,
  source: ImageSize,
  shape: ImageShapeLayer["shape"],
): ImageShapeLayer {
  const { width, height } = compositionSize(plan, source);
  const box = newLayerBox(plan, source, { width: width / 4, height: height / 4 });
  return {
    ...common(plan),
    kind: "shape",
    shape,
    fill: null,
    // Inside the box, so never wider than half of its shorter side.
    stroke: {
      colour: DEFAULT_SHAPE_COLOUR,
      width: Math.max(
        1,
        Math.min(defaultStrokeWidth(plan, source), Math.floor(Math.min(box.width, box.height) / 2)),
      ),
    },
    ...box,
  };
}

/**
 * A new arrow (docs/adr/0014): across the middle quarter of the image as
 * it's shown, pointing right on screen whatever the plan's rotation and
 * flips, in a shape's red, as wide as a new shape's outline.
 */
export function newArrowLayer(plan: ImagePlan, source: ImageSize): ImageArrowLayer {
  const composition = compositionSize(plan, source);
  const crop = cropRect(plan.base.crop, source);
  const { orientation } = plan.base;
  const scene = (x: number, y: number) => {
    const point = compositionToSource({ x, y }, crop, orientation);
    return { x: Math.round(point.x) || 0, y: Math.round(point.y) || 0 };
  };
  const middle = composition.height / 2;
  const from = scene((composition.width * 3) / 8, middle);
  let to = scene((composition.width * 5) / 8, middle);
  // On an image a pixel or two wide the ends round to one point: an arrow has two.
  if (to.x === from.x && to.y === from.y) {
    const beside = scene((composition.width * 3) / 8 + 1, middle);
    to = beside.x === from.x && beside.y === from.y ? { x: from.x + 1, y: from.y } : beside;
  }
  return {
    ...common(plan),
    kind: "arrow",
    from,
    to,
    colour: DEFAULT_SHAPE_COLOUR,
    width: defaultStrokeWidth(plan, source),
  };
}

/** The command that puts a new layer over every other. */
export const insertOnTop = (plan: ImagePlan, layer: ImageLayer) =>
  ({ type: "image.insertLayers", at: plan.layers.length, layers: [layer] }) as const;
