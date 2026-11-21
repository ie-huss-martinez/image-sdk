// A real worker with deterministic source data and deliberately stalled
// exports. This exercises the production RPC, not browser decoding speed.
import { exposeWorker } from "@hussmartinez/sdk-core";
import type { RenderWorkerContract } from "../../../src/adapters/render-worker/contract.js";
import { EMPTY_KEEPABLE_METADATA, NO_METADATA } from "../../../src/core/model/source.js";

let cooperative = false;
let cancelled = false;
const sources = new Set<string>();
const notify = (type: string) =>
  (globalThis as unknown as { postMessage(value: unknown): void }).postMessage({ type });

exposeWorker<Pick<RenderWorkerContract, "probe" | "register" | "export" | "release">>(
  {
    async probe({ file }) {
      cooperative = (await file.text()) === "cooperative";
      return {
        format: "png",
        stored: { width: 4, height: 2 },
        oriented: { width: 4, height: 2 },
        orientation: 1,
        frames: 1,
        hasAlpha: false,
        decodedPixelBound: 8,
        metadata: NO_METADATA,
        keepable: EMPTY_KEEPABLE_METADATA,
      };
    },
    register: ({ id }) => {
      sources.add(id);
      return { width: 4, height: 2, frames: 1, timing: null, incomplete: false, bytes: 32 };
    },
    export: ({ plan }, { signal }) =>
      new Promise((_resolve, reject) => {
        if (!sources.has(plan.base.source)) {
          reject(new Error("missing source in new worker"));
          return;
        }
        if (cooperative && cancelled) {
          _resolve(new Blob(["exported"]));
          return;
        }
        const onAbort = () => {
          notify("test-cancel-received");
          cancelled = true;
          if (cooperative) reject(signal.reason);
        };
        // A cancel that came first is heard at once, as a listener wouldn't be.
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
        notify("test-export-started");
      }),
    release: ({ id }) => {
      sources.delete(id);
    },
  },
  { packageVersion: "deadline-test" },
);
