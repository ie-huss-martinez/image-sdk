import { describe, expect, it, vi } from "vitest";
import { ControlledWorker } from "../../test/fakes/controlled-worker.js";
import { createWorkerLifecycle } from "./worker-lifecycle.js";

const resource = { type: "call", method: "attachCanvas" };

describe("worker transport lifetime (ADR 0008)", () => {
  it("delegates receivers, exact listeners and transfer lists without a forwarding listener", () => {
    const lifecycle = createWorkerLifecycle(vi.fn(), vi.fn());
    const worker = new ControlledWorker();
    const wrapped = lifecycle.wrap(worker);
    const listener = vi.fn();
    wrapped.addEventListener("message", listener);
    expect(worker.listeners.has(listener)).toBe(true);
    const transfers = [new ArrayBuffer(4)];
    wrapped.postMessage(resource, transfers);
    expect(worker.transfers[0]).toBe(transfers);
    wrapped.removeEventListener("message", listener);
    expect(worker.listeners.size).toBe(0);
    wrapped.terminate();
    wrapped.terminate();
    expect(worker.terminated).toBe(1);
  });

  it("one unsubscribe does not remove a second subscription of the same binding", async () => {
    const lifecycle = createWorkerLifecycle(vi.fn(), vi.fn());
    const worker = lifecycle.wrap(new ControlledWorker());
    const listener = vi.fn();
    const remove = lifecycle.subscribe(listener);
    lifecycle.subscribe(listener);
    remove();
    remove();
    worker.postMessage(resource, []);
    worker.terminate();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledOnce();
    expect(lifecycle.getSnapshot()).toBe(true);
    const late = vi.fn();
    const unsubscribe = lifecycle.subscribe(late);
    expect(lifecycle.getSnapshot()).toBe(true);
    expect(late).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("always terminates when notification throws or destroys the owner reentrantly", async () => {
    const lifecycle = createWorkerLifecycle(vi.fn(), vi.fn());
    const raw = new ControlledWorker();
    const worker = lifecycle.wrap(raw);
    lifecycle.subscribe(() => {
      throw new Error("broken binding");
    });
    lifecycle.subscribe(() => lifecycle.destroy());
    const unmounted = vi.fn();
    lifecycle.subscribe(unmounted);
    worker.postMessage(resource, []);
    worker.terminate();
    expect(raw.terminated).toBe(1);
    await Promise.resolve();
    expect(unmounted).not.toHaveBeenCalled();
  });

  it("ignores closure from a previous generation while disposing that old transport", () => {
    const clear = vi.fn();
    const lifecycle = createWorkerLifecycle(clear, vi.fn());
    const first = lifecycle.wrap(new ControlledWorker());
    first.postMessage(resource, []);
    const old = lifecycle.current();
    const second = lifecycle.wrap(new ControlledWorker());
    expect(lifecycle.current()?.number).toBeGreaterThan(old?.number ?? 0);
    first.terminate();
    expect(clear).not.toHaveBeenCalled();
    expect(lifecycle.getSnapshot()).toBe(false);
    second.postMessage(resource, []);
    second.terminate();
    expect(clear).toHaveBeenCalledOnce();
    expect(lifecycle.getSnapshot()).toBe(true);
  });

  it("does not assume a failed resource post proves the generation resource-free", () => {
    const lifecycle = createWorkerLifecycle(vi.fn(), vi.fn());
    const raw = new ControlledWorker();
    raw.onCall = () => {
      throw new DOMException("not cloneable", "DataCloneError");
    };
    const worker = lifecycle.wrap(raw);
    expect(() => worker.postMessage(resource, [])).toThrow();
    worker.terminate();
    expect(lifecycle.getSnapshot()).toBe(true);
  });

  it("is conservatively terminal when the transport closes during submission", () => {
    const lifecycle = createWorkerLifecycle(vi.fn(), vi.fn());
    const raw = new ControlledWorker();
    const worker = lifecycle.wrap(raw);
    raw.onCall = () => {
      worker.terminate();
      throw new Error("transfer interrupted");
    };
    expect(() => worker.postMessage(resource, [])).toThrow();
    expect(lifecycle.getSnapshot()).toBe(true);
    expect(raw.terminated).toBe(1);
  });
});
