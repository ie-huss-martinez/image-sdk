import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadStyles } from "../../../test/browser/styles.js";
import { FIRST_OPEN_TIMEOUT } from "../../../test/browser/timeouts.js";
import { compositionToSource } from "../../core/model/geometry.js";
import type { ImageDrawingLayer, ImagePlan } from "../../core/model/plan.js";
import { ImageEditor } from "../editor/ImageEditor.js";
import type { ImageEditorHandle, ImageEditorProps } from "../editor/types.js";

/** A 60 × 40 PNG the browser encodes. */
async function photo(): Promise<Blob> {
  const canvas = new OffscreenCanvas(60, 40);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2D canvas");
  context.fillStyle = "#3080c0";
  context.fillRect(0, 0, 60, 40);
  return canvas.convertToBlob();
}

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

/** A shape under what's drawn, so a drawing is never the only layer. */
const MARKER = {
  key: "marker",
  kind: "shape",
  shape: "rectangle",
  name: "",
  visible: true,
  opacity: 100,
  x: 20,
  y: 10,
  width: 10,
  height: 10,
  rotation: 0,
  flipX: false,
  fill: "#ffffff",
  stroke: null,
} as const;

async function opened(extra: Partial<ImageEditorProps> = {}) {
  const handle = createRef<ImageEditorHandle>();
  host = document.createElement("div");
  host.style.width = "400px";
  host.style.height = "900px";
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
  await act(async () => session().execute({ type: "image.insertLayers", at: 0, layers: [MARKER] }));
  const plan = () => session().getSnapshot().plan as ImagePlan;
  const drawings = () =>
    plan().layers.filter((layer): layer is ImageDrawingLayer => layer.kind === "drawing");
  return { handle, session, plan, drawings };
}

const pointer = (target: Element | null | undefined, type: string, x: number, y: number) =>
  act(async () => {
    if (!target) throw new Error("nothing to point at");
    target.dispatchEvent(
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
  act(async () => {
    if (!element) throw new Error("nothing to click");
    (element as HTMLElement).click();
  });
/** A key pressed and let go, as a person presses it: a step for a frame's arrow (docs/adr/0007). */
async function key(target: Element | null | undefined, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  await act(async () => {
    target?.dispatchEvent(event);
  });
  await act(async () => {
    target?.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, ...init }));
  });
  return event.defaultPrevented;
}
const rendered = () =>
  act(
    async () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

const tool = (id: string) => document.querySelector<HTMLButtonElement>(`[data-tool="image.${id}"]`);
const panel = () => document.querySelector('section[aria-label="Draw"]');
const overlay = () => document.querySelector<HTMLElement>(".hm-image-draw-overlay");
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === text);
const radio = (label: string) =>
  [...document.querySelectorAll<HTMLElement>(".hm-image-draw-panel [role=radio]")].find(
    (option) => option.textContent === label || option.getAttribute("aria-label") === label,
  );
const widthField = () =>
  [...document.querySelectorAll<HTMLLabelElement>(".hm-image-draw-panel label")]
    .filter((label) => label.textContent === "Width")
    .map((label) => document.getElementById(label.htmlFor) as HTMLInputElement | null)[0];
const alert = () => document.querySelector(".hm-image-stage-error");
const announced = () =>
  [...document.querySelectorAll("[aria-live]")].map((region) => region.textContent).join(" ");

/** The room the stage keeps around the image while a tool has it (docs/adr/0007). */
const INSET = 24;

/**
 * Where the image is on screen while drawing: fitted in the draw overlay,
 * inside the stage's inset, and centred, as the renderer places it.
 *
 * @param shown - The image's size as it's shown: 60 × 40, or turned.
 */
function screen(shown = { width: 60, height: 40 }) {
  const box = overlay()?.getBoundingClientRect();
  if (!box) throw new Error("no overlay");
  const scale = Math.min(
    (box.width - 2 * INSET) / shown.width,
    (box.height - 2 * INSET) / shown.height,
  );
  const origin = {
    x: box.left + (box.width - shown.width * scale) / 2,
    y: box.top + (box.height - shown.height * scale) / 2,
  };
  return {
    scale,
    at: (x: number, y: number) => ({ x: origin.x + x * scale, y: origin.y + y * scale }),
  };
}

