import { applyCommands } from "@hussmartinez/sdk-core";
import { useEffect, useMemo } from "react";
import { createImageReducer, type ImageCommand } from "../core/operations/commands.js";
import { useImageInternals } from "./hooks.js";

/** How long after the last key of a keyboard adjustment its gesture ends (docs/adr/0007). */
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
  /** Ends the gesture after the keyboard delay, unless it continues before then. */
  commitSoon(): void;
  /** Ends the gesture with no step, and the stage shows the session's plan again. */
  cancel(): void;
  /** Whether a gesture is running. */
  readonly active: () => boolean;
}

export function useGesture(): Gesture {
  const { session, editor } = useImageInternals();
  const gesture = useMemo(() => {
    let pending: readonly ImageCommand[] | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reducer = createImageReducer((id) => {
      const source = session.getSnapshot().source;
      return source && source.id === id ? source : undefined;
    });
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
  }, [editor, session]);
  // A control that goes away ends its gesture, so nothing is left half-done.
  useEffect(() => () => gesture.commit(), [gesture]);
  return gesture;
}
