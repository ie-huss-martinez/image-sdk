import type {
  ConformanceCase,
  ConformanceFile,
} from "@hussmartinez/sdk-config/testing/conformance";
import fc from "fast-check";
import { type ImagePlan, NEUTRAL_DEVELOP, toImagePlanDocument } from "../../src/index.js";
import { commandOn, mutated, plan as planArb, SIZE } from "../arbitraries/image-plan.js";
import {
  applyToDocument,
  GEOMETRY_OPERATIONS,
  GEOMETRY_TOLERANCES,
  geometry,
  readAndWrite,
} from "./run.js";

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
const sources = { s: { ...SIZE }, t: { width: 4_000, height: 3_000, frames: 1 } };

/** The value as JSON carries it: what a port reads from the file. */
const asJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * A plan with every part set: a crop, a turn and a flip, develop, a filter,
 * a layer of each kind, two redactions, a size and a title.
 */
const EDITED: ImagePlan = {
  base: {
    source: "s",
    crop: { x: 2, y: 3, width: 20, height: 10 },
    orientation: { rotate: 90, flipX: true, flipY: false },
    develop: { ...NEUTRAL_DEVELOP, exposure: 20, contrast: -15 },
    filter: { preset: "sepia", strength: 60 },
  },
  layers: [
    {
      key: "caption",
      kind: "text",
      name: "",
      visible: true,
      opacity: 100,
      x: 2,
      y: 20,
      width: 30,
      height: 8,
      rotation: 0,
      flipX: false,
      text: "Harbour\nat dusk 📷",
      font: "sans-serif",
      bold: true,
      colour: "#ffffff",
      align: "center",
    },
    {
      key: "ring",
      kind: "shape",
      name: "Ring",
      visible: true,
      opacity: 60,
      x: -5,
      y: 3,
      width: 20,
      height: 20,
      rotation: 450,
      flipX: false,
      shape: "ellipse",
      fill: null,
      stroke: { colour: "#ff0000", width: 2 },
    },
    {
      key: "inset",
      kind: "image",
      name: "",
      visible: false,
      opacity: 100,
      x: 25,
      y: 0,
      width: 12,
      height: 9,
      rotation: 3599,
      flipX: true,
      source: "t",
      crop: { x: 100, y: 100, width: 1_200, height: 900 },
    },
  ],
  redactions: [
    { key: "face", mode: "solid", x: 4, y: 5, width: 12, height: 8, colour: "#000000" },
    { key: "plate", mode: "pixelate", x: -3, y: 20, width: 30, height: 15 },
  ],
  animation: null,
  output: { kind: "scale", scale: 0.5 },
  metadata: { title: "Harbour at dusk", description: "", artist: "", copyright: "" },
};
const BASE = toImagePlanDocument(EDITED, sources);

/** A drawing and an arrow, which format version 3 added (docs/adr/0014). */
const DRAWING = {
  key: "sketch",
  kind: "drawing",
  name: "",
  visible: true,
  opacity: 80,
  x: 10,
  y: 5,
  strokes: [
    { colour: "#102030", width: 3, runs: [[0, 0, 4, 3, 9, 3]] },
    { colour: "#ff0000", width: 6, runs: [[2, 2]] },
  ],
};
const ARROW = {
  key: "pointer",
  kind: "arrow",
  name: "Look",
  visible: true,
  opacity: 100,
  from: { x: 30, y: 25 },
  to: { x: 12, y: 8 },
  colour: "#ffcc00",
  width: 2,
};

/** The sources as documents before version 4 had them: with no frame counts. */
const SOURCES_V3 = {
  s: { width: SIZE.width, height: SIZE.height },
  t: { width: 4_000, height: 3_000 },
};
/** The plan as an earlier version wrote it: every source a still. */
const OLDER = { ...BASE, sources: SOURCES_V3 };

/** The same plan as version 1 had it: before redactions, so without them. */
const { layers: _layers, redactions: _redactions, animation: _animation, ...V1_FIELDS } = OLDER;
const V1 = { ...V1_FIELDS, version: 1 };

/** An animation of source `s`, which has five frames (docs/adr/0011). */
const ANIMATION = {
  loop: 0,
  frames: [
    { key: "first", frame: 0, delay: 10 },
    { key: "second", frame: 1, delay: 0 },
    { key: "again", frame: 0, delay: 65_535 },
    { key: "last", frame: 4, delay: 7 },
  ],
};
/** The plan with every part set, animated. */
const ANIMATED = { ...BASE, animation: ANIMATION };

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
      PROTO: { width: 10, height: 8, frames: 1 },
      constructor: { width: 20, height: 16, frames: 1 },
      toString: { width: 30, height: 24, frames: 1 },
    },
    base: { ...BASE.base, source: "PROTO", crop: null },
    // The image layer's source is one of them too, with a crop of its whole size.
    layers: BASE.layers.map((layer) =>
      layer.kind === "image"
        ? { ...layer, source: "constructor", crop: { x: 0, y: 0, width: 20, height: 16 } }
        : layer,
    ),
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

