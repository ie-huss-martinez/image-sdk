import "@hussmartinez/ui/styles.css";
import "@hussmartinez/image-sdk/styles.css";
import { ImageEditor, type ImageEditorHandle } from "@hussmartinez/image-sdk/react";
import { createRef } from "react";
import { createRoot } from "react-dom/client";

/** The editor, as a host renders it: ui's stylesheet first, then the SDK's (sdk-core ADR 0036). */
const handle = createRef<ImageEditorHandle>();

declare global {
  interface Window {
    /** The editor's handle, for the end-to-end tests. */
    imageEditor: { open(bytes: ArrayBuffer): Promise<void>; status(): string };
  }
}

window.imageEditor = {
  open: async (bytes) => handle.current?.open(new Blob([bytes])),
  status: () => handle.current?.session.getSnapshot().status ?? "empty",
};

const element = document.querySelector("#editor");
if (element) {
  createRoot(element).render(
    <div style={{ height: "70vh" }}>
      <ImageEditor ref={handle} />
    </div>,
  );
}
