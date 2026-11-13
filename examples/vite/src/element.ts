import "@hussmartinez/ui/styles.css";
import "@hussmartinez/image-sdk/styles.css";
import { defineImageEditorElement } from "@hussmartinez/image-sdk/element";

/**
 * The element, as a host without React uses it: ui's stylesheet first, then
 * the SDK's (sdk-core ADR 0036), and the element registered explicitly.
 */
defineImageEditorElement();

declare global {
  interface Window {
    /** The element's events, by name and detail as JSON, for the end-to-end tests. */
    imageElementEvents: { name: string; json: string }[];
  }
}

window.imageElementEvents = [];
const editor = document.querySelector("hm-image-editor");
for (const name of ["change", "event", "export", "error"]) {
  editor?.addEventListener(`hm-image-editor-${name}`, (event) => {
    window.imageElementEvents.push({ name, json: JSON.stringify((event as CustomEvent).detail) });
  });
}
