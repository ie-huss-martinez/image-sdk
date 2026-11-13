import { defineTool } from "@hussmartinez/sdk-core";
import { hasDocument, type ImageTool } from "../tool-types.js";

const STEP = 1.25;
const clamp = (zoom: number) => Math.min(16, Math.max(0.1, zoom));

/** Zooms the stage in, by the family's keys. */
export const zoomInTool: ImageTool = /* @__PURE__ */ defineTool({
  id: "image.zoom-in",
  label: "tools.zoom-in",
  icon: "zoom-in",
  group: "zoom",
  isEnabled: hasDocument,
  run: ({ view }) => view.set((v) => ({ ...v, zoom: clamp(v.zoom * STEP) })),
  shortcuts: "zoom-in",
});

/** Zooms the stage out. */
export const zoomOutTool: ImageTool = /* @__PURE__ */ defineTool({
  id: "image.zoom-out",
  label: "tools.zoom-out",
  icon: "zoom-out",
  group: "zoom",
  isEnabled: hasDocument,
  run: ({ view }) => view.set((v) => ({ ...v, zoom: clamp(v.zoom / STEP) })),
  shortcuts: "zoom-out",
});

/** Fits the image to the stage, with no pan, as the family's `zoom-reset` keys do. */
export const zoomFitTool: ImageTool = /* @__PURE__ */ defineTool({
  id: "image.zoom-fit",
  label: "tools.zoom-fit",
  icon: "fit",
  group: "zoom",
  isEnabled: hasDocument,
  run: ({ view }) => view.set({ zoom: 1, pan: { x: 0, y: 0 } }),
  shortcuts: "zoom-reset",
});
