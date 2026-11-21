import { defineMessages } from "@hussmartinez/sdk-core";
import { uiMessages } from "@hussmartinez/ui";
import type { ImageEditorMessageCatalogue } from "../messages/editor-catalogue.js";
import { imageEditorText } from "../messages/editor-en.js";
import { imageMessages } from "../messages/en.js";

/**
 * The English message catalogue of the SDK's components: `imageMessages`,
 * with sdk-core's text, errors and warnings; `@hussmartinez/ui`'s, for the
 * ui components the editor renders (sdk-core ADR 0046); and the text of the
 * editor, its stage, toolbar and tools, its panels and the export dialog.
 *
 * `ImageEditor`, `ImageEditorProvider` and `<hm-image-editor>` each build
 * one `Messages` object from it, with the host's locale and overrides, and
 * the editor gives the same object to its own components and to ui's.
 * Override any of its keys through their `messages`, typed with
 * `ImageEditorMessageCatalogue`, from `.`.
 *
 * It's defined in the React entry, so the server-safe `.` entry and its
 * `imageMessages` carry no interface text (sdk-core ADR 0059).
 *
 * @public
 */
export const imageEditorMessages: ImageEditorMessageCatalogue = /* @__PURE__ */ editorCatalogue();

/**
 * Builds {@link imageEditorMessages}. A function, so the call can be marked
 * free of side effects: the spreads of the other catalogues otherwise keep
 * all the text in every bundle that imports this module (sdk-core ADR 0056).
 */
function editorCatalogue(): ImageEditorMessageCatalogue {
  return defineMessages({ ...imageMessages, ...uiMessages, ...imageEditorText });
}
