import { describe, expectTypeOf, it } from "vitest";
import type { ImageEditorHandle } from "../editor/types.js";
import type { ImageEditorElementMethods } from "./mount.js";

describe("the element's methods", () => {
  // Checked by the type checker (pnpm typecheck): the element declares its
  // methods itself, so its API copies no type of the React entry (sdk-core
  // ADR 0033), and this keeps them the handle's.
  it("are the React editor's handle without its session", () => {
    expectTypeOf<ImageEditorElementMethods>().toEqualTypeOf<Omit<ImageEditorHandle, "session">>();
  });
});
