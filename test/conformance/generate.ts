import type {
  ConformanceCase,
  ConformanceFile,
} from "@hussmartinez/sdk-config/testing/conformance";
import fc from "fast-check";
import { type ImagePlan, NEUTRAL_DEVELOP, toImagePlanDocument } from "../../src/index.js";
import { command, mutated, plan as planArb, SIZE } from "../arbitraries/image-plan.js";
import { applyToDocument, GEOMETRY_OPERATIONS, geometry, readAndWrite } from "./run.js";

/**
 * Writes the conformance cases (sdk-core ADR 0045): hand-written cases for
 * every outcome a port must reproduce, and cases generated from the
 * reducer's property-test generators with a fixed seed. The files in
 * conformance/ are this module's output, checked in; `pnpm conformance:update`
 * rewrites them, and the tests fail when they're out of date.
 */

/** The seed of the generated cases. Changing it, or fast-check's version, rewrites them. */
const SEED = 45;
/** How many generated commands that apply, and of each refusal, the file keeps. */
const GENERATED_APPLIED = 60;
const GENERATED_PER_REFUSAL = 2;
/** How many generated documents the plan file keeps. */
const GENERATED_PLANS = 20;

/** Source `s` as the generators know it, and a second, larger one. */
const sources = { s: { ...SIZE }, t: { width: 4_000, height: 3_000 } };

/** The value as JSON carries it: what a port reads from the file. */
const asJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** A plan with every part set: a crop, a turn and a flip, develop, a filter, a size and a title. */
const EDITED: ImagePlan = {
  base: {
    source: "s",
    crop: { x: 2, y: 3, width: 20, height: 10 },
    orientation: { rotate: 90, flipX: true, flipY: false },
    develop: { ...NEUTRAL_DEVELOP, exposure: 20, contrast: -15 },
    filter: { preset: "sepia", strength: 60 },
  },
  output: { kind: "scale", scale: 0.5 },
  metadata: { title: "Harbour at dusk", description: "", artist: "", copyright: "" },
};
const BASE = toImagePlanDocument(EDITED, sources);

/**
 * A plan whose source ids are the names of `Object.prototype`'s properties,
 * built from JSON text, so `__proto__` is an own field as any JSON parser
 * makes it. Readers that keep ids in plain objects, in any language, must
 * still treat them as data. Each source has its own size, so a crop shows
 * which one a reader looked up.
 */
const PROTOTYPE_NAMED = JSON.parse(
  JSON.stringify({
    ...BASE,
    sources: {
      PROTO: { width: 10, height: 8 },
      constructor: { width: 20, height: 16 },
      toString: { width: 30, height: 24 },
    },
    base: { ...BASE.base, source: "PROTO", crop: null },
  }).replaceAll('"PROTO"', '"__proto__"'),
) as typeof BASE;

type Outcome = { readonly ok: true } | { readonly code: string; readonly reason: string };

/**
 * A case whose expected result is what the runner gives. For a hand-written
 * case, `outcome` is what the case is meant to show, and a runner that
 * disagrees fails here, before any file is written.
 */
function make(
  name: string,
  input: unknown,
  run: (input: never) => unknown,
  outcome?: Outcome,
): ConformanceCase {
  const json = asJson(input);
  let expected: unknown;
  try {
    expected = asJson(run(json as never));
  } catch (error) {
    const { code, details } = error as { code?: string; details?: { reason?: string } };
    if (typeof code !== "string" || typeof details?.reason !== "string") throw error;
    expected = { error: { code, reason: details.reason } };
  }
  if (outcome) {
    const got = (expected as { error?: Outcome }).error ?? { ok: true };
    if (JSON.stringify(got) !== JSON.stringify(outcome)) {
      throw new Error(
        `Case "${name}" gave ${JSON.stringify(got)}, not ${JSON.stringify(outcome)}.`,
      );
    }
  }
  return { name, input: json, expected };
}

const applied: Outcome = { ok: true };
const refused = (reason: string, code = "INVALID_COMMAND"): Outcome => ({ code, reason });

