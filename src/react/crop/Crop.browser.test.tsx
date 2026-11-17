import { act, createRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadStyles } from "../../../test/browser/styles.js";
import { FIRST_OPEN_TIMEOUT } from "../../../test/browser/timeouts.js";
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

async function opened(
  extra: { onChange?: (plan: ImagePlan) => void } = {},
  dir: "ltr" | "rtl" = "ltr",
) {
  const handle = createRef<ImageEditorHandle>();
  host = document.createElement("div");
  host.dir = dir;
  // Inside the test page's viewport, so hit tests reach every handle.
  host.style.width = "380px";
  host.style.height = "480px";
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<ImageEditor ref={handle} {...extra} />));
  await act(async () => handle.current?.open(await photo()));
  await until(
    () => handle.current?.session.getSnapshot().status === "ready",
    "the open",
    FIRST_OPEN_TIMEOUT,
  );
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
const stageBox = () => document.querySelector(".hm-image-stage")?.getBoundingClientRect();
const handlesInsideStage = () => {
  const box = stageBox();
  const handles = [...(frame()?.querySelectorAll("[data-hm-handle]") ?? [])];
  return (
    box !== undefined &&
    handles.length === 8 &&
    handles.every((handle) => {
      const h = handle.getBoundingClientRect();
      return (
        h.top >= box.top && h.left >= box.left && h.bottom <= box.bottom && h.right <= box.right
      );
    })
  );
};

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

  it("keeps every handle whole inside the stage, where the image meets its edges", async () => {
    await opened();
    await key(document.activeElement, { key: "c" });
    await until(() => frame() !== null, "the frame");
    // Cropping swaps the inspector's panel, which resizes the stage under it;
    // the frame follows once the stage's resize observer reports.
    await until(handlesInsideStage, "the frame to follow the stage's size");
    const stage = stageBox();
    if (!stage) throw new Error("no stage");
    for (const handle of frame()?.querySelectorAll("[data-hm-handle]") ?? []) {
      const box = handle.getBoundingClientRect();
      const name = handle.getAttribute("data-hm-handle") ?? "";
      expect(box.width, `${name} target`).toBeGreaterThanOrEqual(24);
      expect(box.left, name).toBeGreaterThanOrEqual(stage.left);
      expect(box.top, name).toBeGreaterThanOrEqual(stage.top);
      expect(box.right, name).toBeLessThanOrEqual(stage.right);
      expect(box.bottom, name).toBeLessThanOrEqual(stage.bottom);
      // A pointer at the handle's centre hits the handle.
      const centre = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      expect(centre, name).toBe(handle);
    }
  });

  it("moves and resizes with keys, and applies as one step and one change, returning focus", async () => {
    const changes: ImagePlan[] = [];
    const { session } = await opened({ onChange: (plan) => changes.push(plan) });
    const before = document.activeElement;
    const count = changes.length;
    await key(before, { key: "c" });
    await until(() => frame() !== null, "the frame");
    for (let i = 0; i < 10; i += 1) await key(frame(), { key: "ArrowLeft", shiftKey: true });
    await key(frame(), { key: "ArrowDown", shiftKey: true });
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

  it("takes the arrows alone and with Shift, and leaves Alt, Control and Meta to the browser", async () => {
    await opened();
    await key(document.activeElement, { key: "c" });
    await until(() => frame() !== null, "the frame");
    const described = () =>
      document.getElementById(frame()?.getAttribute("aria-describedby") ?? "")?.textContent ?? "";
    /** Presses a key on the frame, and says whether the frame took it from the browser. */
    const press = async (init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      await act(async () => {
        frame()?.dispatchEvent(event);
      });
      return event.defaultPrevented;
    };
    // Shift resizes, by the right and bottom edges, one pixel a press.
    expect(await press({ key: "ArrowLeft", shiftKey: true })).toBe(true);
    expect(await press({ key: "ArrowUp", shiftKey: true })).toBe(true);
    expect(described()).toContain("29 × 19 pixels, from 0, 0");
    // The arrows alone move it, one pixel a press.
    expect(await press({ key: "ArrowRight" })).toBe(true);
    expect(await press({ key: "ArrowDown" })).toBe(true);
    expect(described()).toContain("29 × 19 pixels, from 1, 1");
    // Alt+Left and Alt+Right are the browser's Back and Forward, and the
    // other modifiers have their own uses: none is prevented, none moves it.
    for (const modifier of ["altKey", "ctrlKey", "metaKey"] as const) {
      for (const arrow of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
        expect(await press({ key: arrow, [modifier]: true }), `${modifier} ${arrow}`).toBe(false);
        expect(await press({ key: arrow, [modifier]: true, shiftKey: true })).toBe(false);
      }
    }
    expect(described()).toContain("29 × 19 pixels, from 1, 1");
    expect(described()).toContain("with Shift, they resize it");
  });

  it("cancels with Escape, changing nothing", async () => {
    const changes: ImagePlan[] = [];
    const { session } = await opened({ onChange: (plan) => changes.push(plan) });
    const count = changes.length;
    await key(document.activeElement, { key: "c" });
    await until(() => frame() !== null, "the frame");
    await key(frame(), { key: "ArrowLeft", shiftKey: true });
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
    // Opening the crop panel resizes the stage. Measure pointer coordinates
    // only after its observer has placed the handles inside the current stage.
    await until(handlesInsideStage, "the frame to follow the stage's size");
    const rect = frame()?.getBoundingClientRect();
    if (!rect) throw new Error("no frame");
    // The stage has its own size, not the canvas's, so the frame has one too.
    expect(rect.width).toBeGreaterThan(30);
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
    for (let i = 0; i < 5; i += 1) await key(frame(), { key: "ArrowLeft", shiftKey: true });
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
    await until(
      () => handle.current?.session.getSnapshot().status === "ready",
      "the open",
      FIRST_OPEN_TIMEOUT,
    );
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

describe("cropping in a right-to-left page (docs/adr/0007)", () => {
  it("keeps each handle on the edge of the image it moves", async () => {
    await opened({}, "rtl");
    await key(document.activeElement, { key: "c" });
    await until(() => frame() !== null, "the frame");
    const box = frame()?.getBoundingClientRect();
    if (!box) throw new Error("no frame");
    const handles = frame()?.querySelectorAll<HTMLElement>("[data-hm-handle]") ?? [];
    expect(handles).toHaveLength(8);
    for (const handle of handles) {
      const name = handle.getAttribute("data-hm-handle") ?? "";
      const at = handle.getBoundingClientRect();
      const centre = at.left + at.width / 2;
      const middle = at.top + at.height / 2;
      // The image isn't mirrored in a right-to-left page, so east is still
      // its right edge on screen.
      if (name.includes("e")) expect(Math.abs(centre - box.right), name).toBeLessThanOrEqual(1);
      else if (name.includes("w")) expect(Math.abs(centre - box.left), name).toBeLessThanOrEqual(1);
      else expect(Math.abs(centre - (box.left + box.width / 2)), name).toBeLessThanOrEqual(1);
      if (name.includes("n")) expect(Math.abs(middle - box.top), name).toBeLessThanOrEqual(1);
      else if (name.includes("s"))
        expect(Math.abs(middle - box.bottom), name).toBeLessThanOrEqual(1);
      else expect(Math.abs(middle - (box.top + box.height / 2)), name).toBeLessThanOrEqual(1);
    }
  });

  it("moves the frame with the arrows as the image is seen, left for ArrowLeft", async () => {
    await opened({}, "rtl");
    await key(document.activeElement, { key: "c" });
    await until(() => frame() !== null, "the frame");
    // Narrower than the image, and off its left edge, so it can move both ways.
    for (let i = 0; i < 10; i += 1) await key(frame(), { key: "ArrowLeft", shiftKey: true });
    await key(frame(), { key: "ArrowRight" });
    await key(frame(), { key: "ArrowRight" });
    const start = frame()?.getBoundingClientRect().left ?? 0;
    await key(frame(), { key: "ArrowRight" });
    const right = frame()?.getBoundingClientRect().left ?? 0;
    expect(right).toBeGreaterThan(start);
    await key(frame(), { key: "ArrowLeft" });
    await key(frame(), { key: "ArrowLeft" });
    expect(frame()?.getBoundingClientRect().left ?? 0).toBeLessThan(start);
  });
});
