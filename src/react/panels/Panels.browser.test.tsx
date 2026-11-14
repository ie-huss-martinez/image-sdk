import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadStyles } from "../../../test/browser/styles.js";
import type { ImagePlan } from "../../core/model/plan.js";
import { ImageEditor } from "../editor/ImageEditor.js";
import type { ImageEditorHandle } from "../editor/types.js";
import { KEYBOARD_COMMIT_DELAY } from "../gesture.js";

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

async function until(condition: () => boolean, what: string) {
  for (let i = 0; i < 200; i += 1) {
    if (condition()) return;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 25)));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function opened(width = 380, height = 900) {
  const changes: ImagePlan[] = [];
  const handle = createRef<ImageEditorHandle>();
  host = document.createElement("div");
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(<ImageEditor ref={handle} onChange={(plan) => changes.push(plan)} />),
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
  return { session, changes, start: changes.length };
}

const slider = (panel: string, index: number) => {
  const found = document.querySelectorAll<HTMLInputElement>(
    `section[aria-label="${panel}"] input[type="range"]`,
  )[index];
  if (!found) throw new Error(`no slider ${index} in ${panel}`);
  return found;
};

/** Moves a slider as a drag or a key does: the native setter, then an input event. */
const move = (input: HTMLInputElement, value: number) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      input,
      String(value),
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const fire = (target: Element, event: Event) => act(async () => void target.dispatchEvent(event));

