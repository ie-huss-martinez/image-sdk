import AxeBuilder from "@axe-core/playwright";
import { fixture } from "../fixtures.js";
import { expect, test } from "../test.js";
import { FIRST_RENDER_TIMEOUT } from "../timeouts.js";

for (const focus of ["editor", "host"] as const) {
  test(`worker loss replaces the editing surface, focus belongs to ${focus}`, async ({ page }) => {
    const foreign: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith("http") && url.origin !== "http://localhost:4320")
        foreign.push(request.url());
    });
    await page.goto("/editor.html?failure");
    await page.evaluate(
      (bytes) => window.imageEditor.open(new Uint8Array(bytes).buffer),
      Array.from(fixture("quadrants.png")),
    );
    await expect(page.getByRole("img", { name: "Edited image preview, 48 × 32" })).toBeVisible({
      timeout: FIRST_RENDER_TIMEOUT,
    });
    if (focus === "editor") {
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
    } else {
      await page.evaluate(() => {
        const input = document.createElement("input");
        input.setAttribute("aria-label", "Host field");
        document.body.append(input);
        input.focus();
      });
    }
    await page.evaluate(() =>
      window.imageEditor.open(new TextEncoder().encode("hm-image-test-crash!").buffer),
    );
    const notice = page.getByRole("alert").filter({ hasText: "Image processing stopped." });
    await expect(notice).toContainText("Image processing stopped.");
    await expect(notice).toContainText("Unsaved edits will be lost");
    await expect(
      page.locator("canvas, dialog, .hm-image-editor button, .hm-image-editor input"),
    ).toHaveCount(0);
    if (focus === "editor") await expect(notice).toBeFocused();
    else await expect(page.getByRole("textbox", { name: "Host field" })).toBeFocused();
    const axe = await new AxeBuilder({ page }).include(".hm-image-editor").analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    expect(foreign).toEqual([]);
  });
}
