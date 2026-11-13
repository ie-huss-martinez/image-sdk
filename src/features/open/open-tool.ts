import { defineTool } from "@hussmartinez/sdk-core";
import type { ImageTool } from "../tool-types.js";

/** Asks for an image and opens it. No shortcut: `Mod+O` is the browser's own. */
export const openTool: ImageTool = /* @__PURE__ */ defineTool({
  id: "image.open",
  label: "tools.open",
  icon: "open",
  group: "file",
  run: ({ chooseFile }) => chooseFile(),
});
