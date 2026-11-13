import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import {
  aspectRatio,
  type CropHandle,
  compositionDeltaToSource,
  cropInComposition,
  dragHandle,
  handleInSource,
  moveCrop,
  nudgeCropOnScreen,
} from "../../core/model/crop.js";
import { compositionSize } from "../../core/model/geometry.js";
import type { ImageCrop, ImagePlan } from "../../core/model/plan.js";
import type { ImageSize } from "../../core/model/source.js";
import { type ImageView, placement } from "../../core/ports/image-renderer.js";
import { useImageEditorState, useImageMessages } from "../hooks.js";
import { useCropActions } from "./use-crop.js";

const HANDLES: readonly CropHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const ARROWS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

export interface CropFrameProps {
  /** The session's plan, whose crop is being changed. */
  readonly plan: ImagePlan;
  readonly source: ImageSize;
  /** The stage's view, in CSS pixels. */
  readonly view: ImageView;
}

/**
 * The crop frame (docs/adr/0007): DOM over the canvas, placed with the
 * renderer's geometry. One focusable group, named "Crop area" and described
 * by its size, which arrow keys move (Shift for 10 pixels, Alt to resize),
 * Enter applies and Escape cancels. Its handles are pointer targets only,
 * hidden from assistive technology: the keys and the crop panel's fields do
 * what they do.
 */
export function CropFrame(props: CropFrameProps): ReactNode {
  const { plan, source, view } = props;
  const [state] = useImageEditorState();
  const messages = useImageMessages();
  const actions = useCropActions();
  const frame = useRef<HTMLDivElement>(null);
  const describedBy = useId();
  const drag = useRef<
    | { pointer: number; x: number; y: number; start: ImageCrop; handle: CropHandle | "move" }
    | undefined
  >(undefined);

  // Cropping starts with focus on the frame.
  useEffect(() => {
    frame.current?.focus();
  }, []);

  const crop = state.crop;
  if (!crop) return null;
  const { orientation } = plan.base;
  const whole = { ...plan, base: { ...plan.base, crop: null } };
  const placed = placement(compositionSize(whole, source), view);
  // A stage with no size yet has nowhere to put the frame, and no scale for a drag.
  if (!(placed.scale > 0)) return null;
  const shown = cropInComposition(crop.pending, orientation, source);
  const ratio = aspectRatio(crop.aspect, source);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      actions.apply();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      // Escape during a drag cancels the drag; otherwise, the crop.
      if (drag.current) {
        actions.update(drag.current.start);
        drag.current = undefined;
      } else {
        actions.cancel();
      }
      return;
    }
    if (!ARROWS.has(event.key)) return;
    event.preventDefault();
    // Handled here, so the editor's shortcuts don't also take the arrows.
    event.stopPropagation();
    actions.update(
      nudgeCropOnScreen(
        crop.pending,
        event.key as "ArrowLeft",
        event.shiftKey ? 10 : 1,
        event.altKey,
        orientation,
        source,
        ratio,
      ),
    );
  };

  const onPointerDown = (handle: CropHandle | "move") => (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    frame.current?.focus();
    try {
      // Keeps the drag when the pointer leaves the frame; a pointer the
      // browser doesn't track can't be captured, and the drag still works.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}
    drag.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      start: crop.pending,
      handle,
    };
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    // Screen pixels to composition pixels, then to the source's own axes.
    const moved = compositionDeltaToSource(
      (event.clientX - current.x) / placed.scale,
      (event.clientY - current.y) / placed.scale,
      orientation,
      source,
    );
    actions.update(
      current.handle === "move"
        ? moveCrop(current.start, moved.dx, moved.dy, source)
        : dragHandle(
            current.start,
            handleInSource(current.handle, orientation),
            moved.dx,
            moved.dy,
            source,
            ratio,
          ),
    );
  };
  const onPointerEnd = (event: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    // A cancelled pointer, such as a lost capture, restores the crop the drag started from.
    if (event.type === "pointercancel") actions.update(drag.current.start);
    drag.current = undefined;
  };

  const style = {
    left: `${placed.x + shown.x * placed.scale}px`,
    top: `${placed.y + shown.y * placed.scale}px`,
    width: `${shown.width * placed.scale}px`,
    height: `${shown.height * placed.scale}px`,
  };
  const pointer = { onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd };
  return (
    // A positioned keyboard control over the canvas, not a form's fieldset (docs/adr/0007).
    // biome-ignore lint/a11y/useSemanticElements: a focusable group, not a fieldset
    <div
      ref={frame}
      className="hm-image-crop-frame"
      role="group"
      aria-label={messages.t("crop.frame")}
      aria-describedby={describedBy}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the frame is a keyboard control, named and described
      tabIndex={0}
      style={style}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown("move")}
      {...pointer}
    >
      <span id={describedBy} hidden>
        {messages.t("crop.frameDescription", {
          width: crop.pending.width,
          height: crop.pending.height,
          x: crop.pending.x,
          y: crop.pending.y,
        })}
      </span>
      {HANDLES.map((handle) => (
        <span
          key={handle}
          className="hm-image-crop-handle"
          data-hm-handle={handle}
          aria-hidden="true"
          onPointerDown={onPointerDown(handle)}
          {...pointer}
        />
      ))}
    </div>
  );
}
