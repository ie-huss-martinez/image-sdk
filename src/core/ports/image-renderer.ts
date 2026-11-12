import type { ImagePlan } from "../model/plan.js";
import type { ImageCallOptions } from "./options.js";

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
  /** Device pixels per CSS pixel, such as `devicePixelRatio`. */
  readonly pixelRatio: number;
  /** 1 fits the composition inside the stage; 2 is twice that. */
  readonly zoom: number;
  readonly pan: { readonly x: number; readonly y: number };
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
   * it. A plan whose source isn't registered is a `TypeError`.
   */
  render(plan: ImagePlan, view: ImageView, options?: ImageCallOptions): Promise<ImageRenderOutcome>;
  /** Releases the canvas in the worker. Pending renders resolve `superseded`, and later calls throw. */
  destroy(): Promise<void>;
}

/**
 * The view for a stage of this size: fitted, centred, at this ratio.
 *
 * @public
 */
export function fittedView(width: number, height: number, pixelRatio = 1): ImageView {
  return { width, height, pixelRatio, zoom: 1, pan: { x: 0, y: 0 } };
}