/** Starts drawing from the toolbar. */
async function drawingMode() {
  await act(async () => tool("draw")?.focus());
  await click(tool("draw"));
  await until(() => overlay() !== null, "the overlay");
  for (let i = 0; i < 4; i += 1) await rendered();
}

/** A stroke through these scene points, with a real press, moves and a release. */
async function stroke(
  at: (x: number, y: number) => { x: number; y: number },
  ...points: [number, number][]
) {
  const [first, ...rest] = points.map(([x, y]) => at(x, y));
  if (!first) throw new Error("no points");
  await pointer(overlay(), "pointerdown", first.x, first.y);
  for (const point of rest) await pointer(overlay(), "pointermove", point.x, point.y);
  const last = rest.at(-1) ?? first;
  await pointer(overlay(), "pointerup", last.x, last.y);
}

/** How many steps the history holds. */
function steps(session: () => ImageEditorHandle["session"]) {
  let count = 0;
  while (session().undo()) count += 1;
  for (let i = 0; i < count; i += 1) session().redo();
  return count;
}

describe("drawing (docs/adr/0015)", () => {
  it("starts from the toolbar or D, with the pen, and says that drawing needs a pointer", async () => {
    await opened();
    expect(panel()).toBeNull();
    await drawingMode();
    expect(tool("draw")?.getAttribute("aria-pressed")).toBe("true");
    expect(tool("draw")?.getAttribute("aria-keyshortcuts")).toBe("D");
    expect(panel()?.textContent).toContain("Drawing needs a mouse, a pen or a finger");
    expect(radio("Pen")?.getAttribute("aria-checked")).toBe("true");
    // A pen as wide as a new shape's outline, in its red.
    expect(widthField()?.value).toBe("2");
    expect(
      document.querySelector<HTMLInputElement>(".hm-image-draw-panel .hm-color-field-input")?.value,
    ).toBe("#e02020");
    // Nothing to remove yet: the button says so, and stays in the keyboard's order.
    expect(button("Remove last stroke")?.getAttribute("aria-disabled")).toBe("true");
    // Focus stays on the tool: the surface is a pointer's, with nothing to focus.
    expect(document.activeElement).toBe(tool("draw"));
    expect(overlay()?.tabIndex).toBe(-1);
    // Run again, it ends; and D starts it.
    await click(tool("draw"));
    expect(panel()).toBeNull();
    await key(tool("draw"), { key: "d" });
    await until(() => panel() !== null, "the panel again");
  });

  it("draws a stroke under the pointer: shown while dragging, one step and one change on release", async () => {
    const changes: ImagePlan[] = [];
    const { session, drawings, plan } = await opened({ onChange: (p) => changes.push(p) });
    await drawingMode();
    const { at } = screen();
    const before = steps(session);
    const count = changes.length;
    const from = at(10, 30);
    const to = at(40, 30);
    await pointer(overlay(), "pointerdown", from.x, from.y);
    await pointer(overlay(), "pointermove", (from.x + to.x) / 2, from.y);
    await pointer(overlay(), "pointermove", to.x, to.y);
    // Not an edit yet: the stage shows it as a transient plan.
    expect(drawings()).toEqual([]);
    expect(changes).toHaveLength(count);
    await pointer(overlay(), "pointerup", to.x, to.y);
    // A new drawing over every layer, with its origin where the stroke began.
    expect(plan().layers.at(-1)?.kind).toBe("drawing");
    expect(drawings()).toHaveLength(1);
    expect(drawings()[0]).toMatchObject({
      name: "",
      visible: true,
      opacity: 100,
      x: 10,
      y: 30,
      // A straight drag is its two ends: the point between them is on the line.
      strokes: [{ colour: "#e02020", width: 2, runs: [[0, 0, 30, 0]] }],
    });
    expect(changes).toHaveLength(count + 1);
    expect(steps(session)).toBe(before + 1);
    expect(button("Remove last stroke")?.getAttribute("aria-disabled")).not.toBe("true");
    expect(alert()).toBeNull();
  });

  it("adds the next strokes to the same drawing, a press without a drag as a dot, and keeps a corner", async () => {
    const { session, drawings } = await opened();
    await drawingMode();
    const { at } = screen();
    await stroke(at, [10, 30], [40, 30]);
    const before = steps(session);
    // A press and a release in one place: a dot.
    await stroke(at, [50, 5]);
    // Right, then down: the corner stays a point.
    await stroke(at, [5, 5], [15, 5], [15, 20]);
    expect(drawings()).toHaveLength(1);
    // From the drawing's origin, 10, 30.
    expect(drawings()[0]?.strokes.map((s) => s.runs)).toEqual([
      [[0, 0, 30, 0]],
      [[40, -25]],
      [[-5, -25, 5, -25, 5, -10]],
    ]);
    // Each stroke is its own step.
    expect(steps(session)).toBe(before + 2);
    await act(async () => {
      session().undo();
    });
    expect(drawings()[0]?.strokes).toHaveLength(2);
  });

  it("draws with the highlighter into a see-through drawing of its own, wide and yellow", async () => {
    const { drawings } = await opened();
    await drawingMode();
    const { at } = screen();
    await stroke(at, [10, 30], [40, 30]);
    await click(radio("Highlighter"));
    expect(widthField()?.value).toBe("12");
    // Nothing of the highlighter's to remove yet.
    expect(button("Remove last stroke")?.getAttribute("aria-disabled")).toBe("true");
    await stroke(at, [10, 20], [40, 20]);
    await stroke(at, [10, 25], [40, 25]);
    expect(drawings()).toHaveLength(2);
    expect(drawings()[0]).toMatchObject({ opacity: 100, strokes: [{ width: 2 }] });
    // Both of its strokes are in one drawing, so they don't darken where they cross.
    expect(drawings()[1]).toMatchObject({
      opacity: 40,
      strokes: [
        { colour: "#f0c020", width: 12 },
        { colour: "#f0c020", width: 12 },
      ],
    });
    // The pen again starts another drawing: a pen and a highlighter never share one.
    await click(radio("Pen"));
    await stroke(at, [5, 5], [20, 5]);
    expect(drawings().map((drawing) => drawing.opacity)).toEqual([100, 40, 100]);
  });

  it("draws the next stroke in the colour and width that are chosen", async () => {
    const { drawings } = await opened();
    await drawingMode();
    const { at } = screen();
    await click(document.querySelector('.hm-image-draw-panel [role=radio][aria-label="Blue"]'));
    await act(async () => {
      const input = widthField();
      if (!input) throw new Error("no width field");
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "7");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      input.blur();
    });
    await stroke(at, [10, 30], [40, 30]);
    expect(drawings()[0]?.strokes[0]).toMatchObject({ colour: "#2060e0", width: 7 });
    // Choosing isn't an edit.
    expect(drawings()).toHaveLength(1);
  });

  it("ends a stroke with nothing added on Escape or a lost pointer", async () => {
    const { session, drawings } = await opened();
    await drawingMode();
    const { at } = screen();
    const before = steps(session);
    const from = at(10, 30);
    await pointer(overlay(), "pointerdown", from.x, from.y);
    await pointer(overlay(), "pointermove", from.x + 40, from.y);
    // Escape, wherever focus is: the stroke goes, and drawing continues.
    expect(await key(document.body, { key: "Escape" })).toBe(true);
    await pointer(overlay(), "pointerup", from.x + 40, from.y);
    expect(drawings()).toEqual([]);
    expect(panel()).not.toBeNull();
    await pointer(overlay(), "pointerdown", from.x, from.y);
    await pointer(overlay(), "pointermove", from.x + 40, from.y);
    await pointer(overlay(), "pointercancel", from.x + 40, from.y);
    expect(drawings()).toEqual([]);
    expect(steps(session)).toBe(before);
    // With no stroke in progress, Escape isn't the overlay's.
    expect(await key(document.body, { key: "Escape" })).toBe(false);
  });

  it("removes the last stroke, and the drawing with its only one", async () => {
    const { drawings, session } = await opened();
    await drawingMode();
    const { at } = screen();
    await stroke(at, [10, 30], [40, 30]);
    await stroke(at, [10, 20], [40, 20]);
    await act(async () => button("Remove last stroke")?.focus());
    await click(button("Remove last stroke"));
    expect(drawings()[0]?.strokes).toHaveLength(1);
    await until(() => announced().includes("Removed the last stroke."), "the announcement");
    // The only stroke left: the drawing goes with it, as one step that undo brings back whole.
    await click(button("Remove last stroke"));
    expect(drawings()).toEqual([]);
    expect(button("Remove last stroke")?.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(button("Remove last stroke"));
    await act(async () => {
      session().undo();
    });
    expect(drawings()[0]?.strokes).toHaveLength(1);
  });

  it("says on the stage when a stroke would pass the points limit, and adds nothing", async () => {
    const { drawings } = await opened({ filePolicy: { maxDrawingPoints: 3 } });
    await drawingMode();
    const { at } = screen();
    await stroke(at, [10, 30], [40, 30]);
    expect(drawings()[0]?.strokes).toHaveLength(1);
    // Two more points would be four.
    await stroke(at, [10, 20], [40, 20]);
    expect(drawings()[0]?.strokes).toHaveLength(1);
    expect(alert()?.getAttribute("role")).toBe("alert");
    expect(alert()?.textContent).toMatch(/3/);
    // A dot fits, and clears it.
    await stroke(at, [50, 5]);
    expect(drawings()[0]?.strokes).toHaveLength(2);
    expect(alert()).toBeNull();
  });

  it("draws under the pointer on an image that's turned and mirrored", async () => {
    const { session, drawings } = await opened();
    await act(async () =>
      session().execute({
        type: "image.setOrientation",
        orientation: { rotate: 90, flipX: true, flipY: false },
      }),
    );
    await drawingMode();
    // The image is shown 40 × 60. A press at 30, 10 of it, as it's seen.
    const { at } = screen({ width: 40, height: 60 });
    const point = at(30, 10);
    await pointer(overlay(), "pointerdown", point.x, point.y);
    await pointer(overlay(), "pointerup", point.x, point.y);
    expect(drawings()).toHaveLength(1);
    // Where that is in the source: through the mirror and the quarter turn, back.
    const scene = compositionToSource(
      { x: 30, y: 10 },
      { x: 0, y: 0, width: 60, height: 40 },
      { rotate: 90, flipX: true, flipY: false },
    );
    expect(drawings()[0]).toMatchObject({
      x: Math.round(scene.x),
      y: Math.round(scene.y),
      strokes: [{ runs: [[0, 0]] }],
    });
    // And not where it would be on the image unturned.
    expect([drawings()[0]?.x, drawings()[0]?.y]).not.toEqual([30, 10]);
    // A drag to the right on screen is a line in the source's own direction for it.
    const along = at(38, 10);
    await pointer(overlay(), "pointerdown", point.x, point.y);
    await pointer(overlay(), "pointermove", along.x, along.y);
    await pointer(overlay(), "pointerup", along.x, along.y);
    const end = compositionToSource(
      { x: 38, y: 10 },
      { x: 0, y: 0, width: 60, height: 40 },
      { rotate: 90, flipX: true, flipY: false },
    );
    expect(drawings()[0]?.strokes[1]?.runs).toEqual([
      [0, 0, Math.round(end.x) - Math.round(scene.x), Math.round(end.y) - Math.round(scene.y)],
    ]);
  });

  it("joins the drawing the layers had selected, and ends with Done, the tool or Export", async () => {
    const { drawings, session } = await opened();
    await drawingMode();
    const { at } = screen();
    await stroke(at, [10, 30], [40, 30]);
    await click(button("Done"));
    expect(panel()).toBeNull();
    expect(overlay()).toBeNull();
    expect(document.activeElement).toBe(tool("draw"));
    // From the layers, with the drawing selected, the pen adds to it.
    await click(tool("layers"));
    await until(() => document.querySelector(".hm-image-layers-panel") !== null, "the layers");
    expect(
      document.querySelector('.hm-image-layers-list [aria-selected="true"] .hm-image-layer-select')
        ?.textContent,
    ).toBe("Drawing");
    await click(tool("draw"));
    await until(() => overlay() !== null, "drawing again");
    for (let i = 0; i < 4; i += 1) await rendered();
    await stroke(at, [10, 20], [40, 20]);
    expect(drawings()).toHaveLength(1);
    expect(drawings()[0]?.strokes).toHaveLength(2);
    // Export ends drawing and opens its dialog, with the strokes in the plan.
    await click(tool("export"));
    await until(() => document.querySelector("dialog[open]") !== null, "the dialog");
    expect(panel()).toBeNull();
    expect(session().getSnapshot().plan?.layers.at(-1)).toMatchObject({ kind: "drawing" });
  });
});
