import { fileURLToPath } from "node:url";
import { browserInstances } from "@hussmartinez/sdk-config/testing/browser-instances";
import { browserTimeouts, unitTimeouts } from "@hussmartinez/sdk-config/testing/timeouts";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { testAssets, versionDefine } from "./tools/self-hosted-worker.js";
import { selfHostedImports } from "./vite.config.js";

const ALL_BROWSERS = ["chromium", "firefox", "webkit"] as const;

/**
 * The tests run the source: package.json's imports name the built files
 * (sdk-core ADR 0060), so each one points at its module here.
 */
const selfHostedAliases = {
  alias: Object.entries(selfHostedImports).map(([find, path]) => ({
    find,
    replacement: fileURLToPath(new URL(path, import.meta.url)),
  })),
};

// Browser tests run on Chromium locally, and on all three engines in CI or
// with --mode all-browsers (ADR 0015).
export default defineConfig(({ mode }) => {
  const browsers =
    process.env["CI"] || mode === "all-browsers" ? ALL_BROWSERS : (["chromium"] as const);
  return {
    test: {
      projects: [
        {
          define: versionDefine(),
          resolve: selfHostedAliases,
          test: {
            name: "unit",
            // The family's limits (sdk-core ADR 0057): only a hang fails, not a busy machine.
            ...unitTimeouts,
            // build.test.ts checks the built package, so it sits next to the
            // Vite config rather than in src/. test/ holds the repository's
            // own checks, such as the CI image.
            include: ["src/**/*.test.{ts,tsx}", "*.test.ts", "test/**/*.test.ts"],
            exclude: ["**/*.browser.test.{ts,tsx}"],
            environment: "node",
          },
        },
        {
          define: versionDefine(),
          resolve: selfHostedAliases,
          // Serves the self-hosted worker as the build writes it (docs/adr/0002).
          plugins: [testAssets()],
          // Pre-bundled up front: found mid-run, Vite reloads the page under a
          // running test, as the element's tests showed on a cold cache.
          optimizeDeps: { include: ["@hussmartinez/sdk-core/element"] },
          test: {
            name: "browser",
            // Browser tests start only in the pinned test image or CI, never
            // on a host, where they fail at random (sdk-core ADR 0049).
            globalSetup: ["@hussmartinez/sdk-config/testing/require-image"],
            // The family's guard against a crash in Playwright's Firefox when
            // userEvent and axe both read ariaLabelledByElements (ui#61).
            setupFiles: ["@hussmartinez/sdk-config/testing/firefox-labelled-by/setup"],
            // The family's limits (sdk-core ADR 0057). A test may wait up to
            // 30 s for its first open (test/browser/timeouts.ts), within them.
            ...browserTimeouts,
            include: ["src/**/*.browser.test.{ts,tsx}", "test/**/*.browser.test.ts"],
            browser: {
              enabled: true,
              headless: true,
              provider: playwright(),
              // In the image, every browser launches with the family's font
              // rules (sdk-core ADR 0062), so text is drawn as in the
              // screenshots. With HM_BROWSER_DIAGNOSTICS set to a folder,
              // Chromium writes a net log there (sdk-config).
              instances: browserInstances(browsers),
            },
          },
        },
      ],
    },
  };
});
