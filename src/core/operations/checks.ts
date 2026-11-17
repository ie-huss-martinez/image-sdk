/**
 * The checks the reducer and the plan reader share: both refuse exactly what
 * the format's schemas refuse (sdk-core ADR 0045).
 */

import { type ImageCrop, isValidCrop } from "../model/plan.js";
import type { ImageSize } from "../model/source.js";

/**
 * A refusal while checking a command or a document, which the reducer and
 * the plan reader turn into their own codes.
 *
 * @internal
 */
export class Invalid extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.reason = reason;
  }
}

/** @internal */
export function invalid(reason: string, message: string): never {
  throw new Invalid(reason, message);
}

/** Whether a value is a plain object: not `null`, and not a list. @internal */
export const isRecord = <T>(value: unknown): value is T =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Refuses a field the object's type doesn't have, as the schemas do with
 * `additionalProperties: false`, rather than dropping it.
 *
 * @internal
 */
export function onlyFields(value: object, fields: readonly string[], what: string): void {
  for (const name of Object.keys(value)) {
    if (!fields.includes(name)) invalid("malformed-command", `${what} has no field "${name}"`);
  }
}

/** Requires every field, and no other, as the schemas' `required` does. @internal */
export function allFields(value: object, fields: readonly string[], what: string): void {
  onlyFields(value, fields, what);
  for (const name of fields) {
    if (!Object.hasOwn(value, name)) invalid("malformed-command", `${what} needs "${name}"`);
  }
}

/** Whether a value is a whole number in a range. @internal */
export const isWhole = (
  value: unknown,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;

/**
 * A crop's shape: whole pixels from 0, at least 1 × 1. Whether it fits its
 * source depends on the source, which a schema can't see.
 *
 * @internal
 */
export function checkCrop(value: unknown): ImageCrop {
  if (!isRecord<ImageCrop>(value)) invalid("malformed-command", "a crop is an object");
  allFields(value, ["x", "y", "width", "height"], "a crop");
  const { x, y, width, height } = value;
  if (!isWhole(x, 0) || !isWhole(y, 0) || !isWhole(width, 1) || !isWhole(height, 1)) {
    invalid("malformed-command", "a crop is whole pixels from 0, at least 1 × 1");
  }
  return { x, y, width, height };
}

/** @internal */
export function checkCropInSource(crop: ImageCrop, source: ImageSize): void {
  if (!isValidCrop(crop, source)) {
    invalid("crop-outside-source", "a crop must fit inside its source");
  }
}
