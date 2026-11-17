import type { Reducer } from "@hussmartinez/sdk-core";
import { ImageError } from "../errors/image-error.js";
import type { ImageFrame, ImageLayer, ImageStroke } from "../model/plan.js";
import {
  DEVELOP_ADJUSTMENTS,
  FILTER_PRESETS,
  type ImageCrop,
  type ImageDevelop,
  type ImageFilter,
  type ImageOrientation,
  type ImageOutput,
  type ImagePlan,
  type ImageRedaction,
  MAX_PLAN_ITEMS,
} from "../model/plan.js";
import {
  type ImageKeepableMetadata,
  type ImageSize,
  longerThan,
  MAX_METADATA_LENGTH,
} from "../model/source.js";
import {
  allFields,
  checkCrop,
  checkCropInSource,
  Invalid,
  invalid,
  isRecord,
  isWhole,
} from "./checks.js";
import {
  type ImageFrameProps,
  insertFrames,
  moveFrames,
  removeFrames,
  restoreFrames,
  reverseFrames,
  setFrameOrder,
  setLoop,
  updateFrames,
} from "./frames.js";
import {
  insertItems,
  type KeyedEntry,
  moveItems,
  orderItems,
  removeItems,
  restoreItems,
  updateItems,
} from "./keyed-list.js";
import { checkLayer, LAYER_NAMES, patchLayer } from "./layers.js";
import {
  checkRedaction,
  type ImageRedactionProps,
  patchRedaction,
  REDACTION_NAMES,
} from "./redactions.js";
import { addStrokes, removeStrokes, restoreStrokes } from "./strokes.js";

export { checkCrop, checkCropInSource, Invalid, invalid, isRecord, onlyFields } from "./checks.js";

/**
 * Sets or removes the base's crop, in whole pixels of the oriented source.
 *
 * @public
 */
export interface SetCropCommand {
  readonly type: "image.setCrop";
  readonly crop: ImageCrop | null;
}

/**
 * Sets the base's rotation and flips.
 *
 * @public
 */
export interface SetOrientationCommand {
  readonly type: "image.setOrientation";
  readonly orientation: ImageOrientation;
}

/**
 * Sets the export's size.
 *
 * @public
 */
export interface SetOutputCommand {
  readonly type: "image.setOutput";
  readonly output: ImageOutput;
}

/**
 * Sets one metadata field to keep on export. An empty value keeps nothing.
 *
 * @public
 */
export interface SetMetadataCommand {
  readonly type: "image.setMetadata";
  readonly field: keyof ImageKeepableMetadata;
  readonly value: string;
}

/**
 * Sets some of the base's develop adjustments; the others keep their values
 * (ADR 0006).
 *
 * @public
 */
export interface SetDevelopCommand {
  readonly type: "image.setDevelop";
  readonly values: Partial<ImageDevelop>;
}

/**
 * Sets the base's filter preset and strength, or removes it with `null`.
 *
 * @public
 */
export interface SetFilterCommand {
  readonly type: "image.setFilter";
  readonly filter: ImageFilter | null;
}

/**
 * Inserts layers at an index of the plan's layers, which are drawn bottom
 * to top (ADR 0009). Each needs a key no layer or redaction of the plan has.
 *
 * @public
 */
export interface InsertLayersCommand {
  readonly type: "image.insertLayers";
  /** From 0, under every layer, to the number of layers, over them all. */
  readonly at: number;
  readonly layers: readonly ImageLayer[];
}

/**
 * Removes layers, by key.
 *
 * @public
 */
export interface RemoveLayersCommand {
  readonly type: "image.removeLayers";
  readonly keys: readonly string[];
}

/**
 * Moves layers to an index of the list without them, keeping the order they
 * had: up or down the stack.
 *
 * @public
 */
export interface MoveLayersCommand {
  readonly type: "image.moveLayers";
  readonly keys: readonly string[];
  readonly to: number;
}

/**
 * Sets some fields of some layers: their boxes after a move, their opacity,
 * a text layer's text. `props` may hold any field of the layer's kind except
 * `key` and `kind`.
 *
 * @public
 */
export interface UpdateLayersCommand {
  readonly type: "image.updateLayers";
  readonly updates: readonly {
    readonly key: string;
    readonly props: Readonly<Record<string, unknown>>;
  }[];
}

