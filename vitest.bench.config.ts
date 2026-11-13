import { defineConfig } from "vitest/config";

// `pnpm bench`: timings of the pixel code (docs/adr/0006), in Node, which
// runs V8 as Chromium does. Never run in CI: timings depend on the machine.
export default defineConfig({
  test: { environment: "node", include: ["test/bench/**/*.bench.ts"], testTimeout: 300_000 },
});
