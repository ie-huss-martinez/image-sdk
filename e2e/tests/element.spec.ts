import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { fixture } from "../fixtures.js";

/**
 * `<hm-image-editor>` on a page without React of its own (docs/adr/0007,
 * sdk-core ADR 0040): it renders the editor into its light DOM, with no
 * accessibility violations, and its events carry no file names.
 */
async function noViolations(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page }).include("hm-image-editor").analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

test.describe("the image editor element", () => {
  test("opens a file property, with no violations, and fires events without names", async ({
    page,
  }) => {
    await page.goto("/element.html");
    await expect(page.getByRole("button", { name: "Choose an image" })).toBeVisible();
    await noViolations(page);

    await page.evaluate(
      (bytes) => {
        const editor = document.querySelector("hm-image-editor") as HTMLElement & { file?: Blob };
        editor.file = new File([new Uint8Array(bytes)], "private-holiday.png", {
          type: "image/png",
        });
      },
      Array.from(fixture("quadrants.png")),
    );
    await expect(page.getByRole("img", { name: "Edited image preview, 48 × 32" })).toBeVisible();
    await noViolations(page);

    await page.getByRole("button", { name: "Rotate right" }).click();
    await expect(page.getByRole("img", { name: "Edited image preview, 32 × 48" })).toBeVisible();
    const events = await page.evaluate(() => window.imageElementEvents);
    expect(events.map((event) => event.name)).toContain("change");
    expect(events.map((event) => event.name)).toContain("event");
    for (const event of events) expect(event.json).not.toContain("private-holiday");
  });
});
