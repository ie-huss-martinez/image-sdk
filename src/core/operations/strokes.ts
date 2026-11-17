import {
  type ImageDrawingLayer,
  type ImagePlan,
  type ImageStroke,
  MAX_DRAWING_STROKES,
} from "../model/plan.js";
import { allFields, invalid, isRecord } from "./checks.js";
import { checkStroke } from "./layers.js";

/** The drawing a stroke command names, and its place among the layers. */
function drawingOf(plan: ImagePlan, key: unknown): { at: number; drawing: ImageDrawingLayer } {
  if (typeof key !== "string") invalid("malformed-command", "a key is text");
  const at = plan.layers.findIndex((layer) => layer.key === key);
  const layer = plan.layers[at];
  if (layer === undefined) invalid("unknown-layer", `no layer has the key "${key}"`);
  if (layer.kind !== "drawing") {
    invalid("wrong-kind", `a ${layer.kind} layer has no strokes`);
  }
  return { at, drawing: layer };
}

/** The plan with a drawing's strokes replaced. */
function withStrokes(plan: ImagePlan, at: number, strokes: readonly ImageStroke[]): ImagePlan {
  return {
    ...plan,
    layers: plan.layers.map((layer, index) =>
      index === at && layer.kind === "drawing" ? { ...layer, strokes } : layer,
    ),
  };
}

/** A list with at least one item. */
function some(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    invalid("malformed-command", `${what} is a list of at least one`);
  }
  return value;
}

/**
 * Appends strokes to a drawing (ADR 0009, docs/adr/0014). What undoes it
 * removes that many from the end.
 *
 * @internal
 */
export function addStrokes(plan: ImagePlan, key: unknown, value: unknown) {
  const { at, drawing } = drawingOf(plan, key);
  const strokes = some(value, "strokes").map((stroke) => checkStroke(stroke, drawing));
  const before = drawing.strokes.length;
  if (before + strokes.length > MAX_DRAWING_STROKES) {
    invalid("too-many-strokes", `a drawing has at most ${MAX_DRAWING_STROKES} strokes`);
  }
  return {
    state: withStrokes(plan, at, [...drawing.strokes, ...strokes]),
    inverse: {
      type: "image.removeStrokes" as const,
      key: drawing.key,
      indexes: strokes.map((_, index) => before + index),
    },
  };
}

/**
 * Removes strokes from a drawing, by index, leaving at least one. What
 * undoes it puts each back at its index.
 *
 * @internal
 */
export function removeStrokes(plan: ImagePlan, key: unknown, value: unknown) {
  const { at, drawing } = drawingOf(plan, key);
  const indexes = some(value, "indexes");
  if (!indexes.every((index) => Number.isSafeInteger(index) && (index as number) >= 0)) {
    invalid("malformed-command", "an index is a whole number from 0");
  }
  const chosen = new Set(indexes as number[]);
  if (chosen.size !== indexes.length) invalid("invalid-index", "an index is listed once");
  for (const index of chosen) {
    if (index >= drawing.strokes.length) {
      invalid("invalid-index", `the drawing has no stroke ${index}`);
    }
  }
  if (chosen.size === drawing.strokes.length) {
    invalid("empty-drawing", "a drawing keeps at least one stroke; remove the layer instead");
  }
  return {
    state: withStrokes(
      plan,
      at,
      drawing.strokes.filter((_, index) => !chosen.has(index)),
    ),
    inverse: {
      type: "image.restoreStrokes" as const,
      key: drawing.key,
      // By rising index, so each goes back where it was.
      entries: [...chosen]
        .sort((a, b) => a - b)
        .map((index) => ({ at: index, stroke: drawing.strokes[index] as ImageStroke })),
    },
  };
}

/**
 * Puts removed strokes back, each at its index, by rising index. It's what
 * undoes {@link removeStrokes}: the reducer applies it, but it isn't part
 * of the portable command format.
 *
 * @internal
 */
export function restoreStrokes(plan: ImagePlan, key: unknown, value: unknown) {
  const { at, drawing } = drawingOf(plan, key);
  const strokes = [...drawing.strokes];
  let last = -1;
  const indexes: number[] = [];
  for (const entry of some(value, "entries")) {
    if (!isRecord<{ at: unknown; stroke: unknown }>(entry)) {
      invalid("malformed-command", "an entry is an object");
    }
    allFields(entry, ["at", "stroke"], "an entry");
    const index = entry.at;
    if (!Number.isSafeInteger(index) || (index as number) < 0) {
      invalid("malformed-command", "an index is a whole number from 0");
    }
    if ((index as number) <= last || (index as number) > strokes.length) {
      invalid("invalid-index", "entries are by rising index, each within the drawing");
    }
    last = index as number;
    strokes.splice(last, 0, checkStroke(entry.stroke, drawing));
    indexes.push(last);
  }
  if (strokes.length > MAX_DRAWING_STROKES) {
    invalid("too-many-strokes", `a drawing has at most ${MAX_DRAWING_STROKES} strokes`);
  }
  return {
    state: withStrokes(plan, at, strokes),
    inverse: { type: "image.removeStrokes" as const, key: drawing.key, indexes },
  };
}
