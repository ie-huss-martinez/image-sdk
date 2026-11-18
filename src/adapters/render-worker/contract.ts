import type { OUTPUT_LIMITS, PER_FILE_LIMITS } from "../../core/errors/image-limits.js";
import type { ImagePlan } from "../../core/model/plan.js";
import type { ImageProbe, ImageSize, ImageSourceTiming } from "../../core/model/source.js";
import type { ImageExportFormat } from "../../core/ports/image-processor.js";
import type { ImageView } from "../../core/ports/image-renderer.js";

/**
 * The render worker's RPC contract (docs/adr/0002), shared by the page and
 * the worker. The worker holds every registered source as an upright
 * `ImageBitmap`, and a GIF registered with all its frames as its bytes and
 * a frame store besides (docs/adr/0011); the page keeps each source's `Blob`.
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
      /** Whether an animated file is held with every frame, or as its first (docs/adr/0011). */
      readonly frames: "first" | "all";
      /** The most pixels the screen of a file held with every frame may have: `maxAnimationPixels`. */
      readonly animationPixels: number;
    };
    readonly output: ImageSize & {
      /** The frames held: 1 for a still. */
      readonly frames: number;
      /** The file's timing, for a source held with all its frames. */
      readonly timing: ImageSourceTiming | null;
      readonly incomplete: boolean;
      /** The bytes the worker holds for it. */
      readonly bytes: number;
    };
    /** The frames checked so far, of those the file lists: for a source held with all its frames. */
    readonly progress: {
      readonly done: number;
      readonly total: number;
      /**
       * Sent once, true: the first frame can be drawn now, under the source's
       * id, while the rest are checked (docs/adr/0011).
       */
      readonly firstFrame?: boolean;
    };
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
      /** Which of the plan's animation's frames: 0 for a still. */
      readonly frame: number;
      /** The maximum of each output limit. */
      readonly limits: Readonly<Record<(typeof OUTPUT_LIMITS)[number], number>>;
    };
    readonly output: Blob;
  };
  /**
   * Renders one frame of a plan at its output size, as for an export, and
   * returns its RGBA pixels, not premultiplied, as a buffer the page
   * transfers on to the job worker (docs/adr/0011). The output is checked
   * against the output limits, and `count` frames of it against
   * `maxDecodedSize`, before anything is drawn.
   */
  readonly frame: {
    readonly input: {
      readonly plan: ImagePlan;
      /** Which of the plan's animation's frames: 0 for a still. */
      readonly frame: number;
      /** How many frames the export writes, for the bound on all of them. */
      readonly count: number;
      readonly limits: Readonly<Record<(typeof OUTPUT_LIMITS)[number] | "maxDecodedSize", number>>;
    };
    readonly output: {
      readonly width: number;
      readonly height: number;
      readonly pixels: ArrayBuffer;
    };
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
      /** Which of the plan's animation's frames: 0 for a still. */
      readonly frame: number;
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
