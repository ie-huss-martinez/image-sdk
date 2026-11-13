import { describe, expect, it } from "vitest";
import { turned } from "./orientation-tools.js";

describe("turning what's on screen (docs/adr/0007)", () => {
  it("turns the rotation the same way when nothing is flipped, or both are", () => {
    expect(turned({ rotate: 0, flipX: false, flipY: false }, "right").rotate).toBe(90);
    expect(turned({ rotate: 0, flipX: false, flipY: false }, "left").rotate).toBe(270);
    expect(turned({ rotate: 90, flipX: true, flipY: true }, "right").rotate).toBe(180);
  });

  it("turns the rotation the other way under exactly one flip, because flips come after it", () => {
    expect(turned({ rotate: 0, flipX: true, flipY: false }, "right")).toEqual({
      rotate: 270,
      flipX: true,
      flipY: false,
    });
    expect(turned({ rotate: 270, flipX: false, flipY: true }, "left").rotate).toBe(0);
  });
});
