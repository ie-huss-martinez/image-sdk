import { SdkError } from "@hussmartinez/sdk-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeEngine } from "../../../test/fakes/fake-engine.js";
import { createFakeProcessor } from "../../../test/fakes/fake-processor.js";
import { fakeEngineHarness } from "../../../test/fakes/harness.js";
import { abortError } from "../errors/error-helpers.js";
import { ImageError } from "../errors/image-error.js";
import { createImageSession, type ImageSessionEvent } from "./session.js";

/** A cooperative adapter: rejects with the port's adapted abort reason. */
function untilAborted(signal?: AbortSignal): Promise<never> {
  if (!signal) throw new Error("missing signal");
  return new Promise((_, reject) => {
    const abort = () => reject(abortError(signal));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}

async function setup(maxProcessingTime = 100) {
  const engine = createFakeEngine();
  const processor = createFakeProcessor(engine);
  const events: ImageSessionEvent[] = [];
  const session = createImageSession({
    engine,
    processor,
    filePolicy: { maxProcessingTime },
    onEvent: (event) => events.push(event),
  });
  const file = await fakeEngineHarness.file({ width: 4, height: 2 });
  await session.open(file);
  // No file I/O in the timed tests: their clocks measure the adapter waits.
  const probe = await engine.probe(file);
  engine.probe = async () => probe;
  vi.useFakeTimers();
  return { engine, processor, session, file, events };
}

afterEach(() => vi.useRealTimers());

describe("session processing deadlines (sdk-core ADR 0020)", () => {
  it.each(["probe", "register", "export"] as const)(
    "aborts a cooperative stalled %s with the policy error, preserving the document",
    async (stage) => {
      const { engine, processor, session, file, events } = await setup();
      const before = session.getSnapshot().plan;
      const caller = new AbortController();
      let received: AbortSignal | undefined;
      const stall = (signal?: AbortSignal) => {
        received = signal;
        return untilAborted(signal);
      };
      if (stage === "probe") engine.probe = (_f, o) => stall(o?.signal);
      if (stage === "register") engine.register = (_id, _f, _p, o) => stall(o?.signal);
      if (stage === "export") processor.export = (_job, o) => stall(o?.signal);
      let outcome: unknown;
      const pending = (
        stage === "export"
          ? session.export({ type: "png" }, { signal: caller.signal })
          : session.open(file, { signal: caller.signal })
      ).catch((error: unknown) => {
        outcome = error;
      });
      try {
        await vi.advanceTimersByTimeAsync(99);
        expect(received?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(outcome).toBeInstanceOf(ImageError);
        expect(outcome).toMatchObject({
          code: "PROCESSING_TIME_EXCEEDED",
          details: { limit: "maxProcessingTime", maximum: 100, actual: 100, unit: "milliseconds" },
        });
        expect(caller.signal.aborted).toBe(false);
        expect(session.getSnapshot()).toMatchObject({
          plan: before,
          opening: false,
          exporting: false,
          error: { code: "PROCESSING_TIME_EXCEEDED" },
        });
        expect(events.at(-1)).toEqual({
          type: stage === "export" ? "export" : "open",
          outcome: "failed",
          commands: [],
        });
        expect(vi.getTimerCount()).toBe(0);
        // Cooperative cancellation leaves the prior source available.
        expect((await engine.thumbnail(before?.base.source ?? "", 4)).width).toBe(4);
      } finally {
        caller.abort();
        await pending;
        await session.destroy();
      }
    },
  );

  it("uses one budget for probing and registering, not a fresh budget per call", async () => {
    const { engine, session, file } = await setup();
    const caller = new AbortController();
    const probe = engine.probe;
    engine.probe = async (f, o) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return probe(f, o);
    };
    engine.register = (_id, _f, _p, o) => untilAborted(o?.signal);
    let outcome: unknown;
    const pending = session.open(file, { signal: caller.signal }).catch((e: unknown) => {
      outcome = e;
    });
    try {
      await vi.advanceTimersByTimeAsync(100);
      expect(outcome).toMatchObject({ code: "PROCESSING_TIME_EXCEEDED" });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      caller.abort();
      await pending;
      await session.destroy();
    }
  });

  it.each(["open", "export"] as const)(
    "preserves caller abort reasons in %s and clears timers",
    async (method) => {
      const { engine, processor, session, file, events } = await setup();
      engine.probe = (_f, o) => untilAborted(o?.signal);
      processor.export = (_j, o) => untilAborted(o?.signal);
      for (const reason of [
        undefined,
        new DOMException("deadline", "TimeoutError"),
        new SdkError("CUSTOM_ABORT", "host", { details: { reason: "host" } }),
      ]) {
        const caller = new AbortController();
        const pending = (
          method === "open"
            ? session.open(file, { signal: caller.signal })
            : session.export({ type: "png" }, { signal: caller.signal })
        ).catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(0);
        caller.abort(reason);
        const error = await pending;
        expect(error).toBeInstanceOf(ImageError);
        if (!(error instanceof ImageError)) throw new Error("not an ImageError");
        expect(error).toMatchObject({
          code: reason instanceof SdkError ? "CUSTOM_ABORT" : reason ? "TIMEOUT" : "ABORTED",
        });
        if (reason instanceof SdkError) expect(error.details).toEqual({ reason: "host" });
        expect(events.at(-1)?.outcome).toBe(reason ? "failed" : "cancelled");
        expect(vi.getTimerCount()).toBe(0);
      }
      await session.destroy();
    },
  );

  it("clears export timers on success and adapter failure, preserving progress and errors", async () => {
    const { processor, session } = await setup();
    const progress = vi.fn();
    const result = await session.export({ type: "png" }, { onProgress: progress });
    expect(result.blob).toBeInstanceOf(Blob);
    expect(progress).toHaveBeenCalledWith(1);
    expect(vi.getTimerCount()).toBe(0);
    const failure = new ImageError("DECODE_FAILED", "adapter failed");
    processor.export = async () => {
      throw failure;
    };
    await expect(session.export({ type: "png" })).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
    await session.destroy();
  });

  it("disables the timer with Infinity and does not preempt an adapter that ignores its signal", async () => {
    const { processor, session } = await setup(Infinity);
    let finish!: (blob: Blob) => void;
    processor.export = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const pending = session.export({ type: "png" });
    await vi.advanceTimersByTimeAsync(1_000_000);
    expect(vi.getTimerCount()).toBe(0);
    finish(new Blob());
    await pending;
    await session.destroy();
  });
});

describe("late and overlapping adapter results", () => {
  it("rejects a late export after signalling the deadline without preempting the adapter", async () => {
    const { processor, session } = await setup();
    let finish!: (blob: Blob) => void;
    let signal: AbortSignal | undefined;
    processor.export = (_job, options) => {
      signal = options?.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    let settled = false;
    const pending = session
      .export({ type: "png" })
      .catch((e: unknown) => e)
      .finally(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(100);
    expect(signal?.aborted).toBe(true);
    expect(settled).toBe(false);
    finish(new Blob());
    expect(await pending).toMatchObject({ code: "PROCESSING_TIME_EXCEEDED" });
    expect(vi.getTimerCount()).toBe(0);
    await session.destroy();
  });

  it("cleans up a registration returned by an adapter after its deadline", async () => {
    const { engine, session, file } = await setup();
    const before = session.getSnapshot().source;
    const register = engine.register;
    let finish!: () => void;
    engine.register = async (id, f, p) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return register(id, f, p);
    };
    const pending = session.open(file).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(100);
    finish();
    expect(await pending).toMatchObject({ code: "PROCESSING_TIME_EXCEEDED" });
    expect([...engine.sources.keys()]).toEqual([before?.id]);
    expect(vi.getTimerCount()).toBe(0);
    await session.destroy();
  });

  it("clears the probe timer after an early error and after a newer open wins", async () => {
    const { engine, session, file } = await setup();
    const probe = engine.probe;
    engine.probe = async () => {
      throw new ImageError("INVALID_IMAGE", "bad header");
    };
    await expect(session.open(file)).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    expect(vi.getTimerCount()).toBe(0);
    engine.probe = probe;
    const register = engine.register;
    let finish!: () => void;
    let first = true;
    engine.register = async (id, f, p, o) => {
      if (first) {
        first = false;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      }
      return register(id, f, p, o);
    };
    const earlier = session.open(file).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    const winner = await session.open(file);
    finish();
    expect(await earlier).toMatchObject({ code: "ABORTED" });
    expect([...engine.sources.keys()]).toEqual([winner.id]);
    expect(vi.getTimerCount()).toBe(0);
    await session.destroy();
  });

  it("clears the timer when an export settles after its session was destroyed", async () => {
    const { processor, session } = await setup();
    let finish!: (blob: Blob) => void;
    processor.export = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const pending = session.export({ type: "png" }).catch((e: unknown) => e);
    await session.destroy();
    finish(new Blob());
    expect(await pending).toMatchObject({ code: "ABORTED" });
    expect(vi.getTimerCount()).toBe(0);
    expect(session.getSnapshot()).toMatchObject({ status: "empty", plan: null });
  });
});

describe("deadlines belonging to a replaced document", () => {
  it.each(["open", "export"] as const)(
    "does not attach an earlier %s deadline error to the new document",
    async (method) => {
      const { engine, processor, session, file } = await setup();
      const probe = engine.probe;
      if (method === "open") engine.probe = (_f, o) => untilAborted(o?.signal);
      else processor.export = (_job, o) => untilAborted(o?.signal);
      const pending = (
        method === "open" ? session.open(file) : session.export({ type: "png" })
      ).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(0);
      engine.probe = probe;
      const latest = await session.open(file);
      await vi.advanceTimersByTimeAsync(100);
      expect(await pending).toMatchObject({ code: "PROCESSING_TIME_EXCEEDED" });
      expect(session.getSnapshot()).toMatchObject({ source: { id: latest.id }, error: null });
      expect(vi.getTimerCount()).toBe(0);
      await session.destroy();
    },
  );
});

describe("deadlines after session destruction", () => {
  it.each(["open", "export"] as const)(
    "settles %s without republishing destroyed state",
    async (method) => {
      const { engine, processor, session, file, events } = await setup();
      engine.probe = (_f, o) => untilAborted(o?.signal);
      processor.export = (_job, o) => untilAborted(o?.signal);
      const pending = (
        method === "open" ? session.open(file) : session.export({ type: "png" })
      ).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(0);
      await session.destroy();
      const destroyed = session.getSnapshot();
      const listener = vi.fn();
      const unsubscribe = session.subscribe(listener);
      await vi.advanceTimersByTimeAsync(100);
      expect(await pending).toMatchObject({ code: "PROCESSING_TIME_EXCEEDED" });
      expect(session.getSnapshot()).toBe(destroyed);
      expect(destroyed).toMatchObject({
        status: "empty",
        plan: null,
        source: null,
        error: null,
        opening: false,
        exporting: false,
      });
      expect(listener).not.toHaveBeenCalled();
      expect(events.at(-1)).toEqual({ type: method, outcome: "failed", commands: [] });
      expect(vi.getTimerCount()).toBe(0);
      unsubscribe();
    },
  );
});
