import {
  type ImageLayer,
  type ImageLayerKind,
  LAYER_ALIGNMENTS,
  LAYER_FONTS,
  LAYER_KINDS,
  LAYER_SHAPES,
  MAX_LAYER_NAME_LENGTH,
  MAX_LAYER_TEXT_LENGTH,
  MAX_SCENE_COORDINATE,
  MAX_STROKE_WIDTH,
} from "../model/plan.js";
import { type ImageSize, longerThan } from "../model/source.js";
import { allFields, checkCrop, checkCropInSource, invalid, isRecord, isWhole } from "./checks.js";
import { checkKey, type KeyedListNames } from "./keyed-list.js";
import { checkColour } from "./redactions.js";

/** @internal */
export const LAYER_NAMES: KeyedListNames = { unknown: "unknown-layer", item: "layer" };

const COMMON = ["key", "kind", "name", "visible", "opacity"] as const;
const BOX = ["x", "y", "width", "height", "rotation", "flipX"] as const;
/** Each kind's own fields, after those every layer has and its box. */
const OWN: Readonly<Record<ImageLayerKind, readonly string[]>> = {
  text: ["text", "font", "bold", "colour", "align"],
  shape: ["shape", "fill", "stroke"],
  image: ["source", "crop"],
};
const KINDS: readonly string[] = LAYER_KINDS;
/** Every field some kind has, for telling another kind's field from an unknown one. */
const ANY_OWN = new Set(Object.values(OWN).flat());

/**
 * The characters text can't hold: the C0 controls other than a line feed,
 * DEL, and the bidirectional embedding, override and isolate controls, which
 * can make text read differently from what's stored. The schema's pattern is
 * the same set.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the controls are what it refuses
export const FORBIDDEN_IN_TEXT = /[\u0000-\u0009\u000B-\u001F\u007F‪-‮⁦-⁩]/u;

/** Text of at most `max` code points, with none of the forbidden characters. */
function checkText(value: unknown, max: number, what: string): string {
  if (typeof value !== "string") invalid("malformed-command", `${what} is text`);
  if (longerThan(value, max)) invalid("text-too-long", `${what} has at most ${max} code points`);
  if (FORBIDDEN_IN_TEXT.test(value)) {
    invalid(
      "invalid-text",
      `${what} can't hold control characters other than a line feed, or bidirectional controls`,
    );
  }
  return value;
}

function checkOneOf<T extends string>(value: unknown, options: readonly T[], what: string): T {
  if (typeof value !== "string" || !(options as readonly string[]).includes(value)) {
    invalid("malformed-command", `${what} is one of ${options.join(", ")}`);
  }
  return value as T;
}

function checkBoolean(value: unknown, what: string): boolean {
  if (typeof value !== "boolean") invalid("malformed-command", `${what} is true or false`);
  return value;
}

/**
 * A layer, with exactly its kind's fields. An image layer's source must be
 * registered, and its crop must fit inside it.
 *
 * @internal
 */
