import {
  applyCommands,
  createHistory,
  createStore,
  type HistoryStep,
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
import { compositionSize, outputSize } from "../model/geometry.js";
import { createPlan, type ImagePlan } from "../model/plan.js";
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
  readonly canUndo: boolean;
  readonly canRedo: boolean;
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
  readonly type: "open" | "execute" | "undo" | "redo" | "export";
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
   * was.
   */
  open(file: Blob, options?: { readonly signal?: AbortSignal }): Promise<ImageSessionSource>;
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
   * source is `INVALID_COMMAND`. For editors whose host holds the plan.
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
   * after another file was opened rejects with `ABORTED`.
   */
  export(
    format: ImageExportFormat,
    options?: { readonly signal?: AbortSignal; readonly onProgress?: (fraction: number) => void },
  ): Promise<ImageSessionExport>;
  /** Releases the source the session holds. Later calls throw. */
  destroy(): Promise<void>;
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

/** The source's own limits, and what holding it costs against `maxSessionSize`. */
function checkSource(
  policy: ImageFilePolicy,
  file: Blob,
  probe: ImageProbe,
): readonly ImageLimitName[] {
  const near = checkFileLimits(policy, file.size, probe);
  // One document at a time: the session holds this one source.
  const bytes = probe.oriented.width * probe.oriented.height * 4;
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
  const reducer = createImageReducer((id) =>
    source !== null && source.id === id ? source : undefined,
  );
  let plan: ImagePlan | null = null;
  /** Each open's number: only the latest may become the document. */
  let opens = 0;
  let opening = 0;
  let exporting = 0;
  /** Which document an async result belongs to. */
  let generation = 0;
  let warnings: readonly ImageLimitName[] = [];
  let error: ImageError | null = null;
  let nextId = 0;
  let destroyed = false;

  const snapshot = (): ImageSessionSnapshot => ({
    status: plan !== null ? "ready" : opening > 0 ? "opening" : "empty",
    plan,
    source,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    opening: opening > 0,
    exporting: exporting > 0,
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

  /** The plan after `commands`, with its output checked, and the step. */
  const attempt = (from: ImagePlan, commands: readonly ImageCommand[]) => {
    const { state, inverses } = applyCommands(reducer, from, commands);
    if (source) {
      checkOutputLimits(policy, outputSize(state.output, compositionSize(state, source)));
    }
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
      const { signal } = openOptions;
      opens += 1;
      const ticket = opens;
      nextId += 1;
      const id = `source-${nextId}`;
      let registered = false;
      opening += 1;
      publish();
      try {
        throwIfAborted(signal);
        // Before reading anything, then the rest against the probe (ADR 0004).
        policy.check("maxFileSize", file.size);
        const probe = await engine.probe(file, signal ? { signal } : {});
        const near = checkSource(policy, file, probe);
        if (ticket !== opens) throw superseded();
        const info = await engine.register(id, file, probe, {
          filePolicy: policy,
          ...(signal ? { signal } : {}),
        });
        registered = true;
        throwIfAborted(signal);
        assertAlive();
        if (ticket !== opens) throw superseded();

        // From here to the end nothing awaits, so nothing can change under us.
        const previous = source;
        source = { ...info, metadata: probe.metadata, keepable: probe.keepable };
        plan = createPlan(id);
        history.clear();
        generation += 1;
        warnings = near;
        error = null;
        if (previous) void engine.release(previous.id).catch(() => {});
        emit({ type: "open", outcome: "done", commands: [] });
        return source;
      } catch (reason) {
        if (registered && source?.id !== id) await engine.release(id).catch(() => {});
        const failure = isImageError(reason) ? reason : asImageError(reason);
        const cancelled = failure.code === "ABORTED";
        // A superseded or cancelled open isn't the document's failure.
        if (!cancelled) fail(failure);
        emit({ type: "open", outcome: cancelled ? "cancelled" : "failed", commands: [] });
        throw failure;
      } finally {
        opening -= 1;
        publish();
      }
    },

    execute: (input) => executeCommands(input),

    applyPlan(next) {
      assertAlive();
      if (plan === null || next.base.source !== plan.base.source) {
        const failure = new ImageError("INVALID_COMMAND", "The plan isn't for the open image.");
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
      const { signal, onProgress } = exportOptions;
      if (plan === null || source === null) {
        throw new ImageError("INVALID_COMMAND", "There's nothing to export before a file is open.");
      }
      const started = generation;
      const exported = plan;
      const from = source;
      exporting += 1;
      publish();
      try {
        const size = outputSize(exported.output, compositionSize(exported, from));
        const blob = await processor.export(
          { plan: exported, format },
          {
            filePolicy: policy,
            ...(signal ? { signal } : {}),
            ...(onProgress ? { onProgress } : {}),
          },
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
        if (!cancelled) fail(failure);
        emit({ type: "export", outcome: cancelled ? "cancelled" : "failed", commands: [] });
        throw failure;
      } finally {
        exporting -= 1;
        if (!destroyed) publish();
      }
    },

    async destroy() {
      if (destroyed) return;
      destroyed = true;
      const held = source;
      source = null;
      plan = null;
      history.clear();
      publish();
      if (held) await engine.release(held.id).catch(() => {});
    },
  };
}
