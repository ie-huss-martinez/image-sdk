import { isSdkError } from "@hussmartinez/sdk-core";

/**
 * The worker's own reason it couldn't start, when it gave one: sdk-core's
 * client reports a failure to create a worker as its own
 * `WORKER_START_FAILED`, with the worker's error as the cause. The stub of a
 * build that left the inlined workers out (sdk-core ADR 0060) is one, and
 * its details name the condition and the missing `assetsUrl`. Anything else
 * is returned as it is. The caller makes it an `ImageError`.
 */
export function startFailure(error: unknown): unknown {
  const cause = error instanceof Error ? error.cause : undefined;
  return isSdkError(cause, "WORKER_START_FAILED") ? cause : error;
}
