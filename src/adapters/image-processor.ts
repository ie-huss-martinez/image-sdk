import { createWorkerClient, type WorkerClient } from "@hussmartinez/sdk-core";
import { asImageError, throwIfAborted } from "../core/errors/error-helpers.js";
import { ImageError } from "../core/errors/image-error.js";
import { imageLimits, OUTPUT_LIMITS } from "../core/errors/image-limits.js";
import type { ImagePlan } from "../core/model/plan.js";
import type { ImageEngine } from "../core/ports/image-engine.js";
import type { ImageExportJob, ImageProcessor } from "../core/ports/image-processor.js";
import type { ImageExportOptions } from "../core/ports/options.js";
import { exportGif, type GifExportWorkers } from "./export/gif-export.js";
import { engineInternals } from "./image-engine.js";
import type { JobWorkerContract } from "./job-worker/contract.js";
import { startFailure } from "./worker-start.js";

const FORMATS = new Set(["png", "jpeg", "webp", "gif"]);

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
  /**
   * The job worker's client, made on the first GIF export (docs/adr/0011),
   * and kept for the exports after it: sdk-core stops its worker after its
   * idle timeout, and the next call starts another. An export that doesn't
   * finish, cancelled or failed, retires the client it used: no export
   * starts on it again, and its worker is terminated as soon as no export
   * is using it. A worker that didn't answer a cancel can't then take the
   * next export down with it, and the job worker holds nothing of the
   * session, so ending it costs nothing.
   */
  interface JobClient {
    readonly client: WorkerClient<JobWorkerContract>;
    active: number;
    retired: boolean;
  }
  let current: JobClient | undefined;
  const jobClients = new Set<JobClient>();
  let jobs = 0;
  const acquire = async (): Promise<JobClient> => {
    if (!current) {
      const loaded = await internals.loadJobWorker();
      if (destroyed) throw new Error("The image processor has been destroyed.");
      current ??= {
        client: createWorkerClient<JobWorkerContract>({
          createWorker: loaded.start,
          errorClasses: { ImageError },
          packageVersion: internals.version,
          workerAsset: loaded.asset,
        }),
        active: 0,
        retired: false,
      };
      jobClients.add(current);
    }
    current.active += 1;
    return current;
  };
  const release = (entry: JobClient, finished: boolean) => {
    entry.active -= 1;
    if (!finished) {
      entry.retired = true;
      if (current === entry) current = undefined;
    }
    if (entry.retired && entry.active === 0) {
      entry.client.destroy();
      jobClients.delete(entry);
    }
  };
  /** The two workers' parts of one GIF export, as `exportGif` calls them. */
  const gifWorkers = (
    client: WorkerClient<JobWorkerContract>,
    plan: ImagePlan,
    limits: Record<(typeof OUTPUT_LIMITS)[number] | "maxDecodedSize", number>,
  ): GifExportWorkers => {
    jobs += 1;
    const id = `gif-${jobs}`;
    const loop = plan.animation?.loop ?? null;
    return {
      render: (frame, count, signal) =>
        internals.call("frame", { plan, frame, count, limits }, { signal }),
      start: (width, height, signal) =>
        client.call("gifStart", { id, width, height, loop }, { signal }),
      // Transferred, not copied: the page's buffer is empty once it's handed on.
      write: (frame, delay, signal) =>
        client.call("gifFrame", { id, pixels: frame.pixels, delay }, { signal, transfer: true }),
      finish: (signal) => client.call("gifFinish", { id }, { signal }),
      abandon: () => client.call("gifAbandon", { id }).catch(() => undefined),
    };
  };
  return {
    async export(job: ImageExportJob, options?: ImageExportOptions): Promise<Blob> {
      if (destroyed) throw new Error("The image processor has been destroyed.");
      const { plan, format, frame = 0 } = job;
      if (!FORMATS.has(format.type)) {
        throw new TypeError(`"${String(format.type)}" isn't an export format.`);
      }
      if ((format.type === "jpeg" || format.type === "webp") && format.quality !== undefined) {
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
      const limits = Object.fromEntries(
        OUTPUT_LIMITS.map((limit) => [limit, policy.limits[limit].maximum]),
      ) as Record<(typeof OUTPUT_LIMITS)[number], number>;
      if (format.type === "gif") {
        let entry: JobClient | undefined;
        let finished = false;
        try {
          entry = await acquire();
          const blob = await exportGif(
            plan,
            gifWorkers(entry.client, plan, {
              ...limits,
              maxDecodedSize: policy.limits.maxDecodedSize.maximum,
            }),
            signal ?? new AbortController().signal,
            options?.onProgress,
          );
          finished = true;
          internals.check();
          return blob;
        } catch (error) {
          if (error instanceof TypeError) throw error;
          // A job worker that couldn't start for a reason of its own keeps
          // it, such as a build that left it out (sdk-core ADR 0060).
          throw asImageError(startFailure(error));
        } finally {
          if (entry) release(entry, finished);
        }
      }
      try {
        const blob = await internals.call(
          "export",
          {
            plan,
            format,
            frame,
            limits,
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
      // The job workers hold nothing of the session: they can go at any time.
      for (const entry of jobClients) entry.client.destroy();
      jobClients.clear();
      current = undefined;
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
