import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadStyles } from "../../../test/browser/styles.js";
import { FIRST_OPEN_TIMEOUT } from "../../../test/browser/timeouts.js";
import { writeGif } from "../../../test/fixtures/gif-writer.js";
import type { ImageSessionExport } from "../../core/session/session.js";
import { ImageEditor } from "../editor/ImageEditor.js";
import type { ImageEditorHandle, ImageEditorProps } from "../editor/types.js";

/**
 * Playing an animation in the editor (docs/adr/0011): nothing plays on its
 * own; Play, with a visible pressed state, and Space on the bar play and
 * pause; the scrubber moves frame by frame; the loop count is kept; and the
 * frame shown is the frame a PNG exports.
 */

let unloadStyles: () => void = () => {};
beforeAll(async () => {
  unloadStyles = await loadStyles();
});
afterAll(() => unloadStyles());

let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(async () => {
  vi.useRealTimers();
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
const pause = (ms: number) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));

/** Four frames of one colour each: red, green, blue, white. */
const COLOURS = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 255],
] as const;
const animation = (loop: number | null, delay = 3) =>
  writeGif({
    width: 8,
    height: 6,
    palette: COLOURS,
    ...(loop === null ? {} : { loop }),
    frames: [0, 1, 2, 3].map((index) => ({
      pixels: Array.from({ length: 48 }, () => index),
      delay,
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
  return handle;
}

const bar = () => document.querySelector<HTMLElement>('section[aria-label="Animation"]');
const play = () => {
  const found = bar()?.querySelector<HTMLButtonElement>('button[aria-label="Play"]');
  if (!found) throw new Error("no Play");
  return found;
};
const scrubber = () => {
  const found = bar()?.querySelector<HTMLInputElement>('input[type="range"]');
  if (!found) throw new Error("no scrubber");
  return found;
};
const where = () => bar()?.querySelector("output")?.textContent ?? "";
const frameShown = () => Number(/Frame (\d+) of/.exec(where())?.[1] ?? 0);
const key = (target: HTMLElement, name: string) =>
  act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
    );
  });

describe("playing an animation in the editor (docs/adr/0011)", () => {
  it("shows the bar for an animation only, paused on its first frame: nothing plays on its own", async () => {
    await opened(animation(0));
    expect(bar()).not.toBeNull();
    expect(play().getAttribute("aria-pressed")).toBe("false");
    expect(where()).toBe("Frame 1 of 4, 0.03 s");
    expect(scrubber().getAttribute("aria-valuetext")).toBe("Frame 1 of 4");
    await pause(400);
    expect(frameShown()).toBe(1);
    // A still has no bar.
    await act(async () => root?.unmount());
    host?.remove();
    const still = writeGif({
      width: 8,
      height: 6,
      palette: COLOURS,
      frames: [{ pixels: Array.from({ length: 48 }, () => 0) }],
    });
    await opened(still);
    expect(bar()).toBeNull();
  });

  it("plays and pauses with Play, which shows that it's pressed", async () => {
    await opened(animation(0));
    await act(async () => play().click());
    expect(play().getAttribute("aria-pressed")).toBe("true");
    // Pressed looks pressed: not the same as when it isn't.
    const pressedLook = getComputedStyle(play()).backgroundColor;
    await until(() => frameShown() === 3, "frame 3");
    // For ever: round again.
    await until(() => frameShown() === 1, "frame 1 again");
    await act(async () => play().click());
    expect(play().getAttribute("aria-pressed")).toBe("false");
    expect(getComputedStyle(play()).backgroundColor).not.toBe(pressedLook);
    const stopped = frameShown();
    await pause(300);
    expect(frameShown()).toBe(stopped);
  });

  it("plays once, and stops on the last frame, when the file says so; Play then starts again", async () => {
    await opened(animation(null));
    await act(async () => play().click());
    await until(() => play().getAttribute("aria-pressed") === "false", "the end");
    expect(frameShown()).toBe(4);
    await act(async () => play().click());
    await until(() => frameShown() <= 2, "the start again");
  });

  it("repeats as many times as the loop count says", async () => {
    // One repeat: the four frames twice, then stopped on the last.
    await opened(animation(1));
    const seen: number[] = [];
    await act(async () => play().click());
    await until(() => {
      const now = frameShown();
      if (seen.at(-1) !== now) seen.push(now);
      return play().getAttribute("aria-pressed") === "false";
    }, "the end");
    expect(seen.filter((frame) => frame === 1).length).toBe(2);
    expect(frameShown()).toBe(4);
  });

  it("plays and pauses with Space from anywhere in the editor but a control, as Play says", async () => {
    await opened(animation(0));
    expect(play().getAttribute("aria-keyshortcuts")).toBe("Space");
    // On the stage, which isn't a control: the family's play-pause (sdk-core ADR 0030).
    const stage = document.querySelector<HTMLElement>(".hm-image-stage");
    if (!stage) throw new Error("no stage");
    await key(stage, " ");
    expect(play().getAttribute("aria-pressed")).toBe("true");
    await key(stage, " ");
    expect(play().getAttribute("aria-pressed")).toBe("false");
    // On the scrubber, a slider, Space is the control's own: it doesn't play.
    scrubber().focus();
    await key(scrubber(), " ");
    expect(play().getAttribute("aria-pressed")).toBe("false");
    // Held down, it doesn't toggle again and again.
    await act(async () => {
      stage.dispatchEvent(
        new KeyboardEvent("keydown", { key: " ", repeat: true, bubbles: true, cancelable: true }),
      );
    });
    expect(play().getAttribute("aria-pressed")).toBe("false");
  });

  it("leaves Space alone on a still", async () => {
    const still = writeGif({
      width: 8,
      height: 6,
      palette: COLOURS,
      frames: [{ pixels: Array.from({ length: 48 }, () => 0) }],
    });
    await opened(still);
    const stage = document.querySelector<HTMLElement>(".hm-image-stage");
    const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    await act(async () => {
      stage?.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
  });

  it("moves frame by frame with the scrubber, which pauses playing", async () => {
    await opened(animation(0));
    // A paused clock: playing can't move on between the keys, however slow the machine.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await act(async () => play().click());
    scrubber().focus();
    await key(scrubber(), "Home");
    await key(scrubber(), "ArrowRight");
    await key(scrubber(), "ArrowRight");
    expect(play().getAttribute("aria-pressed")).toBe("false");
    expect(frameShown()).toBe(3);
    expect(scrubber().getAttribute("aria-valuetext")).toBe("Frame 3 of 4");
    await key(scrubber(), "End");
    expect(frameShown()).toBe(4);
  });

  it("pauses when the scrubber is taken, even by a key or a press that doesn't move it", async () => {
    await opened(animation(0));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // Home on the first frame changes no value, so the slider reports nothing.
    await act(async () => play().click());
    expect(play().getAttribute("aria-pressed")).toBe("true");
    scrubber().focus();
    await key(scrubber(), "Home");
    expect(play().getAttribute("aria-pressed")).toBe("false");
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(frameShown()).toBe(1);
    // A press on the scrubber where it is, the same.
    await act(async () => play().click());
    expect(play().getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      scrubber().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(play().getAttribute("aria-pressed")).toBe("false");
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(frameShown()).toBe(1);
    // With Alt or Meta, a key is the browser's, and playing goes on.
    await act(async () => play().click());
    await act(async () => {
      scrubber().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Home",
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(play().getAttribute("aria-pressed")).toBe("true");
  });

  it("exports the frame shown to PNG, and stops playing when the export dialog opens", async () => {
    const exports: { blob: Blob; details: ImageSessionExport }[] = [];
    await opened(animation(0), { onExport: (blob, details) => exports.push({ blob, details }) });
    scrubber().focus();
    await key(scrubber(), "ArrowRight");
    await key(scrubber(), "ArrowRight");
    expect(frameShown()).toBe(3);
    await act(async () => play().click());
    const exportButton = document.querySelector<HTMLButtonElement>(
      'button[data-tool="image.export"]',
    );
    await act(async () => exportButton?.click());
    await until(() => document.querySelector("dialog[open]") !== null, "the dialog");
    expect(play().getAttribute("aria-pressed")).toBe("false");
    const shown = frameShown();
    const dialog = document.querySelector("dialog[open]");
    const png = [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (b) => b.textContent === "PNG",
    );
    await act(async () => png?.click());
    const confirm = [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (b) => b.textContent === "Export",
    );
    await act(async () => confirm?.click());
    await until(() => exports.length === 1, "the export");
    const bitmap = await createImageBitmap((exports[0] as { blob: Blob }).blob);
    const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d");
    context?.drawImage(bitmap, 0, 0);
    const pixel = [...(context?.getImageData(4, 3, 1, 1).data ?? [])];
    expect(pixel).toEqual([...(COLOURS[shown - 1] as readonly number[]), 255]);
  });
});
