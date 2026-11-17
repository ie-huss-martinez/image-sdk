import { conforms } from "@hussmartinez/sdk-config/testing/conformance";
import {
  aspectRatio,
  compositionDeltaToSource,
  cropInComposition,
  dragHandle,
  fitAspect,
  handleInSource,
  moveCrop,
  nudgeCropOnScreen,
} from "../../src/core/model/crop.js";
import {
  arrowBounds,
  arrowOutline,
  drawingBounds,
  drawingPoints,
  simplifyStroke,
} from "../../src/core/model/drawing-geometry.js";
import {
  compositionSize,
  compositionToSource,
  orientedSize,
  outputSize,
  sourceToComposition,
} from "../../src/core/model/geometry.js";
import {
  fitTextLines,
  isRightToLeft,
  layerToOutput,
  layerToScene,
  sceneToLayerSource,
  sceneToOutput,
} from "../../src/core/model/layer-geometry.js";
import type { ImagePlan } from "../../src/core/model/plan.js";
import {
  compositionRectToScene,
  fitRedactionRegion,
  redactionBlockSize,
  redactionBlocksInOutput,
  redactionBlocksInScene,
  redactionRectInOutput,
  sceneRectToComposition,
} from "../../src/core/model/redaction-geometry.js";
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

/** Every argument a geometry case may name; each operation reads its own. */
type GeometryArgument =
  | "stored"
  | "orientation"
  | "source"
  | "crop"
  | "output"
  | "composition"
  | "point"
  | "aspect"
  | "within"
  | "ratio"
  | "dx"
  | "dy"
  | "handle"
  | "key"
  | "step"
  | "resize"
  | "region"
  | "size"
  | "box"
  | "lines"
  | "lineHeight"
  | "ascent"
  | "align"
  | "rightToLeft"
  | "text"
  | "points"
  | "tolerance"
  | "from"
  | "to"
  | "width"
  | "drawing"
  | "arrow"
  | "layers";
type GeometryArguments = { readonly [Name in GeometryArgument]: never };

/** The geometry functions a port implements, by the name a case gives. */
const GEOMETRY: Readonly<Record<string, (input: GeometryArguments) => unknown>> = {
  orientedSize: ({ stored, orientation }) => orientedSize(stored, orientation),
  compositionSize: ({ source, crop, orientation }) =>
    compositionSize({ base: { source: "s", crop, orientation } } as unknown as ImagePlan, source),
  outputSize: ({ output, composition }) => outputSize(output, composition),
  sourceToComposition: ({ point, crop, orientation }) =>
    sourceToComposition(point, crop, orientation),
  compositionToSource: ({ point, crop, orientation }) =>
    compositionToSource(point, crop, orientation),
  aspectRatio: ({ aspect, source }) => aspectRatio(aspect, source) ?? null,
  fitAspect: ({ within, ratio }) => fitAspect(within, ratio ?? undefined),
  moveCrop: ({ crop, dx, dy, source }) => moveCrop(crop, dx, dy, source),
  dragHandle: ({ crop, handle, dx, dy, source, ratio }) =>
    dragHandle(crop, handle, dx, dy, source, ratio ?? undefined),
  cropInComposition: ({ crop, orientation, source }) =>
    cropInComposition(crop, orientation, source),
  compositionDeltaToSource: ({ dx, dy, orientation, source }) =>
    compositionDeltaToSource(dx, dy, orientation, source),
  handleInSource: ({ handle, orientation }) => handleInSource(handle, orientation),
  nudgeCropOnScreen: ({ crop, key, step, resize, orientation, source, ratio }) =>
    nudgeCropOnScreen(crop, key, step, resize, orientation, source, ratio ?? undefined),
  redactionBlockSize: ({ region }) => redactionBlockSize(region),
  redactionBlocksInScene: ({ region, within }) => redactionBlocksInScene(region, within),
  redactionRectInOutput: ({ region, crop, orientation, size }) =>
    redactionRectInOutput(region, crop, orientation, size),
  redactionBlocksInOutput: ({ region, crop, orientation, size }) =>
    redactionBlocksInOutput(region, crop, orientation, size),
  sceneRectToComposition: ({ region, crop, orientation }) =>
    sceneRectToComposition(region, crop, orientation),
  compositionRectToScene: ({ region, crop, orientation }) =>
    compositionRectToScene(region, crop, orientation),
  fitRedactionRegion: ({ region }) => fitRedactionRegion(region),
  sceneToOutput: ({ crop, orientation, size }) => sceneToOutput(crop, orientation, size),
  layerToScene: ({ box }) => layerToScene(box),
  layerToOutput: ({ box, crop, orientation, size }) => layerToOutput(box, crop, orientation, size),
  sceneToLayerSource: ({ box, crop }) => sceneToLayerSource(box, crop),
  fitTextLines: ({ lines, lineHeight, ascent, size, align, rightToLeft }) =>
    fitTextLines(lines, lineHeight, ascent, size, align, rightToLeft),
  isRightToLeft: ({ text }) => isRightToLeft(text),
  simplifyStroke: ({ points, tolerance }) => simplifyStroke(points, tolerance),
  arrowOutline: ({ from, to, width }) => arrowOutline(from, to, width),
  drawingBounds: ({ drawing }) => drawingBounds(drawing),
  arrowBounds: ({ arrow }) => arrowBounds(arrow),
  drawingPoints: ({ layers }) => drawingPoints({ layers }),
};

/** The names of the geometry operations, in the order the vectors list them. */
export const GEOMETRY_OPERATIONS = Object.keys(GEOMETRY);

/**
 * `hm-image-geometry`: one geometry function, named by `operation`, applied
 * to the case's other fields. A missing ratio is `null` in JSON.
 */
export function geometry(input: { operation: string } & Record<string, unknown>): unknown {
  const { operation, ...args } = input;
  const run = Object.hasOwn(GEOMETRY, operation) ? GEOMETRY[operation] : undefined;
  if (!run) throw new Error(`Unknown geometry operation ${operation}.`);
  return run(args as GeometryArguments);
}

/**
 * The geometry operations whose results are computed with sines, cosines
 * and divisions, and so may differ between languages in their last bits
 * (sdk-core ADR 0045, section 3): their cases state this tolerance.
 */
export const GEOMETRY_TOLERANCES: Readonly<Record<string, number>> = {
  sceneToOutput: 1e-9,
  layerToScene: 1e-9,
  layerToOutput: 1e-9,
  sceneToLayerSource: 1e-9,
  fitTextLines: 1e-9,
  // It divides by the arrow's length (docs/adr/0014).
  arrowOutline: 1e-9,
};
