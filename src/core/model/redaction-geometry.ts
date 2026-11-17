import { compositionToSource, sourceToComposition } from "./geometry.js";
import { type ImageCrop, type ImageOrientation, MAX_SCENE_COORDINATE } from "./plan.js";
import type { ImageSize } from "./source.js";

/**
 * A rectangle in whole pixels.
 *
 * @public
 */
export interface ImageRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The smallest side of a pixelation block, in scene pixels (ADR 0010). */
const MIN_BLOCK = 8;
/** The most blocks along a pixelated region's longer side (ADR 0010). */
const MAX_BLOCKS = 12;

/**
 * The side of a pixelated region's square blocks, in scene pixels: the
 * larger of 8 and a twelfth of the region's longer side, rounded up (ADR
 * 0010). So a region has at most 12 blocks along its longer side, and a
 * strip over a line of text is one row of them. It isn't a setting.
 *
 * @public
 */
export function redactionBlockSize(region: ImageSize): number {
  return Math.max(MIN_BLOCK, Math.ceil(Math.max(region.width, region.height) / MAX_BLOCKS));
}

/** The boundaries of a region's blocks along one axis: its start, each block's end, its end. */
function boundaries(start: number, length: number, block: number): number[] {
  const edges = [start];
  for (let at = start + block; at < start + length; at += block) edges.push(at);
  edges.push(start + length);
  return edges;
}

/** The rectangles between consecutive boundaries, leaving out any with no pixels. */
function cells(xs: readonly number[], ys: readonly number[]): ImageRect[] {
  const rects: ImageRect[] = [];
  for (let row = 0; row + 1 < ys.length; row += 1) {
    const y = ys[row] as number;
    const height = (ys[row + 1] as number) - y;
    if (height <= 0) continue;
    for (let column = 0; column + 1 < xs.length; column += 1) {
      const x = xs[column] as number;
      const width = (xs[column + 1] as number) - x;
      if (width > 0) rects.push({ x, y, width, height });
    }
  }
  return rects;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * A pixelated region's blocks in the scene, each clipped to `within`: the
 * part of the source that's rendered, its crop. Blocks are aligned to the
 * region's top-left corner, and one that falls wholly outside `within` is
 * left out. They're listed row by row.
 *
 * @public
 */
export function redactionBlocksInScene(region: ImageRect, within: ImageRect): ImageRect[] {
  const block = redactionBlockSize(region);
  const clip = (edges: number[], min: number, max: number) =>
    edges.map((edge) => clamp(edge, min, max));
  return cells(
    clip(boundaries(region.x, region.width, block), within.x, within.x + within.width),
    clip(boundaries(region.y, region.height, block), within.y, within.y + within.height),
  );
}

/**
 * Where the scene's vertical and horizontal lines fall in the output:
 * through the crop, the rotation and the flips, then scaled. A quarter turn
 * maps the scene's x axis to the output's y axis.
 */
function toOutput(crop: ImageCrop, orientation: ImageOrientation, output: ImageSize) {
  const turned = orientation.rotate % 180 !== 0;
  const composition = turned
    ? { width: crop.height, height: crop.width }
    : { width: crop.width, height: crop.height };
  const scaleX = output.width / composition.width;
  const scaleY = output.height / composition.height;
  const at = (x: number, y: number) => {
    const point = sourceToComposition({ x, y }, crop, orientation);
    return { x: point.x * scaleX, y: point.y * scaleY };
  };
  return {
    turned,
    /** The output coordinate of the scene line `x = value`. */
    fromX: (value: number) => (turned ? at(value, crop.y).y : at(value, crop.y).x),
    /** The output coordinate of the scene line `y = value`. */
    fromY: (value: number) => (turned ? at(crop.x, value).x : at(crop.x, value).y),
  };
}

/**
 * Output boundaries from scene boundaries: in rising order, the outer two
 * rounded outward so every output pixel the region touches is inside, the
 * others to the nearest pixel, all within the output and never decreasing.
 */
function outputEdges(values: readonly number[], size: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const last = sorted.length - 1;
  let previous = 0;
  return sorted.map((value, index) => {
    const rounded =
      index === 0 ? Math.floor(value) : index === last ? Math.ceil(value) : Math.round(value);
    previous = Math.max(previous, clamp(rounded, 0, size));
    return previous;
  });
}

/**
 * The output pixels a region covers: the region mapped through the crop,
 * the rotation, the flips and the output's scale, rounded outward so that
 * every pixel it touches is covered whole, and clipped to the output (ADR
 * 0010). `null` when it covers none.
 *
 * @param region - The region, in scene pixels.
 * @param crop - The crop, or the whole source: `cropRect(plan.base.crop, source)`.
 * @param orientation - The plan's rotation and flips.
 * @param output - The size being rendered.
 * @public
 */
export function redactionRectInOutput(
  region: ImageRect,
  crop: ImageCrop,
  orientation: ImageOrientation,
  output: ImageSize,
): ImageRect | null {
  const { turned, fromX, fromY } = toOutput(crop, orientation, output);
  const alongX = [fromX(region.x), fromX(region.x + region.width)];
  const alongY = [fromY(region.y), fromY(region.y + region.height)];
  const [left, right] = outputEdges(turned ? alongY : alongX, output.width) as [number, number];
  const [top, bottom] = outputEdges(turned ? alongX : alongY, output.height) as [number, number];
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * A pixelated region's blocks in the output: the scene's block boundaries
 * mapped as {@link redactionRectInOutput} maps the region. The region's own
 * edges are rounded outward and the boundaries between blocks to the
 * nearest pixel, so the blocks tile exactly the pixels the region covers. A
 * block with no output pixel is left out. They're listed row by row.
 *
 * @public
 */
export function redactionBlocksInOutput(
  region: ImageRect,
  crop: ImageCrop,
  orientation: ImageOrientation,
  output: ImageSize,
): ImageRect[] {
  const block = redactionBlockSize(region);
  const { turned, fromX, fromY } = toOutput(crop, orientation, output);
  const alongX = boundaries(region.x, region.width, block).map(fromX);
  const alongY = boundaries(region.y, region.height, block).map(fromY);
  return cells(
    outputEdges(turned ? alongY : alongX, output.width),
    outputEdges(turned ? alongX : alongY, output.height),
  );
}

/** The rectangle between two opposite corners, in either order. */
function between(a: { x: number; y: number }, b: { x: number; y: number }): ImageRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x, b.x) - x, height: Math.max(a.y, b.y) - y };
}

