import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadStyles } from "../../../test/browser/styles.js";
import { FIRST_OPEN_TIMEOUT } from "../../../test/browser/timeouts.js";
import { writeGif } from "../../../test/fixtures/gif-writer.js";
import { concat, pngChunk } from "../../../test/fixtures/image-writers.js";
import { ImageEditor } from "../editor/ImageEditor.js";
import type { ImageEditorHandle, ImageEditorProps } from "../editor/types.js";

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

/**
 * A 30 × 20 PNG the browser encodes, named as a person's file would be,
 * which nothing may show. With `profile`, it carries a cICP chunk, BT.709
 * primaries and sRGB's transfer, which the probe reports as a colour profile.
 */
async function photo(profile = false): Promise<File> {
  const canvas = new OffscreenCanvas(30, 20);
  canvas.getContext("2d")?.fillRect(0, 0, 30, 20);
  const bytes = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer());
  // After the 8-byte signature and the 25-byte IHDR chunk.
  const withProfile = profile
    ? concat([bytes.subarray(0, 33), pngChunk("cICP", [1, 13, 0, 1]), bytes.subarray(33)])
    : bytes;
  return new File([withProfile.slice()], "private-holiday.png", { type: "image/png" });
}

async function mounted(props: Partial<ImageEditorProps> = {}) {
  const handle = createRef<ImageEditorHandle>();
  host = document.createElement("div");
  host.style.width = "900px";
  host.style.height = "600px";
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<ImageEditor ref={handle} {...props} />));
  const open = async (file: File) => {
    const before = handle.current?.session.getSnapshot().source?.id;
    await act(async () => handle.current?.open(file));
    await until(
      () => {
        const snapshot = handle.current?.session.getSnapshot();
        return snapshot?.status === "ready" && snapshot.source?.id !== before;
      },
      "the open",
      FIRST_OPEN_TIMEOUT,
    );
  };
  /** Starts an open without waiting for it. */
  const start = (file: File) =>
    act(async () => {
      void handle.current?.open(file);
    });
  return { open, start, session: () => handle.current?.session };
}

const region = () => document.querySelector<HTMLElement>('[role="status"][aria-label="Notices"]');
const notices = () => [...(region()?.querySelectorAll("li") ?? [])];
const PROFILE = "Colours outside sRGB will be clipped in the exported file.";

describe("the stage's notices (docs/adr/0007, Warnings)", () => {
  it("says a colour profile's colours are clipped, and dismisses it for this image only", async () => {
    const { open } = await mounted();
    await open(await photo(true));
    expect(region()).not.toBeNull();
    expect(notices()).toHaveLength(1);
    expect(notices()[0]?.textContent).toContain(PROFILE);
    // It's painted over the image, not under the stage's canvas.
    const box = notices()[0]?.getBoundingClientRect();
    const top =
      box && document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    expect(notices()[0]?.contains(top ?? null)).toBe(true);

    // Its dismiss button is named, and described by the notice it dismisses.
    const dismiss = notices()[0]?.querySelector("button");
    expect(dismiss?.getAttribute("aria-label")).toBe("Dismiss");
    const described = document.getElementById(dismiss?.getAttribute("aria-describedby") ?? "");
    expect(described?.textContent).toContain(PROFILE);
    await act(async () => dismiss?.click());
    expect(notices()).toHaveLength(0);
    // The region stays, so the next notice is announced.
    expect(region()).not.toBeNull();

    // The same notice, for another image that has it, shows again.
    await open(await photo(true));
    expect(notices()).toHaveLength(1);
  });

  it("shows the limits an image comes near, with the file's own numbers", async () => {
    const file = await photo();
    const { open } = await mounted({
      filePolicy: {
        maxFileSize: { maximum: 50_000_000, warning: 1 },
        maxImagePixels: { maximum: 100_000_000, warning: 1 },
      },
    });
    await open(file);
    const texts = notices().map((notice) => notice.textContent ?? "");
    expect(texts).toHaveLength(2);
    expect(texts.some((text) => text.includes(`This file is ${file.size} bytes`))).toBe(true);
    expect(texts.some((text) => text.includes("This image is large"))).toBe(true);
  });

  it("shows nothing for an image that comes near no limit and has no profile", async () => {
    const { open } = await mounted();
    await open(await photo());
    expect(region()).not.toBeNull();
    expect(notices()).toHaveLength(0);
  });
});

