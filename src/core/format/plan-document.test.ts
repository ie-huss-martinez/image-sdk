import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { plan, SIZE } from "../../../test/arbitraries/image-plan.js";
import { createPlan } from "../model/plan.js";
import { readImagePlanDocument, toImagePlanDocument } from "./plan-document.js";

describe("the hm-image-plan reader and writer (sdk-core ADR 0045)", () => {
  it("round-trips every plan the reducer can reach, through JSON text", () => {
    const sources = { s: { ...SIZE } };
    fc.assert(
      fc.property(plan, (state) => {
        const text = JSON.stringify(toImagePlanDocument(state, sources));
        const read = readImagePlanDocument(JSON.parse(text));
        expect(read.plan).toEqual(state);
        expect(read.sources).toEqual(sources);
      }),
    );
  });

  it("refuses to write a plan whose source it isn't given", () => {
    expect(() => toImagePlanDocument(createPlan("s"), { t: { ...SIZE } })).toThrow(TypeError);
  });
});
