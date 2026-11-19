import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import { compositionSize, cropRect } from "../../core/model/geometry.js";
import type { ImagePlan, ImageRedaction } from "../../core/model/plan.js";
import {
  compositionRectToScene,
  type ImageRect,
  sceneRectToComposition,
} from "../../core/model/redaction-geometry.js";
import type { ImageSize } from "../../core/model/source.js";
import { type ImageView, placement } from "../../core/ports/image-renderer.js";
import { useImageEditorState, useImageMessages } from "../hooks.js";
import { createKeyRun } from "../key-run.js";
import { newRedactionKey, useRedactActions } from "./use-redact.js";

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};
/** How far the pointer moves, in CSS pixels, before a press on the image draws a region. */
const DRAW_THRESHOLD = 3;
/**
 * How close to an image pixel's edge, in CSS pixels, a pointer counts as on
 * it: a quarter of a screen pixel, finer than a pointer reports and coarser
 * than the layout's own rounding.
 */
const EDGE_TOLERANCE = 0.25;

/** A rectangle on the composition, moved or with one handle dragged, at least 1 × 1. */
function dragged(start: ImageRect, handle: Handle | "move", dx: number, dy: number): ImageRect {
  if (handle === "move") return { ...start, x: start.x + dx, y: start.y + dy };
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes("w")) left = Math.min(left + dx, right - 1);
  if (handle.includes("e")) right = Math.max(right + dx, left + 1);
  if (handle.includes("n")) top = Math.min(top + dy, bottom - 1);
  if (handle.includes("s")) bottom = Math.max(bottom + dy, top + 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export interface RedactOverlayProps {
  /** The plan the stage shows: the session's, or a gesture's. */
  readonly plan: ImagePlan;
  readonly source: ImageSize;
  /** The stage's view, in CSS pixels. */
  readonly view: ImageView;
}

/**
 * The redactions as frames over the canvas (docs/adr/0010), placed with the
 * renderer's geometry. Each is a focusable group, named by its place in the
 * list and described by its mode and size, which arrow keys move, Shift
 * with them resizes, and Delete removes: the crop frame's keys. Dragging across the image
 * draws a new one. Handles are pointer targets only, hidden from assistive
 * technology: the keys and the panel's fields do what they do.
 *
 * Every gesture shows on the stage as a transient plan, which the renderer
 * draws with the redaction applied, and becomes one undoable step when it
 * ends.
 */
export function RedactOverlay(props: RedactOverlayProps): ReactNode {
  const { plan, source, view } = props;
  const [state] = useImageEditorState();
  const messages = useImageMessages();
  const actions = useRedactActions();
  const overlay = useRef<HTMLDivElement>(null);
  const describedBy = useId();
  const drag = useRef<
    | {
        pointer: number;
        x: number;
        y: number;
        key: string;
        handle: Handle | "move" | "draw";
        start: ImageRect;
        drawn: boolean;
      }
    | undefined
  >(undefined);
  /** The key whose frame takes focus once it's rendered: one just added or selected by the panel. */
  const focusNext = useRef<string | null>(null);
  /** The arrow keys held on a frame: one step per press, and per key held down. */
  const keys = useRef(createKeyRun());

  const selected = state.redact?.selected ?? null;
  const exists = plan.redactions.some((redaction) => redaction.key === selected);

  // A redaction selected from outside the stage, such as one the panel just
  // added, takes focus, unless focus is in the panel's own fields.
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (selected === previous.current) return;
    previous.current = selected;
    if (!selected || !exists || drag.current) return;
    const active = document.activeElement;
    const typing =
      active instanceof HTMLElement && active.closest(".hm-image-redact-panel input") !== null;
    if (typing) return;
    overlay.current
      ?.querySelector<HTMLElement>(`[data-hm-redaction="${CSS.escape(selected)}"]`)
      ?.focus();
  }, [selected, exists]);

  // A region just drawn takes focus once its frame exists.
  useEffect(() => {
    const key = focusNext.current;
    if (!key || !plan.redactions.some((redaction) => redaction.key === key)) return;
    focusNext.current = null;
    overlay.current
      ?.querySelector<HTMLElement>(`[data-hm-redaction="${CSS.escape(key)}"]`)
      ?.focus();
  });

  const crop = cropRect(plan.base.crop, source);
  const { orientation } = plan.base;
  const placed = placement(compositionSize(plan, source), view);
  // A stage with no size yet has nowhere to put the frames, and no scale for a drag.
  if (!(placed.scale > 0)) return null;
  const shown = (redaction: ImageRedaction) => sceneRectToComposition(redaction, crop, orientation);
  const toScene = (rect: ImageRect) => compositionRectToScene(rect, crop, orientation);

  /** A pointer's position on the composition, in its pixels. */
  const onComposition = (event: PointerEvent<HTMLElement>) => {
    const box = overlay.current?.getBoundingClientRect();
    return {
      x: (event.clientX - (box?.left ?? 0) - placed.x) / placed.scale,
      y: (event.clientY - (box?.top ?? 0) - placed.y) / placed.scale,
    };
  };

  const capture = (event: PointerEvent<HTMLElement>) => {
    try {
      // Keeps the drag when the pointer leaves the element; a pointer the
      // browser doesn't track can't be captured, and the drag still works.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}
  };

  const onFramePointerDown =
    (redaction: ImageRedaction, handle: Handle | "move") => (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      // A pointer takes the gesture: a run of arrow keys still going ends first, as its own step.
      if (keys.current.handOff()) actions.commit();
      event.preventDefault();
      event.stopPropagation();
      actions.select(redaction.key);
      overlay.current
        ?.querySelector<HTMLElement>(`[data-hm-redaction="${CSS.escape(redaction.key)}"]`)
        ?.focus();
      capture(event);
      drag.current = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        key: redaction.key,
        handle,
        start: shown(redaction),
        drawn: false,
      };
    };

  const onBackgroundPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    // A pointer takes the gesture: a run of arrow keys still going ends first, as its own step.
    if (keys.current.handOff()) actions.commit();
    event.preventDefault();
    capture(event);
    const at = onComposition(event);
    drag.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      key: newRedactionKey(plan),
      handle: "draw",
      start: { x: at.x, y: at.y, width: 0, height: 0 },
      drawn: false,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    const dx = (event.clientX - current.x) / placed.scale;
    const dy = (event.clientY - current.y) / placed.scale;
    if (current.handle === "draw") {
      const far =
        Math.hypot(event.clientX - current.x, event.clientY - current.y) >= DRAW_THRESHOLD;
      if (!current.drawn && !far) return;
      current.drawn = true;
      // Whole pixels, outward, so everything the drag touched is covered. A
      // pointer on a pixel's edge is on the edge, not a sliver past it.
      const EDGE = EDGE_TOLERANCE / placed.scale;
      const left = Math.floor(Math.min(current.start.x, current.start.x + dx) + EDGE);
      const top = Math.floor(Math.min(current.start.y, current.start.y + dy) + EDGE);
      const right = Math.ceil(Math.max(current.start.x, current.start.x + dx) - EDGE);
      const bottom = Math.ceil(Math.max(current.start.y, current.start.y + dy) - EDGE);
      actions.drawing(current.key, {
        x: left,
        y: top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
      });
      return;
    }
    current.drawn = true;
    // A move or a resize is by whole pixels, so moving never changes the size.
    actions.moving(
      current.key,
      toScene(dragged(current.start, current.handle, Math.round(dx), Math.round(dy))),
    );
  };

  const onPointerEnd = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    drag.current = undefined;
    if (event.type === "pointercancel") {
      // A cancelled pointer, such as a lost capture, leaves the plan as it was.
      actions.cancel();
      return;
    }
    if (current.handle === "draw" && !current.drawn) {
      // A press on the image without a drag selects nothing.
      actions.select(null);
      return;
    }
    actions.commit();
    if (current.handle === "draw") {
      // Drawn: now it's selected, and takes focus once its frame is there.
      focusNext.current = current.key;
      actions.select(current.key);
    }
  };
  const pointer = { onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd };

  const onKeyDown = (redaction: ImageRedaction) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      // Escape during a drag, or while arrow keys are held, cancels it;
      // otherwise it ends redacting.
      if (drag.current) {
        drag.current = undefined;
        actions.cancel();
      } else if (keys.current.cancel()) {
        actions.cancel();
      } else {
        actions.done();
      }
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      // Focus moves to the next frame, or the one before, or the panel's button.
      const index = plan.redactions.findIndex((item) => item.key === redaction.key);
      const next = plan.redactions[index + 1] ?? plan.redactions[index - 1];
      actions.remove(redaction.key);
      if (next) actions.select(next.key);
      else {
        overlay.current
          ?.closest(".hm-image-editor")
          ?.querySelector<HTMLElement>(".hm-image-redact-add")
          ?.focus();
      }
      return;
    }
    const arrow = ARROWS[event.key];
    if (!arrow) return;
    // The frames' keys are the crop frame's (docs/adr/0007): the arrows
    // alone and with Shift. With Alt, Control or Meta they're the browser's
    // or the system's, such as Back and Forward, and are left alone.
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    // Handled here, so the editor's shortcuts don't also take the arrows.
    event.stopPropagation();
    // While a pointer drags, the arrows don't move the frame: the drag owns the gesture.
    if (drag.current) return;
    // A run cancelled with Escape is ignored until its keys are let go.
    if (!keys.current.press(event.key)) return;
    const [dx, dy] = arrow;
    // As seen on screen, whatever the plan's rotation and flips: Shift moves
    // the right edge with Left and Right, and the bottom edge with Up and Down.
    const moved = event.shiftKey
      ? dragged(shown(redaction), dx !== 0 ? "e" : "s", dx, dy)
      : dragged(shown(redaction), "move", dx, dy);
    // Shown at once; it's a step when the last key held is let go.
    actions.moving(redaction.key, toScene(moved));
  };
  const onKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    if (ARROWS[event.key] && keys.current.release(event.key)) actions.commit();
  };
  // Focus leaving with a key held ends its run as one step: the key let go
  // elsewhere isn't seen.
  const onBlur = () => {
    if (keys.current.leave()) actions.commit();
  };

  const count = plan.redactions.length;
  // One tab stop: the selected frame, or the first when none is.
  const tabStop = exists ? selected : plan.redactions[0]?.key;
  return (
    <div
      ref={overlay}
      className="hm-image-redact-overlay"
      onPointerDown={onBackgroundPointerDown}
      {...pointer}
    >
      {plan.redactions.map((redaction, index) => {
        const rect = shown(redaction);
        const isSelected = redaction.key === selected;
        return (
          // A positioned keyboard control over the canvas, not a form's fieldset (docs/adr/0007).
          // biome-ignore lint/a11y/useSemanticElements: a focusable group, not a fieldset
          <div
            key={redaction.key}
            className="hm-image-redact-frame"
            data-hm-redaction={redaction.key}
            data-hm-selected={isSelected ? "" : undefined}
            role="group"
            aria-label={messages.t("redact.frame", { index: index + 1, count })}
            aria-describedby={`${describedBy}-${index}`}
            tabIndex={redaction.key === tabStop ? 0 : -1}
            style={{
              left: `${placed.x + rect.x * placed.scale}px`,
              top: `${placed.y + rect.y * placed.scale}px`,
              width: `${rect.width * placed.scale}px`,
              height: `${rect.height * placed.scale}px`,
            }}
            onFocus={() => actions.select(redaction.key)}
            onKeyDown={onKeyDown(redaction)}
            onKeyUp={onKeyUp}
            onBlur={onBlur}
            onPointerDown={onFramePointerDown(redaction, "move")}
            {...pointer}
          >
            <span id={`${describedBy}-${index}`} hidden>
              {messages.t("redact.frameDescription", {
                mode: messages.t(`redact.modeNames.${redaction.mode}`),
                width: redaction.width,
                height: redaction.height,
                x: redaction.x,
                y: redaction.y,
              })}
            </span>
            {isSelected
              ? HANDLES.map((handle) => (
                  <span
                    key={handle}
                    className="hm-image-redact-handle"
                    data-hm-handle={handle}
                    aria-hidden="true"
                    onPointerDown={onFramePointerDown(redaction, handle)}
                    {...pointer}
                  />
                ))
              : null}
          </div>
        );
      })}
    </div>
  );
}
