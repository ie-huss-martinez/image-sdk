import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlledWorker, workerProbe } from "../../test/fakes/controlled-worker.js";
import { createPlan } from "../core/model/plan.js";
import { fittedView } from "../core/ports/image-renderer.js";
import { createEngine, engineInternals } from "./image-engine.js";
import { createImageProcessor } from "./image-processor.js";
import { createImageRenderer, rendererInternals } from "./image-renderer.js";

function setup(versions: string[] = []) {
  const workers: ControlledWorker[] = [];
  const engine = createEngine({
    version: "test",
    loadWorker: async () => () => {
      const worker = new ControlledWorker(versions[workers.length] ?? "test");
      workers.push(worker);
      return worker;
    },
  });
  return { engine, workers };
}
const invalidated = { code: "WORKER_TERMINATED", details: { reason: "engine-invalidated" } };

describe("terminal source ownership (ADR 0008)", () => {
  it("refuses engine and processor work after a resource-owning worker dies", async () => {
    const { engine, workers } = setup();
    const processor = createImageProcessor(engine);
    try {
      await engine.register("s", new Blob(), workerProbe);
      workers[0]?.crash();
      await expect(engine.probe(new Blob())).rejects.toMatchObject(invalidated);
      await expect(engine.thumbnail("s", 4)).rejects.toMatchObject(invalidated);
      await expect(
        processor.export({ plan: createPlan("s"), format: { type: "png" } }),
      ).rejects.toMatchObject(invalidated);
      expect(workers).toHaveLength(1);
    } finally {
      await processor.destroy();
      await engine.destroy();
    }
  });

  it("retries a registration after handshake failure before transport submission", async () => {
    const { engine, workers } = setup(["wrong", "test"]);
    try {
      await expect(engine.register("s", new Blob(), workerProbe)).rejects.toMatchObject({
        code: "WORKER_START_FAILED",
      });
      expect(workers[0]?.sent).toEqual([]);
      expect((await engine.register("s", new Blob(), workerProbe)).id).toBe("s");
      expect(workers).toHaveLength(2);
    } finally {
      await engine.destroy();
    }
  });
});

afterEach(() => vi.useRealTimers());

