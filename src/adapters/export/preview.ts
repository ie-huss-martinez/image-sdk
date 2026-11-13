import { compositionSize } from "../../core/model/geometry.js";
import type { ImagePlan } from "../../core/model/plan.js";
import {
  backingSize,
  type ImageView,
  MAX_PIXEL_RATIO,
  placement,
} from "../../core/ports/image-renderer.js";
import { renderPlan } from "./render.js";

/**
 * Draws a plan into the preview canvas for a view (docs/adr/0002): the
 * composition is rendered by the export's renderer at the size it's shown,
 * up to its full size, then placed, fitted, zoomed and panned, at the
 * device pixel ratio. A render that's cancelled stops at its next strip and
 * never touches the visible canvas, so a stale frame can't replace a newer
 * one. The context is the canvas's one context, created when it was
 * attached: Firefox refuses a second `getContext` on a transferred canvas.
 */
export async function drawPreview(
  context: OffscreenCanvasRenderingContext2D,
  source: ImageBitmap,
  plan: ImagePlan,
  view: ImageView,
  signal?: AbortSignal,
): Promise<void> {
  const composition = compositionSize(plan, source);
  const { width, height } = backingSize(view);
  const ratio = Math.min(view.pixelRatio, MAX_PIXEL_RATIO);
  const placed = placement(composition, view);
  const shown = placed.scale * ratio;
  // Rendered at most at full size; zooming past it enlarges the render.
  const scale = Math.min(1, shown);
  const rendered = await renderPlan(
    source,
    { ...plan, output: { kind: "scale", scale } },
    false,
    signal,
  );
  if (signal?.aborted) {
    rendered.width = 0;
    throw signal.reason;
  }
  const { canvas } = context;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    rendered,
    placed.x * ratio,
    placed.y * ratio,
    placed.width * ratio,
    placed.height * ratio,
  );
  rendered.width = 0;
}
