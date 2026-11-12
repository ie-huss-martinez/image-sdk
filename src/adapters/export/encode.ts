import { ImageError } from "../../core/errors/image-error.js";
import type { ImagePlan } from "../../core/model/plan.js";
import type { ImageExportFormat } from "../../core/ports/image-processor.js";
import { rewriteJpeg, rewritePng, rewriteWebp } from "./metadata.js";
import { renderPlan } from "./render.js";

const MIME_TYPES = { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as const;

/**
 * Renders a plan, encodes it with the browser's encoder and rewrites the
 * result to the image data and the kept fields (docs/adr/0001,
 * docs/adr/0005). Encoding support is detected, never assumed: a browser
 * that can't encode the requested type returns another, usually PNG, which
 * fails with `UNSUPPORTED_FORMAT` rather than saving mislabelled bytes.
 *
 * @internal
 */
export async function encodePlan(
  source: ImageBitmap,
  plan: ImagePlan,
  format: ImageExportFormat,
  signal?: AbortSignal,
): Promise<Blob> {
  const type = MIME_TYPES[format.type];
  const canvas = await renderPlan(source, plan, format.type === "jpeg", signal);
  const encoded = await canvas.convertToBlob({
    type,
    ...(format.type === "png" ? {} : { quality: format.quality ?? 0.92 }),
  });
  // Release the canvas's pixels before the rewrite allocates.
  canvas.width = 0;
  canvas.height = 0;
  if (signal?.aborted) throw signal.reason;
  if (encoded.type !== type) {
    throw new ImageError("UNSUPPORTED_FORMAT", "This browser can't encode the requested format.", {
      details: { format: format.type },
    });
  }
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  const rewritten =
    format.type === "jpeg"
      ? rewriteJpeg(bytes, plan.metadata)
      : format.type === "png"
        ? rewritePng(bytes, plan.metadata)
        : rewriteWebp(bytes);
  return new Blob([rewritten.slice()], { type });
}
