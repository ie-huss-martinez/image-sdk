import { isSdkError, type SdkCoreErrorCode, SdkError } from "@hussmartinez/sdk-core";

/**
 * Error codes of `@hussmartinez/image-sdk`: sdk-core's own codes, such as
 * `ABORTED`, `WORKER_CRASHED` and `FILE_TOO_LARGE`, plus the image SDK's
 * (ADR 0001, ADR 0004). They never change meaning once released.
 *
 * - `INVALID_IMAGE`: the file is malformed, its headers claim more than its
 *   data can carry or less than its decoder would produce, or its decoded
 *   size differs from what its headers declare.
 * - `UNSUPPORTED_FORMAT`: the format isn't recognised, its bound can't be
 *   read, or the browser can't encode the requested export format.
 *   `details.format` names it.
 * - `DECODE_FAILED`: the browser couldn't decode a file the SDK probed,
 *   usually because it lacks the format. `details.format` names it.
 * - `INVALID_COMMAND`: an edit command doesn't apply to the plan, such as a
 *   crop outside its source. `details.reason` says why, as a stable token
 *   (`ImageCommandRejection`).
 * - `INVALID_DOCUMENT`: a plan document, such as a saved project, isn't
 *   valid in its format. `details.reason` says why (`ImageDocumentRejection`).
 *   A document of another format, or a later version, is `UNSUPPORTED_FORMAT`
 *   instead, with `details.reason` `unknown-format` or `unknown-format-version`.
 * - `IMAGE_TOO_LARGE`: an image, a frame, the canvas or the export exceeds
 *   the `maxImagePixels` limit.
 * - `IMAGE_DIMENSION_TOO_LARGE`: a width or height exceeds the
 *   `maxImageDimension` limit.
 * - `TOO_MANY_FRAMES`: an animation exceeds the `maxFrames` limit.
 * - `SESSION_TOO_LARGE`: the decoded images the session holds exceed the
 *   `maxSessionSize` limit.
 * - `TOO_MANY_LAYERS`: the layer plan exceeds the `maxLayers` limit.
 *
 * Limit codes carry `details` with the `limit`, its `maximum`, the `actual`
 * value and the `unit`. Other codes' `details` name the format involved,
 * and a `reason`, never data from the file.
 *
 * @public
 */
export type ImageErrorCode =
  | SdkCoreErrorCode
  | "INVALID_IMAGE"
  | "UNSUPPORTED_FORMAT"
  | "DECODE_FAILED"
  | "INVALID_COMMAND"
  | "INVALID_DOCUMENT"
  | "IMAGE_TOO_LARGE"
  | "IMAGE_DIMENSION_TOO_LARGE"
  | "TOO_MANY_FRAMES"
  | "SESSION_TOO_LARGE"
  | "TOO_MANY_LAYERS";

/**
 * The error `@hussmartinez/image-sdk` throws and rejects with, with a stable
 * `code`, structured `details` and the underlying error as `cause`. Show
 * users the text for its code from {@link imageMessages}, never its
 * `message`, which is for developers and may contain text from the file.
 *
 * @example
 * ```ts
 * try {
 *   await session.open(file);
 * } catch (error) {
 *   if (isImageError(error, "DECODE_FAILED")) {
 *     suggestConvertingToPng();
 *   } else {
 *     show(messages.error(error));
 *   }
 * }
 * ```
 *
 * @public
 */
export class ImageError extends SdkError<ImageErrorCode> {
  /** Always `"ImageError"`, which survives minification and worker boundaries. */
  override readonly name = "ImageError";
}

/**
 * Checks whether a value is an {@link ImageError}, optionally with a given
 * code.
 *
 * Unlike `instanceof`, it recognises errors from another copy of this
 * package or another realm, and errors rebuilt after crossing a worker
 * boundary.
 *
 * @param value - Any thrown value.
 * @param code - When given, the error must also have this code.
 * @public
 */
export function isImageError<Code extends ImageErrorCode = ImageErrorCode>(
  value: unknown,
  code?: Code,
): value is ImageError & { readonly code: Code } {
  return isSdkError(value, code) && value.name === "ImageError";
}
