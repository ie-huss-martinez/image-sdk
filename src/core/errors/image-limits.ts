import {
  coreLimits,
  defineLimits,
  type FilePolicy,
  type FilePolicyOverrides,
  type Limits,
} from "@hussmartinez/sdk-core";
import { ImageError } from "./image-error.js";

/**
 * The image SDK's limit definitions: sdk-core's core limits with image
 * defaults, plus five for images (ADR 0004).
 *
 * | Limit | Code | Default maximum | Default warning |
 * |---|---|---|---|
 * | `maxFileSize` | `FILE_TOO_LARGE` | 100 MB | 50 MB |
 * | `maxFiles` | `TOO_MANY_FILES` | 20 | none |
 * | `maxDecodedSize` | `DECODED_SIZE_TOO_LARGE` | 1 GB | 400 MB |
 * | `maxProcessingTime` | `PROCESSING_TIME_EXCEEDED` | 120 s | none |
 * | `maxImagePixels` | `IMAGE_TOO_LARGE` | 50 megapixels | 24 megapixels |
 * | `maxImageDimension` | `IMAGE_DIMENSION_TOO_LARGE` | 16,384 pixels | none |
 * | `maxFrames` | `TOO_MANY_FRAMES` | 300 | 100 |
 * | `maxSessionSize` | `SESSION_TOO_LARGE` | 1 GB | 500 MB |
 * | `maxLayers` | `TOO_MANY_LAYERS` | 256 | none |
 *
 * Sizes are decimal: 1 MB is 1,000,000 bytes. Decoded sizes count 4 bytes
 * per pixel. `maxImagePixels` is the same limit, with the same name, code
 * and unit, as `pdf-sdk`'s. `maxImageDimension` is a side length, in pixels.
 *
 * @public
 */
export const imageLimitDefinitions = {
  ...coreLimits,
  maxDecodedSize: { ...coreLimits.maxDecodedSize, default: 1_000_000_000, warning: 400_000_000 },
  maxImagePixels: {
    code: "IMAGE_TOO_LARGE",
    unit: "pixels",
    default: 50_000_000,
    warning: 24_000_000,
  },
  maxImageDimension: { code: "IMAGE_DIMENSION_TOO_LARGE", unit: "pixels", default: 16_384 },
  maxFrames: { code: "TOO_MANY_FRAMES", unit: "count", default: 300, warning: 100 },
  maxSessionSize: {
    code: "SESSION_TOO_LARGE",
    unit: "bytes",
    default: 1_000_000_000,
    warning: 500_000_000,
  },
  maxLayers: { code: "TOO_MANY_LAYERS", unit: "count", default: 256 },
} as const;

/**
 * The type of {@link imageLimitDefinitions}.
 *
 * @public
 */
export type ImageLimitDefinitions = typeof imageLimitDefinitions;

/**
 * The names of the image SDK's limits.
 *
 * @public
 */
export type ImageLimitName = keyof ImageLimitDefinitions;

/**
 * A host's `filePolicy`: a new maximum, or `{ maximum, warning }`, for any of
 * the image SDK's limits. `Infinity` disables a maximum, which removes a
 * protection against hostile files, or disables a warning. Unknown limit
 * names throw `TypeError` when the policy is resolved.
 *
 * @example
 * ```ts
 * // Large scans: raise the pixel and decoded sizes together.
 * const filePolicy: ImageFilePolicyOverrides = {
 *   maxImagePixels: 100_000_000,
 *   maxDecodedSize: { maximum: 2e9, warning: 800e6 },
 * };
 * ```
 *
 * @public
 */
export type ImageFilePolicyOverrides = FilePolicyOverrides<ImageLimitDefinitions>;

/**
 * A resolved file policy for the image SDK. Violations throw
 * {@link ImageError}.
 *
 * @public
 */
export type ImageFilePolicy = FilePolicy<ImageLimitDefinitions>;

/**
 * The image SDK's limits, ready to resolve a host's `filePolicy`. Violations
 * are thrown as {@link ImageError}, with `details` naming the limit.
 *
 * @example
 * ```ts
 * const policy = imageLimits.resolve(props.filePolicy);
 * policy.check("maxImagePixels", width * height); // throws ImageError("IMAGE_TOO_LARGE") above 50 megapixels
 * ```
 *
 * @public
 */
export const imageLimits: Limits<ImageLimitDefinitions> = /* @__PURE__ */ defineLimits(
  imageLimitDefinitions,
  { errorClass: ImageError },
);
