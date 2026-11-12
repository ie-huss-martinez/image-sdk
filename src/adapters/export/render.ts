import { compositionSize, cropRect, outputSize } from "../../core/model/geometry.js";
import type { ImagePlan } from "../../core/model/plan.js";
import type { ImageSize } from "../../core/model/source.js";
import { createDeveloper, needsDevelop } from "./develop.js";

/** The most bytes one develop strip reads back at once (docs/adr/0006). */
const STRIP_BYTES = 4_000_000;

/**
 * Lets the worker handle its other messages, such as a cancellation from
 * the page, before the next strip: a message rather than a timer, which
 * engines delay by several milliseconds.
 */
function yieldToMessages(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}

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
 * black. Develop runs in strips, and the render yields to the worker's
 * messages between them, so a cancelled render stops at the next strip
 * (docs/adr/0006).
 */
export async function renderPlan(
  source: ImageBitmap,
  plan: ImagePlan,
  opaque: boolean,
  signal?: AbortSignal,
): Promise<OffscreenCanvas> {
  const { develop, filter } = plan.base;
  const developing = needsDevelop(develop, filter);
  const crop = cropRect(plan.base.crop, source);
  const composition = compositionSize(plan, source);
  const size = outputSize(plan.output, composition);
  const canvas = new OffscreenCanvas(size.width, size.height);
  // A canvas that's read back stays in memory the CPU can read: otherwise
  // Chromium may keep it on the GPU and make every read slow.
  const context = canvas.getContext("2d", {
    colorSpace: "srgb",
    alpha: !opaque,
    willReadFrequently: developing,
  });
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
  context.setTransform(1, 0, 0, 1, 0, 0);
  if (developing) {
    // Once per render, in strips of bounded size, before any layer is drawn
    // (docs/adr/0006). Developing the same canvas twice would lose precision
    // in its premultiplied storage, so nothing ever does.
    const developStrip = createDeveloper(develop, filter);
    const rows = Math.max(1, Math.floor(STRIP_BYTES / (size.width * 4)));
    for (let y = 0; y < size.height; y += rows) {
      if (signal) {
        await yieldToMessages();
        if (signal.aborted) throw signal.reason;
      }
      const strip = context.getImageData(0, y, size.width, Math.min(rows, size.height - y), {
        colorSpace: "srgb",
      });
      developStrip(strip.data);
      context.putImageData(strip, 0, y);
    }
  }
  return canvas;
}
