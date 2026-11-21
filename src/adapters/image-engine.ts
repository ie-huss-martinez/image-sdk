import {
  createAssetsResolver,
  createWorkerClient,
  type WorkerClient,
  type WorkerLike,
} from "@hussmartinez/sdk-core";
import { asImageError, throwIfAborted } from "../core/errors/error-helpers.js";
import { ImageError } from "../core/errors/image-error.js";
import { imageLimits, PER_FILE_LIMITS } from "../core/errors/image-limits.js";
import type { ImageProbe, ImageSourceInfo, ImageThumbnail } from "../core/model/source.js";
import type { ImageEngine } from "../core/ports/image-engine.js";
import type { ImageCallOptions, ImageRegisterOptions } from "../core/ports/options.js";
import type { RenderWorkerContract } from "./render-worker/contract.js";
import {
  closeRejectedResult,
  createWorkerLifecycle,
  type WorkerGeneration,
} from "./worker-lifecycle.js";
import { startFailure } from "./worker-start.js";

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
   * is refused with `WORKER_START_FAILED`. The base may be absolute or
   * relative to the page, including during server rendering: it is checked
   * at setup and resolved only when the worker starts. By default the
   * worker is inlined.
   */
  readonly assetsUrl?: string | URL;
}

/**
 * What a processor needs from the engine whose render worker it shares
 * (docs/adr/0002): its client, once the worker has loaded, and which sources
 * it holds.
 *
 * @internal
 */
export interface EngineInternals {
  readonly call: WorkerClient<RenderWorkerContract>["call"];
  readonly prepare: () => Promise<WorkerGeneration>;
  readonly check: (generation?: WorkerGeneration) => void;
  readonly getSnapshot: () => boolean;
  readonly subscribe: (listener: () => void) => () => void;
  readonly has: (id: string) => boolean;
  /**
   * Whether a renderer may draw the source: registered, or still being
   * registered with its first frame ready (docs/adr/0011).
   */
  readonly drawable: (id: string) => boolean;
  /**
   * Loads the job worker's code, on the first GIF export, and returns how to
   * start it and where it comes from (docs/adr/0011). Each processor starts
   * its own.
   */
  readonly loadJobWorker: () => Promise<{
    readonly start: () => WorkerLike;
    readonly asset: string;
  }>;
  /** The version the job worker must report: this package's. */
  readonly version: string;
}

/** Where an engine made by {@link createImageEngine} keeps its internals. */
export const ENGINE_INTERNALS: unique symbol = Symbol("hm-image-engine");

/**
 * The internals of an engine made by {@link createImageEngine}, or
 * `undefined` for any other engine.
 *
 * @internal
 */
export function engineInternals(engine: ImageEngine): EngineInternals | undefined {
  return (engine as { [ENGINE_INTERNALS]?: EngineInternals })[ENGINE_INTERNALS];
}

/** What the engine needs from its environment, replaceable in tests. */
export interface EngineEnvironment {
  /** Loads the worker's code, on the first call, and returns how to start it. */
  readonly loadWorker: () => Promise<() => WorkerLike>;
  /** The version the worker must report: this package's. */
  readonly version: string;
  /** Where the worker comes from, for the version error's details. */
  readonly asset?: string;
  /** Loads the job worker's code, as `loadWorker` does the render worker's (docs/adr/0011). */
  readonly loadJobWorker?: () => Promise<{
    readonly start: () => WorkerLike;
    readonly asset: string;
  }>;
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
 * Loss of a worker that owns sources or a transferred canvas makes this
 * engine terminal (ADR 0008). Later processing rejects with
 * `WORKER_TERMINATED` and `details.reason: "engine-invalidated"`; explicitly
 * recreate processing resources and reopen the image. No work is replayed.
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
  const asset =
    options.assetsUrl === undefined ? undefined : createAssetsResolver(options.assetsUrl);
  let workerUrl: string | undefined;
  return createEngine({
    loadWorker: asset
      ? async () => () => {
          workerUrl = asset("image/render.worker.js");
          return new Worker(workerUrl, { type: "module", name: "hm-image-render" });
        }
      : // Through package.json's imports, which a build with the
        // hm-self-hosted condition maps to a stub (sdk-core ADR 0060).
        async () => (await import("#hm-image-render-worker")).createInlineWorker,
    // The job worker comes from the same place as the render worker: inlined,
    // or the host's assets (docs/adr/0011).
    loadJobWorker: asset
      ? async () => {
          const url = asset("image/job.worker.js");
          return {
            start: () => new Worker(url, { type: "module", name: "hm-image-job" }),
            asset: url,
          };
        }
      : async () => ({
          start: (await import("#hm-image-job-worker")).createInlineJobWorker,
          asset: "inline",
        }),
    version: __IMAGE_SDK_VERSION__,
    get asset() {
      return workerUrl ?? "inline";
    },
  });
}

