import type { Store } from "@hussmartinez/sdk-core";
import { PauseIcon, PlayIcon, Slider, ToggleButton } from "@hussmartinez/ui/react";
import { type ReactNode, useEffect, useRef } from "react";
import type { ImageAnimation } from "../../core/model/plan.js";
import type { ImageEditorState } from "../../features/editor-state.js";
import { nextFrame, shownDelay, withPlaying } from "../../features/playback/playback.js";
import { useImageDocument, useImageEditorState, useImageMessages } from "../hooks.js";
import { shownFrame } from "../stage/ImageStage.js";

/**
 * Plays the animation while the editor says it's playing, a frame at a time,
 * at its timing.
 *
 * A tick does nothing unless, when it fires, the animation is still playing
 * the frame it was set for. A pause or a seek cancels the tick only when the
 * effect cleans up, after React renders, and a tick already due by then
 * would otherwise undo it.
 *
 * @internal
 */
export function usePlayback(
  animation: ImageAnimation | null,
  playback: ImageEditorState["playback"],
  editor: Store<ImageEditorState>,
): void {
  /** How many times it has reached its end since Play was pressed. */
  const played = useRef(0);
  useEffect(() => {
    if (!playback.playing) played.current = 0;
  }, [playback.playing]);
  useEffect(() => {
    if (!animation || !playback.playing) return;
    const frame = Math.min(playback.frame, animation.frames.length - 1);
    const delay = shownDelay(animation.frames[frame]?.delay ?? 0);
    const timer = setTimeout(() => {
      const now = editor.getSnapshot().playback;
      if (!now.playing || now.frame !== playback.frame) return;
      const next = nextFrame(animation, frame, played.current);
      if (next) played.current = next.played;
      editor.set((state) => ({
        ...state,
        // The last frame stays when the loop count is spent.
        playback: next ? { frame: next.frame, playing: true } : { frame, playing: false },
      }));
    }, delay);
    return () => clearTimeout(timer);
  }, [animation, playback.frame, playback.playing, editor]);
}

/** The keys that move a slider, which pause playing whether or not the frame changes. */
const SCRUB_KEYS = /* @__PURE__ */ new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/**
 * The animation's bar under the stage (docs/adr/0011): Play, a frame
 * scrubber and where it is. Nothing plays on its own: an animation opens
 * paused on its first frame, and plays only when Play is pressed, or with
 * the editor's play-pause shortcut, Space, which the play tool has. Taking
 * the scrubber, with one of its keys or a press, pauses it, even when the
 * frame doesn't change, as with Home on the first frame.
 *
 * It shows only for an animated plan.
 */
export function AnimationBar(props: { readonly className?: string | undefined }): ReactNode {
  const { plan, status } = useImageDocument();
  const [editorState, editor] = useImageEditorState();
  const messages = useImageMessages();
  const animation = status === "ready" ? (plan?.animation ?? null) : null;
  const { playback } = editorState;
  usePlayback(animation, playback, editor);
  if (!animation || !plan) return null;

  const count = animation.frames.length;
  const frame = shownFrame(plan, playback.frame);
  const delay = animation.frames[frame]?.delay ?? 0;
  const position = (index: number) => messages.t("timeline.position", { frame: index + 1, count });
  const play = (playing: boolean) => editor.set((state) => withPlaying(state, plan, playing));
  const seek = (index: number) =>
    editor.set((state) => ({
      ...state,
      playback: { frame: Math.min(Math.max(0, Math.round(index)), count - 1), playing: false },
    }));
  // Taking the scrubber pauses, even when it doesn't move: Home on the first
  // frame changes no value, so the slider reports nothing to seek with.
  const pause = () =>
    editor.set((state) =>
      state.playback.playing
        ? { ...state, playback: { ...state.playback, playing: false } }
        : state,
    );
  const className = ["hm-image-timeline", props.className].filter(Boolean).join(" ");
  return (
    <section className={className} aria-label={messages.t("timeline.label")}>
      <ToggleButton
        label={messages.t("timeline.play")}
        // Pause while it plays, as players show it; its name stays Play, and pressed says it's on.
        icon={playback.playing ? <PauseIcon /> : <PlayIcon />}
        pressed={playback.playing}
        onPressedChange={play}
        // Space plays and pauses from anywhere in the editor but a control (sdk-core ADR 0030).
        aria-keyshortcuts="Space"
        disabled={count < 2}
      />
      <Slider
        className="hm-image-timeline-scrubber"
        label={messages.t("timeline.frame")}
        min={0}
        max={Math.max(1, count - 1)}
        step={1}
        value={frame}
        disabled={count < 2}
        formatValue={position}
        onValueChange={seek}
        onKeyDown={(event) => {
          // The slider's own keys: with Alt or Meta, they're the browser's.
          if (SCRUB_KEYS.has(event.key) && !event.altKey && !event.metaKey) pause();
        }}
        onPointerDown={pause}
      />
      <output className="hm-image-timeline-position" aria-hidden="true">
        {messages.t("timeline.where", { frame: frame + 1, count, seconds: delay / 100 })}
      </output>
    </section>
  );
}
