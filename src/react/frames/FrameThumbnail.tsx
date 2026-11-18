import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createImageRenderer } from "../../adapters/image-renderer.js";
import type { ImagePlan } from "../../core/model/plan.js";
import type { ImageEngine } from "../../core/ports/image-engine.js";
import { fittedView } from "../../core/ports/image-renderer.js";

/**
 * The most frame thumbnails drawn at once (docs/adr/0011). Each is a small
 * canvas the render worker draws into, made when its row scrolls into view
 * and released when it leaves, so a list of thousands of frames holds only
 * the canvases of the rows in view. A row in view past the cap shows its
 * name alone until another's thumbnail is released.
 */
export const MAX_FRAME_THUMBNAILS = 24;

/** A thumbnail's size, in CSS pixels: square, the frame fitted inside it. */
export const FRAME_THUMBNAIL_SIZE = 48;

/**
 * Hands out the right to draw a thumbnail, to at most `max` rows at a time.
 * Rows that ask while none is free wait, first come first served.
 */
export interface ThumbnailSlots {
  /** Asks for a slot: `start` runs once one is free. Returns a function that gives it back, or stops waiting. */
  take(start: () => void): () => void;
  /** How many slots are in use, for tests. */
  readonly used: () => number;
}

export function createThumbnailSlots(max = MAX_FRAME_THUMBNAILS): ThumbnailSlots {
  let used = 0;
  const waiting: (() => void)[] = [];
  const next = () => {
    while (used < max) {
      const start = waiting.shift();
      if (!start) return;
      used += 1;
      start();
    }
  };
  return {
    take(start) {
      let state: "waiting" | "drawing" | "done" = "waiting";
      const begin = () => {
        state = "drawing";
        start();
      };
      waiting.push(begin);
      next();
      return () => {
        if (state === "drawing") {
          used -= 1;
          next();
        } else if (state === "waiting") {
          const at = waiting.indexOf(begin);
          if (at >= 0) waiting.splice(at, 1);
        }
        state = "done";
      };
    },
    used: () => used,
  };
}

/**
 * The plan a thumbnail draws: the frame's own picture, with the plan's
 * other edits. It doesn't change when only the frames' order or delays do,
 * so moving a frame redraws no thumbnail.
 */
function useThumbnailPlan(plan: ImagePlan, frame: number): ImagePlan {
  const { base, layers, redactions, output, metadata } = plan;
  return useMemo(
    () => ({
      base,
      layers,
      redactions,
      output,
      metadata,
      animation: { loop: null, frames: [{ key: "thumbnail", frame, delay: 0 }] },
    }),
    [base, layers, redactions, output, metadata, frame],
  );
}

/**
 * A frame's thumbnail in the frames list, drawn by the engine's render
 * worker with the plan's edits, only while its row is in view
 * (docs/adr/0011). It's decorative: the row's name says which frame it is.
 */
export function FrameThumbnail(props: {
  readonly engine: ImageEngine;
  readonly plan: ImagePlan;
  /** The source's frame it shows. */
  readonly frame: number;
  readonly slots: ThumbnailSlots;
}): ReactNode {
  const { engine, slots } = props;
  const box = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const plan = useThumbnailPlan(props.plan, props.frame);
  const renderer = useRef<ReturnType<typeof createImageRenderer> | null>(null);
  const attached = useRef<Promise<void> | null>(null);
  const [drawing, setDrawing] = useState(false);

  // In view or not: rows far down a long list never draw.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.at(-1);
      if (entry) setVisible(entry.isIntersecting);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // While it's in view and has a slot, a canvas of its own in the worker.
  useEffect(() => {
    const element = box.current;
    if (!visible || !element) return;
    let canvas: HTMLCanvasElement | undefined;
    let created: ReturnType<typeof createImageRenderer> | undefined;
    const give = slots.take(() => {
      try {
        created = createImageRenderer(engine);
      } catch {
        // A host's own engine has no render worker to draw it: the name alone.
        return;
      }
      canvas = document.createElement("canvas");
      canvas.className = "hm-image-frame-thumbnail-canvas";
      canvas.setAttribute("aria-hidden", "true");
      element.append(canvas);
      renderer.current = created;
      attached.current = created.attach(canvas);
      attached.current.catch(() => {});
      setDrawing(true);
    });
    return () => {
      give();
      if (created) void created.destroy();
      canvas?.remove();
      renderer.current = null;
      attached.current = null;
      setDrawing(false);
    };
  }, [visible, engine, slots]);

  useEffect(() => {
    const current = renderer.current;
    const ready = attached.current;
    if (!drawing || !current || !ready) return;
    const pixelRatio = globalThis.devicePixelRatio || 1;
    void ready
      .then(() =>
        current.render(plan, fittedView(FRAME_THUMBNAIL_SIZE, FRAME_THUMBNAIL_SIZE, pixelRatio)),
      )
      .catch(() => {
        // A thumbnail that can't be drawn stays empty; the row still names the frame.
      });
  }, [drawing, plan]);

  return (
    <span
      ref={box}
      className="hm-image-frame-thumbnail"
      // The size the worker draws it at, so its pixels aren't scaled again.
      style={{ inlineSize: FRAME_THUMBNAIL_SIZE, blockSize: FRAME_THUMBNAIL_SIZE }}
    />
  );
}
