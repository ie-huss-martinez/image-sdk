import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadStyles } from "../../../test/browser/styles.js";
import { FIRST_OPEN_TIMEOUT } from "../../../test/browser/timeouts.js";
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
  return { open };
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
