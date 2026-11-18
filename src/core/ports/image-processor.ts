import type { ImagePlan } from "../model/plan.js";
import type { ImageExportOptions } from "./options.js";

/**
 * The file an export produces (ADR 0001). `quality`, from 0 to 1, applies to
 * the lossy formats; it defaults to 0.92. WebP is encoded only where the
 * browser can, and otherwise rejects with `UNSUPPORTED_FORMAT`. A GIF is
 * written by the SDK's own encoder, every frame of an animated plan and one
 * frame of a still, and carries no metadata (docs/adr/0011).
 *
 * @public
 */
export type ImageExportFormat =
  | { readonly type: "png" }
  | { readonly type: "jpeg"; readonly quality?: number }
  | { readonly type: "webp"; readonly quality?: number }
  | { readonly type: "gif" };

/**
 * Whether a format's files carry the fields the user keeps: PNG and JPEG do,
 * and WebP and GIF carry no metadata at all (ADR 0005, docs/adr/0011).
 *
 * @internal
 */
export function keepsFields(format: ImageExportFormat["type"]): boolean {
  return format === "png" || format === "jpeg";
}

/**
 * One export: a plan over sources registered with the same engine, and the
 * output format. The plan's kept metadata goes into the file, and nothing
 * else does (ADR 0005).
 *
 * @public
 */
export interface ImageExportJob {
  readonly plan: ImagePlan;
  readonly format: ImageExportFormat;
  /**
   * Which frame of an animated plan to export, as an index into the plan's
   * `animation.frames`: 0 when omitted. A still has only frame 0.
   */
  readonly frame?: number;
}

/**
 * The port for exporting: render a plan at its output size and encode it
 * (ADR 0001, ADR 0003, ADR 0008). It renders sources registered with its
 * engine, so the SDK's own adapter shares the engine's render worker; hosts
 * can pass their own to the editor's `processor` prop, and every
 * implementation must pass the processor's contract tests.
 *
 * Failures reject with `ImageError` for cancellation, worker failures and
 * formats the browser can't encode, and `TypeError` for a plan whose source
 * isn't registered.
 *
 * @public
 */
export interface ImageProcessor {
  /**
   * Renders and encodes a plan, and returns the file. It writes only the
   * plan's kept metadata, and never a location, a camera's details,
   * timestamps, a thumbnail or an orientation. An output over `filePolicy`'s
   * `maxImageDimension` or `maxImagePixels` rejects with that limit's code
   * before anything is drawn.
   */
  export(job: ImageExportJob, options?: ImageExportOptions): Promise<Blob>;
  /** Releases the processor. Pending calls reject, and later calls throw. */
  destroy(): Promise<void>;
}
