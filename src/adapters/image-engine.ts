import { createWorkerClient, type WorkerClient, type WorkerLike } from "@hussmartinez/sdk-core";
import { abortError, asImageError, throwIfAborted } from "../core/errors/error-helpers.js";
import { ImageError } from "../core/errors/image-error.js";
import { imageLimits, PER_FILE_LIMITS } from "../core/errors/image-limits.js";
import type { ImageProbe, ImageSourceInfo, ImageThumbnail } from "../core/model/source.js";
import type { ImageEngine } from "../core/ports/image-engine.js";
import type { ImageCallOptions, ImageRegisterOptions } from "../core/ports/options.js";
import { assetsBase } from "./assets-url.js";
import type { RenderWorkerContract } from "./render-worker/contract.js";

/**
 * Options for {@link createImageEngine}.
 *
 * @public
 */
export interface ImageEngineOptions {
  /**
   * Where the application serves the package's `dist/assets/` directory, to
   * load the render worker from its own origin instead of a `blob:` URL. The
   * worker is then `image/render.worker.js` there, and a Content Security
   * Policy needs `worker-src 'self'` and no `blob:` (docs/adr/0002). Copy
   * `dist/assets` again after every upgrade: a worker from another version
   * is refused with `WORKER_START_FAILED`. By default the worker is inlined.
   */
  readonly assetsUrl?: string | URL;
}

/** What the engine needs from its environment, replaceable in tests. */
export interface EngineEnvironment {
  /** Loads the worker's code, on the first call, and returns how to start it. */
  readonly loadWorker: () => Promise<() => WorkerLike>;
  /** The version the worker must report: this package's. */
  readonly version: string;
  /** Where the worker comes from, for the version error's details. */
  readonly asset?: string;
}

/**
 * Creates the SDK's image engine (docs/adr/0001, docs/adr/0002,
 * docs/adr/0005). It probes files in its render worker with the SDK's own
 * readers, and decodes them there with `createImageBitmap`, upright: where
 * the browser doesn't apply a format's orientation, as its one-time
 * calibration shows, the worker applies it itself. Every decode must have
 * the probe's oriented size exactly. The worker holds the sources until
 * they're released or the engine is destroyed.
 *
 * Nothing starts until the first call. By default the worker is inlined,
 * which needs `worker-src blob:` in a Content Security Policy; with
 * `assetsUrl` it loads from your own origin, which needs `worker-src 'self'`
 * instead. Either way it makes no requests of its own.
 *
 * @example
 * ```ts
 * const engine = createImageEngine();
 * const probe = await engine.probe(file);
 * policy.check("maxImagePixels", probe.oriented.width * probe.oriented.height);
 * const source = await engine.register("photo", file, probe);
 * ```
 *
 * @public
 */
export function createImageEngine(options: ImageEngineOptions = {}): ImageEngine {
  const base = assetsBase(options.assetsUrl);
  const selfHosted = base === undefined ? undefined : `${base}image/render.worker.js`;
  return createEngine({
    loadWorker: selfHosted
      ? async () => () => new Worker(selfHosted, { type: "module", name: "hm-image-render" })
      : async () => (await import("./render-worker/inline-worker.js")).createInlineWorker,
    version: __IMAGE_SDK_VERSION__,
    ...(selfHosted ? { asset: selfHosted } : {}),
  });
}

/**
 * The engine, with its environment passed in.
 *
 * @internal
 */
