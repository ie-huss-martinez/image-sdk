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
  it.each([
    { cooperative: true, collateral: false },
    { cooperative: false, collateral: false },
    { cooperative: false, collateral: true },
  ])(
    "cancels an export, cooperative=$cooperative collateral=$collateral",
    async ({ cooperative, collateral }) => {
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
        const lifecycle = engineInternals(engine);
        if (!lifecycle) throw new Error("no lifecycle");
        const notified = vi.fn();
        const unsubscribe = lifecycle.subscribe(notified);
        const lost = new Promise<void>((resolve) => lifecycle.subscribe(resolve));
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
          let other: Promise<unknown> | undefined;
          if (collateral) {
            const otherStarted = message(worker, "test-export-started");
            other = processor
              .export({ plan: before, format: { type: "png" } })
              .catch((e: unknown) => e);
            await otherStarted;
          }
          await lost; // Actual 30-second cancellation grace, with no artificial timeout changes.
          expect(workers).toHaveLength(1);
          expect(terminated).toHaveBeenCalledOnce();
          expect(notified).toHaveBeenCalledOnce();
          if (other) expect(await other).toMatchObject({ code: "WORKER_TERMINATED" });
          expect(lifecycle.has(before.base.source)).toBe(false);
          expect(lifecycle.getSnapshot()).toBe(true);
          expect(error).toMatchObject({ code: "PROCESSING_TIME_EXCEEDED" });
          expect(session.getSnapshot().error?.code).toBe("PROCESSING_TIME_EXCEEDED");
          await expect(
            processor.export({ plan: before, format: { type: "png" } }),
          ).rejects.toMatchObject({
            code: "WORKER_TERMINATED",
            details: { reason: "engine-invalidated" },
          });
          await expect(session.open(file)).rejects.toMatchObject({
            code: "WORKER_TERMINATED",
            details: { reason: "engine-invalidated" },
          });
          expect(workers).toHaveLength(1);
          const fresh = createEngine({
            version: "deadline-test",
            loadWorker: async () => () => {
              const next = new DeadlineWorker();
              workers.push(next);
              return next;
            },
          });
          const freshProcessor = createImageProcessor(fresh);
          const freshSession = createImageSession({ engine: fresh, processor: freshProcessor });
          try {
            const reopened = await freshSession.open(file);
            expect(engineInternals(fresh)?.has(reopened.id)).toBe(true);
            expect(freshSession.getSnapshot().error).toBeNull();
            expect(workers).toHaveLength(2);
          } finally {
            await freshSession.destroy();
            await freshProcessor.destroy();
            await fresh.destroy();
          }
        }
        unsubscribe();
      } finally {
        await session.destroy();
        await processor.destroy();
        await engine.destroy();
      }
    },
    // Its own limit (sdk-core ADR 0057): each case waits out the worker
    // client's real 30-second cancellation grace, 30.2 s in CI, which leaves
    // too little of the browser tests' 60 s for a busy machine.
    90_000,
  );
});
