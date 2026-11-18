import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadStyles } from "../../../test/browser/styles.js";
import { FIRST_OPEN_TIMEOUT } from "../../../test/browser/timeouts.js";
import { writeGif } from "../../../test/fixtures/gif-writer.js";
import { ImageEditor } from "../editor/ImageEditor.js";
import type { ImageEditorHandle, ImageEditorProps } from "../editor/types.js";
import { MAX_FRAME_THUMBNAILS } from "./FrameThumbnail.js";

/**
 * The frames panel (docs/adr/0011): an animation's frames in the order they
 * play, named by place and delay; the frame selected is the frame shown;
 * each edit, from a key or a button, is one undo step and is announced;
 * thumbnails are drawn only for the rows in view, within a cap, and
 * released when they leave it.
 */

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
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  }
  if (condition()) return;
  throw new Error(`timed out waiting for ${what}`);
}

const COLOURS = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 255],
] as const;
/** `count` frames of one colour each, the first's delay 3 hundredths and the rest 10. */
const animation = (count: number) =>
  writeGif({
    width: 8,
    height: 6,
    palette: COLOURS,
    loop: 0,
    frames: Array.from({ length: count }, (_, index) => ({
      pixels: Array.from({ length: 48 }, () => index % 4),
      delay: index === 0 ? 3 : 10,
    })),
  });

async function opened(bytes: Uint8Array, props: Partial<ImageEditorProps> = {}) {
  const handle = createRef<ImageEditorHandle>();
  host = document.createElement("div");
  host.style.width = "900px";
  host.style.height = "600px";
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<ImageEditor ref={handle} {...props} />));
  await act(async () => handle.current?.open(new Blob([bytes.slice()], { type: "image/gif" })));
  await until(
    () => handle.current?.session.getSnapshot().status === "ready",
    "the open",
    FIRST_OPEN_TIMEOUT,
  );
  const session = () => {
    const current = handle.current?.session;
    if (!current) throw new Error("no session");
    return current;
  };
  return { handle, session };
}

async function key(target: Element | null | undefined, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  await act(async () => {
    target?.dispatchEvent(event);
  });
  return event.defaultPrevented;
}
const click = (element: Element | null | undefined) =>
  act(async () => (element as HTMLElement | null | undefined)?.click());

const tool = () => document.querySelector<HTMLButtonElement>('[data-tool="image.frames"]');
const panel = () => document.querySelector<HTMLElement>('section[aria-label="Frames"]');
const list = () => document.querySelector<HTMLElement>(".hm-image-frames-list");
const items = () => [
  ...document.querySelectorAll<HTMLElement>(".hm-image-frames-list .hm-image-frame-row"),
];
const names = () => items().map((item) => item.querySelector(".hm-image-frame-name")?.textContent);
const item = (index: number) => items()[index];
const selectedName = () =>
  document
    .querySelector('.hm-image-frames-list [aria-selected="true"]')
    ?.querySelector(".hm-image-frame-name")?.textContent;
const named = (label: string) =>
  panel()?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
const button = (text: string) =>
  [...(panel()?.querySelectorAll("button") ?? [])].find((found) => found.textContent === text);
const field = (label: string) => {
  const found = [...(panel()?.querySelectorAll("label") ?? [])].find(
    (item) => item.textContent === label,
  );
  return document.getElementById(found?.htmlFor ?? "") as HTMLInputElement | null;
};
const announced = () =>
  [...document.querySelectorAll("[aria-live]")].map((region) => region.textContent).join(" ");
const said = (text: string) => until(() => announced().includes(text), `"${text}" to be announced`);
const canvases = () => [...document.querySelectorAll(".hm-image-frame-thumbnail-canvas")];
const shownOnBar = () =>
  document.querySelector('section[aria-label="Animation"] output')?.textContent ?? "";

const type = (input: HTMLInputElement | null | undefined, value: string) =>
  act(async () => {
    if (!input) throw new Error("no field");
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    input.blur();
  });

