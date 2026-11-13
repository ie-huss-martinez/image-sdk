import { compositionToSource, sourceToComposition } from "./geometry.js";
import type { ImageCrop, ImageOrientation } from "./plan.js";
import type { ImageSize } from "./source.js";

/**
 * The crop frame's geometry (docs/adr/0007): pure functions over crops in
 * whole pixels of the oriented source, which the editor's frame, keys and
 * fields share, so every way of cropping gives the same result.
 */

/**
 * An aspect ratio the crop panel offers: free, the source's own, or width
 * over height.
 *
 * @public
 */
export type ImageAspect = "free" | "original" | readonly [number, number];

/**
 * The crop panel's presets, landscape then portrait (docs/adr/0007).
 *
 * @public
 */
export const ASPECT_PRESETS: readonly ImageAspect[] = [
  "free",
  "original",
  [1, 1],
  [4, 3],
  [3, 2],
  [16, 9],
  [3, 4],
  [2, 3],
  [9, 16],
];

/**
 * The ratio of an aspect, width over height, or `undefined` for free.
 *
 * @public
 */
export function aspectRatio(aspect: ImageAspect, source: ImageSize): number | undefined {
  if (aspect === "free") return undefined;
  if (aspect === "original") return source.width / source.height;
  return aspect[0] / aspect[1];
}

/** The whole source as a crop. */
export const wholeCrop = (source: ImageSize): ImageCrop => ({
  x: 0,
  y: 0,
  width: source.width,
  height: source.height,
});

/**
 * The largest crop of a ratio inside `within`, centred in it, in whole
 * pixels and at least 1 × 1. With no ratio, `within` as it is.
 *
 * @public
 */
export function fitAspect(within: ImageCrop, ratio: number | undefined): ImageCrop {
  if (ratio === undefined) return within;
  let width = within.width;
  let height = Math.round(width / ratio);
  if (height > within.height) {
    height = within.height;
    width = Math.round(height * ratio);
  }
  width = Math.max(1, Math.min(within.width, width));
  height = Math.max(1, Math.min(within.height, height));
  return {
    x: within.x + Math.floor((within.width - width) / 2),
    y: within.y + Math.floor((within.height - height) / 2),
    width,
    height,
  };
}

/**
 * A crop moved by whole pixels, kept inside the source.
 *
 * @public
 */
export function moveCrop(crop: ImageCrop, dx: number, dy: number, source: ImageSize): ImageCrop {
  return {
    ...crop,
    x: Math.min(source.width - crop.width, Math.max(0, crop.x + Math.round(dx))),
    y: Math.min(source.height - crop.height, Math.max(0, crop.y + Math.round(dy))),
  };
}

/**
 * The edges a handle moves: `n`, `s`, `e` and `w`, and the corners that
 * combine two.
 *
 * @public
 */
export type CropHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * A crop with a handle dragged by a distance in source pixels, kept inside
 * the source and at least 1 × 1, in whole pixels. With a ratio, the opposite
 * edge or corner stays put and the other side follows the ratio.
 *
 * @public
 */
