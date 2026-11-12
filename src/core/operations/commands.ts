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
import type { Reducer } from "./reducer-types.js";

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

const METADATA_FIELDS: ReadonlySet<string> = new Set([
  "title",
  "description",
  "artist",
  "copyright",
]);

function invalid(message: string): ImageError {
  return new ImageError("INVALID_COMMAND", message);
}

function checkOrientation({ rotate, flipX, flipY }: ImageOrientation): void {
  if (
    ![0, 90, 180, 270].includes(rotate) ||
    typeof flipX !== "boolean" ||
    typeof flipY !== "boolean"
  ) {
    throw invalid(
      "An orientation needs a rotation of 0, 90, 180 or 270 degrees and boolean flips.",
    );
  }
}

const ADJUSTMENTS: ReadonlySet<string> = new Set(DEVELOP_ADJUSTMENTS);
const PRESETS: ReadonlySet<string> = new Set(FILTER_PRESETS);
const isLevel = (value: unknown, min: number, max: number) =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

function checkDevelop(values: Partial<ImageDevelop>): void {
  if (typeof values !== "object" || values === null) {
    throw invalid("Develop values must be an object of adjustments.");
  }
  for (const [name, value] of Object.entries(values)) {
    if (!ADJUSTMENTS.has(name)) throw invalid(`"${name}" isn't a develop adjustment.`);
    if (!isLevel(value, -100, 100)) {
      throw invalid(`${name} must be a whole number from -100 to 100.`);
    }
  }
}

function checkFilter(filter: ImageFilter | null): void {
  if (filter === null) return;
  if (typeof filter !== "object" || !PRESETS.has(filter.preset)) {
    throw invalid(`A filter needs one of the presets: ${FILTER_PRESETS.join(", ")}.`);
  }
  if (!isLevel(filter.strength, 0, 100)) {
    throw invalid("A filter's strength must be a whole number from 0 to 100.");
  }
}

function checkOutput(output: ImageOutput): void {
  if (output.kind === "scale") {
    if (!(Number.isFinite(output.scale) && output.scale > 0 && output.scale <= 1)) {
      throw invalid("An output scale must be more than 0 and at most 1.");
    }
    return;
  }
  if (output.kind === "fit") {
    if (
      !(
        Number.isSafeInteger(output.width) &&
        Number.isSafeInteger(output.height) &&
        output.width >= 1 &&
        output.height >= 1
      )
    ) {
      throw invalid("An output box needs a whole width and height of at least 1 pixel.");
    }
    return;
  }
  throw invalid("An output is either a scale or a box to fit.");
}

/**
 * Creates the reducer for {@link ImageCommand}s: a pure function that
 * applies one command and returns the command that undoes it (ADR 0003,
 * ADR 0029). It needs the oriented size of each source, to check crops.
 * An invalid command throws `ImageError` with `INVALID_COMMAND`; the reducer
 * never silently corrects one.
 *
 * @public
 */
export function createImageReducer(
  sourceSize: (id: string) => ImageSize | undefined,
): Reducer<ImagePlan, ImageCommand> {
  return (plan, command) => {
    switch (command.type) {
      case "image.setCrop": {
        if (command.crop !== null) {
          const size = sourceSize(plan.base.source);
          if (size === undefined) {
            throw invalid(`Unknown source "${plan.base.source}".`);
          }
          if (!isValidCrop(command.crop, size)) {
            throw invalid("A crop must be whole pixels, at least 1 × 1, inside its source.");
          }
        }
        return {
          state: { ...plan, base: { ...plan.base, crop: command.crop } },
          inverse: { type: "image.setCrop", crop: plan.base.crop },
        };
      }
      case "image.setOrientation":
        checkOrientation(command.orientation);
        return {
          state: { ...plan, base: { ...plan.base, orientation: command.orientation } },
          inverse: { type: "image.setOrientation", orientation: plan.base.orientation },
        };
      case "image.setOutput":
        checkOutput(command.output);
        return {
          state: { ...plan, output: command.output },
          inverse: { type: "image.setOutput", output: plan.output },
        };
      case "image.setMetadata":
        if (!METADATA_FIELDS.has(command.field)) {
          throw invalid("Only title, description, artist and copyright can be kept.");
        }
        if (typeof command.value !== "string" || command.value.length > MAX_METADATA_LENGTH) {
          throw invalid(
            `A kept metadata value must be text of at most ${MAX_METADATA_LENGTH} characters.`,
          );
        }
        return {
          state: { ...plan, metadata: { ...plan.metadata, [command.field]: command.value } },
          inverse: {
            type: "image.setMetadata",
            field: command.field,
            value: plan.metadata[command.field],
          },
        };
      case "image.setDevelop": {
        checkDevelop(command.values);
        const previous: Partial<Record<keyof ImageDevelop, number>> = {};
        for (const name of Object.keys(command.values) as (keyof ImageDevelop)[]) {
          previous[name] = plan.base.develop[name];
        }
        return {
          state: {
            ...plan,
            base: { ...plan.base, develop: { ...plan.base.develop, ...command.values } },
          },
          inverse: { type: "image.setDevelop", values: previous },
        };
      }
      case "image.setFilter":
        checkFilter(command.filter);
        return {
          state: {
            ...plan,
            base: {
              ...plan.base,
              filter:
                command.filter === null
                  ? null
                  : { preset: command.filter.preset, strength: command.filter.strength },
            },
          },
          inverse: { type: "image.setFilter", filter: plan.base.filter },
        };
      default:
        throw invalid(`Unknown command "${(command as { type?: unknown }).type}".`);
    }
  };
}
