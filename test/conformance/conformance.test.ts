import { readFileSync } from "node:fs";
import {
  type ConformanceCase,
  describeConformance,
  readConformance,
} from "@hussmartinez/sdk-config/testing/conformance";
import { Ajv2020 } from "ajv/dist/2020.js";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { toImagePlanDocument } from "../../src/index.js";
import { command, mutated, plan as planArb, SIZE } from "../arbitraries/image-plan.js";
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
ajv.addSchema(schema("hm-image-plan/v1.schema.json"));
const planValid = ajv.getSchema(
  "https://github.com/ie-huss-martinez/image-sdk/blob/main/formats/hm-image-plan/v1.schema.json",
) as (value: unknown) => boolean;
const commandValid = ajv.compile(schema("hm-image-command/v1.schema.json"));

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
]);

const refusal = ({ expected }: ConformanceCase) =>
  (expected as { error?: { reason: string } }).error?.reason;

describe("the format schemas agree with the readers", () => {
  it("accept every document a reader accepts, and refuse every structural refusal", () => {
    for (const testCase of readConformance(PLANS).cases) {
      const reason = refusal(testCase);
      const structural = reason !== undefined && STRUCTURAL.has(reason);
      expect(planValid(testCase.input), testCase.name).toBe(!structural);
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

  const sources = { s: { ...SIZE } };

  it("never let the reducer apply a command the schema refuses", () => {
    const inner = command.chain((valid) => {
      const [field, value] = Object.entries(valid)[1] ?? [];
      if (field === undefined || typeof value !== "object" || value === null) {
        return fc.constant(valid as unknown);
      }
      return mutated(fc.constant(value)).map((changed) => ({ ...valid, [field]: changed }));
    });
    fc.assert(
      fc.property(planArb, fc.oneof(mutated(command), inner), (state, cmd) => {
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
    fc.assert(
      fc.property(fc.oneof(mutated(document), nested), (value) => {
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
