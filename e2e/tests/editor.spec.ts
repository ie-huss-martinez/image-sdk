import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { fixture, jpegWithPrivateMetadata, quadrantsPngWithColourProfile } from "../fixtures.js";
import { FIRST_RENDER_TIMEOUT } from "../timeouts.js";

/**
 * The React editor on the built example, as a host renders it (docs/adr/0007):
 * no accessibility violations in its designed states, and its keyboard path.
 */
async function noViolations(page: Page) {
  // Colours are checked as they settle, not halfway through a fade, such as
  // a dialog's opening; a spinner's endless animation isn't waited for.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page }).include("#editor").analyze();
  // Each violation names its elements and axe's reason, so a failure says where.
  const found = results.violations.map(
    (v) =>
      `${v.id}: ${v.help} at ${v.nodes.map((n) => `${n.target.join(" ")} (${n.failureSummary ?? ""})`).join("; ")}`,
  );
  expect(found).toEqual([]);
}

test.describe("the image editor", () => {
  test("has no accessibility violations when empty", async ({ page }) => {
    await page.goto("/editor.html");
    await expect(page.getByRole("button", { name: "Choose an image" })).toBeVisible();
    await noViolations(page);
  });

  test("opens an image with a mouse click on the drop zone's button", async ({ page }) => {
    await page.goto("/editor.html");
    const choose = page.getByRole("button", { name: "Choose an image" });
    await expect(choose).toBeVisible();
    // Where a person clicks, the button is what's there: nothing covers it.
    const box = await choose.boundingBox();
    if (!box) throw new Error("the button has no box");
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const hit = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.textContent,
      centre,
    );
    expect(hit).toBe("Choose an image");
    // A real click at that point, not one dispatched to the button.
    const chooser = page.waitForEvent("filechooser");
    await page.mouse.click(centre.x, centre.y);
    await (await chooser).setFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: Buffer.from(fixture("quadrants.png")),
    });
    await expect(page.getByRole("img", { name: "Edited image preview, 48 × 32" })).toBeVisible({
      timeout: FIRST_RENDER_TIMEOUT,
    });
  });

  test("opens a file dropped on the empty stage", async ({ page }) => {
    await page.goto("/editor.html");
    await expect(page.getByRole("button", { name: "Choose an image" })).toBeVisible();
    const stage = page.locator(".hm-image-stage");
    const box = await stage.boundingBox();
    if (!box) throw new Error("the stage has no box");
    // A browser gives a drop to the topmost element under the pointer, and
    // it bubbles from there. So the events go to whatever is at the point,
    // as a real drop would, not to the drop zone by name: if another
    // element covered the zone, they'd never reach it.
    const dropped = await page.evaluate(
      ({ x, y, bytes }) => {
        const target = document.elementFromPoint(x, y);
        if (!target) return "nothing at the point";
        const data = new DataTransfer();
        data.items.add(new File([new Uint8Array(bytes)], "photo.png", { type: "image/png" }));
        for (const type of ["dragenter", "dragover", "drop"]) {
          target.dispatchEvent(
            new DragEvent(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              clientX: x,
              clientY: y,
              dataTransfer: data,
            }),
          );
        }
        return "dropped";
      },
      {
        // Away from the button and the text, a third of the way down.
        x: box.x + box.width / 2,
        y: box.y + box.height / 3,
        bytes: Array.from(fixture("quadrants.png")),
      },
    );
    expect(dropped).toBe("dropped");
    await expect(page.getByRole("img", { name: "Edited image preview, 48 × 32" })).toBeVisible({
      timeout: FIRST_RENDER_TIMEOUT,
    });
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
    await expect(preview).toBeVisible({ timeout: FIRST_RENDER_TIMEOUT });
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
    await expect(page.getByRole("img", { name: "Edited image preview, 48 × 32" })).toBeVisible({
      timeout: FIRST_RENDER_TIMEOUT,
    });
    await page.getByRole("button", { name: "Rotate left" }).focus();
    await page.keyboard.press("c");
    const frame = page.getByRole("group", { name: "Crop area" });
    await expect(frame).toBeFocused();
    await expect(page.getByRole("region", { name: "Crop" })).toBeVisible();
    await noViolations(page);
    // Shrink it by 10 from the right edge, then apply: one crop, and focus returns.
    for (let i = 0; i < 10; i += 1) await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("img", { name: "Edited image preview, 38 × 32" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Rotate left" })).toBeFocused();
  });

  test("keeps the crop frame's keys from the browser: nothing navigates or scrolls", async ({
    page,
  }) => {
    await page.goto("/editor.html");
    // A page taller than the window, with a history entry to go back to: a
    // key that reached the browser would scroll it or leave it.
    await page.evaluate(() => {
      document.body.style.minHeight = "300vh";
      history.pushState({}, "", "#cropping");
    });
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Choose an image" }).click();
    await (await chooser).setFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: Buffer.from(fixture("quadrants.png")),
    });
    await expect(page.getByRole("img", { name: "Edited image preview, 48 × 32" })).toBeVisible({
      timeout: FIRST_RENDER_TIMEOUT,
    });
    await page.getByRole("button", { name: "Rotate left" }).focus();
    await page.keyboard.press("c");
    const frame = page.getByRole("group", { name: "Crop area" });
    await expect(frame).toBeFocused();
    const scrolled = () => page.evaluate(() => [window.scrollX, window.scrollY]);
    const before = await scrolled();
    // Every key the frame takes, with a real key press in each engine.
    for (const keys of [
      // At the image's full size, growing does nothing; then it shrinks.
      "Shift+ArrowRight",
      "Shift+ArrowDown",
      "Shift+ArrowLeft",
      "Shift+ArrowUp",
      "ArrowRight",
      "ArrowDown",
      "ArrowLeft",
      "ArrowUp",
    ]) {
      await page.keyboard.press(keys);
      expect(page.url(), keys).toContain("/editor.html#cropping");
      expect(await scrolled(), keys).toEqual(before);
      await expect(frame, keys).toBeFocused();
    }
    // Shift with Left and Up shrank it by one each way, and the moves undid themselves.
    await expect(frame).toHaveAccessibleDescription(/^47 × 31 pixels, from 0, 0\./);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("img", { name: "Edited image preview, 47 × 31" })).toBeVisible();
    expect(page.url()).toContain("/editor.html#cropping");
  });

  test("crops by dragging a handle with a real mouse", async ({ page }) => {
    await page.goto("/editor.html");
    await page.evaluate(
      (bytes) => window.imageEditor.open(new Uint8Array(bytes).buffer),
      Array.from(fixture("quadrants.png")),
    );
    await expect(page.getByRole("img", { name: "Edited image preview, 48 × 32" })).toBeVisible({
      timeout: FIRST_RENDER_TIMEOUT,
    });
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

  test("has no violations with the Adjust and Filters panels", async ({ page }) => {
    await page.goto("/editor.html");
    await page.evaluate(
      (bytes) => window.imageEditor.open(new Uint8Array(bytes).buffer),
      Array.from(fixture("quadrants.png")),
    );
    await expect(page.getByRole("region", { name: "Adjust" })).toBeVisible();
    await noViolations(page);
    await page.getByRole("radio", { name: "Filters" }).click();
    await page.getByRole("radio", { name: "Sepia" }).click();
    await expect(page.getByRole("slider", { name: "Strength" })).toBeVisible();
    await noViolations(page);
  });

  test("has no violations with a notice and the Info panel, and dismisses the notice", async ({
    page,
  }) => {
    await page.goto("/editor.html");
    await page.evaluate(
      (bytes) => window.imageEditor.open(new Uint8Array(bytes).buffer),
      Array.from(quadrantsPngWithColourProfile()),
    );
    const notices = page.getByRole("status", { name: "Notices" });
    await expect(notices).toContainText(
      "Colours outside sRGB will be clipped in the exported file.",
      {
        timeout: FIRST_RENDER_TIMEOUT,
      },
    );
    await page.getByRole("radio", { name: "Info" }).click();
    await expect(page.getByRole("region", { name: "Image info" })).toContainText("48 × 32 pixels");
    await noViolations(page);
    await notices.getByRole("button", { name: "Dismiss" }).click();
    await expect(notices.getByRole("listitem")).toHaveCount(0);
  });

  test("exports with the keyboard only, after a summary of what's removed", async ({ page }) => {
    await page.goto("/editor.html");
    await page.evaluate(
      (bytes) => window.imageEditor.open(new Uint8Array(bytes).buffer),
      Array.from(jpegWithPrivateMetadata()),
    );
    await expect(page.getByRole("img", { name: /Edited image preview/ })).toBeVisible({
      timeout: FIRST_RENDER_TIMEOUT,
    });
    await page.getByRole("button", { name: "Export", exact: true }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Export image" });
    await expect(dialog).toBeVisible();
    const summary = dialog.getByRole("region", { name: "Summary" });
    await expect(summary).toContainText("JPEG");
    for (const kind of ["Location", "Camera details", "Dates and times"]) {
      await expect(summary).toContainText(kind);
    }
    await noViolations(page);

    // A field the user fills is listed as kept.
    await dialog.getByRole("textbox", { name: "Title" }).focus();
    await page.keyboard.type("Harbour");
    await expect(summary).toContainText("Kept in the file");

    await dialog.getByRole("button", { name: "Export", exact: true }).focus();
    await page.keyboard.press("Enter");
    const save = dialog.getByRole("button", { name: "Download" });
    await expect(save).toBeFocused();
    await noViolations(page);
    const download = page.waitForEvent("download");
    await page.keyboard.press("Enter");
    expect((await download).suggestedFilename()).toBe("image.jpg");

    await dialog.getByRole("button", { name: "Done" }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Export", exact: true })).toBeFocused();
  });
});