/**
 * The engine, with its environment passed in.
 *
 * @internal
 */
export function createEngine(
  environment: EngineEnvironment,
): ImageEngine & { readonly [ENGINE_INTERNALS]: EngineInternals } {
  let startWorker: (() => WorkerLike) | undefined;
  let destroyed = false;
  /** Sources the worker holds, or is decoding, by id. */
  const ids = new Map<
    string,
    { generation?: WorkerGeneration; registered: boolean; released: boolean; firstFrame?: boolean }
  >();
  const lifecycle = createWorkerLifecycle(
    () => ids.clear(),
    (id, generation) => {
      const reservation = ids.get(id);
      if (reservation) reservation.generation = generation;
    },
  );

  const client: WorkerClient<RenderWorkerContract> = createWorkerClient<RenderWorkerContract>({
    createWorker: () => {
      if (!startWorker) {
        throw new ImageError("WORKER_START_FAILED", "The render worker hasn't loaded.");
      }
      return lifecycle.wrap(startWorker());
    },
    errorClasses: { ImageError },
    // The worker holds the sources, so it lives as long as the engine, and a
    // cancelled decode may finish rather than take the sources with it.
    idleTimeout: 0,
    cancelTimeout: 30_000,
    // A self-hosted worker copied before an upgrade speaks the same protocol
    // but runs older code: sdk-core refuses it before any call, with
    // WORKER_START_FAILED and the asset and both versions (ADR 0038).
    packageVersion: environment.version,
    // Read the final asset URL after worker creation, without resolving it
    // during setup just to populate diagnostics.
    get workerAsset() {
      return environment.asset ?? "inline";
    },
  });

  async function ready(): Promise<void> {
    if (destroyed) throw new Error("The image engine has been destroyed.");
    startWorker ??= await environment.loadWorker();
  }

  const call: WorkerClient<RenderWorkerContract>["call"] = async (method, input, options) => {
    lifecycle.check();
    throwIfAborted(options?.signal);
    await ready();
    lifecycle.check();
    // Keep startup cancellation in the RPC: start() alone has no signal.
    const pending = client.call(method, input, options);
    const generation = lifecycle.current();
    const result = await pending.catch((error: unknown) => {
      // A worker that couldn't start for a reason of its own keeps it, such
      // as a build that left the inlined worker out (sdk-core ADR 0060).
      throw error instanceof TypeError ? error : asImageError(startFailure(error));
    });
    try {
      lifecycle.check(generation);
    } catch (error) {
      closeRejectedResult(result);
      throw error;
    }
    return result;
  };

  const prepare = async () => {
    lifecycle.check();
    await ready();
    lifecycle.check();
    const pending = client.start();
    const generation = lifecycle.current();
    try {
      await pending;
    } catch (error) {
      throw asImageError(startFailure(error));
    }
    lifecycle.check(generation);
    if (!generation) throw new Error("The worker did not create a generation.");
    return generation;
  };

  const callOptions = (options: ImageCallOptions | undefined) =>
    options?.signal ? { signal: options.signal } : {};

  return {
    [ENGINE_INTERNALS]: {
      call,
      prepare,
      check: lifecycle.check,
      getSnapshot: lifecycle.getSnapshot,
      subscribe: lifecycle.subscribe,
      has: (id) => ids.get(id)?.registered === true,
      drawable: (id) => {
        const reservation = ids.get(id);
        return (
          reservation?.registered === true ||
          (reservation?.firstFrame === true && !reservation.released)
        );
      },
      loadJobWorker: async () => {
        if (!environment.loadJobWorker) {
          throw new ImageError("UNSUPPORTED_FORMAT", "This engine can't write GIFs.", {
            details: { format: "gif" },
          });
        }
        return environment.loadJobWorker();
      },
      version: environment.version,
    },

    probe(file: Blob, options?: ImageCallOptions): Promise<ImageProbe> {
      return call("probe", { file }, callOptions(options));
    },

    async register(
      id: string,
      file: Blob,
      probe: ImageProbe,
      options?: ImageRegisterOptions,
    ): Promise<ImageSourceInfo> {
      lifecycle.check();
      if (ids.has(id)) throw new TypeError(`The source id "${id}" is already in use.`);
      const reservation: {
        generation?: WorkerGeneration;
        registered: boolean;
        released: boolean;
        /** Its first frame is drawable, though it isn't registered yet. */
        firstFrame?: boolean;
      } = { registered: false, released: false };
      ids.set(id, reservation);
      try {
        const decoded = await call(
          "register",
          {
            id,
            file,
            probe,
            frames: options?.frames ?? "first",
            animationPixels: (options?.filePolicy ?? imageLimits.resolve()).limits
              .maxAnimationPixels.maximum,
            // The maxima cross to the worker, which checks them against its
            // own probe (docs/adr/0004).
            limits: Object.fromEntries(
              PER_FILE_LIMITS.map((limit) => [
                limit,
                (options?.filePolicy ?? imageLimits.resolve()).limits[limit].maximum,
              ]),
            ) as Record<(typeof PER_FILE_LIMITS)[number], number>,
          },
          {
            ...callOptions(options),
            // Only a source held with all its frames reports any (docs/adr/0011).
            onProgress: ({ done, total, firstFrame }) => {
              if (firstFrame) {
                if (reservation.released || reservation.firstFrame) return;
                reservation.firstFrame = true;
                options?.onFirstFrame?.();
                return;
              }
              options?.onProgress?.(done / total);
            },
          },
        );
        lifecycle.check(reservation.generation);
        if (reservation.released)
          throw new TypeError("The source was released during registration.");
        reservation.registered = true;
        options?.onProgress?.(1);
        lifecycle.check(reservation.generation);
        return {
          id,
          format: probe.format,
          width: decoded.width,
          height: decoded.height,
          // 1 unless it was registered with all its frames (docs/adr/0011).
          frames: decoded.frames,
          hasAlpha: probe.hasAlpha,
          decodedBytes: decoded.bytes,
          timing: decoded.timing,
          incomplete: decoded.incomplete,
        };
      } catch (error) {
        if (ids.get(id) === reservation) ids.delete(id);
        // A cancelled decode may still finish in the worker; release it.
        if (
          (options?.signal?.aborted || reservation.released) &&
          reservation.generation &&
          !reservation.generation.closed &&
          !destroyed &&
          !lifecycle.getSnapshot()
        ) {
          call("release", { id }).catch(() => undefined);
        }
        throw error;
      }
    },

    async thumbnail(
      id: string,
      maxSize: number,
      options?: ImageCallOptions,
    ): Promise<ImageThumbnail> {
      lifecycle.check();
      if (!ids.get(id)?.registered) throw new TypeError(`There's no source with the id "${id}".`);
      if (!(maxSize >= 1)) throw new RangeError("maxSize must be at least 1.");
      return call("thumbnail", { id, maxSize }, callOptions(options));
    },

    async release(id: string): Promise<void> {
      const reservation = ids.get(id);
      if (!reservation) return;
      if (!reservation.registered) {
        reservation.released = true;
        return;
      }
      ids.delete(id);
      if (destroyed || lifecycle.getSnapshot() || reservation.generation?.closed) return;
      await call("release", { id });
    },

    async destroy(): Promise<void> {
      if (destroyed) return;
      destroyed = true;
      lifecycle.destroy();
      client.destroy();
    },
  };
}
