import type { WorkerLike } from "@hussmartinez/sdk-core";
import { ImageError } from "../core/errors/image-error.js";

export interface WorkerGeneration {
  readonly number: number;
  closed: boolean;
  ownsResources: boolean;
}

/** Resource lifetime above the RPC connection; no original image bytes are retained. */
export function createWorkerLifecycle(
  clearSources: () => void,
  submitted: (id: string, generation: WorkerGeneration) => void,
) {
  let current: WorkerGeneration | undefined;
  let sequence = 0;
  let terminal = false;
  let destroyed = false;
  const listeners = new Set<() => void>();
  const invalidated = () =>
    new ImageError("WORKER_TERMINATED", "Recreate the image engine before reopening the image.", {
      details: { reason: "engine-invalidated" },
    });

  const check = (generation?: WorkerGeneration) => {
    if (destroyed) throw new Error("The image engine has been destroyed.");
    if (terminal || (generation && (generation.closed || generation !== current)))
      throw invalidated();
  };

  return {
    check,
    current: () => current,
    getSnapshot: () => terminal,
    subscribe(listener: () => void) {
      const notify = () => listener();
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    destroy() {
      destroyed = true;
      listeners.clear();
      clearSources();
    },
    wrap(worker: WorkerLike): WorkerLike {
      check();
      const generation: WorkerGeneration = {
        number: ++sequence,
        closed: false,
        ownsResources: false,
      };
      current = generation;
      return {
        postMessage(message, transfer) {
          check(generation);
          const call = message as {
            type?: unknown;
            method?: unknown;
            input?: { id?: unknown };
          } | null;
          // sdk-core invokes this transport only after its ready/version
          // handshake. Waiting API calls have not submitted any resources.
          const resource =
            call?.type === "call" && (call.method === "register" || call.method === "attachCanvas");
          if (resource) generation.ownsResources = true;
          if (
            call?.type === "call" &&
            call.method === "register" &&
            typeof call.input?.id === "string"
          )
            submitted(call.input.id, generation);
          // Once submission begins, a post failure is not proof that no
          // resource was transferred. Keep ownership conservative.
          worker.postMessage(message, transfer);
        },
        addEventListener(type, listener) {
          worker.addEventListener(type, listener);
        },
        removeEventListener(type, listener) {
          worker.removeEventListener(type, listener);
        },
        terminate() {
          if (generation.closed) return;
          generation.closed = true;
          try {
            if (current !== generation) return;
            clearSources();
            if (destroyed || !generation.ownsResources || terminal) return;
            terminal = true;
            const notified = [...listeners];
            // Let sdk-core finish rejecting/clearing pending RPCs before a
            // binding unmounts a dialog and aborts its controllers. The latch
            // and source invalidation above are already synchronous.
            queueMicrotask(() => {
              if (destroyed) return;
              for (const listener of notified) {
                if (!listeners.has(listener)) continue;
                try {
                  listener();
                } catch {
                  /* A binding cannot prevent transport cleanup. */
                }
              }
            });
          } finally {
            worker.terminate();
          }
        },
      };
    },
  };
}

/** The only owned closeable RPC results are preview/thumbnail bitmaps. */
export function closeRejectedResult(value: unknown): void {
  if (value && typeof value === "object" && "close" in value && typeof value.close === "function")
    try {
      value.close();
    } catch {
      /* Cleanup must preserve the invalidation error. */
    }
}
