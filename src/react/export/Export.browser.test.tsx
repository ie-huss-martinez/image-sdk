import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadStyles } from "../../../test/browser/styles.js";
import { ImageError } from "../../core/errors/image-error.js";
import type { ImagePlan } from "../../core/model/plan.js";
import type { ImageProcessor } from "../../core/ports/image-processor.js";
import type { ImageSessionExport } from "../../core/session/session.js";
import { ImageEditor } from "../editor/ImageEditor.js";
import type { ImageEditorHandle, ImageEditorProps } from "../editor/types.js";

let unloadStyles: () => void = () => {};
beforeAll(async () => {
  unloadStyles = await loadStyles();
});
afterAll(() => unloadStyles());

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  vi.restoreAllMocks();
});

async function until(condition: () => boolean, what: string) {
  for (let i = 0; i < 200; i += 1) {
    if (condition()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 25)));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function opened(props: Partial<ImageEditorProps> = {}) {
  const changes: ImagePlan[] = [];
  const handle = createRef<ImageEditorHandle>();
  host = document.createElement("div");
  host.style.width = "900px";
  host.style.height = "600px";
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(<ImageEditor ref={handle} onChange={(plan) => changes.push(plan)} {...props} />),
  );
  const canvas = new OffscreenCanvas(30, 20);
  canvas.getContext("2d")?.fillRect(0, 0, 30, 20);
  const file = await canvas.convertToBlob();
  await act(async () => handle.current?.open(file));
  await until(() => handle.current?.session.getSnapshot().status === "ready", "the open");
  const session = () => {
    if (!handle.current) throw new Error("no handle");
    return handle.current.session;
  };
  return { session, changes, start: changes.length, handle };
}

