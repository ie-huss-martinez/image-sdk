import type { ImageCrop, ImageOrientation, ImageOutput, ImagePlan } from "./plan.js";
import type { ExifOrientation, ImageSize } from "./source.js";

/**
 * A point in pixels, which may be fractional.
 *
 * @public
 */
export interface ImagePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The upright size of stored pixels with an EXIF orientation: orientations 5
 * to 8 swap width and height (ADR 0005).
 *
 * @public
 */
export function orientedSize(stored: ImageSize, orientation: ExifOrientation): ImageSize {
  return orientation >= 5 ? { width: stored.height, height: stored.width } : stored;
}

/**
 * The cropped area of a source, or the whole source when there's no crop.
 *
 * @public
 */
export function cropRect(crop: ImageCrop | null, source: ImageSize): ImageCrop {
  return crop ?? { x: 0, y: 0, width: source.width, height: source.height };
}

/**
 * The size of the composition: the cropped source, turned by the plan's own
 * rotation (ADR 0003).
 *
 * @public
 */
export function compositionSize(plan: ImagePlan, source: ImageSize): ImageSize {
  const { width, height } = cropRect(plan.base.crop, source);
  const turned = plan.base.orientation.rotate % 180 !== 0;
  return turned ? { width: height, height: width } : { width, height };
}

/**
 * The size an export produces: the composition scaled down or fitted inside
 * a box, never enlarged, rounded to whole pixels and at least 1 × 1.
 *
 * @public
 */
export function outputSize(output: ImageOutput, composition: ImageSize): ImageSize {
  const factor =
    output.kind === "scale"
      ? output.scale
      : Math.min(1, output.width / composition.width, output.height / composition.height);
  return {
    width: Math.max(1, Math.round(composition.width * factor)),
    height: Math.max(1, Math.round(composition.height * factor)),
  };
}

/**
 * Maps a point in the cropped source to the composition, through the plan's
 * rotation and then its flips. Points are continuous coordinates, so the
 * cropped rectangle's corners map to the composition's corners.
 *
 * @public
 */
export function sourceToComposition(
  point: ImagePoint,
  crop: ImageCrop,
  orientation: ImageOrientation,
): ImagePoint {
  const x = point.x - crop.x;
  const y = point.y - crop.y;
  const { width, height } = crop;
  let turned: ImagePoint;
  switch (orientation.rotate) {
    case 90:
      turned = { x: height - y, y: x };
      break;
    case 180:
      turned = { x: width - x, y: height - y };
      break;
    case 270:
      turned = { x: y, y: width - x };
      break;
    default:
      turned = { x, y };
  }
  const size =
    orientation.rotate % 180 === 0 ? { width, height } : { width: height, height: width };
  return {
    x: orientation.flipX ? size.width - turned.x : turned.x,
    y: orientation.flipY ? size.height - turned.y : turned.y,
  };
}

/**
 * The inverse of {@link sourceToComposition}: maps a point in the
 * composition, such as the pointer, back to the source.
 *
 * @public
 */
export function compositionToSource(
  point: ImagePoint,
  crop: ImageCrop,
  orientation: ImageOrientation,
): ImagePoint {
  const { width, height } = crop;
  const size =
    orientation.rotate % 180 === 0 ? { width, height } : { width: height, height: width };
  const x = orientation.flipX ? size.width - point.x : point.x;
  const y = orientation.flipY ? size.height - point.y : point.y;
  let source: ImagePoint;
  switch (orientation.rotate) {
    case 90:
      source = { x: y, y: height - x };
      break;
    case 180:
      source = { x: width - x, y: height - y };
      break;
    case 270:
      source = { x: width - y, y: x };
      break;
    default:
      source = { x, y };
  }
  return { x: source.x + crop.x, y: source.y + crop.y };
}
