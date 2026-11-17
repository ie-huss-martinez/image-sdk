import { expect, type Locator, type Page, test } from "@playwright/test";
import { fixture } from "../fixtures.js";
import { FIRST_RENDER_TIMEOUT } from "../timeouts.js";

/**
 * The keyboard-only path through the editor (docs/adr/0007, "Tests"): open
 * through the drop zone's button; crop with the frame's keys and with the
 * panel's fields; rotate, flip and undo; adjust with a slider's keys; choose
 * a filter; and export, checking the summary. Each step checks where focus
 * is, and nothing is clicked.
 */

type Plan = {
  base: {
    crop: { x: number; y: number; width: number; height: number } | null;
    orientation: { rotate: number; flipX: boolean; flipY: boolean };
    develop: Record<string, number>;
    filter: { preset: string; strength: number } | null;
  };
};
const plan = (page: Page) => page.evaluate(() => window.imageEditor.plan() as Plan);

/** Presses Tab, or Shift+Tab, until the locator has focus, as a person would. */
async function tabTo(page: Page, target: Locator, backwards = false) {
  for (let i = 0; i < 40; i += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press(backwards ? "Shift+Tab" : "Tab");
  }
  throw new Error(`Tab never reached ${target}`);
}

const undo = process.platform === "darwin" ? "Meta+z" : "Control+z";

test("edits and exports with the keyboard alone, with focus where it belongs", async ({ page }) => {
  await page.goto("/editor.html");
  const preview = (size: string) =>
    page.getByRole("img", { name: `Edited image preview, ${size}` });

  // Open through the drop zone's button.
  const choose = page.getByRole("button", { name: "Choose an image" });
  await tabTo(page, choose);
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: Buffer.from(fixture("quadrants.png")),
  });
  await expect(preview("48 × 32")).toBeVisible({ timeout: FIRST_RENDER_TIMEOUT });
  const rotateLeft = page.getByRole("button", { name: "Rotate left" });
  await expect(rotateLeft).toBeFocused();

  // Rotate with its key, flip from the toolbar, and undo both.
  await page.keyboard.press("]");
  await expect(preview("32 × 48")).toBeVisible();
  await expect(rotateLeft).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const flip = page.getByRole("button", { name: "Flip horizontally" });
  await expect(flip).toBeFocused();
  await page.keyboard.press("Enter");
  expect((await plan(page)).base.orientation).toEqual({ rotate: 90, flipX: true, flipY: false });
  await expect(flip).toBeFocused();
  await page.keyboard.press(undo);
  await page.keyboard.press(undo);
  await expect(preview("48 × 32")).toBeVisible();
  expect((await plan(page)).base.orientation).toEqual({ rotate: 0, flipX: false, flipY: false });
  await expect(flip).toBeFocused();

  // Crop: the frame's keys narrow it, the panel's field moves it, and Apply
  // applies it, returning focus to where cropping started.
  await page.keyboard.press("c");
  await expect(page.getByRole("group", { name: "Crop area" })).toBeFocused();
  for (let i = 0; i < 10; i += 1) await page.keyboard.press("Shift+ArrowLeft");
  const left = page.getByRole("spinbutton", { name: "Left" });
  await tabTo(page, left);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("2");
  await page.keyboard.press("Enter");
  await tabTo(page, page.getByRole("button", { name: "Apply crop" }));
  await page.keyboard.press("Enter");
  await expect(preview("38 × 32")).toBeVisible();
  expect((await plan(page)).base.crop).toEqual({ x: 2, y: 0, width: 38, height: 32 });
  await expect(flip).toBeFocused();

  // Adjust with a slider's keys: one step when the keys stop.
  const temperature = page.getByRole("slider", { name: "Temperature" });
  await tabTo(page, temperature);
  for (let i = 0; i < 3; i += 1) await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await plan(page)).base.develop["temperature"]).toBe(3);
  await expect(temperature).toBeFocused();

  // Choose a filter: back to the panel switch, across to Filters, then into
  // its presets.
  const filters = page.getByRole("radio", { name: "Filters" });
  await tabTo(page, page.getByRole("radio", { name: "Adjust" }), true);
  await page.keyboard.press("ArrowRight");
  await expect(filters).toBeFocused();
  await expect(filters).toBeChecked();
  await tabTo(page, page.getByRole("radio", { name: "None" }));
  await page.keyboard.press("ArrowRight");
  const vivid = page.getByRole("radio", { name: "Vivid" });
  await expect(vivid).toBeFocused();
  await expect.poll(async () => (await plan(page)).base.filter?.preset).toBe("vivid");

  // Export: back to the toolbar, to its last tool, then the dialog's summary.
  await tabTo(page, flip, true);
  await page.keyboard.press("End");
  const exportTool = page.getByRole("button", { name: "Export", exact: true });
  await expect(exportTool).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Export image" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await expect(dialog.getByRole("region", { name: "Summary" })).toContainText(
    "38 × 32 pixels, PNG",
  );
  await tabTo(page, dialog.getByRole("button", { name: "Export", exact: true }));
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("button", { name: "Download" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(exportTool).toBeFocused();
});
