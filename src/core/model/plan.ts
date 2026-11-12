import type { ImageKeepableMetadata, ImageSize } from "./source.js";

/**
 * A rectangle in whole pixels of the oriented source: `x` and `y` from its
 * top left, `width` and `height` at least 1 (ADR 0003).
 *
 * @public
 */
export interface ImageCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A quarter-turn rotation, clockwise, in degrees.
 *
 * @public
 */
export type ImageRotation = 0 | 90 | 180 | 270;

/**
 * The plan's own rotation and flips, applied after the crop. They're user
 * edits, separate from the file's EXIF orientation, which decoding has
 * already applied (ADR 0005).
 *
 * @public
 */
export interface ImageOrientation {
  readonly rotate: ImageRotation;
  /** Mirrors left to right, after the rotation. */
  readonly flipX: boolean;
  /** Mirrors top to bottom, after the rotation. */
  readonly flipY: boolean;
}

/**
 * The image being edited: a source, its crop and its orientation.
 *
 * @public
 */
export interface ImageBase {
  /** The id of a registered source. */
  readonly source: string;
  /** The crop, or `null` for the whole image. */
  readonly crop: ImageCrop | null;
  readonly orientation: ImageOrientation;
}

/**
 * The export's size: the composition scaled by a factor up to 1, or fitted
 * inside a box without enlarging it.
 *
 * @public
 */
export type ImageOutput =
  | { readonly kind: "scale"; readonly scale: number }
  | { readonly kind: "fit"; readonly width: number; readonly height: number };

/**
 * The session's document: a description of the edits over an immutable
 * source, rendered to pixels only for display and export (ADR 0003).
 *
 * @public
 */
export interface ImagePlan {
  readonly base: ImageBase;
  readonly output: ImageOutput;
  /** The fields the user chose to keep on export. Never a location (ADR 0005). */
  readonly metadata: ImageKeepableMetadata;
}

/**
 * No rotation and no flips.
 *
 * @public
 */
export const UPRIGHT: ImageOrientation = Object.freeze({ rotate: 0, flipX: false, flipY: false });

/**
 * The export at full size.
 *
 * @public
 */
export const FULL_SIZE: ImageOutput = Object.freeze({ kind: "scale", scale: 1 });

/**
 * The plan for a newly opened source: the whole image, upright, at full
 * size, keeping no metadata.
 *
 * @public
 */
export function createPlan(source: string): ImagePlan {
  return {
    base: { source, crop: null, orientation: UPRIGHT },
    output: FULL_SIZE,
    metadata: { title: "", description: "", artist: "", copyright: "" },
  };
}

/**
 * Whether a crop is valid for a source of the given oriented size: whole
 * pixels, at least 1 × 1, and inside the source.
 *
 * @internal
 */
export function isValidCrop(crop: ImageCrop, source: ImageSize): boolean {
  const { x, y, width, height } = crop;
  return (
    [x, y, width, height].every(Number.isSafeInteger) &&
    x >= 0 &&
    y >= 0 &&
    width >= 1 &&
    height >= 1 &&
    x + width <= source.width &&
    y + height <= source.height
  );
}
