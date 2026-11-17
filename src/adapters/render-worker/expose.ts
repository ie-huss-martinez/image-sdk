import { createWindowReader, type ExposeWorkerOptions, exposeWorker } from "@hussmartinez/sdk-core";
import { ImageError } from "../../core/errors/image-error.js";
import { checkFileLimits, checkOutputLimits, imageLimits } from "../../core/errors/image-limits.js";
import type { ImagePlan } from "../../core/model/plan.js";
import type { ImageProbe } from "../../core/model/source.js";
import { backingSize } from "../../core/ports/image-renderer.js";
import { checkPlanSupport, type ImagePlanPart } from "../../core/ports/plan-support.js";
import { decodeUpright } from "../decode/decode.js";
import { encodePlan } from "../export/encode.js";
import { drawPreview } from "../export/preview.js";
import { forgetSanitised } from "../export/redact.js";
import { renderSize } from "../export/render.js";
import { probeImage } from "../probe/probe.js";
import type { RenderWorkerContract } from "./contract.js";

/** Whether two probes describe the same decode: what the worker checks before trusting the page's. */
function sameDecode(a: ImageProbe, b: ImageProbe): boolean {
  return (
    a.format === b.format &&
    a.orientation === b.orientation &&
    a.frames === b.frames &&
    a.decodedPixelBound === b.decodedPixelBound &&
    a.stored.width === b.stored.width &&
    a.stored.height === b.stored.height &&
    a.oriented.width === b.oriented.width &&
    a.oriented.height === b.oriented.height
  );
}

/**
 * The parts of a plan this worker draws, beyond the base. A plan with any
 * other is refused before anything is drawn (docs/adr/0009).
 */
const DRAWS: readonly ImagePlanPart[] = ["layers", "redactions"];

/**
 * Answers the render worker's contract (docs/adr/0002). It does nothing on
 * import, so the worker announces itself at once; calibration runs on the
 * first oriented file of each format.
 */
export function exposeRenderWorker(options?: ExposeWorkerOptions): void {
  const sources = new Map<string, ImageBitmap>();
  const canvases = new Map<string, OffscreenCanvasRenderingContext2D>();
  /**
   * The sanitised copies a redaction may need, each the size of its source,
   * checked before any is allocated: the base's, and every image layer's
   * (docs/adr/0010).
   */
  const checkCopies = (
    policy: ReturnType<typeof imageLimits.resolve>,
    plan: ImagePlan,
    base: ImageBitmap,
  ) => {
    checkOutputLimits(policy, base);
    for (const layer of plan.layers) {
      const source = layer.kind === "image" ? sources.get(layer.source) : undefined;
      if (source) checkOutputLimits(policy, source);
    }
  };
  exposeWorker<RenderWorkerContract>(
    {
      probe: ({ file }) => probeImage(createWindowReader(file)),
      async register({ id, file, probe, limits }, { signal }) {
        if (sources.has(id)) throw new TypeError(`The source id "${id}" is already in use.`);
        // The page's probe is input like any other: the worker probes the
        // file itself, and decodes only what its own probe bounds.
        const own = await probeImage(createWindowReader(file));
        if (!sameDecode(own, probe)) {
          throw new ImageError("INVALID_IMAGE", "The probe doesn't describe this file.", {
            details: { format: own.format, problem: "the probe describes another file" },
          });
        }
        checkFileLimits(imageLimits.resolve(limits), file.size, own);
        const bitmap = await decodeUpright(file, own);
        if (signal.aborted) {
          bitmap.close();
          throw signal.reason;
        }
        sources.set(id, bitmap);
        return { width: bitmap.width, height: bitmap.height };
      },
      thumbnail({ id, maxSize }) {
        const source = sources.get(id);
        if (!source) throw new TypeError(`There's no source with the id "${id}".`);
        const scale = Math.min(1, maxSize / source.width, maxSize / source.height);
        return createImageBitmap(source, {
          resizeWidth: Math.max(1, Math.round(source.width * scale)),
          resizeHeight: Math.max(1, Math.round(source.height * scale)),
          resizeQuality: "high",
        });
      },
      async export({ plan, format, limits }, { signal }) {
        checkPlanSupport(plan, DRAWS);
        const source = sources.get(plan.base.source);
        if (!source) throw new TypeError(`There's no source with the id "${plan.base.source}".`);
        // The output canvas is checked before it's allocated (docs/adr/0004),
        // and so is the sanitised copy a redaction needs (docs/adr/0010).
        const policy = imageLimits.resolve(limits);
        checkOutputLimits(policy, renderSize(plan, source));
        if (plan.redactions.length > 0) checkCopies(policy, plan, source);
        return encodePlan(source, plan, format, signal, (id) => sources.get(id));
      },
      attachCanvas({ id, canvas }) {
        // One context per canvas, for its life: Firefox refuses a second
        // getContext on a transferred canvas.
        const context = canvas.getContext("2d", { colorSpace: "srgb" });
        if (!context) throw new Error("The worker has no 2D canvas.");
        canvases.set(id, context);
        return undefined;
      },
      async render({ id, plan, view, limits }, { signal }) {
        checkPlanSupport(plan, DRAWS);
        // Before the canvas is resized, whatever the page checked (docs/adr/0004).
        checkOutputLimits(imageLimits.resolve(limits), backingSize(view));
        const context = canvases.get(id);
        if (!context) throw new TypeError(`There's no canvas with the id "${id}".`);
        const source = sources.get(plan.base.source);
        if (!source) throw new TypeError(`There's no source with the id "${plan.base.source}".`);
        if (plan.redactions.length > 0) checkCopies(imageLimits.resolve(limits), plan, source);
        await drawPreview(context, source, plan, view, signal, (id) => sources.get(id));
        return undefined;
      },
      detachCanvas({ id }) {
        const context = canvases.get(id);
        if (context) {
          context.canvas.width = 0;
          context.canvas.height = 0;
        }
        canvases.delete(id);
        return undefined;
      },
      snapshot({ id }) {
        const context = canvases.get(id);
        if (!context) throw new TypeError(`There's no canvas with the id "${id}".`);
        return createImageBitmap(context.canvas);
      },
      release({ id }) {
        const source = sources.get(id);
        if (source) forgetSanitised(source);
        source?.close();
        sources.delete(id);
        return undefined;
      },
    },
    // The worker announces the version it was built from, and the page
    // refuses another (sdk-core ADR 0038).
    { ...options, packageVersion: __IMAGE_SDK_VERSION__ },
  );
}
