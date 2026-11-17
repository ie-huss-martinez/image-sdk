import fc from "fast-check";
import {
  createPlan,
  DEVELOP_ADJUSTMENTS,
  FILTER_PRESETS,
  type ImageFrame,
  type ImageLayer,
  type ImagePlan,
  type ImageRedaction,
  LAYER_ALIGNMENTS,
  LAYER_FONTS,
  LAYER_SHAPES,
} from "../../src/core/model/plan.js";
import { createImageReducer, type ImageCommand } from "../../src/core/operations/commands.js";

/**
 * The plan reducer's property-test generators, shared by its tests and the
 * conformance vectors' generator (sdk-core ADR 0045): valid commands, and
 * plans reached by applying them to a new plan of source `s`. Commands on
 * the plan's lists depend on what the plan holds, so those are generated
 * for a plan.
 */

/** The oriented size of source `s`, and how many frames it has. */
export const SIZE = { width: 40, height: 30, frames: 5 };
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

/** Any valid command that applies to every plan: the edits to the base, the output and metadata. */
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

/** Keys as data: short text, and the names of `Object.prototype`'s properties. */
const key = fc.oneof(
  { weight: 4, arbitrary: fc.string({ minLength: 1, maxLength: 6 }) },
  { weight: 1, arbitrary: fc.constantFrom("__proto__", "constructor", "toString") },
);
const position = fc.integer({ min: -20, max: 60 });
const length = fc.integer({ min: 1, max: 50 });
const colour = fc
  .integer({ min: 0, max: 0xffffff })
  .map((value) => `#${value.toString(16).padStart(6, "0")}`);
const region = { x: position, y: position, width: length, height: length };

/** A redaction with the given key. */
const redactionWith = (itemKey: string): fc.Arbitrary<ImageRedaction> =>
  fc.oneof(
    fc.record({
      key: fc.constant(itemKey),
      mode: fc.constant("solid" as const),
      ...region,
      colour,
    }),
    fc.record({ key: fc.constant(itemKey), mode: fc.constant("pixelate" as const), ...region }),
  );

/** Some fields that apply to a redaction, whatever they set its mode to. */
const propsFor = (item: ImageRedaction) => {
  const some = fc.record(region, { requiredKeys: [] });
  const withMode =
    item.mode === "solid"
      ? some.map((props) => ({ ...props, mode: "pixelate" as const }))
      : fc.tuple(some, colour).map(([props, fill]) => ({
          ...props,
          mode: "solid" as const,
          colour: fill,
        }));
  const sameMode =
    item.mode === "solid"
      ? fc
          .tuple(some, fc.option(colour, { nil: undefined }))
          .map(([props, fill]) => (fill === undefined ? props : { ...props, colour: fill }))
      : some;
  return fc.oneof(sameMode, withMode);
};

/** What every layer has. */
const shared = (itemKey: string) => ({
  key: fc.constant(itemKey),
  name: fc.constantFrom("", "Caption", "Logo 2", "שכבה", "📷"),
  visible: fc.boolean(),
  opacity: fc.integer({ min: 0, max: 100 }),
});
/** One run: 1 to 6 points, from the drawing's origin. */
const run = fc
  .array(fc.tuple(fc.integer({ min: -30, max: 30 }), fc.integer({ min: -30, max: 30 })), {
    minLength: 1,
    maxLength: 6,
  })
  .map((points) => points.flat());
/** One stroke: what one gesture drew, in one run or a few. */
const drawnStroke = fc.record({
  colour,
  width: fc.integer({ min: 1, max: 40 }),
  runs: fc.array(run, { minLength: 1, maxLength: 3 }),
});
/** Two points of the scene that differ: an arrow's ends. */
const ends = fc
  .tuple(position, position, position, position)
  .filter(([ax, ay, bx, by]) => ax !== bx || ay !== by)
  .map(([ax, ay, bx, by]) => ({ from: { x: ax, y: ay }, to: { x: bx, y: by } }));