/**
 * Puts removed layers back, each at its index, by rising index. It's what
 * undoes {@link RemoveLayersCommand}: the reducer applies it, but it isn't
 * part of the portable command format (ADR 0009).
 *
 * @public
 */
export interface RestoreLayersCommand {
  readonly type: "image.restoreLayers";
  readonly entries: readonly { readonly at: number; readonly layer: ImageLayer }[];
}

/**
 * Sets the whole order of the layers: every key, once. It's what undoes
 * {@link MoveLayersCommand}: the reducer applies it, but it isn't part of
 * the portable command format (ADR 0009).
 *
 * @public
 */
export interface SetLayerOrderCommand {
  readonly type: "image.setLayerOrder";
  readonly keys: readonly string[];
}

/**
 * Inserts redactions at an index of the plan's redactions (ADR 0010). Each
 * needs a key no layer or redaction of the plan has.
 *
 * @public
 */
export interface InsertRedactionsCommand {
  readonly type: "image.insertRedactions";
  /** From 0 to the number of redactions. */
  readonly at: number;
  readonly redactions: readonly ImageRedaction[];
}

/**
 * Removes redactions, by key.
 *
 * @public
 */
export interface RemoveRedactionsCommand {
  readonly type: "image.removeRedactions";
  readonly keys: readonly string[];
}

/**
 * Moves redactions to an index of the list without them, keeping the order
 * they had. The order only decides how overlapping redactions look.
 *
 * @public
 */
export interface MoveRedactionsCommand {
  readonly type: "image.moveRedactions";
  readonly keys: readonly string[];
  readonly to: number;
}

/**
 * Sets some fields of some redactions, such as their regions after a move.
 *
 * @public
 */
export interface UpdateRedactionsCommand {
  readonly type: "image.updateRedactions";
  readonly updates: readonly { readonly key: string; readonly props: ImageRedactionProps }[];
}

/**
 * Puts removed redactions back, each at its index, by rising index. It's
 * what undoes {@link RemoveRedactionsCommand}: the reducer applies it, but
 * it isn't part of the portable command format (ADR 0009).
 *
 * @public
 */
export interface RestoreRedactionsCommand {
  readonly type: "image.restoreRedactions";
  readonly entries: readonly { readonly at: number; readonly redaction: ImageRedaction }[];
}

/**
 * Sets the whole order of the redactions: every key, once. It's what undoes
 * {@link MoveRedactionsCommand}: the reducer applies it, but it isn't part
 * of the portable command format (ADR 0009).
 *
 * @public
 */
export interface SetRedactionOrderCommand {
  readonly type: "image.setRedactionOrder";
  readonly keys: readonly string[];
}

/**
 * Appends strokes to a drawing layer (ADR 0009, docs/adr/0014): one stroke
 * for each gesture, however many runs it has.
 *
 * @public
 */
export interface AddStrokesCommand {
  readonly type: "image.addStrokes";
  /** The drawing's key. */
  readonly key: string;
  readonly strokes: readonly ImageStroke[];
}

/**
 * Removes strokes from a drawing layer, by index. A drawing keeps at least
 * one stroke: to remove the last, remove the layer.
 *
 * @public
 */
export interface RemoveStrokesCommand {
  readonly type: "image.removeStrokes";
  readonly key: string;
  readonly indexes: readonly number[];
}

/**
 * Puts removed strokes back, each at its index, by rising index. It's what
 * undoes {@link RemoveStrokesCommand}: the reducer applies it, but it isn't
 * part of the portable command format (ADR 0009).
 *
 * @public
 */
export interface RestoreStrokesCommand {
  readonly type: "image.restoreStrokes";
  readonly key: string;
  readonly entries: readonly { readonly at: number; readonly stroke: ImageStroke }[];
}

/**
 * Inserts frames into the animation, such as duplicates (docs/adr/0011).
 * Each shows a frame the base's source has.
 *
 * @public
 */
export interface InsertFramesCommand {
  readonly type: "image.insertFrames";
  /** The index, from 0 to the number of frames. */
  readonly at: number;
  readonly frames: readonly ImageFrame[];
}

/**
 * Removes frames from the animation, which keeps at least one.
 *
 * @public
 */
export interface RemoveFramesCommand {
  readonly type: "image.removeFrames";
  readonly keys: readonly string[];
}

/**
 * Moves frames to an index of the list without them, keeping their order.
 *
 * @public
 */
export interface MoveFramesCommand {
  readonly type: "image.moveFrames";
  readonly keys: readonly string[];
  readonly to: number;
}

