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
  checkFileLimits,
  checkOutputLimits,
  type ImageFilePolicy,
  type ImageFilePolicyOverrides,
  type ImageLimitName,
  imageLimits,
} from "../errors/image-limits.js";
import { compositionSize, cropRect, outputSize } from "../model/geometry.js";
import { createImageKey } from "../model/keys.js";
import { createPlan, type ImageImageLayer, type ImagePlan } from "../model/plan.js";
import type {
  ImageKeepableMetadata,
  ImageMetadataPresence,
  ImageProbe,
  ImageSourceInfo,
} from "../model/source.js";
import { createImageReducer, type ImageCommand } from "../operations/commands.js";
import type { ImageEngine } from "../ports/image-engine.js";
import type { ImageExportFormat, ImageProcessor } from "../ports/image-processor.js";

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
 * @public
 */
export interface ImageSessionEvent {
  readonly type: "open" | "insert" | "execute" | "undo" | "redo" | "export";
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
   *   every layer. `place` returns other commands; they must refer to the
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
   */
  export(
    format: ImageExportFormat,
    options?: { readonly signal?: AbortSignal; readonly onProgress?: (fraction: number) => void },
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

/** The ids of the sources a plan's image layers name. */
const sourcesOf = (plan: ImagePlan) =>
  plan.layers.flatMap((layer) => (layer.kind === "image" ? [layer.source] : []));

/**
 * The default layer for an inserted image: centred on what's shown, at its
 * own size or half the composition's, whichever is smaller, keeping its
 * shape.
 */
function defaultLayer(
  source: ImageSourceInfo,
  plan: ImagePlan,
  base: ImageSourceInfo,
): ImageImageLayer {
  const shown = cropRect(plan.base.crop, base);
  const scale = Math.min(1, shown.width / 2 / source.width, shown.height / 2 / source.height);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const used = new Set([...plan.layers, ...plan.redactions].map((item) => item.key));
  return {
    key: createImageKey(used),
    kind: "image",
    name: "",
    visible: true,
    opacity: 100,
    x: shown.x + Math.round((shown.width - width) / 2),
    y: shown.y + Math.round((shown.height - height) / 2),
    width,
    height,
    rotation: 0,
    source: source.id,
    crop: null,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

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

/** A probed image's decoded bytes, as the session counts them (ADR 0004). */
const decodedBytes = (probe: ImageProbe) => probe.oriented.width * probe.oriented.height * 4;

/** The source's own limits, and what holding it costs against `maxSessionSize`. */
function checkSource(
  policy: ImageFilePolicy,
  file: Blob,
  probe: ImageProbe,
): readonly ImageLimitName[] {
  const near = checkFileLimits(policy, file.size, probe);
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

  /** Whether the session may hold this many decoded bytes: `false`, or the check's outcome. */
  const fits = (bytes: number) => {
    try {
      return policy.check("maxSessionSize", bytes);
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
    const now = fits(heldBytes() + bytes);
    if (now !== false) return warned(now);
    for (let dropped = 1; dropped <= history.dropOrder.length; dropped += 1) {
      const kept = referenced(dropped);
      const freed = new Set([...extras.keys()].filter((id) => !kept.has(id)));
      const after = fits(heldBytes(freed) + bytes);
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
    const step: HistoryStep<ImageCommand> = { commands: [...commands], inverses: [...inverses] };
    return { state, step };
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
            const near = checkSource(policy, file, probe);
            if (ticket !== opens) throw superseded();
            const info = await engine.register(id, file, probe, { filePolicy: policy, signal });
            registered = true;
            throwIfAborted(signal);
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
        };
        plan = createPlan(id);
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
            checkFileLimits(policy, file.size, probe);
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
        const near = checkFileLimits(policy, file.size, probe);
        // Every source held, and this one.
        if (policy.check("maxFiles", extras.size + 2) === "warning") near.push("maxFiles");
        near.push(...makeRoom(info.decodedBytes));
        const added: ImageSessionSource = {
          ...info,
          fileSize: file.size,
          metadata: probe.metadata,
          keepable: probe.keepable,
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
        Array.isArray(next.redactions) && Array.isArray(next.layers) && next.animation === null;
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
              { plan: exported, format },
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
          kept: (Object.keys(exported.metadata) as (keyof ImageKeepableMetadata)[]).filter(
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
