import { describe, expect, it } from "vitest";
import { type ImageError, isImageError } from "../errors/image-error.js";
import {
  createPlan,
  type ImageArrowLayer,
  type ImageDrawingLayer,
  type ImagePlan,
  type ImageStroke,
} from "../model/plan.js";
import { createImageReducer, type ImageCommand } from "./commands.js";

const reduce = createImageReducer((id) => (id === "s" ? { width: 40, height: 30 } : undefined));
const stroke = (runs: number[][], colour = "#000000"): ImageStroke => ({ colour, width: 2, runs });
const A = stroke([[0, 0, 4, 4]], "#aa0000");
const B = stroke([[1, 1]], "#00bb00");
const C = stroke(
  [
    [2, 0, 2, 9],
    [2, 9, 7, 9],
  ],
  "#0000cc",
);
const drawing: ImageDrawingLayer = {
  key: "d",
  kind: "drawing",
  name: "",
  visible: true,
  opacity: 100,
  x: 5,
  y: 5,
  strokes: [A, B, C],
};
const arrow: ImageArrowLayer = {
  key: "a",
  kind: "arrow",
  name: "",
  visible: true,
  opacity: 100,
  from: { x: 0, y: 0 },
  to: { x: 9, y: 9 },
  colour: "#ff0000",
  width: 3,
};
const plan: ImagePlan = { ...createPlan("s"), layers: [drawing, arrow] };
const strokesOf = (state: ImagePlan) =>
  (state.layers.find((layer) => layer.key === "d") as ImageDrawingLayer).strokes;

/** Why a command is refused. */
function reason(state: ImagePlan, command: unknown): unknown {
  try {
    reduce(state, command as ImageCommand);
  } catch (error) {
    expect(isImageError(error, "INVALID_COMMAND")).toBe(true);
    return (error as ImageError).details?.["reason"];
  }
  throw new Error("expected a refusal");
}

describe("the stroke commands (ADR 0009, docs/adr/0014)", () => {
  it("appends strokes, and undoes it by removing exactly those from the end", () => {
    const D = stroke([[3, 3]]);
    const E = stroke([[4, 4, 5, 5]]);
    const { state, inverse } = reduce(plan, {
      type: "image.addStrokes",
      key: "d",
      strokes: [D, E],
    });
    expect(strokesOf(state)).toEqual([A, B, C, D, E]);
    expect(inverse).toEqual({ type: "image.removeStrokes", key: "d", indexes: [3, 4] });
    expect(reduce(state, inverse).state).toEqual(plan);
    // The other layers are the same objects: nothing else changed.
    expect(state.layers[1]).toBe(plan.layers[1]);
  });

  it("removes strokes by index, in any order, and puts each back where it was", () => {
    const { state, inverse } = reduce(plan, {
      type: "image.removeStrokes",
      key: "d",
      indexes: [2, 0],
    });
    expect(strokesOf(state)).toEqual([B]);
    expect(inverse).toEqual({
      type: "image.restoreStrokes",
      key: "d",
      entries: [
        { at: 0, stroke: A },
        { at: 2, stroke: C },
      ],
    });
    const restored = reduce(state, inverse);
    expect(restored.state).toEqual(plan);
    // And what undoes the restore removes them again.
    expect(restored.inverse).toEqual({ type: "image.removeStrokes", key: "d", indexes: [0, 2] });
  });

  it("keeps a stroke of several runs as one stroke: one index removes all of it", () => {
    const { state } = reduce(plan, { type: "image.removeStrokes", key: "d", indexes: [2] });
    expect(strokesOf(state)).toEqual([A, B]);
  });

  it("refuses what would leave a drawing empty, or name a stroke it doesn't have", () => {
    expect(reason(plan, { type: "image.removeStrokes", key: "d", indexes: [0, 1, 2] })).toBe(
      "empty-drawing",
    );
    expect(reason(plan, { type: "image.removeStrokes", key: "d", indexes: [3] })).toBe(
      "invalid-index",
    );
    expect(reason(plan, { type: "image.removeStrokes", key: "d", indexes: [1, 1] })).toBe(
      "invalid-index",
    );
    expect(reason(plan, { type: "image.removeStrokes", key: "d", indexes: [] })).toBe(
      "malformed-command",
    );
    expect(reason(plan, { type: "image.removeStrokes", key: "d", indexes: [0.5] })).toBe(
      "malformed-command",
    );
  });

  it("refuses strokes for a layer that isn't a drawing, or isn't there", () => {
    expect(reason(plan, { type: "image.addStrokes", key: "a", strokes: [A] })).toBe("wrong-kind");
    expect(reason(plan, { type: "image.removeStrokes", key: "a", indexes: [0] })).toBe(
      "wrong-kind",
    );
    expect(reason(plan, { type: "image.addStrokes", key: "x", strokes: [A] })).toBe(
      "unknown-layer",
    );
    expect(reason(plan, { type: "image.addStrokes", key: 3, strokes: [A] })).toBe(
      "malformed-command",
    );
  });

  it("refuses more strokes than a drawing holds, and a stroke the format doesn't", () => {
    const full: ImagePlan = {
      ...plan,
      layers: [{ ...drawing, strokes: Array.from({ length: 1_024 }, () => B) }, arrow],
    };
    expect(reason(full, { type: "image.addStrokes", key: "d", strokes: [A] })).toBe(
      "too-many-strokes",
    );
    const add = (value: unknown) =>
      reason(plan, { type: "image.addStrokes", key: "d", strokes: [value] });
    expect(add({ ...A, runs: [] })).toBe("malformed-command");
    expect(add({ ...A, runs: [[1]] })).toBe("malformed-command");
    expect(add({ ...A, runs: [[1, 2, 3]] })).toBe("invalid-points");
    expect(add({ ...A, runs: Array.from({ length: 65 }, () => [0, 0]) })).toBe("malformed-command");
    expect(add({ ...A, width: 0 })).toBe("malformed-command");
    expect(add({ ...A, width: 1_025 })).toBe("malformed-command");
    expect(add({ ...A, colour: "#FFF" })).toBe("invalid-colour");
    expect(add({ ...A, pressure: 1 })).toBe("malformed-command");
    // From the drawing's origin, 5: 65,531 is still in the scene, 65,532 isn't.
    expect(add({ ...A, runs: [[65_532, 0]] })).toBe("invalid-points");
    expect(
      strokesOf(
        reduce(plan, {
          type: "image.addStrokes",
          key: "d",
          strokes: [{ ...A, runs: [[65_531, 0]] }],
        }).state,
      ),
    ).toHaveLength(4);
  });

  it("refuses the restore's entries out of order, or past the drawing's end", () => {
    const entries = (...list: { at: number; stroke: ImageStroke }[]) =>
      reason(plan, { type: "image.restoreStrokes", key: "d", entries: list });
    expect(entries({ at: 1, stroke: A }, { at: 1, stroke: B })).toBe("invalid-index");
    expect(entries({ at: 2, stroke: A }, { at: 0, stroke: B })).toBe("invalid-index");
    expect(entries({ at: 4, stroke: A })).toBe("invalid-index");
  });
});

