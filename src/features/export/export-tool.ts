import { defineTool } from "@hussmartinez/sdk-core";
import type { ImageTool, ImageToolContext, ImageToolState } from "../tool-types.js";

/**
 * Opens the export dialog, which shows a summary before anything is written
 * (docs/adr/0007). No shortcut: export is irreversible, so it's a click.
 *
 * - **While redacting or arranging layers,** it ends the tool first. Nothing
 *   there is unconfirmed: a gesture still running, such as text being typed,
 *   becomes its step as the tool's panel closes, so what's exported is what's
 *   shown.
 * - **While cropping,** it waits, and says why. A crop isn't an edit until
 *   it's applied, and exporting would have to guess between applying and
 *   cancelling it.
 */
export const exportTool: ImageTool = {
  .../* @__PURE__ */ defineTool<ImageToolState, ImageToolContext, undefined>({
    id: "image.export",
    label: "tools.export",
    icon: "export",
    group: "export",
    isEnabled: ({ snapshot, editor }) => snapshot.plan !== null && editor.tool !== "crop",
    run: ({ editor }) =>
      editor.set((state) =>
        state.tool === "crop"
          ? state
          : { ...state, tool: null, redact: null, layers: null, dialog: "export" },
      ),
  }),
  unavailable: ({ snapshot, editor }) =>
    snapshot.plan !== null && editor.tool === "crop" ? "tools.exportWhileCropping" : undefined,
};
