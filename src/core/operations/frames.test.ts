import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { plan as planArb, reducer } from "../../../test/arbitraries/image-plan.js";
import { type ImageError, isImageError } from "../errors/image-error.js";
import {
  createPlan,
  type ImageAnimation,
  type ImagePlan,
  MAX_ANIMATION_FRAMES,
} from "../model/plan.js";
import { createImageReducer, type ImageCommand } from "./commands.js";

/**
 * The animation's commands (docs/adr/0011): each edits the frames or the
 * loop count, and returns what undoes it exactly.
 */

const ANIMATION: ImageAnimation = {
  loop: 0,
  frames: [
    { key: "a", frame: 0, delay: 10 },
    { key: "b", frame: 1, delay: 20 },
    { key: "c", frame: 2, delay: 30 },
    { key: "d", frame: 1, delay: 40 },
  ],
};
const ANIMATED: ImagePlan = { ...createPlan("s"), animation: ANIMATION };
const keys = (state: ImagePlan) => state.animation?.frames.map((frame) => frame.key);

/** Applies a command, checks its inverse restores the plan, and returns the result. */
function run(command: unknown, from: ImagePlan = ANIMATED): ImagePlan {
  const { state, inverse } = reducer(from, command as ImageCommand);
  expect(reducer(state, inverse).state).toEqual(from);
  return state;
}

function reason(command: unknown, from: ImagePlan = ANIMATED): unknown {
  try {
    reducer(from, command as ImageCommand);
  } catch (error) {
    expect(isImageError(error, "INVALID_COMMAND")).toBe(true);
    return (error as ImageError).details?.["reason"];
  }
  throw new Error("expected a refusal");
}

