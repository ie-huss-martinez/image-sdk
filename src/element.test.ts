import { describe, expect, it, vi } from "vitest";

// Imports the whole element entry inside the test: under 1 s alone, past 5 s on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

describe("the element entry on a server (docs/adr/0007)", () => {
  it("does nothing on import, and can't define the element without custom elements", async () => {
    expect(globalThis.customElements).toBeUndefined();
    const { defineImageEditorElement } = await import("./element.js");
    expect(globalThis.customElements).toBeUndefined();
    expect(() => defineImageEditorElement()).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_ENVIRONMENT" }),
    );
  });
});
