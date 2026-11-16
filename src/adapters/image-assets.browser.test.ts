import { describe, expect, it, vi } from "vitest";
import { createImageEngine } from "./image-engine.js";

async function photo(): Promise<Blob> {
  const canvas = new OffscreenCanvas(4, 2);
  canvas.getContext("2d")?.fillRect(0, 0, 4, 2);
  return canvas.convertToBlob();
}

describe("asset URLs when a worker starts (sdk-core ADR 0038)", () => {
  it.each(["root-relative", "directory-relative", "absolute"])(
    "decodes with a %s base resolved on first use",
    async (kind) => {
      const original = location.href;
      const base =
        kind === "absolute"
          ? new URL("/hm-test-assets/", original).href
          : kind === "root-relative"
            ? "/hm-test-assets/"
            : "../hm-test-assets/";
      // A later page URL must be used for the relative base. Resolving at
      // construction would request /before/hm-test-assets/ instead.
      history.replaceState(null, "", "/before/nested/editor.html");
      const workers = vi.spyOn(globalThis, "Worker");
      const engine = createImageEngine({ assetsUrl: base });
      try {
        expect(workers).not.toHaveBeenCalled();
        history.replaceState(null, "", "/nested/editor.html");
        const file = await photo();
        const source = await engine.register("a", file, await engine.probe(file));
        expect([source.width, source.height]).toEqual([4, 2]);
        expect(workers).toHaveBeenCalledExactlyOnceWith(
          new URL("/hm-test-assets/image/render.worker.js", original).href,
          { type: "module", name: "hm-image-render" },
        );
      } finally {
        await engine.destroy();
        workers.mockRestore();
        history.replaceState(null, "", original);
      }
    },
  );

  it.each(["https://[bad", "/image-sdk/?v=1", "assets/#worker", "https://app.example.com/?v=1"])(
    "rejects invalid %s before starting a worker",
    (assetsUrl) => {
      const workers = vi.spyOn(globalThis, "Worker");
      try {
        expect(() => createImageEngine({ assetsUrl })).toThrow(TypeError);
        expect(workers).not.toHaveBeenCalled();
      } finally {
        workers.mockRestore();
      }
    },
  );

  it("still decodes with the default inline worker", async () => {
    const engine = createImageEngine();
    try {
      const file = await photo();
      const source = await engine.register("a", file, await engine.probe(file));
      expect([source.width, source.height]).toEqual([4, 2]);
    } finally {
      await engine.destroy();
    }
  });
});
