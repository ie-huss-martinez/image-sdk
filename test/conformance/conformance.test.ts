import { readFileSync } from "node:fs";
import {
  type ConformanceCase,
  describeConformance,
  readConformance,
} from "@hussmartinez/sdk-config/testing/conformance";
import { Ajv2020 } from "ajv/dist/2020.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type ImagePlan, toImagePlanDocument } from "../../src/index.js";
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

const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

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
for (const version of [1, 2]) ajv.addSchema(schema(`hm-image-plan/v${version}.schema.json`));
const planSchema = (version: number) =>
  ajv.getSchema(`${FORMATS}/hm-image-plan/v${version}.schema.json`) as (value: unknown) => boolean;
const planValid = planSchema(2);
const commandValid = ajv.compile(schema("hm-image-command/v2.schema.json"));
const commandValidV1 = ajv.compile(schema("hm-image-command/v1.schema.json"));

/** The schema of the version a document names, or the latest for one that names none. */
const validForItsVersion = (document: unknown) =>
  (document as { version?: unknown } | null)?.version === 1
    ? planSchema(1)(document)
    : planValid(document);

/** The commands that only undo others: the reducer applies them, the format leaves them out. */
const INVERSE_ONLY = new Set(["image.restoreRedactions", "image.setRedactionOrder"]);

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

  it("keep version 1's commands valid in version 2, unchanged", () => {
    for (const testCase of readConformance(COMMANDS).cases) {
      const { command: cmd } = testCase.input as { command: unknown };
      if (commandValidV1(cmd)) expect(commandValid(cmd), testCase.name).toBe(true);
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
    fc.assert(
      fc.property(fc.oneof(mutated(document), nested, redacted), (value) => {
        let accepted = true;
        try {
          readAndWrite(value);
        } catch {
          accepted = false;
        }
        if (accepted) expect(planValid(value)).toBe(true);
      }),
      { numRuns: 2_000 },
    );
  });
});
