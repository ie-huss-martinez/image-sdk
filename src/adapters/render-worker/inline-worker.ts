import RenderWorker from "../../workers/render.worker.ts?worker&inline";

/** Starts the inlined render worker, from its own lazy chunk. */
export function createInlineWorker(): Worker {
  return new RenderWorker({ name: "hm-image-render" });
}
