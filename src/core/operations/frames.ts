import {
  type ImageAnimation,
  type ImageFrame,
  type ImagePlan,
  MAX_ANIMATION_FRAMES,
  MAX_FRAME_DELAY,
} from "../model/plan.js";
import { allFields, invalid, isRecord, isWhole, onlyFields } from "./checks.js";
import {
  checkKey,
  insertItems,
  type KeyedEntry,
  type KeyedListNames,
  moveItems,
  orderItems,
  removeItems,
  restoreItems,
  updateItems,
} from "./keyed-list.js";

/**
 * The commands that edit an animation's frames (docs/adr/0011): the keyed
 * list's, under their own names, and the loop count. Each returns the plan
 * and the command that undoes it exactly.
 *
 * Every function is pure, takes untrusted input, and refuses what it can't
 * apply by throwing through `invalid`, never by correcting it.
 */

/** What the frames are called in refusals. @internal */
export const FRAME_NAMES: KeyedListNames = { unknown: "unknown-frame", item: "frame" };

/** The fields of a frame an update may set. @public */
export interface ImageFrameProps {
  readonly delay?: number;
}

const FRAME_FIELDS = ["key", "frame", "delay"];

/** A delay in hundredths of a second. */
function checkDelay(value: unknown): number {
  if (typeof value !== "number") invalid("malformed-command", "a delay is a number");
  if (!isWhole(value, 0, MAX_FRAME_DELAY)) {
    invalid("invalid-delay", `a delay is a whole number from 0 to ${MAX_FRAME_DELAY}`);
  }
  return value;
}

/**
 * A loop count: `null` for once, 0 for ever, or a number of repeats.
 *
 * @internal
 */
export function checkLoop(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number") invalid("malformed-command", "a loop count is a number or null");
  if (!isWhole(value, 0, MAX_FRAME_DELAY)) {
    invalid("invalid-loop", `a loop count is a whole number from 0 to ${MAX_FRAME_DELAY}, or null`);
  }
  return value;
}

/**
 * A frame, checked: its key, a frame the source has, and its delay.
 *
 * @param frames - How many frames the base's source has.
 * @internal
 */
export function checkFrame(value: unknown, frames: number): ImageFrame {
  if (!isRecord<ImageFrame>(value)) invalid("malformed-command", "a frame is an object");
  allFields(value, FRAME_FIELDS, "a frame");
  const key = checkKey(value.key);
  const { frame } = value;
  if (typeof frame !== "number") invalid("malformed-command", "a frame's frame is a number");
  if (!isWhole(frame, 0)) invalid("malformed-command", "a frame's frame is a whole number from 0");
  if (frame >= frames) invalid("invalid-frame", `the source has no frame ${frame}`);
  return { key, frame, delay: checkDelay(value.delay) };
}

/**
 * An animation, checked, for a source of `frames` frames: a loop count and
 * 1 to {@link MAX_ANIMATION_FRAMES} frames. A source with one frame has no
 * animation.
 *
 * @internal
 */
export function checkAnimation(value: unknown, frames: number): ImageAnimation {
  if (!isRecord<ImageAnimation>(value)) invalid("malformed-command", "an animation is an object");
  allFields(value, ["loop", "frames"], "an animation");
  const loop = checkLoop(value.loop);
  if (!Array.isArray(value.frames))
    invalid("malformed-command", "an animation's frames are a list");
  // The schema's bounds, so they're malformed: `no-frames` is for removing the last.
  if (value.frames.length === 0 || value.frames.length > MAX_ANIMATION_FRAMES) {
    invalid("malformed-command", `an animation has 1 to ${MAX_ANIMATION_FRAMES} frames`);
  }
  if (frames < 2) invalid("not-animated", "a source with one frame has no animation");
  return { loop, frames: value.frames.map((frame) => checkFrame(frame, frames)) };
}

/** The plan's animation, which a frame command needs. */
function animationOf(plan: ImagePlan): ImageAnimation {
  if (plan.animation === null) invalid("not-animated", "the plan has no animation");
  return plan.animation;
}

const withFrames = (plan: ImagePlan, frames: readonly ImageFrame[]): ImagePlan => ({
  ...plan,
  animation: { loop: animationOf(plan).loop, frames },
});

/** Refuses more frames than the format holds. */
function checkRoom(count: number): void {
  if (count > MAX_ANIMATION_FRAMES) {
    invalid("too-many-frames", `an animation has at most ${MAX_ANIMATION_FRAMES} frames`);
  }
}

/** A list with at least one item. */
function some(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) invalid("malformed-command", `${what} is a list`);
  if (value.length === 0) invalid("malformed-command", `${what} has at least one item`);
  return value;
}