const box = {
  x: position,
  y: position,
  width: length,
  height: length,
  rotation: fc.integer({ min: 0, max: 3_599 }),
  flipX: fc.boolean(),
};
const common = (itemKey: string) => ({
  key: fc.constant(itemKey),
  name: fc.constantFrom("", "Caption", "Logo 2", "שכבה", "📷"),
  visible: fc.boolean(),
  opacity: fc.integer({ min: 0, max: 100 }),
  ...box,
});
// Text with line feeds, emoji and right-to-left letters, and no control it can't hold.
const layerText = fc
  .array(fc.constantFrom("a", "Z", " ", "\n", "é", "📷", "ש", "中"), { maxLength: 12 })
  .map((parts) => parts.join(""));
const stroke = fc.record({ colour, width: fc.integer({ min: 1, max: 40 }) });
/** A fill, a stroke or both: a shape has at least one. */
const paint = fc.oneof(
  fc.record({ fill: colour, stroke: fc.constant(null) }),
  fc.record({ fill: fc.constant(null), stroke }),
  fc.record({ fill: colour, stroke }),
);

const textOwn = {
  text: layerText,
  font: fc.constantFrom(...LAYER_FONTS),
  bold: fc.boolean(),
  colour,
  align: fc.constantFrom(...LAYER_ALIGNMENTS),
};
const imageOwn = { source: fc.constant("s"), crop };

/** A layer with the given key: text, a shape, an image of source `s`, a drawing or an arrow. */
const layerWith = (itemKey: string): fc.Arbitrary<ImageLayer> =>
  fc.oneof(
    fc.record({ ...common(itemKey), kind: fc.constant("text" as const), ...textOwn }),
    fc
      .tuple(
        fc.record({
          ...common(itemKey),
          kind: fc.constant("shape" as const),
          shape: fc.constantFrom(...LAYER_SHAPES),
        }),
        paint,
      )
      .map(([layer, painted]) => ({ ...layer, ...painted })),
    fc.record({ ...common(itemKey), kind: fc.constant("image" as const), ...imageOwn }),
    fc.record({
      ...shared(itemKey),
      kind: fc.constant("drawing" as const),
      x: position,
      y: position,
      strokes: fc.array(drawnStroke, { minLength: 1, maxLength: 3 }),
    }),
    fc
      .tuple(
        fc.record({
          ...shared(itemKey),
          kind: fc.constant("arrow" as const),
          colour,
          width: fc.integer({ min: 1, max: 40 }),
        }),
        ends,
      )
      .map(([layer, points]) => ({ ...layer, ...points })),
  );

/** Some fields that apply to a layer: of every layer, of its box, or of its own kind. */
const layerPropsFor = (item: ImageLayer): fc.Arbitrary<Record<string, unknown>> => {
  const every = {
    name: fc.constantFrom("", "Caption", "שכבה"),
    visible: fc.boolean(),
    opacity: fc.integer({ min: 0, max: 100 }),
  };
  // A drawing has an origin and no box; an arrow has two ends, set together so they differ.
  if (item.kind === "drawing") {
    return fc.record({ ...every, x: position, y: position }, { requiredKeys: [] });
  }
  if (item.kind === "arrow") {
    return fc
      .tuple(
        fc.record(
          { ...every, colour, width: fc.integer({ min: 1, max: 40 }) },
          { requiredKeys: [] },
        ),
        fc.option(ends, { nil: undefined }),
      )
      .map(([a, b]) => ({ ...a, ...b }));
  }
  const shared = fc.record(
    {
      name: fc.constantFrom("", "Caption", "שכבה"),
      visible: fc.boolean(),
      opacity: fc.integer({ min: 0, max: 100 }),
      ...box,
    },
    { requiredKeys: [] },
  );
  const own: fc.Arbitrary<Record<string, unknown>> =
    item.kind === "text"
      ? fc.record(textOwn, { requiredKeys: [] })
      : item.kind === "image"
        ? fc.record(imageOwn, { requiredKeys: [] })
        : fc.oneof(
            paint,
            fc.record({ shape: fc.constantFrom(...LAYER_SHAPES) }, { requiredKeys: [] }),
          );
  return fc.tuple(shared, own).map(([a, b]) => ({ ...a, ...b }));
};

/** Some of the keys, at least one, in any order. */
const someOf = (keys: readonly string[]) => fc.shuffledSubarray([...keys], { minLength: 1 });