const exportButton = () => {
  const found = document.querySelector<HTMLButtonElement>('button[data-tool="image.export"]');
  if (!found) throw new Error("no export button");
  return found;
};
const dialog = () => document.querySelector<HTMLDialogElement>("dialog[open]");
const inDialog = (name: string) => {
  const found = [...(dialog()?.querySelectorAll<HTMLElement>("button, input") ?? [])].find(
    (element) =>
      element.textContent?.trim() === name ||
      element.getAttribute("aria-label") === name ||
      (element as HTMLInputElement).labels?.[0]?.textContent?.trim() === name ||
      element.closest("label")?.textContent?.trim() === name,
  );
  if (!found) throw new Error(`no "${name}" in the dialog`);
  return found;
};
const click = (element: HTMLElement) => act(async () => element.click());
const summary = () => dialog()?.querySelector('[aria-label="Summary"]')?.textContent ?? "";
/** Types into a field as a person does: the native setter, then an input event. */
const type = (input: HTMLElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const announced = (text: string) => document.body.textContent?.includes(text) ?? false;

async function openDialog() {
  exportButton().focus();
  await click(exportButton());
  await until(() => dialog() !== null, "the dialog");
}

describe("the export dialog (docs/adr/0007)", () => {
  it("opens from the toolbar once there's an image, summarises, and cancels changing nothing", async () => {
    const { session, changes, start } = await opened();
    expect(exportButton().hasAttribute("aria-pressed")).toBe(false);
    await openDialog();
    expect(dialog()?.contains(document.activeElement)).toBe(true);
    expect(summary()).toContain("30 × 20 pixels, PNG");
    expect(summary()).toContain("The image had no other details to remove.");
    await click(inDialog("Cancel"));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(exportButton());
    expect(changes).toHaveLength(start);
    expect(session().getSnapshot().canUndo).toBe(false);
  });

  it("applies the size and kept fields as one step, exports, focuses Download, and announces", async () => {
    const { session, changes, start } = await opened();
    await openDialog();
    await click(inDialog("JPEG"));
    expect(dialog()?.querySelector('input[type="range"]')).not.toBeNull();
    const scale = inDialog("Scale, in percent");
    await act(async () => {
      scale.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(scale, "50");
      scale.dispatchEvent(new Event("input", { bubbles: true }));
      scale.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      scale.blur();
    });
    await type(inDialog("Title"), "Harbour at dusk");
    await until(() => summary().includes("15 × 10 pixels, JPEG"), "the summary's size");
    expect(summary()).toContain("Kept in the file");
    expect(summary()).toContain("Title");

    const saved: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push(this.download);
    });
    await click(inDialog("Export"));
    await until(() => dialog()?.textContent?.includes("Download") ?? false, "the result");
    expect(document.activeElement?.textContent).toBe("Download");
    expect(dialog()?.textContent).toContain("15 × 10 pixels, JPEG");
    await until(() => announced("Exported a JPEG of"), "the announcement");

    const plan = session().getSnapshot().plan;
    expect(plan?.output).toEqual({ kind: "scale", scale: 0.5 });
    expect(plan?.metadata.title).toBe("Harbour at dusk");
    expect(changes).toHaveLength(start + 1);

    await click(inDialog("Download"));
    expect(saved).toEqual(["image.jpg"]);
    await click(inDialog("Done"));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(exportButton());
  });

  it("gives the file to the host's onExport instead, and closes", async () => {
    const exports: { blob: Blob; details: ImageSessionExport }[] = [];
    await opened({ onExport: (blob, details) => exports.push({ blob, details }) });
    await openDialog();
    await click(inDialog("Export"));
    await until(() => exports.length === 1, "the host's export");
    expect(exports[0]?.blob.type).toBe("image/png");
    expect(exports[0]?.details).toMatchObject({ width: 30, height: 20, removed: [], kept: [] });
    await until(() => dialog() === null, "the dialog to close");
    expect(document.activeElement).toBe(exportButton());
  });

  it("shows the catalogue's text for a format the browser can't write, and keeps the choices", async () => {
    const processor: ImageProcessor = {
      export: async () => {
        throw new ImageError("UNSUPPORTED_FORMAT", "WebP can't be encoded here.", {
          details: { format: "webp" },
        });
      },
      destroy: async () => {},
    };
    await opened({ processor });
    await openDialog();
    await click(inDialog("WebP"));
    await click(inDialog("Export"));
    await until(() => dialog()?.querySelector('[role="alert"]') !== null, "the error");
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).not.toBe("");
    expect(dialog()?.querySelector('[role="alert"]')?.textContent).not.toContain(
      "can't be encoded here",
    );
    expect(inDialog("WebP").getAttribute("aria-checked")).toBe("true");
  });

  it("shows progress, and stops the export", async () => {
    const processor: ImageProcessor = {
      export: (_job, options) =>
        new Promise((_resolve, reject) => {
          options?.onProgress?.(0.4);
          options?.signal?.addEventListener("abort", () =>
            reject(new ImageError("ABORTED", "Stopped.")),
          );
        }),
      destroy: async () => {},
    };
    await opened({ processor });
    await openDialog();
    await click(inDialog("Export"));
    await until(() => dialog()?.querySelector("progress") !== null, "the progress");
    expect(dialog()?.querySelector("progress")?.value).toBe(40);
    await click(inDialog("Stop exporting"));
    await until(() => dialog()?.querySelector("progress") === null, "the stop");
    await until(() => announced("Export stopped."), "the announcement");
    expect(dialog()).not.toBeNull();
    expect(dialog()?.querySelector('[role="alert"]')).toBeNull();
  });

  it("starts fresh after something else closes it, ending its export", async () => {
    const signals: AbortSignal[] = [];
    const exports: Blob[] = [];
    const processor: ImageProcessor = {
      export: (_job, options) =>
        new Promise((_resolve, reject) => {
          if (options?.signal) signals.push(options.signal);
          options?.signal?.addEventListener("abort", () =>
            reject(new ImageError("ABORTED", "Stopped.")),
          );
        }),
      destroy: async () => {},
    };
    const { handle } = await opened({ processor, onExport: (blob) => exports.push(blob) });
    await openDialog();
    await click(inDialog("Fit in a box"));
    await click(inDialog("WebP"));
    expect(inDialog("Largest width")).toBeDefined();
    await click(inDialog("Export"));
    await until(() => dialog()?.querySelector("progress") !== null, "the export");

    // Another image opens through the handle, as a host's would: the editor
    // closes the dialog from outside it.
    const canvas = new OffscreenCanvas(40, 10);
    canvas.getContext("2d")?.fillRect(0, 0, 40, 10);
    const second = await canvas.convertToBlob();
    await act(async () => handle.current?.open(second));
    await until(() => handle.current?.session.getSnapshot().source?.width === 40, "the second");
    await until(() => dialog() === null, "the dialog to close");
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);

    await openDialog();
    expect(summary()).toContain("40 × 10 pixels, PNG");
    expect(inDialog("PNG").getAttribute("aria-checked")).toBe("true");
    expect(inDialog("Scale, in percent")).toBeDefined();
    expect(dialog()?.querySelector("progress")).toBeNull();
    expect(dialog()?.textContent).not.toContain("Download");
    expect(exports).toEqual([]);
  });

  it("keeps its keys from the editor's shortcuts", async () => {
    const { session } = await opened();
    await openDialog();
    await act(async () => {
      inDialog("JPEG").dispatchEvent(
        new KeyboardEvent("keydown", { key: "]", bubbles: true, cancelable: true }),
      );
    });
    expect(session().getSnapshot().plan?.base.orientation.rotate).toBe(0);
  });
});
