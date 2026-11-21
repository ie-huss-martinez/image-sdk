import {
  type ImageLayer,
  type ImageLayerKind,
  type ImageScenePoint,
  type ImageStroke,
  LAYER_ALIGNMENTS,
  LAYER_FONTS,
  LAYER_KINDS,
  LAYER_SHAPES,
  MAX_DRAWING_STROKES,
  MAX_LAYER_NAME_LENGTH,
  MAX_LAYER_TEXT_LENGTH,
  MAX_RUN_POINTS,
  MAX_SCENE_COORDINATE,
  MAX_STROKE_RUNS,
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
/** Each kind's fields, after those every layer has: a box and its own, or its own alone. */
const OWN = /* @__PURE__ */ ownFields();
/**
 * Builds {@link OWN}. A function, so the call can be marked free of side
 * effects: a bundle that doesn't use the layer commands drops it (sdk-core
 * ADR 0056).
 */
function ownFields(): Readonly<Record<ImageLayerKind, readonly string[]>> {
  return {
    text: [...BOX, "text", "font", "bold", "colour", "align"],
    shape: [...BOX, "shape", "fill", "stroke"],
    image: [...BOX, "source", "crop"],
    drawing: ["x", "y", "strokes"],
    arrow: ["from", "to", "colour", "width"],
  };
}
/**
 * The fields of a kind that `image.updateLayers` doesn't set: a drawing's
 * strokes change only through the stroke commands, so an undo step holds
 * the strokes it removed and no others (docs/adr/0014).
 */
const NOT_UPDATED: Readonly<Partial<Record<ImageLayerKind, readonly string[]>>> = {
  drawing: ["strokes"],
};
/** The kinds each format version has (ADR 0009): a reader takes no later version's kind. */
const KINDS_BY_VERSION: Readonly<Record<2 | 3, readonly string[]>> = {
  2: ["text", "shape", "image"],
  3: LAYER_KINDS,
};
/** Every field some kind has, for telling another kind's field from an unknown one. */
const ANY_OWN: ReadonlySet<string> = /* @__PURE__ */ anyOwnField(OWN);
/** Builds {@link ANY_OWN}, as a function for the same reason as {@link ownFields}. */
function anyOwnField(own: Readonly<Record<string, readonly string[]>>): ReadonlySet<string> {
  return new Set(Object.values(own).flat());
}

/**
 * The characters text can't hold: the C0 controls other than a line feed,
 * DEL, and the bidirectional embedding, override and isolate controls, which
 * can make text read differently from what's stored. The schema's pattern is
 * the same set.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the controls are what it refuses
export const FORBIDDEN_IN_TEXT = /[\u0000-\u0009\u000B-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u;

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

/** A whole number of scene pixels within the scene's coordinates. */
const isCoordinate = (value: unknown): value is number =>
  isWhole(value, -MAX_SCENE_COORDINATE, MAX_SCENE_COORDINATE);

/** A stroke's or an arrow's width. */
function checkWidth(value: unknown, what: string): number {
  if (!isWhole(value, 1, MAX_STROKE_WIDTH)) {
    invalid("malformed-command", `${what}'s width is from 1 to ${MAX_STROKE_WIDTH} pixels`);
  }
  return value;
}

/**
 * One stroke of a drawing at an origin: its colour, its width, and 1 to 64
 * runs of 1 to 2,000 points, each point within the scene's coordinates once
 * the origin is added (docs/adr/0014).
 *
 * @internal
 */
export function checkStroke(value: unknown, origin: ImageScenePoint): ImageStroke {
  if (!isRecord<{ colour: unknown; width: unknown; runs: unknown }>(value)) {
    invalid("malformed-command", "a stroke is an object");
  }
  allFields(value, ["colour", "width", "runs"], "a stroke");
  const colour = checkColour(value.colour);
  const width = checkWidth(value.width, "a stroke");
  const { runs } = value;
  if (!Array.isArray(runs) || runs.length < 1 || runs.length > MAX_STROKE_RUNS) {
    invalid("malformed-command", `a stroke has 1 to ${MAX_STROKE_RUNS} runs`);
  }
  return {
    colour,
    width,
    runs: runs.map((run: unknown) => {
      if (!Array.isArray(run) || run.length < 2 || run.length > 2 * MAX_RUN_POINTS) {
        invalid("malformed-command", `a run has 1 to ${MAX_RUN_POINTS} points`);
      }
      // From the origin, which may be at one end of the scene, to a point at the other.
      const numbers = run as number[];
      if (
        !numbers.every((value) =>
          isWhole(value, -2 * MAX_SCENE_COORDINATE, 2 * MAX_SCENE_COORDINATE),
        )
      ) {
        invalid("malformed-command", "a run's coordinates are whole numbers of pixels");
      }
      // What a schema can't state: a pair for each point, and each point in the scene.
      if (run.length % 2 !== 0) invalid("invalid-points", "a run has an x and a y for each point");
      for (let i = 0; i < run.length; i += 2) {
        if (
          !isCoordinate(origin.x + (numbers[i] as number)) ||
          !isCoordinate(origin.y + (numbers[i + 1] as number))
        ) {
          invalid(
            "invalid-points",
            `a point is within ${MAX_SCENE_COORDINATE} pixels of the scene's origin`,
          );
        }
      }
      return [...numbers];
    }),
  };
}

/** A list of strokes, each checked at the drawing's origin. */
function checkStrokes(value: unknown, origin: ImageScenePoint): ImageStroke[] {
  if (!Array.isArray(value) || value.length > MAX_DRAWING_STROKES) {
    invalid("malformed-command", `a drawing has at most ${MAX_DRAWING_STROKES} strokes`);
  }
  return value.map((stroke) => checkStroke(stroke, origin));
}

/** A point of the scene. */
function checkPoint(value: unknown, what: string): ImageScenePoint {
  if (!isRecord<{ x: unknown; y: unknown }>(value)) {
    invalid("malformed-command", `${what} is a point`);
  }
  allFields(value, ["x", "y"], what);
  const { x, y } = value;
  // Stated by the schema, as a box's place is.
  if (!isCoordinate(x) || !isCoordinate(y)) {
    invalid(
      "malformed-command",
      `${what} is in whole pixels, within ${MAX_SCENE_COORDINATE} of the scene's origin`,
    );
  }
  return { x, y };
}

/**
 * A layer, with exactly its kind's fields. An image layer's source must be
 * registered, and its crop must fit inside it.
 *
 * @param version - The format version whose kinds are allowed: a version 2
 *   document has no drawing and no arrow (ADR 0009).
 * @internal
 */
export function checkLayer(
  value: unknown,
  sourceSize: (id: string) => ImageSize | undefined,
  version: 2 | 3 = 3,
): ImageLayer {
  if (!isRecord<Record<string, unknown>>(value)) {
    invalid("malformed-command", "a layer is an object");
  }
  const { kind } = value;
  if (typeof kind !== "string") invalid("malformed-command", "a layer's kind is text");
  const kinds = KINDS_BY_VERSION[version];
  if (!kinds.includes(kind)) {
    invalid("unknown-layer-kind", `a layer's kind is one of ${kinds.join(", ")}`);
  }
  const own = OWN[kind as ImageLayerKind];
  allFields(value, [...COMMON, ...own], `a ${kind} layer`);

  const key = checkKey(value["key"]);
  const name = checkText(value["name"], MAX_LAYER_NAME_LENGTH, "a layer's name");
  const visible = checkBoolean(value["visible"], "a layer's visible");
  const { opacity } = value;
  if (!Number.isInteger(opacity)) {
    invalid("malformed-command", "a layer's opacity is a whole number");
  }
  if (!isWhole(opacity, 0, 100)) invalid("invalid-opacity", "a layer's opacity is from 0 to 100");
  const shared = { key, name, visible, opacity };

  if (kind === "drawing") {
    const { x, y } = value;
    if (!isCoordinate(x) || !isCoordinate(y)) {
      invalid(
        "malformed-command",
        `a drawing's origin is in whole pixels, within ${MAX_SCENE_COORDINATE} of the scene's origin`,
      );
    }
    const strokes = checkStrokes(value["strokes"], { x, y });
    if (strokes.length === 0) invalid("empty-drawing", "a drawing has at least one stroke");
    return { ...shared, kind, x, y, strokes };
  }
  if (kind === "arrow") {
    const from = checkPoint(value["from"], "an arrow's from");
    const to = checkPoint(value["to"], "an arrow's to");
    if (from.x === to.x && from.y === to.y) {
      invalid("empty-arrow", "an arrow's ends differ");
    }
    return {
      ...shared,
      kind,
      from,
      to,
      colour: checkColour(value["colour"]),
      width: checkWidth(value["width"], "an arrow"),
    };
  }

  const { x, y, width, height, rotation } = value;
  if (![x, y, width, height, rotation].every(Number.isInteger)) {
    invalid("malformed-command", "a layer's box is in whole numbers");
  }
  if (
    !isCoordinate(x) ||
    !isCoordinate(y) ||
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
  const common = { ...shared, x, y, width, height, rotation, flipX };

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
      stroke = { colour: checkColour(given.colour), width: checkWidth(given.width, "a stroke") };
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
  const notUpdated = NOT_UPDATED[item.kind] ?? [];
  const allowed = new Set<string>(
    [...COMMON.slice(2), ...OWN[item.kind]].filter((name) => !notUpdated.includes(name)),
  );
  const before = item as unknown as Readonly<Record<string, unknown>>;
  const merged: Record<string, unknown> = { ...item };
  const previous: Record<string, unknown> = {};
  for (const name of Object.keys(props)) {
    if (notUpdated.includes(name)) {
      invalid("malformed-command", `a ${item.kind} layer's "${name}" isn't set by an update`);
    }
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
