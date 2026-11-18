import JobWorker from "../../workers/job.worker.ts?worker&inline";

/** Starts the inlined job worker, from its own lazy chunk. */
export function createInlineJobWorker(): Worker {
  return new JobWorker({ name: "hm-image-job" });
}
