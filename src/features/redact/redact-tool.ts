import { defineTool } from "@hussmartinez/sdk-core";
import { NO_TOOL } from "../editor-state.js";
import { hasDocument, type ImageTool } from "../tool-types.js";

/** The fill a new solid redaction takes until another is chosen (docs/adr/0010). */
export const DEFAULT_REDACTION_COLOUR = "#000000";

/**
 * Starts and ends redacting (docs/adr/0010): while it's on, the stage shows
 * each redaction as a frame, and the inspector shows the redact panel. It
 * starts with solid, the mode that destroys what it covers.
 */
export const redactTool: ImageTool = /* @__PURE__ */ defineTool({
  id: "image.redact",
  label: "tools.redact",
  icon: "redact",
  group: "redact",
  isEnabled: hasDocument,
  isActive: ({ editor }) => editor.tool === "redact",
  run: ({ editor }) => {
    editor.set((state) =>
      state.tool === "redact"
        ? { ...state, ...NO_TOOL, preview: null }
        : {
            ...state,
            ...NO_TOOL,
            tool: "redact",
            preview: null,
            redact: { selected: null, mode: "solid", colour: DEFAULT_REDACTION_COLOUR },
          },
    );
  },
  shortcuts: ["R"],
});