/**
 * A rectangle of the scene as the composition shows it: through the crop,
 * the rotation and the flips, in composition pixels, without clipping. The
 * plan turns by quarters, so it's still a rectangle in whole pixels. The
 * editor places a region's frame with it.
 *
 * @public
 */
export function sceneRectToComposition(
  rect: ImageRect,
  crop: ImageCrop,
  orientation: ImageOrientation,
): ImageRect {
  return between(
    sourceToComposition({ x: rect.x, y: rect.y }, crop, orientation),
    sourceToComposition({ x: rect.x + rect.width, y: rect.y + rect.height }, crop, orientation),
  );
}

/**
 * The inverse of {@link sceneRectToComposition}: a rectangle drawn on the
 * composition, such as a region dragged out on screen, in scene pixels.
 *
 * @public
 */
export function compositionRectToScene(
  rect: ImageRect,
  crop: ImageCrop,
  orientation: ImageOrientation,
): ImageRect {
  return between(
    compositionToSource({ x: rect.x, y: rect.y }, crop, orientation),
    compositionToSource({ x: rect.x + rect.width, y: rect.y + rect.height }, crop, orientation),
  );
}

/**
 * A rectangle as a redaction's region: whole pixels, rounded outward so it
 * covers everything the rectangle touched, at least 1 × 1, and within
 * `MAX_SCENE_COORDINATE` of the scene's origin. The editor fits what's
 * dragged or typed with it before it builds a command, so the reducer never
 * has to refuse it.
 *
 * @public
 */
export function fitRedactionRegion(rect: ImageRect): ImageRect {
  const limit = MAX_SCENE_COORDINATE;
  const x = clamp(Math.floor(rect.x), -limit, limit - 1);
  const y = clamp(Math.floor(rect.y), -limit, limit - 1);
  const right = clamp(Math.ceil(rect.x + rect.width), x + 1, limit);
  const bottom = clamp(Math.ceil(rect.y + rect.height), y + 1, limit);
  return { x, y, width: right - x, height: bottom - y };
}
