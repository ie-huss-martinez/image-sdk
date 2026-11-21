import { defineMessages, type MessageValue, plural, sdkCoreMessages } from "@hussmartinez/sdk-core";
import type { ImageErrorCode } from "../core/errors/image-error.js";
import type { ImageLimitName } from "../core/errors/image-limits.js";

/**
 * The image SDK's English message catalogue for the server-safe entry:
 * sdk-core's messages, and text for every {@link ImageErrorCode} and every
 * limit's warning, which the headless session produces and a host shows.
 * Pass it to `createMessages` from `@hussmartinez/sdk-core`, with the host's
 * locale and overrides.
 *
 * It holds no interface text: the editor's labels, states, announcements
 * and tool names are in `imageEditorMessages`, from the React entry, so
 * hosts of this entry, servers included, don't carry text nothing here
 * shows (docs/adr/0012).
 *
 * Error text is looked up by code, with the error's `details` as
 * parameters, and never taken from `error.message` (ADR 0019).
 *
 * @example
 * ```ts
 * const messages = createMessages(imageMessages, { locale: "en", overrides: props.messages });
 * messages.error(error); // "This animation has 400 frames, which is over the 300-frame limit."
 * messages.t("warnings.maxSessionSize", { actual: 600e6 });
 * ```
 *
 * @public
 */
export const imageMessages = /* @__PURE__ */ imageCatalogue();

/**
 * Builds {@link imageMessages}. A function, so the call can be marked free of
 * side effects: the spread of sdk-core's catalogue otherwise keeps the text
 * in every bundle that imports this module (sdk-core ADR 0056).
 */
function imageCatalogue() {
  return defineMessages({
    ...sdkCoreMessages,
    "errors.INVALID_IMAGE": "This file isn't a valid image, or it's too damaged to open.",
    "errors.UNSUPPORTED_FORMAT":
      "This image format isn't supported. Try converting the file to PNG or JPEG, then open it again.",
    "errors.DECODE_FAILED":
      "This browser can't open this kind of image. Try another browser, or convert the file to PNG or JPEG.",
    "errors.INVALID_COMMAND": "This edit couldn't be made. Please try again.",
    "errors.INVALID_DOCUMENT": "This project is damaged, or it isn't an image project.",
    "errors.UNSUPPORTED_PLAN":
      "This image has edits this version can't show. Update the application and try again.",
    "errors.IMAGE_TOO_LARGE":
      "This image has more pixels than the editor can handle. Try a smaller version of it.",
    "errors.IMAGE_DIMENSION_TOO_LARGE":
      "This image is {actual, number} pixels across, which is over the {maximum, number}-pixel limit.",
    "errors.TOO_MANY_FRAMES": /* @__PURE__ */ plural("maximum", {
      one: "This animation has {actual, number} frames, which is over the {maximum}-frame limit.",
      other:
        "This animation has {actual, number} frames, which is over the {maximum, number}-frame limit.",
    }),
    "errors.ANIMATION_TOO_LARGE":
      "This animation is too large to open with all its frames. Its first frame can still be opened.",
    "errors.SESSION_TOO_LARGE":
      "The open images would use {actual, fileSize} of memory, which is over the {maximum, fileSize} limit. Close an image, or clear the undo history, and try again.",
    "errors.TOO_MANY_LAYERS": /* @__PURE__ */ plural("maximum", {
      one: "An image can have {maximum} layer. Merge or delete layers, and try again.",
      other:
        "An image can have up to {maximum, number} layers. Merge or delete layers, and try again.",
    }),
    "errors.TOO_MANY_POINTS":
      "This image's drawings would have {actual, number} points, which is over the limit of {maximum, number}. Remove some strokes, and try again.",
    "warnings.maxImagePixels": "This image is large, and may be slow to edit on some devices.",
    "warnings.maxImageDimension": "This image is very wide or tall, and may be slow to edit.",
    "warnings.maxFrames": /* @__PURE__ */ plural("actual", {
      one: "This animation has {actual} frame.",
      other: "This animation has {actual, number} frames, and may be slow to edit and export.",
    }),
    "warnings.maxAnimationPixels":
      "This animation is large, and may be slow to play, edit and export.",
    "warnings.maxSessionSize":
      "The open images use {actual, fileSize} of memory. Clearing the undo history frees memory.",
    "warnings.maxLayers": /* @__PURE__ */ plural("actual", {
      one: "This image has {actual} layer.",
      other: "This image has {actual, number} layers, and may be slow to edit and export.",
    }),
    "warnings.maxDrawingPoints":
      "This image has a lot of drawing, and may be slow to edit and export.",
  }) satisfies Record<`errors.${ImageErrorCode}`, MessageValue> &
    Record<`warnings.${ImageLimitName}`, MessageValue>;
}

/**
 * The type of {@link imageMessages}, for typing a host's overrides with
 * `MessageOverrides<ImageMessageCatalogue>`.
 *
 * @public
 */
export type ImageMessageCatalogue = typeof imageMessages;
