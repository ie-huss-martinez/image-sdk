import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadStyles } from "../../../test/browser/styles.js";
import { FIRST_OPEN_TIMEOUT } from "../../../test/browser/timeouts.js";
import type { ImageLayer, ImagePlan } from "../../core/model/plan.js";
import { ImageEditor } from "../editor/ImageEditor.js";
import type { ImageEditorHandle, ImageEditorProps } from "../editor/types.js";
import { KEYBOARD_COMMIT_DELAY } from "../gesture.js";

/** A PNG the browser encodes. */
async function photo(width = 60, height = 40, colour = "#3080c0"): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2D canvas");
  context.fillStyle = colour;
  context.fillRect(0, 0, width, height);
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
  const plan = () => session().getSnapshot().plan as ImagePlan;
  const layers = () => plan().layers;
  const only = <Kind extends ImageLayer["kind"]>(kind: Kind) => {
    const found = layers().filter((layer) => layer.kind === kind);
    if (found.length !== 1) throw new Error(`expected one ${kind} layer, found ${found.length}`);
    return found[0] as Extract<ImageLayer, { kind: Kind }>;
  };
  return { handle, session, plan, layers, only };
}

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
const click = (element: Element | null | undefined) =>
  act(async () => {
    if (!element) throw new Error("nothing to click");
    (element as HTMLElement).click();
  });
const afterKeys = () =>
  act(async () => new Promise((resolve) => setTimeout(resolve, KEYBOARD_COMMIT_DELAY + 100)));
const rendered = () =>
  act(
    async () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

const tool = (id: string) => document.querySelector<HTMLButtonElement>(`[data-tool="image.${id}"]`);
const panel = () => document.querySelector('section[aria-label="Layers"]');
const frames = () => [...document.querySelectorAll<HTMLElement>(".hm-image-layer-frame")];
const names = () =>
  [...document.querySelectorAll(".hm-image-layers-list .hm-image-layer-select")].map(
    (item) => item.textContent,
  );
const textarea = () =>
  document.querySelector<HTMLTextAreaElement>(".hm-image-layers-text textarea");
const kinds = () => [...document.querySelectorAll<HTMLElement>(".hm-image-layer-kind")];
const shown = (element: Element | null | undefined) =>
  element !== null && element !== undefined && getComputedStyle(element).visibility === "visible";
const radio = (group: string, label: string) =>
  [
    ...document.querySelectorAll<HTMLElement>(
      `[role=radiogroup][aria-label="${group}"] [role=radio]`,
    ),
  ].find((option) => option.textContent === label);
const toggle = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>(".hm-image-layer-kind .hm-toggle-button")].find(
    (b) => b.textContent === text,
  );
/** The field with this visible label: its control, and its swatches. */
function labelled(text: string) {
  const label = [...document.querySelectorAll<HTMLLabelElement>(".hm-image-layer-kind label")].find(
    (item) => item.textContent === text,
  );
  const fieldRoot = label?.closest(".hm-field");
  return {
    input: (label ? document.getElementById(label.htmlFor) : null) as HTMLInputElement | null,
    swatch: (name: string) =>
      fieldRoot?.querySelector<HTMLElement>(`[role=radio][aria-label="${name}"]`) ?? null,
    swatches: fieldRoot?.querySelector('[role="radiogroup"]') ?? null,
  };
}
const alert = () => document.querySelector(".hm-image-stage-error");

