import { defineMessages, type MessageValue, plural, sdkCoreMessages } from "@hussmartinez/sdk-core";
import { uiMessages } from "@hussmartinez/ui";
import type { ImageErrorCode } from "../core/errors/image-error.js";
import type { ImageLimitName } from "../core/errors/image-limits.js";

/**
 * The image SDK's English message catalogue: sdk-core's and ui's messages, and text
 * for every {@link ImageErrorCode} and every limit's warning. Pass it to
 * `createMessages` from `@hussmartinez/sdk-core`, with the host's locale and
 * overrides. It also has the editor's text: its labels, states,
 * announcements and tool names.
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
export const imageMessages = /* @__PURE__ */ defineMessages({
  ...sdkCoreMessages,
  // ui's components' text, so hosts translate the drop zone and dialogs
  // through the editor's `messages` too (sdk-core ADR 0046).
  ...uiMessages,
  "errors.INVALID_IMAGE": "This file isn't a valid image, or it's too damaged to open.",
  "errors.UNSUPPORTED_FORMAT":
    "This image format isn't supported. Try converting the file to PNG or JPEG, then open it again.",
  "errors.DECODE_FAILED":
    "This browser can't open this kind of image. Try another browser, or convert the file to PNG or JPEG.",
  "errors.INVALID_COMMAND": "This edit couldn't be made. Please try again.",
  "errors.IMAGE_TOO_LARGE":
    "This image has more pixels than the editor can handle. Try a smaller version of it.",
  "errors.IMAGE_DIMENSION_TOO_LARGE":
    "This image is {actual, number} pixels across, which is over the {maximum, number}-pixel limit.",
  "errors.TOO_MANY_FRAMES": /* @__PURE__ */ plural("maximum", {
    one: "This animation has {actual, number} frames, which is over the {maximum}-frame limit.",
    other:
      "This animation has {actual, number} frames, which is over the {maximum, number}-frame limit.",
  }),
  "errors.SESSION_TOO_LARGE":
    "The open images would use {actual, fileSize} of memory, which is over the {maximum, fileSize} limit. Close an image, or clear the undo history, and try again.",
  "errors.TOO_MANY_LAYERS": /* @__PURE__ */ plural("maximum", {
    one: "An image can have {maximum} layer. Merge or delete layers, and try again.",
    other:
      "An image can have up to {maximum, number} layers. Merge or delete layers, and try again.",
  }),
  "warnings.maxImagePixels": "This image is large, and may be slow to edit on some devices.",
  "warnings.maxImageDimension": "This image is very wide or tall, and may be slow to edit.",
  "warnings.maxFrames": /* @__PURE__ */ plural("actual", {
    one: "This animation has {actual} frame.",
    other: "This animation has {actual, number} frames, and may be slow to edit and export.",
  }),
  "warnings.maxSessionSize":
    "The open images use {actual, fileSize} of memory. Clearing the undo history frees memory.",
  "warnings.maxLayers": /* @__PURE__ */ plural("actual", {
    one: "This image has {actual} layer.",
    other: "This image has {actual, number} layers, and may be slow to edit and export.",
  }),
  "editor.label": "Image editor",
  "editor.preview": "Edited image preview, {width, number} × {height, number}",
  "editor.empty": "Open an image to start editing. It stays on this device.",
  "editor.choose": "Choose an image",
  "editor.dropHint": "or drop it here",
  "editor.opening": "Opening the image…",
  "editor.cancel": "Cancel",
  "editor.opened": "Image opened, {width, number} × {height, number}.",
  "editor.undid": "Undid {action}.",
  "editor.redid": "Redid {action}.",
  "actions.image.setCrop": "crop",
  "actions.image.setOrientation": "rotate or flip",
  "actions.image.setOutput": "size",
  "actions.image.setMetadata": "metadata",
  "actions.image.setDevelop": "adjustment",
  "actions.image.setFilter": "filter",
  "toolbar.label": "Image tools",
  "toolbar.groups.file": "File",
  "toolbar.groups.history": "History",
  "toolbar.groups.orientation": "Rotate",
  "toolbar.groups.zoom": "Zoom",
  "toolbar.groups.other": "More tools",
  "tools.open": "Open image",
  "tools.undo": "Undo",
  "tools.redo": "Redo",
  "tools.rotate-left": "Rotate left",
  "tools.rotate-right": "Rotate right",
  "tools.zoom-in": "Zoom in",
  "tools.zoom-out": "Zoom out",
  "tools.zoom-fit": "Fit to the stage",
  "tools.crop": "Crop",
  "tools.flip-horizontal": "Flip horizontally",
  "tools.flip-vertical": "Flip vertically",
  "toolbar.groups.crop": "Crop",
  "crop.frame": "Crop area",
  "crop.frameDescription":
    "{width, number} × {height, number} pixels, from {x, number}, {y, number}. Arrow keys move it; with Alt, they resize it; Enter applies and Escape cancels.",
  "crop.size": "{width, number} × {height, number}, from {x, number}, {y, number}",
  "crop.panel": "Crop",
  "crop.x": "Left",
  "crop.y": "Top",
  "crop.width": "Width",
  "crop.height": "Height",
  "crop.aspect": "Aspect ratio",
  "crop.aspects.free": "Free",
  "crop.aspects.original": "Original",
  "crop.aspects.ratio": "{width}:{height}",
  "crop.apply": "Apply crop",
  "crop.cancel": "Cancel",
  "crop.reset": "Whole image",
  "crop.applied": "Cropped to {width, number} × {height, number}.",
  "inspector.label": "Panels",
  "inspector.adjust": "Adjust",
  "inspector.filters": "Filters",
  "develop.panel": "Adjust",
  "develop.temperature": "Temperature",
  "develop.tint": "Tint",
  "develop.exposure": "Exposure",
  "develop.highlights": "Highlights",
  "develop.shadows": "Shadows",
  "develop.contrast": "Contrast",
  "develop.saturation": "Saturation",
  "develop.vibrance": "Vibrance",
  "develop.reset": "Reset {name}",
  "develop.resetAll": "Reset all",
  "develop.wasReset": "All adjustments reset.",
  "filters.panel": "Filters",
  "filters.label": "Filter",
  "filters.none": "None",
  "filters.vivid": "Vivid",
  "filters.warm": "Warm",
  "filters.cool": "Cool",
  "filters.fade": "Fade",
  "filters.mono": "Mono",
  "filters.noir": "Noir",
  "filters.sepia": "Sepia",
  "filters.strength": "Strength",
  "toolbar.groups.export": "Export",
  "tools.export": "Export",
  "export.title": "Export image",
  "export.description": "The file is made on this device, and nothing is uploaded.",
  "export.format": "Format",
  "export.formats.png": "PNG",
  "export.formats.jpeg": "JPEG",
  "export.formats.webp": "WebP",
  "export.quality": "Quality",
  "export.size": "Size",
  "export.sizes.scale": "Scale",
  "export.sizes.fit": "Fit in a box",
  "export.scale": "Scale, in percent",
  "export.fitWidth": "Largest width",
  "export.fitHeight": "Largest height",
  "export.fields": "Details to include",
  "export.fieldsHint": "Only what you fill in is written to the file.",
  "export.field.title": "Title",
  "export.field.description": "Description",
  "export.field.artist": "Artist",
  "export.field.copyright": "Copyright",
  "export.summary": "Summary",
  "export.output": "{width, number} × {height, number} pixels, {format}",
  "export.removed": "Removed from the file",
  "export.removedNone": "The image had no other details to remove.",
  "export.kind.location": "Location",
  "export.kind.camera": "Camera details",
  "export.kind.timestamps": "Dates and times",
  "export.kind.thumbnail": "Embedded thumbnail",
  "export.kind.colourProfile": "Colour profile: colours outside sRGB are clipped",
  "export.kind.other": "Other metadata",
  "export.kept": "Kept in the file",
  "export.confirm": "Export",
  "export.cancel": "Cancel",
  "export.progress": "Exporting the image",
  "export.stop": "Stop exporting",
  "export.cancelled": "Export stopped.",
  "export.done": "Exported a {format} of {size, fileSize}.",
  "export.ready": "{width, number} × {height, number} pixels, {format}, {size, fileSize}",
  "export.download": "Download",
  "export.close": "Done",
}) satisfies Record<`errors.${ImageErrorCode}`, MessageValue> &
  Record<`warnings.${ImageLimitName}`, MessageValue>;

/**
 * The type of {@link imageMessages}, for typing a host's overrides with
 * `MessageOverrides<ImageMessageCatalogue>`.
 *
 * @public
 */
export type ImageMessageCatalogue = typeof imageMessages;
