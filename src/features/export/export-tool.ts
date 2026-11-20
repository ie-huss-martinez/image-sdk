import { defineTool } from "@hussmartinez/sdk-core";
import { NO_TOOL } from "../editor-state.js";
import {
  type ImageTool,
  type ImageToolContext,
  type ImageToolState,
  withReason,
} from "../tool-types.js";

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
export const exportTool: ImageTool = /* @__PURE__ */ withReason(
  /* @__PURE__ */ defineTool<ImageToolState, ImageToolContext, undefined>({
    id: "image.export",
    label: "tools.export",
    icon: "export",
    group: "export",
    isEnabled: ({ snapshot, editor }) => snapshot.plan !== null && editor.tool !== "crop",
    run: ({ editor }) =>
      editor.set((state) =>
        state.tool === "crop"
          ? state
          : {
              ...state,
              ...NO_TOOL,
              dialog: "export",
              // The frame shown is the one exported: playing stops on it (docs/adr/0011).
              playback: { ...state.playback, playing: false },
            },
      ),
  }),
  ({ snapshot, editor }) =>
    snapshot.plan !== null && editor.tool === "crop" ? "tools.exportWhileCropping" : undefined,
);
