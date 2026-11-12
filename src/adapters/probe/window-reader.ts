// TODO(sdk-core 0.3.0): replace with `createWindowReader` from
// `@hussmartinez/sdk-core` (sdk-core ADR 0037) once a fixed 0.3.0 passes the
// release-age policy. This is a copy of its implementation.

/**
 * Reads a `Blob` through a window, for parsers that walk a file in small
 * steps.
 *
 * @internal
 */
export interface WindowReader {
  readonly size: number;
  /** Up to `length` bytes at `offset`, fewer at the end of the file. A view: don't modify it. */
  bytes(offset: number, length: number): Promise<Uint8Array>;
}

function checkCount(name: string, value: number, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(
      `The ${name} must be an integer of at least ${minimum}, not ${String(value)}.`,
    );
  }
}

/** @internal */
export function createWindowReader(
  file: Blob,
  options: { windowSize?: number } = {},
): WindowReader {
  const windowSize = options.windowSize ?? 1 << 20;
  checkCount("window size", windowSize, 1);
  const size = file.size;
  let start = 0;
  let window = new Uint8Array(0);
  return {
    size,
    async bytes(offset, length) {
      checkCount("offset", offset, 0);
      checkCount("length", length, 0);
      const from = Math.min(offset, size);
      const end = Math.min(size, from + length);
      if (from < start || end > start + window.length) {
        const windowEnd = Math.min(size, from + Math.max(length, windowSize));
        window = new Uint8Array(await file.slice(from, windowEnd).arrayBuffer());
        start = from;
      }
      return window.subarray(from - start, end - start);
    },
  };
}
