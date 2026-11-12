import { abortError, asImageError, throwIfAborted } from "../core/errors/error-helpers.js";
import { ImageError } from "../core/errors/image-error.js";
import type { ImagePlan } from "../core/model/plan.js";
import type { ImageEngine } from "../core/ports/image-engine.js";
import type { ImageRenderer, ImageRenderOutcome, ImageView } from "../core/ports/image-renderer.js";
import type { ImageCallOptions } from "../core/ports/options.js";
import { engineInternals } from "./image-engine.js";

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
}

function checkView(view: ImageView): void {
  const positive = (n: number) => Number.isFinite(n) && n > 0;
  if (
    !positive(view.width) ||
    !positive(view.height) ||
    !positive(view.pixelRatio) ||
    !positive(view.zoom) ||
    !Number.isFinite(view.pan.x) ||
    !Number.isFinite(view.pan.y)
  ) {
    throw new RangeError("A view needs a positive size, pixel ratio and zoom, and a finite pan.");
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
    const controller = new AbortController();
    const onAbort = () => controller.abort(request.signal?.reason);
    request.signal?.addEventListener("abort", onAbort, { once: true });
    inFlight = { controller };
    internals
      .client()
      .then((client) =>
        client.call(
          "render",
          { id, plan: request.plan, view: request.view },
          { signal: controller.signal },
        ),
      )
      .then(
        () => {
          drawn += 1;
          request.resolve("drawn");
        },
        (error: unknown) => {
          if (request.signal?.aborted) request.reject(abortError(request.signal));
          else if (controller.signal.aborted) request.resolve("superseded");
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
      snapshot: async () => (await internals.client()).call("snapshot", { id }),
      drawn: () => drawn,
    },

    async attach(canvas: HTMLCanvasElement): Promise<void> {
      if (destroyed) throw new Error("The image renderer has been destroyed.");
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
      const offscreen = canvas.transferControlToOffscreen();
      try {
        const client = await internals.client();
        await client.call("attachCanvas", { id, canvas: offscreen }, { transfer: true });
        attached = true;
      } catch (error) {
        throw asImageError(error);
      }
    },

    render(
      plan: ImagePlan,
      view: ImageView,
      options?: ImageCallOptions,
    ): Promise<ImageRenderOutcome> {
      if (destroyed) return Promise.reject(new Error("The image renderer has been destroyed."));
      if (!attached) return Promise.reject(new TypeError("Attach a canvas before rendering."));
      if (!internals.has(plan.base.source)) {
        return Promise.reject(
          new TypeError(`There's no source with the id "${plan.base.source}".`),
        );
      }
      try {
        checkView(view);
        throwIfAborted(options?.signal);
      } catch (error) {
        return Promise.reject(error);
      }
      return new Promise<ImageRenderOutcome>((resolve, reject) => {
        pending?.resolve("superseded");
        pending = { plan, view, resolve, reject, signal: options?.signal };
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
      pending?.resolve("superseded");
      pending = undefined;
      inFlight?.controller.abort(new DOMException("The renderer was destroyed.", "AbortError"));
      if (attached) {
        try {
          await (await internals.client()).call("detachCanvas", { id });
        } catch {
          // The engine may already be destroyed, with its worker.
        }
      }
    },
  };
  return renderer;
}
