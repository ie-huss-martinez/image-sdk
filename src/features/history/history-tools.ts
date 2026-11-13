import { defineTool } from "@hussmartinez/sdk-core";
import type { ImageTool } from "../tool-types.js";

/** Undoes the last step (docs/adr/0007). */
export const undoTool: ImageTool = /* @__PURE__ */ defineTool({
  id: "image.undo",
  label: "tools.undo",
  icon: "undo",
  group: "history",
  isEnabled: ({ snapshot }) => snapshot.canUndo,
  run: ({ session }) => {
    session.undo();
  },
  shortcuts: "undo",
});

/** Redoes the last undone step. */
export const redoTool: ImageTool = /* @__PURE__ */ defineTool({
  id: "image.redo",
  label: "tools.redo",
  icon: "redo",
  group: "history",
  isEnabled: ({ snapshot }) => snapshot.canRedo,
  run: ({ session }) => {
    session.redo();
  },
  shortcuts: "redo",
});
