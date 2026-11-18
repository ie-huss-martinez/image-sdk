import { defineTool } from "@hussmartinez/sdk-core";
import { NO_TOOL } from "../editor-state.js";
import type { ImageTool, ImageToolState } from "../tool-types.js";

/** Whether the open document is an animation. */
const animated = ({ snapshot }: ImageToolState): boolean => snapshot.plan?.animation != null;

/**
 * Shows and hides an animation's frames (docs/adr/0011): while it's on,
 * the inspector lists them in the order they play, with each frame's delay,
 * and edits them: moves, copies, deletes and reverses them, and sets their
 * delays and how many times the animation repeats. It's on the toolbar only
 * for an animation. Starting it pauses playing, so the frame selected stays
 * the frame shown.
 */
export const framesTool: ImageTool = /* @__PURE__ */ defineTool({
  id: "image.frames",
  label: "tools.frames",
  icon: "frames",
  group: "frames",
  isAvailable: animated,
  isEnabled: animated,
  isActive: ({ editor }) => editor.tool === "frames",
  run: ({ editor }) => {
    editor.set((state) =>
      state.tool === "frames"
        ? { ...state, ...NO_TOOL, preview: null }
        : {
            ...state,
            // One tool has the stage at a time.
            ...NO_TOOL,
            tool: "frames",
            preview: null,
            playback: { ...state.playback, playing: false },
          },
    );
  },
  shortcuts: ["F"],
});
