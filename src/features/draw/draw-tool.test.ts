import { createStore } from "@hussmartinez/sdk-core";
import { describe, expect, it } from "vitest";
import { createPlan, type ImageLayer } from "../../core/model/plan.js";
import { IDLE, type ImageEditorState } from "../editor-state.js";
import type { ImageToolContext, ImageToolState } from "../tool-types.js";
import { DRAW_COLOUR, DRAW_OPACITY, drawTool, drawWidth } from "./draw-tool.js";

const drawing = (key: string, opacity: number): ImageLayer => ({
  key,
  kind: "drawing",
  name: "",
  visible: true,
  opacity,
  x: 0,
  y: 0,
  strokes: [{ colour: "#000000", width: 1, runs: [[0, 0]] }],
});

function context(start: Partial<ImageEditorState> = {}, layers: ImageLayer[] = [], size = 400) {
  const editor = createStore<ImageEditorState>({ ...IDLE, ...start });
  const value = {
    editor,
    session: {
      getSnapshot: () => ({
        plan: { ...createPlan("s"), layers },
        source: { id: "s", width: size, height: size / 2 },
      }),
    },
  } as unknown as ImageToolContext;
  return { value, editor };
}
const state = (editor: Partial<ImageEditorState>, open = true) =>
  ({
    snapshot: { plan: open ? {} : null },
    editor: { ...IDLE, ...editor },
  }) as unknown as ImageToolState;

describe("the draw tool (ADR 0015)", () => {
  it("is enabled with a document, and active while drawing", () => {
    expect(drawTool.isEnabled?.(state({}, false))).toBe(false);
    expect(drawTool.isEnabled?.(state({}))).toBe(true);
    expect(drawTool.isActive?.(state({}))).toBe(false);
    expect(drawTool.isActive?.(state({ tool: "draw" }))).toBe(true);
    expect(drawTool.shortcuts).toEqual(["D"]);
  });

  it("starts with a red pen as wide as a new shape's outline, and takes the stage from the layers", () => {
    const { value, editor } = context({ tool: "layers", layers: { selected: null } });
    void drawTool.run(value);
    expect(editor.getSnapshot()).toEqual({
      ...IDLE,
      tool: "draw",
      draw: { mode: "pen", colour: "#e02020", width: 2, target: null },
    });
    // On a large image the pen is wider: a hundredth of its shorter side.
    expect(drawWidth(context({}, [], 6_000).value, "pen")).toBe(30);
    expect(drawWidth(context({}, [], 6_000).value, "highlighter")).toBe(180);
    expect(DRAW_COLOUR).toEqual({ pen: "#e02020", highlighter: "#f0c020" });
    expect(DRAW_OPACITY).toEqual({ pen: 100, highlighter: 40 });
  });

  it("aims the pen at the drawing the layers had selected, when a pen can add to it", () => {
    const layers = [drawing("opaque", 100), drawing("faint", 40)];
    const aimed = context({ tool: "layers", layers: { selected: "opaque" } }, layers);
    void drawTool.run(aimed.value);
    expect(aimed.editor.getSnapshot().draw?.target).toBe("opaque");
    // A see-through drawing is a highlighter's: the pen starts its own.
    const other = context({ tool: "layers", layers: { selected: "faint" } }, layers);
    void drawTool.run(other.value);
    expect(other.editor.getSnapshot().draw?.target).toBeNull();
  });

  it("ends when run again, leaving no gesture's plan behind", () => {
    const { value, editor } = context();
    void drawTool.run(value);
    editor.set((current) => ({ ...current, preview: {} as never }));
    void drawTool.run(value);
    expect(editor.getSnapshot()).toEqual(IDLE);
  });
});
