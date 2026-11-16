import { SdkError, serializeError } from "@hussmartinez/sdk-core";
import { exposeRenderWorker } from "../../../src/adapters/render-worker/expose.js";

// The actual image handlers and canvas renderer, with a controlled crash
// message so lifecycle tests need neither corrupt files nor uncaught errors.
exposeRenderWorker();
const scope = globalThis as unknown as {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  postMessage(message: unknown): void;
};
let crashExport = false;
scope.addEventListener("message", (event) => {
  if (event.data?.type === "test-crash-next-export") crashExport = true;
  if (event.data?.type === "test-crash" || (crashExport && event.data?.method === "export"))
    scope.postMessage({
      protocol: "hm-rpc",
      version: 1,
      type: "crash",
      error: serializeError(new SdkError("WORKER_CRASHED", "Controlled test crash")),
    });
});
