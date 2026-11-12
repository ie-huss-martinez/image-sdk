import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { probeImage } from "../../src/adapters/probe/probe.js";
import { createWindowReader } from "../../src/adapters/probe/window-reader.js";
import { isImageError } from "../../src/core/errors/image-error.js";
import {
  type Browser,
  DECODE_CASES,
  decodeCell,
  FEATURES,
  featureCells,
  IN_PINNED_IMAGE,
  RESULTS,
  readTable,
} from "../capabilities.js";

const table = readTable();
const update = Boolean(process.env["UPDATE_CAPABILITIES"]);

/** Requests the page makes to any other origin: the SDK must make none (ADR 0012 in sdk-core). */
function foreignRequests(page: Page): string[] {
  const foreign: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== "http://localhost:4320") {
      foreign.push(request.url());
    }
  });
  return foreign;
}

/** Records a row's cell for regeneration, or compares it with docs/capabilities.md. */
function check(info: TestInfo, browser: string, version: string, row: string, observed: string) {
  if (update) {
    mkdirSync(RESULTS, { recursive: true });
    const slug = `${browser}-${row.replace(/[^\w]+/g, "-")}.json`;
    writeFileSync(
      new URL(slug, RESULTS),
      JSON.stringify({ browser, version, row, cell: observed }),
    );
    return;
  }
  if (!IN_PINNED_IMAGE) {
    // The table describes the pinned image's engines; this host's may differ.
    info.annotations.push({
      type: "capabilities",
      description: `${row}, ${browser}: ${observed}; compared with docs/capabilities.md only in the pinned image`,
    });
    return;
  }
  expect
    .soft(
      observed,
      `${row} in ${browser} differs from docs/capabilities.md; regenerate it as the file explains, and review the difference`,
    )
    .toBe(table.get(row)?.[browser as Browser]);
}

for (const decodeCase of DECODE_CASES) {
  test(`decode: ${decodeCase.name}`, async ({ page, browserName, browser }, info) => {
    const bytes = decodeCase.bytes();

    // The SDK's own probe reads the same file first, as the engine will.
    let probed: Awaited<ReturnType<typeof probeImage>> | undefined;
    try {
      probed = await probeImage(createWindowReader(new Blob([bytes.slice()])));
    } catch (error) {
      expect(isImageError(error, "INVALID_IMAGE"), String(error)).toBe(true);
    }
    if (decodeCase.probe === "accepts") {
      expect(decodeCase.imageOrientation === "none" ? probed?.stored : probed?.oriented).toEqual(
        decodeCase.primary,
      );
      if (decodeCase.orientation !== undefined) {
        expect(probed?.orientation).toBe(decodeCase.orientation);
      }
    } else {
      expect(probed).toBeUndefined();
    }

    const foreign = foreignRequests(page);
    await page.goto("/");
    const outcome = await page.evaluate(
      ([data, imageOrientation]) =>
        window.imageCapabilities.decode(new Uint8Array(data).buffer, imageOrientation),
      [Array.from(bytes), decodeCase.imageOrientation ?? "from-image"] as const,
    );
    expect(foreign).toEqual([]);
    check(
      info,
      browserName,
      browser.version(),
      decodeCase.name,
      decodeCell(outcome, decodeCase.primary, decodeCase.orientation),
    );
  });
}

test("worker canvas and encoding", async ({ page, browserName, browser }, info) => {
  test.setTimeout(120_000);
  const foreign = foreignRequests(page);
  await page.goto("/");
  const features = await page.evaluate(() => window.imageCapabilities.features());
  expect(features, "the worker never answered").toBeDefined();
  expect(foreign).toEqual([]);
  if (!features) return;
  const cells = featureCells(features);
  for (const row of FEATURES) check(info, browserName, browser.version(), row, cells[row]);
});