describe("the Adjust panel (docs/adr/0007)", () => {
  it("shows each slider's name in a visible label that names it (WCAG 2.5.3)", async () => {
    await opened();
    const sliders = [
      ...document.querySelectorAll<HTMLInputElement>(
        'section[aria-label="Adjust"] input[type="range"]',
      ),
    ];
    expect(sliders).toHaveLength(8);
    for (const slider of sliders) {
      const label = slider.labels?.[0];
      expect(label?.textContent, slider.id).toBeTruthy();
      expect(label?.getBoundingClientRect().height, label?.textContent ?? "").toBeGreaterThan(0);
      expect(slider.getAttribute("aria-label")).toBeNull();
    }
    expect(sliders[2]?.labels?.[0]?.textContent).toBe("Exposure");
  });

  it("previews a slider drag without an edit, then commits one step on release", async () => {
    const { session, changes, start } = await opened();
    const exposure = slider("Adjust", 2);
    for (const value of [10, 20, 30]) await move(exposure, value);
    expect(exposure.value).toBe("30");
    expect(session().getSnapshot()).toMatchObject({
      canUndo: false,
      plan: { base: { develop: { exposure: 0 } } },
    });
    expect(changes).toHaveLength(start);
    await fire(exposure, new PointerEvent("pointerup", { bubbles: true }));
    expect(session().getSnapshot().plan?.base.develop.exposure).toBe(30);
    expect(changes).toHaveLength(start + 1);
    expect(session().undo()).toBe(true);
    expect(session().getSnapshot()).toMatchObject({
      canUndo: false,
      plan: { base: { develop: { exposure: 0 } } },
    });
  });

  it("commits a burst of keys once, a moment after the last", async () => {
    const { session, changes, start } = await opened();
    const contrast = slider("Adjust", 5);
    for (const value of [1, 2, 3, 4]) {
      await move(contrast, value);
      await fire(contrast, new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
    }
    expect(session().getSnapshot().plan?.base.develop.contrast).toBe(0);
    await act(
      async () => new Promise((resolve) => setTimeout(resolve, KEYBOARD_COMMIT_DELAY + 100)),
    );
    expect(session().getSnapshot().plan?.base.develop.contrast).toBe(4);
    expect(changes).toHaveLength(start + 1);
  });

  it("cancels with Escape, and commits when focus leaves", async () => {
    const { session, changes, start } = await opened();
    const tint = slider("Adjust", 1);
    await move(tint, -40);
    await fire(
      tint,
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    expect(tint.value).toBe("0");
    expect(changes).toHaveLength(start);
    await move(tint, 25);
    await fire(tint, new FocusEvent("focusout", { bubbles: true }));
    expect(session().getSnapshot().plan?.base.develop.tint).toBe(25);
    expect(changes).toHaveLength(start + 1);
  });

  it("resets one adjustment, or all of them in one step", async () => {
    const { session } = await opened();
    session().execute({ type: "image.setDevelop", values: { exposure: 20, saturation: -30 } });
    await act(async () => {});
    const resetExposure = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Reset Exposure",
    );
    await act(async () => resetExposure?.click());
    expect(session().getSnapshot().plan?.base.develop).toMatchObject({
      exposure: 0,
      saturation: -30,
    });
    const all = [...document.querySelectorAll("button")].find((b) => b.textContent === "Reset all");
    await act(async () => all?.click());
    expect(session().getSnapshot().plan?.base.develop.saturation).toBe(0);
    expect(document.activeElement).toBe(slider("Adjust", 0));
    // Two resets, after the one edit: three steps to undo.
    expect(session().undo() && session().undo() && session().undo()).toBe(true);
    expect(session().getSnapshot().canUndo).toBe(false);
  });
});

describe("the Filters panel (docs/adr/0007)", () => {
  it("chooses a preset as one step, and its strength as one gesture", async () => {
    const { session, changes, start } = await opened();
    const choose = (name: string) =>
      act(async () =>
        [...document.querySelectorAll<HTMLElement>("[role=radio]")]
          .find((option) => option.textContent === name)
          ?.click(),
      );
    await choose("Filters");
    await choose("Mono");
    expect(session().getSnapshot().plan?.base.filter).toEqual({ preset: "mono", strength: 100 });
    const strength = slider("Filters", 0);
    for (const value of [80, 60, 45]) await move(strength, value);
    await fire(strength, new PointerEvent("pointerup", { bubbles: true }));
    expect(session().getSnapshot().plan?.base.filter).toEqual({ preset: "mono", strength: 45 });
    expect(changes).toHaveLength(start + 2);
    await choose("None");
    expect(session().getSnapshot().plan?.base.filter).toBeNull();
  });
});

describe("the inspector's place (docs/adr/0007)", () => {
  for (const density of ["compact", "comfortable"]) {
    it(`keeps every panel to its column in ${density} density, scrolling only up and down`, async () => {
      document.documentElement.setAttribute("data-hm-density", density);
      try {
        await opened(900, 600);
        const inspector = document.querySelector<HTMLElement>(".hm-image-editor-inspector");
        if (!inspector) throw new Error("no inspector");
        const fits = (what: string) =>
          expect(inspector.scrollWidth, what).toBeLessThanOrEqual(inspector.clientWidth);
        fits("Adjust");
        const radio = (name: string) =>
          [...document.querySelectorAll<HTMLElement>('[role="radio"]')].find(
            (element) => element.textContent === name,
          );
        await act(async () => radio("Filters")?.click());
        fits("Filters");
        // Every preset shows, the first ones too, and so does the panel switch.
        for (const name of ["None", "Vivid", "Sepia", "Adjust"]) {
          const box = radio(name)?.getBoundingClientRect();
          const column = inspector.getBoundingClientRect();
          expect(box?.left, name).toBeGreaterThanOrEqual(column.left);
          expect(box?.right, name).toBeLessThanOrEqual(column.right);
        }
        await act(async () =>
          document.querySelector<HTMLButtonElement>('button[data-tool="image.crop"]')?.click(),
        );
        fits("Crop");
      } finally {
        document.documentElement.removeAttribute("data-hm-density");
      }
    });
  }

  const box = (selector: string) => {
    const found = document.querySelector(selector)?.getBoundingClientRect();
    if (!found) throw new Error(`no ${selector}`);
    return found;
  };

  it.each([
    [900, "beside"],
    [380, "under"],
  ] as const)(
    "at %ipx, puts the inspector %s the stage, overlapping nothing",
    async (width, place) => {
      // Short, so the inspector's sliders can't fit and must scroll.
      await opened(width, 480);
      const stage = box(".hm-image-editor-stage");
      const inspector = box(".hm-image-editor-inspector");
      const toolbar = box(".hm-image-editor-toolbar");
      if (place === "beside") {
        expect(inspector.left).toBeGreaterThanOrEqual(stage.right);
        expect(inspector.top).toBeGreaterThanOrEqual(toolbar.bottom);
      } else {
        expect(inspector.top).toBeGreaterThanOrEqual(stage.bottom);
      }
      expect(stage.top).toBeGreaterThanOrEqual(toolbar.bottom);
      // The editor stays in its host's box: the inspector scrolls rather
      // than stretch the stage past it.
      const bounds = host?.getBoundingClientRect();
      if (!bounds) throw new Error("no host");
      expect(box(".hm-image-editor").bottom).toBeLessThanOrEqual(bounds.bottom + 1);
      expect(stage.bottom).toBeLessThanOrEqual(bounds.bottom + 1);
      expect(inspector.bottom).toBeLessThanOrEqual(bounds.bottom + 1);
      expect(stage.height).toBeGreaterThan(100);
      // What a pointer at the panel switch's centre hits is the switch, where
      // the editor fits the test page's viewport; the end-to-end tests click it
      // in a wide one.
      if (width > innerWidth) return;
      const option = [...document.querySelectorAll<HTMLElement>("[role=radio]")].find(
        (radio) => radio.textContent === "Filters",
      );
      const rect = option?.getBoundingClientRect();
      if (!rect) throw new Error("no switch");
      expect(
        option?.contains(
          document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2),
        ),
      ).toBe(true);
    },
  );
});