/**
 * Reverses the order the frames play in. It undoes itself.
 *
 * @public
 */
export interface ReverseFramesCommand {
  readonly type: "image.reverseFrames";
}

/**
 * Sets some frames' delays: one command for one frame or for all of them.
 *
 * @public
 */
export interface UpdateFramesCommand {
  readonly type: "image.updateFrames";
  readonly updates: readonly { readonly key: string; readonly props: ImageFrameProps }[];
}

/**
 * Sets how many times the animation repeats: `null` for once, 0 for ever.
 *
 * @public
 */
export interface SetLoopCommand {
  readonly type: "image.setLoop";
  readonly loop: number | null;
}

/**
 * Puts removed frames back, each at its index, by rising index. It's what
 * undoes {@link RemoveFramesCommand}: the reducer applies it, but it isn't
 * part of the portable command format (ADR 0009).
 *
 * @public
 */
export interface RestoreFramesCommand {
  readonly type: "image.restoreFrames";
  readonly entries: readonly { readonly at: number; readonly frame: ImageFrame }[];
}

/**
 * Sets the whole order of the frames: every key, once. It's what undoes
 * {@link MoveFramesCommand}: the reducer applies it, but it isn't part of
 * the portable command format (ADR 0009).
 *
 * @public
 */
export interface SetFrameOrderCommand {
  readonly type: "image.setFrameOrder";
  readonly keys: readonly string[];
}

/**
 * The commands that exist only to undo others. The reducer applies them, and
 * they're plain data like every command, but the `hm-image-command` format
 * doesn't include them: an inverse's shape may change between releases
 * (sdk-core ADR 0045).
 *
 * @public
 */
export type ImageInverseCommand =
  | RestoreStrokesCommand
  | RestoreLayersCommand
  | SetLayerOrderCommand
  | RestoreRedactionsCommand
  | SetRedactionOrderCommand
  | RestoreFramesCommand
  | SetFrameOrderCommand;

/**
 * Every edit to an {@link ImagePlan}: plain, structured-cloneable data
 * (ADR 0003, ADR 0009).
 *
 * @public
 */
export type ImageCommand =
  | SetCropCommand
  | SetOrientationCommand
  | SetOutputCommand
  | SetMetadataCommand
  | SetDevelopCommand
  | SetFilterCommand
  | InsertLayersCommand
  | RemoveLayersCommand
  | MoveLayersCommand
  | UpdateLayersCommand
  | AddStrokesCommand
  | RemoveStrokesCommand
  | InsertRedactionsCommand
  | RemoveRedactionsCommand
  | MoveRedactionsCommand
  | UpdateRedactionsCommand
  | InsertFramesCommand
  | RemoveFramesCommand
  | MoveFramesCommand
  | ReverseFramesCommand
  | UpdateFramesCommand
  | SetLoopCommand
  | ImageInverseCommand;

