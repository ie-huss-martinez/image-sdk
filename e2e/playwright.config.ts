import { fontLaunchEnv } from "@hussmartinez/sdk-config/testing/fonts";
import { webServersFor } from "@hussmartinez/sdk-config/testing/require-image";
import { endToEndTimeouts } from "@hussmartinez/sdk-config/testing/timeouts";
import { defineConfig, devices } from "@playwright/test";

const ci = Boolean(process.env["CI"]);
// Regenerating docs/capabilities.md needs every engine.
const allBrowsers = ci || Boolean(process.env["UPDATE_CAPABILITIES"]);

/**
 * End-to-end tests against the built Vite example: the browser capability
 * matrix that docs/adr/0001 relies on, and no request to another origin (ADR
 * 0012 in sdk-core). Chromium locally, all three engines in CI, as for the
 * other browser tests.
 */
export default defineConfig({
  testDir: "tests",
  // Only in the pinned test image or CI, never on a host, where browser
  // tests fail at random (sdk-core ADR 0049).
  globalSetup: "@hussmartinez/sdk-config/testing/require-image",
  // The family's limits (sdk-core ADR 0057). A test may wait up to 30 s
  // for its first render (timeouts.ts), within them.
  ...endToEndTimeouts,
  forbidOnly: ci,
  retries: 0,
  reporter: ci ? "line" : "list",
  globalTeardown: "./update-capabilities.ts",
  use: {
    baseURL: "http://localhost:4320",
    trace: "retain-on-failure",
    // In the image, the family's font rules (sdk-core ADR 0062), so text is
    // laid out as in the screenshots. The whole environment, never the one
    // variable: Playwright replaces the browser's.
    launchOptions: { env: fontLaunchEnv() },
  },
  projects: (
    [
      ["chromium", "Desktop Chrome"],
      ["firefox", "Desktop Firefox"],
      ["webkit", "Desktop Safari"],
    ] as const
  )
    .filter(([name]) => allBrowsers || name === "chromium")
    .map(([name, device]) => ({ name, use: { ...devices[device] } })),
  // Started with Node directly, as in the pinned browser image, where
  // hm-in-image runs the suite (sdk-core ADR 0049). Playwright starts it
  // before the global setup, so where the guard will refuse, as on a host,
  // sdk-config's webServersFor starts none, and the guard's explanation is
  // the first thing shown. In the image and in CI, it starts.
  webServer: webServersFor({
    command: "node node_modules/vite/bin/vite.js preview --port 4320 --strictPort",
    cwd: "../examples/vite",
    url: "http://localhost:4320",
    reuseExistingServer: !ci,
    timeout: 60_000,
  }),
});
