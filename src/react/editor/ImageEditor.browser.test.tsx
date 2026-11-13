import { act, createRef, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadStyles } from "../../../test/browser/styles.js";
import type { ImagePlan } from "../../core/model/plan.js";
import { ImageEditor } from "./ImageEditor.js";
import type { ImageEditorHandle } from "./types.js";

/** A 30 × 20 PNG the browser encodes. */
async function photo(): Promise<Blob> {
  const canvas = new OffscreenCanvas(30, 20);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2D canvas");
  context.fillStyle = "#3080c0";
  context.fillRect(0, 0, 30, 20);
  return canvas.convertToBlob();
}

// The editor as hosts lay it out, with ui's stylesheet and the package's.
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
  root = undefined;
  host = undefined;
});

async function mount(element: Parameters<Root["render"]>[0]) {
  host = document.createElement("div");
  host.style.width = "640px";
  host.style.height = "480px";
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(element));
  return host;
}

/** Waits for a condition the editor reaches asynchronously, such as an open. */
async function until(condition: () => boolean, what: string) {
  for (let i = 0; i < 200; i += 1) {
    if (condition()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 25)));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const button = (container: HTMLElement, tool: string) => {
  const found = container.querySelector<HTMLButtonElement>(`button[data-tool="${tool}"]`);
  if (!found) throw new Error(`no ${tool} button`);
  return found;
};

describe("ImageEditor (docs/adr/0007)", () => {
  it("starts empty, with a button to choose an image, and no named canvas", async () => {
    const container = await mount(<ImageEditor />);
    expect(container.querySelector("section")?.getAttribute("aria-label")).toBe("Image editor");
    expect(container.textContent).toContain("Choose an image");
    const canvas = container.querySelector("canvas");
    expect(canvas?.hidden).toBe(true);
    expect(button(container, "image.rotate-left").disabled).toBe(true);
  });

  it("opens an image into a named, unfocusable canvas, and moves focus to the first tool", async () => {
    const handle = createRef<ImageEditorHandle>();
    const container = await mount(<ImageEditor ref={handle} />);
    await act(async () => handle.current?.open(await photo()));
    await until(() => handle.current?.session.getSnapshot().status === "ready", "the open");
    const canvas = container.querySelector("canvas");
    expect(canvas?.getAttribute("role")).toBe("img");
    expect(canvas?.getAttribute("aria-label")).toBe("Edited image preview, 30 × 20");
    expect(canvas?.hidden).toBe(false);
    expect(canvas?.hasAttribute("tabindex")).toBe(false);
    expect(canvas?.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(button(container, "image.rotate-left"));
  });

  it("rotates from the toolbar, names the turned image, undoes, and tells the host once per change", async () => {
    const handle = createRef<ImageEditorHandle>();
    const changes: ImagePlan[] = [];
    const container = await mount(
      <ImageEditor ref={handle} onChange={(plan) => changes.push(plan)} />,
    );
    await act(async () => handle.current?.open(await photo()));
    await until(() => handle.current?.session.getSnapshot().status === "ready", "the open");
    const opened = changes.length;
    await act(async () => button(container, "image.rotate-right").click());
    expect(handle.current?.session.getSnapshot().plan?.base.orientation.rotate).toBe(90);
    expect(container.querySelector("canvas")?.getAttribute("aria-label")).toBe(
      "Edited image preview, 20 × 30",
    );
    expect(changes).toHaveLength(opened + 1);
    await act(async () => button(container, "image.undo").click());
    expect(handle.current?.session.getSnapshot().plan?.base.orientation.rotate).toBe(0);
    await until(
      () => document.body.textContent?.includes("Undid rotate or flip.") ?? false,
      "the announcement",
    );
  });

  it("flips from the toolbar, and crops from its button, which shows it's active", async () => {
    const handle = createRef<ImageEditorHandle>();
    const container = await mount(<ImageEditor ref={handle} />);
    await act(async () => handle.current?.open(await photo()));
    await until(() => handle.current?.session.getSnapshot().status === "ready", "the open");
    await act(async () => button(container, "image.flip-horizontal").click());
    await act(async () => button(container, "image.flip-vertical").click());
    expect(handle.current?.session.getSnapshot().plan?.base.orientation).toEqual({
      rotate: 0,
      flipX: true,
      flipY: true,
    });
    const crop = button(container, "image.crop");
    expect(crop.getAttribute("aria-pressed")).toBe("false");
    await act(async () => crop.click());
    expect(crop.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[role="group"][aria-label="Crop area"]')).not.toBeNull();
    for (const tool of ["image.flip-horizontal", "image.crop", "image.zoom-fit"]) {
      expect(button(container, tool).querySelector("svg"), tool).not.toBeNull();
    }
  });

  it("takes shortcuts while focus is inside it, and not from outside", async () => {
    const handle = createRef<ImageEditorHandle>();
    const container = await mount(<ImageEditor ref={handle} />);
    await act(async () => handle.current?.open(await photo()));
    await until(() => handle.current?.session.getSnapshot().status === "ready", "the open");
    const press = (target: EventTarget, key: string) =>
      act(async () => {
        target.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
        );
      });
    await press(document.body, "]");
    expect(handle.current?.session.getSnapshot().plan?.base.orientation.rotate).toBe(0);
    await press(button(container, "image.rotate-left"), "]");
    expect(handle.current?.session.getSnapshot().plan?.base.orientation.rotate).toBe(90);
    expect(button(container, "image.rotate-right").getAttribute("aria-keyshortcuts")).toBe("]");
    expect(button(container, "image.crop").getAttribute("aria-keyshortcuts")).toBe("C");
  });

  it("keeps one canvas under StrictMode, which mounts effects twice", async () => {
    const handle = createRef<ImageEditorHandle>();
    const container = await mount(
      <StrictMode>
        <ImageEditor ref={handle} />
      </StrictMode>,
    );
    await act(async () => handle.current?.open(await photo()));
    await until(() => handle.current?.session.getSnapshot().status === "ready", "the open");
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    expect(container.querySelector("canvas")?.getAttribute("aria-label")).toBe(
      "Edited image preview, 30 × 20",
    );
  });

  it("fits a narrow container, wrapping its toolbar rather than overflowing", async () => {
    const handle = createRef<ImageEditorHandle>();
    const container = await mount(<ImageEditor ref={handle} />);
    container.style.width = "320px";
    await act(async () => handle.current?.open(await photo()));
    await until(() => handle.current?.session.getSnapshot().status === "ready", "the open");
    const editor = container.querySelector("section");
    expect(editor?.getBoundingClientRect().width).toBeLessThanOrEqual(320);
    expect(editor?.scrollWidth).toBeLessThanOrEqual(320);
  });

  it("renders its empty state on a server, with no canvas", () => {
    const html = renderToString(<ImageEditor />);
    expect(html).toContain("Choose an image");
    expect(html).not.toContain("<canvas");
  });
});
