import { expect, test } from "@playwright/test";
import { fixture } from "../fixtures.js";

/**
 * The render worker under each Content Security Policy of docs/adr/0002:
 * inline.html allows `worker-src blob:`, which the inlined worker needs, and
 * strict.html allows only `worker-src 'self'`, which the self-hosted worker
 * needs. Each sets its policy with a meta tag, as a host would with a header.
 */
const bytes = Array.from(fixture("primary.png"));

test.describe("Content Security Policy", () => {
  test("worker-src blob: lets the inlined worker decode, with no violation", async ({ page }) => {
    await page.goto("/inline.html");
    const outcome = await page.evaluate(
      (data) => window.imageSdk.run(new Uint8Array(data).buffer, false),
      bytes,
    );
    expect(outcome).toMatchObject({ status: "decoded", width: 48, height: 32 });
    expect(await page.evaluate(() => window.imageSdk.violations)).toEqual([]);
  });

  test("worker-src 'self' lets the self-hosted worker decode, with no violation", async ({
    page,
  }) => {
    await page.goto("/strict.html");
    const outcome = await page.evaluate(
      (data) => window.imageSdk.run(new Uint8Array(data).buffer, true),
      bytes,
    );
    expect(outcome).toMatchObject({ status: "decoded", width: 48, height: 32 });
    expect(await page.evaluate(() => window.imageSdk.violations)).toEqual([]);
  });

  test("worker-src 'self' blocks the inlined worker, which starts from a blob: URL", async ({
    page,
  }) => {
    await page.goto("/strict.html");
    const outcome = await page.evaluate(
      (data) => window.imageSdk.run(new Uint8Array(data).buffer, false),
      bytes,
    );
    expect(outcome.status).toMatch(/^WORKER_/);
    await expect
      .poll(() => page.evaluate(() => window.imageSdk.violations))
      .toContainEqual(expect.stringMatching(/^worker-src blob/));
  });

  test("worker-src blob: blocks the self-hosted worker, which loads from this origin", async ({
    page,
  }) => {
    await page.goto("/inline.html");
    const outcome = await page.evaluate(
      (data) => window.imageSdk.run(new Uint8Array(data).buffer, true),
      bytes,
    );
    expect(outcome.status).toMatch(/^WORKER_/);
    await expect
      .poll(() => page.evaluate(() => window.imageSdk.violations))
      .toContainEqual(expect.stringMatching(/^worker-src http/));
  });
});
