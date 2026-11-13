import type { Reducer } from "@hussmartinez/sdk-core";
import { ImageError } from "../errors/image-error.js";
import {
  DEVELOP_ADJUSTMENTS,
  FILTER_PRESETS,
  type ImageCrop,
  type ImageDevelop,
  type ImageFilter,
  type ImageOrientation,
  type ImageOutput,
  type ImagePlan,
  isValidCrop,
} from "../model/plan.js";
import {
  type ImageKeepableMetadata,
  type ImageSize,
  MAX_METADATA_LENGTH,
} from "../model/source.js";

/**
 * Sets or removes the base's crop, in whole pixels of the oriented source.
 *
 * @public
 */
export interface SetCropCommand {
  readonly type: "image.setCrop";
  readonly crop: ImageCrop | null;
}

/**
 * Sets the base's rotation and flips.
 *
 * @public
 */
export interface SetOrientationCommand {
  readonly type: "image.setOrientation";
  readonly orientation: ImageOrientation;
}

/**
 * Sets the export's size.
 *
 * @public
 */
export interface SetOutputCommand {
  readonly type: "image.setOutput";
  readonly output: ImageOutput;
}

/**
 * Sets one metadata field to keep on export. An empty value keeps nothing.
 *
 * @public
 */
export interface SetMetadataCommand {
  readonly type: "image.setMetadata";
  readonly field: keyof ImageKeepableMetadata;
  readonly value: string;
}

/**
 * Sets some of the base's develop adjustments; the others keep their values
 * (ADR 0006).
 *
 * @public
 */
export interface SetDevelopCommand {
  readonly type: "image.setDevelop";
  readonly values: Partial<ImageDevelop>;
}

/**
 * Sets the base's filter preset and strength, or removes it with `null`.
 *
 * @public
 */
export interface SetFilterCommand {
  readonly type: "image.setFilter";
  readonly filter: ImageFilter | null;
}

/**
 * Every edit to an {@link ImagePlan}: plain, structured-cloneable data
 * (ADR 0003). Feature pull requests add their own commands to this union.
 *
 * @public
 */
export type ImageCommand =
  | SetCropCommand
  | SetOrientationCommand
  | SetOutputCommand
  | SetMetadataCommand
  | SetDevelopCommand
  | SetFilterCommand;

/**
 * Why a command was refused, as a stable token: `details.reason` on the
 * `INVALID_COMMAND` error (sdk-core ADR 0045).
 *
 * - `malformed-command`: not shaped as the `hm-image-command` schema says,
 *   such as a missing field, a field of the wrong type, an unknown field, or
 *   a crop that isn't whole pixels of at least 1 × 1.
 * - `unknown-command`: a `type` the reducer doesn't know.
 * - `unknown-source`: a crop for a plan whose source isn't registered.
 * - `crop-outside-source`: a crop that doesn't fit inside its source.
 * - `invalid-orientation`: a rotation other than 0, 90, 180 or 270.
 * - `invalid-output`: a scale outside (0, 1], or a box under 1 pixel.
 * - `unknown-metadata-field`: a field other than title, description, artist
 *   and copyright.
 * - `metadata-too-long`: a value over `MAX_METADATA_LENGTH` UTF-16 code units.
 * - `unknown-adjustment`: a develop value that isn't an adjustment.
 * - `invalid-level`: a develop value that isn't a whole number from -100 to 100.
 * - `unknown-preset`: a filter that isn't one of `FILTER_PRESETS`.
 * - `invalid-strength`: a filter strength that isn't a whole number from 0 to 100.
 *
 * @public
 */
export type ImageCommandRejection =
  | "malformed-command"
  | "unknown-command"
  | "unknown-source"
  | "crop-outside-source"
  | "invalid-orientation"
  | "invalid-output"
  | "unknown-metadata-field"
  | "metadata-too-long"
  | "unknown-adjustment"
  | "invalid-level"
  | "unknown-preset"
  | "invalid-strength";

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

/** Requires every field, as the schemas' `required` does. */
function allFields(value: object, fields: readonly string[], what: string): void {
  onlyFields(value, fields, what);
  for (const name of fields) {
    if (!Object.hasOwn(value, name)) invalid("malformed-command", `${what} needs "${name}"`);
  }
}

const isWhole = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number =>
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