/** Any command, with one field replaced or added, at its top or one level in. */
const mutatedCommand = fc.oneof(
  mutated(command),
  command.chain((valid) => {
    const [field, value] = Object.entries(valid)[1] ?? [];
    if (field === undefined || typeof value !== "object" || value === null) {
      return fc.constant(valid as unknown);
    }
    return mutated(fc.constant(value)).map((inner) => ({ ...valid, [field]: inner }));
  }),
);

/** `hm-image-commands`: a user-level command applied to a plan document. */
export function commandCases(): ConformanceFile {
  const on = (cmd: unknown) => ({ plan: BASE, command: cmd });
  const onNamed = (cmd: unknown) => ({ plan: PROTOTYPE_NAMED, command: cmd });
  const crop = (x: number, y: number, width: number, height: number) => ({
    type: "image.setCrop",
    crop: { x, y, width, height },
  });
  const orient = (rotate: unknown, flipX: unknown = false, flipY: unknown = false) => ({
    type: "image.setOrientation",
    orientation: { rotate, flipX, flipY },
  });
  const output = (value: unknown) => ({ type: "image.setOutput", output: value });
  const develop = (values: unknown) => ({ type: "image.setDevelop", values });
  const filter = (value: unknown) => ({ type: "image.setFilter", filter: value });
  const metadata = (field: unknown, value: unknown) => ({
    type: "image.setMetadata",
    field,
    value,
  });
  // `__proto__` as an own key of a command's values, as JSON.parse makes it.
  const protoValues = JSON.parse('{"__proto__": 10}') as unknown;

  const handWritten: [string, unknown, Outcome][] = [
    ["sets a crop", on(crop(0, 0, 40, 30)), applied],
    ["removes the crop", on({ type: "image.setCrop", crop: null }), applied],
    ["sets a crop of one pixel in the far corner", on(crop(39, 29, 1, 1)), applied],
    ["turns and flips", on(orient(270, false, true)), applied],
    [
      "sets a fractional scale, which compares exactly",
      on(output({ kind: "scale", scale: 0.1 })),
      applied,
    ],
    ["sets a box to fit", on(output({ kind: "fit", width: 1_920, height: 1_080 })), applied],
    ["sets a kept field", on(metadata("artist", "Ana Pérez 📷")), applied],
    ["clears a kept field", on(metadata("title", "")), applied],
    ["sets some develop adjustments", on(develop({ shadows: 35, vibrance: -100 })), applied],
    ["sets no develop adjustments, changing nothing", on(develop({})), applied],
    ["sets a filter", on(filter({ preset: "noir", strength: 0 })), applied],
    ["removes the filter", on(filter(null)), applied],
    ["crops a source keyed __proto__ by its own size", onNamed(crop(0, 0, 10, 8)), applied],
    [
      "refuses a crop past the size of the source keyed __proto__",
      onNamed(crop(0, 0, 11, 8)),
      refused("crop-outside-source"),
    ],
    ["refuses a command that isn't an object", on(null), refused("malformed-command")],
    ["refuses a list", on([crop(0, 0, 1, 1)]), refused("malformed-command")],
    [
      "refuses an unknown field",
      on({ type: "image.setCrop", crop: null, layer: 1 }),
      refused("malformed-command"),
    ],
    ["refuses a missing field", on({ type: "image.setCrop" }), refused("malformed-command")],
    [
      "refuses an unknown command",
      on({ type: "image.sharpen", amount: 10 }),
      refused("unknown-command"),
    ],
    [
      "refuses a command type only Object.prototype has",
      on({ type: "toString" }),
      refused("unknown-command"),
    ],
    ["refuses a fractional crop", on(crop(0.5, 0, 10, 10)), refused("malformed-command")],
    ["refuses a crop under one pixel", on(crop(0, 0, 0, 10)), refused("malformed-command")],
    ["refuses a negative crop", on(crop(-1, 0, 10, 10)), refused("malformed-command")],
    ["refuses a crop outside its source", on(crop(30, 0, 11, 10)), refused("crop-outside-source")],
    ["refuses a rotation of 45 degrees", on(orient(45)), refused("invalid-orientation")],
    ["refuses a flip that isn't a boolean", on(orient(0, 1)), refused("malformed-command")],
    [
      "refuses a scale over 1",
      on(output({ kind: "scale", scale: 1.5 })),
      refused("invalid-output"),
    ],
    ["refuses a scale of 0", on(output({ kind: "scale", scale: 0 })), refused("invalid-output")],
    [
      "refuses a box under one pixel",
      on(output({ kind: "fit", width: 0, height: 10 })),
      refused("invalid-output"),
    ],
    [
      "refuses a fractional box",
      on(output({ kind: "fit", width: 10.5, height: 10 })),
      refused("malformed-command"),
    ],
    ["refuses an unknown output kind", on(output({ kind: "crop" })), refused("malformed-command")],
    [
      "refuses a field that isn't kept, such as a location",
      on(metadata("location", "52.5,13.4")),
      refused("unknown-metadata-field"),
    ],
    [
      "refuses a kept field named __proto__",
      on(metadata("__proto__", "")),
      refused("unknown-metadata-field"),
    ],
    [
      "refuses a kept field over 2,000 code points",
      on(metadata("description", "x".repeat(2_001))),
      refused("metadata-too-long"),
    ],
    [
      "keeps 2,000 code points outside the BMP, which are 4,000 UTF-16 units",
      on(metadata("title", "📷".repeat(2_000))),
      applied,
    ],
    [
      "refuses 2,001 code points outside the BMP",
      on(metadata("title", "📷".repeat(2_001))),
      refused("metadata-too-long"),
    ],
    ["refuses an unknown adjustment", on(develop({ clarity: 10 })), refused("unknown-adjustment")],
    [
      "refuses an adjustment named __proto__",
      on(develop(protoValues)),
      refused("unknown-adjustment"),
    ],
    ["refuses a level over 100", on(develop({ contrast: 101 })), refused("invalid-level")],
    ["refuses a fractional level", on(develop({ exposure: 1.5 })), refused("invalid-level")],
    [
      "refuses a level that isn't a number",
      on(develop({ exposure: "10" })),
      refused("malformed-command"),
    ],
    [
      "refuses an unknown preset",
      on(filter({ preset: "lomo", strength: 50 })),
      refused("unknown-preset"),
    ],
    [
      "refuses a strength over 100",
      on(filter({ preset: "mono", strength: 101 })),
      refused("invalid-strength"),
    ],
    [
      "refuses an unknown filter field",
      on(filter({ preset: "mono", strength: 50, grain: 1 })),
      refused("malformed-command"),
    ],
  ];

  // A balanced sample: commands that apply, and a few of each refusal, so
  // the file stays small enough to review.
  const generated: ConformanceCase[] = [];
  const refusals = new Map<string, number>();
  let applies = 0;
  const samples = fc.sample(
    fc.tuple(planArb, fc.oneof(command as fc.Arbitrary<unknown>, mutatedCommand)),
    { seed: SEED, numRuns: 4_000 },
  );
  for (const [state, cmd] of samples) {
    const made = make(
      "",
      { plan: toImagePlanDocument(state, sources), command: cmd },
      applyToDocument,
    );
    const reason = (made.expected as { error?: { reason: string } }).error?.reason;
    if (
      reason === undefined
        ? applies >= GENERATED_APPLIED
        : (refusals.get(reason) ?? 0) >= GENERATED_PER_REFUSAL
    ) {
      continue;
    }
    if (reason === undefined) applies += 1;
    else refusals.set(reason, (refusals.get(reason) ?? 0) + 1);
    const type = (cmd as { type?: unknown } | null)?.type;
    const named =
      typeof type === "string" && type.startsWith("image.") ? type : "a malformed command";
    const outcome = reason === undefined ? "applied" : `refused, ${reason}`;
    generated.push({ ...made, name: `generated ${generated.length + 1}: ${named}, ${outcome}` });
  }

  return {
    format: "hm-conformance",
    version: 1,
    subject: "hm-image-commands",
    description:
      "image-sdk's edit commands (docs/formats/hm-image-plan.md). input.plan is an hm-image-plan document and input.command an hm-image-command; expected is the resulting document, or the rejection. Applying the command's inverse must restore the plan, but the inverse itself is internal. Generated cases come from the reducer's property-test generators, with a fixed seed.",
    cases: [
      ...handWritten.map(([name, input, outcome]) => make(name, input, applyToDocument, outcome)),
      ...generated,
    ],
  };
}

