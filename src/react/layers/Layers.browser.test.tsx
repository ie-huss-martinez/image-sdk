import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadStyles } from "../../../test/browser/styles.js";
import { FIRST_OPEN_TIMEOUT } from "../../../test/browser/timeouts.js";
import type {
  ImageArrowLayer,
  ImageBoxedLayer,
  ImageDrawingLayer,
  ImagePlan,
} from "../../core/model/plan.js";
import { ImageEditor } from "../editor/ImageEditor.js";
import type { ImageEditorHandle, ImageEditorProps } from "../editor/types.js";
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

const common = { name: "", visible: true, opacity: 100, rotation: 0, flipX: false };
/** Three layers, bottom to top: a rectangle, two lines of text, and a named ellipse. */
const LAYERS: readonly ImageBoxedLayer[] = [
  {
    ...common,
    key: "under",
    kind: "shape",
    shape: "rectangle",
    fill: "#c03030",
    stroke: null,
    x: 10,
    y: 8,
    width: 20,
    height: 10,
  },
  {
    ...common,
    key: "middle",
    kind: "text",
    text: "Hello\nthere",
    font: "sans-serif",
    bold: false,
    colour: "#000000",
    align: "start",
    x: 4,
    y: 22,
    width: 30,
    height: 12,
  },
  {
    ...common,
    key: "over",
    name: "Badge",
    kind: "shape",
    shape: "ellipse",
    fill: "#30c030",
    stroke: null,
    x: 36,
    y: 20,
    width: 16,
    height: 12,
  },
];

// The editor as hosts lay it out, with ui's stylesheet and the package's.
let unloadStyles: () => void = () => {};
beforeAll(async () => {
  unloadStyles = await loadStyles();
});
afterAll(() => unloadStyles());

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(async () => {
  // A test that holds the clock gives it back even when it fails.
  vi.useRealTimers();
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
  layers: readonly ImageBoxedLayer[] = LAYERS,
  extra: Partial<ImageEditorProps> = {},
) {
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
  if (layers.length > 0) {
    await act(async () => session().execute({ type: "image.insertLayers", at: 0, layers }));
  }
  const plan = () => session().getSnapshot().plan as ImagePlan;
  const keys = () => plan().layers.map((layer) => layer.key);
  // Every layer these tests add has a box.
  const layer = (key: string) =>
    plan().layers.find((item) => item.key === key) as ImageBoxedLayer | undefined;
  return { handle, session, plan, keys, layer };
}

/** Dispatches a key, and says whether its default was prevented. */
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
const pointer = (target: Element | null | undefined, type: string, x: number, y: number) =>
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

const named = (label: string) =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === text);
const tool = () => document.querySelector<HTMLButtonElement>('[data-tool="image.layers"]');
const panel = () => document.querySelector('section[aria-label="Layers"]');
const overlay = () => document.querySelector<HTMLElement>(".hm-image-layers-overlay");
const frames = () => [...document.querySelectorAll<HTMLElement>(".hm-image-layer-frame")];
const frame = (layerKey: string) =>
  document.querySelector<HTMLElement>(`.hm-image-layer-frame[data-hm-layer="${layerKey}"]`);
const rows = () => [...document.querySelectorAll<HTMLElement>(".hm-image-layers-list [role=row]")];
const row = (layerKey: string) =>
  document.querySelector<HTMLElement>(
    `.hm-image-layers-list [role=row][data-hm-layer="${layerKey}"]`,
  );
const select = (layerKey: string) =>
  row(layerKey)?.querySelector<HTMLElement>(".hm-image-layer-select");
const visibility = (layerKey: string) =>
  row(layerKey)?.querySelector<HTMLButtonElement>(".hm-image-layer-visibility");
const names = () => rows().map((item) => item.querySelector(".hm-image-layer-select")?.textContent);
const fields = () => [
  ...document.querySelectorAll<HTMLInputElement>(".hm-image-layers-fields input"),
];
const field = (label: string) =>
  [...document.querySelectorAll<HTMLElement>(".hm-image-layers-fields label")]
    .find((item) => item.textContent === label)
    ?.closest("div")
    ?.querySelector<HTMLInputElement>("input") ??
  (document.getElementById(
    [...document.querySelectorAll<HTMLLabelElement>(".hm-image-layers-fields label")].find(
      (item) => item.textContent === label,
    )?.htmlFor ?? "",
  ) as HTMLInputElement | null);
const description = (element: HTMLElement | null) =>
  document.getElementById(element?.getAttribute("aria-describedby") ?? "")?.textContent;
const announced = () =>
  [...document.querySelectorAll("[aria-live]")].map((region) => region.textContent).join(" ");

/** The announcer speaks a moment after it's asked to: waits for the polite region to say it. */
const said = (text: string) => until(() => announced().includes(text), `"${text}" to be announced`);

const type = (input: HTMLInputElement | null | undefined, value: string) =>
  act(async () => {
    if (!input) throw new Error("no field");
    input.focus();
    // React tracks the value it set; the native setter is what typing does.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    input.blur();
  });

