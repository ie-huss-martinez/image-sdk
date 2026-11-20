import {
  applyCommands,
  createHistory,
  createStore,
  type HistoryStep,
  withProcessingTime,
} from "@hussmartinez/sdk-core";
import { asImageError, throwIfAborted } from "../errors/error-helpers.js";
import { ImageError, isImageError } from "../errors/image-error.js";
import {
  animationLimits,
  checkFileLimits,
  checkOutputLimits,
  type ImageFilePolicy,
  type ImageFilePolicyOverrides,
  type ImageLimitName,
  imageLimits,
} from "../errors/image-limits.js";
import { drawingPoints } from "../model/drawing-geometry.js";
import { compositionSize, outputSize } from "../model/geometry.js";
import { createImageKey } from "../model/keys.js";
import { fittedImageSize, newLayerBox } from "../model/layer-placement.js";
import {
  createPlan,
  type ImageAnimation,
  type ImageImageLayer,
  type ImageLayer,
  type ImagePlan,
  type ImageStroke,
  MAX_ANIMATION_FRAMES,
} from "../model/plan.js";
import type {
  ImageKeepableMetadata,
  ImageMetadataPresence,
  ImageProbe,
  ImageSourceInfo,
} from "../model/source.js";
import { createImageReducer, type ImageCommand } from "../operations/commands.js";
import type { ImageEngine } from "../ports/image-engine.js";
import {
  type ImageExportFormat,
  type ImageProcessor,
  keepsFields,
} from "../ports/image-processor.js";

/**
 * The document's source, as the editor shows it: its size and format, and
 * what metadata the file carried, which the export summary reports as
 * removed unless the user kept it (ADR 0005).
 *
 * @public
 */
export interface ImageSessionSource extends ImageSourceInfo {
  /** The file's size in bytes, as it was opened. Never its name. */
  readonly fileSize: number;
  /** Which kinds of metadata the file carried, never their values. */
  readonly metadata: ImageMetadataPresence;
  /** The fields the user may choose to keep, as the file had them. */
  readonly keepable: ImageKeepableMetadata;
  /**
   * How many frames the file lists. More than `frames` when an animated
   * file is open as its first frame, or when its frames ended early
   * (docs/adr/0011).
   */
  readonly fileFrames: number;
}

/**
 * The session's state, for `useSyncExternalStore`: a new object on every
 * change (ADR 0003).
 *
 * @public
 */
