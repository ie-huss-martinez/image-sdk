import { abortError, asImageError, throwIfAborted } from "../core/errors/error-helpers.js";
import { ImageError, isImageError } from "../core/errors/image-error.js";
import { checkOutputLimits, imageLimits, OUTPUT_LIMITS } from "../core/errors/image-limits.js";
import type { ImagePlan } from "../core/model/plan.js";
import type { ImageEngine } from "../core/ports/image-engine.js";
import {
  backingSize,
  type ImageRenderer,
  type ImageRenderOptions,
  type ImageRenderOutcome,
  type ImageView,
} from "../core/ports/image-renderer.js";
import { engineInternals } from "./image-engine.js";
import { checkFrame, layerSources } from "./image-processor.js";

/** What tests reach of a renderer from {@link createImageRenderer}. */
export interface RendererInternals {
  /** A copy of the preview's pixels: the page can't read a transferred canvas. */
  readonly snapshot: () => Promise<ImageBitmap>;
  /** How many renders the worker has drawn, for the coalescing tests. */
  readonly drawn: () => number;
}

/** Where a renderer made by {@link createImageRenderer} keeps its internals. */
export const RENDERER_INTERNALS: unique symbol = Symbol("hm-image-renderer");

/**
 * The internals of a renderer made by {@link createImageRenderer}.
 *
 * @internal
 */
export function rendererInternals(renderer: ImageRenderer): RendererInternals | undefined {
  return (renderer as { [RENDERER_INTERNALS]?: RendererInternals })[RENDERER_INTERNALS];
}

let nextCanvasId = 0;

interface Request {
  readonly plan: ImagePlan;
  readonly view: ImageView;
  readonly resolve: (outcome: ImageRenderOutcome) => void;
  readonly reject: (error: unknown) => void;
  readonly signal: AbortSignal | undefined;
  readonly limits: Readonly<Record<(typeof OUTPUT_LIMITS)[number], number>>;
  /** Stops listening for an abort while it waits: it's drawn, replaced or dropped. */
  stopWaiting: () => void;
}

function checkView(view: ImageView): void {
  const positive = (n: number) => Number.isFinite(n) && n > 0;
  if (
    !positive(view.width) ||
    !positive(view.height) ||
    !positive(view.pixelRatio) ||
    !positive(view.zoom) ||
    !Number.isFinite(view.pan.x) ||
    !Number.isFinite(view.pan.y) ||
    (view.inset !== undefined &&
      !(view.inset >= 0 && 2 * view.inset < Math.min(view.width, view.height)))
  ) {
    throw new RangeError(
      "A view needs a positive size, pixel ratio and zoom, a finite pan, and an inset under half its size.",
    );
  }
}

/**
 * Creates the SDK's preview renderer over an engine from
 * `createImageEngine`, sharing its render worker, where the sources are
 * (docs/adr/0002). The canvas is transferred to the worker once, and every
 * frame is drawn there by the same renderer as the export.
 *
 * Renders are coalesced, latest first: while one is being drawn, newer
 * calls replace the waiting one, which resolves `superseded`, and the one
 * being drawn is cancelled at its next strip. So a slider drag that sends
 * many plans ends with one final render of the last.
 *
 * @example
 * ```ts
 * const renderer = createImageRenderer(engine);
 * await renderer.attach(canvas);
 * await renderer.render(plan, fittedView(stage.clientWidth, stage.clientHeight, devicePixelRatio));
 * ```
 *
 * @throws `TypeError` for an engine that `createImageEngine` didn't make.
 * @public
 */
