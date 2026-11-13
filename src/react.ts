"use client";

/**
 * React editor of the image SDK: `ImageEditor`, its building blocks and hooks.
 *
 * @remarks
 * A client entry: it starts with `"use client"`, which the build keeps
 * (ADR 0007). React and React DOM 18.3 or later are optional peer
 * dependencies. Hosts import `@hussmartinez/ui/styles.css` once, then this
 * package's `styles.css` (sdk-core ADR 0036).
 *
 * @packageDocumentation
 */

export type { ImageEditorState } from "./features/editor-state.js";
export type { ImageTool, ImageToolContext, ImageToolState } from "./features/tool-types.js";
export { imageTools } from "./features/tools.js";
export type { ImageCropPanelProps } from "./react/crop/CropPanel.js";
export { ImageCropPanel } from "./react/crop/CropPanel.js";
export { ImageEditor } from "./react/editor/ImageEditor.js";
export type { ImageEditorHandle, ImageEditorPart, ImageEditorProps } from "./react/editor/types.js";
export {
  useImageDocument,
  useImageEditorState,
  useImageMessages,
  useImageSession,
  useImageView,
} from "./react/hooks.js";
export type { ImageEditorProviderProps } from "./react/ImageEditorProvider.js";
export { ImageEditorProvider } from "./react/ImageEditorProvider.js";
export type { ImageAdjustPanelProps } from "./react/panels/AdjustPanel.js";
export { ImageAdjustPanel } from "./react/panels/AdjustPanel.js";
export type { ImageFilterPanelProps } from "./react/panels/FilterPanel.js";
export { ImageFilterPanel } from "./react/panels/FilterPanel.js";
export type { ImageStageProps } from "./react/stage/ImageStage.js";
export { ImageStage } from "./react/stage/ImageStage.js";
export type { ImageToolbarProps } from "./react/toolbar/ImageToolbar.js";
export { ImageToolbar } from "./react/toolbar/ImageToolbar.js";
export { imageIcons } from "./react/toolbar/icons.js";
export type { ImageViewState } from "./react/view-store.js";
