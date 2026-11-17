import {
  applyMatrix,
  type ImageMatrix,
  invertMatrix,
  layerToScene,
} from "../../core/model/layer-geometry.js";
import {
  type ImageBoxedLayer,
  type ImageLayer,
  type ImageLayerBox,
  type ImageScenePoint,
  MAX_SCENE_COORDINATE,
} from "../../core/model/plan.js";

/**
 * Whether a layer has a box: text, a shape or an image. A drawing and an
 * arrow have none (docs/adr/0014); their frames come with their tools.
 */
export const isBoxedLayer = (layer: ImageLayer): layer is ImageBoxedLayer =>
  layer.kind === "text" || layer.kind === "shape" || layer.kind === "image";

/** One of a box's own edges: `n` is its top before it's turned. */
export type LayerEdge = "n" | "e" | "s" | "w";
/** An edge or a corner of a box, where a handle sits. */
export type LayerHandle = LayerEdge | "nw" | "ne" | "se" | "sw";

export const LAYER_HANDLES: readonly LayerHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** A vector under a transform's turn, flip and scale, without its translation. */
export function turned(
  [a, b, c, d]: ImageMatrix,
  x: number,
  y: number,
): { readonly x: number; readonly y: number } {
  return { x: a * x + c * y, y: b * x + d * y };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** A whole number, and never a negative zero. */
const whole = (value: number) => Math.round(value) || 0;

/** A layer's box, without its other fields. */
export const boxOf = ({ x, y, width, height, rotation, flipX }: ImageLayerBox): ImageLayerBox => ({
  x,
  y,
  width,
  height,
  rotation,
  flipX,
});

/**
 * A box moved by a distance on screen, in composition pixels: through the
 * plan's rotation and flips, back to the scene. The plan turns by quarters,
 * so a whole pixel on screen is a whole pixel of the scene.
 *
 * @param sceneToComposition - `sceneToOutput` at the composition's own size.
 */
export function moveLayerBox(
  box: ImageLayerBox,
  sceneToComposition: ImageMatrix,
  dx: number,
  dy: number,
): ImageLayerBox {
  const by = turned(invertMatrix(sceneToComposition), dx, dy);
  const limit = MAX_SCENE_COORDINATE;
  return {
    ...box,
    x: clamp(box.x + whole(by.x), -limit, limit),
    y: clamp(box.y + whole(by.y), -limit, limit),
  };
}

/**
 * A box with one handle dragged by a distance along its own axes, at least
 * 1 × 1. What's opposite the handle stays where it is: the other edge, or
 * the other corner. An upright box keeps it exactly. A turned box is turned
 * about its centre, which a resize moves, and the plan holds whole pixels,
 * so its far side stays within a pixel.
 */
export function resizeLayerBox(
  box: ImageLayerBox,
  handle: LayerHandle,
  dx: number,
  dy: number,
): ImageLayerBox {
  const west = handle.includes("w");
  const north = handle.includes("n");
  const size = (length: number, by: number) => clamp(whole(length + by), 1, MAX_SCENE_COORDINATE);
  const width = handle.includes("e")
    ? size(box.width, dx)
    : west
      ? size(box.width, -dx)
      : box.width;
  const height = handle.includes("s")
    ? size(box.height, dy)
    : north
      ? size(box.height, -dy)
      : box.height;
  const matrix = layerToScene(box);
  // The point that stays, in the scene, and where the new box has it.
  const anchor = applyMatrix(matrix, { x: west ? box.width : 0, y: north ? box.height : 0 });
  const fromCentre = turned(
    matrix,
    (west ? width : 0) - width / 2,
    (north ? height : 0) - height / 2,
  );
  const limit = MAX_SCENE_COORDINATE;
  return {
    x: clamp(whole(anchor.x - fromCentre.x - width / 2), -limit, limit),
    y: clamp(whole(anchor.y - fromCentre.y - height / 2), -limit, limit),
    width,
    height,
    rotation: box.rotation,
    flipX: box.flipX,
  };
}

/**
 * The edge of a box that faces right, or down, on screen: the one a key
 * moves, so `Shift` with Right grows what's seen to the right whatever the
 * layer's turn and the plan's rotation and flips. A box turned an eighth
 * has two such edges; the first of east, south, west and north is taken.
 *
 * @param layerToComposition - `layerToOutput` at the composition's own size.
 */
export function edgeFacing(
  layerToComposition: ImageMatrix,
  direction: "right" | "down",
): LayerEdge {
  const east = turned(layerToComposition, 1, 0);
  const south = turned(layerToComposition, 0, 1);
  const along = (vector: { x: number; y: number }) => (direction === "right" ? vector.x : vector.y);
  const facing: readonly (readonly [LayerEdge, number])[] = [
    ["e", along(east)],
    ["s", along(south)],
    ["w", -along(east)],
    ["n", -along(south)],
  ];
  let best = facing[0] as readonly [LayerEdge, number];
  // A later edge wins only by more than rounding's worth.
  for (const edge of facing) if (edge[1] > best[1] + 1e-9) best = edge;
  return best[0];
}

/** A box with the edge that faces right or down on screen moved out by `by` pixels, or in. */
export function resizeLayerBoxOnScreen(
  box: ImageLayerBox,
  layerToComposition: ImageMatrix,
  direction: "right" | "down",
  by: number,
): ImageLayerBox {
  const edge = edgeFacing(layerToComposition, direction);
  const outward = edge === "e" || edge === "s" ? by : -by;
  return resizeLayerBox(box, edge, outward, outward);
}

const CURSORS = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"] as const;

/** The resize cursor for a handle as it's seen: along the direction it moves on screen. */
export function handleCursor(layerToComposition: ImageMatrix, handle: LayerHandle): string {
  const x = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
  const y = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
  const seen = turned(layerToComposition, x, y);
  const eighths = Math.round(Math.atan2(seen.y, seen.x) / (Math.PI / 4));
  return CURSORS[((eighths % 4) + 4) % 4] as string;
}

/** A box's place and size: what a move or a resize sets. */
export const placeOf = ({ x, y, width, height }: ImageLayerBox) => ({ x, y, width, height });

/**
 * A point of the scene moved by a distance on screen, in composition
 * pixels, as {@link moveLayerBox} moves a box: a drawing's origin, or an
 * arrow's end.
 */
export function moveScenePoint(
  point: ImageScenePoint,
  sceneToComposition: ImageMatrix,
  dx: number,
  dy: number,
): ImageScenePoint {
  const by = turned(invertMatrix(sceneToComposition), dx, dy);
  const limit = MAX_SCENE_COORDINATE;
  return {
    x: clamp(point.x + whole(by.x), -limit, limit),
    y: clamp(point.y + whole(by.y), -limit, limit),
  };
}
