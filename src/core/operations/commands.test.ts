import { applyCommands } from "@hussmartinez/sdk-core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planAndCommand, planAndCommands, reducer } from "../../../test/arbitraries/image-plan.js";
import { isImageError } from "../errors/image-error.js";
import { createPlan, MAX_PLAN_ITEMS } from "../model/plan.js";
import { MAX_METADATA_LENGTH } from "../model/source.js";
import type { ImageCommand } from "./commands.js";

function invalid(run: () => unknown): boolean {
  try {
    run();
  } catch (error) {
    return isImageError(error, "INVALID_COMMAND");
  }
  return false;
}

describe("the image reducer", () => {
  it("sets some develop values, and its inverse restores exactly those", () => {
    const start = createPlan("s");
    const { state, inverse } = reducer(start, {
      type: "image.setDevelop",
      values: { exposure: 40, contrast: -10 },
    });
    expect(state.base.develop).toMatchObject({ exposure: 40, contrast: -10, saturation: 0 });
    expect(inverse).toEqual({ type: "image.setDevelop", values: { exposure: 0, contrast: 0 } });
    expect(reducer(state, inverse).state).toEqual(start);
  });

  it("sets and removes a filter, and restores the absence of one", () => {
    const start = createPlan("s");
    const set = reducer(start, {
      type: "image.setFilter",
      filter: { preset: "noir", strength: 70 },
    });
    expect(set.inverse).toEqual({ type: "image.setFilter", filter: null });
    expect(reducer(set.state, set.inverse).state).toEqual(start);
    const removed = reducer(set.state, { type: "image.setFilter", filter: null });
    expect(removed.inverse).toEqual({
      type: "image.setFilter",
      filter: { preset: "noir", strength: 70 },
    });
  });

  it.each([
    ["a fractional value", { type: "image.setDevelop", values: { exposure: 1.5 } }],
    ["a value over 100", { type: "image.setDevelop", values: { contrast: 101 } }],
    ["a value under -100", { type: "image.setDevelop", values: { tint: -101 } }],
    ["an unknown adjustment", { type: "image.setDevelop", values: { clarity: 10 } }],
    ["a non-number", { type: "image.setDevelop", values: { exposure: "10" } }],
    ["an unknown preset", { type: "image.setFilter", filter: { preset: "lomo", strength: 50 } }],
    [
      "a fractional strength",
      { type: "image.setFilter", filter: { preset: "mono", strength: 0.5 } },
    ],
    ["a strength over 100", { type: "image.setFilter", filter: { preset: "mono", strength: 101 } }],
  ])("rejects %s with INVALID_COMMAND", (_, bad) => {
    expect(invalid(() => reducer(createPlan("s"), bad as ImageCommand))).toBe(true);
  });

  it("undoes any command with its inverse, back to the original plan", () => {
    fc.assert(
      fc.property(planAndCommand, ([before, edit]) => {
        const { state, inverse } = reducer(before, edit);
        expect(reducer(state, inverse).state).toEqual(before);
      }),
    );
  });

  it("undoes any sequence with its inverses, in the order applyCommands returns", () => {
    fc.assert(
      fc.property(planAndCommands, ([before, commands]) => {
        const { state, inverses } = applyCommands(reducer, before, commands);
        expect(applyCommands(reducer, state, inverses).state).toEqual(before);
      }),
    );
  });

  it("never changes the plan it's given", () => {
    fc.assert(
      fc.property(planAndCommand, ([before, edit]) => {
        const copy = structuredClone(before);
        reducer(before, edit);
        expect(before).toEqual(copy);
      }),
    );
  });

  it("produces structured-cloneable inverses", () => {
    fc.assert(
      fc.property(planAndCommand, ([before, edit]) => {
        const { inverse } = reducer(before, edit);
        expect(structuredClone(inverse)).toEqual(inverse);
      }),
    );
  });

  it.each([
    ["outside the source", { x: 30, y: 0, width: 11, height: 10 }],
    ["smaller than one pixel", { x: 0, y: 0, width: 0, height: 10 }],
    ["at a fractional position", { x: 0.5, y: 0, width: 10, height: 10 }],
    ["at a negative position", { x: -1, y: 0, width: 10, height: 10 }],
  ])("rejects a crop %s", (_, value) => {
    expect(invalid(() => reducer(createPlan("s"), { type: "image.setCrop", crop: value }))).toBe(
      true,
    );
  });

  it("rejects a crop of an unknown source", () => {
    expect(
      invalid(() =>
        reducer(createPlan("missing"), {
          type: "image.setCrop",
          crop: { x: 0, y: 0, width: 1, height: 1 },
        }),
      ),
    ).toBe(true);
  });

  it("rejects invalid orientations, outputs and metadata, without correcting them", () => {
    const base = createPlan("s");
    expect(
      invalid(() =>
        reducer(base, {
          type: "image.setOrientation",
          orientation: { rotate: 45, flipX: false, flipY: false } as never,
        }),
      ),
    ).toBe(true);
    expect(
      invalid(() =>
        reducer(base, { type: "image.setOutput", output: { kind: "scale", scale: 1.5 } }),
      ),
    ).toBe(true);
    expect(
      invalid(() =>
        reducer(base, { type: "image.setOutput", output: { kind: "scale", scale: 0 } }),
      ),
    ).toBe(true);
    expect(
      invalid(() =>
        reducer(base, { type: "image.setOutput", output: { kind: "fit", width: 0, height: 10 } }),
      ),
    ).toBe(true);
    expect(
      invalid(() =>
        reducer(base, {
          type: "image.setMetadata",
          field: "location" as never,
          value: "52.5,13.4",
        }),
      ),
    ).toBe(true);
    expect(
      invalid(() =>
        reducer(base, {
          type: "image.setMetadata",
          field: "title",
          value: "x".repeat(MAX_METADATA_LENGTH + 1),
        }),
      ),
    ).toBe(true);
    expect(invalid(() => reducer(base, { type: "image.unknown" } as never))).toBe(true);
  });

  describe("redactions (ADR 0010)", () => {
    const solid = { key: "a", mode: "solid", x: 1, y: 2, width: 3, height: 4, colour: "#000000" };
    const pixelate = { key: "b", mode: "pixelate", x: 5, y: 6, width: 7, height: 8 };
    const start = reducer(createPlan("s"), {
      type: "image.insertRedactions",
      at: 0,
      redactions: [solid, pixelate],
    } as ImageCommand).state;

    it("removes redactions, and its inverse puts each back where it was", () => {
      const { state, inverse } = reducer(start, { type: "image.removeRedactions", keys: ["a"] });
      expect(state.redactions).toEqual([pixelate]);
      expect(inverse).toEqual({
        type: "image.restoreRedactions",
        entries: [{ at: 0, redaction: solid }],
      });
      expect(reducer(state, inverse).state).toEqual(start);
    });

    it("moves redactions, and its inverse sets the whole previous order", () => {
      const { state, inverse } = reducer(start, {
        type: "image.moveRedactions",
        keys: ["a"],
        to: 1,
      });
      expect(state.redactions.map((r) => r.key)).toEqual(["b", "a"]);
      expect(inverse).toEqual({ type: "image.setRedactionOrder", keys: ["a", "b"] });
      expect(reducer(state, inverse).state).toEqual(start);
    });

    it("updates only the fields it's given, and its inverse restores exactly those", () => {
      const { state, inverse } = reducer(start, {
        type: "image.updateRedactions",
        updates: [{ key: "a", props: { x: 10, colour: "#ffffff" } }],
      });
      expect(state.redactions[0]).toEqual({ ...solid, x: 10, colour: "#ffffff" });
      expect(inverse).toEqual({
        type: "image.updateRedactions",
        updates: [{ key: "a", props: { x: 1, colour: "#000000" } }],
      });
    });

    it("drops the colour on a change to pixelate, and its inverse brings it back", () => {
      const { state, inverse } = reducer(start, {
        type: "image.updateRedactions",
        updates: [{ key: "a", props: { mode: "pixelate" } }],
      });
      expect(state.redactions[0]).toEqual({
        key: "a",
        mode: "pixelate",
        x: 1,
        y: 2,
        width: 3,
        height: 4,
      });
      expect(inverse).toEqual({
        type: "image.updateRedactions",
        updates: [{ key: "a", props: { mode: "solid", colour: "#000000" } }],
      });
      expect(reducer(state, inverse).state).toEqual(start);
    });

    it("takes a colour with a change to solid, and its inverse drops it again", () => {
      const { state, inverse } = reducer(start, {
        type: "image.updateRedactions",
        updates: [{ key: "b", props: { mode: "solid", colour: "#123456" } }],
      });
      expect(state.redactions[1]).toEqual({ ...pixelate, mode: "solid", colour: "#123456" });
      expect(inverse).toEqual({
        type: "image.updateRedactions",
        updates: [{ key: "b", props: { mode: "pixelate" } }],
      });
      expect(reducer(state, inverse).state).toEqual(start);
    });

    it("leaves the crop and orientation commands untouched by redactions, and the redactions by them", () => {
      // Redactions live in the scene, so a crop or a turn never rewrites one (ADR 0009).
      const cropped = reducer(start, {
        type: "image.setCrop",
        crop: { x: 10, y: 10, width: 5, height: 5 },
      });
      expect(cropped.state.redactions).toBe(start.redactions);
      expect(cropped.inverse).toEqual({ type: "image.setCrop", crop: null });
      const turned = reducer(start, {
        type: "image.setOrientation",
        orientation: { rotate: 90, flipX: true, flipY: false },
      });
      expect(turned.state.redactions).toBe(start.redactions);
    });

    it("holds at most MAX_PLAN_ITEMS redactions, and none whose key is taken", () => {
      const many = Array.from({ length: MAX_PLAN_ITEMS }, (_, index) => ({
        ...pixelate,
        key: `r${index}`,
      }));
      const full = reducer(createPlan("s"), {
        type: "image.insertRedactions",
        at: 0,
        redactions: many,
      } as ImageCommand).state;
      expect(full.redactions).toHaveLength(MAX_PLAN_ITEMS);
      expect(
        invalid(() =>
          reducer(full, {
            type: "image.insertRedactions",
            at: 0,
            redactions: [{ ...pixelate, key: "one-more" }],
          } as ImageCommand),
        ),
      ).toBe(true);
      expect(
        invalid(() =>
          reducer(start, {
            type: "image.insertRedactions",
            at: 0,
            redactions: [{ ...pixelate, key: "a" }],
          } as ImageCommand),
        ),
      ).toBe(true);
    });
  });
});