/**
 * Why a command was refused, as a stable token: `details.reason` on the
 * `INVALID_COMMAND` error (sdk-core ADR 0045).
 *
 * - `malformed-command`: not shaped as the `hm-image-command` schema says,
 *   such as a missing field, a field of the wrong type, an unknown field, or
 *   a crop that isn't whole pixels of at least 1 × 1.
 * - `unknown-command`: a `type` the reducer doesn't know.
 * - `unknown-source`: a crop for a plan whose source isn't registered, or
 *   an image layer whose source isn't.
 * - `crop-outside-source`: a crop that doesn't fit inside its source.
 * - `invalid-orientation`: a rotation other than 0, 90, 180 or 270.
 * - `invalid-output`: a scale outside (0, 1], or a box under 1 pixel.
 * - `unknown-metadata-field`: a field other than title, description, artist
 *   and copyright.
 * - `metadata-too-long`: a value over `MAX_METADATA_LENGTH` code points.
 * - `unknown-adjustment`: a develop value that isn't an adjustment.
 * - `invalid-level`: a develop value that isn't a whole number from -100 to 100.
 * - `unknown-preset`: a filter that isn't one of `FILTER_PRESETS`.
 * - `invalid-strength`: a filter strength that isn't a whole number from 0 to 100.
 * - `invalid-key`: a key that's empty or over `MAX_KEY_LENGTH` code points.
 * - `duplicate-key`: a new item with a key the plan already uses, or two
 *   new items or two updates with the same key.
 * - `invalid-index`: an index past the end of the list.
 * - `invalid-order`: an order that doesn't list every key.
 * - `unknown-layer`: a key no layer has.
 * - `unknown-layer-kind`: a kind other than `text`, `shape` and `image`.
 * - `invalid-box`: a layer's box under 1 × 1 pixel, further than
 *   `MAX_SCENE_COORDINATE` from the scene's origin, or turned by other than
 *   0 to 3599 tenths of a degree.
 * - `invalid-opacity`: an opacity that isn't from 0 to 100.
 * - `invalid-text`: text or a name with a control character other than a
 *   line feed, or a bidirectional embedding, override or isolate control.
 * - `text-too-long`: text over `MAX_LAYER_TEXT_LENGTH` code points, or a
 *   name over `MAX_LAYER_NAME_LENGTH`.
 * - `empty-shape`: a shape with neither a fill nor a stroke.
 * - `wrong-kind`: an update that sets a field another kind of layer has.
 * - `unknown-redaction`: a key no redaction has.
 * - `unknown-redaction-mode`: a mode other than `solid` and `pixelate`.
 * - `invalid-region`: a redaction under 1 × 1 pixel, or further than
 *   `MAX_SCENE_COORDINATE` from the scene's origin.
 * - `invalid-colour`: a colour that isn't `#rrggbb` in lower case.
 * - `unexpected-colour`: an update that sets a colour on a pixelated
 *   redaction, which has none.
 * - `missing-colour`: an update that sets a redaction to solid without a
 *   colour.
 * - `too-many-layers`: more layers and redactions than `MAX_PLAN_ITEMS`,
 *   the format's ceiling. The file policy's `maxLayers` is checked by the
 *   session, with its own error code.
 * - `not-animated`: a frame command for a plan whose `animation` is `null`.
 * - `unknown-frame`: a key no frame has.
 * - `invalid-frame`: a frame of the source that the source doesn't have.
 * - `invalid-delay`: a delay that isn't a whole number from 0 to
 *   `MAX_FRAME_DELAY`.
 * - `invalid-loop`: a loop count that isn't `null` or a whole number from 0
 *   to `MAX_FRAME_DELAY`.
 * - `no-frames`: removing every frame. An animation keeps at least one.
 * - `too-many-frames`: more frames than `MAX_ANIMATION_FRAMES`, the
 *   format's ceiling. The file policy's `maxFrames` is checked by the
 *   session, with its own error code.
 *
 * @public
 */
export type ImageCommandRejection =
  | "malformed-command"
  | "unknown-command"
  | "unknown-source"
  | "crop-outside-source"
  | "invalid-orientation"
  | "invalid-output"
  | "unknown-metadata-field"
  | "metadata-too-long"
  | "unknown-adjustment"
  | "invalid-level"
  | "unknown-preset"
  | "invalid-strength"
  | "invalid-key"
  | "duplicate-key"
  | "invalid-index"
  | "invalid-order"
  | "unknown-layer"
  | "unknown-layer-kind"
  | "invalid-box"
  | "invalid-opacity"
  | "invalid-text"
  | "text-too-long"
  | "empty-shape"
  | "empty-drawing"
  | "empty-arrow"
  | "invalid-points"
  | "too-many-strokes"
  | "wrong-kind"
  | "unknown-redaction"
  | "unknown-redaction-mode"
  | "invalid-region"
  | "invalid-colour"
  | "unexpected-colour"
  | "missing-colour"
  | "too-many-layers"
  | "not-animated"
  | "unknown-frame"
  | "invalid-frame"
  | "invalid-delay"
  | "invalid-loop"
  | "no-frames"
  | "too-many-frames";

/** @internal */
export function checkOrientation(value: unknown): ImageOrientation {
  if (!isRecord<ImageOrientation>(value))
    invalid("malformed-command", "an orientation is an object");
  allFields(value, ["rotate", "flipX", "flipY"], "an orientation");
  const { rotate, flipX, flipY } = value;
  if (typeof flipX !== "boolean" || typeof flipY !== "boolean") {
    invalid("malformed-command", "an orientation's flips are booleans");
  }
  if (![0, 90, 180, 270].includes(rotate)) {
    invalid("invalid-orientation", "a rotation is 0, 90, 180 or 270 degrees");
  }
  return { rotate, flipX, flipY };
}