/**
 * Inserts frames, such as duplicates. Undone by removing them.
 *
 * @param taken - Every key the plan already uses.
 * @param sourceFrames - How many frames the base's source has.
 * @internal
 */
export function insertFrames(
  plan: ImagePlan,
  at: unknown,
  value: unknown,
  taken: ReadonlySet<string>,
  sourceFrames: number,
) {
  const animation = animationOf(plan);
  const frames = some(value, "frames").map((frame) => checkFrame(frame, sourceFrames));
  const { list, keys } = insertItems(animation.frames, at, frames, taken);
  checkRoom(list.length);
  return { state: withFrames(plan, list), inverse: { type: "image.removeFrames" as const, keys } };
}

/**
 * Removes frames, leaving at least one. Undone by putting each back at its
 * index.
 *
 * @internal
 */
export function removeFrames(plan: ImagePlan, keys: unknown) {
  const { list, entries } = removeItems(animationOf(plan).frames, keys, FRAME_NAMES);
  if (list.length === 0) {
    invalid("no-frames", "an animation keeps at least one frame");
  }
  return {
    state: withFrames(plan, list),
    inverse: {
      type: "image.restoreFrames" as const,
      entries: entries.map(({ at, item }) => ({ at, frame: item })),
    },
  };
}

/**
 * Puts removed frames back, each at its index, by rising index. It's what
 * undoes {@link removeFrames}: the reducer applies it, but it isn't part of
 * the portable command format.
 *
 * @internal
 */
export function restoreFrames(
  plan: ImagePlan,
  value: unknown,
  taken: ReadonlySet<string>,
  sourceFrames: number,
) {
  const animation = animationOf(plan);
  const entries: KeyedEntry<ImageFrame>[] = some(value, "entries").map((entry) => {
    if (!isRecord<{ at: unknown; frame: unknown }>(entry)) {
      invalid("malformed-command", "an entry is an object");
    }
    allFields(entry, ["at", "frame"], "an entry");
    return { at: entry.at as number, item: checkFrame(entry.frame, sourceFrames) };
  });
  const { list, keys } = restoreItems(animation.frames, entries, taken);
  checkRoom(list.length);
  return { state: withFrames(plan, list), inverse: { type: "image.removeFrames" as const, keys } };
}

/**
 * Moves frames to an index, keeping their order. Undone by setting the
 * whole previous order.
 *
 * @internal
 */
export function moveFrames(plan: ImagePlan, keys: unknown, to: unknown) {
  const { list, order } = moveItems(animationOf(plan).frames, keys, to, FRAME_NAMES);
  return {
    state: withFrames(plan, list),
    inverse: { type: "image.setFrameOrder" as const, keys: order },
  };
}

/**
 * Sets the frames' whole order. It's what undoes {@link moveFrames}: the
 * reducer applies it, but it isn't part of the portable command format.
 *
 * @internal
 */
export function setFrameOrder(plan: ImagePlan, keys: unknown) {
  const { list, order } = orderItems(animationOf(plan).frames, keys, FRAME_NAMES);
  return {
    state: withFrames(plan, list),
    inverse: { type: "image.setFrameOrder" as const, keys: order },
  };
}

/**
 * Reverses the frames' order. It undoes itself.
 *
 * @internal
 */
export function reverseFrames(plan: ImagePlan) {
  return {
    state: withFrames(plan, [...animationOf(plan).frames].reverse()),
    inverse: { type: "image.reverseFrames" as const },
  };
}

/** Sets a frame's delay, and says what it was. */
function patchFrame(
  item: ImageFrame,
  props: unknown,
): { readonly item: ImageFrame; readonly previous: ImageFrameProps } {
  if (!isRecord<Record<string, unknown>>(props)) {
    invalid("malformed-command", "an update's props are an object");
  }
  onlyFields(props, ["delay"], "a frame's props");
  if (!Object.hasOwn(props, "delay")) return { item, previous: {} };
  return { item: { ...item, delay: checkDelay(props["delay"]) }, previous: { delay: item.delay } };
}

/**
 * Sets some frames' delays. Undone by the same, with the delays they had.
 *
 * @internal
 */
export function updateFrames(plan: ImagePlan, updates: unknown) {
  const { list, previous } = updateItems(
    animationOf(plan).frames,
    updates,
    FRAME_NAMES,
    patchFrame,
  );
  return {
    state: withFrames(plan, list),
    inverse: { type: "image.updateFrames" as const, updates: previous },
  };
}

/**
 * Sets the loop count. Undone by setting the one it had.
 *
 * @internal
 */
export function setLoop(plan: ImagePlan, value: unknown) {
  const animation = animationOf(plan);
  return {
    state: { ...plan, animation: { ...animation, loop: checkLoop(value) } },
    inverse: { type: "image.setLoop" as const, loop: animation.loop },
  };
}
