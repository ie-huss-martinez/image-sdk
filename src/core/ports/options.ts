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
}
