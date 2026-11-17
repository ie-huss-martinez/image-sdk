import { defineTool } from "@hussmartinez/sdk-core";
import { NO_TOOL } from "../editor-state.js";
import { hasDocument, type ImageTool } from "../tool-types.js";

/**
 * Shows and hides the layers (docs/adr/0013): while it's on, the inspector
 * lists them, and the stage shows each as a frame that selects, moves and
 * resizes it. It starts with the top layer selected, when there is one, and
 * asks the panel to take focus there.
 */
export const layersTool: ImageTool = /* @__PURE__ */ defineTool({
  id: "image.layers",
  label: "tools.layers",
  icon: "layers",
  group: "layers",
  isEnabled: hasDocument,
  isActive: ({ editor }) => editor.tool === "layers",
  run: ({ editor, session }) => {
    const top = session.getSnapshot().plan?.layers.at(-1)?.key ?? null;
    editor.set((state) =>
      state.tool === "layers"
        ? { ...state, ...NO_TOOL, preview: null }
        : {
            ...state,
            // One tool has the stage at a time.
            ...NO_TOOL,
            tool: "layers",
            preview: null,
            layers: { selected: top, focus: "list" },
          },
    );
  },
  shortcuts: ["L"],
});
