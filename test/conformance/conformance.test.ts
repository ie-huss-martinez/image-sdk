import { readFileSync } from "node:fs";
import {
  type ConformanceCase,
  describeConformance,
  readConformance,
} from "@hussmartinez/sdk-config/testing/conformance";
import { Ajv2020 } from "ajv/dist/2020.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createPlan, type ImagePlan, toImagePlanDocument } from "../../src/index.js";
import { commandOn, mutated, plan as planArb, SIZE } from "../arbitraries/image-plan.js";
import { commandCases, geometryCases, planCases } from "./generate.js";
import { applyToDocument, geometry, readAndWrite } from "./run.js";

/**
 * The conformance vectors (sdk-core ADR 0045): the same files a port in
 * another language runs, checked here against the TypeScript SDK, plus the
 * rule that the runtime validators accept only what the schemas accept.
 */

const COMMANDS = new URL("../../conformance/hm-image-commands.json", import.meta.url);
const PLANS = new URL("../../conformance/hm-image-plan.json", import.meta.url);
const GEOMETRY = new URL("../../conformance/hm-image-geometry.json", import.meta.url);

/**
 * The characters sdk-config's `hm-check-hidden-unicode` refuses (sdk-core ADR
 * 0052): ones an editor and a diff don't show, or that reorder the text
 * around them. Some vectors hold them on purpose, to test that commands
 * refuse them, so the files write them as JSON escapes, which parse to the
 * same strings.
 */
