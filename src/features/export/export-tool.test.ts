import { createStore } from "@hussmartinez/sdk-core";
import { describe, expect, it } from "vitest";
import { IDLE, type ImageEditorState } from "../editor-state.js";
import type { ImageToolContext, ImageToolState } from "../tool-types.js";
import { exportTool } from "./export-tool.js";

const state = (editor: Partial<ImageEditorState>, open = true) =>
  ({
    snapshot: { plan: open ? {} : null },
    editor: { ...IDLE, ...editor },
  }) as unknown as ImageToolState;
const run = (start: Partial<ImageEditorState>) => {
  const editor = createStore<ImageEditorState>({ ...IDLE, ...start });
  void exportTool.run({ editor } as unknown as ImageToolContext);
  return editor.getSnapshot();
};

describe("the export tool (ADR 0007)", () => {
  it("is enabled with an image, whatever tool is open, except while a crop is unapplied", () => {
    expect(exportTool.isEnabled?.(state({}, false))).toBe(false);
    expect(exportTool.isEnabled?.(state({}))).toBe(true);
    expect(exportTool.isEnabled?.(state({ tool: "redact" }))).toBe(true);
    expect(exportTool.isEnabled?.(state({ tool: "layers" }))).toBe(true);
    expect(exportTool.isEnabled?.(state({ tool: "crop" }))).toBe(false);
  });

  it("says why only while cropping: with no image there's nothing to explain", () => {
    expect(exportTool.unavailable?.(state({ tool: "crop" }))).toBe("tools.exportWhileCropping");
    expect(exportTool.unavailable?.(state({ tool: "crop" }, false))).toBeUndefined();
    expect(exportTool.unavailable?.(state({}))).toBeUndefined();
    expect(exportTool.unavailable?.(state({}, false))).toBeUndefined();
    expect(exportTool.unavailable?.(state({ tool: "layers" }))).toBeUndefined();
  });

  it("ends redacting and the layers as it opens the dialog", () => {
    expect(
      run({ tool: "redact", redact: { selected: "r", mode: "solid", colour: "#000000" } }),
    ).toEqual({ ...IDLE, dialog: "export" });
    expect(run({ tool: "layers", layers: { selected: "a" } })).toEqual({
      ...IDLE,
      dialog: "export",
    });
    expect(run({})).toEqual({ ...IDLE, dialog: "export" });
  });

  it("keeps a gesture's plan for the tool's own parts to end: it isn't dropped here", () => {
    const preview = {} as never;
    expect(run({ tool: "layers", layers: { selected: "a" }, preview }).preview).toBe(preview);
  });

  it("changes nothing while cropping, even if it's run", () => {
    const crop = { pending: { x: 0, y: 0, width: 1, height: 1 }, aspect: "free" } as const;
    expect(run({ tool: "crop", crop })).toEqual({ ...IDLE, tool: "crop", crop });
  });
});
