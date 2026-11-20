import { createErrorHelpers } from "@hussmartinez/sdk-core";
import { ImageError } from "./image-error.js";

/**
 * The SDK's error helpers, from sdk-core's `createErrorHelpers` (sdk-core
 * ADR 0034):
 *
 * - `asImageError` makes any failure an `ImageError`, as every port promises:
 *   an `ImageError` as it is, another `SdkError` with its code, details and
 *   message, and anything else as `UNKNOWN`, keeping the original as `cause`;
 * - `abortError` is the error an aborted call rejects with: an `SdkError`
 *   reason adapted, so a file policy's `PROCESSING_TIME_EXCEEDED` keeps its
 *   code, `TIMEOUT` for a timeout, and `ABORTED` otherwise;
 * - `throwIfAborted` throws `abortError` if the signal has aborted.
 *
 * @internal
 */
const helpers = /* @__PURE__ */ createErrorHelpers(ImageError, {
  fallbackCode: "UNKNOWN",
  fallbackMessage: "Image processing failed.",
});

// Functions over the helpers, not a destructuring of them: a destructured
// call at the top level is kept by every bundle that imports this module,
// with the error class it holds, since a bundler can't tell it's free of
// side effects (sdk-core ADR 0056).
export const asImageError: typeof helpers.adapt = (...args) => helpers.adapt(...args);
export const abortError: typeof helpers.abortError = (...args) => helpers.abortError(...args);
export const throwIfAborted: typeof helpers.throwIfAborted = (...args) =>
  helpers.throwIfAborted(...args);
