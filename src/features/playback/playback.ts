import type { ImageAnimation, ImagePlan } from "../../core/model/plan.js";
import type { ImageEditorState } from "../editor-state.js";

/**
 * How long a frame is shown while playing, in milliseconds (docs/adr/0011):
 * its delay, except that a delay under 2 hundredths of a second is shown as
 * 10, as browsers show it. The plan and the export keep the delay as it is.
 */
export function shownDelay(delay: number): number {
  return (delay < 2 ? 10 : delay) * 10;
}

/**
 * What comes after a frame while playing: the next frame, the first again
 * while the loop count allows, or `null` to stop on the last.
 *
 * @param played - How many times the animation has reached its end so far.
 */
export function nextFrame(
  animation: ImageAnimation,
  frame: number,
  played: number,
): { readonly frame: number; readonly played: number } | null {
  if (frame + 1 < animation.frames.length) return { frame: frame + 1, played };
  // `null` plays once; 0 for ever; n repeats n times after the first play.
  if (animation.loop === null) return null;
  if (animation.loop !== 0 && played + 1 > animation.loop) return null;
  return { frame: 0, played: played + 1 };
}

/**
 * The editor's state with playing turned on or off (docs/adr/0011). Turned
 * on at the last frame, it starts again from the first. A plan without an
 * animation, or with one frame, has nothing to play.
 */
export function withPlaying(
  state: ImageEditorState,
  plan: ImagePlan | null,
  playing: boolean,
): ImageEditorState {
  const count = plan?.animation?.frames.length ?? 0;
  if (count < 2)
    return state.playback.playing
      ? { ...state, playback: { ...state.playback, playing: false } }
      : state;
  const at = Math.min(Math.max(0, state.playback.frame), count - 1);
  return { ...state, playback: { frame: playing && at === count - 1 ? 0 : at, playing } };
}
