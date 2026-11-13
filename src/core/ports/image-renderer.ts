import type { ImageFilePolicy } from "../errors/image-limits.js";
import type { ImagePlan } from "../model/plan.js";
import type { ImageCallOptions } from "./options.js";

/**
 * The highest device pixel ratio the preview draws at. A larger ratio is
 * drawn at this one: no display needs more, and it bounds the canvas a
 * runaway layout can ask for.
 *
 * @public
 */
export const MAX_PIXEL_RATIO = 4;

/**
 * Where and how the preview is shown: the stage's size in CSS pixels, the
 * device pixel ratio, and the zoom and pan. At zoom 1 the composition fits
 * the stage; the pan moves it, in CSS pixels. The view isn't part of the
 * document (ADR 0003).
 *
 * @public
 */
export interface ImageView {
  readonly width: number;
  readonly height: number;
  /**
   * Device pixels per CSS pixel, such as `devicePixelRatio`. Ratios above
   * {@link MAX_PIXEL_RATIO} are drawn at it.
   */
  readonly pixelRatio: number;
  /** 1 fits the composition inside the stage; 2 is twice that. */
  readonly zoom: number;
  readonly pan: { readonly x: number; readonly y: number };
  /**
   * CSS pixels the fitted composition keeps clear inside each edge of the
   * stage, such as room for the crop frame's handles, which would otherwise
   * be cut off where the image meets the stage's edge. 0 when omitted.
   */
  readonly inset?: number;
}

/**
 * Options for a render.
 *
 * @public
 */
export interface ImageRenderOptions extends ImageCallOptions {
  /**
   * The limits the preview canvas's backing size, the view's size times its
   * pixel ratio, is checked against before the canvas is resized:
   * `maxImageDimension` and `maxImagePixels` (ADR 0004). The defaults of
   * `imageLimits` when omitted.
   */
  readonly filePolicy?: ImageFilePolicy;
}

/**
 * What became of one `render` call: `drawn`, or `superseded` when a later
 * call replaced it before it was drawn (ADR 0002).
 *
 * @public
 */
export type ImageRenderOutcome = "drawn" | "superseded";

/**
 * The port for the preview (ADR 0002): a canvas on the page, drawn by the
 * engine's render worker through the same renderer as every export, so what
 * the editor shows is what the file will contain. Renders are coalesced:
 * when plans arrive faster than they're drawn, only the latest is drawn, and
 * a render in progress stops at its next strip.
 *
 * @public
 */
export interface ImageRenderer {
  /**
   * Hands a canvas to the render worker, once per canvas. The page can't
   * draw into or read it afterwards. Without `transferControlToOffscreen`
   * it rejects with `UNSUPPORTED_ENVIRONMENT`.
   */
  attach(canvas: HTMLCanvasElement): Promise<void>;
  /**
   * Draws a plan into the attached canvas for a view. It resolves `drawn`
   * when this plan is on screen, or `superseded` when a later call replaced
   * it. A plan whose source isn't registered is a `TypeError`. A view whose
   * backing size is over `filePolicy`'s limits rejects with the limit's code
   * before anything is drawn, and the canvas keeps its previous frame.
   */
  render(
    plan: ImagePlan,
    view: ImageView,
    options?: ImageRenderOptions,
  ): Promise<ImageRenderOutcome>;
  /** Releases the canvas in the worker. Pending renders resolve `superseded`, and later calls throw. */
  destroy(): Promise<void>;
}

/**
 * The size of the preview canvas's backing store for a view: its size times
 * its pixel ratio, at most {@link MAX_PIXEL_RATIO}, in whole pixels.
 *
 * @public
 */
export function backingSize(view: ImageView): { readonly width: number; readonly height: number } {
  const ratio = Math.min(view.pixelRatio, MAX_PIXEL_RATIO);
  return {
    width: Math.max(1, Math.round(view.width * ratio)),
    height: Math.max(1, Math.round(view.height * ratio)),
  };
}

/**
 * The view for a stage of this size: fitted, centred, at this ratio.
 *
 * @public
 */
export function fittedView(width: number, height: number, pixelRatio = 1): ImageView {
  return { width, height, pixelRatio, zoom: 1, pan: { x: 0, y: 0 } };
}

/**
 * Where a composition of this size is shown on the stage for a view, in the
 * stage's CSS pixels: fitted, zoomed, centred and panned. The renderer draws
 * there, and the editor's crop frame and handles are placed with it, so the
 * DOM over the canvas lines up with its pixels (ADR 0002).
 *
 * @public
 */
export function placement(
  composition: { readonly width: number; readonly height: number },
  view: ImageView,
): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
} {
  const inset = view.inset ?? 0;
  const fit = Math.min(
    (view.width - 2 * inset) / composition.width,
    (view.height - 2 * inset) / composition.height,
  );
  const scale = Math.max(0, fit) * view.zoom;
  const width = composition.width * scale;
  const height = composition.height * scale;
  return {
    x: (view.width - width) / 2 + view.pan.x,
    y: (view.height - height) / 2 + view.pan.y,
    width,
    height,
    scale,
  };
}
