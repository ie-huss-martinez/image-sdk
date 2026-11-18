import { type ExposeWorkerOptions, exposeWorker } from "@hussmartinez/sdk-core";
import { createGifWriter, type GifWriter } from "../gif/encode.js";
import type { JobWorkerContract } from "./contract.js";

/**
 * Answers the job worker's contract (docs/adr/0011). It does nothing on
 * import, and loads nothing: the encoder is bundled.
 */
export function exposeJobWorker(options?: ExposeWorkerOptions): void {
  const jobs = new Map<string, GifWriter>();
  const job = (id: string) => {
    const writer = jobs.get(id);
    if (!writer) throw new TypeError(`There's no job with the id "${id}".`);
    return writer;
  };
  exposeWorker<JobWorkerContract>(
    {
      gifStart({ id, width, height, loop }) {
        if (jobs.has(id)) throw new TypeError(`The job id "${id}" is already in use.`);
        jobs.set(id, createGifWriter({ width, height, loop }));
        return undefined;
      },
      gifFrame({ id, pixels, delay }, { signal }) {
        if (signal.aborted) throw signal.reason;
        job(id).frame(new Uint8ClampedArray(pixels), delay);
        return undefined;
      },
      gifFinish({ id }) {
        const bytes = job(id).finish();
        jobs.delete(id);
        return new Blob([bytes], { type: "image/gif" });
      },
      gifAbandon({ id }) {
        jobs.delete(id);
        return undefined;
      },
    },
    // The worker announces the version it was built from, and the page
    // refuses another (sdk-core ADR 0038).
    { ...options, packageVersion: __IMAGE_SDK_VERSION__ },
  );
}
