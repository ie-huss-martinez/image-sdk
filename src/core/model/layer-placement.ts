import { compositionSize, compositionToSource, cropRect } from "./geometry.js";
import { layerToOutput } from "./layer-geometry.js";
import { type ImageLayerBox, type ImagePlan, MAX_SCENE_COORDINATE } from "./plan.js";
import type { ImageSize } from "./source.js";

const QUARTERS = [0, 900, 1_800, 2_700] as const;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * A box for a new layer (ADR 0009, docs/adr/0013): of the given size as it's seen,
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

/**
 * The size a new image layer is seen at: its own, or fitted in half of the
 * image as it's shown if that's smaller. It's never enlarged.
 */
export function fittedImageSize(plan: ImagePlan, source: ImageSize, image: ImageSize): ImageSize {
  const { width, height } = compositionSize(plan, source);
  const scale = Math.min(1, width / 2 / image.width, height / 2 / image.height);
  return { width: image.width * scale, height: image.height * scale };
}
