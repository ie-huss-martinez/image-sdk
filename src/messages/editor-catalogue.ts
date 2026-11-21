import type { uiMessages } from "@hussmartinez/ui";
import type { imageEditorText } from "./editor-en.js";
import type { imageMessages } from "./en.js";

/**
 * The shape of the editor's catalogue, `imageEditorMessages`, from the
 * React entry: `imageMessages`, `@hussmartinez/ui`'s messages and the
 * editor's own text, as one catalogue for one `Messages` object (sdk-core
 * ADR 0046). Type overrides of any of its keys with
 * `MessageOverrides<ImageEditorMessageCatalogue>`.
 *
 * It's exported from `.`, which costs no bytes there, because `./react` and
 * `./element` both use it (sdk-core ADRs 0033 and 0059). Only types are
 * imported here, so `.` still carries no interface text.
 *
 * @public
 */
export type ImageEditorMessageCatalogue = typeof imageMessages &
  typeof uiMessages &
  typeof imageEditorText;
