// TODO(sdk-core 0.3.0): replace with `createErrorHelpers` from
// `@hussmartinez/sdk-core` (sdk-core ADR 0034) once 0.3.0 passes the
// release-age policy, keeping these exported names.
import { isSdkError } from "@hussmartinez/sdk-core";
import { ImageError } from "./image-error.js";

/**
 * Makes any failure an `ImageError`, as every port promises: an `ImageError`
 * as it is, another `SdkError` with its code, details and message, and
 * anything else as `UNKNOWN`. The original is kept as `cause`.
 *
 * @internal
 */
export function asImageError(reason: unknown, message = "Image processing failed."): ImageError {
  if (reason instanceof ImageError) {
    return reason;
  }
  if (isSdkError(reason)) {
    return new ImageError(reason.code as never, reason.message, {
      ...(reason.details === undefined ? {} : { details: reason.details }),
      cause: reason,
    });
  }
  return new ImageError("UNKNOWN", message, { cause: reason });
}

/**
 * The error an aborted call rejects with (sdk-core ADR 0018, ADR 0020): an
 * `SdkError` reason adapted as by {@link asImageError}, so a file policy's
 * `PROCESSING_TIME_EXCEEDED` keeps its code; `TIMEOUT` for a timeout; and
 * `ABORTED` otherwise. The reason is kept as `cause`.
 *
 * @internal
 */
export function abortError(signal: AbortSignal): ImageError {
  const { reason } = signal;
  if (isSdkError(reason)) {
    return asImageError(reason);
  }
  const timedOut = (reason as { name?: unknown } | undefined)?.name === "TimeoutError";
  return new ImageError(
    timedOut ? "TIMEOUT" : "ABORTED",
    timedOut ? "The operation timed out." : "The operation was cancelled.",
    { cause: reason },
  );
}

/**
 * Throws {@link abortError} if the signal has aborted.
 *
 * @internal
 */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortError(signal);
  }
}
