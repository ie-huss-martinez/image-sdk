import {
  CropIcon,
  FitIcon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  type IconComponent,
  OpenIcon,
  RedoIcon,
  RotateLeftIcon,
  RotateRightIcon,
  SearchIcon,
  UndoIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "@hussmartinez/ui/react";

/**
 * The components of the icons the editor's tools name, from ui's set
 * (sdk-core ADR 0030). A host's `icons` prop overrides any of them.
 *
 * @public
 */
export const imageIcons: Readonly<Record<string, IconComponent>> = {
  open: OpenIcon,
  undo: UndoIcon,
  redo: RedoIcon,
  "rotate-left": RotateLeftIcon,
  "rotate-right": RotateRightIcon,
  "zoom-in": ZoomInIcon,
  "zoom-out": ZoomOutIcon,
  fit: FitIcon,
  crop: CropIcon,
  "flip-horizontal": FlipHorizontalIcon,
  "flip-vertical": FlipVerticalIcon,
  search: SearchIcon,
};
