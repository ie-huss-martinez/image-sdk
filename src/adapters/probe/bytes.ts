import { ImageError } from "../../core/errors/image-error.js";
import type { ImageFormat } from "../../core/model/source.js";
import type { WindowReader } from "./window-reader.js";

/**
 * An `INVALID_IMAGE` error naming the format and what was wrong, never data
 * from the file (ADR 0001).
 *
 * @internal
 */
export function invalid(format: ImageFormat, problem: string): ImageError {
  return new ImageError("INVALID_IMAGE", `Invalid ${format}: ${problem}.`, {
    details: { format, problem },
  });
}

/**
 * Reads exactly `length` bytes at `offset`, or fails with `INVALID_IMAGE`
 * when the file ends first: every size read from a file is checked against
 * the bytes that remain.
 *
 * @internal
 */
export async function exact(
  reader: WindowReader,
  format: ImageFormat,
  offset: number,
  length: number,
  what: string,
): Promise<Uint8Array> {
  if (offset + length > reader.size) {
    throw invalid(format, `${what} ends past the end of the file`);
  }
  return reader.bytes(offset, length);
}

/** @internal */
export function u16be(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

/** @internal */
export function u32be(bytes: Uint8Array, at: number): number {
  return (
    (((bytes[at] ?? 0) << 24) |
      ((bytes[at + 1] ?? 0) << 16) |
      ((bytes[at + 2] ?? 0) << 8) |
      (bytes[at + 3] ?? 0)) >>>
    0
  );
}

/** @internal */
export function ascii(bytes: Uint8Array, at: number, length: number): string {
  let text = "";
  for (let i = at; i < at + length && i < bytes.length; i += 1) {
    text += String.fromCharCode(bytes[i] ?? 0);
  }
  return text;
}

/** @internal */
export function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, i) => bytes[i] === value);
}

/** @internal */
export function u16le(bytes: Uint8Array, at: number): number {
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
}

/** @internal */
export function u24le(bytes: Uint8Array, at: number): number {
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16);
}

/** @internal */
export function u32le(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] ?? 0) |
      ((bytes[at + 1] ?? 0) << 8) |
      ((bytes[at + 2] ?? 0) << 16) |
      ((bytes[at + 3] ?? 0) << 24)) >>>
    0
  );
}

/** @internal */
export function i32le(bytes: Uint8Array, at: number): number {
  return u32le(bytes, at) | 0;
}