/** @internal */
export function checkOrientation(value: unknown): ImageOrientation {
  if (!isRecord<ImageOrientation>(value))
    invalid("malformed-command", "an orientation is an object");
  allFields(value, ["rotate", "flipX", "flipY"], "an orientation");
  const { rotate, flipX, flipY } = value;
  if (typeof flipX !== "boolean" || typeof flipY !== "boolean") {
    invalid("malformed-command", "an orientation's flips are booleans");
  }
  if (![0, 90, 180, 270].includes(rotate)) {
    invalid("invalid-orientation", "a rotation is 0, 90, 180 or 270 degrees");
  }
  return { rotate, flipX, flipY };
}

/** @internal */
export function checkOutput(value: unknown): ImageOutput {
  if (!isRecord<ImageOutput>(value)) invalid("malformed-command", "an output is an object");
  if (value.kind === "scale") {
    allFields(value, ["kind", "scale"], "a scale output");
    if (typeof value.scale !== "number") invalid("malformed-command", "a scale is a number");
    if (!(Number.isFinite(value.scale) && value.scale > 0 && value.scale <= 1)) {
      invalid("invalid-output", "an output scale is more than 0 and at most 1");
    }
    return { kind: "scale", scale: value.scale };
  }
  if (value.kind === "fit") {
    allFields(value, ["kind", "width", "height"], "a box output");
    const { width, height } = value;
    if (!Number.isInteger(width) || !Number.isInteger(height)) {
      invalid("malformed-command", "a box's width and height are whole numbers");
    }
    if (!isWhole(width, 1) || !isWhole(height, 1)) {
      invalid("invalid-output", "an output box is at least 1 × 1 pixel");
    }
    return { kind: "fit", width, height };
  }
  return invalid("malformed-command", "an output is either a scale or a box to fit");
}

const METADATA_FIELDS: readonly (keyof ImageKeepableMetadata)[] = [
  "title",
  "description",
  "artist",
  "copyright",
];

/** @internal */
export function checkMetadataValue(field: string, value: unknown): string {
  if (typeof value !== "string") invalid("malformed-command", `metadata.${field} is text`);
  if (value.length > MAX_METADATA_LENGTH) {
    invalid("metadata-too-long", `metadata.${field} is over ${MAX_METADATA_LENGTH} characters`);
  }
  return value;
}

/** @internal */
export function checkMetadata(value: unknown): ImageKeepableMetadata {
  if (!isRecord<ImageKeepableMetadata>(value))
    invalid("malformed-command", "metadata is an object");
  allFields(value, METADATA_FIELDS, "metadata");
  return Object.fromEntries(
    METADATA_FIELDS.map((field) => [field, checkMetadataValue(field, value[field])]),
  ) as unknown as ImageKeepableMetadata;
}

const ADJUSTMENTS: readonly string[] = DEVELOP_ADJUSTMENTS;
const PRESETS: readonly string[] = FILTER_PRESETS;

/** Develop values: some adjustments, or with `all`, every one. @internal */
export function checkDevelop(value: unknown, all = false): Partial<ImageDevelop> {
  if (!isRecord<Record<string, unknown>>(value)) {
    invalid("malformed-command", "develop values are an object");
  }
  const values: Partial<Record<keyof ImageDevelop, number>> = {};
  for (const [name, level] of Object.entries(value)) {
    if (!ADJUSTMENTS.includes(name)) {
      invalid("unknown-adjustment", `"${name}" isn't a develop adjustment`);
    }
    if (typeof level !== "number") invalid("malformed-command", `${name} is a number`);
    if (!isWhole(level, -100, 100)) {
      invalid("invalid-level", `${name} is a whole number from -100 to 100`);
    }
    values[name as keyof ImageDevelop] = level;
  }
  if (all) allFields(value, ADJUSTMENTS, "develop");
  // In the adjustments' order, whatever the input's.
  return Object.fromEntries(
    DEVELOP_ADJUSTMENTS.filter((name) => name in values).map((name) => [name, values[name]]),
  ) as Partial<ImageDevelop>;
}

/** @internal */
export function checkFilter(value: unknown): ImageFilter | null {
  if (value === null) return null;
  if (!isRecord<ImageFilter>(value)) invalid("malformed-command", "a filter is an object or null");
  allFields(value, ["preset", "strength"], "a filter");
  if (typeof value.preset !== "string") invalid("malformed-command", "a filter's preset is text");
  if (!PRESETS.includes(value.preset)) {
    invalid("unknown-preset", `a filter's preset is one of ${FILTER_PRESETS.join(", ")}`);
  }
  if (typeof value.strength !== "number") {
    invalid("malformed-command", "a filter's strength is a number");
  }
  if (!isWhole(value.strength, 0, 100)) {
    invalid("invalid-strength", "a filter's strength is a whole number from 0 to 100");
  }
  return { preset: value.preset, strength: value.strength };
}

