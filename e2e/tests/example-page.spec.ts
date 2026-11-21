import { fixture } from "../fixtures.js";
import { expect, test } from "../test.js";
import { FIRST_RENDER_TIMEOUT } from "../timeouts.js";

/**
 * The example page's `window.imageEditor` is how these suites drive the
 * editor as a host would. React commits the editor in a task of its own,
 * which can run after the page's `load` event, so a test's first `open` can
 * arrive before the editor exists. The page must hold that call until the
 * editor has mounted, never drop it: a dropped open is an editor that stays
 * empty, and a test that waits out its first-render timeout for nothing.
 */
test("the example page opens a file handed over before the editor has rendered", async ({
  page,
}) => {
  // Calls open() at the moment the page defines its handle, which is before
  // it renders the editor: the earliest a test could ever call it.
  await page.addInitScript(
    (bytes) => {
      let handle: Window["imageEditor"] | undefined;
      Object.defineProperty(window, "imageEditor", {
        configurable: true,
        get: () => handle,
        set(value: Window["imageEditor"]) {
          handle = value;
          const rendered = document.querySelector(".hm-image-editor") !== null;
          (window as unknown as { early: unknown }).early = { rendered };
          void value.open(new Uint8Array(bytes).buffer);
        },
      });
    },
    Array.from(fixture("quadrants.png")),
  );
  await page.goto("/editor.html");
  // The call really was early: nothing of the editor was in the page yet.
  expect(await page.evaluate(() => (window as unknown as { early: unknown }).early)).toEqual({
    rendered: false,
  });
  await expect(page.getByRole("img", { name: "Edited image preview, 48 × 32" })).toBeVisible({
    timeout: FIRST_RENDER_TIMEOUT,
  });
});
