import { throwIfAborted } from "../../core/errors/error-helpers.js";
import type { ImagePlan } from "../../core/model/plan.js";

/** A frame the render worker rendered: its pixels, which the page hands on and never reads. */
export interface RenderedFrame {
  readonly width: number;
  readonly height: number;
  readonly pixels: ArrayBuffer;
}

/** What a GIF export needs from the two workers (docs/adr/0011). */
export interface GifExportWorkers {
  /** Renders frame `index` of the plan, as one of `count`. */
  readonly render: (index: number, count: number, signal: AbortSignal) => Promise<RenderedFrame>;
  readonly start: (width: number, height: number, signal: AbortSignal) => Promise<void>;
  /** Transfers the frame's pixels to the job worker: the page's buffer is empty afterwards. */
  readonly write: (frame: RenderedFrame, delay: number, signal: AbortSignal) => Promise<void>;
  readonly finish: (signal: AbortSignal) => Promise<Blob>;
  /** Forgets the job, finished or not. It never fails. */
  readonly abandon: () => Promise<void>;
}

/** The frames a plan exports to GIF, in order, with their delays: one for a still. */
export function gifFrames(plan: ImagePlan): readonly number[] {
  return plan.animation === null ? [0] : plan.animation.frames.map((frame) => frame.delay);
}

/**
 * Exports a plan to GIF (docs/adr/0011). Frames cross the page one at a
 * time: each is rendered, its buffer handed straight on to the job worker,
 * and the next is asked for only once the job worker has taken it. The
 * page never reads a frame, and holds none after handing it on.
 *
 * Cancelling is checked between frames. Whatever ends the export, the job
 * worker's job is forgotten.
 */
export async function exportGif(
  plan: ImagePlan,
  workers: GifExportWorkers,
  signal: AbortSignal,
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  const delays = gifFrames(plan);
  let started = false;
  try {
    for (const [index, delay] of delays.entries()) {
      throwIfAborted(signal);
      const frame = await workers.render(index, delays.length, signal);
      if (!started) {
        // Every frame is the plan's output size: the first says what it is.
        await workers.start(frame.width, frame.height, signal);
        started = true;
      }
      throwIfAborted(signal);
      await workers.write(frame, delay, signal);
      // The last fraction is the file's: it's reported as 1 once it's written.
      onProgress?.((index + 1) / (delays.length + 1));
    }
    throwIfAborted(signal);
    const blob = await workers.finish(signal);
    onProgress?.(1);
    return blob;
  } finally {
    if (started) await workers.abandon();
  }
}