export function createImageRenderer(engine: ImageEngine): ImageRenderer {
  const internals = engineInternals(engine);
  if (!internals) {
    throw new TypeError("createImageRenderer needs an engine from createImageEngine.");
  }
  nextCanvasId += 1;
  const id = `preview-${nextCanvasId}`;
  let attached = false;
  let destroyed = false;
  let drawn = 0;
  let pending: Request | undefined;
  let inFlight: { readonly controller: AbortController } | undefined;

  const pump = () => {
    if (inFlight || !pending) return;
    const request = pending;
    pending = undefined;
    request.stopWaiting();
    // Aborted while it waited: refused, never drawn. An abort fires its event
    // once, so a listener added from here on would never hear it.
    if (request.signal?.aborted) {
      request.reject(abortError(request.signal.reason));
      pump();
      return;
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort(request.signal?.reason);
    request.signal?.addEventListener("abort", onAbort, { once: true });
    inFlight = { controller };
    internals
      .call(
        "render",
        {
          id,
          plan: request.plan,
          view: request.view,
          frame: request.view.frame ?? 0,
          limits: request.limits,
        },
        { signal: controller.signal },
      )
      .then(
        () => {
          try {
            internals.check();
          } catch (error) {
            request.reject(error);
            return;
          }
          drawn += 1;
          request.resolve("drawn");
        },
        (error: unknown) => {
          if (
            !internals.getSnapshot() &&
            controller.signal.aborted &&
            !request.signal?.aborted &&
            isImageError(error, "ABORTED")
          )
            request.resolve("superseded");
          else request.reject(error instanceof TypeError ? error : asImageError(error));
        },
      )
      .finally(() => {
        request.signal?.removeEventListener("abort", onAbort);
        inFlight = undefined;
        pump();
      });
  };

  const renderer: ImageRenderer & { readonly [RENDERER_INTERNALS]: RendererInternals } = {
    [RENDERER_INTERNALS]: {
      snapshot: async () => internals.call("snapshot", { id }),
      drawn: () => drawn,
    },

    async attach(canvas: HTMLCanvasElement): Promise<void> {
      if (destroyed) throw new Error("The image renderer has been destroyed.");
      internals.check();
      if (attached) throw new TypeError("The renderer already has a canvas.");
      if (typeof canvas.transferControlToOffscreen !== "function") {
        throw new ImageError(
          "UNSUPPORTED_ENVIRONMENT",
          "This browser can't draw the preview in a worker.",
          {
            details: { feature: "transferControlToOffscreen" },
          },
        );
      }
      try {
        const generation = await internals.prepare();
        internals.check(generation);
        if (destroyed) throw new Error("The image renderer has been destroyed.");
        const offscreen = canvas.transferControlToOffscreen();
        await internals.call("attachCanvas", { id, canvas: offscreen }, { transfer: true });
        internals.check(generation);
        if (destroyed) {
          await internals.call("detachCanvas", { id });
          throw new Error("The image renderer has been destroyed.");
        }
        attached = true;
      } catch (error) {
        throw asImageError(error);
      }
    },

    render(
      plan: ImagePlan,
      view: ImageView,
      options?: ImageRenderOptions,
    ): Promise<ImageRenderOutcome> {
      if (destroyed) return Promise.reject(new Error("The image renderer has been destroyed."));
      try {
        internals.check();
      } catch (error) {
        return Promise.reject(error);
      }
      if (!attached) return Promise.reject(new TypeError("Attach a canvas before rendering."));
      // A source still being registered may be drawn once its first frame is
      // ready, as a still, while the rest are checked (docs/adr/0011).
      const missing =
        !internals.has(plan.base.source) &&
        !(
          internals.drawable(plan.base.source) &&
          plan.animation === null &&
          plan.layers.length === 0
        )
          ? plan.base.source
          : layerSources(plan).find((id) => !internals.has(id));
      if (missing !== undefined) {
        return Promise.reject(new TypeError(`There's no source with the id "${missing}".`));
      }
      const policy = options?.filePolicy ?? imageLimits.resolve();
      try {
        checkView(view);
        // The frame shown is one the plan has: only 0 for a still.
        checkFrame(plan, view.frame ?? 0);
        // A runaway layout can't size the canvas past the limits; the
        // current frame stays (docs/adr/0004).
        checkOutputLimits(policy, backingSize(view));
        throwIfAborted(options?.signal);
      } catch (error) {
        return Promise.reject(error);
      }
      const limits = Object.fromEntries(
        OUTPUT_LIMITS.map((limit) => [limit, policy.limits[limit].maximum]),
      ) as Request["limits"];
      return new Promise<ImageRenderOutcome>((resolve, reject) => {
        const signal = options?.signal;
        if (pending) {
          pending.stopWaiting();
          pending.resolve("superseded");
        }
        const request: Request = { plan, view, resolve, reject, signal, limits, stopWaiting() {} };
        pending = request;
        // While it waits behind a render being drawn, an abort refuses it at
        // once. Checked first: an abort that has happened fires no event.
        if (signal?.aborted) {
          pending = undefined;
          reject(abortError(signal.reason));
          return;
        }
        if (signal) {
          const onAbort = () => {
            if (pending !== request) return;
            pending = undefined;
            reject(abortError(signal.reason));
          };
          signal.addEventListener("abort", onAbort, { once: true });
          request.stopWaiting = () => signal.removeEventListener("abort", onAbort);
        }
        // The render being drawn is stale now: stop it at its next strip.
        inFlight?.controller.abort(
          new DOMException("A later render replaced this one.", "AbortError"),
        );
        pump();
      });
    },

    async destroy(): Promise<void> {
      if (destroyed) return;
      destroyed = true;
      if (pending) {
        pending.stopWaiting();
        try {
          internals.check();
          pending.resolve("superseded");
        } catch (error) {
          pending.reject(error);
        }
      }
      pending = undefined;
      inFlight?.controller.abort(new DOMException("The renderer was destroyed.", "AbortError"));
      if (attached && !internals.getSnapshot()) {
        try {
          await internals.call("detachCanvas", { id });
        } catch {
          // The engine may already be destroyed, with its worker.
        }
      }
    },
  };
  return renderer;
}
