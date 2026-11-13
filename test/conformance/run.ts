import { conforms } from "@hussmartinez/sdk-config/testing/conformance";
import { createImageReducer } from "../../src/core/operations/commands.js";
import {
  type ImageCommand,
  type ImagePlanDocument,
  readImagePlanDocument,
  toImagePlanDocument,
} from "../../src/index.js";

/**
 * How the TypeScript SDK runs each conformance subject: what a port in
 * another language implements too (sdk-core ADR 0045). There's one runner
 * per subject, shared by the generator that writes the cases and the tests
 * that check them.
 */

/** `hm-image-plan`: a document read and written back, as a reader normalises it. */
export function readAndWrite(document: unknown): ImagePlanDocument {
  const { plan, sources } = readImagePlanDocument(document);
  return toImagePlanDocument(plan, sources);
}

/**
 * `hm-image-commands`: a command applied to a plan document, giving the new
 * document. Its inverse must restore the plan exactly, though the inverse's
 * own shape is internal and isn't compared.
 */
export function applyToDocument(input: { plan: unknown; command: unknown }): ImagePlanDocument {
  const { plan, sources } = readImagePlanDocument(input.plan);
  const reduce = createImageReducer((id) => (Object.hasOwn(sources, id) ? sources[id] : undefined));
  const { state, inverse } = reduce(plan, input.command as ImageCommand);
  const undone = reduce(state, inverse).state;
  if (!conforms(toImagePlanDocument(undone, sources), toImagePlanDocument(plan, sources))) {
    throw new Error("The command's inverse didn't restore the plan.");
  }
  return toImagePlanDocument(state, sources);
}
