import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { plan, SIZE } from "../../../test/arbitraries/image-plan.js";
import { type ImageError, isImageError } from "../errors/image-error.js";
import { createPlan } from "../model/plan.js";
import { readImagePlanDocument, toImagePlanDocument } from "./plan-document.js";

function rejection(run: () => unknown): ImageError {
  try {
    run();
  } catch (error) {
    return error as ImageError;
  }
  throw new Error("expected a rejection");
}

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

  it("reads version 1 as a plan with no layers, redactions or animation, and writes version 2", () => {
    const sources = { s: { ...SIZE } };
    fc.assert(
      fc.property(plan, (state) => {
        const {
          layers: _layers,
          redactions: _redactions,
          animation: _animation,
          ...fields
        } = toImagePlanDocument(state, sources);
        const read = readImagePlanDocument(JSON.parse(JSON.stringify({ ...fields, version: 1 })));
        expect(read.plan).toEqual({ ...state, layers: [], redactions: [], animation: null });
        expect(toImagePlanDocument(read.plan, read.sources).version).toBe(2);
      }),
    );
  });

  it("refuses a later version as unsupported, and a version 1 document with later fields as invalid", () => {
    const document = toImagePlanDocument(createPlan("s"), { s: { ...SIZE } });
    const later = rejection(() => readImagePlanDocument({ ...document, version: 3 }));
    expect(isImageError(later, "UNSUPPORTED_FORMAT")).toBe(true);
    expect(later.details).toMatchObject({ reason: "unknown-format-version" });
    const mixed = rejection(() => readImagePlanDocument({ ...document, version: 1 }));
    expect(isImageError(mixed, "INVALID_DOCUMENT")).toBe(true);
    expect(mixed.details).toMatchObject({ reason: "malformed-document" });
  });

  it("refuses to write a plan whose source it isn't given", () => {
    expect(() => toImagePlanDocument(createPlan("s"), { t: { ...SIZE } })).toThrow(TypeError);
  });
});