/** Each command's fields, which are all required. */
const COMMAND_FIELDS: Readonly<Record<ImageCommand["type"], readonly string[]>> = {
  "image.setCrop": ["type", "crop"],
  "image.setOrientation": ["type", "orientation"],
  "image.setOutput": ["type", "output"],
  "image.setMetadata": ["type", "field", "value"],
  "image.setDevelop": ["type", "values"],
  "image.setFilter": ["type", "filter"],
};

function apply(
  plan: ImagePlan,
  input: unknown,
  sourceSize: (id: string) => ImageSize | undefined,
): { state: ImagePlan; inverse: ImageCommand } {
  if (!isRecord<{ type: unknown }>(input)) invalid("malformed-command", "a command is an object");
  const { type } = input;
  if (typeof type !== "string") invalid("malformed-command", "a command's type is text");
  if (!Object.hasOwn(COMMAND_FIELDS, type)) {
    invalid("unknown-command", `"${type}" isn't a command`);
  }
  const command = input as ImageCommand;
  allFields(command, COMMAND_FIELDS[command.type], `${command.type}`);
  switch (command.type) {
    case "image.setCrop": {
      const crop = command.crop === null ? null : checkCrop(command.crop);
      if (crop !== null) {
        const size = sourceSize(plan.base.source);
        if (size === undefined) invalid("unknown-source", `unknown source "${plan.base.source}"`);
        checkCropInSource(crop, size);
      }
      return {
        state: { ...plan, base: { ...plan.base, crop } },
        inverse: { type: "image.setCrop", crop: plan.base.crop },
      };
    }
    case "image.setOrientation": {
      const orientation = checkOrientation(command.orientation);
      return {
        state: { ...plan, base: { ...plan.base, orientation } },
        inverse: { type: "image.setOrientation", orientation: plan.base.orientation },
      };
    }
    case "image.setOutput": {
      const output = checkOutput(command.output);
      return {
        state: { ...plan, output },
        inverse: { type: "image.setOutput", output: plan.output },
      };
    }
    case "image.setMetadata": {
      const { field } = command;
      if (typeof field !== "string") invalid("malformed-command", "a metadata field is text");
      if (!(METADATA_FIELDS as readonly string[]).includes(field)) {
        invalid("unknown-metadata-field", "only title, description, artist and copyright are kept");
      }
      const value = checkMetadataValue(field, command.value);
      return {
        state: { ...plan, metadata: { ...plan.metadata, [field]: value } },
        inverse: { type: "image.setMetadata", field, value: plan.metadata[field] },
      };
    }
    case "image.setDevelop": {
      const values = checkDevelop(command.values);
      const previous: Partial<Record<keyof ImageDevelop, number>> = {};
      for (const name of Object.keys(values) as (keyof ImageDevelop)[]) {
        previous[name] = plan.base.develop[name];
      }
      return {
        state: { ...plan, base: { ...plan.base, develop: { ...plan.base.develop, ...values } } },
        inverse: { type: "image.setDevelop", values: previous },
      };
    }
    case "image.setFilter": {
      const filter = checkFilter(command.filter);
      return {
        state: { ...plan, base: { ...plan.base, filter } },
        inverse: { type: "image.setFilter", filter: plan.base.filter },
      };
    }
  }
}

/**
 * Creates the reducer for {@link ImageCommand}s: a pure function that
 * applies one command and returns the command that undoes it (ADR 0003,
 * ADR 0029). It needs the oriented size of each source, to check crops.
 *
 * Commands are strict, as the `hm-image-command` schema is (sdk-core ADR
 * 0045): an invalid command, including one with a field its type doesn't
 * have, throws `ImageError` with `INVALID_COMMAND` and an
 * {@link ImageCommandRejection} as `details.reason`. The reducer never
 * silently corrects one.
 *
 * @public
 */
export function createImageReducer(
  sourceSize: (id: string) => ImageSize | undefined,
): Reducer<ImagePlan, ImageCommand> {
  return (plan, command) => {
    try {
      return apply(plan, command, sourceSize);
    } catch (error) {
      if (!(error instanceof Invalid)) throw error;
      throw new ImageError("INVALID_COMMAND", `Invalid command: ${error.message}.`, {
        details: { reason: error.reason },
      });
    }
  };
}