describe("invalidation races and ownership", () => {
  it("notifies once with no other RPC pending after an unacknowledged cancellation", async () => {
    const { engine, workers } = setup();
    const processor = createImageProcessor(engine);
    try {
      await engine.register("s", new Blob(), workerProbe);
      const worker = workers[0];
      if (!worker) throw new Error("no worker");
      worker.onCall = () => {};
      const lifecycle = engineInternals(engine);
      if (!lifecycle) throw new Error("no lifecycle");
      const notified = vi.fn();
      const remove = lifecycle.subscribe(notified);
      vi.useFakeTimers();
      const caller = new AbortController();
      const reason = new (await import("../core/errors/image-error.js")).ImageError(
        "PROCESSING_TIME_EXCEEDED",
        "test limit",
      );
      const pending = processor
        .export({ plan: createPlan("s"), format: { type: "png" } }, { signal: caller.signal })
        .catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(0);
      caller.abort(reason);
      expect(await pending).toBe(reason);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(notified).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(notified).toHaveBeenCalledOnce();
      expect(lifecycle.getSnapshot()).toBe(true);
      expect(lifecycle.has("s")).toBe(false);
      expect(worker.terminated).toBe(1);
      expect(worker.listeners.size).toBe(0);
      expect(await pending).toBe(reason);
      remove();
      remove();
    } finally {
      await processor.destroy();
      await engine.destroy();
    }
  });

  it("closes late owned bitmaps and preserves concurrent RPC failures", async () => {
    const { engine, workers } = setup();
    try {
      await engine.register("s", new Blob(), workerProbe);
      const worker = workers[0];
      if (!worker) throw new Error("no worker");
      const close = vi.fn();
      worker.onCall = (call) => {
        if (call["method"] === "thumbnail") {
          worker.reply({ type: "result", id: call["id"], output: { close } });
          worker.crash();
        }
      };
      await expect(engine.thumbnail("s", 4)).rejects.toMatchObject(invalidated);
      expect(close).toHaveBeenCalledOnce();
      expect(engineInternals(engine)?.has("s")).toBe(false);
    } finally {
      await engine.destroy();
    }
  });

  it("does not resurrect concurrent registrations or replace their originating failure", async () => {
    const { engine, workers } = setup();
    try {
      await engine.probe(new Blob());
      const worker = workers[0];
      if (!worker) throw new Error("no worker");
      worker.onCall = () => {};
      const a = engine.register("a", new Blob(), workerProbe).catch((e: unknown) => e);
      const b = engine.register("b", new Blob(), workerProbe).catch((e: unknown) => e);
      await vi.waitFor(() =>
        expect(worker.sent.filter((m) => m["method"] === "register")).toHaveLength(2),
      );
      const first = worker.sent.find((m) => m["method"] === "register");
      worker.reply({ type: "result", id: first?.["id"], output: { width: 4, height: 2 } });
      worker.crash();
      expect(await a).toMatchObject(invalidated);
      expect(await b).toMatchObject({ code: "WORKER_CRASHED" });
      expect(engineInternals(engine)?.has("a")).toBe(false);
      expect(engineInternals(engine)?.has("b")).toBe(false);
      expect(workers).toHaveLength(1);
    } finally {
      await engine.destroy();
    }
  });

  it("treats closure during submission conservatively and isolates subscriber failures", async () => {
    const { engine, workers } = setup();
    try {
      await engine.probe(new Blob());
      const worker = workers[0];
      if (!worker) throw new Error("no worker");
      const lifecycle = engineInternals(engine);
      if (!lifecycle) throw new Error("no lifecycle");
      lifecycle.subscribe(() => {
        throw new Error("broken binding");
      });
      const notified = vi.fn();
      const unsubscribe = lifecycle.subscribe(notified);
      worker.onCall = () => worker.crash();
      await expect(engine.register("s", new Blob(), workerProbe)).rejects.toMatchObject({
        code: "WORKER_CRASHED",
      });
      expect(notified).toHaveBeenCalledOnce();
      expect(worker.terminated).toBe(1);
      worker.crash();
      expect(notified).toHaveBeenCalledOnce();
      expect(lifecycle.getSnapshot()).toBe(true); // Also available to late subscribers.
      unsubscribe();
      unsubscribe();
    } finally {
      await engine.destroy();
    }
  });

  it("intentional destruction and unsubscribe do not publish terminal failure", async () => {
    const { engine, workers } = setup();
    await engine.register("s", new Blob(), workerProbe);
    const lifecycle = engineInternals(engine);
    if (!lifecycle) throw new Error("no lifecycle");
    const notified = vi.fn();
    const remove = lifecycle.subscribe(notified);
    const other = vi.fn();
    lifecycle.subscribe(other);
    remove();
    await engine.destroy();
    await engine.destroy();
    expect(notified).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
    expect(workers[0]?.listeners.size).toBe(0);
    expect(workers[0]?.terminated).toBe(1);
  });

  it("does not transfer a canvas on handshake failure, then permits a fresh attachment", async () => {
    const { engine, workers } = setup(["wrong", "test"]);
    const renderer = createImageRenderer(engine);
    const transfer = vi.fn(() => ({}));
    const canvas = { transferControlToOffscreen: transfer } as unknown as HTMLCanvasElement;
    try {
      await expect(renderer.attach(canvas)).rejects.toMatchObject({ code: "WORKER_START_FAILED" });
      expect(transfer).not.toHaveBeenCalled();
      expect(workers[0]?.sent).toEqual([]);
      await renderer.attach(canvas);
      expect(transfer).toHaveBeenCalledOnce();
      workers[1]?.crash();
      await expect(renderer.render(createPlan("s"), fittedView(4, 2))).rejects.toMatchObject(
        invalidated,
      );
      await expect(rendererInternals(renderer)?.snapshot()).rejects.toMatchObject(invalidated);
    } finally {
      await renderer.destroy();
      await engine.destroy();
    }
    expect(workers).toHaveLength(2);
  });

  it("rejects queued renderer work without dispatch or a stale drawn count", async () => {
    const { engine, workers } = setup();
    const renderer = createImageRenderer(engine);
    try {
      await engine.register("s", new Blob(), workerProbe);
      await renderer.attach({
        transferControlToOffscreen: () => ({}),
      } as unknown as HTMLCanvasElement);
      const worker = workers[0];
      if (!worker) throw new Error("no worker");
      worker.onCall = () => {};
      const first = renderer.render(createPlan("s"), fittedView(4, 2)).catch((e: unknown) => e);
      const second = renderer.render(createPlan("s"), fittedView(4, 2)).catch((e: unknown) => e);
      worker.crash();
      await first;
      expect(await second).toMatchObject(invalidated);
      expect(rendererInternals(renderer)?.drawn()).toBe(0);
      expect(worker.sent.filter((m) => m["method"] === "render")).toHaveLength(0);
    } finally {
      await renderer.destroy();
      await engine.destroy();
    }
  });
});

