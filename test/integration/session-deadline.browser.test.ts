import { describe, expect, it, vi } from "vitest";
import { createEngine, engineInternals } from "../../src/adapters/image-engine.js";
import { createImageProcessor } from "../../src/adapters/image-processor.js";
import { createImageSession } from "../../src/core/session/session.js";
import DeadlineWorker from "../browser/fixtures/deadline.worker.js?worker";

function message(worker: Worker, type: string): Promise<void> {
  return new Promise((resolve) => {
    const listener = (event: MessageEvent) => {
      if (event.data?.type !== type) return;
      worker.removeEventListener("message", listener);
      resolve();
    };
    worker.addEventListener("message", listener);
  });
}

describe("session deadlines through the real worker RPC (ADR 0020)", () => {
  it.each([true, false])("cancels an export, cooperative worker: %s", async (cooperative) => {
    const worker = new DeadlineWorker();
    const terminated = vi.spyOn(worker, "terminate");
    const workers = [worker];
    let first = true;
    const engine = createEngine({
      loadWorker: async () => () => {
        if (first) {
          first = false;
          return worker;
        }
        const next = new DeadlineWorker();
        workers.push(next);
        return next;
      },
      version: "deadline-test",
    });
    const processor = createImageProcessor(engine);
    const session = createImageSession({
      engine,
      processor,
      filePolicy: { maxProcessingTime: 100 },
    });
    try {
      // Start and handshake outside the tiny budget: this test measures a
      // running call's deadline, not variable worker compilation time.
      const file = new Blob([cooperative ? "cooperative" : "stalled"]);
      await engine.probe(file);
      await session.open(file);
      const before = session.getSnapshot().plan;
      if (!before) throw new Error("no open plan");
      const started = message(worker, "test-export-started");
      const cancelled = message(worker, "test-cancel-received");
      const pending = session.export({ type: "png" }).catch((e: unknown) => e);
      await started;
      const error = await pending;
      expect(error).toMatchObject({
        code: "PROCESSING_TIME_EXCEEDED",
        details: { limit: "maxProcessingTime", maximum: 100, unit: "milliseconds" },
      });
      await cancelled;
      expect(session.getSnapshot()).toMatchObject({ plan: before, exporting: false });
      expect(terminated).not.toHaveBeenCalled();
      if (cooperative) {
        const result = await session.export({ type: "png" });
        expect(await result.blob.text()).toBe("exported");
        expect(terminated).not.toHaveBeenCalled();
        expect(workers).toHaveLength(1);
      } else {
        // An unrelated port call remains pending when cancellation begins.
        const otherStarted = message(worker, "test-export-started");
        const other = processor
          .export({ plan: before, format: { type: "png" } })
          .catch((e: unknown) => e);
        await otherStarted;
        await new Promise((resolve) => setTimeout(resolve, 30_050));
        expect(workers).toHaveLength(1); // No automatic retry.
        expect(terminated).toHaveBeenCalledOnce();
        expect(await other).toMatchObject({ code: "WORKER_TERMINATED" });
        // Existing recovery gap: the session and engine retain their IDs,
        // but a fresh worker has no sources. Recovery is a separate change.
        expect(engineInternals(engine)?.has(before.base.source)).toBe(true);
        await expect(
          processor.export({ plan: before, format: { type: "png" } }),
        ).rejects.toMatchObject({ code: "UNKNOWN" });
        expect(workers).toHaveLength(2);
        const reopened = await session.open(file);
        expect(reopened.id).not.toBe(before.base.source);
        expect(session.getSnapshot().error).toBeNull();
      }
    } finally {
      await session.destroy();
      await processor.destroy();
      await engine.destroy();
    }
  });
});
