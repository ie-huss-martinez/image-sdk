import { cropTool, flipHorizontalTool, flipVerticalTool } from "./crop/crop-tools.js";
import { drawTool } from "./draw/draw-tool.js";
import { exportTool } from "./export/export-tool.js";
import { framesTool } from "./frames/frames-tool.js";
import { redoTool, undoTool } from "./history/history-tools.js";
import {
  addArrowTool,
  addEllipseTool,
  addImageTool,
  addRectangleTool,
  addTextTool,
} from "./layers/add-layer-tools.js";
import { layersTool } from "./layers/layers-tool.js";
import { openTool } from "./open/open-tool.js";
import { rotateLeftTool, rotateRightTool } from "./orientation/orientation-tools.js";
import { playTool } from "./playback/play-tool.js";
import { redactTool } from "./redact/redact-tool.js";
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
  redactTool,
  addTextTool,
  addRectangleTool,
  addEllipseTool,
  addArrowTool,
  addImageTool,
  drawTool,
  layersTool,
  framesTool,
  zoomInTool,
  zoomOutTool,
  zoomFitTool,
  exportTool,
  playTool,
];

/** The toolbar's default groups (docs/adr/0007). */
export const DEFAULT_TOOLBAR: readonly (readonly string[])[] = [
  ["image.open"],
  ["image.undo", "image.redo"],
  ["image.rotate-left", "image.rotate-right", "image.flip-horizontal", "image.flip-vertical"],
  ["image.crop"],
  ["image.redact"],
  [
    "image.add-text",
    "image.add-rectangle",
    "image.add-ellipse",
    "image.add-arrow",
    "image.add-image",
  ],
  ["image.draw"],
  ["image.layers"],
  ["image.frames"],
  ["image.zoom-in", "image.zoom-out", "image.zoom-fit"],
  ["image.export"],
];
