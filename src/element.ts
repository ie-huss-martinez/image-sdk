/**
 * The `<hm-image-editor>` custom element of the image SDK.
 *
 * @remarks
 * Importing this entry registers nothing: applications call
 * `defineImageEditorElement()` themselves, and importing it on a server does
 * nothing (ADR 0004, ADR 0007). The element renders `<ImageEditor>` into its
 * light DOM, so React and React DOM, the package's optional peer
 * dependencies, are needed here. Hosts import `@hussmartinez/ui/styles.css`
 * once, then this package's `styles.css` (sdk-core ADR 0036).
 *
 * @packageDocumentation
 */

import { createEditorElement } from "@hussmartinez/sdk-core/element";
import {
  type ImageEditorElementEvent,
  type ImageEditorElementMethods,
  type ImageEditorElementProps,
  mountImageEditor,
} from "./react/element/mount.js";

export type { ImageExportReport } from "./react/export/export-listener.js";
export type { ImageEditorElementEvent, ImageEditorElementMethods, ImageEditorElementProps };

/** A space-separated list, as the `tools` attribute holds. */
const words = (value: string): readonly string[] => value.split(/\s+/).filter(Boolean);

/**
 * Registers `<hm-image-editor>`, or the tag you name, and returns its class
 * (docs/adr/0007, sdk-core ADR 0040): the attributes `theme`, `locale` and
 * `tools`; the properties `file`, `plan`, `filePolicy`, `assetsUrl`,
 * `messages`, `engine` and `processor`; the methods `open`, `execute`,
 * `export`, `undo` and `redo`; and the events `hm-image-editor-change`,
 * `-event`, `-export` and `-error`. Calling it again returns the same class.
 *
 * @example
 * ```ts
 * import { defineImageEditorElement } from "@hussmartinez/image-sdk/element";
 *
 * defineImageEditorElement();
 * const editor = document.querySelector("hm-image-editor");
 * editor.file = file;
 * editor.addEventListener("hm-image-editor-change", (event) => save(event.detail));
 * ```
 *
 * @public
 */
export const defineImageEditorElement = /* @__PURE__ */ createEditorElement<
  Partial<ImageEditorElementProps>,
  ImageEditorElementMethods,
  ImageEditorElementEvent
>({
  kind: "image",
  attributes: {
    theme: "theme",
    locale: "locale",
    tools: { property: "tools", parse: words },
  },
  properties: ["file", "plan", "filePolicy", "assetsUrl", "messages", "engine", "processor"],
  methods: ["open", "execute", "export", "undo", "redo"],
  events: ["change", "event", "export", "error"],
  mount: mountImageEditor,
});