/** Types into a field as a person does: the native setter, then the events React listens for. */
const type = (input: HTMLInputElement | HTMLTextAreaElement | null | undefined, value: string) =>
  act(async () => {
    if (!input) throw new Error("no field");
    input.focus();
    const prototype =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const commit = (input: HTMLInputElement | null | undefined) =>
  act(async () => {
    input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    input?.blur();
  });

/** How many steps the history holds, counted by undoing them and putting them back. */
function steps(session: () => ImageEditorHandle["session"]) {
  let count = 0;
  while (session().undo()) count += 1;
  for (let i = 0; i < count; i += 1) session().redo();
  return count;
}

describe("adding layers (docs/adr/0013)", () => {
  it("has a group of tools to add text, shapes and an image, off until an image is open", async () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<ImageEditor />));
    const group = document.querySelector('[role="group"][aria-label="Add"]');
    expect(
      [...(group?.querySelectorAll("button") ?? [])].map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Add text", "Add a rectangle", "Add an ellipse", "Add an arrow", "Add an image"]);
    expect(
      [...(group?.querySelectorAll("button") ?? [])].every(
        (b) => b.disabled || b.getAttribute("aria-disabled") === "true",
      ),
    ).toBe(true);
    expect(tool("add-text")?.getAttribute("aria-keyshortcuts")).toBe("T");
  });

  it("adds a rectangle in the middle, as one step, and shows the layers with it selected", async () => {
    const changes: ImagePlan[] = [];
    const { session, only, layers } = await opened({ onChange: (plan) => changes.push(plan) });
    const count = changes.length;
    const before = steps(session);
    await act(async () => tool("add-rectangle")?.focus());
    await click(tool("add-rectangle"));
    // A quarter of 60 × 40 each way, in its middle: an outline with no fill.
    expect(only("shape")).toMatchObject({
      shape: "rectangle",
      x: 23,
      y: 15,
      width: 15,
      height: 10,
      rotation: 0,
      flipX: false,
      fill: null,
      stroke: { colour: "#e02020", width: 2 },
    });
    expect(changes).toHaveLength(count + 1);
    expect(steps(session)).toBe(before + 1);
    expect(panel()).not.toBeNull();
    expect(tool("layers")?.getAttribute("aria-pressed")).toBe("true");
    expect(names()).toEqual(["Rectangle"]);
    await until(() => frames().length === 1, "its frame");
    expect(frames()[0]?.hasAttribute("data-hm-selected")).toBe(true);
    // Focus stays on the button, to add another or to move on from.
    expect(document.activeElement).toBe(tool("add-rectangle"));
    // An ellipse goes over it, and is the one selected.
    await click(tool("add-ellipse"));
    expect(layers().map((layer) => (layer.kind === "shape" ? layer.shape : layer.kind))).toEqual([
      "rectangle",
      "ellipse",
    ]);
    expect(names()).toEqual(["Ellipse", "Rectangle"]);
    expect(
      document.querySelector('.hm-image-layers-list [aria-selected="true"] .hm-image-layer-select')
        ?.textContent,
    ).toBe("Ellipse");
    expect(session().undo()).toBe(true);
    expect(layers()).toHaveLength(1);
  });

  it("adds text with T, with focus in its field, and draws it as it's typed: one step a burst", async () => {
    const changes: ImagePlan[] = [];
    const { session, only, plan } = await opened({ onChange: (plan) => changes.push(plan) });
    await act(async () => tool("layers")?.focus());
    expect(await key(tool("layers"), { key: "t" })).toBe(true);
    // Half the image wide and a fifth of it tall, with no text yet.
    expect(only("text")).toMatchObject({ text: "", x: 15, y: 16, width: 30, height: 8 });
    await until(() => document.activeElement === textarea(), "focus in the text field");
    expect(names()).toEqual(["Text"]);
    // Counting steps undoes and redoes them, which the host hears: count first.
    const before = steps(session);
    await until(() => textarea()?.value === "", "the field to settle");
    const count = changes.length;
    await type(textarea(), "Hel");
    await type(textarea(), "Hello");
    // Not an edit yet: the stage shows a transient plan with the text.
    expect(only("text").text).toBe("");
    expect(changes).toHaveLength(count);
    await afterKeys();
    expect(only("text").text).toBe("Hello");
    expect(changes).toHaveLength(count + 1);
    expect(steps(session)).toBe(before + 1);
    // The list goes by the text, and focus hasn't moved.
    expect(names()).toEqual(["Hello"]);
    expect(document.activeElement).toBe(textarea());
    expect(textarea()?.value).toBe("Hello");
    // Leaving the field sets what was typed at once.
    await type(textarea(), "Hello there");
    await act(async () => textarea()?.blur());
    expect(only("text").text).toBe("Hello there");
    expect(session().undo()).toBe(true);
    expect(plan().layers[0]).toMatchObject({ text: "Hello" });
    await until(() => textarea()?.value === "Hello", "the field to follow the undo");
  });

  it("takes text as the plan does: line feeds for every break, and none of what text can't hold", async () => {
    const { only } = await opened();
    await click(tool("add-text"));
    // As pasted from elsewhere: Windows and old Mac line breaks, a tab, a bidi override.
    await type(textarea(), "one\r\ntwo\rthree\tfour\u202E!");
    expect(textarea()?.value).toBe("one\ntwo\nthree four!");
    await act(async () => textarea()?.blur());
    expect(only("text").text).toBe("one\ntwo\nthree four!");
    // More than the plan holds is cut at its length, never refused.
    await type(textarea(), "x".repeat(1_200));
    await act(async () => textarea()?.blur());
    expect(only("text").text).toHaveLength(1_000);
    expect(alert()).toBeNull();
  });

  it("sets a text layer's font, weight, alignment and colour, each as one step", async () => {
    const { only, session } = await opened();
    await click(tool("add-text"));
    await type(textarea(), "Hi");
    await act(async () => textarea()?.blur());
    const before = steps(session);
    await click(radio("Font", "Serif"));
    await click(radio("Alignment", "End"));
    await click(toggle("Bold"));
    await click(labelled("Colour").swatch("Yellow"));
    expect(only("text")).toMatchObject({
      font: "serif",
      align: "end",
      bold: true,
      colour: "#f0c020",
    });
    expect(steps(session)).toBe(before + 4);
    expect(toggle("Bold")?.getAttribute("aria-pressed")).toBe("true");
    expect(radio("Font", "Serif")?.getAttribute("aria-checked")).toBe("true");
    // Any colour, typed: upper case and short forms are the field's to settle.
    const hex = labelled("Colour").input;
    await type(hex, "#1A2b3C");
    await commit(hex);
    expect(only("text").colour).toBe("#1a2b3c");
    // The swatches' group is named by the field and what it holds.
    const group = labelled("Colour").swatches;
    const name = (group?.getAttribute("aria-labelledby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent)
      .join(" ");
    expect(name).toBe("Colour swatches");
  });

  it("sets a shape's fill and outline, and never leaves it with neither", async () => {
    const { only, session } = await opened();
    await click(tool("add-ellipse"));
    expect(toggle("Fill")?.getAttribute("aria-pressed")).toBe("false");
    expect(toggle("Outline")?.getAttribute("aria-pressed")).toBe("true");
    // With no fill, its colour has nothing to set.
    expect(labelled("Fill colour").input?.disabled).toBe(true);
    await click(labelled("Outline colour").swatch("Blue"));
    const width = labelled("Outline width").input;
    await type(width, "4");
    await commit(width);
    expect(only("shape")).toMatchObject({ fill: null, stroke: { colour: "#2060e0", width: 4 } });
    // Fill on: it starts in the outline's colour.
    await click(toggle("Fill"));
    expect(only("shape")).toMatchObject({
      fill: "#2060e0",
      stroke: { colour: "#2060e0", width: 4 },
    });
    await click(labelled("Fill colour").swatch("White"));
    expect(only("shape").fill).toBe("#ffffff");
    // Outline off: the fill remains.
    await click(toggle("Outline"));
    expect(only("shape")).toMatchObject({ fill: "#ffffff", stroke: null });
    expect(labelled("Outline width").input?.disabled).toBe(true);
    // Turning off the only one turns on the other, in its colour, as one step.
    const before = steps(session);
    await click(toggle("Fill"));
    expect(only("shape")).toMatchObject({ fill: null, stroke: { colour: "#ffffff" } });
    expect(only("shape").stroke?.width).toBeGreaterThanOrEqual(1);
    expect(steps(session)).toBe(before + 1);
    await click(toggle("Outline"));
    expect(only("shape")).toMatchObject({ fill: "#ffffff", stroke: null });
    expect(alert()).toBeNull();
    expect(document.querySelector(".hm-image-layers-problem")).toBeNull();
  });

  it("shows the fields of the selected layer's kind, and keeps the stage where it is", async () => {
    const { session } = await opened();
    await click(tool("add-text"));
    await type(textarea(), "Hi");
    await act(async () => textarea()?.blur());
    const stage = () => document.querySelector(".hm-image-stage")?.getBoundingClientRect();
    const box = async () => {
      for (let i = 0; i < 4; i += 1) await rendered();
      const { top, left, width, height } = stage() ?? new DOMRect();
      return { top, left, width, height };
    };
    const start = await box();
    expect(start.height).toBeGreaterThan(0);
    // Text selected: its fields show, a shape's keep their place, unseen and disabled.
    expect(kinds().map(shown)).toEqual([true, false, false]);
    expect(
      [
        ...(kinds()[1]?.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button") ??
          []),
      ].every((control) => control.disabled),
    ).toBe(true);
    await click(tool("add-rectangle"));
    expect(kinds().map(shown)).toEqual([false, true, false]);
    expect(textarea()?.disabled).toBe(true);
    expect(await box(), "with a shape selected").toEqual(start);
    // An image layer has no fields of its own.
    await act(async () => {
      await session().insertImage(await photo(20, 10, "#ffffff"));
    });
    await click(document.querySelector(".hm-image-layers-list .hm-image-layer-select"));
    expect(kinds().map(shown)).toEqual([false, false, false]);
    expect(await box(), "with an image selected").toEqual(start);
    // Nothing selected.
    const edge = stage();
    await act(async () => {
      document.querySelector(".hm-image-layers-overlay")?.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: (edge?.left ?? 0) + 3,
          clientY: (edge?.top ?? 0) + 3,
        }),
      );
    });
    expect(kinds().map(shown)).toEqual([false, false, false]);
    expect(await box(), "with nothing selected").toEqual(start);
  });

  it("adds an image from the handle: fitted in the middle, on top, selected, as one step", async () => {
    const { handle, only, session, layers } = await opened();
    await click(tool("add-rectangle"));
    const before = steps(session);
    // 200 × 50 fits half of 60 × 40 at 30 × 8, rounded to whole pixels.
    await act(async () => handle.current?.insertImage(await photo(200, 50, "#ffffff")));
    expect(only("image")).toMatchObject({
      x: 15,
      y: 16,
      width: 30,
      height: 8,
      rotation: 0,
      flipX: false,
      crop: null,
    });
    expect(layers().at(-1)?.kind).toBe("image");
    expect(steps(session)).toBe(before + 1);
    expect(names()).toEqual(["Image", "Rectangle"]);
    expect(
      document.querySelector('.hm-image-layers-list [aria-selected="true"] .hm-image-layer-select')
        ?.textContent,
    ).toBe("Image");
    // A small one keeps its own size.
    await act(async () => handle.current?.insertImage(await photo(6, 4, "#000000")));
    expect(layers().at(-1)).toMatchObject({ kind: "image", width: 6, height: 4, x: 27, y: 18 });
    expect(alert()).toBeNull();
  });

  it("adds the image chosen in the tool's own file picker", async () => {
    const { only } = await opened();
    // The picker opens from the tool; the test gives its input a file, as choosing one does.
    const inputs = [...document.querySelectorAll<HTMLInputElement>('input[type="file"][hidden]')];
    const picker = inputs.at(-1);
    let clicked = 0;
    picker?.addEventListener("click", (event) => {
      clicked += 1;
      event.preventDefault();
    });
    await click(tool("add-image"));
    expect(clicked).toBe(1);
    const transfer = new DataTransfer();
    transfer.items.add(new File([await photo(10, 10, "#ffffff")], "private-name.png"));
    await act(async () => {
      if (!picker) throw new Error("no picker");
      picker.files = transfer.files;
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await until(() => names().length === 1, "the image layer");
    expect(only("image")).toMatchObject({ width: 10, height: 10 });
    // A file's name is never shown or kept.
    expect(only("image").name).toBe("");
    expect(document.body.textContent).not.toContain("private-name");
  });

  it("says on the stage why a file or a layer couldn't be added, and adds nothing", async () => {
    const { handle, layers, session } = await opened({ filePolicy: { maxLayers: 1 } });
    await act(async () => handle.current?.insertImage(new Blob([new Uint8Array([1, 2, 3, 4])])));
    expect(layers()).toEqual([]);
    expect(alert()?.getAttribute("role")).toBe("alert");
    expect(alert()?.textContent?.length).toBeGreaterThan(10);
    expect(session().getSnapshot().sources).toHaveLength(1);
    const first = alert()?.textContent;
    // The next layer that's added clears it.
    await click(tool("add-rectangle"));
    expect(layers()).toHaveLength(1);
    expect(alert()).toBeNull();
    // Over the limit: said, and nothing added.
    await click(tool("add-ellipse"));
    expect(layers()).toHaveLength(1);
    expect(alert()?.textContent).toMatch(/1/);
    expect(alert()?.textContent).not.toBe(first);
    await click(tool("add-text"));
    expect(layers()).toHaveLength(1);
    expect(alert()).not.toBeNull();
  });

  it("adds a layer that reads as it should on an image that's mirrored", async () => {
    const { handle, session, only, layers } = await opened();
    await act(async () =>
      session().execute({
        type: "image.setOrientation",
        orientation: { rotate: 0, flipX: true, flipY: false },
      }),
    );
    await click(tool("add-text"));
    // Mirrored back, so the image's mirror doesn't make it read backwards.
    expect(only("text")).toMatchObject({ flipX: true, rotation: 0, x: 15, y: 16 });
    // Turned as well: mirrored back and turned back.
    await act(async () =>
      session().execute({
        type: "image.setOrientation",
        orientation: { rotate: 90, flipX: true, flipY: false },
      }),
    );
    await click(tool("add-rectangle"));
    const shape = only("shape");
    expect(shape.flipX).toBe(true);
    expect([900, 2_700]).toContain(shape.rotation);
    // On the image as it is, nothing is mirrored.
    await act(async () =>
      session().execute({
        type: "image.setOrientation",
        orientation: { rotate: 0, flipX: false, flipY: false },
      }),
    );
    await click(tool("add-ellipse"));
    expect(layers().at(-1)).toMatchObject({ flipX: false, rotation: 0 });
    // An image from the handle is placed the same way.
    await act(async () =>
      session().execute({
        type: "image.setOrientation",
        orientation: { rotate: 0, flipX: false, flipY: true },
      }),
    );
    await act(async () => handle.current?.insertImage(await photo(6, 4, "#ffffff")));
    // Mirrored top to bottom is a mirror left to right and a half turn.
    expect(only("image")).toMatchObject({ flipX: true, rotation: 1_800, width: 6, height: 4 });
  });

  it("adds a layer the right way up on an image that's turned", async () => {
    const { session, only } = await opened();
    await act(async () =>
      session().execute({
        type: "image.setOrientation",
        orientation: { rotate: 90, flipX: false, flipY: false },
      }),
    );
    await click(tool("add-text"));
    await until(() => frames().length === 1, "its frame");
    for (let i = 0; i < 6; i += 1) await rendered();
    // The image is 40 × 60 as shown: the text is 20 × 12 on screen, wider than tall.
    expect(only("text")).toMatchObject({ width: 20, height: 12, rotation: 2_700 });
    const box = frames()[0]?.getBoundingClientRect();
    expect((box?.width ?? 0) / (box?.height ?? 1)).toBeCloseTo(20 / 12, 1);
    // In the middle of the canvas.
    const canvas = document.querySelector(".hm-image-stage-canvas")?.getBoundingClientRect();
    expect((box?.left ?? 0) + (box?.width ?? 0) / 2).toBeCloseTo(
      (canvas?.left ?? 0) + (canvas?.width ?? 0) / 2,
      0,
    );
  });
});
