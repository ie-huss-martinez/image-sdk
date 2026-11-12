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
 * The base's tonal and colour adjustments (ADR 0006). Each is an integer
 * from -100 to 100, where 0 is unchanged, applied in this order.
 *
 * @public
 */
export interface ImageDevelop {
  /** Warmer (positive) or cooler (negative). */
  readonly temperature: number;
  /** Toward magenta (positive) or green (negative). */
  readonly tint: number;
  /** In fiftieths of a stop: 100 is two stops brighter. */
  readonly exposure: number;
  readonly highlights: number;
  readonly shadows: number;
  readonly contrast: number;
  readonly saturation: number;
  /** Saturation weighted toward the least saturated colours. */
  readonly vibrance: number;
}

/**
 * The names of the develop adjustments, in the order they're applied.
 *
 * @public
 */
export const DEVELOP_ADJUSTMENTS = [
  "temperature",
  "tint",
  "exposure",
  "highlights",
  "shadows",
  "contrast",
  "saturation",
  "vibrance",
] as const satisfies readonly (keyof ImageDevelop)[];

/**
 * Every adjustment at 0: the base as it was decoded.
 *
 * @public
 */
export const NEUTRAL_DEVELOP: ImageDevelop = Object.freeze({
  temperature: 0,
  tint: 0,
  exposure: 0,
  highlights: 0,
  shadows: 0,
  contrast: 0,
  saturation: 0,
  vibrance: 0,
});

/**
 * The filter presets (ADR 0006). Names are part of the document format:
 * presets are only ever added.
 *
 * @public
 */
export const FILTER_PRESETS = ["vivid", "warm", "cool", "fade", "mono", "noir", "sepia"] as const;

/**
 * A filter preset's name.
 *
 * @public
 */
export type ImageFilterPreset = (typeof FILTER_PRESETS)[number];

/**
 * A filter preset and its strength, an integer from 0 (no effect) to 100.
 *
 * @public
 */
export interface ImageFilter {
  readonly preset: ImageFilterPreset;
  readonly strength: number;
}

/**
 * The image being edited: a source, its crop and orientation, and its
 * develop adjustments and filter.
 *
 * @public
 */
export interface ImageBase {
  /** The id of a registered source. */
  readonly source: string;
  /** The crop, or `null` for the whole image. */
  readonly crop: ImageCrop | null;
  readonly orientation: ImageOrientation;
  readonly develop: ImageDevelop;
  /** The filter, or `null` for none. */
  readonly filter: ImageFilter | null;
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
 * The plan for a newly opened source: the whole image, upright, undeveloped
 * and unfiltered, at full size, keeping no metadata.
 *
 * @public
 */
export function createPlan(source: string): ImagePlan {
  return {
    base: { source, crop: null, orientation: UPRIGHT, develop: NEUTRAL_DEVELOP, filter: null },
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
