import { applyCommands, type Store } from "@hussmartinez/sdk-core";
import { useEffect, useMemo } from "react";
import { createImageReducer, type ImageCommand } from "../core/operations/commands.js";
import type { ImageSession } from "../core/session/session.js";
import type { ImageEditorState } from "../features/editor-state.js";
import { useImageInternals } from "./hooks.js";

/** How long after the last keystroke typing in a text layer becomes one step (docs/adr/0007). Arrow keys on a frame make a step per press, not after a delay. */
export const KEYBOARD_COMMIT_DELAY = 500;

/**
 * One gesture of a continuous control, such as a slider (docs/adr/0007):
 * while it runs, the stage renders a transient plan, the session's plan with
 * the gesture's commands applied by the same reducer, and the session, its
 * history and the host's `onChange` don't see it. When it ends, its commands
 * execute as one undoable step.
 */
export interface Gesture {
  /** Shows these commands on the stage, replacing the gesture's earlier ones. */
  preview(commands: readonly ImageCommand[]): void;
  /** Ends the gesture now: its commands execute as one step, if it has any. */
  commit(): void;
  /** Ends the gesture after the typing delay, unless it continues before then: typing in a text layer. */
  commitSoon(): void;
  /** Ends the gesture with no step, and the stage shows the session's plan again. */
  cancel(): void;
  /** Whether a gesture is running. */
  readonly active: () => boolean;
}

/** A gesture over a session and an editor's state. */
function createGesture(session: ImageSession, editor: Store<ImageEditorState>): Gesture {
  let pending: readonly ImageCommand[] | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The base's source and every image layer's, as the session's own reducer has them.
  const reducer = createImageReducer((id) =>
    session.getSnapshot().sources.find((source) => source.id === id),
  );
  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const end = () => {
    clearTimer();
    pending = undefined;
    editor.set((state) => (state.preview === null ? state : { ...state, preview: null }));
  };
  const value: Gesture = {
    preview(commands) {
      const plan = session.getSnapshot().plan;
      if (!plan) return;
      // Checked by the reducer, as executing them will be: a value it
      // refuses never reaches the stage.
      const preview = applyCommands(reducer, plan, commands).state;
      pending = commands;
      editor.set((state) => ({ ...state, preview }));
    },
    commit() {
      const commands = pending;
      end();
      if (commands && commands.length > 0) session.execute(commands);
    },
    commitSoon() {
      clearTimer();
      timer = setTimeout(() => value.commit(), KEYBOARD_COMMIT_DELAY);
    },
    cancel: end,
    active: () => pending !== undefined,
  };
  return value;
}

export function useGesture(): Gesture {
  const { session, editor } = useImageInternals();
  const gesture = useMemo(() => createGesture(session, editor), [editor, session]);
  // A control that goes away ends its gesture, so nothing is left half-done.
  useEffect(() => () => gesture.commit(), [gesture]);
  return gesture;
}

/** One gesture per editor, for the parts of a tool that share it. */
const shared = new WeakMap<Store<ImageEditorState>, Gesture>();

/**
 * A gesture that every caller in the same editor shares, so a tool's frame
 * on the stage and its panel in the inspector end each other's gestures
 * rather than leaving one running under the other's edit.
 */
export function useSharedGesture(): Gesture {
  const { session, editor } = useImageInternals();
  const gesture = useMemo(() => {
    const existing = shared.get(editor);
    if (existing) return existing;
    const created = createGesture(session, editor);
    shared.set(editor, created);
    return created;
  }, [editor, session]);
  useEffect(() => () => gesture.commit(), [gesture]);
  return gesture;
}
