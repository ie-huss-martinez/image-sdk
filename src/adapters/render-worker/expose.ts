import { createWindowReader, type ExposeWorkerOptions, exposeWorker } from "@hussmartinez/sdk-core";
import { ImageError } from "../../core/errors/image-error.js";
import { checkFileLimits, checkOutputLimits, imageLimits } from "../../core/errors/image-limits.js";
import type { ImagePlan } from "../../core/model/plan.js";
import type { ImageProbe } from "../../core/model/source.js";
import { backingSize } from "../../core/ports/image-renderer.js";
import { checkPlanSupport, type ImagePlanPart } from "../../core/ports/plan-support.js";
import { bitmapOf, decodeUpright, readGif } from "../decode/decode.js";
import { encodePlan } from "../export/encode.js";
import { drawPreview } from "../export/preview.js";
import { forgetSanitised } from "../export/redact.js";
import { renderPlan, renderSize } from "../export/render.js";
import { checkGifFrames, type GifSource } from "../gif/source.js";
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
const DRAWS: readonly ImagePlanPart[] = ["layers", "drawings", "redactions"];
/** And for a source held with all its frames: one frame of its animation at a time. */
const DRAWS_FRAMES: readonly ImagePlanPart[] = [...DRAWS, "animation"];

/**
 * Answers the render worker's contract (docs/adr/0002). It does nothing on
 * import, so the worker announces itself at once; calibration runs on the
 * first oriented file of each format.
 */
