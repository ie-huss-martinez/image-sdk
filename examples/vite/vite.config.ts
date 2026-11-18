import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * Serves the package's `dist/assets/` under `/image-sdk/`, as a host
 * self-hosting the render worker would (docs/adr/0002 in the package).
 */
function imageSdkAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve("@hussmartinez/image-sdk/package.json"));
  const worker = "image/render.worker.js";
  const job = "image/job.worker.js";
  return {
    name: "copy-image-sdk-assets",
    generateBundle() {
      const source = readFileSync(join(root, "dist/assets", worker));
      this.emitFile({ type: "asset", fileName: `image-sdk/${worker}`, source });
      // The job worker, which writes GIFs (docs/adr/0011 in the package).
      const jobSource = readFileSync(join(root, "dist/assets", job));
      this.emitFile({ type: "asset", fileName: `image-sdk/${job}`, source: jobSource });
      this.emitFile({ type: "asset", fileName: `image-sdk-failure/${job}`, source: jobSource });
      // An explicit test page uses the real worker plus a bounded crash hook;
      // the normal example and packaged SDK have no such handler.
      this.emitFile({
        type: "asset",
        fileName: `image-sdk-failure/${worker}`,
        source: `${source.toString()}\n${readFileSync(new URL("../../test/fixtures/worker-crash-hook.js", import.meta.url), "utf8")}`,
      });
    },
  };
}

export default defineConfig({
  plugins: [imageSdkAssets()],
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        index: "index.html",
        inline: "inline.html",
        strict: "strict.html",
        editor: "editor.html",
        element: "element.html",
      },
    },
  },
  worker: { format: "es" },
});
