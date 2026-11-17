import { describe, expect, it } from "vitest";
import { type ImageError, isImageError } from "../errors/image-error.js";
import { createPlan, type ImagePlan } from "../model/plan.js";
import { checkPlanSupport, type ImagePlanPart } from "./plan-support.js";

const plan = createPlan("s");
const redacted: ImagePlan = {
  ...plan,
  redactions: [{ key: "r", mode: "pixelate", x: 0, y: 0, width: 1, height: 1 }],
};

/** The part a plan is refused for. */
function refusedFor(value: unknown, supported: readonly ImagePlanPart[]): unknown {
  try {
    checkPlanSupport(value as ImagePlan, supported);
  } catch (error) {
    expect(isImageError(error, "UNSUPPORTED_PLAN")).toBe(true);
    return (error as ImageError).details?.["reason"];
  }
  return undefined;
}

describe("checkPlanSupport (ADR 0009)", () => {
  it("accepts a plan with only a base, whatever the renderer draws", () => {
    expect(refusedFor(plan, [])).toBeUndefined();
    expect(refusedFor(plan, ["layers", "redactions", "animation"])).toBeUndefined();
  });

  it("refuses redactions a renderer doesn't draw, and accepts them where it does", () => {
    expect(refusedFor(redacted, [])).toBe("redactions");
    expect(refusedFor(redacted, ["layers"])).toBe("redactions");
    expect(refusedFor(redacted, ["redactions"])).toBeUndefined();
  });

  it("refuses layers the types don't allow, and an animation a renderer of stills doesn't play", () => {
    expect(refusedFor({ ...plan, layers: [{ key: "t" }] }, ["redactions"])).toBe("layers");
    expect(refusedFor({ ...plan, animation: { frames: [] } }, ["redactions"])).toBe("animation");
    // A real animation, from format version 4 (docs/adr/0011).
    const animated = {
      ...plan,
      animation: { loop: 0, frames: [{ key: "f", frame: 1, delay: 10 }] },
    };
    expect(refusedFor(animated, ["layers", "drawings", "redactions"])).toBe("animation");
    expect(refusedFor(animated, ["animation"])).toBeUndefined();
  });

  it("refuses a drawing or an arrow a renderer of the other layers doesn't draw", () => {
    const common = { name: "", visible: true, opacity: 100 };
    const drawn: ImagePlan = {
      ...plan,
      layers: [
        {
          ...common,
          key: "d",
          kind: "drawing",
          x: 0,
          y: 0,
          strokes: [{ colour: "#000000", width: 1, runs: [[0, 0]] }],
        },
      ],
    };
    const aimed: ImagePlan = {
      ...plan,
      layers: [
        {
          ...common,
          key: "a",
          kind: "arrow",
          from: { x: 0, y: 0 },
          to: { x: 1, y: 1 },
          colour: "#000000",
          width: 1,
        },
      ],
    };
    for (const value of [drawn, aimed]) {
      // Even hidden, it's refused: nothing is exported without a part of its plan.
      expect(refusedFor(value, ["layers", "redactions"])).toBe("drawings");
      expect(refusedFor(value, ["drawings"])).toBe("layers");
      expect(refusedFor(value, ["layers", "drawings"])).toBeUndefined();
    }
    // A plan of the other kinds needs no "drawings".
    expect(
      refusedFor(
        {
          ...plan,
          layers: [{ key: "t", kind: "text" }],
        },
        ["layers"],
      ),
    ).toBeUndefined();
  });

  it("refuses a plan whose lists are missing or aren't lists, never reading them as empty", () => {
    const { redactions: _redactions, ...without } = plan;
    expect(refusedFor(without, [])).toBe("redactions");
    expect(refusedFor({ ...plan, layers: null }, [])).toBe("layers");
    expect(refusedFor({ ...plan, animation: undefined }, [])).toBe("animation");
  });
});