describe("renderer teardown while attaching", () => {
  it("does not transfer after destruction during setup", async () => {
    const { engine, workers } = setup();
    const renderer = createImageRenderer(engine);
    const transfer = vi.fn(() => ({}));
    const attaching = renderer
      .attach({ transferControlToOffscreen: transfer } as unknown as HTMLCanvasElement)
      .catch((e: unknown) => e);
    await renderer.destroy();
    expect(await attaching).toBeInstanceOf(Error);
    expect(transfer).not.toHaveBeenCalled();
    expect(workers[0]?.sent.some((m) => m["method"] === "attachCanvas")).toBe(false);
    await engine.destroy();
  });

  it("detaches a completed transfer when destruction happened before its acknowledgement", async () => {
    const { engine, workers } = setup();
    const renderer = createImageRenderer(engine);
    try {
      await engine.probe(new Blob());
      const worker = workers[0];
      if (!worker) throw new Error("no worker");
      worker.onCall = (call) => {
        if (call["method"] === "detachCanvas")
          worker.reply({ type: "result", id: call["id"], output: undefined });
      };
      const attaching = renderer
        .attach({ transferControlToOffscreen: () => ({}) } as unknown as HTMLCanvasElement)
        .catch((e: unknown) => e);
      await vi.waitFor(() =>
        expect(worker.sent.some((m) => m["method"] === "attachCanvas")).toBe(true),
      );
      await renderer.destroy();
      const attach = worker.sent.find((m) => m["method"] === "attachCanvas");
      worker.reply({ type: "result", id: attach?.["id"], output: undefined });
      expect(await attaching).toBeInstanceOf(Error);
      expect(worker.sent.filter((m) => m["method"] === "detachCanvas")).toHaveLength(1);
      expect(workers).toHaveLength(1);
    } finally {
      await renderer.destroy();
      await engine.destroy();
    }
  });
});

it("preserves the originating RPC error when a binding aborts during teardown", async () => {
  const { engine, workers } = setup();
  const processor = createImageProcessor(engine);
  try {
    await engine.register("s", new Blob(), workerProbe);
    const worker = workers[0];
    if (!worker) throw new Error("no worker");
    const controller = new AbortController();
    engineInternals(engine)?.subscribe(() => controller.abort());
    worker.onCall = () => worker.crash();
    await expect(
      processor.export(
        { plan: createPlan("s"), format: { type: "png" } },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: "WORKER_CRASHED" });
    expect(controller.signal.aborted).toBe(true);
  } finally {
    await processor.destroy();
    await engine.destroy();
  }
});

it("does not replace an already-rejected render with a later caller abort", async () => {
  const { engine, workers } = setup();
  const renderer = createImageRenderer(engine);
  try {
    await engine.register("s", new Blob(), workerProbe);
    await renderer.attach({
      transferControlToOffscreen: () => ({}),
    } as unknown as HTMLCanvasElement);
    const worker = workers[0];
    if (!worker) throw new Error("no worker");
    const caller = new AbortController();
    worker.onCall = (call) => {
      worker.reply({
        type: "error",
        id: call["id"],
        error: { name: "ImageError", code: "INVALID_IMAGE", message: "render failed" },
      });
      caller.abort();
    };
    await expect(
      renderer.render(createPlan("s"), fittedView(4, 2), { signal: caller.signal }),
    ).rejects.toMatchObject({ code: "INVALID_IMAGE" });
  } finally {
    await renderer.destroy();
    await engine.destroy();
  }
});

it("keeps a pending source reserved until an explicit release is completed", async () => {
  const { engine, workers } = setup();
  try {
    await engine.probe(new Blob());
    const worker = workers[0];
    if (!worker) throw new Error("no worker");
    worker.onCall = (call) => {
      if (call["method"] === "release")
        worker.reply({ type: "result", id: call["id"], output: undefined });
    };
    const pending = engine.register("s", new Blob(), workerProbe).catch((e: unknown) => e);
    await vi.waitFor(() => expect(worker.sent.some((m) => m["method"] === "register")).toBe(true));
    await engine.release("s");
    await expect(engine.register("s", new Blob(), workerProbe)).rejects.toBeInstanceOf(TypeError);
    const register = worker.sent.find((m) => m["method"] === "register");
    worker.reply({ type: "result", id: register?.["id"], output: { width: 4, height: 2 } });
    expect(await pending).toBeInstanceOf(TypeError);
    await vi.waitFor(() =>
      expect(worker.sent.filter((m) => m["method"] === "release")).toHaveLength(1),
    );
    expect(engineInternals(engine)?.has("s")).toBe(false);
    expect(workers).toHaveLength(1);
  } finally {
    await engine.destroy();
  }
});
