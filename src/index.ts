/**
 * Headless core of the image SDK: contracts, errors, the document session,
 * operations and the image engine, whose worker loads only on its first call.
 *
 * @remarks
 * This entry is server-safe: it has no React and touches no DOM on import, so
 * Server Components and Node can import it (ADR 0004, ADR 0007).
 *
 * @packageDocumentation
 */

export type { ImageEngineOptions } from "./adapters/image-engine.js";
export { createImageEngine } from "./adapters/image-engine.js";
export { createImageProcessor } from "./adapters/image-processor.js";
export { createImageRenderer } from "./adapters/image-renderer.js";
export type { ImageErrorCode } from "./core/errors/image-error.js";
export { ImageError, isImageError } from "./core/errors/image-error.js";
export type {
  ImageFilePolicy,
  ImageFilePolicyOverrides,
  ImageLimitDefinitions,
  ImageLimitName,
} from "./core/errors/image-limits.js";
export {
  ANIMATION_LIMITS,
  animationLimits,
  checkFileLimits,
  checkOutputLimits,
  imageLimitDefinitions,
  imageLimits,
  OUTPUT_LIMITS,
  PER_FILE_LIMITS,
} from "./core/errors/image-limits.js";
export type {
  ImageAssetReference,
  ImageDocumentRejection,
  ImagePlanDocument,
  ImagePlanDocumentSource,
} from "./core/format/plan-document.js";
export {
  IMAGE_PLAN_FORMAT,
  IMAGE_PLAN_VERSION,
  readImagePlanDocument,
  toImagePlanDocument,
} from "./core/format/plan-document.js";
export type { CropHandle, ImageAspect } from "./core/model/crop.js";
export {
  ASPECT_PRESETS,
  aspectRatio,
  compositionDeltaToSource,
  cropInComposition,
  dragHandle,
  fitAspect,
  handleInSource,
  moveCrop,
  nudgeCropOnScreen,
} from "./core/model/crop.js";
export {
  arrowBounds,
  arrowOutline,
  drawingBounds,
  drawingPoints,
  simplifyStroke,
} from "./core/model/drawing-geometry.js";
export type { ImagePoint } from "./core/model/geometry.js";
export {
  compositionSize,
  compositionToSource,
  cropRect,
  orientedSize,
  outputSize,
  sourceToComposition,
} from "./core/model/geometry.js";
export { createImageKey } from "./core/model/keys.js";
export type { ImageMatrix, ImageTextLine } from "./core/model/layer-geometry.js";
export {
  applyMatrix,
  fitTextLines,
  invertMatrix,
  isRightToLeft,
  layerToOutput,
  layerToScene,
  sceneToLayerSource,
  sceneToOutput,
} from "./core/model/layer-geometry.js";
export type {
  ImageAnimation,
  ImageArrowLayer,
  ImageBase,
  ImageBoxedLayer,
  ImageCrop,
  ImageDevelop,
  ImageDrawingLayer,
  ImageFilter,
  ImageFilterPreset,
  ImageFrame,
  ImageImageLayer,
  ImageLayer,
  ImageLayerBox,
  ImageLayerCommon,
  ImageLayerKind,
  ImageOrientation,
  ImageOutput,
  ImagePlan,
  ImageRedaction,
  ImageRedactionMode,
  ImageRedactionRegion,
  ImageRotation,
  ImageScenePoint,
  ImageShapeLayer,
  ImageStroke,
  ImageTextLayer,
} from "./core/model/plan.js";
export {
  createPlan,
  DEVELOP_ADJUSTMENTS,
  FILTER_PRESETS,
  FULL_SIZE,
  LAYER_ALIGNMENTS,
  LAYER_FONTS,
  LAYER_KINDS,
  LAYER_SHAPES,
  MAX_ANIMATION_FRAMES,
  MAX_DRAWING_STROKES,
  MAX_FRAME_DELAY,
  MAX_KEY_LENGTH,
  MAX_LAYER_NAME_LENGTH,
  MAX_LAYER_TEXT_LENGTH,
  MAX_PLAN_ITEMS,
  MAX_RUN_POINTS,
  MAX_SCENE_COORDINATE,
  MAX_STROKE_RUNS,
  MAX_STROKE_WIDTH,
  NEUTRAL_DEVELOP,
  REDACTION_MODES,
  UPRIGHT,
} from "./core/model/plan.js";
export type { ImageRect } from "./core/model/redaction-geometry.js";
export {
  compositionRectToScene,
  fitRedactionRegion,
  redactionBlockSize,
  redactionBlocksInOutput,
  redactionBlocksInScene,
  redactionRectInOutput,
  sceneRectToComposition,
} from "./core/model/redaction-geometry.js";
export type {
  ExifOrientation,
  ImageFormat,
  ImageKeepableMetadata,
  ImageMetadataPresence,
  ImageProbe,
  ImageSize,
  ImageSourceInfo,
  ImageThumbnail,
} from "./core/model/source.js";
export { EMPTY_KEEPABLE_METADATA, MAX_METADATA_LENGTH, NO_METADATA } from "./core/model/source.js";
export type {
  AddStrokesCommand,
  ImageCommand,
  ImageCommandRejection,
  ImageInverseCommand,
  ImageReducerSource,
  InsertFramesCommand,
  InsertLayersCommand,
  InsertRedactionsCommand,
  MoveFramesCommand,
  MoveLayersCommand,
  MoveRedactionsCommand,
  RemoveFramesCommand,
  RemoveLayersCommand,
  RemoveRedactionsCommand,
  RemoveStrokesCommand,
  RestoreFramesCommand,
  RestoreLayersCommand,
  RestoreRedactionsCommand,
  RestoreStrokesCommand,
  ReverseFramesCommand,
  SetCropCommand,
  SetDevelopCommand,
  SetFilterCommand,
  SetFrameOrderCommand,
  SetLayerOrderCommand,
  SetLoopCommand,
  SetMetadataCommand,
  SetOrientationCommand,
  SetOutputCommand,
  SetRedactionOrderCommand,
  UpdateFramesCommand,
  UpdateLayersCommand,
  UpdateRedactionsCommand,
} from "./core/operations/commands.js";
export { createImageReducer } from "./core/operations/commands.js";
export type { ImageFrameProps } from "./core/operations/frames.js";
export type { ImageRedactionProps } from "./core/operations/redactions.js";
export type { ImageEngine } from "./core/ports/image-engine.js";
export type {
  ImageExportFormat,
  ImageExportJob,
  ImageProcessor,
} from "./core/ports/image-processor.js";
export type {
  ImageRenderer,
  ImageRenderOptions,
  ImageRenderOutcome,
  ImageView,
} from "./core/ports/image-renderer.js";
export {
  backingSize,
  fittedView,
  MAX_PIXEL_RATIO,
  placement,
} from "./core/ports/image-renderer.js";
export type {
  ImageCallOptions,
  ImageExportOptions,
  ImageProgressOptions,
  ImageRegisterOptions,
} from "./core/ports/options.js";
export type { ImagePlanPart } from "./core/ports/plan-support.js";
export { checkPlanSupport } from "./core/ports/plan-support.js";
export type {
  ImageSession,
  ImageSessionEvent,
  ImageSessionExport,
  ImageSessionOptions,
  ImageSessionSnapshot,
  ImageSessionSource,
} from "./core/session/session.js";
export { createImageSession } from "./core/session/session.js";
export type { ImageEditorMessageCatalogue } from "./messages/editor-catalogue.js";
export type { ImageMessageCatalogue } from "./messages/en.js";
export { imageMessages } from "./messages/en.js";
