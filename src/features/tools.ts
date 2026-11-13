import { cropTool, flipHorizontalTool, flipVerticalTool } from "./crop/crop-tools.js";
import { exportTool } from "./export/export-tool.js";
import { redoTool, undoTool } from "./history/history-tools.js";
import { openTool } from "./open/open-tool.js";
import { rotateLeftTool, rotateRightTool } from "./orientation/orientation-tools.js";
import type { ImageTool } from "./tool-types.js";
import { zoomFitTool, zoomInTool, zoomOutTool } from "./zoom/zoom-tools.js";

/**
 * Every tool the editor knows, in their default order (docs/adr/0007).
 *
 * @public
 */
export const imageTools: readonly ImageTool[] = [
  openTool,
  undoTool,
  redoTool,
  rotateLeftTool,
  rotateRightTool,
  flipHorizontalTool,
  flipVerticalTool,
  cropTool,
  zoomInTool,
  zoomOutTool,
  zoomFitTool,
  exportTool,
];

/** The toolbar's default groups (docs/adr/0007). */
export const DEFAULT_TOOLBAR: readonly (readonly string[])[] = [
  ["image.open"],
  ["image.undo", "image.redo"],
  ["image.rotate-left", "image.rotate-right", "image.flip-horizontal", "image.flip-vertical"],
  ["image.crop"],
  ["image.zoom-in", "image.zoom-out", "image.zoom-fit"],
  ["image.export"],
];
