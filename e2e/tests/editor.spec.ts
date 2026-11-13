import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { fixture } from "../fixtures.js";

/**
 * The React editor on the built example, as a host renders it (docs/adr/0007):
 * no accessibility violations in its designed states, and its keyboard path.
 */
async function noViolations(page: Page) {
  const results = await new AxeBuilder({ page }).include("#editor").analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test.describe("the image editor", () => {
  test("has no accessibility violations when empty", async ({ page }) => {
    await page.goto("/editor.html");
    await expect(page.getByRole("button", { name: "Choose an image" })).toBeVisible();
    await noViolations(page);
  });

  test("opens an image with the keyboard only, and has no violations once open", async ({
    page,
  }) => {
    await page.goto("/editor.html");
    // The drop zone's button opens the file chooser; the test answers it.
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Choose an image" }).focus();
    await page.keyboard.press("Enter");
    await (await chooser).setFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: Buffer.from(fixture("quadrants.png")),
    });
    const preview = page.getByRole("img", { name: "Edited image preview, 48 × 32" });
    await expect(preview).toBeVisible();
    // The canvas isn't a tab stop; focus moved to the first tool.
    await expect(preview).not.toHaveAttribute("tabindex");
    await expect(page.getByRole("button", { name: "Rotate left" })).toBeFocused();
    await noViolations(page);

    // `]` turns it, from the toolbar, and undo is a family shortcut.
    await page.keyboard.press("]");
    await expect(page.getByRole("img", { name: "Edited image preview, 32 × 48" })).toBeVisible();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    await expect(page.getByRole("img", { name: "Edited image preview, 48 × 32" })).toBeVisible();
  });

  test("crops with the keyboard, with no violations while cropping", async ({ page }) => {
    await page.goto("/editor.html");
    await page.evaluate(
      (bytes) => window.imageEditor.open(new Uint8Array(bytes).buffer),
      Array.from(fixture("quadrants.png")),
    );
    await expect(page.getByRole("img", { name: "Edited image preview, 48 × 32" })).toBeVisible();
    await page.getByRole("button", { name: "Rotate left" }).focus();
    await page.keyboard.press("c");
    const frame = page.getByRole("group", { name: "Crop area" });
    await expect(frame).toBeFocused();
    await expect(page.getByRole("region", { name: "Crop" })).toBeVisible();
    await noViolations(page);
    // Shrink it by 10 from the right edge, then apply: one crop, and focus returns.
    await page.keyboard.press("Alt+Shift+ArrowLeft");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("img", { name: "Edited image preview, 38 × 32" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Rotate left" })).toBeFocused();
  });

  test("crops by dragging a handle with a real mouse", async ({ page }) => {
    await page.goto("/editor.html");
    await page.evaluate(
      (bytes) => window.imageEditor.open(new Uint8Array(bytes).buffer),
      Array.from(fixture("quadrants.png")),
    );
    await expect(page.getByRole("img", { name: "Edited image preview, 48 × 32" })).toBeVisible();
    await page.getByRole("button", { name: "Crop" }).click();
    const frame = page.getByRole("group", { name: "Crop area" });
    await expect(frame).toBeFocused();
    const box = await frame.boundingBox();
    if (!box) throw new Error("no frame");
    const scale = box.width / 48;
    // The bottom-right handle sits on the corner: drag it in by 10 × 5 source pixels.
    await page.mouse.move(box.x + box.width, box.y + box.height);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 10 * scale, box.y + box.height - 5 * scale, {
      steps: 5,
    });
    await page.mouse.up();
    await page.getByRole("button", { name: "Apply crop" }).click();
    await expect(page.getByRole("img", { name: "Edited image preview, 38 × 27" })).toBeVisible();
  });
});
