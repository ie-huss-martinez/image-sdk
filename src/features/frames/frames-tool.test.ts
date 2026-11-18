import { createStore } from "@hussmartinez/sdk-core";
import { describe, expect, it } from "vitest";
import { IDLE, type ImageEditorState } from "../editor-state.js";
import type { ImageToolContext, ImageToolState } from "../tool-types.js";
import { framesTool } from "./frames-tool.js";

const state = (editor: ImageEditorState, plan: unknown) =>
  ({ snapshot: { plan }, editor }) as unknown as ImageToolState;
const context = (editor: ReturnType<typeof createStore<ImageEditorState>>) =>
  ({ editor }) as unknown as ImageToolContext;

describe("the frames tool (docs/adr/0011)", () => {
  it("is there only for an animation, and active while the frames are shown", () => {
    for (const plan of [null, { animation: null }]) {
      expect(framesTool.isAvailable?.(state(IDLE, plan))).toBe(false);
      expect(framesTool.isEnabled?.(state(IDLE, plan))).toBe(false);
    }
    const animated = { animation: { loop: 0, frames: [] } };
    expect(framesTool.isAvailable?.(state(IDLE, animated))).toBe(true);
    expect(framesTool.isEnabled?.(state(IDLE, animated))).toBe(true);
    expect(framesTool.isActive?.(state(IDLE, animated))).toBe(false);
    expect(framesTool.isActive?.(state({ ...IDLE, tool: "frames" }, animated))).toBe(true);
    expect(framesTool.shortcuts).toEqual(["F"]);
  });

  it("takes the stage from another tool, pauses playing on the frame shown, and closes again", () => {
    const editor = createStore<ImageEditorState>({
      ...IDLE,
      tool: "layers",
      layers: { selected: null },
      playback: { frame: 2, playing: true },
    });
    void framesTool.run(context(editor));
    expect(editor.getSnapshot()).toEqual({
      ...IDLE,
      tool: "frames",
      playback: { frame: 2, playing: false },
    });
    void framesTool.run(context(editor));
    expect(editor.getSnapshot()).toEqual({ ...IDLE, playback: { frame: 2, playing: false } });
  });
});
