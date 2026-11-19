import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadStyles } from "../../../test/browser/styles.js";
import { FIRST_OPEN_TIMEOUT } from "../../../test/browser/timeouts.js";
import type { ImagePlan, ImageRedaction } from "../../core/model/plan.js";
import { ImageEditor } from "../editor/ImageEditor.js";
import type { ImageEditorHandle } from "../editor/types.js";
import { KEYBOARD_COMMIT_DELAY } from "../gesture.js";

/** A 60 × 40 PNG the browser encodes. */
async function photo(): Promise<Blob> {
  const canvas = new OffscreenCanvas(60, 40);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2D canvas");
  context.fillStyle = "#3080c0";
  context.fillRect(0, 0, 60, 40);
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

async function opened(extra: { onChange?: (plan: ImagePlan) => void } = {}) {
  const handle = createRef<ImageEditorHandle>();
  host = document.createElement("div");
  // Inside the test page's viewport, so hit tests reach every handle.
  host.style.width = "400px";
  host.style.height = "700px";
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
  const redactions = () => session().getSnapshot().plan?.redactions ?? [];
  return { handle, session, redactions };
}

/** A key pressed and let go, as a person presses it: a step for a frame's arrow (docs/adr/0007). */
const key = async (target: Element | null, init: KeyboardEventInit) => {
  await act(async () => {
    target?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  });
  await act(async () => {
    target?.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, ...init }));
  });
};
const pointer = (target: Element | null, type: string, x: number, y: number) =>
  act(async () => {
    target?.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        button: 0,
        clientX: x,
        clientY: y,
      }),
    );
  });
const click = (element: Element | null | undefined) =>
  act(async () => (element as HTMLElement)?.click());
const afterKeys = () =>
  act(async () => new Promise((resolve) => setTimeout(resolve, KEYBOARD_COMMIT_DELAY + 100)));

const button = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === text);
const tool = () => document.querySelector<HTMLButtonElement>('[data-tool="image.redact"]');
const panel = () => document.querySelector('section[aria-label="Redact"]');
const frames = () => [...document.querySelectorAll<HTMLElement>(".hm-image-redact-frame")];
const overlay = () => document.querySelector<HTMLElement>(".hm-image-redact-overlay");
const option = (text: string) =>
  [...document.querySelectorAll<HTMLElement>("[role=radio]")].find((o) => o.textContent === text);
/** Whether an element can be seen: the panel hides what doesn't apply, and keeps its place. */
const shown = (element: Element | null | undefined) =>
  element !== null && element !== undefined && getComputedStyle(element).visibility === "visible";
const hint = () => document.querySelector(".hm-image-redact-hint");
const description = (frame: HTMLElement | undefined) =>
  document.getElementById(frame?.getAttribute("aria-describedby") ?? "")?.textContent;

/** Starts redacting from the toolbar, and waits for the overlay to have a size. */
async function redacting() {
  // A person's click focuses the button; a scripted one doesn't.
  await act(async () => tool()?.focus());
  await click(tool());
  await until(() => overlay() !== null, "the overlay");
}

