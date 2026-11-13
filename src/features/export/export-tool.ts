import { defineTool } from "@hussmartinez/sdk-core";
import type { ImageTool } from "../tool-types.js";

/**
 * Opens the export dialog, which shows a summary before anything is written
 * (docs/adr/0007). No shortcut: export is irreversible, so it's a click.
 * It waits while a crop is being made, which isn't an edit until applied.
 */
export const exportTool: ImageTool = /* @__PURE__ */ defineTool({
  id: "image.export",
  label: "tools.export",
  icon: "export",
  group: "export",
  isEnabled: ({ snapshot, editor }) => snapshot.plan !== null && editor.tool === null,
  run: ({ editor }) => editor.set((state) => ({ ...state, dialog: "export" })),
});