describe("drawings and arrows as layers (ADR 0009, docs/adr/0014)", () => {
  const update = (key: string, props: Record<string, unknown>): ImageCommand => ({
    type: "image.updateLayers",
    updates: [{ key, props }],
  });

  it("moves a drawing by its origin, and never its points", () => {
    const { state, inverse } = reduce(plan, update("d", { x: -3, y: 12 }));
    expect(state.layers[0]).toEqual({ ...drawing, x: -3, y: 12 });
    expect(inverse).toEqual(update("d", { x: 5, y: 5 }));
    // A move that would take a point out of the scene is refused.
    expect(reason(plan, update("d", { x: 65_530 }))).toBe("invalid-points");
  });

  it("sets a drawing's strokes only through the stroke commands", () => {
    expect(reason(plan, update("d", { strokes: [A] }))).toBe("malformed-command");
    // A box's fields, and an arrow's, aren't a drawing's.
    expect(reason(plan, update("d", { width: 4 }))).toBe("wrong-kind");
    expect(reason(plan, update("d", { rotation: 90 }))).toBe("wrong-kind");
    expect(reason(plan, update("d", { from: { x: 0, y: 0 } }))).toBe("wrong-kind");
  });

  it("re-aims an arrow, and refuses one with no direction", () => {
    const { state, inverse } = reduce(plan, update("a", { to: { x: 20, y: 1 }, width: 6 }));
    expect(state.layers[1]).toEqual({ ...arrow, to: { x: 20, y: 1 }, width: 6 });
    expect(inverse).toEqual(update("a", { to: { x: 9, y: 9 }, width: 3 }));
    expect(reason(plan, update("a", { to: { x: 0, y: 0 } }))).toBe("empty-arrow");
    expect(reason(plan, update("a", { from: { x: 9, y: 9 } }))).toBe("empty-arrow");
    // Both ends moved together to the same place they had, swapped: still an arrow.
    expect(
      reduce(plan, update("a", { from: { x: 9, y: 9 }, to: { x: 0, y: 0 } })).state.layers[1],
    ).toMatchObject({ from: { x: 9, y: 9 }, to: { x: 0, y: 0 } });
    expect(reason(plan, update("a", { x: 1 }))).toBe("wrong-kind");
    expect(reason(plan, update("a", { to: { x: 1 } }))).toBe("malformed-command");
    expect(reason(plan, update("a", { to: { x: 65_537, y: 0 } }))).toBe("malformed-command");
  });

  it("refuses a drawing with no strokes and an arrow with a box, when they're inserted", () => {
    const insert = (layer: unknown) =>
      reason(createPlan("s"), { type: "image.insertLayers", at: 0, layers: [layer] });
    expect(insert({ ...drawing, strokes: [] })).toBe("empty-drawing");
    expect(insert({ ...arrow, to: arrow.from })).toBe("empty-arrow");
    expect(insert({ ...arrow, rotation: 0 })).toBe("malformed-command");
    expect(insert({ ...drawing, width: 4 })).toBe("malformed-command");
    const { strokes: _strokes, ...noStrokes } = drawing;
    expect(insert(noStrokes)).toBe("malformed-command");
  });
});
