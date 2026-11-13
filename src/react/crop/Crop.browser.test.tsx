import { act, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { ImagePlan } from "../../core/model/plan.js";
import { ImageEditor } from "../editor/ImageEditor.js";
import type { ImageEditorHandle } from "../editor/types.js";

async function photo(): Promise<Blob> {
  const canvas = new OffscreenCanvas(30, 20);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2D canvas");
  context.fillRect(0, 0, 30, 20);
  return canvas.convertToBlob();
}

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

async function until(condition: () => boolean, what: string) {
  for (let i = 0; i < 200; i += 1) {
    if (condition()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 25)));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function opened(extra: { onChange?: (plan: ImagePlan) => void } = {}) {
  const handle = createRef<ImageEditorHandle>();
  host = document.createElement("div");
  host.style.width = "640px";
  host.style.height = "480px";
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<ImageEditor ref={handle} {...extra} />));
  await act(async () => handle.current?.open(await photo()));
  await until(() => handle.current?.session.getSnapshot().status === "ready", "the open");
  const session = () => {
    const current = handle.current;
    if (!current) throw new Error("no handle");
    return current.session;
  };
  return { handle, session, container: host };
}

const key = (target: Element | null, init: KeyboardEventInit) =>
  act(async () => {
    target?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  });

const frame = () => document.querySelector<HTMLElement>('[role="group"][aria-label="Crop area"]');

describe("cropping (docs/adr/0007)", () => {
  it("starts with C, on a focused, named frame over the whole image", async () => {
    await opened();
    await key(document.activeElement, { key: "c" });
    await until(() => frame() !== null, "the frame");
    expect(document.activeElement).toBe(frame());
    const description = document.getElementById(frame()?.getAttribute("aria-describedby") ?? "");
    expect(description?.textContent).toContain("30 × 20 pixels, from 0, 0");
    expect(document.querySelector('section[aria-label="Crop"]')).not.toBeNull();
    for (const handle of frame()?.querySelectorAll("[data-hm-handle]") ?? []) {
      expect(handle.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("moves and resizes with keys, and applies as one step and one change, returning focus", async () => {
    const changes: ImagePlan[] = [];
    const { session } = await opened({ onChange: (plan) => changes.push(plan) });
    const before = document.activeElement;
    const count = changes.length;
    await key(before, { key: "c" });
    await until(() => frame() !== null, "the frame");
    for (let i = 0; i < 10; i += 1) await key(frame(), { key: "ArrowLeft", altKey: true });
    await key(frame(), { key: "ArrowDown", altKey: true, shiftKey: true });
    await key(frame(), { key: "ArrowRight" });
    // Nothing is an edit until Enter.
    expect(changes).toHaveLength(count);
    expect(session().getSnapshot().plan?.base.crop).toBeNull();
    await key(frame(), { key: "Enter" });
    expect(session().getSnapshot().plan?.base.crop).toEqual({ x: 1, y: 0, width: 20, height: 20 });
    expect(changes).toHaveLength(count + 1);
    expect(frame()).toBeNull();
    expect(document.activeElement).toBe(before);
    expect(session().undo()).toBe(true);
    expect(session().getSnapshot().plan?.base.crop).toBeNull();
    expect(session().getSnapshot().canUndo).toBe(false);
  });

  it("cancels with Escape, changing nothing", async () => {
    const changes: ImagePlan[] = [];
    const { session } = await opened({ onChange: (plan) => changes.push(plan) });
    const count = changes.length;
    await key(document.activeElement, { key: "c" });
    await until(() => frame() !== null, "the frame");
    await key(frame(), { key: "ArrowLeft", altKey: true });
    await key(frame(), { key: "Escape" });
    expect(frame()).toBeNull();
    expect(session().getSnapshot()).toMatchObject({
      canUndo: false,
      plan: { base: { crop: null } },
    });
    expect(changes).toHaveLength(count);
  });

  it("crops to an aspect preset and the panel's fields", async () => {
    const { session } = await opened();
    await key(document.activeElement, { key: "c" });
    await until(() => frame() !== null, "the frame");
    const square = [...document.querySelectorAll<HTMLElement>("[role=radio]")].find(
      (option) => option.textContent === "1:1",
    );
    await act(async () => square?.click());
    const width = document.querySelector<HTMLInputElement>('section[aria-label="Crop"] input');
    expect(width).not.toBeNull();
    const fields = [
      ...document.querySelectorAll<HTMLInputElement>('section[aria-label="Crop"] input'),
    ];
    const left = fields[0];
    await act(async () => {
      if (!left) return;
      left.focus();
      // React tracks the value it set; the native setter is what typing does.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(left, "2");
      left.dispatchEvent(new Event("input", { bubbles: true }));
      left.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      left.blur();
    });
    const apply = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Apply crop",
    );
    await act(async () => apply?.click());
    expect(session().getSnapshot().plan?.base.crop).toEqual({ x: 2, y: 0, width: 20, height: 20 });
  });

  it("drags a handle by the pointer, in source pixels", async () => {
    const { session } = await opened();
    await key(document.activeElement, { key: "c" });
    await until(() => frame() !== null, "the frame");
    const rect = frame()?.getBoundingClientRect();
    if (!rect) throw new Error("no frame");
    const scale = rect.width / 30;
    const corner = frame()?.querySelector('[data-hm-handle="se"]');
    const pointer = (type: string, x: number, y: number) =>
      act(async () => {
        corner?.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 7,
            clientX: x,
            clientY: y,
            button: 0,
            bubbles: true,
          }),
        );
      });
    await pointer("pointerdown", rect.right, rect.bottom);
    await pointer("pointermove", rect.right - 10 * scale, rect.bottom - 5 * scale);
    await pointer("pointerup", rect.right - 10 * scale, rect.bottom - 5 * scale);
    await key(frame(), { key: "Enter" });
    expect(session().getSnapshot().plan?.base.crop).toEqual({ x: 0, y: 0, width: 20, height: 15 });
  });

  it("moves the frame as seen on screen when the image is turned", async () => {
    const { session } = await opened();
    session().execute({
      type: "image.setOrientation",
      orientation: { rotate: 90, flipX: false, flipY: false },
    });
    await key(document.activeElement, { key: "c" });
    await until(() => frame() !== null, "the frame");
    // Turned clockwise, the screen's right edge is the source's top: shrink it,
    // then move the frame right on screen, which is up in the source.
    for (let i = 0; i < 5; i += 1) await key(frame(), { key: "ArrowLeft", altKey: true });
    // The frame's own placement: these tests don't load the stylesheet.
    const left = () => Number.parseFloat(frame()?.style.left ?? "0");
    const startLeft = left();
    for (let i = 0; i < 3; i += 1) await key(frame(), { key: "ArrowRight" });
    expect(left()).toBeGreaterThan(startLeft);
    await key(frame(), { key: "Enter" });
    expect(session().getSnapshot().plan?.base.crop).toEqual({ x: 0, y: 2, width: 30, height: 15 });
  });
});