/** Any valid command for this plan, including those on its redactions. */
export function commandOn(state: ImagePlan): fc.Arbitrary<ImageCommand> {
  const keys = state.redactions.map((redaction) => redaction.key);
  const layerKeys = state.layers.map((layer) => layer.key);
  // A new item's key is free in the whole plan, not only in its own list.
  const frameKeys = state.animation?.frames.map((frame) => frame.key) ?? [];
  const taken = [...keys, ...layerKeys, ...frameKeys];
  const fresh = fc.uniqueArray(
    key.filter((value) => !taken.includes(value)),
    { minLength: 1, maxLength: 3 },
  );
  const onLayers: fc.Arbitrary<ImageCommand>[] = [
    fresh.chain((names) =>
      fc.record({
        type: fc.constant("image.insertLayers" as const),
        at: fc.nat(layerKeys.length),
        layers: fc.tuple(...names.map(layerWith)),
      }),
    ),
  ];
  if (layerKeys.length > 0) {
    onLayers.push(
      someOf(layerKeys).map((chosen) => ({ type: "image.removeLayers" as const, keys: chosen })),
      someOf(layerKeys).chain((chosen) =>
        fc.record({
          type: fc.constant("image.moveLayers" as const),
          keys: fc.constant(chosen),
          to: fc.nat(layerKeys.length - chosen.length),
        }),
      ),
      someOf(layerKeys).chain((chosen) =>
        fc.record({
          type: fc.constant("image.updateLayers" as const),
          updates: fc.tuple(
            ...chosen.map((itemKey) =>
              fc.record({
                key: fc.constant(itemKey),
                props: layerPropsFor(
                  state.layers.find((layer) => layer.key === itemKey) as ImageLayer,
                ),
              }),
            ),
          ),
        }),
      ),
    );
  }
  // Strokes added to a drawing, and removed from one that keeps at least one.
  for (const layer of state.layers) {
    if (layer.kind !== "drawing") continue;
    onLayers.push(
      fc.record({
        type: fc.constant("image.addStrokes" as const),
        key: fc.constant(layer.key),
        strokes: fc.array(drawnStroke, { minLength: 1, maxLength: 2 }),
      }),
    );
    if (layer.strokes.length > 1) {
      onLayers.push(
        fc
          .shuffledSubarray(
            layer.strokes.map((_, index) => index),
            { minLength: 1, maxLength: layer.strokes.length - 1 },
          )
          .map((indexes) => ({
            type: "image.removeStrokes" as const,
            key: layer.key,
            indexes,
          })),
      );
    }
  }
  const insert = fresh.chain((names) =>
    fc.record({
      type: fc.constant("image.insertRedactions" as const),
      at: fc.nat(keys.length),
      redactions: fc.tuple(...names.map(redactionWith)),
    }),
  );
  const onFrames = framesOn(state, fresh);
  if (keys.length === 0) return fc.oneof(command, insert, ...onLayers, ...onFrames);
  const remove = someOf(keys).map((chosen) => ({
    type: "image.removeRedactions" as const,
    keys: chosen,
  }));
  const move = someOf(keys).chain((chosen) =>
    fc.record({
      type: fc.constant("image.moveRedactions" as const),
      keys: fc.constant(chosen),
      to: fc.nat(keys.length - chosen.length),
    }),
  );
  const update = someOf(keys).chain((chosen) =>
    fc.record({
      type: fc.constant("image.updateRedactions" as const),
      updates: fc.tuple(
        ...chosen.map((itemKey) =>
          fc.record({
            key: fc.constant(itemKey),
            props: propsFor(
              state.redactions.find((redaction) => redaction.key === itemKey) as ImageRedaction,
            ),
          }),
        ),
      ),
    }),
  );
  return fc.oneof(command, insert, remove, move, update, ...onLayers, ...onFrames);
}

const delay = fc.oneof(fc.constantFrom(0, 1, 10, 65_535), fc.integer({ min: 0, max: 65_535 }));
const loop = fc.option(fc.oneof(fc.constantFrom(0, 1, 65_535), fc.nat(65_535)), { nil: null });