/** @internal */
export function checkOutput(value: unknown): ImageOutput {
  if (!isRecord<ImageOutput>(value)) invalid("malformed-command", "an output is an object");
  if (value.kind === "scale") {
    allFields(value, ["kind", "scale"], "a scale output");
    if (typeof value.scale !== "number") invalid("malformed-command", "a scale is a number");
    if (!(Number.isFinite(value.scale) && value.scale > 0 && value.scale <= 1)) {
      invalid("invalid-output", "an output scale is more than 0 and at most 1");
    }
    return { kind: "scale", scale: value.scale };
  }
  if (value.kind === "fit") {
    allFields(value, ["kind", "width", "height"], "a box output");
    const { width, height } = value;
    if (!Number.isInteger(width) || !Number.isInteger(height)) {
      invalid("malformed-command", "a box's width and height are whole numbers");
    }
    if (!isWhole(width, 1) || !isWhole(height, 1)) {
      invalid("invalid-output", "an output box is at least 1 × 1 pixel");
    }
    return { kind: "fit", width, height };
  }
  return invalid("malformed-command", "an output is either a scale or a box to fit");
}

const METADATA_FIELDS: readonly (keyof ImageKeepableMetadata)[] = [
  "title",
  "description",
  "artist",
  "copyright",
];

/** @internal */
export function checkMetadataValue(field: string, value: unknown): string {
  if (typeof value !== "string") invalid("malformed-command", `metadata.${field} is text`);
  if (longerThan(value, MAX_METADATA_LENGTH)) {
    invalid(
      "metadata-too-long",
      `metadata.${field} has more than ${MAX_METADATA_LENGTH} code points`,
    );
  }
  return value;
}

/** @internal */
export function checkMetadata(value: unknown): ImageKeepableMetadata {
  if (!isRecord<ImageKeepableMetadata>(value))
    invalid("malformed-command", "metadata is an object");
  allFields(value, METADATA_FIELDS, "metadata");
  return Object.fromEntries(
    METADATA_FIELDS.map((field) => [field, checkMetadataValue(field, value[field])]),
  ) as unknown as ImageKeepableMetadata;
}

const ADJUSTMENTS: readonly string[] = DEVELOP_ADJUSTMENTS;
const PRESETS: readonly string[] = FILTER_PRESETS;

/** Develop values: some adjustments, or with `all`, every one. @internal */
export function checkDevelop(value: unknown, all = false): Partial<ImageDevelop> {
  if (!isRecord<Record<string, unknown>>(value)) {
    invalid("malformed-command", "develop values are an object");
  }
  const values: Partial<Record<keyof ImageDevelop, number>> = {};
  for (const [name, level] of Object.entries(value)) {
    if (!ADJUSTMENTS.includes(name)) {
      invalid("unknown-adjustment", `"${name}" isn't a develop adjustment`);
    }
    if (typeof level !== "number") invalid("malformed-command", `${name} is a number`);
    if (!isWhole(level, -100, 100)) {
      invalid("invalid-level", `${name} is a whole number from -100 to 100`);
    }
    values[name as keyof ImageDevelop] = level;
  }
  if (all) allFields(value, ADJUSTMENTS, "develop");
  // In the adjustments' order, whatever the input's.
  return Object.fromEntries(
    DEVELOP_ADJUSTMENTS.filter((name) => name in values).map((name) => [name, values[name]]),
  ) as Partial<ImageDevelop>;
}

/** @internal */
export function checkFilter(value: unknown): ImageFilter | null {
  if (value === null) return null;
  if (!isRecord<ImageFilter>(value)) invalid("malformed-command", "a filter is an object or null");
  allFields(value, ["preset", "strength"], "a filter");
  if (typeof value.preset !== "string") invalid("malformed-command", "a filter's preset is text");
  if (!PRESETS.includes(value.preset)) {
    invalid("unknown-preset", `a filter's preset is one of ${FILTER_PRESETS.join(", ")}`);
  }
  if (typeof value.strength !== "number") {
    invalid("malformed-command", "a filter's strength is a number");
  }
  if (!isWhole(value.strength, 0, 100)) {
    invalid("invalid-strength", "a filter's strength is a whole number from 0 to 100");
  }
  return { preset: value.preset, strength: value.strength };
}

