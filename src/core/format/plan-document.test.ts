import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { plan, SIZE } from "../../../test/arbitraries/image-plan.js";
import { type ImageError, isImageError } from "../errors/image-error.js";
import { createPlan } from "../model/plan.js";
import { readImagePlanDocument, toImagePlanDocument } from "./plan-document.js";

/** The sources as a document before version 4 had them: sizes, with no frame counts. */
const OLDER_SOURCES = { s: { width: SIZE.width, height: SIZE.height } };

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

  it("reads version 1 as a plan with no layers, redactions or animation, and writes version 4", () => {
    const sources = { s: { ...SIZE } };
    fc.assert(
      fc.property(plan, (state) => {
        const {
          layers: _layers,
          redactions: _redactions,
          animation: _animation,
          ...fields
        } = toImagePlanDocument(state, sources);
        const read = readImagePlanDocument(
          JSON.parse(JSON.stringify({ ...fields, sources: OLDER_SOURCES, version: 1 })),
        );
        expect(read.plan).toEqual({ ...state, layers: [], redactions: [], animation: null });
        // Every source of an earlier version is a still.
        expect(read.sources).toEqual({ s: { ...OLDER_SOURCES.s, frames: 1 } });
        expect(toImagePlanDocument(read.plan, read.sources).version).toBe(4);
      }),
    );
  });

  it("reads version 3 as a still, and refuses in it what version 4 added", () => {
    const still = toImagePlanDocument(createPlan("s"), { s: { ...SIZE } });
    const three = { ...still, sources: OLDER_SOURCES, version: 3 };
    const read = readImagePlanDocument(three);
    expect(read.plan).toEqual(createPlan("s"));
    expect(read.sources).toEqual({ s: { ...OLDER_SOURCES.s, frames: 1 } });
    // A frame count, or an animation, in a version that had neither.
    const animation = { loop: 0, frames: [{ key: "f", frame: 0, delay: 1 }] };
    for (const later of [
      { ...three, sources: still.sources },
      { ...three, animation },
    ]) {
      const refused = rejection(() => readImagePlanDocument(later));
      expect(isImageError(refused, "INVALID_DOCUMENT")).toBe(true);
      expect(refused.details).toMatchObject({ reason: "malformed-document" });
    }
    // And version 4 needs the count.
    const missing = rejection(() => readImagePlanDocument({ ...still, sources: OLDER_SOURCES }));
    expect(missing.details).toMatchObject({ reason: "malformed-document" });
  });

  it("reads an animation whose frames the source has, and refuses one it doesn't", () => {
    const sources = { s: { ...SIZE } };
    const animation = {
      loop: null,
      frames: [
        { key: "a", frame: 4, delay: 0 },
        { key: "b", frame: 0, delay: 65_535 },
        { key: "c", frame: 4, delay: 3 },
      ],
    };
    const written = toImagePlanDocument({ ...createPlan("s"), animation }, sources);
    expect(written.animation).toEqual(animation);
    // A copy: changing the document doesn't change the plan.
    expect(written.animation).not.toBe(animation);
    expect(written.animation?.frames[0]).not.toBe(animation.frames[0]);
    expect(readImagePlanDocument(JSON.parse(JSON.stringify(written))).plan.animation).toEqual(
      animation,
    );
    const reason = (changed: unknown, source: object = SIZE) =>
      rejection(() =>
        readImagePlanDocument({ ...written, sources: { s: source }, animation: changed }),
      ).details?.["reason"];
    expect(reason({ ...animation, frames: [{ key: "a", frame: 5, delay: 0 }] })).toBe(
      "invalid-frame",
    );
    expect(reason({ ...animation, frames: [{ key: "a", frame: 0, delay: 65_536 }] })).toBe(
      "invalid-delay",
    );
    expect(reason({ ...animation, loop: 65_536 })).toBe("invalid-loop");
    expect(reason({ ...animation, frames: [] })).toBe("malformed-document");
    expect(reason({ ...animation, frames: [animation.frames[0], animation.frames[0]] })).toBe(
      "duplicate-key",
    );
    // A source with one frame is a still: it has no animation.
    expect(reason(animation, { ...SIZE, frames: 1 })).toBe("not-animated");
    // The animation of one source isn't checked against another's frames.
    expect(reason(animation, { ...SIZE, frames: 4 })).toBe("invalid-frame");
  });

  it("refuses a later version as unsupported, and a version 1 document with later fields as invalid", () => {
    const document = toImagePlanDocument(createPlan("s"), { s: { ...SIZE } });
    const later = rejection(() => readImagePlanDocument({ ...document, version: 5 }));
    expect(isImageError(later, "UNSUPPORTED_FORMAT")).toBe(true);
    expect(later.details).toMatchObject({ reason: "unknown-format-version" });
    const mixed = rejection(() =>
      readImagePlanDocument({ ...document, sources: OLDER_SOURCES, version: 1 }),
    );
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
    expect(written.version).toBe(4);
    // The same document as version 2, which had no frame counts, reads to the same plan.
    const asTwo = readImagePlanDocument({ ...written, sources: OLDER_SOURCES, version: 2 });
    expect(asTwo.plan.layers).toEqual([text]);
    // A drawing or an arrow in version 2, which has neither, is refused, not read.
    for (const layer of [arrow, drawing]) {
      const withLater = { ...written, layers: [layer] };
      expect(readImagePlanDocument(withLater).plan.layers).toEqual([layer]);
      const refused = rejection(() =>
        readImagePlanDocument({ ...withLater, sources: OLDER_SOURCES, version: 2 }),
      );
      expect(isImageError(refused, "INVALID_DOCUMENT")).toBe(true);
      expect(refused.details).toMatchObject({ reason: "unknown-layer-kind" });
    }
  });

  it("refuses to write a plan whose source it isn't given", () => {
    expect(() => toImagePlanDocument(createPlan("s"), { t: { ...SIZE } })).toThrow(TypeError);
  });
});
