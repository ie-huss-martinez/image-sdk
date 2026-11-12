import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isImageError } from "../errors/image-error.js";
import { createPlan, type ImagePlan } from "../model/plan.js";
import { MAX_METADATA_LENGTH } from "../model/source.js";
import { createImageReducer, type ImageCommand } from "./commands.js";
import { applyCommands } from "./reducer-types.js";

const SIZE = { width: 40, height: 30 };
const reducer = createImageReducer((id) => (id === "s" ? SIZE : undefined));

function invalid(run: () => unknown): boolean {
  try {
    run();
  } catch (error) {
    return isImageError(error, "INVALID_COMMAND");
  }
  return false;
}

const crop = fc.oneof(
  fc.constant(null),
  fc.record({ x: fc.nat(39), y: fc.nat(29) }).chain(({ x, y }) =>
    fc.record({
      x: fc.constant(x),
      y: fc.constant(y),
      width: fc.integer({ min: 1, max: SIZE.width - x }),
      height: fc.integer({ min: 1, max: SIZE.height - y }),
    }),
  ),
);
const orientation = fc.record({
  rotate: fc.constantFrom(0 as const, 90 as const, 180 as const, 270 as const),
  flipX: fc.boolean(),
  flipY: fc.boolean(),
});
const output = fc.oneof(
  fc.record({
    kind: fc.constant("scale" as const),
    scale: fc.double({ min: 0.01, max: 1, noNaN: true }),
  }),
  fc.record({
    kind: fc.constant("fit" as const),
    width: fc.integer({ min: 1, max: 10_000 }),
    height: fc.integer({ min: 1, max: 10_000 }),
  }),
);
const field = fc.constantFrom(
  "title" as const,
  "description" as const,
  "artist" as const,
  "copyright" as const,
);

/** Any valid command of the four base types. */
const command: fc.Arbitrary<ImageCommand> = fc.oneof(
  crop.map((value) => ({ type: "image.setCrop" as const, crop: value })),
  orientation.map((value) => ({ type: "image.setOrientation" as const, orientation: value })),
  output.map((value) => ({ type: "image.setOutput" as const, output: value })),
  fc
    .record({ field, value: fc.string({ maxLength: 40 }) })
    .map(({ field, value }) => ({ type: "image.setMetadata" as const, field, value })),
);

/** A plan reached by applying valid commands to a new one. */
const plan: fc.Arbitrary<ImagePlan> = fc
  .array(command, { maxLength: 6 })
  .map((commands) => applyCommands(reducer, createPlan("s"), commands).state);

describe("the image reducer", () => {
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