/** Each command's fields, which are all required. */
const COMMAND_FIELDS: Readonly<Record<ImageCommand["type"], readonly string[]>> = {
  "image.setCrop": ["type", "crop"],
  "image.setOrientation": ["type", "orientation"],
  "image.setOutput": ["type", "output"],
  "image.setMetadata": ["type", "field", "value"],
  "image.setDevelop": ["type", "values"],
  "image.setFilter": ["type", "filter"],
  "image.insertLayers": ["type", "at", "layers"],
  "image.removeLayers": ["type", "keys"],
  "image.moveLayers": ["type", "keys", "to"],
  "image.updateLayers": ["type", "updates"],
  "image.restoreLayers": ["type", "entries"],
  "image.setLayerOrder": ["type", "keys"],
  "image.addStrokes": ["type", "key", "strokes"],
  "image.removeStrokes": ["type", "key", "indexes"],
  "image.restoreStrokes": ["type", "key", "entries"],
  "image.insertRedactions": ["type", "at", "redactions"],
  "image.removeRedactions": ["type", "keys"],
  "image.moveRedactions": ["type", "keys", "to"],
  "image.updateRedactions": ["type", "updates"],
  "image.restoreRedactions": ["type", "entries"],
  "image.setRedactionOrder": ["type", "keys"],
  "image.insertFrames": ["type", "at", "frames"],
  "image.removeFrames": ["type", "keys"],
  "image.moveFrames": ["type", "keys", "to"],
  "image.reverseFrames": ["type"],
  "image.updateFrames": ["type", "updates"],
  "image.setLoop": ["type", "loop"],
  "image.restoreFrames": ["type", "entries"],
  "image.setFrameOrder": ["type", "keys"],
};

/** Every key the plan uses: a new item needs one that isn't among them. */
function planKeys(plan: ImagePlan): Set<string> {
  return new Set(
    [...plan.layers, ...plan.redactions, ...(plan.animation?.frames ?? [])].map(
      (item: { key: string }) => item.key,
    ),
  );
}

/** Refuses more layers and redactions than the format holds. */
function checkRoom(plan: ImagePlan, added: number): void {
  if (plan.layers.length + plan.redactions.length + added > MAX_PLAN_ITEMS) {
    invalid(
      "too-many-layers",
      `a plan holds at most ${MAX_PLAN_ITEMS} layers and redactions together`,
    );
  }
}

/**
 * What the reducer needs to know of a source: its oriented size, to check
 * crops, and how many frames it has, to check an animation's. A source
 * that gives no count has one frame.
 *
 * @public
 */
export interface ImageReducerSource extends ImageSize {
  readonly frames?: number;
}

type SourceSize = (id: string) => ImageReducerSource | undefined;

/** How many frames the base's source has, for a command that names one. */
function sourceFrames(plan: ImagePlan, sourceSize: SourceSize): number {
  const source = sourceSize(plan.base.source);
  if (source === undefined) invalid("unknown-source", `unknown source "${plan.base.source}"`);
  return source.frames ?? 1;
}

/** A list of at least one layer. */
function checkLayers(value: unknown, sourceSize: SourceSize): ImageLayer[] {
  if (!Array.isArray(value)) invalid("malformed-command", "layers is a list");
  if (value.length === 0) invalid("malformed-command", "layers has at least one item");
  return value.map((layer) => checkLayer(layer, sourceSize));
}

/** The entries of `image.restoreLayers`. */
function checkLayerEntries(value: unknown, sourceSize: SourceSize): KeyedEntry<ImageLayer>[] {
  if (!Array.isArray(value)) invalid("malformed-command", "entries is a list");
  if (value.length === 0) invalid("malformed-command", "entries has at least one item");
  return value.map((entry) => {
    if (!isRecord<{ at: unknown; layer: unknown }>(entry)) {
      invalid("malformed-command", "an entry is an object");
    }
    allFields(entry, ["at", "layer"], "an entry");
    return { at: entry.at as number, item: checkLayer(entry.layer, sourceSize) };
  });
}

/** A list of at least one redaction. */
function checkRedactions(value: unknown): ImageRedaction[] {
  if (!Array.isArray(value)) invalid("malformed-command", "redactions is a list");
  if (value.length === 0) invalid("malformed-command", "redactions has at least one item");
  return value.map(checkRedaction);
}

/** The entries of `image.restoreRedactions`. */
function checkRedactionEntries(value: unknown): KeyedEntry<ImageRedaction>[] {
  if (!Array.isArray(value)) invalid("malformed-command", "entries is a list");
  if (value.length === 0) invalid("malformed-command", "entries has at least one item");
  return value.map((entry) => {
    if (!isRecord<{ at: unknown; redaction: unknown }>(entry)) {
      invalid("malformed-command", "an entry is an object");
    }
    allFields(entry, ["at", "redaction"], "an entry");
    return { at: entry.at as number, item: checkRedaction(entry.redaction) };
  });
}