describe("an animation's notices (docs/adr/0011)", () => {
  const FOUR = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 255],
  ] as const;
  /** A GIF of `frames` frames, 12 × 9, named as a person's file would be. */
  const animation = (frames: number, change: (bytes: Uint8Array) => Uint8Array = (b) => b) =>
    new File(
      [
        change(
          writeGif({
            width: 12,
            height: 9,
            palette: FOUR,
            loop: 0,
            frames: Array.from({ length: frames }, (_, n) => ({
              pixels: Array.from({ length: 108 }, (_, i) => (i + n) % 4),
              delay: 10,
            })),
          }),
        ).slice(),
      ],
      "private-party.gif",
      { type: "image/gif" },
    );
  const texts = () => notices().map((notice) => notice.textContent ?? "");
  const session = (handle: Awaited<ReturnType<typeof mounted>>) => handle.session();

  it("opens an animation over maxAnimationPixels as its first frame, and says so", async () => {
    // 12 × 9 is 108 pixels: over a limit of 100.
    const editor = await mounted({
      filePolicy: { maxAnimationPixels: { maximum: 100, warning: 50 } },
    });
    await editor.open(animation(4));
    const snapshot = session(editor)?.getSnapshot();
    // Open, as a still: nothing that opened before stops opening.
    expect(snapshot?.status).toBe("ready");
    expect(snapshot?.error).toBeNull();
    expect(snapshot?.plan?.animation).toBeNull();
    expect(snapshot?.source).toMatchObject({ frames: 1, fileFrames: 4, incomplete: false });
    expect(
      document.querySelector('[role="img"][aria-label^="Edited image preview, 12 × 9"]'),
    ).not.toBeNull();
    expect(texts()).toEqual([
      expect.stringContaining(
        "This animation is too large to edit as an animation. Its first frame is open as a still image.",
      ),
    ]);
    // And it exports as any still does.
    const exported = await session(editor)?.export({ type: "png" });
    expect(exported?.blob.size).toBeGreaterThan(0);
  });

  it("opens an animation over maxFrames or maxDecodedSize as its first frame, and says so once", async () => {
    // Four frames of 12 × 9: over three frames, and over 1,000 bytes across them.
    for (const filePolicy of [
      { maxFrames: 3 },
      { maxDecodedSize: 1_000 },
      { maxFrames: 3, maxDecodedSize: 1_000, maxAnimationPixels: 100 },
    ]) {
      const editor = await mounted({ filePolicy });
      await editor.open(animation(4));
      const snapshot = session(editor)?.getSnapshot();
      expect(snapshot).toMatchObject({ status: "ready", error: null });
      expect(snapshot?.plan?.animation).toBeNull();
      expect(snapshot?.source).toMatchObject({ frames: 1, fileFrames: 4 });
      // One notice, whichever limits it's over, and no error.
      expect(texts()).toEqual([
        expect.stringContaining(
          "This animation is too large to edit as an animation. Its first frame is open as a still image.",
        ),
      ]);
      expect((await session(editor)?.export({ type: "png" }))?.blob.size).toBeGreaterThan(0);
      await act(async () => root?.unmount());
      host?.remove();
    }
  });

  it("opens an animation within the limit as one, with a warning when it's near it", async () => {
    const editor = await mounted({
      filePolicy: { maxAnimationPixels: { maximum: 200, warning: 50 } },
    });
    await editor.open(animation(4));
    const snapshot = session(editor)?.getSnapshot();
    expect(snapshot?.plan?.animation?.frames).toHaveLength(4);
    expect(snapshot?.source).toMatchObject({ frames: 4, fileFrames: 4 });
    expect(texts()).toEqual([expect.stringContaining("This animation is large")]);
  });

  it("shows how many frames are checked while a long animation opens, and cancels from there", async () => {
    // Enough work that the check is still running when it's looked at: one
    // frame of 800 × 600, written once and repeated 80 times in the file.
    const one = writeGif({
      width: 800,
      height: 600,
      palette: FOUR,
      frames: [
        { pixels: Array.from({ length: 480_000 }, (_, i) => (i * 7 + (i >> 5)) % 4), delay: 2 },
      ],
    });
    // The header and a table of four colours, then the frame's blocks, then the trailer.
    const head = one.slice(0, 13 + 12);
    const frame = one.slice(13 + 12, -1);
    const bytes = new Uint8Array(head.length + frame.length * 80 + 1);
    bytes.set(head);
    for (let n = 0; n < 80; n += 1) bytes.set(frame, head.length + n * frame.length);
    bytes[bytes.length - 1] = 0x3b;
    const long = new File([bytes], "private-party.gif", { type: "image/gif" });
    const editor = await mounted();
    // The open may be over before a test's next turn, so what the stage
    // showed is recorded as it changes, and Cancel is pressed from there.
    const seen = {
      label: "",
      max: "",
      values: [] as string[],
      text: "",
      cancelled: false,
      firstFrame: "",
      overImage: false,
    };
    const observer = new MutationObserver(() => {
      const opening = document.querySelector(".hm-image-stage-opening");
      const bar = opening?.querySelector("progress");
      if (!opening || !bar) return;
      seen.label = bar.getAttribute("aria-label") ?? "";
      seen.max = bar.getAttribute("max") ?? "";
      const value = bar.getAttribute("aria-valuetext") ?? "";
      if (seen.values.at(-1) !== value) seen.values.push(value);
      seen.text = opening.textContent ?? "";
      const canvas = document.querySelector<HTMLCanvasElement>(".hm-image-stage-canvas");
      if (canvas && !canvas.hidden) seen.firstFrame = canvas.getAttribute("aria-label") ?? "";
      if (opening.classList.contains("hm-image-stage-opening--over-image")) seen.overImage = true;
      // Once it has moved and the first frame shows, cancel from the button beside it.
      if (seen.values.length >= 3 && seen.firstFrame !== "" && !seen.cancelled) {
        seen.cancelled = true;
        [...opening.querySelectorAll("button")]
          .find((button) => button.textContent === "Cancel")
          ?.click();
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    try {
      await editor.start(long);
      await until(
        () => seen.cancelled && session(editor)?.getSnapshot().opening === false,
        "the cancel",
        FIRST_OPEN_TIMEOUT,
      );
    } finally {
      observer.disconnect();
    }
    // Named, with its count in words, not a percentage; and it moved.
    expect(seen.label).toBe("Opening the image…");
    expect(seen.max).toBe("80");
    expect(seen.values.length).toBeGreaterThanOrEqual(3);
    for (const value of seen.values) expect(value).toMatch(/^Checking frames: \d+ of 80$/);
    expect(seen.text).toMatch(/Checking frames: \d+ of 80/);
    // The first frame showed on the stage while the rest were checked,
    // named for what it is, with the progress at the stage's foot.
    expect(seen.firstFrame).toBe("First frame of the image being opened, 800 × 600");
    expect(seen.overImage).toBe(true);
    // Cancelled from there: nothing is open, and nothing is shown as failed.
    const snapshot = session(editor)?.getSnapshot();
    expect(snapshot).toMatchObject({ status: "empty", error: null, progress: null });
    expect(document.querySelector(".hm-image-stage-opening")).toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent ?? "").toBe("");
  });

  it("opens an animation as its first frame when the host asks for no animations, and says so", async () => {
    const editor = await mounted({ animations: false });
    await editor.open(animation(4));
    const snapshot = session(editor)?.getSnapshot();
    expect(snapshot?.plan?.animation).toBeNull();
    expect(snapshot?.source).toMatchObject({ frames: 1, fileFrames: 4 });
    expect(snapshot?.warnings).toEqual([]);
    // What it is, without a reason that isn't the reason: it isn't too large.
    expect(texts()).toEqual([
      expect.stringContaining(
        "This file is an animation. Its first frame is open as a still image.",
      ),
    ]);
  });

  it("says nothing of an animation well within the limit", async () => {
    const editor = await mounted();
    await editor.open(animation(4));
    expect(session(editor)?.getSnapshot().plan?.animation?.frames).toHaveLength(4);
    expect(texts()).toEqual([]);
  });

  it("says a damaged animation's frames ended early, and how many opened", async () => {
    const editor = await mounted();
    // Cut inside its last frame: three whole frames of four.
    await editor.open(animation(4, (bytes) => bytes.slice(0, -6)));
    expect(session(editor)?.getSnapshot().source).toMatchObject({
      frames: 3,
      fileFrames: 3,
      incomplete: true,
    });
    expect(texts()).toEqual([
      expect.stringContaining(
        "This animation's file is damaged at its end. All 3 of its frames were opened.",
      ),
    ]);
    // No file name, in any notice.
    expect(region()?.textContent).not.toContain("private");
  });
});

describe("the Info panel (docs/adr/0007)", () => {
  it("shows what the session knows of the image, and never its file's name", async () => {
    const file = await photo(true);
    const { open } = await mounted();
    await open(file);
    const radio = [...document.querySelectorAll<HTMLElement>('[role="radio"]')].find(
      (element) => element.textContent === "Info",
    );
    await act(async () => radio?.click());
    const panel = document.querySelector('section[aria-label="Image info"]');
    const terms = [...(panel?.querySelectorAll("dt") ?? [])].map((term) => term.textContent);
    const values = [...(panel?.querySelectorAll("dd") ?? [])].map((value) => value.textContent);
    expect(terms).toEqual([
      "Size",
      "Format",
      "File size",
      "Metadata in the file",
      "Kept on export",
    ]);
    expect(values[0]).toBe("30 × 20 pixels");
    expect(values[1]).toBe("PNG");
    expect(values[2]).toMatch(/^\d+ bytes$/);
    expect(values[3]).toContain("Colour profile");
    expect(values[4]).toBe("Nothing");
    expect(document.body.textContent).not.toContain("private-holiday");
  });
});
