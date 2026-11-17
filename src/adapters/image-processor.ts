import { asImageError, throwIfAborted } from "../core/errors/error-helpers.js";
import { imageLimits, OUTPUT_LIMITS } from "../core/errors/image-limits.js";
import type { ImagePlan } from "../core/model/plan.js";
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
      const { plan, format, frame = 0 } = job;
      if (!FORMATS.has(format.type)) {
        throw new TypeError(`"${String(format.type)}" isn't an export format.`);
      }
      if (format.type !== "png" && format.quality !== undefined) {
        if (!(format.quality >= 0 && format.quality <= 1)) {
          throw new RangeError("quality must be from 0 to 1.");
        }
      }
      checkFrame(plan, frame);
      internals.check();
      // The base's source, and every image layer's: a plan that names one
      // the engine doesn't hold is the caller's mistake, found before the worker.
      const missing = [plan.base.source, ...layerSources(plan)].find((id) => !internals.has(id));
      if (missing !== undefined) {
        throw new TypeError(`There's no source with the id "${missing}".`);
      }
      const signal = options?.signal;
      throwIfAborted(signal);
      const policy = options?.filePolicy ?? imageLimits.resolve();
      try {
        const blob = await internals.call(
          "export",
          {
            plan,
            format,
            frame,
            limits: Object.fromEntries(
              OUTPUT_LIMITS.map((limit) => [limit, policy.limits[limit].maximum]),
            ) as Record<(typeof OUTPUT_LIMITS)[number], number>,
          },
          signal ? { signal } : {},
        );
        options?.onProgress?.(1);
        internals.check();
        return blob;
      } catch (error) {
        if (error instanceof TypeError) throw error;
        throw asImageError(error);
      }
    },

    async destroy(): Promise<void> {
      destroyed = true;
    },
  };
}

/**
 * Refuses a frame the plan doesn't have: an index into its animation's
 * frames, and only 0 for a still.
 *
 * @throws `RangeError`
 */
export function checkFrame(plan: ImagePlan, frame: number): void {
  // An animation with no frames isn't a plan this checks: the worker refuses it.
  const frames = Math.max(1, plan.animation?.frames.length ?? 1);
  if (!Number.isInteger(frame) || frame < 0 || frame >= frames) {
    throw new RangeError(
      frames === 1 ? "A still has only frame 0." : `frame must be from 0 to ${frames - 1}.`,
    );
  }
}

/** The ids of the sources a plan's image layers draw. */
export function layerSources(plan: ImagePlan): string[] {
  return Array.isArray(plan.layers)
    ? plan.layers.flatMap((layer) => (layer.kind === "image" ? [layer.source] : []))
    : [];
}
