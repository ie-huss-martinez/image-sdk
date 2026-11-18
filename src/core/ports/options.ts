import type { ImageFilePolicy } from "../errors/image-limits.js";

/**
 * Options every port call accepts.
 *
 * @public
 */
export interface ImageCallOptions {
  /**
   * Cancels the call. It then rejects with an `ImageError` whose code is
   * `ABORTED`, `TIMEOUT`, or the code of an `SdkError` given as the abort
   * reason, such as `PROCESSING_TIME_EXCEEDED`.
   */
  readonly signal?: AbortSignal;
}

/**
 * Options for long calls, which report how far they've got.
 *
 * @public
 */
export interface ImageProgressOptions extends ImageCallOptions {
  /**
   * Called with the fraction done, from 0 to 1. It only moves forward, and
   * it's called with 1 before the call resolves.
   */
  readonly onProgress?: (fraction: number) => void;
}

/**
 * Options for registering a source.
 *
 * @public
 */
export interface ImageRegisterOptions extends ImageProgressOptions {
  /**
   * The limits checked against the engine's own probe of the file before
   * anything decodes it: `maxFileSize`, `maxImageDimension`,
   * `maxImagePixels`, `maxFrames` and `maxDecodedSize` (ADR 0004). The
   * defaults of `imageLimits` when omitted. The session checks the same
   * policy first, so this is defence in depth for hosts that use the engine
   * directly.
   */
  readonly filePolicy?: ImageFilePolicy;
  /**
   * Which frames of an animated file the source holds (docs/adr/0011).
   *
   * - `"first"`, the default: its first frame, as a still.
   * - `"all"`: every frame. The engine decodes each once to check it, so
   *   the call takes as long as that; `onProgress` follows it, and the
   *   source's `frames` are those that decoded. A file with one frame is a
   *   still either way. A file whose screen is over `filePolicy`'s
   *   `maxAnimationPixels` rejects with `ANIMATION_TOO_LARGE`: register it
   *   as `"first"` instead, as the session does.
   */
  readonly frames?: "first" | "all";
  /**
   * For a source registered with all its frames: called once its first
   * frame can be drawn, before the rest are checked and before `register`
   * resolves (docs/adr/0011). From then until `register` settles, a renderer
   * of the same engine may draw a still plan of the source, its first frame;
   * nothing else may use it yet. Not called for a still, or by an engine
   * that can't show a source early.
   */
  readonly onFirstFrame?: () => void;
}

/**
 * Options for exporting.
 *
 * @public
 */
export interface ImageExportOptions extends ImageProgressOptions {
  /**
   * The limits the output canvas is checked against before it's allocated:
   * `maxImageDimension` and `maxImagePixels` (ADR 0004). The defaults of
   * `imageLimits` when omitted.
   */
  readonly filePolicy?: ImageFilePolicy;
}