async function showFrames() {
  await act(async () => tool()?.focus());
  await click(tool());
  await until(() => panel() !== null, "the frames panel");
}

describe("the frames panel (docs/adr/0011)", () => {
  it("is on the toolbar only for an animation, and leaves no empty group for a still", async () => {
    await opened(animation(1));
    expect(tool()).toBeNull();
    const groups = [...document.querySelectorAll('[role="toolbar"] [role="group"]')];
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.filter((group) => group.querySelector("button") === null)).toEqual([]);
    await act(async () => root?.unmount());
    host?.remove();
    await opened(animation(4));
    expect(tool()).not.toBeNull();
  });

  it("lists the frames by place and delay, and shows the one selected, paused", async () => {
    const { session } = await opened(animation(4));
    await showFrames();
    expect(names()).toEqual([
      "Frame 1, 0.03 seconds",
      "Frame 2, 0.10 seconds",
      "Frame 3, 0.10 seconds",
      "Frame 4, 0.10 seconds",
    ]);
    // Focus goes to the list, on the frame shown.
    await until(() => list()?.contains(document.activeElement) === true, "focus in the list");
    expect(selectedName()).toBe("Frame 1, 0.03 seconds");
    await click(item(2));
    expect(selectedName()).toBe("Frame 3, 0.10 seconds");
    expect(shownOnBar()).toContain("Frame 3 of 4");
    // Selecting changes nothing in the plan.
    expect(session().getSnapshot().canUndo).toBe(false);
    // Done closes it.
    await click(button("Done"));
    expect(panel()).toBeNull();
  });

  it("moves a frame with Alt and the arrows, says so, and undoes it in one step", async () => {
    const { session } = await opened(animation(4));
    await showFrames();
    const order = () =>
      session()
        .getSnapshot()
        .plan?.animation?.frames.map((frame) => frame.frame);
    const focused = () => item(0)?.querySelector<HTMLElement>("[data-hm-tab-stop]") ?? item(0);
    expect(await key(focused(), { key: "ArrowDown", altKey: true })).toBe(true);
    expect(order()).toEqual([1, 0, 2, 3]);
    await said("Moved frame 1 later. It's frame 2 of 4.");
    expect(selectedName()).toBe("Frame 2, 0.03 seconds");
    await click(named("Move earlier"));
    expect(order()).toEqual([0, 1, 2, 3]);
    await said("Moved frame 2 earlier. It's frame 1 of 4.");
    expect(session().undo()).toBe(true);
    expect(order()).toEqual([1, 0, 2, 3]);
  });

  it("copies, deletes and reverses frames, each one step, and says what it did", async () => {
    const { session } = await opened(animation(4));
    await showFrames();
    const order = () =>
      session()
        .getSnapshot()
        .plan?.animation?.frames.map((frame) => frame.frame);
    await click(item(1));
    await click(named("Duplicate"));
    expect(order()).toEqual([0, 1, 1, 2, 3]);
    expect(selectedName()).toBe("Frame 3, 0.10 seconds");
    await said("Duplicated frame 2. The copy is frame 3.");
    await click(named("Delete"));
    expect(order()).toEqual([0, 1, 2, 3]);
    await said("Deleted frame 3. 4 frames are left.");
    // Delete from the list's own key.
    expect(await key(item(3), { key: "Delete" })).toBe(true);
    expect(order()).toEqual([0, 1, 2]);
    await click(item(0));
    await click(button("Reverse order"));
    expect(order()).toEqual([2, 1, 0]);
    // The frame that was shown is still shown, now last.
    expect(selectedName()).toBe("Frame 3, 0.03 seconds");
    await said("Reversed the order of the frames.");
    expect(session().undo()).toBe(true);
    expect(order()).toEqual([0, 1, 2]);
    expect(session().undo()).toBe(true);
    expect(order()).toEqual([0, 1, 2, 3]);
  });

  it("keeps the last frame: it can't be deleted", async () => {
    const { session } = await opened(animation(2));
    await showFrames();
    await click(named("Delete"));
    expect(session().getSnapshot().plan?.animation?.frames).toHaveLength(1);
    expect(
      named("Delete")?.getAttribute("aria-disabled") ?? named("Delete")?.disabled,
    ).toBeTruthy();
    await click(named("Delete"));
    expect(session().getSnapshot().plan?.animation?.frames).toHaveLength(1);
  });

  it("sets a frame's delay, every frame's, and how many times it plays", async () => {
    const { session } = await opened(animation(3));
    await showFrames();
    const animated = () => session().getSnapshot().plan?.animation;
    await type(field("Delay, in seconds"), "0.5");
    expect(animated()?.frames.map((frame) => frame.delay)).toEqual([50, 10, 10]);
    expect(names()[0]).toBe("Frame 1, 0.50 seconds");
    await click(button("Use for every frame"));
    expect(animated()?.frames.map((frame) => frame.delay)).toEqual([50, 50, 50]);
    await said("Every frame now shows for 0.50 seconds.");
    expect(session().undo()).toBe(true);
    expect(animated()?.frames.map((frame) => frame.delay)).toEqual([50, 10, 10]);

    expect(animated()?.loop).toBe(0);
    const option = (text: string) =>
      [...(panel()?.querySelectorAll<HTMLElement>("[role=radio]") ?? [])].find(
        (found) => found.textContent === text,
      );
    await click(option("Once"));
    expect(animated()?.loop).toBeNull();
    expect(field("Times it repeats after the first")?.disabled).toBe(true);
    await click(option("Repeats"));
    expect(animated()?.loop).toBe(1);
    await type(field("Times it repeats after the first"), "3");
    expect(animated()?.loop).toBe(3);
    await click(option("For ever"));
    expect(animated()?.loop).toBe(0);
    // The count chosen before comes back with Repeats.
    await click(option("Repeats"));
    expect(animated()?.loop).toBe(3);
  });

  it("says why a copy over maxFrames isn't made", async () => {
    const { session } = await opened(animation(4), { filePolicy: { maxFrames: 4 } });
    await showFrames();
    await click(named("Duplicate"));
    expect(session().getSnapshot().plan?.animation?.frames).toHaveLength(4);
    await until(() => panel()?.querySelector("[role=alert]") !== null, "the refusal");
    expect(panel()?.querySelector("[role=alert]")?.textContent).not.toBe("");
  });

  it("draws thumbnails only for the rows in view, within the cap, and lets them go", async () => {
    await opened(animation(200));
    await showFrames();
    const scroller = list();
    if (!scroller) throw new Error("no list");
    const inView = () => {
      const box = scroller.getBoundingClientRect();
      return items().filter((row) => {
        const own = row.getBoundingClientRect();
        return own.bottom > box.top && own.top < box.bottom;
      }).length;
    };
    await until(() => canvases().length > 0, "the first thumbnails");
    await until(
      () => canvases().length === Math.min(inView(), MAX_FRAME_THUMBNAILS),
      "a thumbnail per row in view",
    );
    expect(canvases().length).toBeLessThan(200);
    const first = items()[0]?.querySelector(".hm-image-frame-thumbnail-canvas");
    expect(first).not.toBeNull();
    // Scrolled to the end, the first rows let theirs go and the last draw theirs.
    await act(async () => {
      scroller.scrollTop = scroller.scrollHeight;
    });
    await until(
      () => items().at(-1)?.querySelector(".hm-image-frame-thumbnail-canvas") != null,
      "the last row's thumbnail",
    );
    await until(
      () => items()[0]?.querySelector(".hm-image-frame-thumbnail-canvas") == null,
      "the first row's thumbnail to go",
    );
    expect(canvases().length).toBeLessThanOrEqual(MAX_FRAME_THUMBNAILS);
    // Closing the panel lets every one go.
    await click(button("Done"));
    expect(canvases()).toHaveLength(0);
  });
});
