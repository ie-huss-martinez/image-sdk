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
  return {
    name: "copy-image-sdk-assets",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: `image-sdk/${worker}`,
        source: readFileSync(join(root, "dist/assets", worker)),
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