export interface ImageSessionSnapshot {
  /** `empty` until a file opens; `opening` while the first one is; then `ready`. */
  readonly status: "empty" | "opening" | "ready";
  /** The document, or `null` before a file is open. */
  readonly plan: ImagePlan | null;
  /** The document's source, or `null` before a file is open. */
  readonly source: ImageSessionSource | null;
  /**
   * Every source the session holds: the document's, then those of image
   * layers, including ones only the history still refers to (ADR 0004).
   */
  readonly sources: readonly ImageSessionSource[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /**
   * Whether undo steps were dropped to make room for an image, since the
   * document was opened: they can no longer be undone.
   */
  readonly historyTrimmed: boolean;
  /** Whether an image is being added as a layer. */
  readonly inserting: boolean;
  /** Whether a file is being opened. The current document stays until it's ready. */
  readonly opening: boolean;
  /**
   * How far the open of an animation has got: the frames checked, of those
   * the file lists (docs/adr/0011). `null` when nothing is being opened,
   * and for a still.
   */
  readonly progress: { readonly done: number; readonly total: number } | null;
  /**
   * The first frame of the animation being opened, once it can be drawn and
   * while the rest are checked (docs/adr/0011): a source id a renderer of
   * the session's engine may draw as a still, and its size. `null` when
   * nothing is opening, for a still, and before the first frame is ready.
   */
  readonly openingFrame: {
    readonly source: string;
    readonly width: number;
    readonly height: number;
  } | null;
  /** Whether an export is in progress. */
  readonly exporting: boolean;
  /** The limits the last open, edit or export came near: at or above their warnings. */
  readonly warnings: readonly ImageLimitName[];
  /** The last failure, until the next successful open, edit or export. */
  readonly error: ImageError | null;
}

/**
 * An anonymous usage event for the host's `onEvent` (ADR 0003). It never
 * carries file names, pixels, text the user typed or metadata values.
 *
 * The session emits every type but `download`, which the editor's export
 * dialog emits when its Download button is activated: it asked the browser
 * to download the file, which `export` alone doesn't mean, since the user
 * may close the dialog without pressing it (docs/adr/0007). It isn't a
 * confirmed save: a sandboxed frame without `allow-downloads` starts no
 * download, and the person can cancel the browser's own prompt. A host that
 * needs to know the file was saved passes the editor's `onExport` and saves
 * it itself; then there's no `download`.
 *
 * @public
 */
export interface ImageSessionEvent {
  readonly type: "open" | "insert" | "execute" | "undo" | "redo" | "export" | "download";
  readonly outcome: "done" | "failed" | "cancelled";
  /** The types of the commands applied or undone. */
  readonly commands: readonly ImageCommand["type"][];
}

/**
 * Options for {@link createImageSession}.
 *
 * @public
 */
export interface ImageSessionOptions {
  /** Probes, decodes and holds sources. The session releases the sources it registered, never the engine. */
  readonly engine: ImageEngine;
  /** Renders and encodes exports, over the same engine's sources. */
  readonly processor: ImageProcessor;
  /** The host's limits, over `imageLimits`' defaults (ADR 0004). */
  readonly filePolicy?: ImageFilePolicyOverrides;
  /**
   * Whether an animated file opens as an animation (docs/adr/0011). `true`
   * when omitted. With `false`, every file opens as a still: an animated
   * one as its first frame, as before 0.7.0.
   */
  readonly animations?: boolean;
  readonly onEvent?: (event: ImageSessionEvent) => void;
}

/**
 * What an export produced, and what the summary before a download shows
 * (ADR 0003, ADR 0005).
 *
 * @public
 */
export interface ImageSessionExport {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
  /**
   * The kinds of metadata the source carried that the file doesn't: every
   * kind, since exports keep only the fields the user chose, which are
   * never these. Empty when the source carried none.
   */
  readonly removed: readonly (keyof ImageMetadataPresence)[];
  /** The fields the user kept, which the file carries. */
  readonly kept: readonly (keyof ImageKeepableMetadata)[];
}

/**
 * An image editing session (ADR 0003, ADR 0008): one document, its plan
 * over the source it opened, edited by commands with undo and redo, and
 * exported through its processor.
 *
 * @public
 */
export interface ImageSession {
  getSnapshot(): ImageSessionSnapshot;
  /** Calls the listener after every change. Returns a function that unsubscribes. */
  subscribe(listener: () => void): () => void;
  /**
   * Probes, checks and decodes a file, and makes it the document, with a new
   * plan and an empty history; the previous source is released (ADR 0003,
   * ADR 0004). The newest open wins: an open that finishes after a later one
   * started applies nothing, releases its source and rejects with
   * `ABORTED`. A failed or cancelled open leaves the current document as it
   * was. Probing and registration share the policy's `maxProcessingTime`
   * deadline, which aborts their signal with `PROCESSING_TIME_EXCEEDED`.
   */
  open(file: Blob, options?: { readonly signal?: AbortSignal }): Promise<ImageSessionSource>;
  /**
   * Probes, checks and decodes another file, and adds it to the document as
   * an image layer, as one undoable step (ADR 0003, ADR 0004).
   *
   * - **Limits:** the file's own, as for `open`; `maxFiles`, counting every
   *   source the session holds; and `maxSessionSize`, counting their decoded
   *   bytes. When the image doesn't fit, the session first drops the oldest
   *   undo steps that alone keep another image, and marks the history as
   *   trimmed. If that isn't enough, nothing is dropped and it fails with
   *   `SESSION_TOO_LARGE`.
   * - **Placement:** by default the image is centred on what's shown, at
   *   its own size or half the composition's, whichever is smaller, over
   *   every layer, and turned and mirrored back against the plan's
   *   rotation and flips, so it's seen as the file is. `place` returns other commands; they must refer to the
   *   source, or it's released.
   * - **Lifetime:** the session holds the source while the plan, an undo
   *   or redo step, or an export in progress refers to it, and releases it
   *   then.
   *
   * A failure, a cancellation, or another file opened meanwhile adds
   * nothing and releases the source.
   */
  insertImage(file: Blob, options?: ImageInsertOptions): Promise<ImageSessionSource>;
  /**
   * Applies commands as one undoable step. They're checked by the reducer,
   * then the output against `maxImageDimension` and `maxImagePixels`; a
   * failure throws `ImageError` and changes nothing.
   */
  execute(commands: ImageCommand | readonly ImageCommand[]): void;
  /**
   * Makes the document's plan equal to `plan`, as one undoable step of the
   * commands that reach it, checked as `execute` checks them (ADR 0003). A
   * plan equal to the current one changes nothing. A plan over another
   * source is `INVALID_COMMAND`, and so is one without `layers`,
   * `redactions` and `animation`, such as a plan stored before format
   * version 2. For editors whose host holds the plan.
   */
  applyPlan(plan: ImagePlan): void;
  /**
   * Runs `fn`, and records every step it executes as one undoable step, for
   * a gesture such as dragging a crop handle (ADR 0003). `fn` must be
   * synchronous.
   */
  group<T>(fn: () => T): T;
  /** Undoes the last step. Returns whether there was one. */
  undo(): boolean;
  /** Redoes the last undone step. Returns whether there was one. */
  redo(): boolean;
  /**
   * Renders and encodes the document (ADR 0003). An export that finishes
   * after another file was opened rejects with `ABORTED`. The policy's
   * `maxProcessingTime` aborts the processor's signal with
   * `PROCESSING_TIME_EXCEEDED`. Custom adapters must observe that signal;
   * a session cannot preempt an arbitrary adapter that ignores it.
   *
   * An animation exports as one frame to these formats: `frame`, an index
   * into the plan's `animation.frames`, 0 when omitted (docs/adr/0011).
   */
  export(
    format: ImageExportFormat,
    options?: {
      readonly signal?: AbortSignal;
      readonly onProgress?: (fraction: number) => void;
      readonly frame?: number;
    },
  ): Promise<ImageSessionExport>;
  /** Releases every source the session holds. Later calls throw. */
  destroy(): Promise<void>;
}

/**
 * Options for {@link ImageSession.insertImage}.
 *
 * @public
 */
export interface ImageInsertOptions {
  readonly signal?: AbortSignal;
  /**
   * The commands that add the image to the plan, instead of the default
   * layer: given the new source and the plan as it is.
   */
  readonly place?: (
    source: ImageSessionSource,
    plan: ImagePlan,
  ) => ImageCommand | readonly ImageCommand[];
}

/** The ids of the sources a command's image layers name. */
function sourcesIn(command: ImageCommand): string[] {
  const of = (layer: { kind?: unknown; source?: unknown }) =>
    layer.kind === "image" && typeof layer.source === "string" ? [layer.source] : [];
  switch (command.type) {
    case "image.insertLayers":
      return command.layers.flatMap(of);
    case "image.restoreLayers":
      return command.entries.flatMap(({ layer }) => of(layer));
    case "image.updateLayers":
      // An update may point a layer at another source.
      return command.updates.flatMap(({ props }) =>
        typeof props["source"] === "string" ? [props["source"]] : [],
      );
    default:
      return [];
  }
}

/**
 * The most drawing points the history's steps may hold between them (ADR
 * 0009): removing a large drawing leaves its points in the step that undoes
 * it. Above this, the oldest steps are dropped.
 */
const MAX_HISTORY_POINTS = 1_000_000;

/** How many points the strokes a command carries hold. */
function pointsIn(command: ImageCommand): number {
  const ofStrokes = (strokes: readonly ImageStroke[]) =>
    strokes.reduce(
      (points, stroke) => points + stroke.runs.reduce((sum, run) => sum + run.length / 2, 0),
      0,
    );
  const ofLayers = (layers: readonly ImageLayer[]) =>
    layers.reduce(
      (points, layer) => points + (layer.kind === "drawing" ? ofStrokes(layer.strokes) : 0),
      0,
    );
  switch (command.type) {
    case "image.addStrokes":
      return ofStrokes(command.strokes);
    case "image.restoreStrokes":
      return ofStrokes(command.entries.map((entry) => entry.stroke));
    case "image.insertLayers":
      return ofLayers(command.layers);
    case "image.restoreLayers":
      return ofLayers(command.entries.map((entry) => entry.layer));
    default:
      return 0;
  }
}

/** The ids of the sources a plan's image layers name. */
const sourcesOf = (plan: ImagePlan) =>
  plan.layers.flatMap((layer) => (layer.kind === "image" ? [layer.source] : []));

/**
 * The default layer for an inserted image: centred on what's shown, at its
 * own size or half the composition's, whichever is smaller, keeping its
 * shape, and neither turned nor mirrored as it's seen, whatever the plan's
 * rotation and flips.
 */
function defaultLayer(
  source: ImageSourceInfo,
  plan: ImagePlan,
  base: ImageSourceInfo,
): ImageImageLayer {
  const used = new Set([...plan.layers, ...plan.redactions].map((item) => item.key));
  return {
    key: createImageKey(used),
    kind: "image",
    name: "",
    visible: true,
    opacity: 100,
    // Turned and mirrored back against the plan's orientation, so it's seen
    // as the file is, in the preview and in every export.
    ...newLayerBox(plan, base, fittedImageSize(plan, base, source)),
    source: source.id,
    crop: null,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The commands that turn one animation into another (docs/adr/0011). A
 * frame the two share by key shows the same frame of the source: the
 * session refuses a plan where it doesn't, before this is called. An
 * animation always keeps a frame, so new frames go in before the last of
 * the old ones could go.
 */
function animationCommands(from: ImageAnimation, to: ImageAnimation): ImageCommand[] {
  const commands: ImageCommand[] = [];
  if (from.loop !== to.loop) commands.push({ type: "image.setLoop", loop: to.loop });
  if (same(from.frames, to.frames)) return commands;
  const before = new Set(from.frames.map((frame) => frame.key));
  const after = new Set(to.frames.map((frame) => frame.key));
  const added = to.frames.filter((frame) => !before.has(frame.key));
  const removed = from.frames.filter((frame) => !after.has(frame.key)).map((frame) => frame.key);
  if (added.length > 0) {
    commands.push({ type: "image.insertFrames", at: from.frames.length, frames: added });
  }
  if (removed.length > 0) commands.push({ type: "image.removeFrames", keys: removed });
  // Now the frames are the kept ones in their old order, then the new ones.
  const order = [
    ...from.frames.filter((frame) => after.has(frame.key)).map((frame) => frame.key),
    ...added.map((frame) => frame.key),
  ];
  const wanted = to.frames.map((frame) => frame.key);
  if (!same(order, wanted)) commands.push({ type: "image.setFrameOrder", keys: wanted });
  const delays = new Map(from.frames.map((frame) => [frame.key, frame.delay]));
  const updates = to.frames
    .filter((frame) => delays.has(frame.key) && delays.get(frame.key) !== frame.delay)
    .map((frame) => ({ key: frame.key, props: { delay: frame.delay } }));
  if (updates.length > 0) commands.push({ type: "image.updateFrames", updates });
  return commands;
}

/** The commands that turn `from` into `to`, field by field. */
export function commandsBetween(from: ImagePlan, to: ImagePlan): ImageCommand[] {
  const commands: ImageCommand[] = [];
  if (!same(from.base.crop, to.base.crop)) {
    commands.push({ type: "image.setCrop", crop: to.base.crop });
  }
  if (!same(from.base.orientation, to.base.orientation)) {
    commands.push({ type: "image.setOrientation", orientation: to.base.orientation });
  }
  const develop = Object.fromEntries(
    Object.entries(to.base.develop).filter(
      ([name, value]) => from.base.develop[name as keyof typeof from.base.develop] !== value,
    ),
  );
  if (Object.keys(develop).length > 0) {
    commands.push({ type: "image.setDevelop", values: develop });
  }
  if (!same(from.base.filter, to.base.filter)) {
    commands.push({ type: "image.setFilter", filter: to.base.filter });
  }
  if (!same(from.output, to.output)) {
    commands.push({ type: "image.setOutput", output: to.output });
  }
  for (const field of Object.keys(to.metadata) as (keyof ImageKeepableMetadata)[]) {
    if (from.metadata[field] !== to.metadata[field]) {
      commands.push({ type: "image.setMetadata", field, value: to.metadata[field] });
    }
  }
  if (!same(from.layers, to.layers)) {
    // The whole list is replaced: one step, whatever changed in it.
    if (from.layers.length > 0) {
      commands.push({ type: "image.removeLayers", keys: from.layers.map((layer) => layer.key) });
    }
    if (to.layers.length > 0) {
      commands.push({ type: "image.insertLayers", at: 0, layers: to.layers });
    }
  }
  if (from.animation !== null && to.animation !== null) {
    commands.push(...animationCommands(from.animation, to.animation));
  }
  if (!same(from.redactions, to.redactions)) {
    // The whole list is replaced: one step, whatever changed in it.
    if (from.redactions.length > 0) {
      commands.push({
        type: "image.removeRedactions",
        keys: from.redactions.map((redaction) => redaction.key),
      });
    }
    if (to.redactions.length > 0) {
      commands.push({ type: "image.insertRedactions", at: 0, redactions: to.redactions });
    }
  }
  return commands;
}

const PRESENCE: readonly (keyof ImageMetadataPresence)[] = [
  "location",
  "camera",
  "timestamps",
  "thumbnail",
  "colourProfile",
  "other",
];

/**
 * The plan for a newly opened source (docs/adr/0011): a still's, or for a
 * source held with several frames, one that plays them in order with the
 * file's timing.
 */
function planFor(info: ImageSourceInfo): ImagePlan {
  const plan = createPlan(info.id);
  if (info.timing === null || info.frames < 2) return plan;
  return {
    ...plan,
    animation: {
      loop: info.timing.loop,
      frames: info.timing.delays.map((delay, frame) => ({
        key: `frame-${frame + 1}`,
        frame,
        delay,
      })),
    },
  };
}

/** A probed image's decoded bytes, as the session counts them (ADR 0004). */
const decodedBytes = (probe: ImageProbe) => probe.oriented.width * probe.oriented.height * 4;

/** The source's own limits, and what holding it costs against `maxSessionSize`. */
function checkSource(
  policy: ImageFilePolicy,
  file: Blob,
  probe: ImageProbe,
  frames: "first" | "all",
): readonly ImageLimitName[] {
  const near = checkFileLimits(policy, file.size, probe, frames);
  // A new document holds this one source: the previous one's are released.
  const bytes = decodedBytes(probe);
  if (policy.check("maxSessionSize", bytes) === "warning") near.push("maxSessionSize");
  return near;
}

/**
 * Creates an {@link ImageSession} (ADR 0003): its store and history are
 * sdk-core's (ADR 0029), its reducer is {@link createImageReducer}, and it
 * reaches files only through its engine and processor.
 *
 * @example
 * ```ts
 * const engine = createImageEngine();
 * const session = createImageSession({ engine, processor: createImageProcessor(engine) });
 * await session.open(file);
 * session.execute({ type: "image.setDevelop", values: { exposure: 20 } });
 * const { blob, removed } = await session.export({ type: "jpeg", quality: 0.9 });
 * ```
 *
 * @public
 */
export function createImageSession(options: ImageSessionOptions): ImageSession {
  const { engine, processor } = options;
  const policy: ImageFilePolicy = imageLimits.resolve(options.filePolicy);
  const history = createHistory<ImageCommand>();
  let source: ImageSessionSource | null = null;
  /** The sources of image layers, by id, in the order they were added. */
  const extras = new Map<string, ImageSessionSource>();
  /** The plans of exports in progress, whose sources must outlive them. */
  const exports = new Set<ImagePlan>();
  const sourceOf = (id: string) => (source?.id === id ? source : extras.get(id));
  const reducer = createImageReducer(sourceOf);
  let plan: ImagePlan | null = null;
  /** Each open's number: only the latest may become the document. */
  let opens = 0;
  let opening = 0;
  /** The latest open's frames checked, while it checks them. */
  let progress: { readonly done: number; readonly total: number } | null = null;
  /** The latest open's first frame, once it can be drawn. */
  let openingFrame: ImageSessionSnapshot["openingFrame"] = null;
  let exporting = 0;
  let inserting = 0;
  /** Which document an async result belongs to. */
  let generation = 0;
  let warnings: readonly ImageLimitName[] = [];
  let error: ImageError | null = null;
  let nextId = 0;
  let destroyed = false;

  const snapshot = (): ImageSessionSnapshot => ({
    status: plan !== null ? "ready" : !destroyed && opening > 0 ? "opening" : "empty",
    plan,
    source,
    sources: source ? [source, ...extras.values()] : [],
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    historyTrimmed: history.trimmed,
    inserting: !destroyed && inserting > 0,
    opening: !destroyed && opening > 0,
    progress: !destroyed && opening > 0 ? progress : null,
    openingFrame: !destroyed && opening > 0 ? openingFrame : null,
    exporting: !destroyed && exporting > 0,
    warnings,
    error,
  });
  const store = createStore<ImageSessionSnapshot>(snapshot());
  const publish = () => store.set(snapshot());
  const emit = (event: ImageSessionEvent) => {
    try {
      options.onEvent?.(event);
    } catch {
      // A host's handler can't break the session.
    }
  };
  const assertAlive = () => {
    if (destroyed) throw new Error("The image session has been destroyed.");
  };
  const fail = (reason: unknown): ImageError => {
    error = isImageError(reason) ? reason : asImageError(reason);
    return error;
  };
  const superseded = () =>
    new ImageError("ABORTED", "A later open replaced this one.", {
      details: { reason: "superseded" },
    });

  /**
   * The ids of the sources something still refers to: the plan, exports in
   * progress, and history steps, leaving out the first `dropped` of the
   * order they'd be dropped in.
   */
  const referenced = (dropped = 0): Set<string> => {
    const ids = new Set<string>();
    for (const held of [plan, ...exports]) {
      if (held) for (const id of sourcesOf(held)) ids.add(id);
    }
    const gone = new Set(history.dropOrder.slice(0, dropped));
    for (const step of history.steps) {
      if (gone.has(step)) continue;
      for (const command of [...step.commands, ...step.inverses]) {
        for (const id of sourcesIn(command)) ids.add(id);
      }
    }
    return ids;
  };

  /** Releases every layer source nothing refers to any more (ADR 0003). */
  const releaseUnreferenced = () => {
    const kept = referenced();
    for (const id of [...extras.keys()]) {
      if (kept.has(id)) continue;
      extras.delete(id);
      void engine.release(id).catch(() => {});
    }
  };

  /** The decoded bytes of every source held, leaving out the layer sources `without` names. */
  const heldBytes = (without: ReadonlySet<string> = new Set()) => {
    let bytes = source?.decodedBytes ?? 0;
    for (const [id, extra] of extras) if (!without.has(id)) bytes += extra.decodedBytes;
    return bytes;
  };

  /** Whether a value is within a limit: `false`, or the check's outcome. */
  const fits = (limit: ImageLimitName, value: number) => {
    try {
      return policy.check(limit, value);
    } catch {
      return false;
    }
  };

  /**
   * Makes room for an image of `bytes` (ADR 0004). If it doesn't fit, drops
   * the fewest of the oldest history steps whose going frees enough: steps
   * that alone keep another image. If no number of them is enough, drops
   * nothing, and throws `SESSION_TOO_LARGE`.
   */
  const makeRoom = (bytes: number): readonly ImageLimitName[] => {
    const warned = (outcome: unknown): ImageLimitName[] =>
      outcome === "warning" ? ["maxSessionSize"] : [];
    const now = fits("maxSessionSize", heldBytes() + bytes);
    if (now !== false) return warned(now);
    for (let dropped = 1; dropped <= history.dropOrder.length; dropped += 1) {
      const kept = referenced(dropped);
      const freed = new Set([...extras.keys()].filter((id) => !kept.has(id)));
      const after = fits("maxSessionSize", heldBytes(freed) + bytes);
      if (after === false) continue;
      history.drop(dropped);
      releaseUnreferenced();
      return warned(after);
    }
    // Throws the limit's own error, with what it would take.
    policy.check("maxSessionSize", heldBytes() + bytes);
    return [];
  };

  /** The plan after `commands`, with its output checked, and the step. */
  const attempt = (from: ImagePlan, commands: readonly ImageCommand[]) => {
    const { state, inverses } = applyCommands(reducer, from, commands);
    if (source) {
      checkOutputLimits(policy, outputSize(state.output, compositionSize(state, source)));
    }
    // Only a step that adds items is checked, so a plan already over a
    // lowered limit can still be edited and emptied (ADR 0004).
    const items = state.layers.length + state.redactions.length;
    if (items > from.layers.length + from.redactions.length) policy.check("maxLayers", items);
    // And frames: duplicating can't pass what opening allows (docs/adr/0011).
    const frames = state.animation?.frames.length ?? 0;
    if (frames > (from.animation?.frames.length ?? 0)) policy.check("maxFrames", frames);
    // The same for drawn points: only a step that adds some is checked.
    const points = drawingPoints(state);
    if (points > drawingPoints(from)) policy.check("maxDrawingPoints", points);
    const step: HistoryStep<ImageCommand> = { commands: [...commands], inverses: [...inverses] };
    return { state, step };
  };

  /**
   * Says the plan is near its points limit while it is, and stops when it
   * isn't: after every change of plan, an undo and a redo included.
   */
  const notePoints = () => {
    let near = false;
    try {
      near = plan !== null && policy.check("maxDrawingPoints", drawingPoints(plan)) === "warning";
    } catch {
      // Over a lowered limit, which the plan may still be edited under: near, at least.
      near = true;
    }
    const noted = warnings.includes("maxDrawingPoints");
    if (near && !noted) warnings = [...warnings, "maxDrawingPoints"];
    if (!near && noted) warnings = warnings.filter((name) => name !== "maxDrawingPoints");
  };

  /**
   * Bounds what the history holds in drawn points (ADR 0009): above the
   * ceiling, drops the oldest steps, never the newest, and the history says
   * it was trimmed.
   */
  const trimPoints = () => {
    const held = () =>
      history.steps.reduce(
        (points, step) =>
          points + [...step.commands, ...step.inverses].reduce((sum, c) => sum + pointsIn(c), 0),
        0,
      );
    while (history.dropOrder.length > 1 && held() > MAX_HISTORY_POINTS) history.drop(1);
  };

  const replay = (direction: "undo" | "redo"): boolean => {
    assertAlive();
    const step = direction === "undo" ? history.undo() : history.redo();
    if (!step || plan === null) return false;
    const commands = direction === "undo" ? step.inverses : step.commands;
    try {
      plan = applyCommands(reducer, plan, commands).state;
    } catch (reason) {
      history.restore(direction);
      publish();
      emit({ type: direction, outcome: "failed", commands: commands.map((c) => c.type) });
      throw fail(reason);
    }
    error = null;
    notePoints();
    // A step that moved from one stack to the other still refers to its sources.
    releaseUnreferenced();
    publish();
    emit({ type: direction, outcome: "done", commands: commands.map((c) => c.type) });
    return true;
  };

  /** Applies commands as one undoable step: `execute`, which `applyPlan` shares. */
  const executeCommands = (input: ImageCommand | readonly ImageCommand[]) => {
    assertAlive();
    const commands = Array.isArray(input)
      ? (input as readonly ImageCommand[])
      : [input as ImageCommand];
    try {
      if (plan === null) {
        throw new ImageError("INVALID_COMMAND", "There's nothing to edit before a file is open.");
      }
      const result = attempt(plan, commands);
      plan = result.state;
      history.push(result.step);
      trimPoints();
      notePoints();
      error = null;
      // A new step drops what could be redone, and with it what only that kept.
      releaseUnreferenced();
      emit({ type: "execute", outcome: "done", commands: commands.map((c) => c.type) });
    } catch (reason) {
      emit({ type: "execute", outcome: "failed", commands: commands.map((c) => c.type) });
      throw fail(reason);
    } finally {
      publish();
    }
  };

  return {
    getSnapshot: () => store.getSnapshot(),
    subscribe: (listener) => store.subscribe(listener),

    async open(file, openOptions = {}) {
      assertAlive();
      opens += 1;
      const ticket = opens;
      nextId += 1;
      const id = `source-${nextId}`;
      let registered = false;
      opening += 1;
      publish();
      try {
        const { probe, near, info } = await withProcessingTime(
          policy,
          async (signal) => {
            throwIfAborted(signal);
            // One deadline covers both probing and decoding (sdk-core ADR 0020).
            policy.check("maxFileSize", file.size);
            const probe = await engine.probe(file, { signal });
            throwIfAborted(signal);
            // An animation is held with all its frames when it's within
            // the limits on one: its frames, what they could decode to, and
            // its screen. Over any of them the file opens as its first
            // frame, a still, and the snapshot's warnings name the limit: an
            // animation that can't be held opens as a still and says so
            // (docs/adr/0011). A host that wants stills only asked for
            // none, and the limits aren't consulted.
            const wanted = probe.frames > 1 && options.animations !== false;
            const limits = wanted
              ? animationLimits(policy, probe, MAX_ANIMATION_FRAMES)
              : { over: [], near: [] };
            const animated = wanted && limits.over.length === 0;
            // What it's held as is what's refused or warned of: a still
            // counts one frame.
            const near = [...checkSource(policy, file, probe, animated ? "all" : "first")];
            for (const limit of [...limits.over, ...limits.near]) {
              if (!near.includes(limit)) near.push(limit);
            }
            if (ticket !== opens) throw superseded();
            const info = await engine.register(id, file, probe, {
              filePolicy: policy,
              signal,
              ...(animated
                ? {
                    frames: "all" as const,
                    onFirstFrame: () => {
                      if (ticket !== opens || destroyed) return;
                      openingFrame = {
                        source: id,
                        width: probe.oriented.width,
                        height: probe.oriented.height,
                      };
                      publish();
                    },
                    onProgress: (fraction: number) => {
                      // Only the latest open's frames are the snapshot's.
                      if (ticket !== opens || destroyed) return;
                      const done = Math.round(fraction * probe.frames);
                      if (progress?.done === done) return;
                      progress = { done, total: probe.frames };
                      publish();
                    },
                  }
                : {}),
            });
            registered = true;
            throwIfAborted(signal);
            // What an animation holds is known only now: the new document
            // holds this one source.
            if (info.frames > 1) policy.check("maxSessionSize", info.decodedBytes);
            return { probe, near, info };
          },
          openOptions,
        );
        assertAlive();
        if (ticket !== opens) throw superseded();

        // From here to the end nothing awaits, so nothing can change under us.
        const previous = source;
        source = {
          ...info,
          fileSize: file.size,
          metadata: probe.metadata,
          keepable: probe.keepable,
          fileFrames: probe.frames,
        };
        plan = planFor(info);
        history.clear();
        generation += 1;
        warnings = near;
        error = null;
        if (previous) void engine.release(previous.id).catch(() => {});
        // The previous document's layer sources go with it, unless an
        // export of it is still running.
        releaseUnreferenced();
        emit({ type: "open", outcome: "done", commands: [] });
        return source;
      } catch (reason) {
        if (registered && source?.id !== id) await engine.release(id).catch(() => {});
        const failure = isImageError(reason) ? reason : asImageError(reason);
        const cancelled = failure.code === "ABORTED";
        // A superseded or cancelled open isn't the document's failure.
        if (!cancelled && !destroyed && ticket === opens) fail(failure);
        emit({ type: "open", outcome: cancelled ? "cancelled" : "failed", commands: [] });
        throw failure;
      } finally {
        opening -= 1;
        if (ticket === opens) {
          progress = null;
          openingFrame = null;
        }
        if (!destroyed) publish();
      }
    },

    async insertImage(file, insertOptions = {}) {
      assertAlive();
      if (plan === null || source === null) {
        throw new ImageError("INVALID_COMMAND", "There's no image to add a layer to yet.");
      }
      const started = generation;
      nextId += 1;
      const id = `source-${nextId}`;
      let registered = false;
      /** Once the session holds the source, only `releaseUnreferenced` releases it. */
      let held = false;
      inserting += 1;
      publish();
      try {
        const { probe, info } = await withProcessingTime(
          policy,
          async (signal) => {
            throwIfAborted(signal);
            policy.check("maxFileSize", file.size);
            const probe = await engine.probe(file, { signal });
            throwIfAborted(signal);
            // A layer's source is a still: an animated file's first frame.
            checkFileLimits(policy, file.size, probe, "first");
            const info = await engine.register(id, file, probe, { filePolicy: policy, signal });
            registered = true;
            throwIfAborted(signal);
            return { probe, info };
          },
          insertOptions,
        );
        assertAlive();
        if (started !== generation || plan === null || source === null) throw superseded();

        // From here to the end nothing awaits, so nothing can change under us.
        const near = checkFileLimits(policy, file.size, probe, "first");
        // Every source held, and this one.
        if (policy.check("maxFiles", extras.size + 2) === "warning") near.push("maxFiles");
        near.push(...makeRoom(info.decodedBytes));
        const added: ImageSessionSource = {
          ...info,
          fileSize: file.size,
          metadata: probe.metadata,
          keepable: probe.keepable,
          fileFrames: probe.frames,
        };
        extras.set(id, added);
        held = true;
        try {
          const placed = insertOptions.place?.(added, plan) ?? {
            type: "image.insertLayers",
            at: plan.layers.length,
            layers: [defaultLayer(added, plan, source)],
          };
          const commands = Array.isArray(placed)
            ? (placed as readonly ImageCommand[])
            : [placed as ImageCommand];
          // Checked before anything runs: commands that never name the
          // source would change the plan and leave the image out of it.
          if (!commands.some((command) => sourcesIn(command).includes(id))) {
            throw new ImageError(
              "INVALID_COMMAND",
              "The commands don't add the image to the plan.",
            );
          }
          executeCommands(commands);
        } finally {
          // Commands that failed, or that don't name the source, leave it
          // unreferenced: it's released here.
          releaseUnreferenced();
        }
        warnings = near;
        emit({ type: "insert", outcome: "done", commands: [] });
        return added;
      } catch (reason) {
        if (registered && !held) await engine.release(id).catch(() => {});
        const failure = isImageError(reason) ? reason : asImageError(reason);
        const cancelled = failure.code === "ABORTED";
        if (!cancelled && !destroyed && started === generation) fail(failure);
        emit({ type: "insert", outcome: cancelled ? "cancelled" : "failed", commands: [] });
        throw failure;
      } finally {
        inserting -= 1;
        if (!destroyed) publish();
      }
    },

    execute: (input) => executeCommands(input),

    applyPlan(next) {
      assertAlive();
      // A plan from before format version 2 has no lists: it's read with
      // `readImagePlanDocument`, which migrates it, not applied as it is.
      const shaped =
        Array.isArray(next.redactions) &&
        Array.isArray(next.layers) &&
        (next.animation === null || typeof next.animation === "object");
      // A still stays a still, and an animation an animation: no command
      // gives a plan an animation or takes it away (docs/adr/0011), so a
      // plan that differs in that isn't for this image.
      if (plan !== null && shaped && (next.animation === null) !== (plan.animation === null)) {
        const failure = new ImageError(
          "INVALID_COMMAND",
          plan.animation === null
            ? "The open image isn't an animation."
            : "The open image is an animation, and the plan has none.",
          { details: { reason: plan.animation === null ? "not-animated" : "no-frames" } },
        );
        error = failure;
        publish();
        throw failure;
      }
      if (plan !== null && shaped && next.base.source === plan.base.source) {
        // A frame is the frame of the source it shows: one that shows
        // another under the same key can't be reached by any command.
        const before = new Map(plan.animation?.frames.map((frame) => [frame.key, frame.frame]));
        const moved = next.animation?.frames.find(
          (frame) => before.has(frame.key) && before.get(frame.key) !== frame.frame,
        );
        if (moved) {
          const failure = new ImageError(
            "INVALID_COMMAND",
            "A frame can't show another frame of the source and keep its key.",
            { details: { reason: "duplicate-key" } },
          );
          error = failure;
          publish();
          throw failure;
        }
      }
      if (plan === null || !shaped || next.base.source !== plan.base.source) {
        const failure = new ImageError(
          "INVALID_COMMAND",
          shaped
            ? "The plan isn't for the open image."
            : "The plan needs layers, redactions and animation, as createPlan gives them.",
        );
        error = failure;
        publish();
        throw failure;
      }
      const commands = commandsBetween(plan, next);
      if (commands.length > 0) executeCommands(commands);
    },

    group(fn) {
      assertAlive();
      return history.group(fn);
    },

    undo: () => replay("undo"),
    redo: () => replay("redo"),

    async export(format, exportOptions = {}) {
      assertAlive();
      const { onProgress } = exportOptions;
      if (plan === null || source === null) {
        throw new ImageError("INVALID_COMMAND", "There's nothing to export before a file is open.");
      }
      const started = generation;
      const exported = plan;
      const from = source;
      exporting += 1;
      // Its sources outlive it: a layer removed, or another file opened,
      // while it runs releases nothing it draws.
      exports.add(exported);
      publish();
      try {
        const size = outputSize(exported.output, compositionSize(exported, from));
        const blob = await withProcessingTime(
          policy,
          async (signal) => {
            throwIfAborted(signal);
            const blob = await processor.export(
              {
                plan: exported,
                format,
                ...(exportOptions.frame === undefined ? {} : { frame: exportOptions.frame }),
              },
              {
                filePolicy: policy,
                signal,
                ...(onProgress ? { onProgress } : {}),
              },
            );
            throwIfAborted(signal);
            return blob;
          },
          exportOptions,
        );
        // The document was replaced while this export ran: it applies nothing.
        if (started !== generation || destroyed) {
          throw new ImageError("ABORTED", "Another file was opened during the export.", {
            details: { reason: "superseded" },
          });
        }
        error = null;
        emit({ type: "export", outcome: "done", commands: [] });
        return {
          blob,
          width: size.width,
          height: size.height,
          removed: PRESENCE.filter((kind) => from.metadata[kind]),
          // WebP and GIF carry no details: nothing the user kept is written.
          kept: !keepsFields(format.type)
            ? []
            : (Object.keys(exported.metadata) as (keyof ImageKeepableMetadata)[]).filter(
                (field) => exported.metadata[field] !== "",
              ),
        };
      } catch (reason) {
        const failure = isImageError(reason) ? reason : asImageError(reason);
        const cancelled = failure.code === "ABORTED";
        if (!cancelled && !destroyed && started === generation) fail(failure);
        emit({ type: "export", outcome: cancelled ? "cancelled" : "failed", commands: [] });
        throw failure;
      } finally {
        exporting -= 1;
        exports.delete(exported);
        if (!destroyed) {
          releaseUnreferenced();
          publish();
        }
      }
    },

    async destroy() {
      if (destroyed) return;
      destroyed = true;
      const held = [...(source ? [source.id] : []), ...extras.keys()];
      source = null;
      extras.clear();
      plan = null;
      history.clear();
      publish();
      await Promise.all(held.map((id) => engine.release(id).catch(() => {})));
    },
  };
}