describe("the animation's commands (docs/adr/0011)", () => {
  it("inserts frames at an index, such as a duplicate after its original", () => {
    const state = run({
      type: "image.insertFrames",
      at: 1,
      frames: [
        { key: "a2", frame: 0, delay: 10 },
        { key: "e", frame: 4, delay: 0 },
      ],
    });
    expect(keys(state)).toEqual(["a", "a2", "e", "b", "c", "d"]);
    expect(state.animation?.frames[1]).toEqual({ key: "a2", frame: 0, delay: 10 });
    expect(state.animation?.loop).toBe(0);
  });

  it("removes frames, and puts each back where it was", () => {
    const state = run({ type: "image.removeFrames", keys: ["d", "b"] });
    expect(keys(state)).toEqual(["a", "c"]);
    // Trimming to one frame is allowed; to none isn't.
    expect(keys(run({ type: "image.removeFrames", keys: ["a", "b", "c"] }))).toEqual(["d"]);
    expect(reason({ type: "image.removeFrames", keys: ["a", "b", "c", "d"] })).toBe("no-frames");
  });

  it("moves frames to an index of the list without them, keeping their order", () => {
    expect(keys(run({ type: "image.moveFrames", keys: ["d", "b"], to: 0 }))).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);
    expect(keys(run({ type: "image.moveFrames", keys: ["a"], to: 3 }))).toEqual([
      "b",
      "c",
      "d",
      "a",
    ]);
    expect(reason({ type: "image.moveFrames", keys: ["a"], to: 4 })).toBe("invalid-index");
  });

  it("reverses the frames, which undoes itself", () => {
    const state = run({ type: "image.reverseFrames" });
    expect(keys(state)).toEqual(["d", "c", "b", "a"]);
    expect(reducer(ANIMATED, { type: "image.reverseFrames" }).inverse).toEqual({
      type: "image.reverseFrames",
    });
  });

  it("sets delays, one frame's or every frame's, as one command", () => {
    const one = run({ type: "image.updateFrames", updates: [{ key: "b", props: { delay: 0 } }] });
    expect(one.animation?.frames.map((frame) => frame.delay)).toEqual([10, 0, 30, 40]);
    const all = run({
      type: "image.updateFrames",
      updates: ANIMATION.frames.map(({ key }) => ({ key, props: { delay: 65_535 } })),
    });
    expect(all.animation?.frames.every((frame) => frame.delay === 65_535)).toBe(true);
    // Only the delay can be set: which frame it shows is its identity.
    expect(
      reason({ type: "image.updateFrames", updates: [{ key: "b", props: { frame: 0 } }] }),
    ).toBe("malformed-command");
    expect(
      reason({ type: "image.updateFrames", updates: [{ key: "b", props: { delay: 65_536 } }] }),
    ).toBe("invalid-delay");
    expect(
      reason({ type: "image.updateFrames", updates: [{ key: "b", props: { delay: 0.5 } }] }),
    ).toBe("invalid-delay");
    expect(
      reason({ type: "image.updateFrames", updates: [{ key: "b", props: { delay: "1" } }] }),
    ).toBe("malformed-command");
  });

  it("sets the loop count: once, for ever, or a number of repeats", () => {
    for (const loop of [null, 0, 1, 65_535]) {
      expect(run({ type: "image.setLoop", loop }).animation?.loop).toBe(loop);
    }
    for (const loop of [-1, 65_536, 1.5]) {
      expect(reason({ type: "image.setLoop", loop })).toBe("invalid-loop");
    }
    expect(reason({ type: "image.setLoop", loop: "0" })).toBe("malformed-command");
    expect(reason({ type: "image.setLoop" })).toBe("malformed-command");
  });

  it("refuses every frame command on a still", () => {
    const still = createPlan("s");
    for (const command of [
      { type: "image.insertFrames", at: 0, frames: [{ key: "f", frame: 0, delay: 1 }] },
      { type: "image.removeFrames", keys: ["a"] },
      { type: "image.moveFrames", keys: ["a"], to: 0 },
      { type: "image.reverseFrames" },
      { type: "image.updateFrames", updates: [{ key: "a", props: { delay: 1 } }] },
      { type: "image.setLoop", loop: 0 },
      {
        type: "image.restoreFrames",
        entries: [{ at: 0, frame: { key: "f", frame: 0, delay: 1 } }],
      },
      { type: "image.setFrameOrder", keys: ["a"] },
    ]) {
      expect(reason(command, still), command.type).toBe("not-animated");
    }
  });

  it("holds a frame to the frames its source has", () => {
    // Source `s` has five frames: 0 to 4.
    const insert = (frame: unknown) => ({
      type: "image.insertFrames",
      at: 0,
      frames: [{ key: "f", frame, delay: 1 }],
    });
    expect(keys(run(insert(4)))).toContain("f");
    expect(reason(insert(5))).toBe("invalid-frame");
    expect(reason(insert(-1))).toBe("malformed-command");
    expect(reason(insert(1.5))).toBe("malformed-command");
    // A source that gives no count has one frame; one that isn't known is refused.
    const single = createImageReducer((id) => (id === "s" ? { width: 4, height: 3 } : undefined));
    expect(() => single(ANIMATED, insert(1) as ImageCommand)).toThrow(/no frame 1/);
    expect(single(ANIMATED, insert(0) as ImageCommand).state.animation?.frames).toHaveLength(5);
    const unknown = createImageReducer(() => undefined);
    try {
      unknown(ANIMATED, insert(0) as ImageCommand);
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as ImageError).details?.["reason"]).toBe("unknown-source");
    }
  });

  it("keeps keys unique among layers, redactions and frames", () => {
    const redacted: ImagePlan = {
      ...ANIMATED,
      redactions: [{ key: "r", mode: "pixelate", x: 0, y: 0, width: 2, height: 2 }],
    };
    const frame = (key: string) => ({
      type: "image.insertFrames",
      at: 0,
      frames: [{ key, frame: 0, delay: 1 }],
    });
    expect(reason(frame("a"))).toBe("duplicate-key");
    expect(reason(frame("r"), redacted)).toBe("duplicate-key");
    // And the other way: a new redaction can't take a frame's key.
    expect(
      reason({
        type: "image.insertRedactions",
        at: 0,
        redactions: [{ key: "a", mode: "pixelate", x: 0, y: 0, width: 2, height: 2 }],
      }),
    ).toBe("duplicate-key");
    expect(reason({ type: "image.removeFrames", keys: ["r"] }, redacted)).toBe("unknown-frame");
  });

  it("holds at most 4,096 frames", () => {
    const full: ImagePlan = {
      ...createPlan("s"),
      animation: {
        loop: null,
        frames: Array.from({ length: MAX_ANIMATION_FRAMES }, (_, index) => ({
          key: `f${index}`,
          frame: index % 5,
          delay: 1,
        })),
      },
    };
    expect(
      reason(
        { type: "image.insertFrames", at: 0, frames: [{ key: "more", frame: 0, delay: 1 }] },
        full,
      ),
    ).toBe("too-many-frames");
    // A full animation can still be trimmed and reordered.
    expect(run({ type: "image.removeFrames", keys: ["f0"] }, full).animation?.frames).toHaveLength(
      MAX_ANIMATION_FRAMES - 1,
    );
  });

  it("leaves everything but the animation as it was, for every plan and frame command", () => {
    fc.assert(
      fc.property(planArb, (state) => {
        if (state.animation === null) return;
        const { state: next, inverse } = reducer(state, { type: "image.reverseFrames" });
        expect({ ...next, animation: null }).toEqual({ ...state, animation: null });
        expect(reducer(next, inverse).state).toEqual(state);
        // Every frame is one the source has, with a key no other item has.
        const all = [...next.layers, ...next.redactions, ...(next.animation?.frames ?? [])];
        expect(new Set(all.map((item) => item.key)).size).toBe(all.length);
        for (const frame of next.animation?.frames ?? []) expect(frame.frame).toBeLessThan(5);
      }),
    );
  });
});