export function checkLayer(
  value: unknown,
  sourceSize: (id: string) => ImageSize | undefined,
): ImageLayer {
  if (!isRecord<Record<string, unknown>>(value)) {
    invalid("malformed-command", "a layer is an object");
  }
  const { kind } = value;
  if (typeof kind !== "string") invalid("malformed-command", "a layer's kind is text");
  if (!KINDS.includes(kind)) {
    invalid("unknown-layer-kind", `a layer's kind is one of ${LAYER_KINDS.join(", ")}`);
  }
  const own = OWN[kind as ImageLayerKind];
  allFields(value, [...COMMON, ...BOX, ...own], `a ${kind} layer`);

  const key = checkKey(value["key"]);
  const name = checkText(value["name"], MAX_LAYER_NAME_LENGTH, "a layer's name");
  const visible = checkBoolean(value["visible"], "a layer's visible");
  const { opacity, x, y, width, height, rotation } = value;
  if (![opacity, x, y, width, height, rotation].every(Number.isInteger)) {
    invalid("malformed-command", "a layer's opacity and box are whole numbers");
  }
  if (!isWhole(opacity, 0, 100)) invalid("invalid-opacity", "a layer's opacity is from 0 to 100");
  if (
    !isWhole(x, -MAX_SCENE_COORDINATE, MAX_SCENE_COORDINATE) ||
    !isWhole(y, -MAX_SCENE_COORDINATE, MAX_SCENE_COORDINATE) ||
    !isWhole(width, 1, MAX_SCENE_COORDINATE) ||
    !isWhole(height, 1, MAX_SCENE_COORDINATE) ||
    !isWhole(rotation, 0, 3_599)
  ) {
    invalid(
      "invalid-box",
      `a layer's box is at least 1 × 1, within ${MAX_SCENE_COORDINATE} pixels of the scene's origin, turned by 0 to 3599 tenths of a degree`,
    );
  }
  const flipX = checkBoolean(value["flipX"], "a layer's flipX");
  const common = { key, name, visible, opacity, x, y, width, height, rotation, flipX };

  if (kind === "text") {
    return {
      ...common,
      kind,
      text: checkText(value["text"], MAX_LAYER_TEXT_LENGTH, "a layer's text"),
      font: checkOneOf(value["font"], LAYER_FONTS, "a layer's font"),
      bold: checkBoolean(value["bold"], "a layer's bold"),
      colour: checkColour(value["colour"]),
      align: checkOneOf(value["align"], LAYER_ALIGNMENTS, "a layer's align"),
    };
  }
  if (kind === "shape") {
    const shape = checkOneOf(value["shape"], LAYER_SHAPES, "a layer's shape");
    const fill = value["fill"] === null ? null : checkColour(value["fill"]);
    let stroke: { colour: string; width: number } | null = null;
    if (value["stroke"] !== null) {
      const given = value["stroke"];
      if (!isRecord<{ colour: unknown; width: unknown }>(given)) {
        invalid("malformed-command", "a stroke is an object or null");
      }
      allFields(given, ["colour", "width"], "a stroke");
      if (!isWhole(given.width, 1, MAX_STROKE_WIDTH)) {
        invalid("malformed-command", `a stroke's width is from 1 to ${MAX_STROKE_WIDTH} pixels`);
      }
      stroke = { colour: checkColour(given.colour), width: given.width };
    }
    if (fill === null && stroke === null) {
      invalid("empty-shape", "a shape has a fill or a stroke");
    }
    return { ...common, kind, shape, fill, stroke };
  }
  const source = value["source"];
  if (typeof source !== "string" || source === "") {
    invalid("malformed-command", "an image layer's source is a source id");
  }
  const size = sourceSize(source);
  if (size === undefined) invalid("unknown-source", `unknown source "${source}"`);
  const crop = value["crop"] === null ? null : checkCrop(value["crop"]);
  if (crop !== null) checkCropInSource(crop, size);
  return { ...common, kind: "image", source, crop };
}

/**
 * Applies an update's fields to a layer, and gives the fields that undo it:
 * the previous value of each one set. Any field of the layer's kind may be
 * set, except its key and its kind.
 *
 * @internal
 */
export function patchLayer(
  item: ImageLayer,
  props: unknown,
  sourceSize: (id: string) => ImageSize | undefined,
): { readonly item: ImageLayer; readonly previous: Readonly<Record<string, unknown>> } {
  if (!isRecord<Record<string, unknown>>(props)) {
    invalid("malformed-command", "an update's props are an object");
  }
  const allowed = new Set<string>([...COMMON.slice(2), ...BOX, ...OWN[item.kind]]);
  const before = item as unknown as Readonly<Record<string, unknown>>;
  const merged: Record<string, unknown> = { ...item };
  const previous: Record<string, unknown> = {};
  for (const name of Object.keys(props)) {
    if (!allowed.has(name)) {
      // Another kind's field is a mistake about the layer; anything else,
      // including its key and kind, isn't a field an update has.
      if (ANY_OWN.has(name)) {
        invalid("wrong-kind", `a ${item.kind} layer has no "${name}"`);
      }
      invalid("malformed-command", `a layer's props have no field "${name}"`);
    }
    merged[name] = props[name];
    previous[name] = before[name];
  }
  return { item: checkLayer(merged, sourceSize), previous };
}