const HIDDEN =
  /[\u00AD\u061C\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/gu;
/** A character as JSON escapes, one per UTF-16 code unit. */
const escaped = (character: string) =>
  Array.from(
    { length: character.length },
    (_, index) => `\\u${character.charCodeAt(index).toString(16).toUpperCase().padStart(4, "0")}`,
  ).join("");

const text = (value: unknown) => `${JSON.stringify(value, null, 2).replace(HIDDEN, escaped)}\n`;

// It generates every vector again: thousands of sampled plans and commands,
// 4 MB of cases. That's work, not waiting: about 1.2 s at a load of 4 on
// 2026-11-21, within the family's 30 s for a unit test even at the 16 times
// slowdown reported under load (sdk-core ADR 0057).
it("keeps the checked-in cases up to date with their generator", async () => {
  // `pnpm conformance:update` rewrites them.
  await expect(text(planCases())).toMatchFileSnapshot("../../conformance/hm-image-plan.json");
  await expect(text(commandCases())).toMatchFileSnapshot(
    "../../conformance/hm-image-commands.json",
  );
  await expect(text(geometryCases())).toMatchFileSnapshot(
    "../../conformance/hm-image-geometry.json",
  );
});

describeConformance(PLANS, readAndWrite);
describeConformance(COMMANDS, applyToDocument);
describeConformance(GEOMETRY, geometry);

const ajv = new Ajv2020({ allErrors: true, strict: true });
const schema = (path: string) =>
  JSON.parse(readFileSync(new URL(`../../formats/${path}`, import.meta.url), "utf8")) as object;
const FORMATS = "https://github.com/ie-huss-martinez/image-sdk/blob/main/formats";
// Every version's schemas: a reader reads them all, and writes the latest.
for (const version of [1, 2, 3, 4]) ajv.addSchema(schema(`hm-image-plan/v${version}.schema.json`));
const planSchema = (version: number) =>
  ajv.getSchema(`${FORMATS}/hm-image-plan/v${version}.schema.json`) as (value: unknown) => boolean;
const planValid = planSchema(4);
const commandValid = ajv.compile(schema("hm-image-command/v4.schema.json"));
const commandValidV3 = ajv.compile(schema("hm-image-command/v3.schema.json"));
const commandValidV2 = ajv.compile(schema("hm-image-command/v2.schema.json"));
const commandValidV1 = ajv.compile(schema("hm-image-command/v1.schema.json"));

/** The schema of the version a document names, or the latest for one that names none. */
const validForItsVersion = (document: unknown) => {
  const version = (document as { version?: unknown } | null)?.version;
  return version === 1 || version === 2 || version === 3
    ? planSchema(version)(document)
    : planValid(document);
};

/** The commands that only undo others: the reducer applies them, the format leaves them out. */
const INVERSE_ONLY = new Set([
  "image.restoreLayers",
  "image.setLayerOrder",
  "image.restoreStrokes",
  "image.restoreRedactions",
  "image.setRedactionOrder",
  "image.restoreFrames",
  "image.setFrameOrder",
]);

/**
 * Refusals the schemas express themselves. The others, a crop outside its
 * source and a source the document doesn't list, depend on the plan, which
 * a schema can't see, so the schema accepts those documents and commands.
 */
const STRUCTURAL = new Set([
  "malformed-command",
  "malformed-document",
  "unknown-command",
  "unknown-format",
  "unknown-format-version",
  "invalid-orientation",
  "invalid-output",
  "unknown-metadata-field",
  "metadata-too-long",
  "unknown-adjustment",
  "invalid-level",
  "unknown-preset",
  "invalid-strength",
  "invalid-key",
  "unknown-redaction-mode",
  "invalid-region",
  "invalid-colour",
  "unknown-layer-kind",
  "invalid-box",
  "invalid-opacity",
  "invalid-text",
  "text-too-long",
  "invalid-delay",
  "invalid-loop",
]);

const refusal = ({ expected }: ConformanceCase) =>
  (expected as { error?: { reason: string } }).error?.reason;

describe("the format schemas agree with the readers", () => {
  it("accept every document a reader accepts, and refuse every structural refusal", () => {
    for (const testCase of readConformance(PLANS).cases) {
      const reason = refusal(testCase);
      const structural = reason !== undefined && STRUCTURAL.has(reason);
      expect(validForItsVersion(testCase.input), testCase.name).toBe(!structural);
    }
  });

  it("accept every command the reducer applies, and refuse every structural refusal", () => {
    for (const testCase of readConformance(COMMANDS).cases) {
      const { plan, command: cmd } = testCase.input as { plan: unknown; command: unknown };
      expect(planValid(plan), testCase.name).toBe(true);
      const reason = refusal(testCase);
      const structural = reason !== undefined && STRUCTURAL.has(reason);
      expect(commandValid(cmd), testCase.name).toBe(!structural);
    }
  });

  it("keep each version's commands valid in the next, unchanged", () => {
    for (const testCase of readConformance(COMMANDS).cases) {
      const { command: cmd } = testCase.input as { command: unknown };
      if (commandValidV1(cmd)) expect(commandValidV2(cmd), testCase.name).toBe(true);
      if (commandValidV2(cmd)) expect(commandValidV3(cmd), testCase.name).toBe(true);
      if (commandValidV3(cmd)) expect(commandValid(cmd), testCase.name).toBe(true);
    }
  });

  const sources = { s: { ...SIZE } };

  it("never let the reducer apply a user command the schema refuses", () => {
    const inner = (state: ImagePlan) =>
      commandOn(state).chain((valid) => {
        const [field, value] = Object.entries(valid)[1] ?? [];
        if (field === undefined || typeof value !== "object" || value === null) {
          return fc.constant(valid as unknown);
        }
        return mutated(fc.constant(value)).map((changed) => ({ ...valid, [field]: changed }));
      });
    const cases = planArb.chain((state) =>
      fc.tuple(fc.constant(state), fc.oneof(mutated(commandOn(state)), inner(state))),
    );
    fc.assert(
      fc.property(cases, ([state, cmd]) => {
        // An inverse is the reducer's own, and isn't in the format.
        if (INVERSE_ONLY.has((cmd as { type?: unknown }).type as string)) return;
        const plan = toImagePlanDocument(state, sources);
        let applied = true;
        try {
          applyToDocument({ plan, command: cmd });
        } catch {
          applied = false;
        }
        if (applied) expect(commandValid(cmd)).toBe(true);
      }),
      { numRuns: 2_000 },
    );
  });

  it("agree on which characters text can hold", () => {
    // The reducer's check and the schema's pattern are written apart: they
    // must refuse the same characters, at every boundary of every range.
    const text = ajv.compile({
      $ref: `${FORMATS}/hm-image-plan/v2.schema.json#/$defs/text`,
    });
    const layer = (value: string) => ({
      key: "t",
      kind: "text",
      name: "",
      visible: true,
      opacity: 100,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      rotation: 0,
      flipX: false,
      text: value,
      font: "serif",
      bold: false,
      colour: "#000000",
      align: "start",
    });
    const accepted = (value: string) => {
      try {
        applyToDocument({
          plan: toImagePlanDocument(createPlan("s"), sources),
          command: { type: "image.insertLayers", at: 0, layers: [layer(value)] },
        });
        return true;
      } catch {
        return false;
      }
    };
    // Every code point near a refused range, and a sample of the rest.
    const near = [
      0x00, 0x09, 0x0a, 0x0b, 0x1f, 0x20, 0x7e, 0x7f, 0x80, 0x2029, 0x202a, 0x202e, 0x202f, 0x2065,
      0x2066, 0x2069, 0x206a,
    ];
    for (let code = 0; code <= 0x2100; code += 1) {
      const value = String.fromCodePoint(code);
      expect(accepted(value), `U+${code.toString(16)}`).toBe(text(value));
    }
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.constantFrom(...near), fc.integer({ min: 0, max: 0x10ffff })), {
          maxLength: 6,
        }),
        (codes) => {
          // Lone surrogates aren't code points a JSON document carries.
          const value = String.fromCodePoint(
            ...codes.filter((code) => code < 0xd800 || code > 0xdfff),
          );
          expect(accepted(value)).toBe(text(value));
        },
      ),
      { numRuns: 1_000 },
    );
  });

  it("never let the reader accept a document the schema refuses", () => {
    const document = planArb.map((state) => toImagePlanDocument(state, sources));
    const nested = document.chain((value) =>
      fc.constantFrom("base", "output", "metadata" as const).chain((part) =>
        mutated(fc.constant(value[part] as object)).map((changed) => ({
          ...value,
          [part]: changed,
        })),
      ),
    );
    // One redaction with a field replaced or added, where the document has any.
    const redacted = document.chain((value) =>
      value.redactions.length === 0
        ? fc.constant(value as unknown)
        : fc.nat(value.redactions.length - 1).chain((index) =>
            mutated(fc.constant(value.redactions[index] as object)).map((changed) => ({
              ...value,
              redactions: value.redactions.map((item, at) => (at === index ? changed : item)),
            })),
          ),
    );
    // One layer with a field replaced or added, where the document has any.
    const layered = document.chain((value) =>
      value.layers.length === 0
        ? fc.constant(value as unknown)
        : fc.nat(value.layers.length - 1).chain((index) =>
            mutated(fc.constant(value.layers[index] as object)).map((changed) => ({
              ...value,
              layers: value.layers.map((item, at) => (at === index ? changed : item)),
            })),
          ),
    );
    // The animation, or one of its frames, with a field replaced or added, where there is one.
    const animated = document.chain((value) => {
      const { animation } = value;
      if (animation === null) return fc.constant(value as unknown);
      return fc.oneof(
        mutated(fc.constant(animation as object)).map((changed) => ({
          ...value,
          animation: changed,
        })),
        fc.nat(animation.frames.length - 1).chain((index) =>
          mutated(fc.constant(animation.frames[index] as object)).map((changed) => ({
            ...value,
            animation: {
              ...animation,
              frames: animation.frames.map((item, at) => (at === index ? changed : item)),
            },
          })),
        ),
      );
    });
    // A source with a field replaced or added, such as its frame count.
    const sourced = document.chain((value) =>
      mutated(fc.constant(value.sources["s"] as object)).map((changed) => ({
        ...value,
        sources: { s: changed },
      })),
    );
    fc.assert(
      fc.property(
        fc.oneof(mutated(document), nested, redacted, layered, animated, sourced),
        (value) => {
          let accepted = true;
          try {
            readAndWrite(value);
          } catch {
            accepted = false;
          }
          if (accepted) expect(planValid(value)).toBe(true);
        },
      ),
      { numRuns: 2_000 },
    );
  });
});
