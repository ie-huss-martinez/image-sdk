import { compositionSize } from "../../core/model/geometry.js";
import type { ImagePlan } from "../../core/model/plan.js";
import type { ImageView } from "../../core/ports/image-renderer.js";
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
  const width = Math.max(1, Math.round(view.width * view.pixelRatio));
  const height = Math.max(1, Math.round(view.height * view.pixelRatio));
  const fit = Math.min(view.width / composition.width, view.height / composition.height);
  const shown = fit * view.zoom * view.pixelRatio;
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
  const drawnWidth = composition.width * shown;
  const drawnHeight = composition.height * shown;
  context.drawImage(
    rendered,
    (width - drawnWidth) / 2 + view.pan.x * view.pixelRatio,
    (height - drawnHeight) / 2 + view.pan.y * view.pixelRatio,
    drawnWidth,
    drawnHeight,
  );
  rendered.width = 0;
}