/** Two rendered frames: a resize observer reports with the frame after a layout change. */
const rendered = () =>
  act(
    async () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

/**
 * Waits for the stage to have its size, and the frames to be placed for it.
 *
 * The stage learns its size from a resize observer, which reports when the
 * browser next renders, not at a time. When the Redact panel replaces a
 * shorter one, the stage shrinks, and until that report its frames are still
 * placed for the old size. So this waits on rendered frames, the clock the
 * observer runs on, until the first frame's box holds across several: a
 * timer would say "settled" before a busy browser had rendered at all.
 */
async function settled() {
  const box = () => JSON.stringify(frames()[0]?.getBoundingClientRect() ?? null);
  let last = "";
  let same = 0;
  for (let i = 0; i < 200 && same < 3; i += 1) {
    await rendered();
    const now = box();
    same = now === last ? same + 1 : 0;
    last = now;
  }
  if (same < 3) throw new Error("timed out waiting for the stage to settle");
}

/** Where a point of the 60 × 40 image is on screen, from a frame the editor placed. */
async function screenOf(redactions: () => readonly ImageRedaction[]) {
  await click(button("Add area"));
  await until(() => frames().length === 1, "a frame");
  await settled();
  const [first] = redactions();
  const box = frames()[0]?.getBoundingClientRect();
  if (!first || !box) throw new Error("no frame");
  const scale = box.width / first.width;
  const origin = { x: box.left - first.x * scale, y: box.top - first.y * scale };
  return {
    scale,
    at: (x: number, y: number) => ({ x: origin.x + x * scale, y: origin.y + y * scale }),
  };
}

describe("redacting (docs/adr/0010)", () => {
  it("starts from the toolbar or R, on the button that adds an area, with solid black chosen", async () => {
    await opened();
    expect(tool()?.getAttribute("aria-label")).toBe("Redact");
    expect(tool()?.getAttribute("aria-pressed")).toBe("false");
    await key(document.activeElement, { key: "r" });
    await until(() => panel() !== null, "the panel");
    expect(tool()?.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(button("Add area"));
    expect(option("Solid colour")?.getAttribute("aria-checked")).toBe("true");
    expect(option("Black")?.getAttribute("aria-checked")).toBe("true");
    expect(panel()?.textContent).toContain("Only the exported image is redacted");
    expect(panel()?.textContent).toContain("No areas yet");
  });

  it("adds an area without dragging: one step, one change, and focus on its named frame", async () => {
    const changes: ImagePlan[] = [];
    const { session, redactions } = await opened({ onChange: (plan) => changes.push(plan) });
    await redacting();
    const count = changes.length;
    await click(button("Add area"));
    await until(() => frames().length === 1, "the frame");
    // A quarter of the image, in its middle, in whole source pixels.
    expect(redactions()).toEqual([
      {
        key: expect.any(String),
        mode: "solid",
        x: 23,
        y: 15,
        width: 15,
        height: 10,
        colour: "#000000",
      },
    ]);
    expect(changes).toHaveLength(count + 1);
    const [frame] = frames();
    expect(document.activeElement).toBe(frame);
    expect(frame?.getAttribute("role")).toBe("group");
    expect(frame?.getAttribute("aria-label")).toBe("Redacted area 1 of 1");
    expect(description(frame)).toContain("solid colour, 15 × 10 pixels, from 23, 15");
    for (const handle of frame?.querySelectorAll("[data-hm-handle]") ?? []) {
      expect(handle.getAttribute("aria-hidden")).toBe("true");
    }
    expect(frame?.querySelectorAll("[data-hm-handle]")).toHaveLength(8);
    expect(panel()?.textContent).toContain("Area 1: solid colour, 15 × 10");
    await act(async () => {
      expect(session().undo()).toBe(true);
    });
    expect(redactions()).toEqual([]);
    await until(() => frames().length === 0, "the frame to go");
  });

  it("moves and resizes with keys, one step per press and one per key held down", async () => {
    const changes: ImagePlan[] = [];
    const { session, redactions, handle } = await opened({
      onChange: (plan) => changes.push(plan),
    });
    await redacting();
    await click(button("Add area"));
    await until(() => frames().length === 1, "the frame");
    const count = changes.length;
    for (let i = 0; i < 3; i += 1) await key(frames()[0] ?? null, { key: "ArrowLeft" });
    for (let i = 0; i < 10; i += 1) await key(frames()[0] ?? null, { key: "ArrowDown" });
    await key(frames()[0] ?? null, { key: "ArrowRight", shiftKey: true });
    await key(frames()[0] ?? null, { key: "ArrowUp", shiftKey: true });
    // Alt, Control and Meta with an arrow are the browser's: not taken.
    for (const modifier of ["altKey", "ctrlKey", "metaKey"] as const) {
      const event = new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        bubbles: true,
        cancelable: true,
        [modifier]: true,
      });
      await act(async () => {
        frames()[0]?.dispatchEvent(event);
      });
      expect(event.defaultPrevented, modifier).toBe(false);
    }
    // Each press is a step.
    expect(redactions()[0]).toMatchObject({ x: 20, y: 25, width: 16, height: 9 });
    expect(changes).toHaveLength(count + 15);
    expect(document.activeElement).toBe(frames()[0]);
    expect(session().undo()).toBe(true);
    expect(redactions()[0]).toMatchObject({ x: 20, y: 25, width: 16, height: 10 });
    expect(session().redo()).toBe(true);
    expect(handle.current).not.toBeNull();
  });

  it("makes a key held down one step, cancels it with Escape, and ends it when focus leaves", async () => {
    const changes: ImagePlan[] = [];
    const { redactions } = await opened({ onChange: (plan) => changes.push(plan) });
    await redacting();
    await click(button("Add area"));
    await until(() => frames().length === 1, "the frame");
    const target = () => frames()[0] ?? null;
    const down = (init: KeyboardEventInit) =>
      act(async () => {
        target()?.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
        );
      });
    const up = (init: KeyboardEventInit) =>
      act(async () => {
        target()?.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, ...init }));
      });
    await act(async () => target()?.focus());
    const count = changes.length;
    // Held down, it repeats: shown at once, and one step when it's let go.
    for (let i = 0; i < 4; i += 1) await down({ key: "ArrowRight", repeat: i > 0 });
    expect(description(frames()[0])).toContain("from 27, 15");
    expect(redactions()[0]).toMatchObject({ x: 23 });
    expect(changes).toHaveLength(count);
    await up({ key: "ArrowRight" });
    expect(redactions()[0]).toMatchObject({ x: 27 });
    expect(changes).toHaveLength(count + 1);
    // Escape while it's held: back where it was, and the rest of it is ignored.
    await down({ key: "ArrowLeft" });
    expect(description(frames()[0])).toContain("from 26, 15");
    await down({ key: "Escape" });
    expect(description(frames()[0])).toContain("from 27, 15");
    await down({ key: "ArrowLeft", repeat: true });
    expect(description(frames()[0])).toContain("from 27, 15");
    await up({ key: "ArrowLeft" });
    expect(redactions()[0]).toMatchObject({ x: 27 });
    expect(changes).toHaveLength(count + 1);
    // Redacting is still on: that Escape cancelled the key, not the tool.
    expect(frames()).toHaveLength(1);
    // Focus leaving with a key held ends it as one step.
    await down({ key: "ArrowDown" });
    await act(async () => button("Add area")?.focus());
    expect(redactions()[0]).toMatchObject({ x: 27, y: 16 });
    expect(changes).toHaveLength(count + 2);
  });

  it("keeps a pointer drag and a run of arrow keys from committing each other", async () => {
    const changes: ImagePlan[] = [];
    const { redactions } = await opened({ onChange: (plan) => changes.push(plan) });
    await redacting();
    await click(button("Add area"));
    await until(() => frames().length === 1, "the frame");
    const count = changes.length;
    const box = frames()[0]?.getBoundingClientRect();
    if (!box) throw new Error("no frame");
    const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    // An arrow pressed during a drag neither moves the frame nor commits the drag.
    await pointer(frames()[0] ?? null, "pointerdown", centre.x, centre.y);
    await pointer(frames()[0] ?? null, "pointermove", centre.x + 40, centre.y + 20);
    await key(frames()[0] ?? null, { key: "ArrowRight" });
    expect(changes).toHaveLength(count);
    expect(redactions()[0]).toMatchObject({ x: 23, y: 15 });
    // So a cancelled drag still leaves the area where it was.
    await pointer(frames()[0] ?? null, "pointercancel", centre.x + 40, centre.y + 20);
    expect(description(frames()[0])).toContain("from 23, 15");
    expect(changes).toHaveLength(count);
    // A press while a key is held ends the key's run first, as its own step.
    await act(async () => {
      frames()[0]?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      );
    });
    expect(description(frames()[0])).toContain("from 24, 15");
    await pointer(frames()[0] ?? null, "pointerdown", centre.x, centre.y);
    expect(redactions()[0]).toMatchObject({ x: 24 });
    expect(changes).toHaveLength(count + 1);
    await pointer(frames()[0] ?? null, "pointerup", centre.x, centre.y);
    expect(changes).toHaveLength(count + 1);
    // A key held after Escape stays ignored through a press of the pointer,
    // until it's let go.
    const arrow = (type: string, repeat = false) =>
      act(async () => {
        frames()[0]?.dispatchEvent(
          new KeyboardEvent(type, { key: "ArrowRight", repeat, bubbles: true, cancelable: true }),
        );
      });
    await arrow("keydown");
    expect(description(frames()[0])).toContain("from 25, 15");
    await act(async () => {
      frames()[0]?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(description(frames()[0])).toContain("from 24, 15");
    await pointer(frames()[0] ?? null, "pointerdown", centre.x, centre.y);
    await pointer(frames()[0] ?? null, "pointerup", centre.x, centre.y);
    await arrow("keydown", true);
    expect(description(frames()[0])).toContain("from 24, 15");
    await arrow("keyup");
    expect(redactions()[0]).toMatchObject({ x: 24 });
    expect(changes).toHaveLength(count + 1);
  });

  it("moves as seen on screen when the image is turned", async () => {
    const { session, redactions } = await opened();
    session().execute({
      type: "image.setOrientation",
      orientation: { rotate: 90, flipX: false, flipY: false },
    });
    await redacting();
    await click(button("Add area"));
    await until(() => frames().length === 1, "the frame");
    // Measured once the stage has its size and the frame is placed for it:
    // the tool's panel replaced the Adjust panel a moment ago.
    await settled();
    const before = redactions()[0];
    const box = frames()[0]?.getBoundingClientRect();
    for (let i = 0; i < 10; i += 1) await key(frames()[0] ?? null, { key: "ArrowRight" });
    await afterKeys();
    const after = redactions()[0];
    // Turned a quarter clockwise, right on screen is up the source.
    expect(after).toMatchObject({ x: before?.x, y: (before?.y ?? 0) - 10 });
    await until(
      () => (frames()[0]?.getBoundingClientRect().left ?? 0) > (box?.left ?? 0),
      "the frame to move right",
    );
    expect(frames()[0]?.getBoundingClientRect().top).toBeCloseTo(box?.top ?? 0, 0);
  });

  it("keeps the stage where it is while redacting, in a layout with the panel under it", async () => {
    // 400 pixels wide: the inspector sits under the stage and takes its
    // height from its content. If the panel grew, the stage would shrink,
    // and the image would move under the pointer while an area is placed.
    await opened();
    await redacting();
    // The tool's panel replaced the Adjust panel: the stage takes its size
    // for it once, and that's the size it must keep.
    for (let i = 0; i < 6; i += 1) await rendered();
    const stage = () => document.querySelector(".hm-image-stage")?.getBoundingClientRect();
    const inspector = () =>
      document.querySelector(".hm-image-editor-inspector")?.getBoundingClientRect();
    expect((inspector()?.top ?? 0) >= (stage()?.bottom ?? 0)).toBe(true);
    /** Waits several rendered frames, so a resize would have reached the stage, and gives its box. */
    const box = async () => {
      for (let i = 0; i < 4; i += 1) await rendered();
      const { top, left, width, height } = stage() ?? new DOMRect();
      return { top, left, width, height };
    };
    const start = await box();
    expect(start.height).toBeGreaterThan(0);
    // With no area, the fields keep their place, unseen and disabled.
    const fields = () => [
      ...document.querySelectorAll<HTMLInputElement>(".hm-image-redact-fields input"),
    ];
    expect(fields()).toHaveLength(4);
    expect(fields().every((input) => input.disabled && !shown(input))).toBe(true);

    await click(button("Add area"));
    await until(() => frames().length === 1, "the frame");
    expect(await box(), "after the first area").toEqual(start);
    expect(fields().every((input) => !input.disabled && shown(input))).toBe(true);
    const placed = frames()[0]?.getBoundingClientRect();

    await click(option("Pixelation"));
    expect(await box(), "after choosing pixelation").toEqual(start);
    await click(option("Solid colour"));
    expect(await box(), "after choosing a colour again").toEqual(start);

    // Five areas: more than the list shows at once, so it scrolls.
    for (let i = 0; i < 4; i += 1) await click(button("Add area"));
    await until(() => frames().length === 5, "five frames");
    expect(await box(), "after five areas").toEqual(start);
    const list = document.querySelector(".hm-image-redact-areas");
    expect((list?.scrollHeight ?? 0) > (list?.clientHeight ?? 0)).toBe(true);

    await click(document.querySelector('button[aria-label="Remove area 5"]'));
    await click(document.querySelector('button[aria-label="Remove area 4"]'));
    expect(await box(), "after removing two").toEqual(start);
    // Deselecting, by a press on the image, hides the fields and moves nothing.
    const edge = stage();
    await pointer(overlay(), "pointerdown", (edge?.left ?? 0) + 4, (edge?.top ?? 0) + 4);
    await pointer(overlay(), "pointerup", (edge?.left ?? 0) + 4, (edge?.top ?? 0) + 4);
    expect(fields().every((input) => input.disabled)).toBe(true);
    expect(await box(), "after deselecting").toEqual(start);
    // The first area's frame is where it was put.
    const still = frames()[0]?.getBoundingClientRect();
    expect([still?.left, still?.top]).toEqual([placed?.left, placed?.top]);
  });

  it("draws an area by dragging across the image: shown while dragging, one step on release", async () => {
    const changes: ImagePlan[] = [];
    const { session, redactions } = await opened({ onChange: (plan) => changes.push(plan) });
    await redacting();
    const screen = await screenOf(redactions);
    const count = changes.length;
    const from = screen.at(2, 3);
    const to = screen.at(12.4, 9.2);
    await pointer(overlay(), "pointerdown", from.x, from.y);
    await pointer(overlay(), "pointermove", (from.x + to.x) / 2, (from.y + to.y) / 2);
    // Mid-drag: a frame for the area being drawn, and nothing committed.
    await until(() => frames().length === 2, "the drawn frame");
    expect(redactions()).toHaveLength(1);
    expect(changes).toHaveLength(count);
    await pointer(overlay(), "pointermove", to.x, to.y);
    await pointer(overlay(), "pointerup", to.x, to.y);
    expect(redactions()).toHaveLength(2);
    // Rounded outward to whole pixels: everything the drag touched is covered.
    expect(redactions()[1]).toMatchObject({ mode: "solid", x: 2, y: 3, width: 11, height: 7 });
    expect(changes).toHaveLength(count + 1);
    await until(() => document.activeElement === frames()[1], "focus on the new frame");
    expect(frames()[1]?.getAttribute("aria-label")).toBe("Redacted area 2 of 2");
    expect(session().undo()).toBe(true);
    expect(redactions()).toHaveLength(1);
  });

  it("cancels a drag with Escape or a lost pointer, and a press without a drag draws nothing", async () => {
    const changes: ImagePlan[] = [];
    const { redactions } = await opened({ onChange: (plan) => changes.push(plan) });
    await redacting();
    const screen = await screenOf(redactions);
    const count = changes.length;
    const from = screen.at(2, 3);
    const to = screen.at(12, 9);
    await pointer(overlay(), "pointerdown", from.x, from.y);
    await pointer(overlay(), "pointermove", to.x, to.y);
    await until(() => frames().length === 2, "the drawn frame");
    await pointer(overlay(), "pointercancel", to.x, to.y);
    await until(() => frames().length === 1, "the drawn frame to go");
    // Moving an area, then Escape: it's back where it was.
    const frame = frames()[0] ?? null;
    const box = frame?.getBoundingClientRect();
    if (!box) throw new Error("no frame");
    const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    await pointer(frame, "pointerdown", centre.x, centre.y);
    await pointer(frame, "pointermove", centre.x + 40, centre.y + 20);
    expect(description(frames()[0])).not.toContain("from 23, 15");
    await key(frames()[0] ?? null, { key: "Escape" });
    expect(description(frames()[0])).toContain("from 23, 15");
    await pointer(frames()[0] ?? null, "pointerup", centre.x + 40, centre.y + 20);
    // A press and release in place.
    await pointer(overlay(), "pointerdown", from.x, from.y);
    await pointer(overlay(), "pointerup", from.x, from.y);
    expect(redactions()).toHaveLength(1);
    expect(redactions()[0]).toMatchObject({ x: 23, y: 15, width: 15, height: 10 });
    expect(changes).toHaveLength(count);
  });

  it("moves and resizes an area by the pointer, each drag one step", async () => {
    const { session, redactions } = await opened();
    await redacting();
    const screen = await screenOf(redactions);
    const frame = frames()[0] ?? null;
    const box = frame?.getBoundingClientRect();
    if (!box) throw new Error("no frame");
    const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    await pointer(frame, "pointerdown", centre.x, centre.y);
    await pointer(frame, "pointermove", centre.x - 5 * screen.scale, centre.y + 4 * screen.scale);
    await pointer(frame, "pointerup", centre.x - 5 * screen.scale, centre.y + 4 * screen.scale);
    expect(redactions()[0]).toMatchObject({ x: 18, y: 19, width: 15, height: 10 });
    // The south-east handle, dragged out by 6 and 2.
    const corner = frames()[0]?.querySelector('[data-hm-handle="se"]') ?? null;
    const at = corner?.getBoundingClientRect();
    if (!at) throw new Error("no handle");
    const grip = { x: at.left + at.width / 2, y: at.top + at.height / 2 };
    expect(document.elementFromPoint(grip.x, grip.y)).toBe(corner);
    await pointer(corner, "pointerdown", grip.x, grip.y);
    await pointer(corner, "pointermove", grip.x + 6 * screen.scale, grip.y + 2 * screen.scale);
    await pointer(corner, "pointerup", grip.x + 6 * screen.scale, grip.y + 2 * screen.scale);
    expect(redactions()[0]).toMatchObject({ x: 18, y: 19, width: 21, height: 12 });
    expect(session().undo()).toBe(true);
    expect(redactions()[0]).toMatchObject({ x: 18, y: 19, width: 15, height: 10 });
    expect(session().undo()).toBe(true);
    expect(redactions()[0]).toMatchObject({ x: 23, y: 15, width: 15, height: 10 });
  });

  it("switches an area to pixelation with its warning, and back to a colour", async () => {
    const { redactions } = await opened();
    await redacting();
    await click(button("Add area"));
    await until(() => frames().length === 1, "the frame");
    expect(shown(hint())).toBe(false);
    expect(shown(option("Black"))).toBe(true);
    await click(option("Pixelation"));
    expect(redactions()[0]).toEqual({
      key: expect.any(String),
      mode: "pixelate",
      x: 23,
      y: 15,
      width: 15,
      height: 10,
    });
    expect(hint()?.textContent).toBe(
      "Pixelation may not hide text. For text and numbers, use a solid colour.",
    );
    expect(shown(hint())).toBe(true);
    // The colour doesn't apply: it keeps its place, unseen and out of the tab order.
    expect(shown(option("Black"))).toBe(false);
    expect(description(frames()[0])).toContain("pixelated, 15 × 10");
    await click(option("Solid colour"));
    expect(redactions()[0]).toMatchObject({ mode: "solid", colour: "#000000" });
    await click(option("White"));
    expect(redactions()[0]).toMatchObject({ mode: "solid", colour: "#ffffff" });
    // The next area takes what's chosen.
    await click(button("Add area"));
    await until(() => frames().length === 2, "the second frame");
    expect(redactions()[1]).toMatchObject({ mode: "solid", colour: "#ffffff" });
  });

  it("sets an area's place and size from the panel's fields", async () => {
    const { redactions } = await opened();
    await redacting();
    await click(button("Add area"));
    await until(() => frames().length === 1, "the frame");
    const fields = [
      ...document.querySelectorAll<HTMLInputElement>(".hm-image-redact-fields input"),
    ];
    expect(fields).toHaveLength(4);
    const type = (input: HTMLInputElement | undefined, value: string) =>
      act(async () => {
        if (!input) return;
        input.focus();
        // React tracks the value it set; the native setter is what typing does.
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
          input,
          value,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        input.blur();
      });
    await type(fields[0], "-4");
    await type(
      document.querySelectorAll<HTMLInputElement>(".hm-image-redact-fields input")[2],
      "30",
    );
    // An area may start outside the image.
    expect(redactions()[0]).toMatchObject({ x: -4, y: 15, width: 30, height: 10 });
  });

  it("lists every area, selects from the list, and removes with its button or Delete", async () => {
    const { redactions } = await opened();
    await redacting();
    for (let i = 0; i < 3; i += 1) await click(button("Add area"));
    await until(() => frames().length === 3, "three frames");
    const rows = () => [...document.querySelectorAll(".hm-image-redact-areas li")];
    expect(rows().map((row) => row.querySelector("button")?.textContent)).toEqual([
      "Area 1: solid colour, 15 × 10",
      "Area 2: solid colour, 15 × 10",
      "Area 3: solid colour, 15 × 10",
    ]);
    // One tab stop among the frames: the selected one.
    expect(frames().map((frame) => frame.tabIndex)).toEqual([-1, -1, 0]);
    await click(rows()[0]?.querySelector("button"));
    expect(rows()[0]?.querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
    expect(frames().map((frame) => frame.tabIndex)).toEqual([0, -1, -1]);
    await until(() => document.activeElement === frames()[0], "focus on the first frame");
    const kept = redactions().map((redaction) => redaction.key);
    await click(document.querySelector('button[aria-label="Remove area 2"]'));
    expect(redactions().map((redaction) => redaction.key)).toEqual([kept[0], kept[2]]);
    // Delete on a frame removes it, and focus goes to the next one.
    await act(async () => frames()[0]?.focus());
    await key(frames()[0] ?? null, { key: "Delete" });
    expect(redactions().map((redaction) => redaction.key)).toEqual([kept[2]]);
    await until(() => document.activeElement === frames()[0], "focus on the remaining frame");
    await key(frames()[0] ?? null, { key: "Backspace" });
    expect(redactions()).toEqual([]);
    expect(document.activeElement).toBe(button("Add area"));
  });

  it("ends with Done, Escape or the tool, returning focus, and keeps the redactions", async () => {
    const { redactions } = await opened();
    await redacting();
    await click(button("Add area"));
    await until(() => frames().length === 1, "the frame");
    await click(button("Done"));
    expect(panel()).toBeNull();
    expect(frames()).toHaveLength(0);
    expect(redactions()).toHaveLength(1);
    expect(document.activeElement).toBe(tool());
    // Again, ended with Escape from a frame.
    await key(tool(), { key: "r" });
    await until(() => frames().length === 1, "the frame again");
    await act(async () => frames()[0]?.focus());
    await key(frames()[0] ?? null, { key: "Escape" });
    expect(panel()).toBeNull();
    expect(redactions()).toHaveLength(1);
    expect(tool()?.getAttribute("aria-pressed")).toBe("false");
  });

  it("follows undo while redacting, and gives the stage to cropping when that starts", async () => {
    const { session, redactions } = await opened();
    await redacting();
    await click(button("Add area"));
    await until(() => frames().length === 1, "the frame");
    await act(async () => {
      session().undo();
    });
    await until(() => frames().length === 0, "the frame to go");
    expect(panel()?.textContent).toContain("No areas yet");
    expect(redactions()).toEqual([]);
    await act(async () => {
      session().redo();
    });
    await until(() => frames().length === 1, "the frame to return");
    await click(document.querySelector('[data-tool="image.crop"]'));
    await until(() => document.querySelector('[aria-label="Crop area"]') !== null, "cropping");
    expect(frames()).toHaveLength(0);
    expect(tool()?.getAttribute("aria-pressed")).toBe("false");
  });

  it("says in the export summary how many areas are redacted, and warns about pixelation", async () => {
    const { session } = await opened();
    const area = (key: string, mode: "solid" | "pixelate"): ImageRedaction =>
      mode === "solid"
        ? { key, mode, x: 1, y: 1, width: 5, height: 5, colour: "#000000" }
        : { key, mode, x: 10, y: 10, width: 5, height: 5 };
    const summary = () => document.querySelector(".hm-image-export-summary")?.textContent ?? "";
    const exportTool = () => document.querySelector<HTMLElement>('[data-tool="image.export"]');
    await click(exportTool());
    await until(() => summary() !== "", "the summary");
    expect(summary()).not.toContain("redacted");
    await key(document.activeElement, { key: "Escape" });
    await act(async () => {
      session().execute({
        type: "image.insertRedactions",
        at: 0,
        redactions: [area("a", "solid")],
      });
    });
    await click(exportTool());
    await until(() => summary().includes("redacted"), "the redacted line");
    expect(summary()).toContain("1 area is redacted.");
    expect(summary()).not.toContain("may not hide text");
    await key(document.activeElement, { key: "Escape" });
    await act(async () => {
      session().execute({
        type: "image.insertRedactions",
        at: 1,
        redactions: [area("b", "pixelate")],
      });
    });
    await click(exportTool());
    await until(() => summary().includes("2 areas"), "both areas");
    expect(summary()).toContain("2 areas are redacted. Pixelated areas may not hide text.");
  });
});
