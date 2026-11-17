import { createStore } from "@hussmartinez/sdk-core";
import { describe, expect, it } from "vitest";
import { IDLE, type ImageEditorState } from "../editor-state.js";
import type { ImageToolContext, ImageToolState } from "../tool-types.js";
import { layersTool } from "./layers-tool.js";

const context = (editor = createStore<ImageEditorState>(IDLE), keys: string[] = []) =>
  ({
    editor,
    session: { getSnapshot: () => ({ plan: { layers: keys.map((key) => ({ key })) } }) },
  }) as unknown as ImageToolContext;
const state = (editor: ImageEditorState, open = true) =>
  ({ snapshot: { plan: open ? {} : null }, editor }) as unknown as ImageToolState;

describe("the layers tool (ADR 0013)", () => {
  it("is enabled with a document, and active while the layers are shown", () => {
    expect(layersTool.isEnabled?.(state(IDLE, false))).toBe(false);
    expect(layersTool.isEnabled?.(state(IDLE))).toBe(true);
    expect(layersTool.isActive?.(state(IDLE))).toBe(false);
    expect(layersTool.isActive?.(state({ ...IDLE, tool: "layers" }))).toBe(true);
    expect(layersTool.shortcuts).toEqual(["L"]);
  });

  it("starts with the top layer selected, and takes the stage from redacting", () => {
    const editor = createStore<ImageEditorState>({
      ...IDLE,
      tool: "redact",
      redact: { selected: null, mode: "solid", colour: "#000000" },
    });
    void layersTool.run(context(editor, ["under", "over"]));
    expect(editor.getSnapshot()).toEqual({
      ...IDLE,
      tool: "layers",
      layers: { selected: "over", focus: "list" },
    });
  });

  it("starts with nothing selected when there are no layers", () => {
    const editor = createStore<ImageEditorState>(IDLE);
    void layersTool.run(context(editor));
    expect(editor.getSnapshot().layers).toEqual({ selected: null, focus: "list" });
  });

  it("ends when run again, leaving no gesture's plan behind", () => {
    const editor = createStore<ImageEditorState>(IDLE);
    void layersTool.run(context(editor, ["only"]));
    editor.set((current) => ({ ...current, preview: {} as never }));
    void layersTool.run(context(editor, ["only"]));
    expect(editor.getSnapshot()).toEqual(IDLE);
  });
});
