import { compositionSize, compositionToSource, cropRect } from "../../core/model/geometry.js";
import { createImageKey } from "../../core/model/keys.js";
import { layerToOutput } from "../../core/model/layer-geometry.js";
import {
  type ImageImageLayer,
  type ImageLayer,
  type ImageLayerBox,
  type ImagePlan,
  type ImageShapeLayer,
  type ImageTextLayer,
  MAX_SCENE_COORDINATE,
  MAX_STROKE_WIDTH,
} from "../../core/model/plan.js";
import type { ImageSize } from "../../core/model/source.js";

/** The colour a new text layer and a new shape's outline take. */
export const DEFAULT_TEXT_COLOUR = "#000000";
export const DEFAULT_SHAPE_COLOUR = "#e02020";

const QUARTERS = [0, 900, 1_800, 2_700] as const;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A key no layer or redaction of the plan has. */
export function newLayerKey(plan: ImagePlan): string {
  return createImageKey(new Set([...plan.layers, ...plan.redactions].map((item) => item.key)));
}

/**
 * A box for a new layer (docs/adr/0013): of the given size as it's seen,
 * in the middle of the image as it's shown, and the right way round on
 * screen whatever the plan's rotation and flips. Layers live in the scene,
 * which the plan turns and mirrors with the image; a new one is turned and
 * mirrored back, so text added to a mirrored image reads as text.
 */
export function newLayerBox(plan: ImagePlan, source: ImageSize, seen: ImageSize): ImageLayerBox {
  const crop = cropRect(plan.base.crop, source);
  const { orientation } = plan.base;
  const composition = compositionSize(plan, source);
  const width = clamp(Math.round(seen.width), 1, MAX_SCENE_COORDINATE);
  const height = clamp(Math.round(seen.height), 1, MAX_SCENE_COORDINATE);
  // The quarter turn and the flip after which the box's own right is right
  // on screen, and its own down is down: one of the eight always is.
  const asSeen = (rotation: number, flipX: boolean) => {
    const [a, , , d] = layerToOutput(
      { x: 0, y: 0, width, height, rotation, flipX },
      crop,
      orientation,
      composition,
    );
    return a > 0.5 && d > 0.5;
  };
  const flipX = !QUARTERS.some((rotation) => asSeen(rotation, false));
  const rotation = QUARTERS.find((quarter) => asSeen(quarter, flipX)) ?? 0;
  const centre = compositionToSource(
    { x: composition.width / 2, y: composition.height / 2 },
    crop,
    orientation,
  );
  return {
    // A box is flipped and turned about its centre, so its place is its centre's.
    x: Math.round(centre.x - width / 2) || 0,
    y: Math.round(centre.y - height / 2) || 0,
    width,
    height,
    rotation,
    flipX,
  };
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
 * A new image layer over a source the session holds: at its own size, or
 * fitted in half of the image as it's shown if that's smaller.
 */
export function newImageLayer(
  plan: ImagePlan,
  source: ImageSize,
  image: ImageSize & { readonly id: string },
): ImageImageLayer {
  const { width, height } = compositionSize(plan, source);
  const scale = Math.min(1, width / 2 / image.width, height / 2 / image.height);
  return {
    ...common(plan),
    kind: "image",
    source: image.id,
    crop: null,
    ...newLayerBox(plan, source, { width: image.width * scale, height: image.height * scale }),
  };
}

/** The command that puts a new layer over every other. */
export const insertOnTop = (plan: ImagePlan, layer: ImageLayer) =>
  ({ type: "image.insertLayers", at: plan.layers.length, layers: [layer] }) as const;