export function dragHandle(
  crop: ImageCrop,
  handle: CropHandle,
  dx: number,
  dy: number,
  source: ImageSize,
  ratio?: number,
): ImageCrop {
  let left = crop.x;
  let top = crop.y;
  let right = crop.x + crop.width;
  let bottom = crop.y + crop.height;
  if (handle.includes("w")) left = Math.min(right - 1, Math.max(0, left + dx));
  if (handle.includes("e")) right = Math.max(left + 1, Math.min(source.width, right + dx));
  if (handle.includes("n")) top = Math.min(bottom - 1, Math.max(0, top + dy));
  if (handle.includes("s")) bottom = Math.max(top + 1, Math.min(source.height, bottom + dy));
  left = Math.round(left);
  right = Math.round(right);
  top = Math.round(top);
  bottom = Math.round(bottom);
  if (ratio === undefined) {
    return { x: left, y: top, width: right - left, height: bottom - top };
  }
  // Keep the ratio from the moved size, anchored at the opposite side, and
  // within the room the source leaves there.
  const horizontal = handle.includes("e") || handle.includes("w");
  const vertical = handle.includes("n") || handle.includes("s");
  let width = right - left;
  let height = bottom - top;
  if (horizontal && !vertical) height = width / ratio;
  else if (vertical && !horizontal) width = height * ratio;
  else if (width / height > ratio) width = height * ratio;
  else height = width / ratio;
  const roomRight = handle.includes("w") ? right : source.width - left;
  const roomDown = handle.includes("n") ? bottom : source.height - top;
  const scale = Math.min(1, roomRight / width, roomDown / height);
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  const x = handle.includes("w") ? right - width : left;
  let y = handle.includes("n") ? bottom - height : top;
  // A side handle keeps the crop centred across it.
  let cx = x;
  if (vertical && !horizontal) cx = Math.round(crop.x + (crop.width - width) / 2);
  if (horizontal && !vertical) y = Math.round(crop.y + (crop.height - height) / 2);
  return {
    x: Math.min(source.width - width, Math.max(0, cx)),
    y: Math.min(source.height - height, Math.max(0, y)),
    width,
    height,
  };
}

/**
 * Where a crop of the oriented source appears in the composition of the
 * whole source under an orientation: an axis-aligned rectangle, since the
 * plan turns in quarter turns.
 *
 * @public
 */
export function cropInComposition(
  crop: ImageCrop,
  orientation: ImageOrientation,
  source: ImageSize,
): ImageCrop {
  const whole = wholeCrop(source);
  const a = sourceToComposition({ x: crop.x, y: crop.y }, whole, orientation);
  const b = sourceToComposition(
    { x: crop.x + crop.width, y: crop.y + crop.height },
    whole,
    orientation,
  );
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/**
 * A distance in the composition of the whole source, as a distance in the
 * oriented source: what a pointer drag on the stage moves the crop by.
 *
 * @public
 */
export function compositionDeltaToSource(
  dx: number,
  dy: number,
  orientation: ImageOrientation,
  source: ImageSize,
): { readonly dx: number; readonly dy: number } {
  const whole = wholeCrop(source);
  const origin = compositionToSource({ x: 0, y: 0 }, whole, orientation);
  const moved = compositionToSource({ x: dx, y: dy }, whole, orientation);
  return { dx: moved.x - origin.x, dy: moved.y - origin.y };
}

/**
 * Which source edges a handle on screen moves, under an orientation: the
 * handle's compass point in the composition, mapped back to the source.
 *
 * @public
 */
export function handleInSource(handle: CropHandle, orientation: ImageOrientation): CropHandle {
  const vector = { x: 0, y: 0 };
  if (handle.includes("e")) vector.x = 1;
  if (handle.includes("w")) vector.x = -1;
  if (handle.includes("s")) vector.y = 1;
  if (handle.includes("n")) vector.y = -1;
  const unit = compositionDeltaToSource(vector.x, vector.y, orientation, { width: 2, height: 2 });
  const ns = unit.dy > 0 ? "s" : unit.dy < 0 ? "n" : "";
  const ew = unit.dx > 0 ? "e" : unit.dx < 0 ? "w" : "";
  return `${ns}${ew}` as CropHandle;
}

/**
 * Moves or resizes a crop from the keyboard as it's seen on screen
 * (docs/adr/0007): an arrow moves it that way on screen, by `step` pixels of
 * the source; with `resize`, Left and Right move its right edge on screen,
 * and Up and Down its bottom edge, keeping a ratio if one is set.
 *
 * @public
 */
export function nudgeCropOnScreen(
  crop: ImageCrop,
  key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
  step: number,
  resize: boolean,
  orientation: ImageOrientation,
  source: ImageSize,
  ratio?: number,
): ImageCrop {
  const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
  const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
  const moved = compositionDeltaToSource(dx, dy, orientation, source);
  if (!resize) return moveCrop(crop, moved.dx, moved.dy, source);
  const handle = handleInSource(dx === 0 ? "s" : "e", orientation);
  return dragHandle(crop, handle, moved.dx, moved.dy, source, ratio);
}
