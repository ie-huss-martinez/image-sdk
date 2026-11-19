import type { ImageCommand } from "../../core/operations/commands.js";
import type { Gesture } from "../gesture.js";

/**
 * The callbacks that drive one slider's gesture (docs/adr/0007). Each value
 * previews on the stage; ui's `Slider` says when the gesture ends, and it's
 * one step: when the pointer is let go, when the last key held is let go,
 * or when focus leaves first. Escape during a gesture puts the value back
 * and cancels it, with no step.
 */
export function sliderGesture(gesture: Gesture, command: (value: number) => ImageCommand) {
  return {
    onValueChange: (value: number) => gesture.preview([command(value)]),
    onValueCommit: (value: number) => {
      // The value it ended on, whatever the last preview was.
      gesture.preview([command(value)]);
      gesture.commit();
    },
    onValueCancel: (_value: number) => gesture.cancel(),
  };
}
