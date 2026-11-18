import { describe, expect, it } from "vitest";
import type { ImageAnimation } from "../../core/model/plan.js";
import { nextFrame, shownDelay } from "./playback.js";

const animation = (count: number, loop: number | null): ImageAnimation => ({
  loop,
  frames: Array.from({ length: count }, (_, frame) => ({ key: `f${frame}`, frame, delay: 5 })),
});

/** Every frame shown, from the first, until playing stops, or `limit` frames. */
function played(of: ImageAnimation, limit = 50): number[] {
  const shown = [0];
  let state: { frame: number; played: number } | null = { frame: 0, played: 0 };
  while (shown.length < limit) {
    state = nextFrame(of, state.frame, state.played);
    if (state === null) break;
    shown.push(state.frame);
  }
  return shown;
}

describe("playing an animation (docs/adr/0011)", () => {
  it("shows a delay under 2 hundredths as 10, as browsers do, and any other as it is", () => {
    expect([0, 1, 2, 3, 10, 65_535].map(shownDelay)).toEqual([100, 100, 20, 30, 100, 655_350]);
  });

  it("plays once, repeats a number of times, or for ever, as the loop count says", () => {
    expect(played(animation(3, null))).toEqual([0, 1, 2]);
    expect(played(animation(3, 1))).toEqual([0, 1, 2, 0, 1, 2]);
    expect(played(animation(2, 2))).toEqual([0, 1, 0, 1, 0, 1]);
    expect(played(animation(2, 0), 9)).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0]);
    // One frame: nothing to play once; for ever, the same frame again.
    expect(played(animation(1, null))).toEqual([0]);
  });
});
