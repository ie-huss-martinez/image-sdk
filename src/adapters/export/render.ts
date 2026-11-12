import { compositionSize, cropRect, outputSize } from "../../core/model/geometry.js";
import type { ImagePlan } from "../../core/model/plan.js";
import type { ImageSize } from "../../core/model/source.js";

/** The size a plan renders at over a source of this size (ADR 0003). */
export function renderSize(plan: ImagePlan, source: ImageSize): ImageSize {
  return outputSize(plan.output, compositionSize(plan, source));
}

/**
 * Renders a plan over an upright source into a new sRGB canvas at the
 * output size (docs/adr/0003, docs/adr/0005): the crop, then the rotation,
 * then the flips, scaled to the output. The same transform as
 * `compositionToSource`, applied by the canvas. JPEG has no alpha, so its
 * canvas starts white rather than transparent, which encoders would turn
 * black.
 */
export function renderPlan(source: ImageBitmap, plan: ImagePlan, opaque: boolean): OffscreenCanvas {
  const crop = cropRect(plan.base.crop, source);
  const composition = compositionSize(plan, source);
  const size = outputSize(plan.output, composition);
  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext("2d", { colorSpace: "srgb", alpha: !opaque });
  if (!context) throw new Error("The worker has no 2D canvas.");
  if (opaque) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
  }
  const scaleX = size.width / composition.width;
  const scaleY = size.height / composition.height;
  // At its own size the render copies pixels exactly; scaled, it smooths.
  context.imageSmoothingEnabled = scaleX !== 1 || scaleY !== 1;
  context.imageSmoothingQuality = "high";
  context.scale(scaleX, scaleY);
  const { rotate, flipX, flipY } = plan.base.orientation;
  if (flipX) context.transform(-1, 0, 0, 1, composition.width, 0);
  if (flipY) context.transform(1, 0, 0, -1, 0, composition.height);
  // Clockwise quarter turns of the cropped image into the composition.
  if (rotate === 90) context.transform(0, 1, -1, 0, composition.width, 0);
  if (rotate === 180) context.transform(-1, 0, 0, -1, composition.width, composition.height);
  if (rotate === 270) context.transform(0, -1, 1, 0, 0, composition.height);
  context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return canvas;
}
