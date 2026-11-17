import { type PointerEvent, type ReactNode, useEffect, useRef } from "react";
import { compositionSize, compositionToSource, cropRect } from "../../core/model/geometry.js";
import type { ImagePlan, ImageScenePoint } from "../../core/model/plan.js";
import type { ImageSize } from "../../core/model/source.js";
import { type ImageView, placement } from "../../core/ports/image-renderer.js";
import { useDrawActions } from "./use-draw.js";

/**
 * The most samples one stroke takes: what 64 runs hold (docs/adr/0014).
 * There the stroke ends and another starts from the same point.
 */
const MAX_SAMPLES = 1 + 64 * 1_999;

export interface DrawOverlayProps {
  /** The plan the stage shows: the session's, or a stroke's. */
  readonly plan: ImagePlan;
  readonly source: ImageSize;
  /** The stage's view, in CSS pixels. */
  readonly view: ImageView;
}

/**
 * The surface a stroke is drawn on (docs/adr/0015): a press and a drag
 * across the image draw a stroke, shown on the stage as a transient plan,
 * and the release makes it one undoable step. A press without a drag is a
 * dot. Escape, or a lost pointer, ends the stroke with nothing added.
 *
 * Freehand drawing needs a pointer (WCAG 2.5.7's essential exception, ADR
 * 0009), so this has no keyboard function and nothing for assistive
 * technology: the panel says so, and the arrow tool is the keyboard's way
 * to point at something.
 */
export function DrawOverlay(props: DrawOverlayProps): ReactNode {
  const { plan, source, view } = props;
  const actions = useDrawActions();
  const overlay = useRef<HTMLDivElement>(null);
  const stroke = useRef<
    { pointer: number; key: string; samples: ImageScenePoint[]; tolerance: number } | undefined
  >(undefined);

  // Escape ends a stroke in progress, wherever focus is.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !stroke.current) return;
      event.preventDefault();
      event.stopPropagation();
      stroke.current = undefined;
      actions.cancel();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [actions]);

  const composition = compositionSize(plan, source);
  const placed = placement(composition, view);
  if (!(placed.scale > 0)) return null;
  const crop = cropRect(plan.base.crop, source);
  const { orientation } = plan.base;

  /** A pointer's place in the scene. */
  const sceneOf = (clientX: number, clientY: number): ImageScenePoint => {
    const box = overlay.current?.getBoundingClientRect();
    return compositionToSource(
      {
        x: (clientX - (box?.left ?? 0) - placed.x) / placed.scale,
        y: (clientY - (box?.top ?? 0) - placed.y) / placed.scale,
      },
      crop,
      orientation,
    );
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || stroke.current) return;
    event.preventDefault();
    try {
      // Keeps the stroke when the pointer leaves the stage.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}
    const current = {
      pointer: event.pointerId,
      key: actions.newKey(),
      samples: [sceneOf(event.clientX, event.clientY)],
      // A detail smaller than a screen pixel wasn't drawn on purpose.
      tolerance: Math.max(1, Math.round(1 / placed.scale)),
    };
    stroke.current = current;
    actions.drawing(current.key, current.samples, current.tolerance);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = stroke.current;
    if (!current || current.pointer !== event.pointerId) return;
    // Every sample the browser has since the last event, where it gives them.
    const native = event.nativeEvent;
    const events = native.getCoalescedEvents?.() ?? [];
    for (const sample of events.length > 0 ? events : [native]) {
      current.samples.push(sceneOf(sample.clientX, sample.clientY));
    }
    if (current.samples.length >= MAX_SAMPLES) {
      // A stroke holds no more: it ends here, and the next starts where it ended.
      const last = current.samples[MAX_SAMPLES - 1] as ImageScenePoint;
      const rest = current.samples.slice(MAX_SAMPLES - 1);
      actions.drawing(current.key, current.samples.slice(0, MAX_SAMPLES), current.tolerance);
      actions.commit(current.key);
      current.key = actions.newKey();
      current.samples = rest.length > 0 ? rest : [last];
    }
    actions.drawing(current.key, current.samples, current.tolerance);
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const current = stroke.current;
    if (!current || current.pointer !== event.pointerId) return;
    stroke.current = undefined;
    if (event.type === "pointercancel") actions.cancel();
    else actions.commit(current.key);
  };

  return (
    <div
      ref={overlay}
      className="hm-image-draw-overlay"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    />
  );
}
