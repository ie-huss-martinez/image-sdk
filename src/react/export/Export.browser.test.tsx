import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadStyles } from "../../../test/browser/styles.js";
import { FIRST_OPEN_TIMEOUT } from "../../../test/browser/timeouts.js";
import { writeGif } from "../../../test/fixtures/gif-writer.js";
import { readGifFrames } from "../../adapters/gif/frames.js";
import { ImageError } from "../../core/errors/image-error.js";
import type { ImagePlan } from "../../core/model/plan.js";
import type { ImageProcessor } from "../../core/ports/image-processor.js";
import type { ImageSessionEvent, ImageSessionExport } from "../../core/session/session.js";
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

async function until(condition: () => boolean, what: string, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (condition()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 25)));
  }
  if (condition()) return;
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
  await until(
    () => handle.current?.session.getSnapshot().status === "ready",
    "the open",
    FIRST_OPEN_TIMEOUT,
  );
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

  it("ends redacting when it's used, with a gesture still running made its step first", async () => {
    const { session } = await opened();
    await click(document.querySelector('[data-tool="image.redact"]') as HTMLElement);
    await click(
      [...document.querySelectorAll("button")].find(
        (b) => b.textContent === "Add area",
      ) as HTMLElement,
    );
    await until(() => document.querySelector(".hm-image-redact-frame") !== null, "the frame");
    const frame = () => document.querySelector<HTMLElement>(".hm-image-redact-frame");
    const before = session().getSnapshot().plan?.redactions[0];
    // A key moves the area on the stage; the step waits for the keys to stop.
    await act(async () => {
      frame()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      );
    });
    expect(session().getSnapshot().plan?.redactions[0]).toEqual(before);
    // Export is there to use, not greyed out.
    expect(exportButton().disabled).toBe(false);
    expect(exportButton().getAttribute("aria-disabled")).not.toBe("true");
    await openDialog();
    // Redacting ended, and the move is in the plan the dialog exports.
    expect(document.querySelector('section[aria-label="Redact"]')).toBeNull();
    expect(frame()).toBeNull();
    expect(session().getSnapshot().plan?.redactions[0]).toMatchObject({
      x: (before?.x ?? 0) + 1,
      y: before?.y,
    });
    expect(summary()).toContain("1 area is redacted.");
    expect(dialog()?.contains(document.activeElement)).toBe(true);
    // One step for the area and one for the move: nothing else was added.
    expect(session().undo()).toBe(true);
    expect(session().undo()).toBe(true);
    expect(session().undo()).toBe(false);
  });

  it("ends the layers when it's used, with text still being typed in the export", async () => {
    const { session } = await opened();
    await click(document.querySelector('[data-tool="image.add-text"]') as HTMLElement);
    const field = () =>
      document.querySelector<HTMLTextAreaElement>(".hm-image-layers-text textarea");
    await until(() => document.activeElement === field(), "focus in the text field");
    await act(async () => {
      const input = field() as HTMLTextAreaElement;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        input,
        "Hi",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Typed, and not yet a step.
    expect(session().getSnapshot().plan?.layers[0]).toMatchObject({ text: "" });
    await openDialog();
    expect(document.querySelector('section[aria-label="Layers"]')).toBeNull();
    expect(session().getSnapshot().plan?.layers[0]).toMatchObject({ kind: "text", text: "Hi" });
    // Closing it returns to the image, with the layers closed.
    await click(inDialog("Cancel"));
    expect(dialog()).toBeNull();
    expect(document.querySelector('[data-tool="image.layers"]')?.getAttribute("aria-pressed")).toBe(
      "false",
    );
    expect(document.activeElement).not.toBe(document.body);
  });

  it("waits while a crop is unapplied, and says why, on a button the keyboard can reach", async () => {
    const { session } = await opened();
    await click(document.querySelector('[data-tool="image.crop"]') as HTMLElement);
    await until(() => document.querySelector('[aria-label="Crop area"]') !== null, "cropping");
    const button = exportButton();
    // Disabled for assistive technology, but still focusable, so its reason can be read.
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.disabled).toBe(false);
    const described = (button.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(described).toContain("Apply or cancel the crop before exporting.");
    button.focus();
    expect(document.activeElement).toBe(button);
    // Pressing it does nothing: the crop is neither applied nor lost.
    await click(button);
    expect(dialog()).toBeNull();
    expect(document.querySelector('[aria-label="Crop area"]')).not.toBeNull();
    expect(session().getSnapshot().canUndo).toBe(false);
    // Once the crop is applied or cancelled, it's an ordinary button again.
    await click(
      [...document.querySelectorAll("button")].find(
        (b) => b.textContent === "Cancel",
      ) as HTMLElement,
    );
    await until(
      () => document.querySelector('[aria-label="Crop area"]') === null,
      "the crop to end",
    );
    expect(exportButton().getAttribute("aria-disabled")).not.toBe("true");
    expect(exportButton().hasAttribute("aria-describedby")).toBe(false);
    await openDialog();
    expect(dialog()).not.toBeNull();
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
    await until(() => announced("Exported a JPEG of"), "the announcement", FIRST_OPEN_TIMEOUT);

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

  it("tells the host's onEvent when Download is pressed, not when the file is ready", async () => {
    const events: ImageSessionEvent[] = [];
    await opened({ onEvent: (event) => events.push(event) });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await openDialog();
    await click(inDialog("Export"));
    await until(() => dialog()?.textContent?.includes("Download") ?? false, "the result");
    const types = () => events.map((event) => event.type);
    // Ready to save, but not saved: no download yet.
    expect(types()).toContain("export");
    expect(types()).not.toContain("download");
    await click(inDialog("Download"));
    expect(events.at(-1)).toEqual({ type: "download", outcome: "done", commands: [] });
    // It carries what the export's event carries, and nothing about the file.
    const exported = events.find((event) => event.type === "export");
    expect(Object.keys(events.at(-1) ?? {}).sort()).toEqual(Object.keys(exported ?? {}).sort());
    // Each press is a download.
    await click(inDialog("Download"));
    expect(types().filter((type) => type === "download")).toHaveLength(2);
    // Closing without pressing it again sends nothing.
    await click(inDialog("Done"));
    expect(types().filter((type) => type === "download")).toHaveLength(2);
  });

  it("sends no download event when the host's onExport saves the file", async () => {
    const events: ImageSessionEvent[] = [];
    const exports: Blob[] = [];
    await opened({
      onEvent: (event) => events.push(event),
      onExport: (blob) => exports.push(blob),
    });
    await openDialog();
    await click(inDialog("Export"));
    await until(() => exports.length === 1, "the host's export");
    expect(events.map((event) => event.type)).toContain("export");
    expect(events.map((event) => event.type)).not.toContain("download");
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

  it("exports an animation as a GIF of all its frames, and says a GIF keeps no details", async () => {
    const exports: { blob: Blob; details: ImageSessionExport }[] = [];
    const { handle } = await opened({
      onExport: (blob, details) => exports.push({ blob, details }),
    });
    // An animated GIF of three frames replaces the still.
    const gif = writeGif({
      width: 6,
      height: 4,
      palette: [
        [255, 0, 0],
        [0, 0, 255],
      ],
      loop: 0,
      frames: [0, 1, 0].map((index) => ({
        pixels: Array.from({ length: 24 }, () => index),
        delay: 8,
      })),
    });
    await act(async () => handle.current?.open(new Blob([gif.slice()], { type: "image/gif" })));
    await until(
      () => handle.current?.session.getSnapshot().plan?.animation?.frames.length === 3,
      "the animation",
      FIRST_OPEN_TIMEOUT,
    );
    await openDialog();
    // A GIF opens to export as a GIF, with no quality to choose.
    expect(inDialog("GIF").getAttribute("aria-checked")).toBe("true");
    expect(dialog()?.textContent).not.toContain("Quality");
    // A title typed in isn't written to a GIF, and the dialog says so.
    await type(inDialog("Title"), "Party");
    expect(dialog()?.textContent).toContain(
      "A GIF file carries no details: these aren't written to it.",
    );
    expect(summary()).not.toContain("Kept in the file");
    await click(inDialog("Export"));
    await until(() => exports.length === 1, "the host's export", 20_000);
    expect(exports[0]?.blob.type).toBe("image/gif");
    expect(exports[0]?.details).toMatchObject({ width: 6, height: 4, kept: [] });
    const written = new Uint8Array(await (exports[0] as { blob: Blob }).blob.arrayBuffer());
    const file = readGifFrames(written);
    expect(file.frames.map((frame) => frame.delay)).toEqual([8, 8, 8]);
    expect(file.loop).toBe(0);
    // And PNG, chosen instead, is one frame with the title kept.
    await openDialog();
    await click(inDialog("PNG"));
    expect(summary()).toContain("Kept in the file");
    // WebP keeps no details either, and says so: the summary never claims what isn't written.
    await click(inDialog("WebP"));
    expect(summary()).not.toContain("Kept in the file");
    expect(dialog()?.textContent).toContain(
      "A WebP file carries no details: these aren't written to it.",
    );
    await click(inDialog("JPEG"));
    expect(summary()).toContain("Kept in the file");
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
          // As a real export does: refused at once if it's already aborted.
          if (options?.signal?.aborted) {
            reject(new ImageError("ABORTED", "Stopped."));
            return;
          }
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
          // As a real export does: refused at once if it's already aborted.
          if (options?.signal?.aborted) {
            reject(new ImageError("ABORTED", "Stopped."));
            return;
          }
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

  it("takes 2,000 emoji in a field, as the plan counts code points, and clamps more", async () => {
    const { session } = await opened();
    await openDialog();
    await type(inDialog("Title"), "📷".repeat(2_001));
    expect((inDialog("Title") as HTMLInputElement).value).toBe("📷".repeat(2_000));
    await click(inDialog("Export"));
    await until(() => session().getSnapshot().plan?.metadata.title !== "", "the title");
    expect(session().getSnapshot().plan?.metadata.title).toBe("📷".repeat(2_000));
  });

  it("shows the quality as a percentage, and says it", async () => {
    await opened();
    await openDialog();
    await click(inDialog("JPEG"));
    const quality = dialog()?.querySelector<HTMLInputElement>('input[type="range"]');
    expect(quality?.labels?.[0]?.textContent).toBe("Quality");
    expect(quality?.getAttribute("aria-valuetext")).toBe("92%");
    expect(dialog()?.querySelector(".hm-image-adjust-value")?.textContent).toBe("92%");
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
