import { applyCommands } from "@hussmartinez/sdk-core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { command, plan, reducer } from "../../../test/arbitraries/image-plan.js";
import { isImageError } from "../errors/image-error.js";
import { createPlan } from "../model/plan.js";
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
      fc.property(plan, command, (before, edit) => {
        const { state, inverse } = reducer(before, edit);
        expect(reducer(state, inverse).state).toEqual(before);
      }),
    );
  });

  it("undoes any sequence with its inverses, in the order applyCommands returns", () => {
    fc.assert(
      fc.property(plan, fc.array(command, { maxLength: 8 }), (before, commands) => {
        const { state, inverses } = applyCommands(reducer, before, commands);
        expect(applyCommands(reducer, state, inverses).state).toEqual(before);
      }),
    );
  });

  it("never changes the plan it's given", () => {
    fc.assert(
      fc.property(plan, command, (before, edit) => {
        const copy = structuredClone(before);
        reducer(before, edit);
        expect(before).toEqual(copy);
      }),
    );
  });

  it("produces structured-cloneable inverses", () => {
    fc.assert(
      fc.property(plan, command, (before, edit) => {
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
});
