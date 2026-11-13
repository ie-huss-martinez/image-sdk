import type { FocusEvent, KeyboardEvent, PointerEvent } from "react";
import type { ImageCommand } from "../../core/operations/commands.js";
import type { Gesture } from "../gesture.js";

/**
 * The events that drive one slider's gesture (docs/adr/0007): each value
 * previews, a pointer release or leaving the slider commits, keys commit a
 * moment after the last one, and Escape cancels.
 */
export function sliderGesture(gesture: Gesture, command: (value: number) => ImageCommand) {
  return {
    onValueChange: (value: number) => gesture.preview([command(value)]),
    onPointerUp: (_event: PointerEvent<HTMLInputElement>) => gesture.commit(),
    onBlur: (_event: FocusEvent<HTMLInputElement>) => gesture.commit(),
    onKeyUp: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Escape" && gesture.active()) gesture.commitSoon();
    },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape" && gesture.active()) {
        event.preventDefault();
        event.stopPropagation();
        gesture.cancel();
      }
    },
  };
}
