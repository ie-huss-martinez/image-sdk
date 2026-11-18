import {
  AddIcon,
  ArrowIcon,
  CropIcon,
  DownloadIcon,
  EllipseIcon,
  FitIcon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  type IconComponent,
  LayersIcon,
  OpenIcon,
  PageGridIcon,
  PenIcon,
  PlayIcon,
  RectangleIcon,
  RedactIcon,
  RedoIcon,
  RotateLeftIcon,
  RotateRightIcon,
  SearchIcon,
  TextIcon,
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
  play: PlayIcon,
  redo: RedoIcon,
  "rotate-left": RotateLeftIcon,
  "rotate-right": RotateRightIcon,
  "zoom-in": ZoomInIcon,
  "zoom-out": ZoomOutIcon,
  fit: FitIcon,
  crop: CropIcon,
  redact: RedactIcon,
  layers: LayersIcon,
  frames: PageGridIcon,
  text: TextIcon,
  rectangle: RectangleIcon,
  ellipse: EllipseIcon,
  "add-image": AddIcon,
  arrow: ArrowIcon,
  pen: PenIcon,
  export: DownloadIcon,
  "flip-horizontal": FlipHorizontalIcon,
  "flip-vertical": FlipVerticalIcon,
  search: SearchIcon,
};
