import { createStore } from "@hussmartinez/sdk-core";
import { describe, expect, it } from "vitest";
import { IDLE, type ImageEditorState } from "../editor-state.js";
import type { ImageToolContext, ImageToolState } from "../tool-types.js";
import { redactTool } from "./redact-tool.js";

const context = (editor = createStore<ImageEditorState>(IDLE)) =>
  ({ editor }) as unknown as ImageToolContext;
const state = (editor: ImageEditorState, open = true) =>
  ({ snapshot: { plan: open ? {} : null }, editor }) as unknown as ImageToolState;

describe("the redact tool (ADR 0010)", () => {
  it("is enabled with a document, and active while redacting", () => {
    expect(redactTool.isEnabled?.(state(IDLE, false))).toBe(false);
    expect(redactTool.isEnabled?.(state(IDLE))).toBe(true);
    expect(redactTool.isActive?.(state(IDLE))).toBe(false);
    expect(redactTool.isActive?.(state({ ...IDLE, tool: "redact" }))).toBe(true);
    expect(redactTool.shortcuts).toEqual(["R"]);
  });

  it("starts with solid black and nothing selected, and takes the stage from cropping", () => {
    const editor = createStore<ImageEditorState>({
      ...IDLE,
      tool: "crop",
      crop: { pending: { x: 0, y: 0, width: 1, height: 1 }, aspect: "free" },
    });
    void redactTool.run(context(editor));
    expect(editor.getSnapshot()).toEqual({
      ...IDLE,
      tool: "redact",
      redact: { selected: null, mode: "solid", colour: "#000000" },
    });
  });

  it("ends when run again, leaving no gesture's plan behind", () => {
    const editor = createStore<ImageEditorState>(IDLE);
    void redactTool.run(context(editor));
    editor.set((current) => ({ ...current, preview: {} as never }));
    void redactTool.run(context(editor));
    expect(editor.getSnapshot()).toEqual(IDLE);
  });
});
