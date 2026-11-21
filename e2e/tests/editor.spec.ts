import AxeBuilder from "@axe-core/playwright";
import {
  fixture,
  gifWithBackground,
  jpegWithPrivateMetadata,
  quadrantsPngWithColourProfile,
} from "../fixtures.js";
import { expect, type Page, test } from "../test.js";
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

  test("redacts with no violations, and keeps the frame's keys from the browser", async ({
    page,
  }) => {
    await page.goto("/editor.html");
    // A page taller than the window, with a history entry to go back to: a
    // key that reached the browser would scroll it or leave it.
    await page.evaluate(() => {
      document.body.style.minHeight = "300vh";
      history.pushState({}, "", "#redacting");
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
    await page.getByRole("button", { name: "Redact" }).click();
    await expect(page.getByRole("region", { name: "Redact", exact: true })).toBeVisible();
    await noViolations(page);
    await page.getByRole("button", { name: "Add area" }).click();
    const area = page.getByRole("group", { name: "Redacted area 1 of 1" });
    await expect(area).toBeFocused();
    await noViolations(page);
    const scrolled = () => page.evaluate(() => [window.scrollX, window.scrollY]);
    const before = await scrolled();
    for (const keys of [
      "Shift+ArrowLeft",
      "Shift+ArrowUp",
      "Shift+ArrowRight",
      "Shift+ArrowDown",
      "ArrowRight",
      "ArrowDown",
      "ArrowLeft",
      "ArrowUp",
    ]) {
      await page.keyboard.press(keys);
      expect(page.url(), keys).toContain("/editor.html#redacting");
      expect(await scrolled(), keys).toEqual(before);
      await expect(area, keys).toBeFocused();
    }
    // Pixelation, with its warning, is still free of violations.
    await page.getByRole("radio", { name: "Pixelation" }).click();
    await expect(page.getByText("Pixelation may not hide text.")).toBeVisible();
    await noViolations(page);
    // Backspace removes the area, and doesn't go back a page.
    await area.focus();
    await page.keyboard.press("Backspace");
    await expect(page.getByRole("group", { name: /Redacted area/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add area" })).toBeFocused();
    expect(page.url()).toContain("/editor.html#redacting");
  });

  test("shows the layers with no violations, and keeps their keys from the browser", async ({
    page,
  }) => {
    await page.goto("/editor.html");
    // A page taller than the window, with a history entry to go back to: a
    // key that reached the browser would scroll it or leave it.
    await page.evaluate(() => {
      document.body.style.minHeight = "300vh";
      history.pushState({}, "", "#layers");
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
    // Three shapes, as a host adds them: the tools that add layers come next.
    await page.evaluate(() => {
      const shape = (key: string, name: string, x: number, y: number) => ({
        key,
        name,
        kind: "shape",
        shape: "rectangle",
        fill: "#c03030",
        stroke: null,
        visible: true,
        opacity: 100,
        x,
        y,
        width: 12,
        height: 8,
        rotation: 0,
        flipX: false,
      });
      window.imageEditor.execute([
        {
          type: "image.insertLayers",
          at: 0,
          layers: [
            shape("a", "Bottom", 2, 2),
            shape("b", "Middle", 18, 12),
            shape("c", "Top", 34, 22),
          ],
        },
      ]);
    });
    const order = () =>
      page.evaluate(() =>
        (window.imageEditor.plan() as { layers: { key: string }[] }).layers.map(
          (layer) => layer.key,
        ),
      );
    const layers = page.getByRole("button", { name: "Layers", exact: true });
    await layers.focus();
    await page.keyboard.press("l");
    await expect(page.getByRole("region", { name: "Layers", exact: true })).toBeVisible();
    // On the top layer's row in the list, which is selected.
    const top = page.getByRole("gridcell", { name: "Top", exact: true });
    await expect(top).toBeFocused();
    await expect(page.locator('[role="row"][aria-selected="true"]')).toContainText("Top");
    await noViolations(page);
    const scrolled = () => page.evaluate(() => [window.scrollX, window.scrollY]);
    // Moving focus may scroll its target into view; a key must not scroll further.
    let before = await scrolled();
    const stayed = async (keys: string) => {
      expect(page.url(), keys).toContain("/editor.html#layers");
      expect(await scrolled(), keys).toEqual(before);
    };
    // The list's keys, with a real key press in each engine: Alt is Option on macOS.
    await page.keyboard.press("Alt+ArrowDown");
    await stayed("Alt+ArrowDown");
    expect(await order()).toEqual(["a", "c", "b"]);
    await expect(top).toBeFocused();
    await page.keyboard.press("Alt+ArrowDown");
    // At the bottom, the key is still the list's: nothing scrolls.
    await page.keyboard.press("Alt+ArrowDown");
    await stayed("Alt+ArrowDown at the bottom");
    expect(await order()).toEqual(["c", "a", "b"]);
    await page.keyboard.press("Alt+ArrowUp");
    await page.keyboard.press("Alt+ArrowUp");
    await page.keyboard.press("Alt+ArrowUp");
    await stayed("Alt+ArrowUp at the top");
    expect(await order()).toEqual(["a", "b", "c"]);
    await expect(top).toBeFocused();
    // In the name's field the keys are the field's: the layers stay as they are.
    const name = page.getByRole("textbox", { name: "Name" });
    await name.focus();
    // Left to the browser, which may scroll the page for Alt with an arrow,
    // as it does from any field: the layers don't move, and nothing navigates.
    await page.keyboard.press("Alt+ArrowUp");
    await page.keyboard.press("Alt+ArrowDown");
    await page.keyboard.press("Backspace");
    expect(page.url()).toContain("/editor.html#layers");
    expect(await order()).toEqual(["a", "b", "c"]);
    await expect(name).toHaveValue("To");
    // Put back, so leaving the field renames nothing.
    await page.keyboard.press("p");
    await expect(name).toHaveValue("Top");
    // The frame's keys are the crop frame's.
    const frame = page.getByRole("group", { name: "Layer 1 of 3: Top" });
    await frame.focus();
    // Once the browser's own scrolling, from the field's keys and from
    // moving focus, has come to rest: it may be animated.
    await expect
      .poll(async () => {
        const first = await scrolled();
        await page.waitForTimeout(150);
        return (await scrolled()).join() === first.join();
      })
      .toBe(true);
    before = await scrolled();
    for (const keys of [
      "Shift+ArrowLeft",
      "Shift+ArrowUp",
      "ArrowRight",
      "ArrowDown",
      "ArrowLeft",
      "ArrowUp",
    ]) {
      await page.keyboard.press(keys);
      await stayed(keys);
      await expect(frame, keys).toBeFocused();
    }
    await expect(frame).toHaveAccessibleDescription(/^11 × 7 pixels, from 34, 22, turned 0°\./);
    await noViolations(page);
    // Backspace deletes the layer, and doesn't go back a page: focus is on the next frame.
    // Focus moves to that frame, which the browser may scroll into view.
    await page.keyboard.press("Backspace");
    expect(page.url()).toContain("/editor.html#layers");
    expect(await order()).toEqual(["a", "b"]);
    await expect(page.getByRole("group", { name: "Layer 1 of 2: Middle" })).toBeFocused();
    // Delete in the list, too.
    await page.getByRole("gridcell", { name: "Middle", exact: true }).focus();
    await page.keyboard.press("Delete");
    expect(page.url()).toContain("/editor.html#layers");
    expect(await order()).toEqual(["a"]);
    await expect(page.getByRole("gridcell", { name: "Bottom", exact: true })).toBeFocused();
  });

  test("adds text, a shape and an image with the keyboard and the file picker, with no violations", async ({
    page,
  }) => {
    await page.goto("/editor.html");
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
    const layers = () =>
      page.evaluate(
        () => (window.imageEditor.plan() as { layers: Record<string, unknown>[] }).layers,
      );
    // Text, with its key: focus lands in the text field, and typing is the layer's text.
    await page.getByRole("button", { name: "Rotate left" }).focus();
    await page.keyboard.press("t");
    const text = page.getByRole("textbox", { name: "Text", exact: true });
    await expect(text).toBeFocused();
    await page.keyboard.type("Hello");
    await page.keyboard.press("Enter");
    await page.keyboard.type("there");
    await expect.poll(async () => (await layers())[0]?.["text"]).toBe("Hello\nthere");
    await expect(page.locator('[role="row"][aria-selected="true"]')).toContainText("Hello");
    await noViolations(page);
    // Its colour, from the swatches, with the arrow keys of a radio group.
    await page.getByRole("radio", { name: "Black" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await layers())[0]?.["colour"]).toBe("#ffffff");
    // A rectangle, from its button with the keyboard.
    await page.getByRole("button", { name: "Add a rectangle" }).focus();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await layers()).length).toBe(2);
    // Focus stays on the button that added it; the new layer is the one selected.
    await expect(page.getByRole("button", { name: "Add a rectangle" })).toBeFocused();
    await expect(page.locator('[role="row"][aria-selected="true"]')).toContainText("Rectangle");
    await expect(page.getByRole("button", { name: "Outline", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await noViolations(page);
    // An image, through the tool's own file picker: a real one, in each engine.
    const picker = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Add an image" }).click();
    await (await picker).setFiles({
      name: "private-name.png",
      mimeType: "image/png",
      buffer: Buffer.from(fixture("quadrants.png")),
    });
    await expect.poll(async () => (await layers()).length).toBe(3);
    const image = (await layers())[2];
    // 48 × 32 fits half of 48 × 32 at 24 × 16, in the middle.
    expect(image).toMatchObject({ kind: "image", x: 12, y: 8, width: 24, height: 16, name: "" });
    await expect(page.locator('[role="row"][aria-selected="true"]')).toContainText("Image");
    await expect(page.locator("#editor")).not.toContainText("private-name");
    await noViolations(page);
    // The image is still the one that was opened: the layer didn't replace it.
    await expect(page.getByRole("img", { name: "Edited image preview, 48 × 32" })).toBeVisible();
  });

  test("exports straight from an open tool, and says why it waits while cropping", async ({
    page,
  }) => {
    await page.goto("/editor.html");
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
    const exportButton = page.getByRole("button", { name: "Export", exact: true });
    // Text, typed, then straight to Export with the keyboard: no Done first.
    await page.getByRole("button", { name: "Rotate left" }).focus();
    await page.keyboard.press("t");
    await expect(page.getByRole("textbox", { name: "Text", exact: true })).toBeFocused();
    await page.keyboard.type("Hi");
    await expect(exportButton).toBeEnabled();
    await exportButton.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Export image" });
    await expect(dialog).toBeVisible();
    // The layers closed, and what was typed is in the plan that's exported.
    await expect(page.getByRole("region", { name: "Layers", exact: true })).toHaveCount(0);
    const text = await page.evaluate(
      () => (window.imageEditor.plan() as { layers: { text?: string }[] }).layers[0]?.text,
    );
    expect(text).toBe("Hi");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    // Cropping: Export waits, reachable with the keyboard, and described.
    await page.getByRole("button", { name: "Crop", exact: true }).click();
    await expect(page.getByRole("group", { name: "Crop area" })).toBeFocused();
    await expect(exportButton).toHaveAttribute("aria-disabled", "true");
    await expect(exportButton).toHaveAccessibleDescription(
      "Apply or cancel the crop before exporting.",
    );
    await exportButton.focus();
    await expect(exportButton).toBeFocused();
    // A pointer resting on it shows the reason, too.
    await exportButton.hover();
    await expect(page.getByText("Apply or cancel the crop before exporting.")).toBeVisible();
    await noViolations(page);
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Crop area" })).toBeVisible();
  });

  test("draws with a real mouse, and points with an arrow from the keyboard, with no violations", async ({
    page,
  }) => {
    await page.goto("/editor.html");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Choose an image" }).click();
    await (await chooser).setFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: Buffer.from(fixture("quadrants.png")),
    });
    const preview = page.getByRole("img", { name: "Edited image preview, 48 × 32" });
    await expect(preview).toBeVisible({ timeout: FIRST_RENDER_TIMEOUT });
    const layers = () =>
      page.evaluate(
        () => (window.imageEditor.plan() as { layers: Record<string, unknown>[] }).layers,
      );
    // The draw tool, by its key; its panel says that drawing needs a pointer.
    await page.getByRole("button", { name: "Rotate left" }).focus();
    await page.keyboard.press("d");
    await expect(page.getByRole("region", { name: "Draw", exact: true })).toBeVisible();
    await expect(page.getByText("Drawing needs a mouse, a pen or a finger")).toBeVisible();
    await noViolations(page);
    // A stroke with a real mouse: down, across the stage in steps, up.
    const stage = await page.locator(".hm-image-draw-overlay").boundingBox();
    if (!stage) throw new Error("no draw overlay");
    const middle = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };
    await page.mouse.move(middle.x - 80, middle.y - 20);
    await page.mouse.down();
    await page.mouse.move(middle.x, middle.y - 20, { steps: 8 });
    await page.mouse.move(middle.x + 60, middle.y + 30, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await layers()).length).toBe(1);
    const [drawing] = (await layers()) as {
      kind: string;
      opacity: number;
      strokes: { runs: number[][] }[];
    }[];
    expect(drawing).toMatchObject({ kind: "drawing", opacity: 100 });
    expect(drawing?.strokes).toHaveLength(1);
    // Right, then down and right: the corner is kept, the samples between aren't.
    const run = drawing?.strokes[0]?.runs[0] ?? [];
    expect(run.length).toBeGreaterThanOrEqual(6);
    expect(run.length).toBeLessThanOrEqual(12);
    expect(run.slice(0, 2)).toEqual([0, 0]);
    expect(run.at(-2) ?? 0).toBeGreaterThan(0);
    expect(run.at(-1) ?? 0).toBeGreaterThan(0);
    // A second stroke joins the same drawing; the last one can be removed.
    await page.mouse.move(middle.x - 40, middle.y + 40);
    await page.mouse.down();
    await page.mouse.move(middle.x + 40, middle.y + 40, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () => ((await layers())[0] as { strokes: unknown[] }).strokes.length)
      .toBe(2);
    await page.getByRole("button", { name: "Remove last stroke" }).click();
    await expect
      .poll(async () => ((await layers())[0] as { strokes: unknown[] }).strokes.length)
      .toBe(1);
    // An arrow, with the keyboard alone: added from its button, then re-aimed on its frame.
    await page.getByRole("button", { name: "Add an arrow" }).focus();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await layers()).length).toBe(2);
    await expect(page.getByRole("region", { name: "Layers", exact: true })).toBeVisible();
    const arrow = page.getByRole("group", { name: "Layer 1 of 2: Arrow" });
    await arrow.focus();
    await expect(arrow).toHaveAccessibleDescription(/^From 18, 16 to 30, 16\./);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowUp");
    await expect(arrow).toHaveAccessibleDescription(/^From 18, 17 to 31, 16\./);
    await expect(arrow).toBeFocused();
    await noViolations(page);
    // The drawing's frame is there too, and the image is still the one that was opened.
    await expect(page.getByRole("group", { name: "Layer 2 of 2: Drawing" })).toBeVisible();
    await expect(preview).toBeVisible();
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

  test("edits an animation's frames from the keyboard, with no violations", async ({ page }) => {
    await page.goto("/editor.html");
    await page.evaluate(
      (bytes) => window.imageEditor.open(new Uint8Array(bytes).buffer),
      Array.from(gifWithBackground("after disposal 2")),
    );
    const frames = page.getByRole("button", { name: "Frames" });
    await expect(frames).toBeVisible({ timeout: FIRST_RENDER_TIMEOUT });
    await frames.focus();
    await page.keyboard.press("Enter");
    const list = page.getByRole("grid", { name: "Frames, in the order they play" });
    await expect(list).toBeVisible();
    await noViolations(page);
    // Focus is in the list, on the first frame: Alt and Down move it later.
    await page.keyboard.press("Alt+ArrowDown");
    await expect(page.getByRole("region", { name: "Animation" })).toContainText("Frame 2 of 2");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(list.getByRole("row").first()).toContainText("Frame 1, 0.10 seconds");
    await page.getByRole("button", { name: "Done" }).click();
    await expect(list).toBeHidden();
    // Focus goes back to the tool's button.
    await expect(frames).toBeFocused();
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
