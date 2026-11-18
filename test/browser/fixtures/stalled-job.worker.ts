// A job worker that never answers a frame, and ignores its cancel: what
// sdk-core's cancel timeout must terminate (docs/adr/0011). It speaks the
// real contract and protocol.
import { exposeWorker } from "@hussmartinez/sdk-core";
import type { JobWorkerContract } from "../../../src/adapters/job-worker/contract.js";

exposeWorker<JobWorkerContract>(
  {
    gifStart: () => undefined,
    gifFrame: () => new Promise<undefined>(() => {}),
    gifFinish: () => new Blob([]),
    gifAbandon: () => undefined,
  },
  { packageVersion: __IMAGE_SDK_VERSION__ },
);
