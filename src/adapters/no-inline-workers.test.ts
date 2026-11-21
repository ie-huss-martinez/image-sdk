import { isSdkError } from "@hussmartinez/sdk-core";
import { describe, expect, it, vi } from "vitest";
import { ControlledWorker, workerProbe } from "../../test/fakes/controlled-worker.js";
import { isImageError } from "../core/errors/image-error.js";
import { createPlan } from "../core/model/plan.js";
import { createEngine } from "./image-engine.js";
import { createImageProcessor } from "./image-processor.js";
import { createInlineJobWorker, createInlineWorker } from "./no-inline-workers.js";

// A build with the hm-self-hosted condition gets this module instead of the
// inlined workers (sdk-core ADR 0060).
vi.mock("#hm-image-render-worker", () => import("./no-inline-workers.js"));

const leftOut = (error: unknown) =>
  isImageError(error, "WORKER_START_FAILED") &&
  error.message.includes("hm-self-hosted") &&
  error.message.includes("assetsUrl") &&
  JSON.stringify(error.details) ===
    JSON.stringify({ condition: "hm-self-hosted", missing: "assetsUrl" });

/** The stub's own error, which callers then receive as an `ImageError`. */
const stubbed = (error: unknown) =>
  isSdkError(error, "WORKER_START_FAILED") &&
  error.message.includes("hm-self-hosted") &&
  JSON.stringify(error.details) ===
    JSON.stringify({ condition: "hm-self-hosted", missing: "assetsUrl" });

describe("the stub for a build without the inlined workers (sdk-core ADR 0060)", () => {
  it("refuses to start either worker, naming the condition and the missing assetsUrl", () => {
    const named = expect.toSatisfy(
      stubbed,
      "WORKER_START_FAILED naming hm-self-hosted and assetsUrl",
    );
    expect(() => createInlineWorker()).toThrow(named);
    expect(() => createInlineJobWorker()).toThrow(named);
  });

  it("reaches an engine's caller as an ImageError, when a build needs the inlined render worker", async () => {
    const { createImageEngine } = await import("./image-engine.js");
    const engine = createImageEngine();
    try {
      await expect(engine.probe(new Blob([new Uint8Array(64)]))).rejects.toSatisfy(leftOut);
    } finally {
      await engine.destroy();
    }
  });

  it("reaches a GIF export's caller as an ImageError, when a build needs the inlined job worker", async () => {
    const engine = createEngine({
      version: "test",
      loadWorker: async () => () => {
        const worker = new ControlledWorker();
        worker.onCall = (call) => {
          // The first frame, as the render worker draws it for the encoder.
          const output =
            call["method"] === "frame"
              ? { width: 4, height: 2, pixels: new Uint8ClampedArray(32) }
              : call["method"] === "register"
                ? { width: 4, height: 2 }
                : undefined;
          queueMicrotask(() => worker.reply({ type: "result", id: call["id"], output }));
        };
        return worker;
      },
      loadJobWorker: async () => ({ start: createInlineJobWorker, asset: "inline" }),
    });
    const processor = createImageProcessor(engine);
    try {
      await engine.register("s", new Blob(), workerProbe);
      await expect(
        processor.export({ plan: createPlan("s"), format: { type: "gif" } }),
      ).rejects.toSatisfy(leftOut);
    } finally {
      await processor.destroy();
      await engine.destroy();
    }
  });
});