export function createEngine(environment: EngineEnvironment): ImageEngine {
  let startWorker: (() => WorkerLike) | undefined;
  let destroyed = false;
  /** Sources the worker holds, or is decoding, by id. */
  const ids = new Set<string>();

  const client: WorkerClient<RenderWorkerContract> = createWorkerClient<RenderWorkerContract>({
    createWorker: () => {
      if (!startWorker) {
        throw new ImageError("WORKER_START_FAILED", "The render worker hasn't loaded.");
      }
      return startWorker();
    },
    errorClasses: { ImageError },
    // The worker holds the sources, so it lives as long as the engine, and a
    // cancelled decode may finish rather than take the sources with it.
    idleTimeout: 0,
    cancelTimeout: 30_000,
    // A crashed worker has lost every source.
    onCrash: () => ids.clear(),
  });

  let versionChecked: Promise<void> | undefined;

  async function ready(): Promise<void> {
    if (destroyed) throw new Error("The image engine has been destroyed.");
    startWorker ??= await environment.loadWorker();
    // A self-hosted worker copied before an upgrade would speak the same
    // protocol but run older code, so the first call checks its version.
    versionChecked ??= (async () => {
      const actual = await client.call("version", undefined);
      if (actual !== environment.version) {
        throw new ImageError(
          "WORKER_START_FAILED",
          "The render worker isn't this version of the SDK. Copy dist/assets again after upgrading.",
          {
            details: {
              asset: environment.asset ?? "inline",
              expected: environment.version,
              actual,
            },
          },
        );
      }
    })();
    try {
      await versionChecked;
    } catch (error) {
      versionChecked = undefined;
      throw error;
    }
  }

  async function run<T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
    throwIfAborted(signal);
    try {
      await ready();
      return await work();
    } catch (error) {
      if (error instanceof TypeError) throw error;
      if (signal?.aborted) throw abortError(signal);
      throw asImageError(error);
    }
  }

  const callOptions = (options: ImageCallOptions | undefined) =>
    options?.signal ? { signal: options.signal } : {};

  return {
    probe(file: Blob, options?: ImageCallOptions): Promise<ImageProbe> {
      return run(options?.signal, () => client.call("probe", { file }, callOptions(options)));
    },

    async register(
      id: string,
      file: Blob,
      probe: ImageProbe,
      options?: ImageRegisterOptions,
    ): Promise<ImageSourceInfo> {
      if (destroyed) throw new Error("The image engine has been destroyed.");
      if (ids.has(id)) throw new TypeError(`The source id "${id}" is already in use.`);
      ids.add(id);
      try {
        const size = await run(options?.signal, () =>
          client.call(
            "register",
            {
              id,
              file,
              probe,
              // The maxima cross to the worker, which checks them against its
              // own probe (docs/adr/0004).
              limits: Object.fromEntries(
                PER_FILE_LIMITS.map((limit) => [
                  limit,
                  (options?.filePolicy ?? imageLimits.resolve()).limits[limit].maximum,
                ]),
              ) as Record<(typeof PER_FILE_LIMITS)[number], number>,
            },
            callOptions(options),
          ),
        );
        options?.onProgress?.(1);
        return {
          id,
          format: probe.format,
          width: size.width,
          height: size.height,
          // Animations open as their first frame until the GIF decoder lands
          // (docs/adr/0001).
          frames: 1,
          hasAlpha: probe.hasAlpha,
          decodedBytes: size.width * size.height * 4,
        };
      } catch (error) {
        ids.delete(id);
        // A cancelled decode may still finish in the worker; release it.
        if (options?.signal?.aborted && !destroyed) {
          client.call("release", { id }).catch(() => undefined);
        }
        throw error;
      }
    },

    async thumbnail(
      id: string,
      maxSize: number,
      options?: ImageCallOptions,
    ): Promise<ImageThumbnail> {
      if (!ids.has(id)) throw new TypeError(`There's no source with the id "${id}".`);
      if (!(maxSize >= 1)) throw new RangeError("maxSize must be at least 1.");
      return run(options?.signal, () =>
        client.call("thumbnail", { id, maxSize }, callOptions(options)),
      );
    },

    async release(id: string): Promise<void> {
      if (!ids.delete(id) || destroyed) return;
      await run(undefined, () => client.call("release", { id }));
    },

    async destroy(): Promise<void> {
      if (destroyed) return;
      destroyed = true;
      ids.clear();
      client.destroy();
    },
  };
}
