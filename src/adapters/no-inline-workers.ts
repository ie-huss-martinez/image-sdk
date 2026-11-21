import { SdkError } from "@hussmartinez/sdk-core";

/**
 * What an application's build gets instead of the inlined workers when it
 * sets the `hm-self-hosted` resolve condition (sdk-core ADR 0060):
 * `#hm-image-render-worker` and `#hm-image-job-worker` both map here, so
 * neither worker is bundled. Such a build must pass `assetsUrl`; without it,
 * starting a worker fails here, loudly, rather than with a bare error from
 * the module system.
 *
 * It throws sdk-core's `SdkError`, which the engine and the processor turn
 * into an `ImageError` with the same code, details and message. Importing
 * `ImageError` here would split it into a chunk of its own, which every
 * entry would then load.
 */
function leftOut(): SdkError<"WORKER_START_FAILED"> {
  return new SdkError(
    "WORKER_START_FAILED",
    "This build left the image SDK's inlined workers out, with the hm-self-hosted condition, so assetsUrl is required.",
    { details: { condition: "hm-self-hosted", missing: "assetsUrl" } },
  );
}

/**
 * Stands in for the inlined render worker.
 *
 * @returns Never: it always throws `WORKER_START_FAILED`.
 */
export function createInlineWorker(): Worker {
  throw leftOut();
}

/**
 * Stands in for the inlined job worker.
 *
 * @returns Never: it always throws `WORKER_START_FAILED`.
 */
export function createInlineJobWorker(): Worker {
  throw leftOut();
}
