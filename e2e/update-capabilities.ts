import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  BROWSERS,
  type Browser,
  DECODE_CASES,
  FEATURES,
  IN_PINNED_IMAGE,
  RESULTS,
  TABLE,
} from "./capabilities.js";

interface Result {
  readonly browser: Browser;
  readonly version: string;
  readonly row: string;
  readonly cell: string;
}

/**
 * After the suite, with UPDATE_CAPABILITIES=1, rewrites docs/capabilities.md
 * from what every engine did. Without it, does nothing: the tests compare
 * against the committed table instead.
 */
export default function updateCapabilities(): void {
  if (!process.env["UPDATE_CAPABILITIES"]) return;
  if (!IN_PINNED_IMAGE) {
    throw new Error(
      "docs/capabilities.md describes the pinned browser image. Regenerate it with tools/update-capabilities.sh.",
    );
  }
  mkdirSync(RESULTS, { recursive: true });
  const results: Result[] = readdirSync(RESULTS).map(
    (file) => JSON.parse(readFileSync(new URL(file, RESULTS), "utf8")) as Result,
  );
  const versions = Object.fromEntries(
    BROWSERS.map((browser) => [
      browser,
      results.find((r) => r.browser === browser)?.version ?? "?",
    ]),
  ) as Record<Browser, string>;
  const rows = (names: readonly string[]) =>
    names
      .map(
        (name) =>
          `| ${name} | ${BROWSERS.map(
            (browser) =>
              results.find((r) => r.row === name && r.browser === browser)?.cell ?? "not run",
          ).join(" | ")} |`,
      )
      .join("\n");

  writeFileSync(
    TABLE,
    `# Browser capabilities

What each browser engine decodes, draws and encodes in a worker, measured by the end-to-end suite (\`e2e/tests/capabilities.spec.ts\`) on the example page. ADR 0001 says every claim about a browser is checked here before code relies on it.

The engines are those of the pinned browser image in \`ci/Dockerfile\`, where CI runs: Chromium ${versions.chromium}, Firefox ${versions.firefox} and WebKit ${versions.webkit}, on Linux. Results depend on how a browser was built, and **Playwright's WebKit isn't Safari**: it doesn't have Safari's system decoders, such as HEIC, or iOS's canvas limits. Those need a device, and the records that rely on them say so.

In the pinned image, the suite fails when a browser's outcome differs from these tables. After the image or Playwright changes, regenerate them with \`pnpm build:examples && tools/update-capabilities.sh\`, which runs the suite in that image with Docker, and review the difference.

## Decoding with \`createImageBitmap\` in a worker

Each file is a generated solid colour (\`tools/generate-capability-fixtures.sh\`, \`e2e/fixtures.ts\`). The primary image is red; every secondary image, such as a preview, gain map or thumbnail, is blue and larger, so the size and colour show which one the browser decoded. Before the browser sees a file, the suite checks that the SDK's own probe reads the same upright size, or refuses the file where the table says so.

- **decodes:** the browser returned the primary image, red, at its upright size: the size the engine's check against the probe expects (ADR 0001). For the rows decoded with \`imageOrientation: "none"\`, it's the stored size instead, without the orientation.
- **decodes W × H, colour:** the browser returned something else, such as a secondary image, or the stored size without its orientation.
- **Four-colour rows** (named by their orientation carrier): the decode's pixels are read at the centre of each quadrant. **decodes** means they show exactly the orientation the SDK's probe reads; **decodes as stored** that the browser ignored it; **decodes as orientation N** that it applied another; and **unrecognised** that the pixels match none of the eight. The engine calibrates on this (ADR 0005).
- **doesn't decode:** \`createImageBitmap\` rejected the file. The engine reports that as \`DECODE_FAILED\`.
- **never settles:** the decode didn't finish within 10 seconds.

The SDK's probe refuses **GIF, frame outside the screen**, so the engine never decodes it. The row shows why: every engine grows the image to fit the frame, so a bound from the logical screen would be too small (ADR 0001).\n\n**HEIC** doesn't decode in any of these engines. Safari on Apple platforms may decode it with the system's decoder, which Playwright's WebKit doesn't have and only a device can check. Where it doesn't decode, the SDK reports \`DECODE_FAILED\` (ADR 0001).

| File | Chromium | Firefox | WebKit |
|---|---|---|---|
${rows(DECODE_CASES.map((c) => c.name))}

## Canvas and encoding in a worker

- **convertToBlob:** \`encodes\` when the blob has the requested type. A browser that can't encode a type returns PNG instead, which is why the SDK checks the returned type (ADR 0001).
- **2D context filter:** whether the 2D context has a \`filter\` property, and whether drawing through \`brightness(50%)\` halves red.
- **Display-P3 2D context:** whether \`getContext("2d", { colorSpace: "display-p3" })\` gives a Display-P3 context.
- **Canvas sizes:** whether a canvas of that size draws its far corner pixel. Some engines return a context for a canvas they can't back. 50.3 MP is the first size over \`maxImagePixels\`' 50 MP (ADR 0004). iOS Safari's own cap is lower than desktop WebKit's and can't be measured here.
- **Longest side:** the longest one-pixel-high canvas that draws, found by binary search up to 131,071 pixels; an engine that reaches that shows \`at least\`.

| Feature | Chromium | Firefox | WebKit |
|---|---|---|---|
${rows(FEATURES)}
`,
  );
}