const frameWith = (itemKey: string): fc.Arbitrary<ImageFrame> =>
  fc.record({ key: fc.constant(itemKey), frame: fc.nat(SIZE.frames - 1), delay });

/** The valid frame commands for this plan: none for a still. */
function framesOn(state: ImagePlan, fresh: fc.Arbitrary<string[]>): fc.Arbitrary<ImageCommand>[] {
  if (state.animation === null) return [];
  const frames = state.animation.frames.map((frame) => frame.key);
  const commands: fc.Arbitrary<ImageCommand>[] = [
    fresh.chain((names) =>
      fc.record({
        type: fc.constant("image.insertFrames" as const),
        at: fc.nat(frames.length),
        frames: fc.tuple(...names.map(frameWith)),
      }),
    ),
    someOf(frames).chain((chosen) =>
      fc.record({
        type: fc.constant("image.moveFrames" as const),
        keys: fc.constant(chosen),
        to: fc.nat(frames.length - chosen.length),
      }),
    ),
    fc.constant({ type: "image.reverseFrames" as const }),
    someOf(frames).chain((chosen) =>
      fc.record({
        type: fc.constant("image.updateFrames" as const),
        updates: fc.tuple(
          ...chosen.map((itemKey) =>
            fc.record({ key: fc.constant(itemKey), props: fc.record({ delay }) }),
          ),
        ),
      }),
    ),
    loop.map((value) => ({ type: "image.setLoop" as const, loop: value })),
  ];
  // An animation keeps a frame, so there's one to remove only past the first.
  if (frames.length > 1) {
    commands.push(
      fc
        .shuffledSubarray(frames, { minLength: 1, maxLength: frames.length - 1 })
        .map((chosen) => ({ type: "image.removeFrames" as const, keys: chosen })),
    );
  }
  return commands;
}

/** A plan and a sequence of commands, each valid on the plan the one before it gives. */
function sequenceFrom(
  state: ImagePlan,
  count: number,
): fc.Arbitrary<{ readonly state: ImagePlan; readonly commands: readonly ImageCommand[] }> {
  if (count === 0) return fc.constant({ state, commands: [] });
  return commandOn(state).chain((next) =>
    sequenceFrom(reducer(state, next).state, count - 1).map((rest) => ({
      state: rest.state,
      commands: [next, ...rest.commands],
    })),
  );
}

/** A plan reached by applying valid commands to a new one. */
/** A new plan of source `s`: a still, or an animation of its first frames. */
const start: fc.Arbitrary<ImagePlan> = fc.oneof(
  { weight: 2, arbitrary: fc.constant(createPlan("s")) },
  {
    weight: 1,
    arbitrary: fc.tuple(loop, fc.integer({ min: 1, max: 3 }), delay).map(
      ([repeats, count, shown]): ImagePlan => ({
        ...createPlan("s"),
        animation: {
          loop: repeats,
          frames: Array.from({ length: count }, (_, frame) => ({
            key: `frame-${frame}`,
            frame,
            delay: shown,
          })),
        },
      }),
    ),
  },
);

export const plan: fc.Arbitrary<ImagePlan> = fc
  .tuple(start, fc.nat(6))
  .chain(([state, count]) => sequenceFrom(state, count))
  .map(({ state }) => state);

/** A plan, and a command that's valid for it. */
export const planAndCommand: fc.Arbitrary<readonly [ImagePlan, ImageCommand]> = plan.chain(
  (state) => commandOn(state).map((next) => [state, next] as const),
);

/** A plan, and up to eight commands that are valid for it in turn. */
export const planAndCommands: fc.Arbitrary<readonly [ImagePlan, readonly ImageCommand[]]> = fc
  .tuple(plan, fc.nat(8))
  .chain(([state, count]) =>
    sequenceFrom(state, count).map(({ commands }) => [state, commands] as const),
  );

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
      const chosen = add || fields.length === 0 ? name : (fields[index % fields.length] as string);
      // A list's `length` isn't a field: defining it would resize the list, or throw.
      const field = Array.isArray(copy) && chosen === "length" ? "size" : chosen;
      Object.defineProperty(copy, field, {
        value: replacement,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      return copy;
    });