/** A host that holds the plan, and hands its setter to the test. */
const hosted = { handle: createRef<ImageEditorHandle>(), setPlan: (_plan: ImagePlan) => {} };
function Host() {
  const [plan, set] = useState<ImagePlan>();
  hosted.setPlan = set;
  return <ImageEditor ref={hosted.handle} {...(plan ? { plan } : {})} onChange={set} />;
}

describe("the controlled plan (docs/adr/0007)", () => {
  it("applies a host's plan as one step, and settles when the host echoes it", async () => {
    const { handle } = hosted;
    const setPlan = (plan: ImagePlan) => hosted.setPlan(plan);
    host = document.createElement("div");
    host.style.height = "480px";
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<Host />));
    await act(async () => handle.current?.open(await photo()));
    await until(() => handle.current?.session.getSnapshot().status === "ready", "the open");
    const current = handle.current?.session.getSnapshot().plan;
    if (!current) throw new Error("no plan");
    await act(async () =>
      setPlan({
        ...current,
        base: { ...current.base, crop: { x: 5, y: 5, width: 10, height: 10 } },
      }),
    );
    expect(handle.current?.session.getSnapshot().plan?.base.crop).toEqual({
      x: 5,
      y: 5,
      width: 10,
      height: 10,
    });
    expect(handle.current?.session.undo()).toBe(true);
    expect(handle.current?.session.getSnapshot().canUndo).toBe(false);
  });
});
