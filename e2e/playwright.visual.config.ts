import { defineVisualConfig } from "@hussmartinez/sdk-config/testing/visual";
import type { PlaywrightTestConfig } from "@playwright/test";

/**
 * Visual regression tests of the editor and the element on the built Vite
 * example (sdk-core ADR 0048): Chromium, in the pinned browser test image
 * only. Run them with `pnpm test:visual`, and rewrite the baselines with
 * `pnpm test:visual:update`, never with playwright directly.
 */
const config = defineVisualConfig({
  baseURL: "http://localhost:4320",
  // Started with Node directly, as the end-to-end suite's server is.
  webServer: {
    command: "node node_modules/vite/bin/vite.js preview --port 4320 --strictPort",
    cwd: "../examples/vite",
    url: "http://localhost:4320",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

const visual: PlaywrightTestConfig = {
  ...config,
  // A test may wait up to 30 s for its first render (timeouts.ts), so its
  // own limit leaves room.
  timeout: 60_000,
};

export default visual;