/** Two rendered frames: a resize observer reports with the frame after a layout change. */
const rendered = () =>
  act(
    async () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

/**
 * Waits for the stage to have its size, and the frames to be placed for it:
 * on rendered frames, the clock the stage's resize observer runs on, until
 * the first frame's box holds across several.
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

/** Shows the layers from the toolbar, and waits for the frames to be placed. */
async function layering() {
  // A person's click focuses the button; a scripted one doesn't.
  await act(async () => tool()?.focus());
  await click(tool());
  await until(() => overlay() !== null, "the overlay");
  await settled();
}

/** Where a point of the scene is on screen, from an upright layer's frame. */
function screenOf(layer: ImageBoxedLayer | undefined) {
  const box = layer ? frame(layer.key)?.getBoundingClientRect() : undefined;
  if (!layer || !box) throw new Error("no frame");
  const scale = box.width / layer.width;
  const origin = { x: box.left - layer.x * scale, y: box.top - layer.y * scale };
  return {
    scale,
    at: (x: number, y: number) => ({ x: origin.x + x * scale, y: origin.y + y * scale }),
  };
}

describe("the layers (docs/adr/0013)", () => {
  it("shows from the toolbar or L, on the top layer in the list, which is selected", async () => {
    await opened();
    expect(panel()).toBeNull();
    await layering();
    expect(panel()).not.toBeNull();
    expect(tool()?.getAttribute("aria-pressed")).toBe("true");
    // The top layer first, each by its name, its text or its kind.
    expect(names()).toEqual(["Badge", "Hello", "Rectangle"]);
    expect(row("over")?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(select("over"));
    expect(frame("over")?.hasAttribute("data-hm-selected")).toBe(true);
    // Run again, it hides them, and focus returns to its button.
    await click(tool());
    expect(panel()).toBeNull();
    expect(frames()).toHaveLength(0);
    expect(document.activeElement).toBe(tool());
    // The shortcut, while focus is in the editor.
    await key(tool(), { key: "l" });
    await until(() => panel() !== null, "the panel again");
    expect(document.activeElement).toBe(select("over"));
  });

  it("says so when there are no layers, with its fields and buttons disabled but in place", async () => {
    await opened([]);
    await layering();
    expect(panel()?.textContent).toContain("No layers yet.");
    expect(frames()).toHaveLength(0);
    expect(fields()).toHaveLength(7);
    expect(fields().every((input) => input.disabled)).toBe(true);
    for (const label of ["Move up", "Move down", "Mirror", "Duplicate", "Delete"]) {
      // Disabled, and still in the keyboard's order.
      expect(named(label)?.getAttribute("aria-disabled"), label).toBe("true");
      expect(named(label)?.disabled, label).toBe(false);
    }
    // Focus stayed on the tool's button: there's no layer to go to.
    expect(document.activeElement).toBe(tool());
  });

  it("places each frame over its layer, named and described, with one tab stop", async () => {
    const { layer } = await opened();
    await layering();
    const screen = screenOf(layer("under"));
    for (const item of LAYERS) {
      const box = frame(item.key)?.getBoundingClientRect();
      const at = screen.at(item.x, item.y);
      expect(box?.left, item.key).toBeCloseTo(at.x, 1);
      expect(box?.top, item.key).toBeCloseTo(at.y, 1);
      expect(box?.width, item.key).toBeCloseTo(item.width * screen.scale, 1);
      expect(box?.height, item.key).toBeCloseTo(item.height * screen.scale, 1);
    }
    // The canvas shows the image at the same scale, from the same corner.
    const canvas = document.querySelector(".hm-image-stage-canvas")?.getBoundingClientRect();
    expect(canvas?.width).toBeGreaterThan(0);
    expect(frames().map((item) => item.getAttribute("role"))).toEqual(["group", "group", "group"]);
    expect(frame("over")?.getAttribute("aria-label")).toBe("Layer 1 of 3: Badge");
    expect(frame("middle")?.getAttribute("aria-label")).toBe("Layer 2 of 3: Hello");
    expect(frame("under")?.getAttribute("aria-label")).toBe("Layer 3 of 3: Rectangle");
    expect(description(frame("over"))).toBe(
      "16 × 12 pixels, from 36, 20, turned 0°. Arrow keys move it; with Shift, they resize it; Delete removes it and Escape closes the layers.",
    );
    expect(frames().map((item) => item.tabIndex)).toEqual([-1, -1, 0]);
    // Only the selected frame has handles, and they're not in the accessibility tree.
    expect(frame("over")?.querySelectorAll(".hm-image-layer-handle")).toHaveLength(8);
    expect(frame("under")?.querySelectorAll(".hm-image-layer-handle")).toHaveLength(0);
    expect(
      [...(frame("over")?.querySelectorAll(".hm-image-layer-handle") ?? [])].every(
        (handle) => handle.getAttribute("aria-hidden") === "true",
      ),
    ).toBe(true);
  });

  it("turns a frame with its layer, about the layer's centre", async () => {
    const { session, layer } = await opened();
    await layering();
    const screen = screenOf(layer("under"));
    await act(async () =>
      session().execute({
        type: "image.updateLayers",
        updates: [{ key: "under", props: { rotation: 900, flipX: false } }],
      }),
    );
    // A quarter turn of 20 × 10 about its centre, (20, 13): 10 × 20 from (15, 3).
    const box = frame("under")?.getBoundingClientRect();
    const at = screen.at(15, 3);
    expect(box?.left).toBeCloseTo(at.x, 1);
    expect(box?.top).toBeCloseTo(at.y, 1);
    expect(box?.width).toBeCloseTo(10 * screen.scale, 1);
    expect(box?.height).toBeCloseTo(20 * screen.scale, 1);
    await act(async () =>
      session().execute({
        type: "image.updateLayers",
        updates: [{ key: "under", props: { rotation: 450, flipX: false } }],
      }),
    );
    // An eighth: the frame's bounds are a square of (20 + 10) / √2, about the same centre.
    const turned = frame("under")?.getBoundingClientRect();
    const side = (30 / Math.SQRT2) * screen.scale;
    const centre = screen.at(20, 13);
    expect(turned?.width).toBeCloseTo(side, 1);
    expect(turned?.height).toBeCloseTo(side, 1);
    expect((turned?.left ?? 0) + (turned?.width ?? 0) / 2).toBeCloseTo(centre.x, 1);
    expect((turned?.top ?? 0) + (turned?.height ?? 0) / 2).toBeCloseTo(centre.y, 1);
    expect(description(frame("under"))).toContain("turned 45°");
  });

  it("selects from the list, and shows or hides a layer as one step", async () => {
    const { session, layer } = await opened();
    await layering();
    await click(select("under"));
    expect(row("under")?.getAttribute("aria-selected")).toBe("true");
    expect(row("over")?.getAttribute("aria-selected")).toBe("false");
    expect(frame("under")?.hasAttribute("data-hm-selected")).toBe(true);
    expect(frames().map((item) => item.tabIndex)).toEqual([0, -1, -1]);
    // Selecting isn't an edit.
    expect(session().getSnapshot().canUndo).toBe(true);
    const toggle = visibility("middle");
    expect(toggle?.getAttribute("aria-label")).toBe("Show Hello");
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    await click(toggle);
    expect(layer("middle")?.visible).toBe(false);
    expect(visibility("middle")?.getAttribute("aria-pressed")).toBe("false");
    // A hidden layer has no frame, until it's selected.
    expect(frame("middle")).toBeNull();
    await click(select("middle"));
    expect(frame("middle")?.hasAttribute("data-hm-hidden")).toBe(true);
    await click(visibility("middle"));
    expect(layer("middle")?.visible).toBe(true);
    expect(session().undo()).toBe(true);
    expect(layer("middle")?.visible).toBe(false);
  });

  it("moves a layer up and down the stack with Alt and the arrows, in the list, keeping focus", async () => {
    const { keys, session } = await opened();
    await layering();
    await act(async () => select("under")?.focus());
    // Up the list is up the stack.
    expect(await key(select("under"), { key: "ArrowUp", altKey: true })).toBe(true);
    expect(keys()).toEqual(["middle", "under", "over"]);
    expect(names()).toEqual(["Badge", "Rectangle", "Hello"]);
    await until(() => document.activeElement === select("under"), "focus on the moved row");
    expect(row("under")?.getAttribute("aria-selected")).toBe("true");
    await said("Moved Rectangle up. It's layer 2 of 3.");
    expect(await key(select("under"), { key: "ArrowUp", altKey: true })).toBe(true);
    expect(keys()).toEqual(["middle", "over", "under"]);
    await until(() => document.activeElement === select("under"), "focus at the top");
    // At the top there's nowhere to go: the key is still taken, and nothing changes.
    expect(await key(select("under"), { key: "ArrowUp", altKey: true })).toBe(true);
    expect(keys()).toEqual(["middle", "over", "under"]);
    // From a row's other button, too, and focus stays on that button.
    await act(async () => visibility("under")?.focus());
    expect(await key(visibility("under"), { key: "ArrowDown", altKey: true })).toBe(true);
    expect(keys()).toEqual(["middle", "under", "over"]);
    await until(() => document.activeElement === visibility("under"), "focus on its other button");
    await said("Moved Rectangle down. It's layer 2 of 3.");
    // Each move is one step.
    expect(session().undo()).toBe(true);
    expect(keys()).toEqual(["middle", "over", "under"]);
  });

  it("leaves focus where it has gone after a move key that had nowhere to move", async () => {
    await opened();
    await layering();
    await act(async () => select("over")?.focus());
    // The top layer can't go up: nothing changes, and nothing renders.
    expect(await key(select("over"), { key: "ArrowUp", altKey: true })).toBe(true);
    await act(async () => frame("over")?.focus());
    // The next render mustn't pull focus back to the list.
    expect(await key(frame("over"), { key: "ArrowLeft" })).toBe(true);
    await rendered();
    expect(document.activeElement).toBe(frame("over"));
    await afterKeys();
    expect(document.activeElement).toBe(frame("over"));
  });

  it("leaves the list's keys alone with other modifiers, in a field, and outside the list", async () => {
    const { keys } = await opened();
    await layering();
    await act(async () => select("under")?.focus());
    for (const modifier of ["ctrlKey", "metaKey", "shiftKey"] as const) {
      expect(
        await key(select("under"), { key: "ArrowUp", altKey: true, [modifier]: true }),
        modifier,
      ).toBe(false);
      expect(await key(select("under"), { key: "Delete", [modifier]: true }), modifier).toBe(false);
    }
    // The arrows alone are the list's own: they move between rows, and select.
    expect(await key(select("under"), { key: "ArrowUp" })).toBe(true);
    expect(document.activeElement).toBe(select("middle"));
    expect(row("middle")?.getAttribute("aria-selected")).toBe("true");
    // In the name's field, the keys are the field's: nothing moves and nothing is deleted.
    const name = field("Name");
    expect(name).not.toBeNull();
    await act(async () => name?.focus());
    expect(await key(name, { key: "ArrowUp", altKey: true })).toBe(false);
    expect(await key(name, { key: "Delete" })).toBe(false);
    expect(await key(name, { key: "Backspace" })).toBe(false);
    // On the buttons under the list, too.
    expect(await key(named("Move up"), { key: "ArrowUp", altKey: true })).toBe(false);
    expect(keys()).toEqual(["under", "middle", "over"]);
  });

  it("deletes with Delete or Backspace in the list, selecting and focusing the layer in its place", async () => {
    const { keys, session } = await opened();
    await layering();
    await act(async () => select("middle")?.focus());
    expect(await key(select("middle"), { key: "Delete" })).toBe(true);
    expect(keys()).toEqual(["under", "over"]);
    await said("Deleted Hello.");
    // The layer now in its place in the list: the one that was under it.
    await until(() => document.activeElement === select("under"), "focus on the next row");
    expect(row("under")?.getAttribute("aria-selected")).toBe("true");
    expect(await key(select("under"), { key: "Backspace" })).toBe(true);
    // The bottom one went: the new bottom one.
    await until(() => document.activeElement === select("over"), "focus on the last row");
    expect(row("over")?.getAttribute("aria-selected")).toBe("true");
    expect(await key(select("over"), { key: "Delete" })).toBe(true);
    expect(keys()).toEqual([]);
    // None left: focus goes to Done, never to the page.
    expect(document.activeElement).toBe(button("Done"));
    expect(panel()?.textContent).toContain("No layers yet.");
    // Undo brings a layer back; nothing is selected until it's chosen.
    await act(async () => {
      session().undo();
    });
    await until(() => rows().length === 1, "the layer to return");
    expect(rows()[0]?.getAttribute("aria-selected")).toBe("false");
  });

  it("moves, copies and deletes the selected layer with the panel's buttons, which keep focus", async () => {
    const { keys, layer, session } = await opened();
    await layering();
    // The top layer can't go higher: the button says so, and stays focusable.
    expect(named("Move up")?.getAttribute("aria-disabled")).toBe("true");
    await act(async () => named("Move down")?.focus());
    await click(named("Move down"));
    expect(keys()).toEqual(["under", "over", "middle"]);
    await click(named("Move down"));
    expect(keys()).toEqual(["over", "under", "middle"]);
    // At the bottom the button is disabled, and focus is still on it.
    expect(named("Move down")?.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(named("Move down"));
    await click(named("Move down"));
    expect(keys()).toEqual(["over", "under", "middle"]);
    await click(named("Move up"));
    expect(keys()).toEqual(["under", "over", "middle"]);

    await click(named("Duplicate"));
    // The copy sits over its original, a little down and right, and is selected.
    expect(keys()).toHaveLength(4);
    const copy = keys()[2] as string;
    expect(keys()).toEqual(["under", "over", copy, "middle"]);
    expect(layer(copy)).toEqual({ ...layer("over"), key: copy, x: 44, y: 28 });
    expect(row(copy)?.getAttribute("aria-selected")).toBe("true");
    await said("Duplicated Badge.");
    expect(session().undo()).toBe(true);
    expect(keys()).toEqual(["under", "over", "middle"]);
    await act(async () => {
      session().redo();
    });

    await act(async () => named("Delete")?.focus());
    await click(named("Delete"));
    expect(keys()).toEqual(["under", "over", "middle"]);
    // The layer in its place in the list, the one that was under it, is
    // selected, and the button still has focus.
    expect(row("over")?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(named("Delete"));
  });

  it("mirrors the selected layer with the panel's button, as one step, and resizes it as it's seen", async () => {
    const { layer, session } = await opened();
    await layering();
    await click(select("under"));
    expect(named("Mirror")?.getAttribute("aria-pressed")).toBe("false");
    const before = frame("under")?.getBoundingClientRect();
    await act(async () => named("Mirror")?.focus());
    await click(named("Mirror"));
    expect(layer("under")).toMatchObject({ flipX: true, x: 10, y: 8, width: 20, height: 10 });
    expect(named("Mirror")?.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(named("Mirror"));
    // Mirrored about its own centre: the frame is where it was.
    const mirrored = frame("under")?.getBoundingClientRect();
    expect(mirrored?.left).toBeCloseTo(before?.left ?? 0, 1);
    expect(mirrored?.width).toBeCloseTo(before?.width ?? 0, 1);
    // Shift with Right still grows what's seen to the right: the box's own left, now.
    await act(async () => frame("under")?.focus());
    await key(frame("under"), { key: "ArrowRight", shiftKey: true });
    await key(frame("under"), { key: "ArrowRight", shiftKey: true });
    await afterKeys();
    expect(layer("under")).toMatchObject({ flipX: true, x: 10, width: 22 });
    await until(
      () => (frame("under")?.getBoundingClientRect().width ?? 0) > (mirrored?.width ?? 0) + 1,
      "the frame to grow",
    );
    const grown = frame("under")?.getBoundingClientRect();
    expect(grown?.left).toBeCloseTo(mirrored?.left ?? 0, 1);
    // And the arrows move it the way they point.
    await key(frame("under"), { key: "ArrowLeft" });
    await afterKeys();
    expect(layer("under")).toMatchObject({ x: 9 });
    // Each press was one step; the button mirrors it back.
    expect(session().undo()).toBe(true);
    expect(layer("under")).toMatchObject({ flipX: true, x: 10, width: 22 });
    expect(session().undo() && session().undo()).toBe(true);
    expect(layer("under")).toMatchObject({ flipX: true, x: 10, width: 20 });
    await click(named("Mirror"));
    expect(layer("under")?.flipX).toBe(false);
  });

  /** A drawing and an arrow over the three boxed layers. */
  async function withDrawn() {
    const result = await opened();
    const shared = { name: "", visible: true, opacity: 100 };
    await act(async () =>
      result.session().execute({
        type: "image.insertLayers",
        at: 3,
        layers: [
          {
            ...shared,
            key: "sketch",
            kind: "drawing",
            x: 5,
            y: 5,
            strokes: [{ colour: "#000000", width: 2, runs: [[0, 0, 10, 6]] }],
          },
          {
            ...shared,
            key: "pointer",
            kind: "arrow",
            from: { x: 40, y: 30 },
            to: { x: 20, y: 10 },
            colour: "#ff0000",
            width: 2,
          },
        ],
      }),
    );
    const arrowLayer = () =>
      result.plan().layers.find((item) => item.key === "pointer") as ImageArrowLayer;
    const drawingLayer = () =>
      result.plan().layers.find((item) => item.key === "sketch") as ImageDrawingLayer;
    return { ...result, arrowLayer, drawingLayer };
  }
  const ends = () =>
    [...(frame("pointer")?.querySelectorAll<HTMLElement>("[data-hm-end]") ?? [])].map((end) => {
      const box = end.getBoundingClientRect();
      return {
        end: end.dataset["hmEnd"],
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
      };
    });
  const kinds = () =>
    [...document.querySelectorAll<HTMLElement>(".hm-image-layer-kind")].map(
      (kind) => getComputedStyle(kind).visibility === "visible",
    );

  it("gives a drawing and an arrow frames around what they draw, and an arrow a handle on each end", async () => {
    const { layer } = await withDrawn();
    await layering();
    // By their kinds, the top one first and selected.
    expect(names()).toEqual(["Arrow", "Drawing", "Badge", "Hello", "Rectangle"]);
    expect(row("pointer")?.getAttribute("aria-selected")).toBe("true");
    expect(frames().map((item) => [item.dataset["hmLayer"], item.dataset["hmKind"]])).toEqual([
      ["under", "shape"],
      ["middle", "text"],
      ["over", "shape"],
      ["sketch", "drawing"],
      ["pointer", "arrow"],
    ]);
    const screen = screenOf(layer("under"));
    // The drawing: its points from 5, 5 to 15, 11, and half its stroke's width around them.
    const sketch = frame("sketch")?.getBoundingClientRect();
    expect(sketch?.left).toBeCloseTo(screen.at(4, 4).x, 1);
    expect(sketch?.top).toBeCloseTo(screen.at(4, 4).y, 1);
    expect(sketch?.width).toBeCloseTo(12 * screen.scale, 1);
    expect(sketch?.height).toBeCloseTo(8 * screen.scale, 1);
    // The arrow: its outline's bounds, with its tip at the top-left corner's side.
    const pointer = frame("pointer")?.getBoundingClientRect();
    expect((pointer?.left ?? 0) / 1).toBeLessThanOrEqual(screen.at(20, 10).x + 0.5);
    expect((pointer?.right ?? 0) / 1).toBeGreaterThanOrEqual(screen.at(40, 30).x - 0.5);
    // Its two ends have handles on the points themselves; the drawing has none.
    expect(frame("sketch")?.querySelectorAll(".hm-image-layer-handle")).toHaveLength(0);
    const [tail, tip] = ends();
    expect([tail?.end, tip?.end]).toEqual(["from", "to"]);
    expect(tail?.x).toBeCloseTo(screen.at(40, 30).x, 0);
    expect(tail?.y).toBeCloseTo(screen.at(40, 30).y, 0);
    expect(tip?.x).toBeCloseTo(screen.at(20, 10).x, 0);
    expect(tip?.y).toBeCloseTo(screen.at(20, 10).y, 0);
    expect(frame("pointer")?.getAttribute("aria-label")).toBe("Layer 1 of 5: Arrow");
    expect(description(frame("pointer"))).toBe(
      "From 40, 30 to 20, 10. Arrow keys move it; with Shift, they move its tip; Delete removes it and Escape closes the layers.",
    );
    expect(description(frame("sketch"))).toBe(
      "1 stroke, 12 × 8 pixels, from 4, 4. Arrow keys move it; Delete removes it and Escape closes the layers.",
    );
  });

  it("moves an arrow and re-aims it with keys, its handles and its fields", async () => {
    const { arrowLayer, session } = await withDrawn();
    await layering();
    const target = () => frame("pointer");
    await act(async () => target()?.focus());
    // The arrows move both ends; with Shift, the tip alone.
    expect(await key(target(), { key: "ArrowRight" })).toBe(true);
    expect(await key(target(), { key: "ArrowRight" })).toBe(true);
    expect(await key(target(), { key: "ArrowDown", shiftKey: true })).toBe(true);
    expect(await key(target(), { key: "ArrowLeft", altKey: true })).toBe(false);
    expect(arrowLayer()).toMatchObject({ from: { x: 42, y: 30 }, to: { x: 22, y: 11 } });
    expect(description(target())).toContain("From 42, 30 to 22, 11.");
    // One step per press: three to undo.
    await act(async () => {
      expect(session().undo()).toBe(true);
    });
    expect(arrowLayer()).toMatchObject({ from: { x: 42, y: 30 }, to: { x: 22, y: 10 } });
    await act(async () => {
      expect(session().undo() && session().undo()).toBe(true);
    });
    expect(arrowLayer()).toMatchObject({ from: { x: 40, y: 30 }, to: { x: 20, y: 10 } });
    await rendered();
    // The tip's handle, dragged: the tail stays.
    const scale =
      Math.hypot(
        (ends()[0]?.x ?? 0) - (ends()[1]?.x ?? 0),
        (ends()[0]?.y ?? 0) - (ends()[1]?.y ?? 0),
      ) / Math.hypot(20, 20);
    const tipHandle = target()?.querySelector('[data-hm-end="to"]') ?? null;
    const tip = ends()[1] as { x: number; y: number };
    expect(document.elementFromPoint(tip.x, tip.y)).toBe(tipHandle);
    await pointer(tipHandle, "pointerdown", tip.x, tip.y);
    await pointer(tipHandle, "pointermove", tip.x - 6 * scale, tip.y + 9 * scale);
    await pointer(tipHandle, "pointerup", tip.x - 6 * scale, tip.y + 9 * scale);
    expect(arrowLayer()).toMatchObject({ from: { x: 40, y: 30 }, to: { x: 14, y: 19 } });
    // Dragged onto the tail, it has no direction: nothing is set.
    const tailHandle = target()?.querySelector('[data-hm-end="from"]') ?? null;
    const [tailAt, tipAt] = ends() as unknown as [
      { x: number; y: number },
      { x: number; y: number },
    ];
    await pointer(tailHandle, "pointerdown", tailAt.x, tailAt.y);
    await pointer(tailHandle, "pointermove", tipAt.x, tipAt.y);
    await pointer(tailHandle, "pointerup", tipAt.x, tipAt.y);
    expect(arrowLayer()).toMatchObject({ from: { x: 40, y: 30 }, to: { x: 14, y: 19 } });
    // Its fields: the box's are disabled, its own show, and re-aim it without a drag.
    expect(kinds()).toEqual([false, false, true]);
    expect(fields().map((input) => input.disabled)).toEqual([
      false,
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(named("Mirror")?.getAttribute("aria-disabled")).toBe("true");
    const own = () => [
      ...document.querySelectorAll<HTMLInputElement>(".hm-image-layer-ends input"),
    ];
    expect(own().map((input) => input.value)).toEqual(["40", "30", "14", "19"]);
    await type(own()[2], "25");
    await type(own()[1], "33");
    expect(arrowLayer()).toMatchObject({ from: { x: 40, y: 33 }, to: { x: 25, y: 19 } });
    // A value that would put the tip on the tail isn't set.
    await type(own()[3], "33");
    await type(own()[2], "40");
    expect(arrowLayer()).toMatchObject({ from: { x: 40, y: 33 }, to: { x: 25, y: 33 } });
    expect(document.querySelector(".hm-image-layers-problem")).toBeNull();
  });

  it("moves a drawing by its origin, with keys, a drag and its place's fields, and never resizes it", async () => {
    const { drawingLayer, session } = await withDrawn();
    await layering();
    await click(select("sketch"));
    const target = () => frame("sketch");
    await act(async () => target()?.focus());
    expect(await key(target(), { key: "ArrowLeft" })).toBe(true);
    expect(await key(target(), { key: "ArrowDown" })).toBe(true);
    // Shift with an arrow has nothing to resize: the drawing stays as it is.
    await key(target(), { key: "ArrowRight", shiftKey: true });
    await afterKeys();
    expect(drawingLayer()).toMatchObject({ x: 4, y: 6, strokes: [{ runs: [[0, 0, 10, 6]] }] });
    // A drag moves it, as one step.
    const box = target()?.getBoundingClientRect();
    if (!box) throw new Error("no frame");
    const scale = box.width / 12;
    const middle = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    await pointer(target(), "pointerdown", middle.x, middle.y);
    await pointer(target(), "pointermove", middle.x + 7 * scale, middle.y - 2 * scale);
    await pointer(target(), "pointerup", middle.x + 7 * scale, middle.y - 2 * scale);
    expect(drawingLayer()).toMatchObject({ x: 11, y: 4 });
    await act(async () => {
      expect(session().undo()).toBe(true);
    });
    expect(drawingLayer()).toMatchObject({ x: 4, y: 6 });
    // Its place is set from the fields; it has no size or turn to set, and no fields of its own.
    expect(fields().map((input) => input.disabled)).toEqual([
      false,
      false,
      false,
      true,
      true,
      true,
      false,
    ]);
    expect(kinds()).toEqual([false, false, false]);
    await type(fields()[1], "20");
    await type(fields()[2], "-3");
    expect(drawingLayer()).toMatchObject({ x: 20, y: -3 });
  });

  it("hides, moves, copies and deletes a drawing and an arrow like any layer", async () => {
    const { keys, plan } = await withDrawn();
    await layering();
    await click(visibility("pointer"));
    expect(plan().layers.at(-1)).toMatchObject({ key: "pointer", visible: false });
    // Hidden and selected, its frame stays.
    expect(frame("pointer")?.hasAttribute("data-hm-hidden")).toBe(true);
    await click(named("Move down"));
    expect(keys()).toEqual(["under", "middle", "over", "pointer", "sketch"]);
    await click(named("Duplicate"));
    const copy = keys()[4] as string;
    expect(plan().layers[4]).toMatchObject({
      kind: "arrow",
      from: { x: 48, y: 38 },
      to: { x: 28, y: 18 },
    });
    expect(row(copy)?.getAttribute("aria-selected")).toBe("true");
    await click(select("sketch"));
    await click(named("Duplicate"));
    expect(
      plan().layers.find((item) => item.key !== "sketch" && item.kind === "drawing"),
    ).toMatchObject({ x: 13, y: 13, strokes: [{ runs: [[0, 0, 10, 6]] }] });
    await act(async () => frame("sketch")?.focus());
    expect(await key(frame("sketch"), { key: "Delete" })).toBe(true);
    expect(keys()).not.toContain("sketch");
    expect(document.activeElement?.classList.contains("hm-image-layer-frame")).toBe(true);
    expect(document.querySelector(".hm-image-layers-problem")).toBeNull();
  });

  it("says why when the session refuses a copy, and changes nothing", async () => {
    const { keys } = await opened(LAYERS, { filePolicy: { maxLayers: 3 } });
    await layering();
    await click(named("Duplicate"));
    expect(keys()).toEqual(["under", "middle", "over"]);
    const alert = document.querySelector(".hm-image-layers-problem");
    expect(alert?.getAttribute("role")).toBe("alert");
    expect(alert?.textContent).toMatch(/3/);
    // The next action that works clears it.
    await click(named("Move down"));
    expect(document.querySelector(".hm-image-layers-problem")).toBeNull();
  });

  it("moves and resizes a frame with keys, one step per press", async () => {
    const changes: ImagePlan[] = [];
    const { session, layer } = await opened(LAYERS, { onChange: (plan) => changes.push(plan) });
    await layering();
    const target = () => frame("over");
    await act(async () => target()?.focus());
    const count = changes.length;
    for (let i = 0; i < 3; i += 1) expect(await key(target(), { key: "ArrowLeft" })).toBe(true);
    for (let i = 0; i < 5; i += 1) expect(await key(target(), { key: "ArrowDown" })).toBe(true);
    expect(await key(target(), { key: "ArrowRight", shiftKey: true })).toBe(true);
    expect(await key(target(), { key: "ArrowUp", shiftKey: true })).toBe(true);
    // Alt, Control and Meta with a key are the browser's: not taken.
    for (const modifier of ["altKey", "ctrlKey", "metaKey"] as const) {
      expect(await key(target(), { key: "ArrowLeft", [modifier]: true }), modifier).toBe(false);
      expect(await key(target(), { key: "Delete", [modifier]: true }), modifier).toBe(false);
    }
    // Each press is a step.
    expect(layer("over")).toMatchObject({ x: 33, y: 25, width: 17, height: 11 });
    expect(description(target())).toContain("17 × 11 pixels, from 33, 25");
    expect(changes).toHaveLength(count + 10);
    expect(document.activeElement).toBe(target());
    expect(session().undo()).toBe(true);
    expect(layer("over")).toMatchObject({ x: 33, y: 25, width: 17, height: 12 });
  });

  it("makes a key held down one step, cancels it with Escape, and ends it when focus leaves", async () => {
    const changes: ImagePlan[] = [];
    const { layer } = await opened(LAYERS, { onChange: (plan) => changes.push(plan) });
    await layering();
    const target = () => frame("over");
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
    expect(description(target())).toContain("from 40, 20");
    expect(layer("over")).toMatchObject({ x: 36 });
    expect(changes).toHaveLength(count);
    await up({ key: "ArrowRight" });
    expect(layer("over")).toMatchObject({ x: 40 });
    expect(changes).toHaveLength(count + 1);
    // Escape while it's held: back where it was, and the rest of it is ignored.
    await down({ key: "ArrowLeft" });
    expect(description(target())).toContain("from 39, 20");
    await down({ key: "Escape" });
    expect(description(target())).toContain("from 40, 20");
    await down({ key: "ArrowLeft", repeat: true });
    expect(description(target())).toContain("from 40, 20");
    await up({ key: "ArrowLeft" });
    expect(layer("over")).toMatchObject({ x: 40 });
    expect(changes).toHaveLength(count + 1);
    // The layers are still shown: that Escape cancelled the key, not the tool.
    expect(target()).not.toBeNull();
    // Focus leaving with a key held ends it as one step.
    await down({ key: "ArrowDown" });
    await act(async () => named("Mirror")?.focus());
    expect(layer("over")).toMatchObject({ x: 40, y: 21 });
    expect(changes).toHaveLength(count + 2);
  });

  it("keeps a pointer drag and a run of arrow keys from committing each other", async () => {
    const changes: ImagePlan[] = [];
    const { layer } = await opened(LAYERS, { onChange: (plan) => changes.push(plan) });
    await layering();
    const target = () => frame("over");
    await act(async () => target()?.focus());
    const count = changes.length;
    const box = target()?.getBoundingClientRect();
    if (!box) throw new Error("no frame");
    const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    // An arrow pressed during a drag neither moves the frame nor commits the drag.
    await pointer(target(), "pointerdown", centre.x, centre.y);
    await pointer(target(), "pointermove", centre.x + 30, centre.y + 15);
    await key(target(), { key: "ArrowRight" });
    expect(changes).toHaveLength(count);
    expect(layer("over")).toMatchObject({ x: 36, y: 20 });
    // So a cancelled drag still leaves the layer where it was.
    await pointer(target(), "pointercancel", centre.x + 30, centre.y + 15);
    expect(description(target())).toContain("from 36, 20");
    expect(changes).toHaveLength(count);
    // A press while a key is held ends the key's run first, as its own step.
    await act(async () => {
      target()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      );
    });
    expect(description(target())).toContain("from 37, 20");
    await pointer(target(), "pointerdown", centre.x, centre.y);
    expect(layer("over")).toMatchObject({ x: 37 });
    expect(changes).toHaveLength(count + 1);
    await pointer(target(), "pointerup", centre.x, centre.y);
    expect(changes).toHaveLength(count + 1);
    // A key held after Escape stays ignored through a press of the pointer,
    // until it's let go.
    const arrow = (type: string, repeat = false) =>
      act(async () => {
        target()?.dispatchEvent(
          new KeyboardEvent(type, { key: "ArrowRight", repeat, bubbles: true, cancelable: true }),
        );
      });
    await arrow("keydown");
    expect(description(target())).toContain("from 38, 20");
    await act(async () => {
      target()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    expect(description(target())).toContain("from 37, 20");
    await pointer(target(), "pointerdown", centre.x, centre.y);
    await pointer(target(), "pointerup", centre.x, centre.y);
    await arrow("keydown", true);
    expect(description(target())).toContain("from 37, 20");
    await arrow("keyup");
    expect(layer("over")).toMatchObject({ x: 37 });
    expect(changes).toHaveLength(count + 1);
  });

  it("moves and resizes as seen on screen when the image is turned and mirrored", async () => {
    const { session, layer } = await opened();
    await act(async () =>
      session().execute({
        type: "image.setOrientation",
        orientation: { rotate: 90, flipX: true, flipY: false },
      }),
    );
    await layering();
    const target = () => frame("over");
    const before = target()?.getBoundingClientRect();
    await act(async () => target()?.focus());
    for (let i = 0; i < 4; i += 1) await key(target(), { key: "ArrowRight" });
    await afterKeys();
    await until(
      () => (target()?.getBoundingClientRect().left ?? 0) > (before?.left ?? 0),
      "the frame to move right",
    );
    const moved = target()?.getBoundingClientRect();
    const scale = Math.max(before?.width ?? 0, before?.height ?? 0) / 16;
    expect((moved?.left ?? 0) - (before?.left ?? 0)).toBeCloseTo(4 * scale, 1);
    expect(moved?.top).toBeCloseTo(before?.top ?? 0, 1);
    // The size is the layer's own: only its place changed.
    expect(layer("over")).toMatchObject({ width: 16, height: 12 });
    // Shift with Right grows what's seen to the right, and the left side stays.
    await key(target(), { key: "ArrowRight", shiftKey: true });
    await key(target(), { key: "ArrowRight", shiftKey: true });
    await afterKeys();
    await until(
      () => (target()?.getBoundingClientRect().width ?? 0) > (moved?.width ?? 0),
      "the frame to grow",
    );
    const grown = target()?.getBoundingClientRect();
    expect(grown?.left).toBeCloseTo(moved?.left ?? 0, 1);
    expect((grown?.width ?? 0) - (moved?.width ?? 0)).toBeCloseTo(2 * scale, 1);
    expect(grown?.top).toBeCloseTo(moved?.top ?? 0, 1);
    expect(grown?.height).toBeCloseTo(moved?.height ?? 0, 1);
  });

  it("moves an image layer, whose box is checked against its own source", async () => {
    const { session, plan } = await opened([]);
    await act(async () => {
      await session().insertImage(await photo());
    });
    const [image] = plan().layers;
    if (image?.kind !== "image") throw new Error("no image layer");
    await layering();
    await act(async () => frame(image.key)?.focus());
    // A gesture's transient plan resolves the layer's source, as the session does.
    expect(await key(frame(image.key), { key: "ArrowRight" })).toBe(true);
    expect(await key(frame(image.key), { key: "ArrowDown", shiftKey: true })).toBe(true);
    await afterKeys();
    expect(plan().layers[0]).toMatchObject({
      x: image.x + 1,
      y: image.y,
      width: image.width,
      height: image.height + 1,
    });
    expect(names()).toEqual(["Image"]);
  });

  it("deletes from a frame, moving focus to the frame of the layer in its place, then to Done", async () => {
    const { keys } = await opened();
    await layering();
    await act(async () => frame("middle")?.focus());
    expect(row("middle")?.getAttribute("aria-selected")).toBe("true");
    expect(await key(frame("middle"), { key: "Delete" })).toBe(true);
    expect(keys()).toEqual(["under", "over"]);
    // The layer that was under it, as the list orders them; then the one left.
    await until(() => document.activeElement === frame("under"), "focus on the next frame");
    expect(await key(frame("under"), { key: "Backspace" })).toBe(true);
    await until(() => document.activeElement === frame("over"), "focus on the last frame");
    expect(await key(frame("over"), { key: "Delete" })).toBe(true);
    expect(keys()).toEqual([]);
    expect(document.activeElement).toBe(button("Done"));
  });

  it("selects the top layer under a press, moves it by a drag, and resizes it by a handle", async () => {
    const { session, layer } = await opened();
    await layering();
    const screen = screenOf(layer("under"));
    // A press on the rectangle selects it, and takes focus.
    const inside = screen.at(20, 13);
    expect(document.elementFromPoint(inside.x, inside.y)).toBe(frame("under"));
    await pointer(frame("under"), "pointerdown", inside.x, inside.y);
    expect(row("under")?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(frame("under"));
    // Without a move, a press and release is no edit.
    await pointer(frame("under"), "pointerup", inside.x, inside.y);
    expect(session().getSnapshot().canUndo).toBe(true);
    const steps = () => {
      let count = 0;
      while (session().undo()) count += 1;
      for (let i = 0; i < count; i += 1) session().redo();
      return count;
    };
    const before = steps();
    await pointer(frame("under"), "pointerdown", inside.x, inside.y);
    await pointer(
      frame("under"),
      "pointermove",
      inside.x + 7 * screen.scale,
      inside.y - 3 * screen.scale,
    );
    // Shown on the stage while dragging, and not yet an edit.
    expect(description(frame("under"))).toContain("from 17, 5");
    expect(layer("under")).toMatchObject({ x: 10, y: 8 });
    await pointer(
      frame("under"),
      "pointerup",
      inside.x + 7 * screen.scale,
      inside.y - 3 * screen.scale,
    );
    expect(layer("under")).toMatchObject({ x: 17, y: 5, width: 20, height: 10 });
    expect(steps()).toBe(before + 1);
    // The north-west handle, dragged in by 4 and 2: the far corner stays.
    const corner = frame("under")?.querySelector('[data-hm-handle="nw"]') ?? null;
    const at = corner?.getBoundingClientRect();
    if (!at) throw new Error("no handle");
    const grip = { x: at.left + at.width / 2, y: at.top + at.height / 2 };
    expect(document.elementFromPoint(grip.x, grip.y)).toBe(corner);
    await pointer(corner, "pointerdown", grip.x, grip.y);
    await pointer(corner, "pointermove", grip.x + 4 * screen.scale, grip.y + 2 * screen.scale);
    await pointer(corner, "pointerup", grip.x + 4 * screen.scale, grip.y + 2 * screen.scale);
    expect(layer("under")).toMatchObject({ x: 21, y: 7, width: 16, height: 8 });
    expect(steps()).toBe(before + 2);
    // A lost pointer leaves the plan as it was.
    await pointer(frame("under"), "pointerdown", grip.x + 30, grip.y + 20);
    await pointer(frame("under"), "pointermove", grip.x + 60, grip.y + 20);
    await pointer(frame("under"), "pointercancel", grip.x + 60, grip.y + 20);
    expect(layer("under")).toMatchObject({ x: 21, y: 7, width: 16, height: 8 });
    expect(steps()).toBe(before + 2);
    // A press on the image outside every layer selects none.
    const empty = screen.at(57, 3);
    expect(document.elementFromPoint(empty.x, empty.y)).toBe(overlay());
    await pointer(overlay(), "pointerdown", empty.x, empty.y);
    expect(rows().every((item) => item.getAttribute("aria-selected") !== "true")).toBe(true);
    expect(fields().every((input) => input.disabled)).toBe(true);
  });

  it("resizes a turned layer along its own sides, with a cursor for the way its handle moves", async () => {
    const { session, layer } = await opened();
    await act(async () =>
      session().execute({
        type: "image.updateLayers",
        updates: [{ key: "under", props: { rotation: 900, flipX: false } }],
      }),
    );
    await layering();
    await click(select("under"));
    const east = frame("under")?.querySelector<HTMLElement>('[data-hm-handle="e"]') ?? null;
    // Turned a quarter clockwise, the layer's own east side faces down.
    expect(east?.style.cursor).toBe("ns-resize");
    const at = east?.getBoundingClientRect();
    if (!at) throw new Error("no handle");
    const scale = (frame("under")?.getBoundingClientRect().height ?? 0) / 20;
    const grip = { x: at.left + at.width / 2, y: at.top + at.height / 2 };
    await pointer(east, "pointerdown", grip.x, grip.y);
    await pointer(east, "pointermove", grip.x, grip.y + 6 * scale);
    await pointer(east, "pointerup", grip.x, grip.y + 6 * scale);
    // Six pixels down the screen are six along the layer's width.
    expect(layer("under")).toMatchObject({ width: 26, height: 10, rotation: 900 });
    // Its top on screen, the layer's own west side, is where it was: 3.
    const top = (layer("under")?.y ?? 0) + 5 - 13;
    expect(top).toBe(3);
  });

  it("sets the selected layer's name, place, size, turn and opacity from the fields", async () => {
    const { layer, session } = await opened();
    await layering();
    expect(fields().every((input) => !input.disabled)).toBe(true);
    const inputs = () => fields();
    // Name, Left, Top, Width, Height, Turn, Opacity.
    expect(inputs()[0]?.value).toBe("Badge");
    await type(inputs()[1], "-6");
    await type(inputs()[2], "3");
    await type(inputs()[3], "40");
    await type(inputs()[4], "9");
    await type(inputs()[5], "12.5");
    await type(inputs()[6], "40");
    // A layer may start outside the image; the turn is held in tenths of a degree.
    expect(layer("over")).toMatchObject({
      x: -6,
      y: 3,
      width: 40,
      height: 9,
      rotation: 125,
      flipX: false,
      opacity: 40,
    });
    // A name loses what text can't hold, and its ends' spaces; the list shows it.
    await type(inputs()[0], "  Stamp\u202E\u0007 2  ");
    expect(layer("over")?.name).toBe("Stamp 2");
    expect(names()[0]).toBe("Stamp 2");
    expect(session().undo()).toBe(true);
    expect(layer("over")?.name).toBe("Badge");
    // Emptied, the layer goes by its kind again.
    await act(async () => {
      session().redo();
    });
    await type(inputs()[0], "");
    expect(layer("over")?.name).toBe("");
    expect(names()[0]).toBe("Ellipse");
    // The fields follow the selection.
    await click(select("under"));
    expect(inputs().map((input) => input.value)).toEqual(["", "10", "8", "20", "10", "0", "100"]);
  });

  it("shows the plan's name and text again over what was typed, as the layer or the plan changes", async () => {
    const { session } = await opened();
    await layering();
    /** Typed into a field without leaving it, so nothing is set on the layer. */
    const typed = (
      input: HTMLInputElement | HTMLTextAreaElement | null | undefined,
      value: string,
    ) =>
      act(async () => {
        if (!input) throw new Error("no field");
        const prototype = Object.getPrototypeOf(input) as object;
        Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    const name = () => field("Name");
    const text = () =>
      document.querySelector<HTMLTextAreaElement>(".hm-image-layers-text textarea");

    // The name: another layer's replaces what was typed, and so does the plan's after an undo.
    expect(name()?.value).toBe("Badge");
    await typed(name(), "Draft");
    expect(name()?.value).toBe("Draft");
    await click(select("under"));
    expect(name()?.value).toBe("");
    await click(select("over"));
    expect(name()?.value).toBe("Badge");
    await act(async () => {
      session().execute([
        { type: "image.updateLayers", updates: [{ key: "over", props: { name: "Stamp" } }] },
      ]);
    });
    expect(name()?.value).toBe("Stamp");
    await act(async () => {
      session().undo();
    });
    expect(name()?.value).toBe("Badge");

    // The text: the plan's replaces what was typed when it changes. Typing
    // sets the text as a step after a pause; the clock is held here, so it
    // stays typed and not set.
    await click(select("middle"));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    expect(text()?.value).toBe("Hello\nthere");
    await typed(text(), "Hello, draft");
    expect(text()?.value).toBe("Hello, draft");
    await act(async () => {
      session().execute([
        { type: "image.updateLayers", updates: [{ key: "middle", props: { text: "Goodbye" } }] },
      ]);
    });
    expect(text()?.value).toBe("Goodbye");
    await act(async () => {
      session().undo();
    });
    expect(text()?.value).toBe("Hello\nthere");
  });

  it("keeps the stage where it is, in a layout with the panel under it", async () => {
    // 400 pixels wide: the inspector sits under the stage and takes its
    // height from its content. If the panel grew, the stage would shrink,
    // and the image would move under the pointer during a drag.
    const { session } = await opened();
    await layering();
    const stage = () => document.querySelector(".hm-image-stage")?.getBoundingClientRect();
    const inspector = () =>
      document.querySelector(".hm-image-editor-inspector")?.getBoundingClientRect();
    expect((inspector()?.top ?? 0) >= (stage()?.bottom ?? 0)).toBe(true);
    const box = async () => {
      for (let i = 0; i < 4; i += 1) await rendered();
      const { top, left, width, height } = stage() ?? new DOMRect();
      return { top, left, width, height };
    };
    const start = await box();
    expect(start.height).toBeGreaterThan(0);
    const placed = frame("under")?.getBoundingClientRect();
    // Nothing selected: the fields keep their place, unseen and disabled.
    const edge = stage();
    await pointer(overlay(), "pointerdown", (edge?.left ?? 0) + 4, (edge?.top ?? 0) + 4);
    expect(fields().every((input) => input.disabled)).toBe(true);
    expect(await box(), "after deselecting").toEqual(start);
    // More layers than the list shows at once: it scrolls.
    await click(select("over"));
    for (let i = 0; i < 3; i += 1) await click(named("Duplicate"));
    expect(await box(), "after three copies").toEqual(start);
    const list = document.querySelector(".hm-image-layers-list");
    expect((list?.scrollHeight ?? 0) > (list?.clientHeight ?? 0)).toBe(true);
    // Every layer removed.
    await act(async () => {
      while (session().undo()) {}
    });
    expect(await box(), "with no layers").toEqual(start);
    await act(async () => {
      session().redo();
    });
    await until(() => frame("under") !== null, "the layers to return");
    const still = frame("under")?.getBoundingClientRect();
    expect([still?.left, still?.top]).toEqual([placed?.left, placed?.top]);
  });

  it("closes with Done, Escape or another tool, returning focus, and keeps the layers", async () => {
    const { keys, session } = await opened();
    await layering();
    await click(button("Done"));
    expect(panel()).toBeNull();
    expect(frames()).toHaveLength(0);
    expect(keys()).toHaveLength(3);
    expect(document.activeElement).toBe(tool());
    // Again, closed with Escape from a frame.
    await key(tool(), { key: "l" });
    await until(() => frames().length === 3, "the frames again");
    await act(async () => frame("over")?.focus());
    expect(await key(frame("over"), { key: "Escape" })).toBe(true);
    expect(panel()).toBeNull();
    expect(tool()?.getAttribute("aria-pressed")).toBe("false");
    // The selection follows undo: a layer that's gone isn't selected.
    await key(tool(), { key: "l" });
    await until(() => frames().length === 3, "the frames a third time");
    await act(async () => {
      session().undo();
    });
    await until(() => frames().length === 0, "the frames to go");
    expect(panel()?.textContent).toContain("No layers yet.");
    await act(async () => {
      session().redo();
    });
    await until(() => frames().length === 3, "the frames to return");
    // Redacting takes the stage.
    await click(document.querySelector('[data-tool="image.redact"]'));
    await until(() => document.querySelector(".hm-image-redact-overlay") !== null, "redacting");
    expect(frames()).toHaveLength(0);
    expect(tool()?.getAttribute("aria-pressed")).toBe("false");
  });
});
