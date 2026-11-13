import { applyCommands } from "@hussmartinez/sdk-core";
import fc from "fast-check";
import {
  createPlan,
  DEVELOP_ADJUSTMENTS,
  FILTER_PRESETS,
  type ImagePlan,
} from "../../src/core/model/plan.js";
import { createImageReducer, type ImageCommand } from "../../src/core/operations/commands.js";

/**
 * The plan reducer's property-test generators, shared by its tests and the
 * conformance vectors' generator (sdk-core ADR 0045): valid commands, and
 * plans reached by applying them to a new plan of source `s`.
 */

/** The oriented size of source `s`. */
export const SIZE = { width: 40, height: 30 };
export const reducer = createImageReducer((id) => (id === "s" ? SIZE : undefined));

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

const level = fc.integer({ min: -100, max: 100 });
const developValues = fc.record(
  Object.fromEntries(DEVELOP_ADJUSTMENTS.map((name) => [name, level])) as Record<
    (typeof DEVELOP_ADJUSTMENTS)[number],
    typeof level
  >,
  { requiredKeys: [] },
);
const filter = fc.option(
  fc.record({
    preset: fc.constantFrom(...FILTER_PRESETS),
    strength: fc.integer({ min: 0, max: 100 }),
  }),
  { nil: null },
);

/** Any valid command. */
export const command: fc.Arbitrary<ImageCommand> = fc.oneof(
  developValues.map((values) => ({ type: "image.setDevelop" as const, values })),
  filter.map((value) => ({ type: "image.setFilter" as const, filter: value })),
  crop.map((value) => ({ type: "image.setCrop" as const, crop: value })),
  orientation.map((value) => ({ type: "image.setOrientation" as const, orientation: value })),
  output.map((value) => ({ type: "image.setOutput" as const, output: value })),
  fc
    .record({ field, value: fc.string({ maxLength: 40 }) })
    .map(({ field, value }) => ({ type: "image.setMetadata" as const, field, value })),
);

/** A plan reached by applying valid commands to a new one. */
export const plan: fc.Arbitrary<ImagePlan> = fc
  .array(command, { maxLength: 6 })
  .map((commands) => applyCommands(reducer, createPlan("s"), commands).state);

/**
 * A value with one field replaced by any JSON value, or one added, as an own
 * property even when it's named `__proto__`, as JSON.parse makes it. Assigning
 * `copy.__proto__ = …` would set the prototype instead, and test nothing
 * (sdk-core ADR 0045, section 8).
 */
export const mutated = <T extends object>(value: fc.Arbitrary<T>) =>
  fc
    .tuple(value, fc.nat(), fc.string(), fc.jsonValue({ maxDepth: 2 }), fc.boolean())
    .map(([original, index, name, replacement, add]) => {
      const copy: Record<string, unknown> = JSON.parse(JSON.stringify(original));
      const fields = Object.keys(copy);
      const field = add || fields.length === 0 ? name : (fields[index % fields.length] as string);
      Object.defineProperty(copy, field, {
        value: replacement,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      return copy;
    });
