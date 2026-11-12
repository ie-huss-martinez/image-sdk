/**
 * Headless core of the image SDK: contracts, errors, the document session and
 * operations.
 *
 * @remarks
 * This entry is server-safe: it has no React and touches no DOM on import, so
 * Server Components and Node can import it (ADR 0004, ADR 0007).
 *
 * @packageDocumentation
 */

export type { ImageErrorCode } from "./core/errors/image-error.js";
export { ImageError, isImageError } from "./core/errors/image-error.js";
export type {
  ImageFilePolicy,
  ImageFilePolicyOverrides,
  ImageLimitDefinitions,
  ImageLimitName,
} from "./core/errors/image-limits.js";
export { imageLimitDefinitions, imageLimits } from "./core/errors/image-limits.js";
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
  ImageOrientation,
  ImageOutput,
  ImagePlan,
  ImageRotation,
} from "./core/model/plan.js";
export { createPlan, FULL_SIZE, UPRIGHT } from "./core/model/plan.js";
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
  SetCropCommand,
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
export type { ImageCallOptions, ImageProgressOptions } from "./core/ports/options.js";
export type { ImageMessageCatalogue } from "./messages/en.js";
export { imageMessages } from "./messages/en.js";
