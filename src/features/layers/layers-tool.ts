import { defineTool } from "@hussmartinez/sdk-core";
import { hasDocument, type ImageTool } from "../tool-types.js";

/**
 * Shows and hides the layers (docs/adr/0013): while it's on, the inspector
 * lists them, and the stage shows each as a frame that selects, moves and
 * resizes it. It starts with the top layer selected, when there is one.
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
        ? { ...state, tool: null, layers: null, preview: null }
        : {
            ...state,
            tool: "layers",
            // One tool has the stage at a time.
            crop: null,
            redact: null,
            preview: null,
            layers: { selected: top },
          },
    );
  },
  shortcuts: ["L"],
});
