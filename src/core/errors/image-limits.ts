import {
  coreLimits,
  defineLimits,
  type FilePolicy,
  type FilePolicyOverrides,
  type Limits,
} from "@hussmartinez/sdk-core";
import type { ImageProbe } from "../model/source.js";
import { ImageError } from "./image-error.js";

/**
 * The image SDK's limit definitions: sdk-core's core limits with image
 * defaults, plus six for images (ADR 0004, docs/adr/0011).
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
 * | `maxAnimationPixels` | `ANIMATION_TOO_LARGE` | 8 megapixels | 2 megapixels |
 * | `maxSessionSize` | `SESSION_TOO_LARGE` | 1 GB | 500 MB |
 * | `maxLayers` | `TOO_MANY_LAYERS` | 256 | none |
 * | `maxDrawingPoints` | `TOO_MANY_POINTS` | 200,000 | 100,000 |
 *
 * Sizes are decimal: 1 MB is 1,000,000 bytes. Decoded sizes count 4 bytes
 * per pixel. `maxImagePixels` is the same limit, with the same name, code
 * and unit, as `pdf-sdk`'s. `maxImageDimension` is a side length, in pixels.
 *
 * `maxAnimationPixels` is the size of an animation's screen: an
 * animation's working set is several screens, so it needs a lower ceiling
 * than a still's. With `maxFrames` and, across its frames,
 * `maxDecodedSize`, it's a limit on holding a file as an animation, not on
 * what opens: an animated file over any of them opens as its first frame,
 * a still (docs/adr/0011). As a still it's held to the others.
 *
 * @public
 */
export const imageLimitDefinitions = /* @__PURE__ */ limitDefinitions();

/**
 * Builds {@link imageLimitDefinitions}. A function, so the call can be marked
 * free of side effects: the spread of sdk-core's limits otherwise keeps the
 * object in every bundle that imports this module (sdk-core ADR 0056).
 */
function limitDefinitions() {
  return {
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
    maxAnimationPixels: {
      code: "ANIMATION_TOO_LARGE",
      unit: "pixels",
      default: 8_000_000,
      warning: 2_000_000,
    },
    maxSessionSize: {
      code: "SESSION_TOO_LARGE",
      unit: "bytes",
      default: 1_000_000_000,
      warning: 500_000_000,
    },
    maxLayers: { code: "TOO_MANY_LAYERS", unit: "count", default: 256 },
    maxDrawingPoints: {
      code: "TOO_MANY_POINTS",
      unit: "count",
      default: 200_000,
      warning: 100_000,
    },
  } as const;
}

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

/**
 * The limits that apply to one file on its own, which the engine checks
 * against its own probe before it decodes anything (ADR 0004).
 *
 * @public
 */
export const PER_FILE_LIMITS = [
  "maxFileSize",
  "maxImageDimension",
  "maxImagePixels",
  "maxFrames",
  "maxDecodedSize",
] as const satisfies readonly ImageLimitName[];

/**
 * Checks one probed file against a policy's per-file limits, in the order
 * of {@link PER_FILE_LIMITS}, and throws the first violation as an
 * `ImageError` with the limit's code (ADR 0004). Returns the limits whose
 * warning threshold the file reaches.
 *
 * @param frames - What of an animated file is to be held: `"all"` its
 *   frames, the default, which counts every frame against `maxFrames` and
 *   `maxDecodedSize`; `"first"` its first frame, a still, which counts one
 *   (docs/adr/0011).
 * @public
 */
export function checkFileLimits(
  policy: ImageFilePolicy,
  fileSize: number,
  probe: ImageProbe,
  frames: "first" | "all" = "all",
): ImageLimitName[] {
  const { width, height } = probe.oriented;
  const actual: Record<(typeof PER_FILE_LIMITS)[number], number> = {
    maxFileSize: fileSize,
    maxImageDimension: Math.max(width, height),
    maxImagePixels: width * height,
    maxFrames: frames === "all" ? probe.frames : 1,
    maxDecodedSize: (frames === "all" ? probe.decodedPixelBound : width * height) * 4,
  };
  return PER_FILE_LIMITS.filter((limit) => policy.check(limit, actual[limit]) === "warning");
}

/**
 * The limits on holding a file as an animation (docs/adr/0011): its frames,
 * what they could decode to, and its screen. A file over one of them isn't
 * refused: it's held as its first frame, a still.
 *
 * @public
 */
export const ANIMATION_LIMITS = [
  "maxFrames",
  "maxDecodedSize",
  "maxAnimationPixels",
] as const satisfies readonly ImageLimitName[];

/**
 * Which of {@link ANIMATION_LIMITS} a probed file is over, and which it's
 * near, as an animation. It never throws: a file over one opens as a still.
 *
 * @param ceiling - The most frames the engine holds whatever the policy
 *   says, such as `MAX_ANIMATION_FRAMES`: over it counts as over `maxFrames`.
 * @public
 */
export function animationLimits(
  policy: ImageFilePolicy,
  probe: ImageProbe,
  ceiling = Number.POSITIVE_INFINITY,
): { readonly over: ImageLimitName[]; readonly near: ImageLimitName[] } {
  const actual: Record<(typeof ANIMATION_LIMITS)[number], number> = {
    maxFrames: probe.frames,
    maxDecodedSize: probe.decodedPixelBound * 4,
    maxAnimationPixels: probe.oriented.width * probe.oriented.height,
  };
  const over: ImageLimitName[] = [];
  const near: ImageLimitName[] = [];
  for (const limit of ANIMATION_LIMITS) {
    try {
      if (policy.check(limit, actual[limit]) === "warning") near.push(limit);
    } catch {
      over.push(limit);
    }
  }
  if (probe.frames > ceiling && !over.includes("maxFrames")) over.push("maxFrames");
  return { over, near };
}

/**
 * The limits an export's output canvas is checked against before it's
 * allocated: its longest side and its pixels (ADR 0004).
 *
 * @public
 */
export const OUTPUT_LIMITS = [
  "maxImageDimension",
  "maxImagePixels",
] as const satisfies readonly ImageLimitName[];

/**
 * Checks an export's output size against a policy before its canvas is
 * allocated, and throws the first violation as an `ImageError` with the
 * limit's code (ADR 0004).
 *
 * @public
 */
export function checkOutputLimits(
  policy: ImageFilePolicy,
  size: { readonly width: number; readonly height: number },
): void {
  policy.check("maxImageDimension", Math.max(size.width, size.height));
  policy.check("maxImagePixels", size.width * size.height);
}
