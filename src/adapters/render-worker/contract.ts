import type { OUTPUT_LIMITS, PER_FILE_LIMITS } from "../../core/errors/image-limits.js";
import type { ImagePlan } from "../../core/model/plan.js";
import type { ImageProbe, ImageSize } from "../../core/model/source.js";
import type { ImageExportFormat } from "../../core/ports/image-processor.js";

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
   * Probes the file again, requires the page's probe to describe it, checks
   * the per-file limits against its own probe (docs/adr/0004), and decodes
   * it upright into a source with the id (docs/adr/0005).
   */
  readonly register: {
    readonly input: {
      readonly id: string;
      readonly file: Blob;
      readonly probe: ImageProbe;
      /** The maximum of each per-file limit. */
      readonly limits: Readonly<Record<(typeof PER_FILE_LIMITS)[number], number>>;
    };
    readonly output: ImageSize;
  };
  /** A rendering of a source that fits inside `maxSize` × `maxSize`. */
  readonly thumbnail: {
    readonly input: { readonly id: string; readonly maxSize: number };
    readonly output: ImageBitmap;
  };
  /**
   * Renders a plan over a registered source at its output size, encodes it
   * and rewrites its metadata to the kept fields only (docs/adr/0005).
   */
  readonly export: {
    readonly input: {
      readonly plan: ImagePlan;
      readonly format: ImageExportFormat;
      /** The maximum of each output limit. */
      readonly limits: Readonly<Record<(typeof OUTPUT_LIMITS)[number], number>>;
    };
    readonly output: Blob;
  };
  /** Closes a source's bitmap. */
  readonly release: { readonly input: { readonly id: string }; readonly output: undefined };
}