/** `hm-image-plan`: a document read, checked and written back. */
export function planCases(): ConformanceFile {
  const document = (changes: Record<string, unknown>) => ({ ...BASE, ...changes });
  const withBase = (changes: Record<string, unknown>) =>
    document({ base: { ...BASE.base, ...changes } });
  const invalidDocument = (reason: string) => refused(reason, "INVALID_DOCUMENT");
  const asset = (changes: Record<string, unknown> = {}) => ({
    asset: `sha256:${"0a".repeat(32)}`,
    mediaType: "image/jpeg",
    size: 48_213,
    ...changes,
  });
  const handWritten: [string, unknown, Outcome][] = [
    ["reads a document unchanged", BASE, applied],
    [
      "reads a new plan: no crop, upright, neutral, unfiltered, full size",
      withBase({
        crop: null,
        orientation: { rotate: 0, flipX: false, flipY: false },
        develop: NEUTRAL_DEVELOP,
        filter: null,
      }),
      applied,
    ],
    ["reads a box to fit", document({ output: { kind: "fit", width: 800, height: 600 } }), applied],
    [
      "reads a source with its asset",
      document({ sources: { ...BASE.sources, s: { ...SIZE, asset: asset() } } }),
      applied,
    ],
    ["reads source ids named __proto__, constructor and toString", PROTOTYPE_NAMED, applied],
    [
      "crops a source keyed toString within its own size",
      {
        ...PROTOTYPE_NAMED,
        base: {
          ...PROTOTYPE_NAMED.base,
          source: "toString",
          crop: { x: 0, y: 0, width: 30, height: 24 },
        },
      },
      applied,
    ],
    [
      "refuses a base whose source only Object.prototype has",
      { ...PROTOTYPE_NAMED, base: { ...PROTOTYPE_NAMED.base, source: "hasOwnProperty" } },
      invalidDocument("unknown-source"),
    ],
    [
      "refuses another format",
      document({ format: "hm-video-plan" }),
      refused("unknown-format", "UNSUPPORTED_FORMAT"),
    ],
    [
      "refuses a later version",
      document({ version: 2 }),
      refused("unknown-format-version", "UNSUPPORTED_FORMAT"),
    ],
    ["refuses a list", [BASE], invalidDocument("malformed-document")],
    [
      "refuses a version that isn't a number",
      document({ version: "1" }),
      invalidDocument("malformed-document"),
    ],
    ["refuses an unknown field", document({ layers: [] }), invalidDocument("malformed-document")],
    [
      "refuses a missing field",
      { ...BASE, output: undefined },
      invalidDocument("malformed-document"),
    ],
    [
      "refuses a source of no pixels",
      document({ sources: { s: { width: 0, height: 30 } } }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses an asset that isn't a SHA-256",
      document({ sources: { s: { ...SIZE, asset: asset({ asset: "md5:00" }) } } }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses a media type in capitals",
      document({ sources: { s: { ...SIZE, asset: asset({ mediaType: "Image/JPEG" }) } } }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses a base whose source isn't listed",
      withBase({ source: "s9" }),
      invalidDocument("unknown-source"),
    ],
    [
      "refuses a crop outside its source",
      withBase({ crop: { x: 30, y: 0, width: 11, height: 10 } }),
      invalidDocument("crop-outside-source"),
    ],
    [
      "refuses an unknown base field",
      withBase({ layer: 0 }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses develop without every adjustment",
      withBase({ develop: { exposure: 20 } }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses a level over 100",
      withBase({ develop: { ...NEUTRAL_DEVELOP, exposure: 101 } }),
      invalidDocument("invalid-level"),
    ],
    [
      "refuses a rotation of 45 degrees",
      withBase({ orientation: { rotate: 45, flipX: false, flipY: false } }),
      invalidDocument("invalid-orientation"),
    ],
    [
      "refuses an unknown preset",
      withBase({ filter: { preset: "lomo", strength: 50 } }),
      invalidDocument("unknown-preset"),
    ],
    [
      "refuses a strength over 100",
      withBase({ filter: { preset: "mono", strength: 101 } }),
      invalidDocument("invalid-strength"),
    ],
    [
      "refuses an unknown adjustment",
      withBase({ develop: { ...NEUTRAL_DEVELOP, clarity: 10 } }),
      invalidDocument("unknown-adjustment"),
    ],
    [
      "refuses a scale over 1",
      document({ output: { kind: "scale", scale: 2 } }),
      invalidDocument("invalid-output"),
    ],
    [
      "refuses an unknown metadata field",
      document({ metadata: { ...BASE.metadata, location: "52.5,13.4" } }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses a kept field over 2,000 code points",
      document({ metadata: { ...BASE.metadata, title: "x".repeat(2_001) } }),
      invalidDocument("metadata-too-long"),
    ],
    [
      "reads 2,000 code points outside the BMP, which are 4,000 UTF-16 units",
      document({ metadata: { ...BASE.metadata, copyright: "𝄞".repeat(2_000) } }),
      applied,
    ],
    [
      "refuses 2,001 code points outside the BMP",
      document({ metadata: { ...BASE.metadata, copyright: "𝄞".repeat(2_001) } }),
      invalidDocument("metadata-too-long"),
    ],
  ];
  const generated = fc
    .sample(planArb, { seed: SEED, numRuns: GENERATED_PLANS })
    .map((state, index) =>
      make(`generated ${index + 1}`, toImagePlanDocument(state, sources), readAndWrite, applied),
    );
  return {
    format: "hm-conformance",
    version: 1,
    subject: "hm-image-plan",
    description:
      "image-sdk's plan document (docs/formats/hm-image-plan.md). input is an hm-image-plan document; expected is the document as a reader writes it back, or the rejection. Generated cases come from the reducer's property-test generators, with a fixed seed.",
    cases: [
      ...handWritten.map(([name, input, outcome]) => make(name, input, readAndWrite, outcome)),
      ...generated,
    ],
  };
}

/** How many generated cases each geometry operation keeps. */
const GENERATED_PER_OPERATION = 8;

/** `hm-image-geometry`: the pure geometry a port reproduces exactly. */
export function geometryCases(): ConformanceFile {
  const source = { width: 400, height: 300 };
  const whole = { x: 0, y: 0, width: 400, height: 300 };
  const upright = { rotate: 0, flipX: false, flipY: false };
  const turned = { rotate: 90, flipX: false, flipY: false };
  const mirrored = { rotate: 270, flipX: true, flipY: false };
  const crop = { x: 40, y: 30, width: 200, height: 100 };
  const op = (operation: string, args: Record<string, unknown>) => ({ operation, ...args });
  const handWritten: [string, unknown][] = [
    [
      "swaps an EXIF-6 image's width and height",
      op("orientedSize", { stored: { width: 48, height: 32 }, orientation: 6 }),
    ],
    [
      "keeps an EXIF-3 image's size",
      op("orientedSize", { stored: { width: 48, height: 32 }, orientation: 3 }),
    ],
    [
      "turns the composition of a crop by 90 degrees",
      op("compositionSize", { source, crop, orientation: turned }),
    ],
    [
      "uses the whole source without a crop",
      op("compositionSize", { source, crop: null, orientation: upright }),
    ],
    [
      "scales and rounds a half up",
      op("outputSize", {
        output: { kind: "scale", scale: 0.5 },
        composition: { width: 401, height: 301 },
      }),
    ],
    [
      "scales by a fraction that isn't exact in binary",
      op("outputSize", {
        output: { kind: "scale", scale: 0.1 },
        composition: { width: 4_005, height: 3_000 },
      }),
    ],
    [
      "fits a box without enlarging",
      op("outputSize", {
        output: { kind: "fit", width: 1_000, height: 1_000 },
        composition: { width: 400, height: 300 },
      }),
    ],
    [
      "fits a box by its tighter side",
      op("outputSize", {
        output: { kind: "fit", width: 100, height: 100 },
        composition: { width: 400, height: 300 },
      }),
    ],
    [
      "keeps at least one pixel",
      op("outputSize", {
        output: { kind: "scale", scale: 0.001 },
        composition: { width: 400, height: 3 },
      }),
    ],
    [
      "maps a fractional point through a turn and a flip",
      op("sourceToComposition", { point: { x: 52.25, y: 31.5 }, crop, orientation: mirrored }),
    ],
    [
      "maps a point back through a turn and a flip",
      op("compositionToSource", { point: { x: 12.75, y: 199.5 }, crop, orientation: mirrored }),
    ],
    ["gives no ratio for a free aspect", op("aspectRatio", { aspect: "free", source })],
    [
      "gives the source's ratio for the original aspect",
      op("aspectRatio", { aspect: "original", source }),
    ],
    ["gives 16:9 as a ratio", op("aspectRatio", { aspect: [16, 9], source })],
    ["fits a square, centred", op("fitAspect", { within: whole, ratio: 1 })],
    ["fits 16:9, rounding and centring down", op("fitAspect", { within: whole, ratio: 16 / 9 })],
    ["keeps the area without a ratio", op("fitAspect", { within: whole, ratio: null })],
    ["moves a crop, kept inside the source", op("moveCrop", { crop, dx: 500, dy: -500, source })],
    [
      "rounds a move's negative half toward positive infinity, as JavaScript's Math.round",
      op("moveCrop", { crop, dx: -2.5, dy: 2.5, source }),
    ],
    [
      "drags a corner freely",
      op("dragHandle", { crop, handle: "se", dx: 15.4, dy: -20.6, source, ratio: null }),
    ],
    [
      "drags a corner with a ratio, keeping the opposite corner",
      op("dragHandle", { crop, handle: "nw", dx: -30, dy: -10, source, ratio: 1 }),
    ],
    [
      "drags a side with a ratio, keeping the crop centred across it",
      op("dragHandle", { crop, handle: "e", dx: 50, dy: 0, source, ratio: 2 }),
    ],
    [
      "drags past the source's edge, stopping at it",
      op("dragHandle", { crop, handle: "w", dx: -100, dy: 0, source, ratio: null }),
    ],
    [
      "drags an edge past the opposite one, keeping one pixel",
      op("dragHandle", { crop, handle: "n", dx: 0, dy: 500, source, ratio: null }),
    ],
    [
      "shows a crop where it is after a turn and a flip",
      op("cropInComposition", { crop, orientation: mirrored, source }),
    ],
    [
      "maps a drag on screen back to the source after a turn",
      op("compositionDeltaToSource", { dx: 10, dy: -4, orientation: turned, source }),
    ],
    [
      "maps the screen's east handle to the source's north after a turn",
      op("handleInSource", { handle: "e", orientation: turned }),
    ],
    [
      "maps the screen's south-west handle through a mirror",
      op("handleInSource", { handle: "sw", orientation: mirrored }),
    ],
    [
      "nudges left on screen after a turn",
      op("nudgeCropOnScreen", {
        crop,
        key: "ArrowLeft",
        step: 10,
        resize: false,
        orientation: turned,
        source,
        ratio: null,
      }),
    ],
    [
      "resizes the bottom edge on screen with a ratio",
      op("nudgeCropOnScreen", {
        crop,
        key: "ArrowDown",
        step: 1,
        resize: true,
        orientation: mirrored,
        source,
        ratio: 2,
      }),
    ],
  ];

  const orientation = fc.record({
    rotate: fc.constantFrom(0, 90, 180, 270),
    flipX: fc.boolean(),
    flipY: fc.boolean(),
  });
  const cropArb = fc.record({ x: fc.nat(399), y: fc.nat(299) }).chain(({ x, y }) =>
    fc.record({
      x: fc.constant(x),
      y: fc.constant(y),
      width: fc.integer({ min: 1, max: 400 - x }),
      height: fc.integer({ min: 1, max: 300 - y }),
    }),
  );
  // Quarters and halves, negative too, which round as Math.round does.
  const delta = fc.integer({ min: -2_000, max: 2_000 }).map((quarters) => quarters / 4);
  const ratio = fc.option(fc.constantFrom(1, 16 / 9, 4 / 3, 0.75, 9 / 16), { nil: null });
  const handle = fc.constantFrom("n", "s", "e", "w", "ne", "nw", "se", "sw");
  const point = fc.record({ x: delta, y: delta });
  const size = fc.record({
    width: fc.integer({ min: 1, max: 8_000 }),
    height: fc.integer({ min: 1, max: 8_000 }),
  });
  const output = fc.oneof(
    fc.record({
      kind: fc.constant("scale"),
      scale: fc.integer({ min: 1, max: 1_000 }).map((n) => n / 1_000),
    }),
    fc.record({
      kind: fc.constant("fit"),
      width: fc.integer({ min: 1, max: 4_000 }),
      height: fc.integer({ min: 1, max: 4_000 }),
    }),
  );
  const arbitraries: Record<string, fc.Arbitrary<Record<string, unknown>>> = {
    orientedSize: fc.record({ stored: size, orientation: fc.integer({ min: 1, max: 8 }) }),
    compositionSize: fc.record({
      source: fc.constant(source),
      crop: fc.option(cropArb, { nil: null }),
      orientation,
    }),
    outputSize: fc.record({ output, composition: size }),
    sourceToComposition: fc.record({ point, crop: cropArb, orientation }),
    compositionToSource: fc.record({ point, crop: cropArb, orientation }),
    aspectRatio: fc.record({
      aspect: fc.oneof(
        fc.constantFrom("free", "original"),
        fc.tuple(fc.integer({ min: 1, max: 21 }), fc.integer({ min: 1, max: 21 })),
      ),
      source: size,
    }),
    fitAspect: fc.record({ within: cropArb, ratio }),
    moveCrop: fc.record({ crop: cropArb, dx: delta, dy: delta, source: fc.constant(source) }),
    dragHandle: fc.record({
      crop: cropArb,
      handle,
      dx: delta,
      dy: delta,
      source: fc.constant(source),
      ratio,
    }),
    cropInComposition: fc.record({ crop: cropArb, orientation, source: fc.constant(source) }),
    compositionDeltaToSource: fc.record({
      dx: delta,
      dy: delta,
      orientation,
      source: fc.constant(source),
    }),
    handleInSource: fc.record({ handle, orientation }),
    nudgeCropOnScreen: fc.record({
      crop: cropArb,
      key: fc.constantFrom("ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"),
      step: fc.constantFrom(1, 10),
      resize: fc.boolean(),
      orientation,
      source: fc.constant(source),
      ratio,
    }),
  };
  const generated = GEOMETRY_OPERATIONS.flatMap((operation) => {
    const arbitrary = arbitraries[operation];
    if (!arbitrary) throw new Error(`No generator for ${operation}.`);
    return fc
      .sample(arbitrary, { seed: SEED, numRuns: GENERATED_PER_OPERATION })
      .map((args, index) =>
        make(`generated ${operation} ${index + 1}`, op(operation, args), geometry),
      );
  });
  return {
    format: "hm-conformance",
    version: 1,
    subject: "hm-image-geometry",
    description:
      "image-sdk's geometry (docs/formats/hm-image-plan.md): input.operation names a function and the other fields are its arguments, with null for a missing ratio; expected is its result, exactly. Sizes, crops and points are in pixels of the oriented source or of the composition. Results are rounded as JavaScript's Math.round does, halves toward positive infinity. Generated cases come from fixed-seed generators.",
    cases: [...handWritten.map(([name, input]) => make(name, input, geometry)), ...generated],
  };
}
