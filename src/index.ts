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
export type { ImagePoint } from "./core/model/geometry.js";
export {
  compositionSize,
  compositionToSource,
  cropRect,
  orientedSize,
  outputSize,
  sourceToComposition,
} from "./core/model/geometry.js";
export type {
  ImageBase,
  ImageCrop,
  ImageDevelop,
  ImageFilter,
  ImageFilterPreset,
  ImageOrientation,
  ImageOutput,
  ImagePlan,
  ImageRotation,
} from "./core/model/plan.js";
export {
  createPlan,
  DEVELOP_ADJUSTMENTS,
  FILTER_PRESETS,
  FULL_SIZE,
  NEUTRAL_DEVELOP,
  UPRIGHT,
} from "./core/model/plan.js";
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
  ImageCommand,
  ImageCommandRejection,
  SetCropCommand,
  SetDevelopCommand,
  SetFilterCommand,
  SetMetadataCommand,
  SetOrientationCommand,
  SetOutputCommand,
} from "./core/operations/commands.js";
export { createImageReducer } from "./core/operations/commands.js";
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
export type {
  ImageSession,
  ImageSessionEvent,
  ImageSessionExport,
  ImageSessionOptions,
  ImageSessionSnapshot,
  ImageSessionSource,
} from "./core/session/session.js";
export { createImageSession } from "./core/session/session.js";
export type { ImageMessageCatalogue } from "./messages/en.js";
export { imageMessages } from "./messages/en.js";
