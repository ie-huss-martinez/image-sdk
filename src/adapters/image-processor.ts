import { abortError, asImageError, throwIfAborted } from "../core/errors/error-helpers.js";
import { imageLimits, OUTPUT_LIMITS } from "../core/errors/image-limits.js";
import type { ImageEngine } from "../core/ports/image-engine.js";
import type { ImageExportJob, ImageProcessor } from "../core/ports/image-processor.js";
import type { ImageExportOptions } from "../core/ports/options.js";
import { engineInternals } from "./image-engine.js";

const FORMATS = new Set(["png", "jpeg", "webp"]);

/**
 * Creates the SDK's image processor over an engine from
 * {@link createImageEngine}, sharing its render worker, where the sources
 * are (docs/adr/0002). An export renders the plan at its output size in an
 * sRGB canvas, after checking that size against the file policy, encodes
 * it with the browser's encoder, and keeps nothing of the result but the
 * image data and the fields the user kept: title, description, artist and
 * copyright, as EXIF in JPEG and `iTXt` in PNG. WebP exports carry no
 * metadata. The encoded type is checked: a browser that can't encode the
 * requested format fails with `UNSUPPORTED_FORMAT` (docs/adr/0001,
 * docs/adr/0005).
 *
 * @example
 * ```ts
 * const engine = createImageEngine();
 * const processor = createImageProcessor(engine);
 * const blob = await processor.export({ plan, format: { type: "jpeg", quality: 0.9 } });
 * ```
 *
 * @throws `TypeError` for an engine that `createImageEngine` didn't make.
 * @public
 */
export function createImageProcessor(engine: ImageEngine): ImageProcessor {
  const internals = engineInternals(engine);
  if (!internals) {
    throw new TypeError("createImageProcessor needs an engine from createImageEngine.");
  }
  let destroyed = false;
  return {
    async export(job: ImageExportJob, options?: ImageExportOptions): Promise<Blob> {
      if (destroyed) throw new Error("The image processor has been destroyed.");
      const { plan, format } = job;
      if (!FORMATS.has(format.type)) {
        throw new TypeError(`"${String(format.type)}" isn't an export format.`);
      }
      if (format.type !== "png" && format.quality !== undefined) {
        if (!(format.quality >= 0 && format.quality <= 1)) {
          throw new RangeError("quality must be from 0 to 1.");
        }
      }
      if (!internals.has(plan.base.source)) {
        throw new TypeError(`There's no source with the id "${plan.base.source}".`);
      }
      const signal = options?.signal;
      throwIfAborted(signal);
      const policy = options?.filePolicy ?? imageLimits.resolve();
      try {
        const client = await internals.client();
        const blob = await client.call(
          "export",
          {
            plan,
            format,
            limits: Object.fromEntries(
              OUTPUT_LIMITS.map((limit) => [limit, policy.limits[limit].maximum]),
            ) as Record<(typeof OUTPUT_LIMITS)[number], number>,
          },
          signal ? { signal } : {},
        );
        options?.onProgress?.(1);
        return blob;
      } catch (error) {
        if (error instanceof TypeError) throw error;
        if (signal?.aborted) throw abortError(signal);
        throw asImageError(error);
      }
    },

    async destroy(): Promise<void> {
      destroyed = true;
    },
  };
}
