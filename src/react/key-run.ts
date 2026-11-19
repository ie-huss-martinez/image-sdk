/**
 * The arrow keys held on a frame on the stage, so a nudge is one step per
 * press, and one per key held down however many times it repeats
 * (docs/adr/0007): the step is taken when the last key held is let go, or
 * when focus leaves first. Escape during a run cancels it, and the rest of
 * it is ignored until every key is let go, so a key still held doesn't
 * start another.
 *
 * It's the family's rule for keyboard moves, as ui's `Slider` keeps it
 * for a slider's keys.
 */
export interface KeyRun {
  /** A key pressed, or repeating. Returns whether it should move the frame. */
  press(key: string): boolean;
  /** A key let go. Returns whether that ended a run to commit. */
  release(key: string): boolean;
  /** Escape. Returns whether there was a run to cancel. */
  cancel(): boolean;
  /** Focus leaving. Returns whether there was a run to commit. */
  leave(): boolean;
  /**
   * A pointer taking the gesture. Returns whether there was a run to
   * commit first. Keys still held after Escape stay ignored until they're
   * let go, as they would be without the pointer.
   */
  handOff(): boolean;
}

export function createKeyRun(): KeyRun {
  const held = new Set<string>();
  /** Whether a run is moving the frame, since its first key. */
  let running = false;
  /** After Escape, until every key is let go. */
  let cancelled = false;
  return {
    press(key) {
      held.add(key);
      if (cancelled) return false;
      running = true;
      return true;
    },
    release(key) {
      if (!held.delete(key) || held.size > 0) return false;
      const ended = running && !cancelled;
      running = false;
      cancelled = false;
      return ended;
    },
    cancel() {
      if (!running) return false;
      running = false;
      cancelled = held.size > 0;
      return true;
    },
    handOff() {
      const ended = running && !cancelled;
      running = false;
      return ended;
    },
    leave() {
      held.clear();
      const ended = running && !cancelled;
      running = false;
      cancelled = false;
      return ended;
    },
  };
}