/** A command for the plan, with one field replaced or added, at its top or one level in. */
const mutatedCommandOn = (state: ImagePlan) =>
  fc.oneof(
    mutated(commandOn(state)),
    commandOn(state).chain((valid) => {
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
  // The plan with a drawing and an arrow over its other layers (docs/adr/0014).
  const pen = (runs: unknown, changes: Record<string, unknown> = {}) => ({
    colour: "#102030",
    width: 3,
    runs,
    ...changes,
  });
  const sketch = {
    key: "sketch",
    kind: "drawing",
    name: "",
    visible: true,
    opacity: 80,
    x: 10,
    y: 5,
    strokes: [pen([[0, 0, 4, 3, 9, 3]]), pen([[2, 2]], { colour: "#ff0000", width: 6 })],
  };
  const pointer = {
    key: "pointer",
    kind: "arrow",
    name: "Look",
    visible: true,
    opacity: 100,
    from: { x: 30, y: 25 },
    to: { x: 12, y: 8 },
    colour: "#ffcc00",
    width: 2,
  };
  const DRAWN = { ...BASE, layers: [...BASE.layers, sketch, pointer] };
  const onDrawn = (cmd: unknown) => ({ plan: DRAWN, command: cmd });
  const addStrokes = (key: unknown, ...strokes: unknown[]) => ({
    type: "image.addStrokes",
    key,
    strokes,
  });
  const removeStrokes = (key: unknown, ...indexes: unknown[]) => ({
    type: "image.removeStrokes",
    key,
    indexes,
  });
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
  const layerCommon = (key: string) => ({
    key,
    name: "",
    visible: true,
    opacity: 100,
    x: 1,
    y: 2,
    width: 10,
    height: 5,
    rotation: 0,
    flipX: false,
  });
  const textLayer = (key: string, changes: Record<string, unknown> = {}) => ({
    ...layerCommon(key),
    kind: "text",
    text: "Hello",
    font: "serif",
    bold: false,
    colour: "#102030",
    align: "start",
    ...changes,
  });
  const shapeLayer = (key: string, changes: Record<string, unknown> = {}) => ({
    ...layerCommon(key),
    kind: "shape",
    shape: "rectangle",
    fill: "#102030",
    stroke: null,
    ...changes,
  });
  const imageLayer = (key: string, changes: Record<string, unknown> = {}) => ({
    ...layerCommon(key),
    kind: "image",
    source: "s",
    crop: null,
    ...changes,
  });
  const onAnimated = (cmd: unknown) => ({ plan: ANIMATED, command: cmd });
  const frame = (key: unknown, index: unknown, delay: unknown) => ({ key, frame: index, delay });
  const insertFrames = (at: unknown, ...frames: unknown[]) => ({
    type: "image.insertFrames",
    at,
    frames,
  });
  const removeFrames = (...keys: unknown[]) => ({ type: "image.removeFrames", keys });
  const moveFrames = (to: unknown, ...keys: unknown[]) => ({ type: "image.moveFrames", keys, to });
  const updateFrames = (...updates: unknown[]) => ({ type: "image.updateFrames", updates });
  const setLoop = (loop: unknown) => ({ type: "image.setLoop", loop });
  const insertLayers = (at: unknown, ...layers: unknown[]) => ({
    type: "image.insertLayers",
    at,
    layers,
  });
  const removeLayers = (...keys: unknown[]) => ({ type: "image.removeLayers", keys });
  const moveLayers = (to: unknown, ...keys: unknown[]) => ({ type: "image.moveLayers", keys, to });
  const updateLayers = (...updates: [unknown, unknown][]) => ({
    type: "image.updateLayers",
    updates: updates.map(([key, props]) => ({ key, props })),
  });
  const solid = (key: string, changes: Record<string, unknown> = {}) => ({
    key,
    mode: "solid",
    x: 1,
    y: 2,
    width: 3,
    height: 4,
    colour: "#102030",
    ...changes,
  });
  const pixelate = (key: string, changes: Record<string, unknown> = {}) => ({
    key,
    mode: "pixelate",
    x: 1,
    y: 2,
    width: 3,
    height: 4,
    ...changes,
  });
  const insert = (at: unknown, ...redactions: unknown[]) => ({
    type: "image.insertRedactions",
    at,
    redactions,
  });
  const remove = (...keys: unknown[]) => ({ type: "image.removeRedactions", keys });
  const move = (to: unknown, ...keys: unknown[]) => ({ type: "image.moveRedactions", keys, to });
  const update = (...updates: [unknown, unknown][]) => ({
    type: "image.updateRedactions",
    updates: updates.map(([key, props]) => ({ key, props })),
  });
  // A plan with as many redactions as the format holds.
  const full = {
    ...BASE,
    layers: [],
    redactions: Array.from({ length: 1_024 }, (_, index) => pixelate(`r${index}`)),
  };

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
    ["inserts a text layer over the others", on(insertLayers(3, textLayer("t"))), applied],
    ["inserts a shape under every layer", on(insertLayers(0, shapeLayer("s"))), applied],
    [
      "inserts an image layer of another source, cropped",
      on(
        insertLayers(
          1,
          imageLayer("i", { source: "t", crop: { x: 0, y: 0, width: 4_000, height: 3_000 } }),
        ),
      ),
      applied,
    ],
    [
      "inserts layers keyed __proto__, constructor and toString",
      on(
        insertLayers(0, textLayer("__proto__"), shapeLayer("constructor"), imageLayer("toString")),
      ),
      applied,
    ],
    [
      "inserts text of 1,000 code points outside the BMP, which are 2,000 UTF-16 units",
      on(insertLayers(0, textLayer("t", { text: "𝄞".repeat(1_000) }))),
      applied,
    ],
    [
      "inserts text with line feeds, right-to-left letters and a zero-width joiner, which are text",
      on(insertLayers(0, textLayer("t", { text: "שלום\nعالم\n👩\u200D💻" }))),
      applied,
    ],
    [
      "inserts a layer at the box's limits, turned by 359.9 degrees",
      on(
        insertLayers(
          0,
          shapeLayer("s", { x: -65_536, y: 65_536, width: 65_536, height: 1, rotation: 3_599 }),
        ),
      ),
      applied,
    ],
    ["removes a layer", on(removeLayers("ring")), applied],
    ["removes every layer", on(removeLayers("inset", "caption", "ring")), applied],
    ["moves the top layer to the bottom", on(moveLayers(0, "inset")), applied],
    ["moves two layers up, which keep their order", on(moveLayers(1, "ring", "caption")), applied],
    [
      "moves a layer's box and turns it",
      on(updateLayers(["ring", { x: 10, y: -4, rotation: 900 }])),
      applied,
    ],
    ["mirrors a layer", on(updateLayers(["ring", { flipX: true }])), applied],
    [
      "mirrors a layer that's mirrored back, and turns it",
      on(updateLayers(["inset", { flipX: false, rotation: 1_800 }])),
      applied,
    ],
    [
      "hides a layer and fades another, at once",
      on(updateLayers(["caption", { visible: false }], ["ring", { opacity: 0 }])),
      applied,
    ],
    [
      "changes a text layer's text and colour",
      on(updateLayers(["caption", { text: "", colour: "#000000" }])),
      applied,
    ],
    [
      "gives a shape a fill and removes its stroke",
      on(updateLayers(["ring", { fill: "#00ff00", stroke: null }])),
      applied,
    ],
    ["removes an image layer's crop", on(updateLayers(["inset", { crop: null }])), applied],
    [
      "names a layer with 100 code points",
      on(updateLayers(["ring", { name: "𝄞".repeat(100) }])),
      applied,
    ],
    ["updates nothing of a layer with empty props", on(updateLayers(["caption", {}])), applied],
    [
      "refuses a layer whose key a redaction has",
      on(insertLayers(0, textLayer("face"))),
      refused("duplicate-key"),
    ],
    [
      "refuses a redaction whose key a layer has",
      on(insert(0, solid("caption"))),
      refused("duplicate-key"),
    ],
    [
      "refuses a layer of an unknown kind",
      on(insertLayers(0, { ...shapeLayer("s"), kind: "sticker" })),
      refused("unknown-layer-kind"),
    ],
    [
      "refuses a layer index past the end",
      on(insertLayers(4, textLayer("t"))),
      refused("invalid-index"),
    ],
    [
      "refuses text of 1,001 code points",
      on(insertLayers(0, textLayer("t", { text: "𝄞".repeat(1_001) }))),
      refused("text-too-long"),
    ],
    [
      "refuses a name of 101 code points",
      on(insertLayers(0, textLayer("t", { name: "x".repeat(101) }))),
      refused("text-too-long"),
    ],
    [
      "refuses text with a tab",
      on(insertLayers(0, textLayer("t", { text: "a\tb" }))),
      refused("invalid-text"),
    ],
    [
      "refuses text with a carriage return",
      on(insertLayers(0, textLayer("t", { text: "a\r\nb" }))),
      refused("invalid-text"),
    ],
    [
      "refuses text with a NUL",
      on(insertLayers(0, textLayer("t", { text: "a\u0000b" }))),
      refused("invalid-text"),
    ],
    [
      "refuses text with a right-to-left override, which shows it in another order",
      on(insertLayers(0, textLayer("t", { text: "invoice\u202Efdp.exe" }))),
      refused("invalid-text"),
    ],
    [
      "refuses text with a directional isolate",
      on(insertLayers(0, textLayer("t", { text: "a\u2066b\u2069" }))),
      refused("invalid-text"),
    ],
    [
      "refuses a name with a right-to-left override",
      on(insertLayers(0, textLayer("t", { name: "\u202Eeman" }))),
      refused("invalid-text"),
    ],
    [
      "refuses an opacity over 100",
      on(insertLayers(0, textLayer("t", { opacity: 101 }))),
      refused("invalid-opacity"),
    ],
    [
      "refuses a fractional opacity",
      on(insertLayers(0, textLayer("t", { opacity: 50.5 }))),
      refused("malformed-command"),
    ],
    [
      "refuses a box of no width",
      on(insertLayers(0, textLayer("t", { width: 0 }))),
      refused("invalid-box"),
    ],
    [
      "refuses a layer without flipX",
      on(insertLayers(0, { ...textLayer("t"), flipX: undefined })),
      refused("malformed-command"),
    ],
    [
      "refuses a flipX that isn't a boolean",
      on(insertLayers(0, textLayer("t", { flipX: 1 }))),
      refused("malformed-command"),
    ],
    [
      "refuses to set a flipX that isn't a boolean",
      on(updateLayers(["ring", { flipX: "yes" }])),
      refused("malformed-command"),
    ],
    [
      "refuses a rotation of 3600",
      on(insertLayers(0, textLayer("t", { rotation: 3_600 }))),
      refused("invalid-box"),
    ],
    [
      "refuses a box further than 65,536 pixels from the origin",
      on(insertLayers(0, textLayer("t", { y: -65_537 }))),
      refused("invalid-box"),
    ],
    [
      "refuses a layer with a fractional box",
      on(insertLayers(0, textLayer("t", { x: 0.5 }))),
      refused("malformed-command"),
    ],
    [
      "refuses an unknown font",
      on(insertLayers(0, textLayer("t", { font: "Comic Sans MS" }))),
      refused("malformed-command"),
    ],
    [
      "refuses a text colour with an alpha",
      on(insertLayers(0, textLayer("t", { colour: "#ffffff80" }))),
      refused("invalid-colour"),
    ],
    [
      "refuses a shape with neither a fill nor a stroke",
      on(insertLayers(0, shapeLayer("s", { fill: null, stroke: null }))),
      refused("empty-shape"),
    ],
    [
      "refuses a stroke of no width",
      on(insertLayers(0, shapeLayer("s", { stroke: { colour: "#000000", width: 0 } }))),
      refused("malformed-command"),
    ],
    [
      "refuses an image layer whose source the document doesn't list",
      on(insertLayers(0, imageLayer("i", { source: "u" }))),
      refused("unknown-source"),
    ],
    [
      "refuses an image layer whose source only Object.prototype has",
      on(insertLayers(0, imageLayer("i", { source: "toString" }))),
      refused("unknown-source"),
    ],
    [
      "refuses an image layer's crop past its own source, though it fits the base's",
      on(
        insertLayers(
          0,
          imageLayer("i", { source: "s", crop: { x: 0, y: 0, width: 41, height: 30 } }),
        ),
      ),
      refused("crop-outside-source"),
    ],
    [
      "refuses a text layer with a shape's field",
      on(insertLayers(0, { ...textLayer("t"), fill: "#000000" })),
      refused("malformed-command"),
    ],
    [
      "refuses a layer without a name",
      on(insertLayers(0, { ...textLayer("t"), name: undefined })),
      refused("malformed-command"),
    ],
    [
      "refuses to remove a layer the plan doesn't have",
      on(removeLayers("face")),
      refused("unknown-layer"),
    ],
    [
      "refuses to move a layer past the end of the rest",
      on(moveLayers(3, "ring")),
      refused("invalid-index"),
    ],
    [
      "refuses to update a layer the plan doesn't have",
      on(updateLayers(["plate", { opacity: 1 }])),
      refused("unknown-layer"),
    ],
    [
      "refuses to set a shape's field on a text layer",
      on(updateLayers(["caption", { fill: "#000000" }])),
      refused("wrong-kind"),
    ],
    [
      "refuses to set text on an image layer",
      on(updateLayers(["inset", { text: "hello" }])),
      refused("wrong-kind"),
    ],
    [
      "refuses to change a layer's kind",
      on(updateLayers(["caption", { kind: "shape" }])),
      refused("malformed-command"),
    ],
    [
      "refuses to change a layer's key",
      on(updateLayers(["caption", { key: "title" }])),
      refused("malformed-command"),
    ],
    [
      "refuses an update that leaves a shape with nothing to draw",
      on(updateLayers(["ring", { stroke: null }])),
      refused("empty-shape"),
    ],
    [
      "refuses an update to a source the document doesn't list",
      on(updateLayers(["inset", { source: "u" }])),
      refused("unknown-source"),
    ],
    [
      "refuses an update whose crop doesn't fit the layer's new source",
      on(updateLayers(["inset", { source: "s" }])),
      refused("crop-outside-source"),
    ],
    [
      "refuses an update with a right-to-left override in its text",
      on(updateLayers(["caption", { text: "\u202E" }])),
      refused("invalid-text"),
    ],
    [
      "refuses one layer more than the format holds, counted with the redactions",
      { plan: full, command: insertLayers(0, textLayer("one-more")) },
      refused("too-many-layers"),
    ],
    ["inserts a solid redaction between two", on(insert(1, solid("new"))), applied],
    ["inserts two redactions at the end", on(insert(2, solid("a"), pixelate("b"))), applied],
    [
      "inserts a redaction outside the scene, at the furthest position",
      on(insert(0, pixelate("far", { x: -65_536, y: 65_536, width: 65_536, height: 1 }))),
      applied,
    ],
    [
      "inserts redactions keyed __proto__, constructor and toString",
      on(insert(0, solid("__proto__"), pixelate("constructor"), solid("toString"))),
      applied,
    ],
    [
      "inserts a redaction with a key of 64 code points",
      on(insert(0, solid("𝄞".repeat(64)))),
      applied,
    ],
    ["removes a redaction", on(remove("face")), applied],
    ["removes every redaction, listed in any order", on(remove("plate", "face")), applied],
    ["moves a redaction to the end", on(move(1, "face")), applied],
    ["moves both redactions, which keep their order", on(move(0, "plate", "face")), applied],
    ["moves a redaction's region", on(update(["face", { x: 10, y: -2 }])), applied],
    [
      "updates two redactions at once",
      on(update(["face", { colour: "#ffffff" }], ["plate", { width: 1 }])),
      applied,
    ],
    [
      "sets a solid redaction to pixelate, which drops its colour",
      on(update(["face", { mode: "pixelate" }])),
      applied,
    ],
    [
      "sets a pixelated redaction to solid, with a colour",
      on(update(["plate", { mode: "solid", colour: "#00ff00" }])),
      applied,
    ],
    ["updates nothing with empty props", on(update(["face", {}])), applied],
    [
      "refuses a redaction whose key the plan already uses",
      on(insert(0, solid("plate"))),
      refused("duplicate-key"),
    ],
    [
      "refuses two new redactions with one key",
      on(insert(0, solid("a"), pixelate("a"))),
      refused("duplicate-key"),
    ],
    ["refuses an index past the end", on(insert(3, solid("a"))), refused("invalid-index")],
    ["refuses a negative index", on(insert(-1, solid("a"))), refused("malformed-command")],
    ["refuses no redactions", on(insert(0)), refused("malformed-command")],
    ["refuses an empty key", on(insert(0, solid(""))), refused("invalid-key")],
    [
      "refuses a key of 65 code points",
      on(insert(0, solid("𝄞".repeat(65)))),
      refused("invalid-key"),
    ],
    [
      "refuses a key that isn't text",
      on(insert(0, solid(7 as never))),
      refused("malformed-command"),
    ],
    [
      "refuses a blurred redaction",
      on(insert(0, pixelate("a", { mode: "blur" }))),
      refused("unknown-redaction-mode"),
    ],
    [
      "refuses a region under one pixel",
      on(insert(0, solid("a", { width: 0 }))),
      refused("invalid-region"),
    ],
    [
      "refuses a region further than 65,536 pixels from the origin",
      on(insert(0, solid("a", { x: 65_537 }))),
      refused("invalid-region"),
    ],
    [
      "refuses a fractional region",
      on(insert(0, solid("a", { y: 0.5 }))),
      refused("malformed-command"),
    ],
    [
      "refuses a colour in capitals",
      on(insert(0, solid("a", { colour: "#FFFFFF" }))),
      refused("invalid-colour"),
    ],
    [
      "refuses a colour with an alpha",
      on(insert(0, solid("a", { colour: "#00000080" }))),
      refused("invalid-colour"),
    ],
    [
      "refuses a solid redaction without a colour",
      on(insert(0, { ...pixelate("a"), mode: "solid" })),
      refused("malformed-command"),
    ],
    [
      "refuses a pixelated redaction with a colour",
      on(insert(0, { ...solid("a"), mode: "pixelate" })),
      refused("malformed-command"),
    ],
    [
      "refuses a redaction with an opacity",
      on(insert(0, solid("a", { opacity: 50 }))),
      refused("malformed-command"),
    ],
    [
      "refuses one redaction more than the format holds",
      { plan: full, command: insert(0, pixelate("one-more")) },
      refused("too-many-layers"),
    ],
    [
      "refuses to remove a redaction the plan doesn't have",
      on(remove("nose")),
      refused("unknown-redaction"),
    ],
    [
      "refuses to remove a key only Object.prototype has",
      on(remove("toString")),
      refused("unknown-redaction"),
    ],
    ["refuses a key listed twice", on(remove("face", "face")), refused("malformed-command")],
    ["refuses to remove nothing", on(remove()), refused("malformed-command")],
    ["refuses to move past the end of the rest", on(move(2, "face")), refused("invalid-index")],
    [
      "refuses to update a redaction the plan doesn't have",
      on(update(["nose", { x: 1 }])),
      refused("unknown-redaction"),
    ],
    [
      "refuses two updates of one redaction",
      on(update(["face", { x: 1 }], ["face", { y: 1 }])),
      refused("duplicate-key"),
    ],
    [
      "refuses to change a key",
      on(update(["face", { key: "nose" }])),
      refused("malformed-command"),
    ],
    [
      "refuses a colour on a pixelated redaction",
      on(update(["plate", { colour: "#000000" }])),
      refused("unexpected-colour"),
    ],
    [
      "refuses a colour with a change to pixelate",
      on(update(["face", { mode: "pixelate", colour: "#000000" }])),
      refused("unexpected-colour"),
    ],
    [
      "refuses a change to solid without a colour",
      on(update(["plate", { mode: "solid" }])),
      refused("missing-colour"),
    ],
    [
      "refuses an update that leaves a region under one pixel",
      on(update(["face", { height: 0 }])),
      refused("invalid-region"),
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
    // Drawings, strokes and arrows (format version 3, docs/adr/0014).
    ["inserts a drawing and an arrow", on(insertLayers(3, sketch, pointer)), applied],
    [
      "adds a stroke of one run to a drawing",
      onDrawn(addStrokes("sketch", pen([[1, 1, 5, 5]]))),
      applied,
    ],
    [
      "adds a stroke of three runs, and a dot, at once",
      onDrawn(
        addStrokes(
          "sketch",
          pen([
            [0, 0, 3, 0],
            [3, 0, 3, 4],
            [3, 4, -2, 4],
          ]),
          pen([[7, 7]]),
        ),
      ),
      applied,
    ],
    [
      "adds a stroke whose runs don't join: the format doesn't require it",
      onDrawn(
        addStrokes(
          "sketch",
          pen([
            [0, 0, 1, 1],
            [8, 8, 9, 9],
          ]),
        ),
      ),
      applied,
    ],
    [
      "adds a stroke of 64 runs",
      onDrawn(addStrokes("sketch", pen(Array.from({ length: 64 }, (_, i) => [i, 0, i, 1])))),
      applied,
    ],
    [
      "adds a run of 2,000 points",
      onDrawn(
        addStrokes(
          "sketch",
          pen([Array.from({ length: 2_000 }, (_, i) => [i % 50, i % 7]).flat()]),
        ),
      ),
      applied,
    ],
    ["removes one of a drawing's strokes", onDrawn(removeStrokes("sketch", 0)), applied],
    ["removes a drawing's last stroke of two", onDrawn(removeStrokes("sketch", 1)), applied],
    ["moves a drawing by its origin", onDrawn(updateLayers(["sketch", { x: -3, y: 40 }])), applied],
    [
      "re-aims an arrow, and changes its colour and width",
      onDrawn(
        updateLayers([
          "pointer",
          { to: { x: 2, y: 2 }, from: { x: 30, y: 20 }, colour: "#00ff00", width: 5 },
        ]),
      ),
      applied,
    ],
    [
      "hides a drawing and names an arrow",
      onDrawn(updateLayers(["sketch", { visible: false }], ["pointer", { name: "This one" }])),
      applied,
    ],
    ["removes a drawing and an arrow", onDrawn(removeLayers("sketch", "pointer")), applied],
    ["moves a drawing under every layer", onDrawn(moveLayers(0, "sketch")), applied],
    [
      "accepts a drawing at one end of the scene with a point at the other",
      on(
        insertLayers(0, {
          ...sketch,
          x: -65_536,
          y: 65_536,
          strokes: [pen([[0, 0, 131_072, -131_072]])],
        }),
      ),
      applied,
    ],
    [
      "refuses a drawing with no strokes",
      on(insertLayers(0, { ...sketch, strokes: [] })),
      refused("empty-drawing"),
    ],
    [
      "refuses to remove every stroke of a drawing",
      onDrawn(removeStrokes("sketch", 0, 1)),
      refused("empty-drawing"),
    ],
    [
      "refuses an arrow from a point to itself",
      on(insertLayers(0, { ...pointer, to: pointer.from })),
      refused("empty-arrow"),
    ],
    [
      "refuses to re-aim an arrow at its own tail",
      onDrawn(updateLayers(["pointer", { to: { x: 30, y: 25 } }])),
      refused("empty-arrow"),
    ],
    [
      "refuses a run with an odd number of coordinates",
      onDrawn(addStrokes("sketch", pen([[0, 0, 4]]))),
      refused("invalid-points"),
    ],
    [
      "refuses a point outside the scene, from the drawing's origin",
      onDrawn(addStrokes("sketch", pen([[0, 0, 65_527, 0]]))),
      refused("invalid-points"),
    ],
    [
      "refuses to move a drawing so that a point leaves the scene",
      onDrawn(updateLayers(["sketch", { x: 65_530 }])),
      refused("invalid-points"),
    ],
    [
      "refuses strokes for a layer that isn't a drawing",
      onDrawn(addStrokes("ring", pen([[0, 0]]))),
      refused("wrong-kind"),
    ],
    [
      "refuses to remove strokes from an arrow",
      onDrawn(removeStrokes("pointer", 0)),
      refused("wrong-kind"),
    ],
    [
      "refuses strokes for a layer the plan doesn't have",
      onDrawn(addStrokes("nobody", pen([[0, 0]]))),
      refused("unknown-layer"),
    ],
    [
      "refuses a stroke index the drawing doesn't have",
      onDrawn(removeStrokes("sketch", 2)),
      refused("invalid-index"),
    ],
    [
      "refuses a stroke index listed twice",
      onDrawn(removeStrokes("sketch", 0, 0)),
      refused("invalid-index"),
    ],
    [
      "refuses a box's field on a drawing",
      onDrawn(updateLayers(["sketch", { width: 20 }])),
      refused("wrong-kind"),
    ],
    [
      "refuses a drawing's field on an arrow",
      onDrawn(updateLayers(["pointer", { x: 3 }])),
      refused("wrong-kind"),
    ],
    [
      "refuses to set a drawing's strokes with an update",
      onDrawn(updateLayers(["sketch", { strokes: [pen([[0, 0]])] }])),
      refused("malformed-command"),
    ],
    ["refuses no strokes", onDrawn(addStrokes("sketch")), refused("malformed-command")],
    ["refuses no indexes", onDrawn(removeStrokes("sketch")), refused("malformed-command")],
    [
      "refuses a negative stroke index",
      onDrawn(removeStrokes("sketch", -1)),
      refused("malformed-command"),
    ],
    [
      "refuses a stroke with no runs",
      onDrawn(addStrokes("sketch", pen([]))),
      refused("malformed-command"),
    ],
    [
      "refuses an empty run",
      onDrawn(addStrokes("sketch", pen([[]]))),
      refused("malformed-command"),
    ],
    [
      "refuses a stroke of 65 runs",
      onDrawn(addStrokes("sketch", pen(Array.from({ length: 65 }, () => [0, 0])))),
      refused("malformed-command"),
    ],
    [
      "refuses a run of 2,001 points",
      onDrawn(addStrokes("sketch", pen([Array.from({ length: 4_002 }, (_, i) => i % 9)]))),
      refused("malformed-command"),
    ],
    [
      "refuses a fractional coordinate",
      onDrawn(addStrokes("sketch", pen([[0, 0.5]]))),
      refused("malformed-command"),
    ],
    [
      "refuses a stroke 1,025 pixels wide",
      onDrawn(addStrokes("sketch", pen([[0, 0]], { width: 1_025 }))),
      refused("malformed-command"),
    ],
    [
      "refuses a stroke without a colour",
      onDrawn(addStrokes("sketch", { width: 2, runs: [[0, 0]] })),
      refused("malformed-command"),
    ],
    [
      "refuses a stroke's colour that isn't #rrggbb",
      onDrawn(addStrokes("sketch", pen([[0, 0]], { colour: "red" }))),
      refused("invalid-colour"),
    ],
    [
      "refuses an arrow whose tip is outside the scene",
      on(insertLayers(0, { ...pointer, to: { x: 65_537, y: 0 } })),
      refused("malformed-command"),
    ],
    [
      "refuses an arrow with a box",
      on(insertLayers(0, { ...pointer, rotation: 0 })),
      refused("malformed-command"),
    ],
    [
      "refuses a drawing with a rotation",
      on(insertLayers(0, { ...sketch, rotation: 0 })),
      refused("malformed-command"),
    ],
    // The animation's frames and its loop count (format version 4, docs/adr/0011).
    [
      "inserts a duplicate of a frame after it",
      onAnimated(insertFrames(1, frame("copy", 0, 10))),
      applied,
    ],
    [
      "inserts two frames at the end",
      onAnimated(insertFrames(4, frame("a", 2, 0), frame("b", 3, 65_535))),
      applied,
    ],
    ["removes a frame", onAnimated(removeFrames("second")), applied],
    ["removes all frames but one", onAnimated(removeFrames("first", "again", "last")), applied],
    [
      "refuses removing every frame: an animation keeps one",
      onAnimated(removeFrames("first", "second", "again", "last")),
      refused("no-frames"),
    ],
    [
      "moves two frames to the start, in their order",
      onAnimated(moveFrames(0, "last", "again")),
      applied,
    ],
    ["reverses the frames", onAnimated({ type: "image.reverseFrames" }), applied],
    [
      "sets one frame's delay",
      onAnimated(updateFrames({ key: "second", props: { delay: 25 } })),
      applied,
    ],
    [
      "sets every frame's delay at once",
      onAnimated(
        updateFrames(...ANIMATION.frames.map(({ key }) => ({ key, props: { delay: 4 } }))),
      ),
      applied,
    ],
    [
      "updates a frame with nothing to set",
      onAnimated(updateFrames({ key: "first", props: {} })),
      applied,
    ],
    ["sets the animation to play once", onAnimated(setLoop(null)), applied],
    ["sets the animation to repeat three times", onAnimated(setLoop(3)), applied],
    [
      "refuses a frame command on a still",
      on(insertFrames(0, frame("f", 0, 10))),
      refused("not-animated"),
    ],
    ["refuses reversing a still", on({ type: "image.reverseFrames" }), refused("not-animated")],
    ["refuses a loop count for a still", on(setLoop(0)), refused("not-animated")],
    [
      "refuses a frame the source doesn't have",
      onAnimated(insertFrames(0, frame("f", 5, 10))),
      refused("invalid-frame"),
    ],
    [
      "refuses a frame before the first",
      onAnimated(insertFrames(0, frame("f", -1, 10))),
      refused("malformed-command"),
    ],
    [
      "refuses a delay of 65,536",
      onAnimated(insertFrames(0, frame("f", 0, 65_536))),
      refused("invalid-delay"),
    ],
    [
      "refuses setting a delay below 0",
      onAnimated(updateFrames({ key: "first", props: { delay: -1 } })),
      refused("invalid-delay"),
    ],
    [
      "refuses setting a frame's frame: only its delay can be set",
      onAnimated(updateFrames({ key: "first", props: { frame: 1 } })),
      refused("malformed-command"),
    ],
    ["refuses a frame no frame has", onAnimated(removeFrames("missing")), refused("unknown-frame")],
    [
      "refuses moving a layer's key among the frames",
      onAnimated(moveFrames(0, BASE.layers[0]?.key)),
      refused("unknown-frame"),
    ],
    [
      "refuses a new frame with a key a frame has",
      onAnimated(insertFrames(0, frame("last", 0, 10))),
      refused("duplicate-key"),
    ],
    [
      "refuses a new frame with a key a layer has",
      onAnimated(insertFrames(0, frame(BASE.layers[0]?.key, 0, 10))),
      refused("duplicate-key"),
    ],
    [
      "refuses a new layer with a key a frame has",
      onAnimated(insertLayers(0, { ...BASE.layers[0], key: "first" })),
      refused("duplicate-key"),
    ],
    [
      "refuses inserting past the end of the frames",
      onAnimated(insertFrames(5, frame("f", 0, 10))),
      refused("invalid-index"),
    ],
    ["refuses a loop count of 65,536", onAnimated(setLoop(65_536)), refused("invalid-loop")],
    ["refuses a loop count that isn't whole", onAnimated(setLoop(1.5)), refused("invalid-loop")],
    ["refuses a loop count as text", onAnimated(setLoop("0")), refused("malformed-command")],
    [
      "refuses reversing with a field it doesn't have",
      onAnimated({ type: "image.reverseFrames", keys: ["first"] }),
      refused("malformed-command"),
    ],
    [
      "refuses a 4,097th frame",
      {
        plan: {
          ...BASE,
          sources: { ...BASE.sources, s: { ...SIZE, frames: 4_096 } },
          animation: {
            loop: 0,
            frames: Array.from({ length: 4_096 }, (_, index) => frame(`f${index}`, index, 1)),
          },
        },
        command: insertFrames(0, frame("one-more", 0, 1)),
      },
      refused("too-many-frames"),
    ],
  ];

  // A balanced sample: commands that apply, and a few of each refusal, so
  // the file stays small enough to review.
  const generated: ConformanceCase[] = [];
  const refusals = new Map<string, number>();
  let applies = 0;
  const samples = fc.sample(
    planArb.chain((state) =>
      fc.tuple(
        fc.constant(state),
        fc.oneof(commandOn(state) as fc.Arbitrary<unknown>, mutatedCommandOn(state)),
      ),
    ),
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
  /** The plan as a version before 4 wrote it. */
  const older = (changes: Record<string, unknown>) => ({ ...OLDER, ...changes });
  /** The plan with an animation, changed. */
  const animated = (changes: Record<string, unknown>) =>
    document({ animation: { ...ANIMATION, ...changes } });
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
    ["reads version 1 as a plan with no layers, redactions or animation", V1, applied],
    [
      "refuses a version 1 document with version 2's fields",
      { ...V1, redactions: [] },
      invalidDocument("malformed-document"),
    ],
    ["reads a plan with no redactions", document({ redactions: [] }), applied],
    [
      "reads version 2 as it is: only the version and the sources' frame counts change",
      older({ version: 2 }),
      applied,
    ],
    ["reads version 3 as a still: each source has one frame", older({ version: 3 }), applied],
    [
      "refuses a version 3 document whose source has a frame count, which version 4 added",
      document({ version: 3 }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses a version 3 document with an animation, which version 4 added",
      older({ version: 3, animation: ANIMATION }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses a source without its frame count",
      document({ sources: SOURCES_V3 }),
      invalidDocument("malformed-document"),
    ],
    ["reads an animation", ANIMATED, applied],
    [
      "reads an animation of one frame that plays once",
      document({ animation: { loop: null, frames: [{ key: "only", frame: 3, delay: 0 }] } }),
      applied,
    ],
    [
      "reads frames keyed __proto__, constructor and toString",
      animated({
        loop: 65_535,
        frames: [
          { key: "__proto__", frame: 0, delay: 1 },
          { key: "constructor", frame: 1, delay: 2 },
          { key: "toString", frame: 2, delay: 3 },
        ],
      }),
      applied,
    ],
    [
      "refuses a frame the source doesn't have",
      animated({ frames: [{ key: "f", frame: 5, delay: 1 }] }),
      invalidDocument("invalid-frame"),
    ],
    [
      "refuses a frame before the first",
      animated({ frames: [{ key: "f", frame: -1, delay: 1 }] }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses a delay of 65,536 hundredths of a second",
      animated({ frames: [{ key: "f", frame: 0, delay: 65_536 }] }),
      invalidDocument("invalid-delay"),
    ],
    [
      "refuses a delay that isn't a whole number",
      animated({ frames: [{ key: "f", frame: 0, delay: 1.5 }] }),
      invalidDocument("invalid-delay"),
    ],
    [
      "refuses a delay as text",
      animated({ frames: [{ key: "f", frame: 0, delay: "10" }] }),
      invalidDocument("malformed-document"),
    ],
    ["refuses a loop count below 0", animated({ loop: -1 }), invalidDocument("invalid-loop")],
    ["refuses a loop count of 65,536", animated({ loop: 65_536 }), invalidDocument("invalid-loop")],
    [
      "refuses an animation with no frames",
      animated({ frames: [] }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses an animation without its loop count",
      document({ animation: { frames: ANIMATION.frames } }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses a frame with a field it doesn't have",
      animated({ frames: [{ key: "f", frame: 0, delay: 1, disposal: 2 }] }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses two frames with one key",
      animated({
        frames: [
          { key: "f", frame: 0, delay: 1 },
          { key: "f", frame: 1, delay: 1 },
        ],
      }),
      invalidDocument("duplicate-key"),
    ],
    [
      "refuses a frame with a layer's key",
      animated({ frames: [{ key: BASE.layers[0]?.key, frame: 0, delay: 1 }] }),
      invalidDocument("duplicate-key"),
    ],
    [
      "refuses an animation over a source with one frame",
      document({
        sources: { ...BASE.sources, s: { ...SIZE, frames: 1 } },
        animation: { loop: 0, frames: [{ key: "f", frame: 0, delay: 1 }] },
      }),
      invalidDocument("not-animated"),
    ],
    [
      "refuses a source with no frames",
      document({ sources: { ...BASE.sources, s: { ...SIZE, frames: 0 } } }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses a source with 4,097 frames",
      document({ sources: { ...BASE.sources, s: { ...SIZE, frames: 4_097 } } }),
      invalidDocument("malformed-document"),
    ],
    [
      "reads a drawing and an arrow",
      document({ layers: [...BASE.layers, DRAWING, ARROW] }),
      applied,
    ],
    [
      "refuses a drawing in a version 2 document, which has none",
      older({ version: 2, layers: [DRAWING] }),
      invalidDocument("unknown-layer-kind"),
    ],
    [
      "refuses an arrow in a version 2 document, which has none",
      older({ version: 2, layers: [ARROW] }),
      invalidDocument("unknown-layer-kind"),
    ],
    [
      "refuses a drawing with no strokes",
      document({ layers: [{ ...DRAWING, strokes: [] }] }),
      invalidDocument("empty-drawing"),
    ],
    [
      "refuses an arrow whose ends are one point",
      document({ layers: [{ ...ARROW, to: ARROW.from }] }),
      invalidDocument("empty-arrow"),
    ],
    [
      "refuses a run with an odd number of coordinates",
      document({
        layers: [{ ...DRAWING, strokes: [{ colour: "#000000", width: 1, runs: [[1, 2, 3]] }] }],
      }),
      invalidDocument("invalid-points"),
    ],
    [
      "refuses a point outside the scene, from its drawing's origin",
      document({
        layers: [
          {
            ...DRAWING,
            x: 65_000,
            strokes: [{ colour: "#000000", width: 1, runs: [[0, 0, 600, 0]] }],
          },
        ],
      }),
      invalidDocument("invalid-points"),
    ],
    [
      "refuses a stroke with no runs",
      document({ layers: [{ ...DRAWING, strokes: [{ colour: "#000000", width: 1, runs: [] }] }] }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses a drawing with a box",
      document({ layers: [{ ...DRAWING, width: 4, height: 4 }] }),
      invalidDocument("malformed-document"),
    ],
    [
      "reads redactions keyed __proto__, constructor and toString",
      document({
        redactions: ["__proto__", "constructor", "toString"].map((key) => ({
          ...BASE.redactions[1],
          key,
        })),
      }),
      applied,
    ],
    [
      "refuses two redactions with one key",
      document({ redactions: [BASE.redactions[0], { ...BASE.redactions[1], key: "face" }] }),
      invalidDocument("duplicate-key"),
    ],
    [
      "refuses more redactions than the format holds",
      document({
        redactions: Array.from({ length: 1_025 }, (_, index) => ({
          ...BASE.redactions[1],
          key: `r${index}`,
        })),
      }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses a redaction with a visibility",
      document({ redactions: [{ ...BASE.redactions[0], visible: false }] }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses a blurred redaction",
      document({ redactions: [{ ...BASE.redactions[1], mode: "blur" }] }),
      invalidDocument("unknown-redaction-mode"),
    ],
    [
      "refuses a redaction of no pixels",
      document({ redactions: [{ ...BASE.redactions[1], width: 0 }] }),
      invalidDocument("invalid-region"),
    ],
    [
      "refuses a colour that isn't #rrggbb",
      document({ redactions: [{ ...BASE.redactions[0], colour: "black" }] }),
      invalidDocument("invalid-colour"),
    ],
    [
      "refuses an empty key",
      document({ redactions: [{ ...BASE.redactions[1], key: "" }] }),
      invalidDocument("invalid-key"),
    ],
    ["reads a plan with no layers", document({ layers: [] }), applied],
    [
      "refuses a layer and a redaction with one key",
      document({ redactions: [{ ...BASE.redactions[0], key: "ring" }] }),
      invalidDocument("duplicate-key"),
    ],
    [
      "refuses a layer of an unknown kind",
      document({ layers: [{ ...BASE.layers[1], kind: "sticker" }] }),
      invalidDocument("unknown-layer-kind"),
    ],
    [
      "refuses a layer without every field of its kind",
      document({ layers: [{ key: "t", kind: "text" }] }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses an image layer whose source the document doesn't list",
      document({ layers: [{ ...BASE.layers[2], source: "u" }] }),
      invalidDocument("unknown-source"),
    ],
    [
      "refuses an image layer's crop outside its own source",
      document({ layers: [{ ...BASE.layers[2], crop: { x: 3_999, y: 0, width: 2, height: 1 } }] }),
      invalidDocument("crop-outside-source"),
    ],
    [
      "refuses text with a right-to-left override",
      document({ layers: [{ ...BASE.layers[0], text: "\u202Etxet" }] }),
      invalidDocument("invalid-text"),
    ],
    [
      "refuses text of 1,001 code points",
      document({ layers: [{ ...BASE.layers[0], text: "𝄞".repeat(1_001) }] }),
      invalidDocument("text-too-long"),
    ],
    [
      "refuses a shape with neither a fill nor a stroke",
      document({ layers: [{ ...BASE.layers[1], stroke: null }] }),
      invalidDocument("empty-shape"),
    ],
    [
      "refuses an opacity over 100",
      document({ layers: [{ ...BASE.layers[1], opacity: 150 }] }),
      invalidDocument("invalid-opacity"),
    ],
    [
      "refuses a layer without flipX",
      document({ layers: [{ ...BASE.layers[1], flipX: undefined }] }),
      invalidDocument("malformed-document"),
    ],
    [
      "refuses a layer whose flipX isn't a boolean",
      document({ layers: [{ ...BASE.layers[1], flipX: 0 }] }),
      invalidDocument("malformed-document"),
    ],
    [
      "reads a document whose layers are all mirrored",
      document({ layers: BASE.layers.map((layer) => ({ ...layer, flipX: true })) }),
      applied,
    ],
    [
      "refuses a box turned by 3600",
      document({ layers: [{ ...BASE.layers[1], rotation: 3_600, flipX: false }] }),
      invalidDocument("invalid-box"),
    ],
    [
      "refuses layers and redactions that are more than 1,024 together",
      document({
        layers: BASE.layers,
        redactions: Array.from({ length: 1_022 }, (_, index) => ({
          ...BASE.redactions[1],
          key: `r${index}`,
        })),
      }),
      invalidDocument("too-many-layers"),
    ],
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
      document({ version: 5 }),
      refused("unknown-format-version", "UNSUPPORTED_FORMAT"),
    ],
    ["refuses a list", [BASE], invalidDocument("malformed-document")],
    [
      "refuses a version that isn't a number",
      document({ version: "2" }),
      invalidDocument("malformed-document"),
    ],
    ["refuses an unknown field", document({ canvas: null }), invalidDocument("malformed-document")],
    [
      "refuses a missing field",
      { ...BASE, output: undefined },
      invalidDocument("malformed-document"),
    ],
    [
      "refuses a source of no pixels",
      document({ sources: { s: { width: 0, height: 30, frames: 1 } } }),
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

/** A geometry case, with its operation's tolerance where it has one. */
function tolerant(testCase: ConformanceCase): ConformanceCase {
  const tolerance = GEOMETRY_TOLERANCES[(testCase.input as { operation: string }).operation];
  return tolerance === undefined ? testCase : { ...testCase, tolerance };
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
  // Every point a turn, so none can go: what's kept is what the input is cut into.
  const zigzag = (count: number) =>
    Array.from({ length: count }, (_, i) => [i * 4, i % 2 === 0 ? 0 : 40]).flat();
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
    [
      "gives a small region blocks of 8 pixels",
      op("redactionBlockSize", { region: { width: 40, height: 20 } }),
    ],
    [
      "gives a region of 96 pixels blocks of 8, the last size before they grow",
      op("redactionBlockSize", { region: { width: 96, height: 10 } }),
    ],
    [
      "gives a strip a twelfth of its longer side, rounded up",
      op("redactionBlockSize", { region: { width: 30, height: 601 } }),
    ],
    [
      "tiles a region with blocks from its top-left corner, the last ones partial",
      op("redactionBlocksInScene", {
        region: { x: 10, y: 20, width: 20, height: 12 },
        within: whole,
      }),
    ],
    [
      "clips blocks to the crop, and leaves out those outside it",
      op("redactionBlocksInScene", {
        region: { x: 30, y: 20, width: 30, height: 30 },
        within: crop,
      }),
    ],
    [
      "gives no blocks for a region outside the crop",
      op("redactionBlocksInScene", { region: { x: 0, y: 0, width: 20, height: 20 }, within: crop }),
    ],
    [
      "tiles a region that starts outside the source",
      op("redactionBlocksInScene", {
        region: { x: -5, y: -5, width: 20, height: 20 },
        within: whole,
      }),
    ],
    [
      "maps a region to the same pixels at full size, upright",
      op("redactionRectInOutput", {
        region: { x: 50, y: 40, width: 30, height: 20 },
        crop: whole,
        orientation: upright,
        size: source,
      }),
    ],
    [
      "moves a region by the crop's corner",
      op("redactionRectInOutput", {
        region: { x: 50, y: 40, width: 30, height: 20 },
        crop,
        orientation: upright,
        size: { width: 200, height: 100 },
      }),
    ],
    [
      "rounds a region outward when the output is a third of the size",
      op("redactionRectInOutput", {
        region: { x: 50, y: 40, width: 30, height: 20 },
        crop: whole,
        orientation: upright,
        size: { width: 133, height: 100 },
      }),
    ],
    [
      "covers one output pixel for a region of one scene pixel, however small the output",
      op("redactionRectInOutput", {
        region: { x: 399, y: 299, width: 1, height: 1 },
        crop: whole,
        orientation: upright,
        size: { width: 4, height: 3 },
      }),
    ],
    [
      "turns a region with the image by 90 degrees",
      op("redactionRectInOutput", {
        region: { x: 50, y: 40, width: 30, height: 20 },
        crop: whole,
        orientation: turned,
        size: { width: 300, height: 400 },
      }),
    ],
    [
      "turns and mirrors a region inside a crop, at half size",
      op("redactionRectInOutput", {
        region: { x: 60, y: 50, width: 31, height: 21 },
        crop,
        orientation: mirrored,
        size: { width: 50, height: 100 },
      }),
    ],
    [
      "clips a region that reaches past the crop",
      op("redactionRectInOutput", {
        region: { x: 0, y: 0, width: 100, height: 100 },
        crop,
        orientation: upright,
        size: { width: 200, height: 100 },
      }),
    ],
    [
      "gives null for a region the crop leaves out",
      op("redactionRectInOutput", {
        region: { x: 0, y: 0, width: 40, height: 30 },
        crop,
        orientation: upright,
        size: { width: 200, height: 100 },
      }),
    ],
    [
      "gives null for a region outside the source",
      op("redactionRectInOutput", {
        region: { x: -50, y: -50, width: 20, height: 20 },
        crop: whole,
        orientation: upright,
        size: source,
      }),
    ],
    [
      "tiles the output's region with blocks, at full size",
      op("redactionBlocksInOutput", {
        region: { x: 10, y: 20, width: 20, height: 12 },
        crop: whole,
        orientation: upright,
        size: source,
      }),
    ],
    [
      "rounds the boundaries between blocks to the nearest pixel, and the region's edges outward",
      op("redactionBlocksInOutput", {
        region: { x: 10, y: 20, width: 100, height: 30 },
        crop: whole,
        orientation: upright,
        size: { width: 133, height: 100 },
      }),
    ],
    [
      "leaves out blocks that have no output pixel",
      op("redactionBlocksInOutput", {
        region: { x: 10, y: 20, width: 100, height: 30 },
        crop: whole,
        orientation: upright,
        size: { width: 8, height: 6 },
      }),
    ],
    [
      "turns and mirrors the blocks with the image",
      op("redactionBlocksInOutput", {
        region: { x: 60, y: 50, width: 40, height: 20 },
        crop,
        orientation: mirrored,
        size: { width: 100, height: 200 },
      }),
    ],
    [
      "gives no blocks for a region the crop leaves out",
      op("redactionBlocksInOutput", {
        region: { x: 0, y: 0, width: 40, height: 30 },
        crop,
        orientation: upright,
        size: { width: 200, height: 100 },
      }),
    ],
    [
      "places an unturned layer's box in the scene",
      op("layerToScene", {
        box: { x: 12, y: -7, width: 40, height: 20, rotation: 0, flipX: false },
      }),
    ],
    [
      "turns a layer a quarter clockwise about its centre, exactly",
      op("layerToScene", {
        box: { x: 10, y: 20, width: 40, height: 20, rotation: 900, flipX: false },
      }),
    ],
    [
      "mirrors a layer about its box's own vertical axis",
      op("layerToScene", {
        box: { x: 12, y: -7, width: 40, height: 20, rotation: 0, flipX: true },
      }),
    ],
    [
      "mirrors a layer, then turns it a quarter, exactly",
      op("layerToScene", {
        box: { x: 10, y: 20, width: 40, height: 20, rotation: 900, flipX: true },
      }),
    ],
    [
      "mirrors a layer, then turns it by 33.3 degrees",
      op("layerToScene", {
        box: { x: 10, y: 20, width: 40, height: 20, rotation: 333, flipX: true },
      }),
    ],
    [
      "maps a mirrored layer's box to a mirrored output, where it reads as it was drawn",
      op("layerToOutput", {
        box: { x: 60, y: 40, width: 80, height: 30, rotation: 0, flipX: true },
        crop: whole,
        orientation: { rotate: 0, flipX: true, flipY: false },
        size: source,
      }),
    ],
    [
      "maps the scene to the pixels of a mirrored layer's cropped source",
      op("sceneToLayerSource", {
        box: { x: 60, y: 40, width: 80, height: 60, rotation: 300, flipX: true },
        crop: { x: 4, y: 3, width: 30, height: 24 },
      }),
    ],
    [
      "turns a layer by 33.3 degrees",
      op("layerToScene", {
        box: { x: 10, y: 20, width: 40, height: 20, rotation: 333, flipX: false },
      }),
    ],
    [
      "maps the scene to an output at the composition's own size",
      op("sceneToOutput", { crop: whole, orientation: upright, size: source }),
    ],
    [
      "maps the scene through a crop, a quarter turn and a mirror, to half size",
      op("sceneToOutput", { crop, orientation: mirrored, size: { width: 50, height: 100 } }),
    ],
    [
      "maps a turned layer's box to a turned, cropped output",
      op("layerToOutput", {
        box: { x: 60, y: 40, width: 80, height: 30, rotation: 450, flipX: false },
        crop,
        orientation: turned,
        size: { width: 100, height: 200 },
      }),
    ],
    [
      "maps the scene to the pixels of a layer's cropped source",
      op("sceneToLayerSource", {
        box: { x: 60, y: 40, width: 80, height: 60, rotation: 300, flipX: false },
        crop: { x: 4, y: 3, width: 30, height: 24 },
      }),
    ],
    [
      "fits one line to a box's width, centred down it",
      op("fitTextLines", {
        lines: [{ width: 300 }],
        lineHeight: 120,
        ascent: 90,
        size: { width: 150, height: 200 },
        align: "start",
        rightToLeft: false,
      }),
    ],
    [
      "fits three lines to a box's height, each aligned to the end",
      op("fitTextLines", {
        lines: [{ width: 300 }, { width: 120 }, { width: 0 }],
        lineHeight: 120,
        ascent: 90,
        size: { width: 400, height: 90 },
        align: "end",
        rightToLeft: false,
      }),
    ],
    [
      "puts the start of right-to-left text at the box's right edge",
      op("fitTextLines", {
        lines: [{ width: 100 }, { width: 50 }],
        lineHeight: 100,
        ascent: 80,
        size: { width: 400, height: 100 },
        align: "start",
        rightToLeft: true,
      }),
    ],
    [
      "gives null for text whose lines are all empty",
      op("fitTextLines", {
        lines: [{ width: 0 }, { width: 0 }],
        lineHeight: 100,
        ascent: 80,
        size: { width: 400, height: 100 },
        align: "center",
        rightToLeft: false,
      }),
    ],
    ["reads Latin text left to right", op("isRightToLeft", { text: "Hello" })],
    ["reads Hebrew text right to left", op("isRightToLeft", { text: "שלום" })],
    [
      "takes the direction of the first letter that has one, after digits and emoji",
      op("isRightToLeft", { text: "123 📷 مرحبا abc" }),
    ],
    ["reads text with no letters left to right", op("isRightToLeft", { text: "42 📷" })],
    [
      "shows a region where the crop puts it",
      op("sceneRectToComposition", {
        region: { x: 50, y: 40, width: 30, height: 20 },
        crop,
        orientation: upright,
      }),
    ],
    [
      "shows a region turned and mirrored with the image, and reaching outside it",
      op("sceneRectToComposition", {
        region: { x: -10, y: 20, width: 80, height: 20 },
        crop,
        orientation: mirrored,
      }),
    ],
    [
      "maps a rectangle on a turned composition back to the scene",
      op("compositionRectToScene", {
        region: { x: 240, y: 50, width: 20, height: 30 },
        crop: whole,
        orientation: turned,
      }),
    ],
    [
      "fits a dragged rectangle outward to whole pixels",
      op("fitRedactionRegion", { region: { x: 1.2, y: 2.8, width: 3.1, height: 0.1 } }),
    ],
    [
      "fits an empty rectangle as one pixel",
      op("fitRedactionRegion", { region: { x: 5, y: 5, width: 0, height: 0 } }),
    ],
    [
      "keeps a rectangle within 65,536 pixels of the origin",
      op("fitRedactionRegion", { region: { x: -70000, y: 70000, width: 200000, height: 10 } }),
    ],
    // Strokes and arrows (docs/adr/0014).
    [
      "simplifies a run of collinear points to its ends",
      op("simplifyStroke", { points: [0, 0, 1, 1, 2, 2, 5, 5, 9, 9], tolerance: 0 }),
    ],
    [
      "drops repeated points",
      op("simplifyStroke", { points: [0, 0, 0, 0, 5, 0, 5, 0, 5, 5], tolerance: 0 }),
    ],
    ["makes a single point a dot", op("simplifyStroke", { points: [7, -2], tolerance: 3 })],
    ["makes two equal points one", op("simplifyStroke", { points: [3, 4, 3, 4], tolerance: 1 })],
    [
      "drops a point within the tolerance of the segment",
      op("simplifyStroke", { points: [0, 0, 10, 2, 20, 0], tolerance: 2 }),
    ],
    [
      "keeps a point farther than the tolerance",
      op("simplifyStroke", { points: [0, 0, 10, 3, 20, 0], tolerance: 2 }),
    ],
    [
      "keeps the turn of a stroke that doubles back: distance is to the segment",
      op("simplifyStroke", { points: [0, 0, 30, 0, 10, 0], tolerance: 5 }),
    ],
    [
      "keeps a closed loop's corners, measured from the point both ends are",
      op("simplifyStroke", { points: [0, 0, 8, 0, 8, 8, 0, 8, 0, 0], tolerance: 3 }),
    ],
    [
      "takes the first of two points equally far, which leaves the second within the tolerance",
      op("simplifyStroke", { points: [0, 0, 4, 3, 6, 3, 10, 0], tolerance: 2 }),
    ],
    [
      "keeps a point one pixel off a segment across the whole scene, with no tolerance",
      op("simplifyStroke", {
        points: [-65_536, -65_536, 0, 1, 65_536, 65_536],
        tolerance: 0,
      }),
    ],
    [
      "drops that point with a tolerance of one pixel",
      op("simplifyStroke", {
        points: [-65_536, -65_536, 0, 1, 65_536, 65_536],
        tolerance: 1,
      }),
    ],
    ["keeps 2,000 turns as one run", op("simplifyStroke", { points: zigzag(2_000), tolerance: 1 })],
    [
      "cuts 2,001 samples into two runs that share a point",
      op("simplifyStroke", { points: zigzag(2_001), tolerance: 1 }),
    ],
    [
      "cuts 4,500 samples into three runs",
      op("simplifyStroke", { points: zigzag(4_500), tolerance: 1 }),
    ],
    [
      "outlines an arrow along x: a head four widths long and across",
      op("arrowOutline", { from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, width: 4 }),
    ],
    [
      "outlines an arrow down the image",
      op("arrowOutline", { from: { x: 10, y: 10 }, to: { x: 10, y: 60 }, width: 2 }),
    ],
    [
      "outlines an arrow at a diagonal",
      op("arrowOutline", { from: { x: 0, y: 0 }, to: { x: 30, y: 40 }, width: 3 }),
    ],
    [
      "outlines an arrow shorter than its head: all head",
      op("arrowOutline", { from: { x: 0, y: 0 }, to: { x: 8, y: 0 }, width: 4 }),
    ],
    [
      "outlines an arrow across the whole scene",
      op("arrowOutline", {
        from: { x: -65_536, y: -65_536 },
        to: { x: 65_536, y: 65_536 },
        width: 1_024,
      }),
    ],
    [
      "bounds a drawing by its points and its strokes' widths",
      op("drawingBounds", { drawing: DRAWING }),
    ],
    [
      "bounds a dot",
      op("drawingBounds", {
        drawing: { x: 0, y: 0, strokes: [{ colour: "#000000", width: 3, runs: [[0, 0]] }] },
      }),
    ],
    ["bounds an arrow by its outline", op("arrowBounds", { arrow: ARROW })],
    [
      "counts a plan's drawing points, across runs and strokes",
      op("drawingPoints", { layers: [DRAWING, ARROW, { ...DRAWING, key: "again" }] }),
    ],
    ["counts no points in a plan with no drawings", op("drawingPoints", { layers: [ARROW] })],
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
  const layerBox = fc.record({
    x: fc.integer({ min: -60, max: 420 }),
    y: fc.integer({ min: -60, max: 320 }),
    width: fc.integer({ min: 1, max: 300 }),
    height: fc.integer({ min: 1, max: 300 }),
    rotation: fc.integer({ min: 0, max: 3_599 }),
    flipX: fc.boolean(),
  });
  // A stroke's samples: a walk of a few points, with repeats and straight runs among them.
  const scenePoint = fc.record({
    x: fc.integer({ min: -200, max: 200 }),
    y: fc.integer({ min: -200, max: 200 }),
  });
  const samples = fc
    .array(fc.tuple(fc.integer({ min: -3, max: 3 }), fc.integer({ min: -3, max: 3 })), {
      minLength: 1,
      maxLength: 16,
    })
    .map((steps) => {
      let x = 0;
      let y = 0;
      return steps.flatMap(([dx, dy]) => {
        x += dx * 3;
        y += dy * 3;
        return [x, y];
      });
    });
  const penStroke = fc.record({
    colour: fc.constantFrom("#000000", "#ff8800"),
    width: fc.integer({ min: 1, max: 30 }),
    runs: fc.array(samples, { minLength: 1, maxLength: 2 }),
  });
  const drawingArb = fc.record({
    x: fc.integer({ min: -60, max: 420 }),
    y: fc.integer({ min: -60, max: 320 }),
    strokes: fc.array(penStroke, { minLength: 1, maxLength: 3 }),
  });
  const arrowArb = fc
    .record({ from: scenePoint, to: scenePoint, width: fc.integer({ min: 1, max: 40 }) })
    .filter(({ from, to }) => from.x !== to.x || from.y !== to.y);
  // A region near the 400 × 300 source, sometimes partly or wholly outside it.
  const region = fc.record({
    x: fc.integer({ min: -60, max: 420 }),
    y: fc.integer({ min: -60, max: 320 }),
    width: fc.integer({ min: 1, max: 300 }),
    height: fc.integer({ min: 1, max: 300 }),
  });
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
    redactionBlockSize: fc.record({ region: size }),
    redactionBlocksInScene: fc.record({ region, within: cropArb }),
    redactionRectInOutput: fc.record({ region, crop: cropArb, orientation, size }),
    redactionBlocksInOutput: fc.record({ region, crop: cropArb, orientation, size }),
    sceneRectToComposition: fc.record({ region, crop: cropArb, orientation }),
    compositionRectToScene: fc.record({ region, crop: cropArb, orientation }),
    sceneToOutput: fc.record({ crop: cropArb, orientation, size }),
    layerToScene: fc.record({ box: layerBox }),
    layerToOutput: fc.record({ box: layerBox, crop: cropArb, orientation, size }),
    sceneToLayerSource: fc.record({ box: layerBox, crop: cropArb }),
    fitTextLines: fc.record({
      lines: fc.array(fc.record({ width: fc.integer({ min: 0, max: 900 }) }), {
        minLength: 1,
        maxLength: 4,
      }),
      lineHeight: fc.constant(120),
      ascent: fc.constant(90),
      size,
      align: fc.constantFrom("start", "center", "end"),
      rightToLeft: fc.boolean(),
    }),
    isRightToLeft: fc.record({
      text: fc
        .array(fc.constantFrom("a", "Z", "1", " ", "📷", "ש", "ع", "中", "…"), { maxLength: 5 })
        .map((parts) => parts.join("")),
    }),
    simplifyStroke: fc.record({ points: samples, tolerance: fc.integer({ min: 0, max: 6 }) }),
    arrowOutline: arrowArb,
    drawingBounds: fc.record({ drawing: drawingArb }),
    arrowBounds: fc.record({ arrow: arrowArb }),
    drawingPoints: fc.record({
      layers: fc.array(
        fc.oneof(
          drawingArb.map((drawing) => ({ kind: "drawing", ...drawing })),
          fc.constant({ kind: "arrow" }),
        ),
        { maxLength: 3 },
      ),
    }),
    fitRedactionRegion: fc.record({
      region: fc.record({
        x: fc.integer({ min: -4_000, max: 4_000 }).map((n) => n / 8),
        y: fc.integer({ min: -4_000, max: 4_000 }).map((n) => n / 8),
        width: fc.integer({ min: 0, max: 4_000 }).map((n) => n / 8),
        height: fc.integer({ min: 0, max: 4_000 }).map((n) => n / 8),
      }),
    }),
  };
  const generated = GEOMETRY_OPERATIONS.flatMap((operation) => {
    const arbitrary = arbitraries[operation];
    if (!arbitrary) throw new Error(`No generator for ${operation}.`);
    return fc
      .sample(arbitrary, { seed: SEED, numRuns: GENERATED_PER_OPERATION })
      .map((args, index) =>
        tolerant(make(`generated ${operation} ${index + 1}`, op(operation, args), geometry)),
      );
  });
  return {
    format: "hm-conformance",
    version: 1,
    subject: "hm-image-geometry",
    description:
      "image-sdk's geometry (docs/formats/hm-image-plan.md): input.operation names a function and the other fields are its arguments, with null for a missing ratio; expected is its result, exactly, or within the case's tolerance where it states one. Sizes, crops and points are in pixels of the oriented source or of the composition. Results are rounded as JavaScript's Math.round does, halves toward positive infinity. Generated cases come from fixed-seed generators.",
    cases: [
      ...handWritten.map(([name, input]) => tolerant(make(name, input, geometry))),
      ...generated,
    ],
  };
}
