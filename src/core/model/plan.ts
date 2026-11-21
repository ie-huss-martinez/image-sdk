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
export const NEUTRAL_DEVELOP: ImageDevelop = /* @__PURE__ */ Object.freeze({
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
 * The most layers and redactions a plan holds, together: the format's
 * ceiling, which the file policy's `maxLayers` applies below (ADR 0009).
 *
 * @public
 */
export const MAX_PLAN_ITEMS = 1_024;

/**
 * The most Unicode code points in a key.
 *
 * @public
 */
export const MAX_KEY_LENGTH = 64;

/**
 * How far from the scene's origin a position may be, in pixels, either way:
 * four times the longest side `maxImageDimension` allows by default (ADR
 * 0009).
 *
 * @public
 */
export const MAX_SCENE_COORDINATE = 65_536;

/**
 * How a redaction replaces what it covers (ADR 0010): `solid` fills the
 * region with one colour, and `pixelate` with coarse blocks of the average
 * colour beneath each. Only `solid` destroys what was there.
 *
 * @public
 */
export type ImageRedactionMode = "solid" | "pixelate";

/**
 * The redaction modes. Names are part of the document format.
 *
 * @public
 */
export const REDACTION_MODES = [
  "solid",
  "pixelate",
] as const satisfies readonly ImageRedactionMode[];

/**
 * What every redaction has, whatever its mode: its identity and its region.
 *
 * @public
 */
export interface ImageRedactionRegion {
  /**
   * Its identity: 1 to {@link MAX_KEY_LENGTH} code points, unique among the
   * plan's layers and redactions.
   */
  readonly key: string;
  /** The region's left edge, in whole pixels of the scene. May be negative. */
  readonly x: number;
  /** The region's top edge, in whole pixels of the scene. May be negative. */
  readonly y: number;
  /** At least 1. */
  readonly width: number;
  /** At least 1. */
  readonly height: number;
}

/**
 * A region of the image that an export doesn't show (ADR 0010): a rectangle
 * in whole pixels of the scene, the base's oriented source, so it stays on
 * the pixels it covers when the image is cropped or turned (ADR 0009).
 *
 * A redaction has no opacity, visibility or rotation, and is drawn over
 * every layer. Only exports are redacted: the plan describes the redaction,
 * and the source is unchanged.
 *
 * @public
 */
export type ImageRedaction =
  | (ImageRedactionRegion & {
      readonly mode: "solid";
      /** The fill, as `#rrggbb` in lower case. */
      readonly colour: string;
    })
  | (ImageRedactionRegion & { readonly mode: "pixelate" });

/**
 * The most Unicode code points in a text layer's text (ADR 0009).
 *
 * @public
 */
export const MAX_LAYER_TEXT_LENGTH = 1_000;

/**
 * The most Unicode code points in a layer's name.
 *
 * @public
 */
export const MAX_LAYER_NAME_LENGTH = 100;

/**
 * The widest stroke of a shape or a drawing, and the widest arrow's shaft,
 * in scene pixels.
 *
 * @public
 */
export const MAX_STROKE_WIDTH = 1_024;

/**
 * The most points in one run of a drawing's stroke (docs/adr/0014).
 *
 * @public
 */
export const MAX_RUN_POINTS = 2_000;

/**
 * The most runs in a stroke (docs/adr/0014).
 *
 * @public
 */
export const MAX_STROKE_RUNS = 64;

/**
 * The most strokes in a drawing (docs/adr/0014).
 *
 * @public
 */
export const MAX_DRAWING_STROKES = 1_024;

/**
 * The fonts a text layer can use: the generic families, which every device
 * has, so the SDK ships and fetches none (ADR 0009). Names are part of the
 * document format.
 *
 * @public
 */
export const LAYER_FONTS = ["sans-serif", "serif", "monospace"] as const;

/**
 * How a text layer's lines sit in its box, by the text's own direction.
 *
 * @public
 */
export const LAYER_ALIGNMENTS = ["start", "center", "end"] as const;

/**
 * The shapes a shape layer can be.
 *
 * @public
 */
export const LAYER_SHAPES = ["rectangle", "ellipse"] as const;

/**
 * The kinds of layer. Names are part of the document format.
 *
 * @public
 */
export const LAYER_KINDS = ["text", "shape", "image", "drawing", "arrow"] as const;

/**
 * What every layer has (ADR 0009).
 *
 * @public
 */
export interface ImageLayerCommon {
  /**
   * Its identity: 1 to `MAX_KEY_LENGTH` code points, unique among the plan's
   * layers and redactions.
   */
  readonly key: string;
  /**
   * What the layers list calls it: up to `MAX_LAYER_NAME_LENGTH` code
   * points. Empty means the editor's own label for the kind.
   */
  readonly name: string;
  /** Whether it's drawn. */
  readonly visible: boolean;
  /** A whole number from 0, transparent, to 100, opaque. */
  readonly opacity: number;
}

/**
 * Where a positioned layer is: a box in whole pixels of the scene, the
 * base's oriented source, mirrored or not, then turned about its centre
 * (ADR 0009). The box stays
 * on the pixels it covers when the image is cropped or turned.
 *
 * @public
 */
export interface ImageLayerBox {
  /** The box's left edge, before its rotation. May be negative. */
  readonly x: number;
  /** The box's top edge, before its rotation. May be negative. */
  readonly y: number;
  /** At least 1. */
  readonly width: number;
  /** At least 1. */
  readonly height: number;
  /** Tenths of a degree, clockwise about the box's centre: 0 to 3599. */
  readonly rotation: number;
  /**
   * Whether the layer is mirrored left to right, about the box's own
   * vertical axis, before it's turned. With a half turn, that's a mirror top
   * to bottom, so one flip is all a box needs.
   */
  readonly flipX: boolean;
}

/**
 * Text, drawn as large as fits inside its box, never distorted (ADR 0009).
 * Lines break only at line feeds. Emoji are text.
 *
 * @public
 */
export interface ImageTextLayer extends ImageLayerCommon, ImageLayerBox {
  readonly kind: "text";
  /**
   * Up to `MAX_LAYER_TEXT_LENGTH` code points. Control characters other
   * than a line feed, and the bidirectional embedding, override and isolate
   * controls, are refused.
   */
  readonly text: string;
  readonly font: (typeof LAYER_FONTS)[number];
  readonly bold: boolean;
  /** The text's colour, as `#rrggbb` in lower case. */
  readonly colour: string;
  readonly align: (typeof LAYER_ALIGNMENTS)[number];
}

/**
 * A rectangle or an ellipse that fills its box, with a fill, a stroke drawn
 * inside the box, or both (ADR 0009).
 *
 * @public
 */
export interface ImageShapeLayer extends ImageLayerCommon, ImageLayerBox {
  readonly kind: "shape";
  readonly shape: (typeof LAYER_SHAPES)[number];
  /** The fill, as `#rrggbb` in lower case, or `null` for none. */
  readonly fill: string | null;
  /** The stroke, or `null` for none. A shape has a fill or a stroke. */
  readonly stroke: {
    readonly colour: string;
    /** In whole scene pixels, from 1 to `MAX_STROKE_WIDTH`. */
    readonly width: number;
  } | null;
}

/**
 * Another image, drawn to fill its box (ADR 0009).
 *
 * @public
 */
export interface ImageImageLayer extends ImageLayerCommon, ImageLayerBox {
  readonly kind: "image";
  /** The id of a registered source. */
  readonly source: string;
  /** The part of that source to draw, in its own pixels, or `null` for all of it. */
  readonly crop: ImageCrop | null;
}

/**
 * One stroke of a drawing: what one gesture drew, from the press to the
 * release (docs/adr/0014). It has more than one run only when it's long.
 *
 * @public
 */
export interface ImageStroke {
  /** `#rrggbb`. */
  readonly colour: string;
  /** In whole scene pixels: 1 to `MAX_STROKE_WIDTH`. */
  readonly width: number;
  /**
   * 1 to `MAX_STROKE_RUNS` runs, each a polyline `[x0, y0, x1, y1, …]` of 1
   * to `MAX_RUN_POINTS` points, in whole pixels from the drawing's origin.
   * A run of one point is a dot.
   */
  readonly runs: readonly (readonly number[])[];
}

/**
 * Freehand strokes (ADR 0009, docs/adr/0014). A drawing has an origin and
 * no box: moving it changes its origin, never its points. Its strokes are
 * drawn opaque and the drawing composited as one, so strokes that cross
 * don't darken each other.
 *
 * @public
 */
export interface ImageDrawingLayer extends ImageLayerCommon {
  readonly kind: "drawing";
  /** Its origin, in whole scene pixels. May be negative. */
  readonly x: number;
  readonly y: number;
  /** 1 to `MAX_DRAWING_STROKES` strokes, in the order they're drawn. */
  readonly strokes: readonly ImageStroke[];
}

/**
 * A point of the scene, in whole pixels.
 *
 * @public
 */
export interface ImageScenePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * An arrow from one point of the scene to another (ADR 0009,
 * docs/adr/0014). Its head's size follows its width, and its tip is exactly
 * on `to`.
 *
 * @public
 */
export interface ImageArrowLayer extends ImageLayerCommon {
  readonly kind: "arrow";
  /** The tail. */
  readonly from: ImageScenePoint;
  /** The tip. It differs from `from`. */
  readonly to: ImageScenePoint;
  /** `#rrggbb`. */
  readonly colour: string;
  /** The shaft's width, in whole scene pixels: 1 to `MAX_STROKE_WIDTH`. */
  readonly width: number;
}

/**
 * A layer that has a box: text, a shape or an image.
 *
 * @public
 */
export type ImageBoxedLayer = ImageTextLayer | ImageShapeLayer | ImageImageLayer;

/**
 * A layer over the base: text, a shape, another image, a drawing or an
 * arrow (ADR 0009). Layers are drawn bottom to top, in the plan's order, and
 * redactions over all of them.
 *
 * @public
 */
export type ImageLayer = ImageBoxedLayer | ImageDrawingLayer | ImageArrowLayer;

/**
 * A layer's kind.
 *
 * @public
 */
export type ImageLayerKind = ImageLayer["kind"];

/**
 * The most frames an animation lists: the format's ceiling, which the file
 * policy's `maxFrames` applies below (docs/adr/0011). It's the most frames
 * the SDK's GIF decoder keeps a table of.
 *
 * @public
 */
export const MAX_ANIMATION_FRAMES = 4_096;

/**
 * The longest a frame is shown, and the most times an animation repeats:
 * what a GIF's sixteen bits hold.
 *
 * @public
 */
export const MAX_FRAME_DELAY = 65_535;

/**
 * One frame of an animation (docs/adr/0011): which of the source's frames
 * it shows, and for how long. It holds no pixels, so two frames may show
 * the same one.
 *
 * @public
 */
export interface ImageFrame {
  /**
   * Its identity: 1 to {@link MAX_KEY_LENGTH} code points, unique among the
   * plan's layers, redactions and frames.
   */
  readonly key: string;
  /** A frame of the base's source, from 0. */
  readonly frame: number;
  /** How long it's shown, in hundredths of a second: 0 to {@link MAX_FRAME_DELAY}. */
  readonly delay: number;
}

/**
 * An animation (docs/adr/0011): the frames of the base's source, in the
 * order they play. Everything else in the plan applies to every frame.
 *
 * @public
 */
export interface ImageAnimation {
  /** `null`: play once. 0: for ever. Otherwise that many repeats, to {@link MAX_FRAME_DELAY}. */
  readonly loop: number | null;
  /** 1 to {@link MAX_ANIMATION_FRAMES} frames. */
  readonly frames: readonly ImageFrame[];
}

/**
 * The session's document: a description of the edits over an immutable
 * source, rendered to pixels only for display and export (ADR 0003, ADR
 * 0009).
 *
 * @public
 */
export interface ImagePlan {
  readonly base: ImageBase;
  /** The layers over the base, bottom to top, placed in the scene (ADR 0009). */
  readonly layers: readonly ImageLayer[];
  /** The redactions, applied over every layer (ADR 0010). */
  readonly redactions: readonly ImageRedaction[];
  /** The animation, or `null` for a still (docs/adr/0011). */
  readonly animation: ImageAnimation | null;
  readonly output: ImageOutput;
  /** The fields the user chose to keep on export. Never a location (ADR 0005). */
  readonly metadata: ImageKeepableMetadata;
}

/**
 * No rotation and no flips.
 *
 * @public
 */
export const UPRIGHT: ImageOrientation = /* @__PURE__ */ Object.freeze({
  rotate: 0,
  flipX: false,
  flipY: false,
});

/**
 * The export at full size.
 *
 * @public
 */
export const FULL_SIZE: ImageOutput = /* @__PURE__ */ Object.freeze({ kind: "scale", scale: 1 });

/**
 * The plan for a newly opened source: the whole image, upright, undeveloped
 * and unfiltered, with no layers or redactions, at full size, keeping no
 * metadata.
 *
 * @public
 */
export function createPlan(source: string): ImagePlan {
  return {
    base: { source, crop: null, orientation: UPRIGHT, develop: NEUTRAL_DEVELOP, filter: null },
    layers: [],
    redactions: [],
    animation: null,
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
