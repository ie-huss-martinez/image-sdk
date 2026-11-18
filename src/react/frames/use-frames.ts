import { useAnnounce } from "@hussmartinez/ui/react";
import { useMemo } from "react";
import { createImageKey } from "../../core/model/keys.js";
import type { ImageFrame, ImagePlan } from "../../core/model/plan.js";
import { NO_TOOL } from "../../features/editor-state.js";
import { useImageInternals } from "../hooks.js";

/**
 * A frame's delay in seconds, as the frames list shows it: with two
 * decimals, since delays are whole hundredths of a second.
 */
export function frameSeconds(delay: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(delay / 100);
}

/** Every key the plan uses, which a new frame's key must avoid. */
const keysOf = (plan: ImagePlan) =>
  new Set(
    [...plan.layers, ...plan.redactions, ...(plan.animation?.frames ?? [])].map(
      (item: { key: string }) => item.key,
    ),
  );

/**
 * What the frames panel does (docs/adr/0011). Frames are named by their
 * place, from 0, in the plan's `animation.frames`. Each edit is one step,
 * and says what it did. The frame selected is the frame shown, so selecting
 * one pauses playing and shows it.
 */
export interface FrameActions {
  /** Shows a frame, paused. */
  select(index: number): void;
  /** Moves a frame one place earlier, or later, and keeps it selected. */
  shift(index: number, by: 1 | -1): void;
  /** Adds a copy after a frame, and selects it. Throws what the session refuses. */
  duplicate(index: number): void;
  /** Removes a frame, and selects the one now in its place, or the new last. */
  remove(index: number): void;
  /** Reverses the order of the frames. */
  reverse(): void;
  /** Sets a frame's delay, in hundredths of a second. */
  setDelay(index: number, delay: number): void;
  /** Sets every frame's delay to one frame's, as one step. */
  delayAll(index: number): void;
  /** Sets how many times the animation repeats: `null` for once, 0 for ever. */
  setLoop(loop: number | null): void;
  /** Stops showing the frames. */
  done(): void;
}

export function useFrameActions(): FrameActions {
  const { session, editor, messages } = useImageInternals();
  const announce = useAnnounce();
  return useMemo(() => {
    const frames = (): readonly ImageFrame[] => session.getSnapshot().plan?.animation?.frames ?? [];
    const show = (index: number) =>
      editor.set((state) =>
        state.playback.frame === index && !state.playback.playing
          ? state
          : { ...state, playback: { frame: index, playing: false } },
      );
    return {
      select(index) {
        if (index >= 0 && index < frames().length) show(index);
      },
      shift(index, by) {
        const frame = frames()[index];
        const to = index + by;
        if (!frame || to < 0 || to >= frames().length) return;
        // `to` is a place in the list without the frame, which is where it ends.
        session.execute({ type: "image.moveFrames", keys: [frame.key], to });
        show(to);
        announce(
          messages.t(by < 0 ? "frames.movedEarlier" : "frames.movedLater", {
            from: index + 1,
            index: to + 1,
            count: frames().length,
          }),
        );
      },
      duplicate(index) {
        const plan = session.getSnapshot().plan;
        const frame = frames()[index];
        if (!plan || !frame) return;
        session.execute({
          type: "image.insertFrames",
          at: index + 1,
          frames: [{ ...frame, key: createImageKey(keysOf(plan)) }],
        });
        show(index + 1);
        announce(messages.t("frames.duplicated", { index: index + 1, copy: index + 2 }));
      },
      remove(index) {
        const frame = frames()[index];
        if (!frame || frames().length < 2) return;
        session.execute({ type: "image.removeFrames", keys: [frame.key] });
        const count = frames().length;
        show(Math.min(index, count - 1));
        announce(messages.t("frames.removed", { index: index + 1, count }));
      },
      reverse() {
        const count = frames().length;
        if (count < 2) return;
        session.execute({ type: "image.reverseFrames" });
        // The frame shown stays shown, at its new place.
        editor.set((state) => ({
          ...state,
          playback: {
            frame: count - 1 - Math.min(state.playback.frame, count - 1),
            playing: false,
          },
        }));
        announce(messages.t("frames.reversed"));
      },
      setDelay(index, delay) {
        const frame = frames()[index];
        if (!frame || frame.delay === delay) return;
        session.execute({
          type: "image.updateFrames",
          updates: [{ key: frame.key, props: { delay } }],
        });
      },
      delayAll(index) {
        const delay = frames()[index]?.delay;
        if (delay === undefined) return;
        const updates = frames()
          .filter((frame) => frame.delay !== delay)
          .map((frame) => ({ key: frame.key, props: { delay } }));
        if (updates.length > 0) session.execute({ type: "image.updateFrames", updates });
        announce(
          messages.t("frames.delayedAll", { seconds: frameSeconds(delay, messages.locale) }),
        );
      },
      setLoop(loop) {
        if (session.getSnapshot().plan?.animation?.loop === loop) return;
        session.execute({ type: "image.setLoop", loop });
      },
      done() {
        editor.set((state) => (state.tool === "frames" ? { ...state, ...NO_TOOL } : state));
      },
    };
  }, [session, editor, messages, announce]);
}
