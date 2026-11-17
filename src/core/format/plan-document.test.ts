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

  it("reads version 1 as a plan with no layers, redactions or animation, and writes version 3", () => {
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
        expect(toImagePlanDocument(read.plan, read.sources).version).toBe(3);
      }),
    );
  });

  it("refuses a later version as unsupported, and a version 1 document with later fields as invalid", () => {
    const document = toImagePlanDocument(createPlan("s"), { s: { ...SIZE } });
    const later = rejection(() => readImagePlanDocument({ ...document, version: 4 }));
    expect(isImageError(later, "UNSUPPORTED_FORMAT")).toBe(true);
    expect(later.details).toMatchObject({ reason: "unknown-format-version" });
    const mixed = rejection(() => readImagePlanDocument({ ...document, version: 1 }));
    expect(isImageError(mixed, "INVALID_DOCUMENT")).toBe(true);
    expect(mixed.details).toMatchObject({ reason: "malformed-document" });
  });

  it("reads version 2 as it is, with its own kinds of layer, and no later version's", () => {
    const sources = { s: { ...SIZE } };
    const text = {
      key: "t",
      kind: "text",
      name: "",
      visible: true,
      opacity: 100,
      x: 1,
      y: 2,
      width: 10,
      height: 5,
      rotation: 0,
      flipX: false,
      text: "Hi",
      font: "serif",
      bold: false,
      colour: "#000000",
      align: "start",
    } as const;
    const arrow = {
      key: "a",
      kind: "arrow",
      name: "",
      visible: true,
      opacity: 100,
      from: { x: 0, y: 0 },
      to: { x: 5, y: 5 },
      colour: "#ff0000",
      width: 2,
    } as const;
    const drawing = {
      key: "d",
      kind: "drawing",
      name: "",
      visible: true,
      opacity: 100,
      x: 0,
      y: 0,
      strokes: [{ colour: "#000000", width: 2, runs: [[0, 0, 4, 4]] }],
    } as const;
    const written = toImagePlanDocument({ ...createPlan("s"), layers: [text] }, sources);
    expect(written.version).toBe(3);
    // The same document as version 2 reads to the same plan: only the version differs.
    const asTwo = readImagePlanDocument({ ...written, version: 2 });
    expect(asTwo.plan.layers).toEqual([text]);
    // A drawing or an arrow in version 2, which has neither, is refused, not read.
    for (const layer of [arrow, drawing]) {
      const withLater = { ...written, layers: [layer] };
      expect(readImagePlanDocument(withLater).plan.layers).toEqual([layer]);
      const refused = rejection(() => readImagePlanDocument({ ...withLater, version: 2 }));
      expect(isImageError(refused, "INVALID_DOCUMENT")).toBe(true);
      expect(refused.details).toMatchObject({ reason: "unknown-layer-kind" });
    }
  });

  it("refuses to write a plan whose source it isn't given", () => {
    expect(() => toImagePlanDocument(createPlan("s"), { t: { ...SIZE } })).toThrow(TypeError);
  });
});
