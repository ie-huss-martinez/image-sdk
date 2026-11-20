import { type ImageRedaction, MAX_SCENE_COORDINATE, REDACTION_MODES } from "../model/plan.js";
import { allFields, invalid, isRecord, isWhole, onlyFields } from "./checks.js";
import { checkKey, type KeyedListNames } from "./keyed-list.js";

/**
 * The fields of a redaction that `image.updateRedactions` may set: any but
 * its key. Setting `mode` to `pixelate` drops the colour, and setting it to
 * `solid` needs one in the same update.
 *
 * @public
 */
export interface ImageRedactionProps {
  readonly mode?: ImageRedaction["mode"];
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly colour?: string;
}

/** @internal */
export const REDACTION_NAMES: KeyedListNames = { unknown: "unknown-redaction", item: "redaction" };

const MODES: readonly string[] = REDACTION_MODES;
const REGION = ["x", "y", "width", "height"] as const;
const PROPS = ["mode", "x", "y", "width", "height", "colour"];
/** The pattern the schema uses too. */
const COLOUR = /^#[0-9a-f]{6}$/;

/** A colour as `#rrggbb`, in lower case. @internal */
export function checkColour(value: unknown): string {
  if (typeof value !== "string") invalid("malformed-command", "a colour is text");
  if (!COLOUR.test(value)) invalid("invalid-colour", "a colour is #rrggbb, in lower case");
  return value;
}

/** A redaction, with exactly its mode's fields. @internal */
export function checkRedaction(value: unknown): ImageRedaction {
  if (!isRecord<Record<string, unknown>>(value)) {
    invalid("malformed-command", "a redaction is an object");
  }
  const { mode } = value;
  if (typeof mode !== "string") invalid("malformed-command", "a redaction's mode is text");
  if (!MODES.includes(mode)) {
    invalid("unknown-redaction-mode", `a redaction's mode is one of ${REDACTION_MODES.join(", ")}`);
  }
  const solid = mode === "solid";
  allFields(value, ["key", "mode", ...REGION, ...(solid ? ["colour"] : [])], "a redaction");
  const key = checkKey(value["key"]);
  const { x, y, width, height } = value;
  if (![x, y, width, height].every(Number.isInteger)) {
    invalid("malformed-command", "a redaction's region is whole pixels");
  }
  if (
    !isWhole(x, -MAX_SCENE_COORDINATE, MAX_SCENE_COORDINATE) ||
    !isWhole(y, -MAX_SCENE_COORDINATE, MAX_SCENE_COORDINATE) ||
    !isWhole(width, 1, MAX_SCENE_COORDINATE) ||
    !isWhole(height, 1, MAX_SCENE_COORDINATE)
  ) {
    invalid(
      "invalid-region",
      `a redaction's region is at least 1 × 1, within ${MAX_SCENE_COORDINATE} pixels of the scene's origin`,
    );
  }
  return solid
    ? { key, mode: "solid", x, y, width, height, colour: checkColour(value["colour"]) }
    : { key, mode: "pixelate", x, y, width, height };
}

/**
 * Applies an update's fields to a redaction, and gives the fields that undo
 * it: the previous value of each one set, and the colour a change to
 * `pixelate` dropped.
 *
 * @internal
 */
export function patchRedaction(
  item: ImageRedaction,
  props: unknown,
): { readonly item: ImageRedaction; readonly previous: ImageRedactionProps } {
  if (!isRecord<Record<string, unknown>>(props)) {
    invalid("malformed-command", "an update's props are an object");
  }
  onlyFields(props, PROPS, "a redaction's props");
  const merged: Record<string, unknown> = { ...item };
  const previous: Record<string, unknown> = {};
  const before = item as unknown as Readonly<Record<string, unknown>>;
  for (const name of PROPS) {
    if (!Object.hasOwn(props, name)) continue;
    merged[name] = props[name];
    if (Object.hasOwn(before, name)) previous[name] = before[name];
  }
  if (merged["mode"] === "pixelate") {
    if (Object.hasOwn(props, "colour")) {
      invalid("unexpected-colour", "a pixelated redaction has no colour");
    }
    if (item.mode === "solid") previous["colour"] = item.colour;
    delete merged["colour"];
  } else if (merged["mode"] === "solid" && !Object.hasOwn(merged, "colour")) {
    invalid("missing-colour", "a redaction set to solid needs a colour in the same update");
  }
  return { item: checkRedaction(merged), previous: previous as ImageRedactionProps };
}
