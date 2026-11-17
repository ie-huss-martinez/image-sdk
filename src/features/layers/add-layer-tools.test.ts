import { createStore } from "@hussmartinez/sdk-core";
import { describe, expect, it, vi } from "vitest";
import { ImageError } from "../../core/errors/image-error.js";
import { createPlan, type ImagePlan } from "../../core/model/plan.js";
import type { ImageCommand } from "../../core/operations/commands.js";
import { IDLE, type ImageEditorState } from "../editor-state.js";
import type { ImageToolContext, ImageToolState } from "../tool-types.js";
import {
  addArrowTool,
  addEllipseTool,
  addImageTool,
  addRectangleTool,
  addTextTool,
} from "./add-layer-tools.js";

function context(start: ImageEditorState = IDLE, refuse?: ImageError) {
  const editor = createStore<ImageEditorState>(start);
  const plan: ImagePlan = createPlan("base");
  const executed: ImageCommand[] = [];
  const chooseLayerImage = vi.fn();
  const value = {
    editor,
    chooseLayerImage,
    session: {
      getSnapshot: () => ({ plan, source: { id: "base", width: 400, height: 200 } }),
      execute: (command: ImageCommand) => {
        if (refuse) throw refuse;
        executed.push(command);
      },
    },
  } as unknown as ImageToolContext;
  return { value, editor, executed, chooseLayerImage };
}
const state = (open: boolean, inserting = false) =>
  ({ snapshot: { plan: open ? {} : null, inserting }, editor: IDLE }) as unknown as ImageToolState;

describe("the tools that add layers (ADR 0013)", () => {
  it("are enabled with a document, and only text has a key", () => {
    for (const tool of [
      addTextTool,
      addRectangleTool,
      addEllipseTool,
      addArrowTool,
      addImageTool,
    ]) {
      expect(tool.isEnabled?.(state(false)), tool.id).toBe(false);
      expect(tool.isEnabled?.(state(true)), tool.id).toBe(true);
      expect(tool.group, tool.id).toBe("add");
    }
    expect(addTextTool.shortcuts).toEqual(["T"]);
    expect(addRectangleTool.shortcuts).toBeUndefined();
    expect(addImageTool.shortcuts).toBeUndefined();
  });

  it("add a layer on top as one command, and show the layers with it selected", () => {
    const { value, editor, executed } = context({
      ...IDLE,
      tool: "redact",
      redact: { selected: null, mode: "solid", colour: "#000000" },
    });
    void addRectangleTool.run(value);
    expect(executed).toHaveLength(1);
    const [command] = executed;
    if (command?.type !== "image.insertLayers") throw new Error("not an insert");
    expect(command.at).toBe(0);
    expect(command.layers).toHaveLength(1);
    expect(command.layers[0]).toMatchObject({ kind: "shape", shape: "rectangle" });
    expect(editor.getSnapshot()).toEqual({
      ...IDLE,
      tool: "layers",
      layers: { selected: command.layers[0]?.key },
    });
    void addEllipseTool.run(value);
    expect(executed[1]).toMatchObject({ layers: [{ shape: "ellipse" }] });
  });

  it("ask the panel to take focus in a new text layer's field", () => {
    const { value, editor, executed } = context();
    void addTextTool.run(value);
    const [command] = executed;
    if (command?.type !== "image.insertLayers") throw new Error("not an insert");
    expect(command.layers[0]).toMatchObject({ kind: "text", text: "" });
    expect(editor.getSnapshot().layers).toEqual({
      selected: command.layers[0]?.key,
      focus: "text",
    });
  });

  it("leave what the session refuses in the editor's state, and change nothing else", () => {
    const refused = new ImageError("TOO_MANY_LAYERS", "Too many layers.");
    const { value, editor } = context(IDLE, refused);
    void addTextTool.run(value);
    expect(editor.getSnapshot()).toEqual({ ...IDLE, error: refused });
  });

  it("clear an earlier failure when a layer is added", () => {
    const { value, editor } = context({ ...IDLE, error: new ImageError("UNKNOWN", "x") });
    void addRectangleTool.run(value);
    expect(editor.getSnapshot().error).toBeNull();
  });

  it("add an arrow across the middle, pointing right, with no key of its own", () => {
    const { value, editor, executed } = context();
    void addArrowTool.run(value);
    const [command] = executed;
    if (command?.type !== "image.insertLayers") throw new Error("not an insert");
    // The middle quarter of 400 × 200, along its middle.
    expect(command.layers[0]).toMatchObject({
      kind: "arrow",
      from: { x: 150, y: 100 },
      to: { x: 250, y: 100 },
      colour: "#e02020",
      width: 2,
      opacity: 100,
    });
    expect(editor.getSnapshot().layers).toEqual({ selected: command.layers[0]?.key });
    expect(addArrowTool.shortcuts).toBeUndefined();
  });

  it("ask for an image to add, and are off while one is being added", () => {
    const { value, chooseLayerImage, executed } = context();
    void addImageTool.run(value);
    expect(chooseLayerImage).toHaveBeenCalledTimes(1);
    expect(executed).toEqual([]);
    expect(addImageTool.isEnabled?.(state(true, true))).toBe(false);
  });
});
