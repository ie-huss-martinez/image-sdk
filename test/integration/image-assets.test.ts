import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createImageEngine } from "../../src/adapters/image-engine.js";
import { ImageEditor } from "../../src/react/editor/ImageEditor.js";

const bases = ["/image-sdk/", "assets/image-sdk", "https://app.example.com/image-sdk/"];
const invalid = [
  "https://[bad",
  "/image-sdk/?v=1",
  "assets/#worker",
  "https://app.example.com/?v=1",
];

describe("assetsUrl on a server (sdk-core ADR 0038)", () => {
  it.each(bases)(
    "constructs and destroys an engine with %s without browser globals",
    async (assetsUrl) => {
      expect(globalThis).not.toHaveProperty("Worker");
      expect(globalThis).not.toHaveProperty("location");
      const engine = createImageEngine({ assetsUrl });
      await engine.destroy();
    },
  );

  it.each(bases)("renders ImageEditor with %s without creating a worker", (assetsUrl) => {
    expect(globalThis).not.toHaveProperty("Worker");
    expect(globalThis).not.toHaveProperty("location");
    const html = renderToString(createElement(ImageEditor, { assetsUrl }));
    expect(html).toContain("Choose an image");
    expect(html).not.toContain("<canvas");
  });

  it.each(invalid)("rejects invalid %s synchronously at setup", (assetsUrl) => {
    expect(() => createImageEngine({ assetsUrl })).toThrow(TypeError);
  });
});
