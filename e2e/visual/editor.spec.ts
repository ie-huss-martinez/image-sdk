import { applyVisualVariant, visualVariants } from "@hussmartinez/sdk-config/testing/visual";
import { expect, type Page, test } from "@playwright/test";
import { fixture, jpegWithPrivateMetadata } from "../fixtures.js";

/**
 * The editor's designed states, as screenshots (sdk-core ADR 0048). Each is
 * captured in light and dark, compact and comfortable, on the built example
 * as a host renders it.
 *
 * | State | What it shows |
 * |---|---|
 * | `empty` | The drop zone, before an image is open |
 * | `open` | An image on the stage, with the Adjust panel |
 * | `crop` | The crop frame and its handles, with the crop panel |
 * | `filters` | The Filters panel, with Sepia chosen |
 * | `export-summary` | The export dialog's choices and its summary of the metadata it removes |
 * | `export-done` | The export dialog's result, with Download focused |
 * | `error` | A file that isn't an image, and the catalogue's text for it |
 * | `element-empty`, `element-open` | `<hm-image-editor>`, whose styles arrive through the host's imports |
 *
 * No state is masked: every one renders committed fixtures, at a fixed time,
 * and the editor shows no time or random value. The stage's canvas is drawn
 * by the SDK's own render worker, which is exact in the pinned Chromium.
 */

/** A fixed time, so nothing that reads the clock can vary (ADR 0048). */
const NOW = new Date("2026-11-14T12:00:00Z");

type State = (page: Page) => Promise<void>;

const open = (bytes: Uint8Array) => async (page: Page) => {
  await page.evaluate(
    (data) => window.imageEditor.open(new Uint8Array(data).buffer),
    Array.from(bytes),
  );
};
const opened = async (page: Page) => {
  await open(fixture("quadrants.png"))(page);
  await expect(page.getByRole("img", { name: "Edited image preview, 48 × 32" })).toBeVisible();
};
const exportDialog = async (page: Page) => {
  await open(jpegWithPrivateMetadata())(page);
  await expect(page.getByRole("img", { name: /Edited image preview/ })).toBeVisible();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Export image" })).toBeVisible();
};

const EDITOR: Readonly<Record<string, State>> = {
  empty: async (page) => {
    await expect(page.getByRole("button", { name: "Choose an image" })).toBeVisible();
  },
  open: opened,
  crop: async (page) => {
    await opened(page);
    await page.getByRole("button", { name: "Rotate left" }).focus();
    await page.keyboard.press("c");
    await expect(page.getByRole("group", { name: "Crop area" })).toBeFocused();
  },
  filters: async (page) => {
    await opened(page);
    await page.getByRole("radio", { name: "Filters" }).click();
    await page.getByRole("radio", { name: "Sepia" }).click();
    await expect(page.getByRole("slider", { name: "Strength" })).toBeVisible();
  },
  "export-summary": exportDialog,
  "export-done": async (page) => {
    await exportDialog(page);
    const dialog = page.getByRole("dialog", { name: "Export image" });
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Download" })).toBeFocused();
  },
  error: async (page) => {
    await open(new Uint8Array([1, 2, 3, 4]))(page);
    await expect(page.locator(".hm-image-stage-error")).toBeVisible();
  },
};

const ELEMENT: Readonly<Record<string, State>> = {
  "element-empty": async (page) => {
    await expect(page.getByRole("button", { name: "Choose an image" })).toBeVisible();
  },
  "element-open": async (page) => {
    await page.evaluate(
      (bytes) => {
        const editor = document.querySelector("hm-image-editor") as HTMLElement & { file?: Blob };
        editor.file = new Blob([new Uint8Array(bytes)], { type: "image/png" });
      },
      Array.from(fixture("quadrants.png")),
    );
    await expect(page.getByRole("img", { name: "Edited image preview, 48 × 32" })).toBeVisible();
  },
};

for (const [path, states] of [
  ["/editor.html", EDITOR],
  ["/element.html", ELEMENT],
] as const) {
  for (const [state, reach] of Object.entries(states)) {
    for (const variant of visualVariants) {
      test(`${state}, ${variant.name}`, async ({ page }) => {
        // No request may leave the page's origin (sdk-core ADR 0012).
        const foreign: string[] = [];
        page.on("request", (request) => {
          const url = new URL(request.url());
          if (!["http:", "https:"].includes(url.protocol)) return;
          if (url.origin !== "http://localhost:4320") foreign.push(request.url());
        });
        await page.clock.install({ time: NOW });
        await page.goto(path);
        await applyVisualVariant(page, variant);
        await reach(page);
        // The pointer rests outside the editor, so no hover styles show.
        await page.mouse.move(0, 0);
        await expect(page).toHaveScreenshot(`${state}-${variant.name}.png`);
        expect(foreign).toEqual([]);
      });
    }
  }
}
