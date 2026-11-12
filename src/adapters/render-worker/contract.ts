import type { ImageProbe, ImageSize } from "../../core/model/source.js";

/**
 * The render worker's RPC contract (docs/adr/0002), shared by the page and
 * the worker. The worker holds every registered source as an upright
 * `ImageBitmap`; the page keeps each source's `Blob`.
 */
export interface RenderWorkerContract {
  // TODO(sdk-core 0.3.0): drop for `packageVersion` in `exposeWorker` and
  // `createWorkerClient` (sdk-core ADR 0038), which checks it before any call.
  /**
   * The package version the worker was built from. A self-hosted worker
   * copied before an upgrade reports an older one (docs/adr/0002).
   */
  readonly version: { readonly input: undefined; readonly output: string };
  /** Reads a file's headers (docs/adr/0001). */
  readonly probe: { readonly input: { readonly file: Blob }; readonly output: ImageProbe };
  /**
   * Probes the file again, requires the page's probe to describe it, and
   * decodes it upright into a source with the id (docs/adr/0005).
   */
  readonly register: {
    readonly input: { readonly id: string; readonly file: Blob; readonly probe: ImageProbe };
    readonly output: ImageSize;
  };
  /** A rendering of a source that fits inside `maxSize` × `maxSize`. */
  readonly thumbnail: {
    readonly input: { readonly id: string; readonly maxSize: number };
    readonly output: ImageBitmap;
  };
  /** Closes a source's bitmap. */
  readonly release: { readonly input: { readonly id: string }; readonly output: undefined };
}
