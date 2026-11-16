import type { WorkerLike } from "@hussmartinez/sdk-core";
import { EMPTY_KEEPABLE_METADATA, NO_METADATA } from "../../src/core/model/source.js";

export const workerProbe = {
  format: "png" as const,
  stored: { width: 4, height: 2 },
  oriented: { width: 4, height: 2 },
  orientation: 1 as const,
  frames: 1,
  hasAlpha: false,
  decodedPixelBound: 8,
  metadata: NO_METADATA,
  keepable: EMPTY_KEEPABLE_METADATA,
};

/** Deterministic transport around the real sdk-core client; no decoder simulation. */
export class ControlledWorker extends EventTarget implements WorkerLike {
  readonly sent: Array<Record<string, unknown>> = [];
  readonly listeners = new Set<EventListener>();
  readonly transfers: Transferable[][] = [];
  terminated = 0;
  onCall: ((message: Record<string, unknown>) => void) | undefined;

  constructor(version = "test") {
    super();
    queueMicrotask(() => this.reply({ type: "ready", packageVersion: version }));
  }
  override addEventListener(type: string, listener: EventListener): void {
    this.listeners.add(listener);
    super.addEventListener(type, listener);
  }
  override removeEventListener(type: string, listener: EventListener): void {
    this.listeners.delete(listener);
    super.removeEventListener(type, listener);
  }
  postMessage(message: unknown, _transfer: Transferable[]): void {
    this.transfers.push(_transfer);
    const data = message as Record<string, unknown>;
    this.sent.push(data);
    if (data["type"] !== "call") return;
    if (this.onCall) {
      this.onCall(data);
      return;
    }
    const output =
      data["method"] === "probe"
        ? workerProbe
        : data["method"] === "register"
          ? { width: 4, height: 2 }
          : data["method"] === "export"
            ? new Blob(["exported"])
            : undefined;
    queueMicrotask(() => this.reply({ type: "result", id: data["id"], output }));
  }
  terminate(): void {
    this.terminated += 1;
  }
  reply(data: Record<string, unknown>): void {
    this.dispatchEvent(
      new MessageEvent("message", { data: { protocol: "hm-rpc", version: 1, ...data } }),
    );
  }
  crash(): void {
    this.reply({
      type: "crash",
      error: { name: "SdkError", code: "WORKER_CRASHED", message: "test crash" },
    });
  }
}
