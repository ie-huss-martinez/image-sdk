import { describe, expect, it } from "vitest";
import { isImageError } from "../../core/errors/image-error.js";
import { createPlan, type ImagePlan } from "../../core/model/plan.js";
import { exportGif, type GifExportWorkers, gifFrames, type RenderedFrame } from "./gif-export.js";

/**
 * The page's part of a GIF export (docs/adr/0011), with recording workers:
 * frames cross the page one at a time, each handed straight on, and none
 * is read or held there.
 */

const animated = (delays: readonly number[], loop: number | null = 0): ImagePlan => ({
  ...createPlan("s"),
  animation: {
    loop,
    frames: delays.map((delay, frame) => ({ key: `k${frame}`, frame, delay })),
  },
});

/** Workers that record what happens, in order, and transfer buffers as postMessage would. */
function recording(options: { failAt?: number } = {}) {
  const log: string[] = [];
  let inTransit = 0;
  let most = 0;
  const handedOn: ArrayBuffer[] = [];
  const workers: GifExportWorkers = {
    async render(index, count) {
      inTransit += 1;
      most = Math.max(most, inTransit);
      log.push(`render ${index}/${count}`);
      if (index === options.failAt) throw new Error("render failed");
      return {
        width: 2,
        height: 1,
        pixels: new Uint8ClampedArray([index, 0, 0, 255, 0, index, 0, 255]).buffer,
      };
    },
    async start(width, height) {
      log.push(`start ${width}×${height}`);
    },
    async write(frame: RenderedFrame, delay) {
      // A transfer, as the worker client makes it: the page's buffer is left empty.
      const received = structuredClone(frame.pixels, { transfer: [frame.pixels] });
      handedOn.push(frame.pixels);
      inTransit -= 1;
      log.push(`write ${new Uint8Array(received)[0]} after ${delay}`);
    },
    async finish() {
      log.push("finish");
      return new Blob([], { type: "image/gif" });
    },
    async abandon() {
      log.push("abandon");
    },
  };
  return { workers, log, handedOn, most: () => most };
}

describe("a GIF export's frames, through the page (docs/adr/0011)", () => {
  it("renders and hands on one frame at a time, in the plan's order, then finishes", async () => {
    const { workers, log, handedOn, most } = recording();
    const seen: number[] = [];
    const blob = await exportGif(
      animated([5, 0, 9]),
      workers,
      new AbortController().signal,
      (fraction) => seen.push(fraction),
    );
    expect(blob.type).toBe("image/gif");
    expect(log).toEqual([
      "render 0/3",
      "start 2×1",
      "write 0 after 5",
      "render 1/3",
      "write 1 after 0",
      "render 2/3",
      "write 2 after 9",
      "finish",
      "abandon",
    ]);
    // Never more than one frame between the two workers.
    expect(most()).toBe(1);
    // Every buffer the page held was handed on, and is empty now.
    expect(handedOn).toHaveLength(3);
    for (const buffer of handedOn) expect(buffer.byteLength).toBe(0);
    // Progress by frame, then 1 for the file.
    expect(seen).toEqual([0.25, 0.5, 0.75, 1]);
  });

  it("writes a still as one frame", async () => {
    expect(gifFrames(createPlan("s"))).toEqual([0]);
    const { workers, log } = recording();
    await exportGif(createPlan("s"), workers, new AbortController().signal);
    expect(log).toEqual(["render 0/1", "start 2×1", "write 0 after 0", "finish", "abandon"]);
  });

  it("stops between frames when it's cancelled, and forgets the job", async () => {
    const { workers, log } = recording();
    const controller = new AbortController();
    const error = await exportGif(
      animated([1, 1, 1, 1]),
      workers,
      controller.signal,
      (fraction) => {
        if (fraction === 0.4) controller.abort(new DOMException("stop", "AbortError"));
      },
    ).then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(isImageError(error, "ABORTED")).toBe(true);
    expect(log).toEqual([
      "render 0/4",
      "start 2×1",
      "write 0 after 1",
      "render 1/4",
      "write 1 after 1",
      "abandon",
    ]);
    // Cancelled before it starts: nothing is rendered, and there's no job to forget.
    const before = recording();
    const aborted = new AbortController();
    aborted.abort();
    await expect(exportGif(animated([1]), before.workers, aborted.signal)).rejects.toBeDefined();
    expect(before.log).toEqual([]);
  });

  it("forgets the job when a frame fails, and reports the failure", async () => {
    const { workers, log } = recording({ failAt: 1 });
    await expect(
      exportGif(animated([1, 1, 1]), workers, new AbortController().signal),
    ).rejects.toThrow("render failed");
    expect(log).toEqual(["render 0/3", "start 2×1", "write 0 after 1", "render 1/3", "abandon"]);
  });
});
