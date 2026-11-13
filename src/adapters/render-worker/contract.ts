import type { OUTPUT_LIMITS, PER_FILE_LIMITS } from "../../core/errors/image-limits.js";
import type { ImagePlan } from "../../core/model/plan.js";
import type { ImageProbe, ImageSize } from "../../core/model/source.js";
import type { ImageExportFormat } from "../../core/ports/image-processor.js";
import type { ImageView } from "../../core/ports/image-renderer.js";

/**
 * The render worker's RPC contract (docs/adr/0002), shared by the page and
 * the worker. The worker holds every registered source as an upright
 * `ImageBitmap`; the page keeps each source's `Blob`.
 */
export interface RenderWorkerContract {
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
  /** Takes a canvas the page transferred, for the preview (docs/adr/0002). */
  readonly attachCanvas: {
    readonly input: { readonly id: string; readonly canvas: OffscreenCanvas };
    readonly output: undefined;
  };
  /** Draws a plan into an attached canvas for a view; a cancelled render draws nothing. */
  readonly render: {
    readonly input: {
      readonly id: string;
      readonly plan: ImagePlan;
      readonly view: ImageView;
      /** The maximum of each output limit, for the canvas's backing size. */
      readonly limits: Readonly<Record<(typeof OUTPUT_LIMITS)[number], number>>;
    };
    readonly output: undefined;
  };
  /** Forgets an attached canvas. */
  readonly detachCanvas: { readonly input: { readonly id: string }; readonly output: undefined };
  /** A copy of an attached canvas's pixels, for tests: the page can't read a transferred canvas. */
  readonly snapshot: { readonly input: { readonly id: string }; readonly output: ImageBitmap };
  /** Closes a source's bitmap. */
  readonly release: { readonly input: { readonly id: string }; readonly output: undefined };
}
