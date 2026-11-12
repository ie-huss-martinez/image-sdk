import { expect, type Page, test } from "@playwright/test";
import { fixture, quadrantsJpeg, quadrantsPng, quadrantsWebp } from "../fixtures.js";
import { classify } from "../orientation.js";

/**
 * The SDK's engine on the built example, as a host runs it (docs/adr/0001,
 * docs/adr/0002, docs/adr/0005): every format it reads, and the oriented
 * four-colour files, decoded upright in every engine, whether the browser
 * applied the orientation or the worker did. The inlined worker runs on
 * inline.html, whose policy allows `worker-src blob:`; the self-hosted one
 * on strict.html, whose policy allows only `worker-src 'self'`.
 */
const SMALL = { width: 48, height: 32 };
const CASES: readonly {
  name: string;
  bytes: () => Uint8Array;
  /** The four-colour files' orientation, which the pixels must show. */
  orientation?: number;
}[] = [
  { name: "PNG", bytes: () => fixture("primary.png") },
  { name: "JPEG", bytes: () => fixture("primary.jpg") },
  { name: "WebP, lossy", bytes: () => fixture("primary-lossy.webp") },
  { name: "WebP, lossless", bytes: () => fixture("primary-lossless.webp") },
  { name: "GIF", bytes: () => fixture("primary.gif") },
  { name: "BMP", bytes: () => fixture("primary.bmp") },
  { name: "AVIF", bytes: () => fixture("primary.avif") },
  { name: "JPEG, EXIF orientation 7", bytes: () => quadrantsJpeg(7), orientation: 7 },
  { name: "JPEG, EXIF orientation 3", bytes: () => quadrantsJpeg(3), orientation: 3 },
  { name: "PNG, eXIf orientation 7", bytes: () => quadrantsPng(7, "before IDAT"), orientation: 7 },
  { name: "WebP, EXIF orientation 7", bytes: () => quadrantsWebp(7), orientation: 1 },
  { name: "AVIF, irot 1", bytes: () => fixture("quadrants-irot1.avif"), orientation: 8 },
  {
    name: "AVIF, irot 1 then imir 0",
    bytes: () => fixture("quadrants-irot1-imir0.avif"),
    orientation: 5,
  },
];

const MODES = [
  { mode: "inline", page: "/inline.html", selfHosted: false },
  { mode: "self-hosted", page: "/strict.html", selfHosted: true },
] as const;

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

for (const { mode, page: path, selfHosted } of MODES) {
  test.describe(`the engine, ${mode}`, () => {
    for (const engineCase of CASES) {
      test(engineCase.name, async ({ page }) => {
        const foreign = foreignRequests(page);
        await page.goto(path);
        const outcome = await page.evaluate(
          ([data, hosted]) => window.imageSdk.run(new Uint8Array(data).buffer, hosted),
          [Array.from(engineCase.bytes()), selfHosted] as const,
        );
        expect(outcome.status).toBe("decoded");
        if (engineCase.orientation === undefined) {
          expect({ width: outcome.width, height: outcome.height }).toEqual(SMALL);
        } else {
          // Upright, pixel for pixel: the quadrants show exactly the probe's orientation.
          expect(outcome.orientation).toBe(engineCase.orientation);
          expect(classify(outcome.width ?? 0, outcome.height ?? 0, outcome.quadrants)).toBe(
            engineCase.orientation,
          );
        }
        expect(outcome.decodedBytes).toBe((outcome.width ?? 0) * (outcome.height ?? 0) * 4);
        expect(await page.evaluate(() => window.imageSdk.violations)).toEqual([]);
        expect(foreign).toEqual([]);
      });
    }

    test("fails HEIC with DECODE_FAILED where the browser can't decode it", async ({ page }) => {
      await page.goto(path);
      const outcome = await page.evaluate(
        ([data, hosted]) => window.imageSdk.run(new Uint8Array(data).buffer, hosted),
        [Array.from(fixture("primary.heic")), selfHosted] as const,
      );
      // Every engine in the pinned image refuses HEIC (docs/capabilities.md).
      expect(outcome.status).toBe("DECODE_FAILED");
    });
  });
}