function apply(
  plan: ImagePlan,
  input: unknown,
  sourceSize: SourceSize,
): { state: ImagePlan; inverse: ImageCommand } {
  if (!isRecord<{ type: unknown }>(input)) invalid("malformed-command", "a command is an object");
  const { type } = input;
  if (typeof type !== "string") invalid("malformed-command", "a command's type is text");
  if (!Object.hasOwn(COMMAND_FIELDS, type)) {
    invalid("unknown-command", `"${type}" isn't a command`);
  }
  const command = input as ImageCommand;
  allFields(command, COMMAND_FIELDS[command.type], `${command.type}`);
  switch (command.type) {
    case "image.setCrop": {
      const crop = command.crop === null ? null : checkCrop(command.crop);
      if (crop !== null) {
        const size = sourceSize(plan.base.source);
        if (size === undefined) invalid("unknown-source", `unknown source "${plan.base.source}"`);
        checkCropInSource(crop, size);
      }
      return {
        state: { ...plan, base: { ...plan.base, crop } },
        inverse: { type: "image.setCrop", crop: plan.base.crop },
      };
    }
    case "image.setOrientation": {
      const orientation = checkOrientation(command.orientation);
      return {
        state: { ...plan, base: { ...plan.base, orientation } },
        inverse: { type: "image.setOrientation", orientation: plan.base.orientation },
      };
    }
    case "image.setOutput": {
      const output = checkOutput(command.output);
      return {
        state: { ...plan, output },
        inverse: { type: "image.setOutput", output: plan.output },
      };
    }
    case "image.setMetadata": {
      const { field } = command;
      if (typeof field !== "string") invalid("malformed-command", "a metadata field is text");
      if (!(METADATA_FIELDS as readonly string[]).includes(field)) {
        invalid("unknown-metadata-field", "only title, description, artist and copyright are kept");
      }
      const value = checkMetadataValue(field, command.value);
      return {
        state: { ...plan, metadata: { ...plan.metadata, [field]: value } },
        inverse: { type: "image.setMetadata", field, value: plan.metadata[field] },
      };
    }
    case "image.setDevelop": {
      const values = checkDevelop(command.values);
      const previous: Partial<Record<keyof ImageDevelop, number>> = {};
      for (const name of Object.keys(values) as (keyof ImageDevelop)[]) {
        previous[name] = plan.base.develop[name];
      }
      return {
        state: { ...plan, base: { ...plan.base, develop: { ...plan.base.develop, ...values } } },
        inverse: { type: "image.setDevelop", values: previous },
      };
    }
    case "image.setFilter": {
      const filter = checkFilter(command.filter);
      return {
        state: { ...plan, base: { ...plan.base, filter } },
        inverse: { type: "image.setFilter", filter: plan.base.filter },
      };
    }
    case "image.insertLayers": {
      const layers = checkLayers(command.layers, sourceSize);
      const { list, keys } = insertItems(plan.layers, command.at, layers, planKeys(plan));
      checkRoom(plan, layers.length);
      return { state: { ...plan, layers: list }, inverse: { type: "image.removeLayers", keys } };
    }
    case "image.removeLayers": {
      const { list, entries } = removeItems(plan.layers, command.keys, LAYER_NAMES);
      return {
        state: { ...plan, layers: list },
        inverse: {
          type: "image.restoreLayers",
          entries: entries.map(({ at, item }) => ({ at, layer: item })),
        },
      };
    }
    case "image.restoreLayers": {
      const entries = checkLayerEntries(command.entries, sourceSize);
      const { list, keys } = restoreItems(plan.layers, entries, planKeys(plan));
      checkRoom(plan, entries.length);
      return { state: { ...plan, layers: list }, inverse: { type: "image.removeLayers", keys } };
    }
    case "image.moveLayers": {
      const { list, order } = moveItems(plan.layers, command.keys, command.to, LAYER_NAMES);
      return {
        state: { ...plan, layers: list },
        inverse: { type: "image.setLayerOrder", keys: order },
      };
    }
    case "image.setLayerOrder": {
      const { list, order } = orderItems(plan.layers, command.keys, LAYER_NAMES);
      return {
        state: { ...plan, layers: list },
        inverse: { type: "image.setLayerOrder", keys: order },
      };
    }
    case "image.updateLayers": {
      const { list, previous } = updateItems(
        plan.layers,
        command.updates,
        LAYER_NAMES,
        (item, props) => patchLayer(item, props, sourceSize),
      );
      return {
        state: { ...plan, layers: list },
        inverse: { type: "image.updateLayers", updates: previous },
      };
    }
    case "image.addStrokes":
      return addStrokes(plan, command.key, command.strokes);
    case "image.removeStrokes":
      return removeStrokes(plan, command.key, command.indexes);
    case "image.restoreStrokes":
      return restoreStrokes(plan, command.key, command.entries);
    case "image.insertRedactions": {
      const redactions = checkRedactions(command.redactions);
      const { list, keys } = insertItems(plan.redactions, command.at, redactions, planKeys(plan));
      checkRoom(plan, redactions.length);
      return {
        state: { ...plan, redactions: list },
        inverse: { type: "image.removeRedactions", keys },
      };
    }
    case "image.removeRedactions": {
      const { list, entries } = removeItems(plan.redactions, command.keys, REDACTION_NAMES);
      return {
        state: { ...plan, redactions: list },
        inverse: {
          type: "image.restoreRedactions",
          entries: entries.map(({ at, item }) => ({ at, redaction: item })),
        },
      };
    }
    case "image.restoreRedactions": {
      const entries = checkRedactionEntries(command.entries);
      const { list, keys } = restoreItems(plan.redactions, entries, planKeys(plan));
      checkRoom(plan, entries.length);
      return {
        state: { ...plan, redactions: list },
        inverse: { type: "image.removeRedactions", keys },
      };
    }
    case "image.moveRedactions": {
      const { list, order } = moveItems(plan.redactions, command.keys, command.to, REDACTION_NAMES);
      return {
        state: { ...plan, redactions: list },
        inverse: { type: "image.setRedactionOrder", keys: order },
      };
    }
    case "image.setRedactionOrder": {
      const { list, order } = orderItems(plan.redactions, command.keys, REDACTION_NAMES);
      return {
        state: { ...plan, redactions: list },
        inverse: { type: "image.setRedactionOrder", keys: order },
      };
    }
    case "image.updateRedactions": {
      const { list, previous } = updateItems(
        plan.redactions,
        command.updates,
        REDACTION_NAMES,
        patchRedaction,
      );
      return {
        state: { ...plan, redactions: list },
        inverse: { type: "image.updateRedactions", updates: previous },
      };
    }
    case "image.insertFrames":
      return insertFrames(
        plan,
        command.at,
        command.frames,
        planKeys(plan),
        plan.animation === null ? 1 : sourceFrames(plan, sourceSize),
      );
    case "image.removeFrames":
      return removeFrames(plan, command.keys);
    case "image.restoreFrames":
      return restoreFrames(
        plan,
        command.entries,
        planKeys(plan),
        plan.animation === null ? 1 : sourceFrames(plan, sourceSize),
      );
    case "image.moveFrames":
      return moveFrames(plan, command.keys, command.to);
    case "image.setFrameOrder":
      return setFrameOrder(plan, command.keys);
    case "image.reverseFrames":
      return reverseFrames(plan);
    case "image.updateFrames":
      return updateFrames(plan, command.updates);
    case "image.setLoop":
      return setLoop(plan, command.loop);
  }
}

/**
 * Creates the reducer for {@link ImageCommand}s: a pure function that
 * applies one command and returns the command that undoes it (ADR 0003,
 * ADR 0029). It needs the oriented size of each source, to check crops.
 *
 * Commands are strict, as the `hm-image-command` schema is (sdk-core ADR
 * 0045): an invalid command, including one with a field its type doesn't
 * have, throws `ImageError` with `INVALID_COMMAND` and an
 * {@link ImageCommandRejection} as `details.reason`. The reducer never
 * silently corrects one.
 *
 * @public
 */
export function createImageReducer(
  sourceSize: (id: string) => ImageReducerSource | undefined,
): Reducer<ImagePlan, ImageCommand> {
  return (plan, command) => {
    try {
      return apply(plan, command, sourceSize);
    } catch (error) {
      if (!(error instanceof Invalid)) throw error;
      throw new ImageError("INVALID_COMMAND", `Invalid command: ${error.message}.`, {
        details: { reason: error.reason },
      });
    }
  };
}