export function exposeRenderWorker(options?: ExposeWorkerOptions): void {
  const sources = new Map<string, ImageBitmap>();
  /** The GIFs held with all their frames, beside their first frame's bitmap (docs/adr/0011). */
  const animations = new Map<string, GifSource>();
  /**
   * The bitmap a plan's base is drawn from: the source's own for a still,
   * and for an animated plan the frame asked for, composed. A plan with an
   * animation is drawn only over a source that holds its frames: a still
   * would show its first frame as if it were the plan (docs/adr/0009).
   */
  const baseOf = async (
    plan: ImagePlan,
    frame: number,
  ): Promise<{ readonly bitmap: ImageBitmap; readonly own: boolean }> => {
    const animation = animations.get(plan.base.source);
    checkPlanSupport(plan, animation ? DRAWS_FRAMES : DRAWS);
    const first = sources.get(plan.base.source);
    if (!first) throw new TypeError(`There's no source with the id "${plan.base.source}".`);
    const shown = plan.animation?.frames[frame];
    if (!animation || plan.animation === null) return { bitmap: first, own: false };
    if (
      !shown ||
      !Number.isInteger(shown.frame) ||
      shown.frame < 0 ||
      shown.frame >= animation.frames
    ) {
      throw new ImageError("UNSUPPORTED_PLAN", "The plan shows a frame its source doesn't hold.", {
        details: { reason: "animation" },
      });
    }
    if (shown.frame === 0) return { bitmap: first, own: false };
    // A bitmap of its own for this call: another call may draw another frame meanwhile.
    const { width, height } = animation;
    const pixels = new Uint8ClampedArray(animation.store.frame(shown.frame));
    return { bitmap: await bitmapOf(pixels, width, height), own: true };
  };
  /** Frees a frame's bitmap, and what a redaction kept of it. */
  const done = (base: { readonly bitmap: ImageBitmap; readonly own: boolean }) => {
    if (!base.own) return;
    forgetSanitised(base.bitmap);
    base.bitmap.close();
  };
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
      async register({ id, file, probe, limits, frames, animationPixels }, { signal, progress }) {
        if (sources.has(id)) throw new TypeError(`The source id "${id}" is already in use.`);
        // The page's probe is input like any other: the worker probes the
        // file itself, and decodes only what its own probe bounds.
        const own = await probeImage(createWindowReader(file));
        if (!sameDecode(own, probe)) {
          throw new ImageError("INVALID_IMAGE", "The probe doesn't describe this file.", {
            details: { format: own.format, problem: "the probe describes another file" },
          });
        }
        // Held as a still, a file counts one frame against the limits; held
        // with its frames, every one (docs/adr/0011).
        const all = frames === "all" && own.format === "gif" && own.frames > 1;
        checkFileLimits(imageLimits.resolve(limits), file.size, own, all ? "all" : "first");
        if (all) {
          // An animation's working set is several screens, so its screen
          // has a lower ceiling than a still's. The session opens a file
          // over it as a still; asked for directly, it's refused.
          imageLimits
            .resolve({ maxAnimationPixels: animationPixels })
            .check("maxAnimationPixels", own.oriented.width * own.oriented.height);
          // Every frame is decoded once, so the source holds only frames
          // that can be drawn (docs/adr/0011).
          const { bytes, gif } = await readGif(file, own);
          // The first frame is drawable as soon as it's decoded, under the
          // source's id, while the rest are checked: the page can show it.
          let first: Promise<ImageBitmap> | undefined;
          const discardFirst = () => {
            first?.then((bitmap) => {
              if (sources.get(id) === bitmap) sources.delete(id);
              bitmap.close();
            });
          };
          let animation: GifSource;
          try {
            animation = await checkGifFrames(bytes, gif, {
              signal,
              progress: (done, total, screen) => {
                progress({ done, total });
                if (done !== 1) return;
                // A copy now: the store's screen moves on with the next frame.
                const pixels = new Uint8ClampedArray(screen);
                first = bitmapOf(pixels, gif.width, gif.height).then((bitmap) => {
                  if (!signal.aborted) {
                    sources.set(id, bitmap);
                    progress({ done, total, firstFrame: true });
                  }
                  return bitmap;
                });
              },
            });
          } catch (error) {
            discardFirst();
            throw error;
          }
          const bitmap = await (first ??
            bitmapOf(new Uint8ClampedArray(animation.store.frame(0)), gif.width, gif.height));
          if (signal.aborted) {
            if (sources.get(id) === bitmap) sources.delete(id);
            bitmap.close();
            throw signal.reason;
          }
          sources.set(id, bitmap);
          animations.set(id, animation);
          return {
            width: bitmap.width,
            height: bitmap.height,
            frames: animation.frames,
            timing: { loop: animation.loop, delays: animation.delays },
            incomplete: animation.incomplete,
            bytes: bitmap.width * bitmap.height * 4 + animation.bytes,
          };
        }
        const bitmap = await decodeUpright(file, own);
        if (signal.aborted) {
          bitmap.close();
          throw signal.reason;
        }
        sources.set(id, bitmap);
        return {
          width: bitmap.width,
          height: bitmap.height,
          frames: 1,
          timing: null,
          incomplete: false,
          bytes: bitmap.width * bitmap.height * 4,
        };
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
      async export({ plan, format, frame, limits }, { signal }) {
        // A GIF is written frame by frame through the job worker (docs/adr/0011).
        if (format.type === "gif") throw new TypeError("A GIF is exported frame by frame.");
        const base = await baseOf(plan, frame);
        try {
          const source = base.bitmap;
          // The output canvas is checked before it's allocated (docs/adr/0004),
          // and so is the sanitised copy a redaction needs (docs/adr/0010).
          const policy = imageLimits.resolve(limits);
          checkOutputLimits(policy, renderSize(plan, source));
          if (plan.redactions.length > 0) checkCopies(policy, plan, source);
          return await encodePlan(source, plan, format, signal, (id) => sources.get(id));
        } finally {
          done(base);
        }
      },
      async frame({ plan, frame, count, limits }, { signal }) {
        const base = await baseOf(plan, frame);
        try {
          const source = base.bitmap;
          const policy = imageLimits.resolve(limits);
          const size = renderSize(plan, source);
          checkOutputLimits(policy, size);
          // Every frame the export writes is this size: all of them are
          // bounded before the first is drawn (docs/adr/0011).
          policy.check("maxDecodedSize", count * size.width * size.height * 4);
          if (plan.redactions.length > 0) checkCopies(policy, plan, source);
          const canvas = await renderPlan(source, plan, false, signal, (id) => sources.get(id));
          const context = canvas.getContext("2d", { colorSpace: "srgb" });
          if (!context) throw new Error("The worker has no 2D canvas.");
          const { data } = context.getImageData(0, 0, canvas.width, canvas.height, {
            colorSpace: "srgb",
          });
          canvas.width = 0;
          canvas.height = 0;
          if (signal.aborted) throw signal.reason;
          return { width: size.width, height: size.height, pixels: data.buffer };
        } finally {
          done(base);
        }
      },
      attachCanvas({ id, canvas }) {
        // One context per canvas, for its life: Firefox refuses a second
        // getContext on a transferred canvas.
        const context = canvas.getContext("2d", { colorSpace: "srgb" });
        if (!context) throw new Error("The worker has no 2D canvas.");
        canvases.set(id, context);
        return undefined;
      },
      async render({ id, plan, view, frame, limits }, { signal }) {
        // Refused before anything else, as it was: a plan this can't draw.
        checkPlanSupport(plan, animations.has(plan.base.source) ? DRAWS_FRAMES : DRAWS);
        // Before the canvas is resized, whatever the page checked (docs/adr/0004).
        checkOutputLimits(imageLimits.resolve(limits), backingSize(view));
        const context = canvases.get(id);
        if (!context) throw new TypeError(`There's no canvas with the id "${id}".`);
        const base = await baseOf(plan, frame);
        try {
          const source = base.bitmap;
          if (plan.redactions.length > 0) checkCopies(imageLimits.resolve(limits), plan, source);
          await drawPreview(context, source, plan, view, signal, (id) => sources.get(id));
        } finally {
          done(base);
        }
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
        // Its bytes, its screen and its cache go with it.
        animations.delete(id);
        return undefined;
      },
    },
    // The worker announces the version it was built from, and the page
    // refuses another (sdk-core ADR 0038).
    { ...options, packageVersion: __IMAGE_SDK_VERSION__ },
  );
}
