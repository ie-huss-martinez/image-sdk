import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import { compositionSize, cropRect } from "../../core/model/geometry.js";
import { invertMatrix, layerToOutput, sceneToOutput } from "../../core/model/layer-geometry.js";
import type { ImageLayer, ImageLayerBox, ImagePlan } from "../../core/model/plan.js";
import type { ImageSize } from "../../core/model/source.js";
import { type ImageView, placement } from "../../core/ports/image-renderer.js";
import { useImageEditorState, useImageMessages } from "../hooks.js";
import {
  boxOf,
  handleCursor,
  LAYER_HANDLES,
  type LayerHandle,
  moveLayerBox,
  resizeLayerBox,
  resizeLayerBoxOnScreen,
  turned,
} from "./frame-geometry.js";
import { layerLabel, useLayerActions } from "./use-layers.js";

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export interface LayersOverlayProps {
  /** The plan the stage shows: the session's, or a gesture's. */
  readonly plan: ImagePlan;
  readonly source: ImageSize;
  /** The stage's view, in CSS pixels. */
  readonly view: ImageView;
}

/**
 * The layers as frames over the canvas (docs/adr/0013), each placed and
 * turned with the transform the renderer draws its layer through. A press
 * on a frame selects its layer, the top one under the pointer, and a drag
 * moves it; the selected frame's handles resize it.
 *
 * Each frame is a focusable group, named by its place in the stack and what
 * the list calls it, and described by its size and place. Its keys are the
 * crop frame's (docs/adr/0007): the arrows move it by a pixel as it's seen,
 * `Shift` with them resizes it, `Delete` removes it. Handles are pointer
 * targets only, hidden from assistive technology: the keys and the panel's
 * fields do what they do.
 *
 * Every gesture shows on the stage as a transient plan, and becomes one
 * undoable step when it ends. A hidden layer has a frame only while it's
 * selected, so its place can still be found.
 */
export function LayersOverlay(props: LayersOverlayProps): ReactNode {
  const { plan, source, view } = props;
  const [state] = useImageEditorState();
  const messages = useImageMessages();
  const actions = useLayerActions();
  const overlay = useRef<HTMLDivElement>(null);
  const describedBy = useId();
  const drag = useRef<
    | {
        pointer: number;
        x: number;
        y: number;
        key: string;
        handle: LayerHandle | "move";
        start: ImageLayerBox;
        moved: boolean;
      }
    | undefined
  >(undefined);
  /** The key whose frame takes focus once it's rendered: the one selected after a removal. */
  const focusNext = useRef<string | null>(null);

  const frameOf = (key: string) =>
    overlay.current?.querySelector<HTMLElement>(`[data-hm-layer="${CSS.escape(key)}"]`);

  useEffect(() => {
    const key = focusNext.current;
    if (!key) return;
    const frame = frameOf(key);
    if (!frame) return;
    focusNext.current = null;
    frame.focus();
  });

  const selected = state.layers?.selected ?? null;
  const composition = compositionSize(plan, source);
  const placed = placement(composition, view);
  // A stage with no size yet has nowhere to put the frames, and no scale for a drag.
  if (!(placed.scale > 0)) return null;
  const crop = cropRect(plan.base.crop, source);
  const { orientation } = plan.base;
  const sceneToComposition = sceneToOutput(crop, orientation, composition);
  const seen = (box: ImageLayerBox) => layerToOutput(box, crop, orientation, composition);

  const capture = (event: PointerEvent<HTMLElement>) => {
    try {
      // Keeps the drag when the pointer leaves the element; a pointer the
      // browser doesn't track can't be captured, and the drag still works.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}
  };

  const onFramePointerDown =
    (layer: ImageLayer, handle: LayerHandle | "move") => (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      actions.select(layer.key);
      frameOf(layer.key)?.focus();
      capture(event);
      drag.current = {
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        key: layer.key,
        handle,
        start: boxOf(layer),
        moved: false,
      };
    };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    // In composition pixels: a move or a resize is by whole pixels of the scene.
    const dx = (event.clientX - current.x) / placed.scale;
    const dy = (event.clientY - current.y) / placed.scale;
    current.moved = true;
    if (current.handle === "move") {
      actions.moving(current.key, moveLayerBox(current.start, sceneToComposition, dx, dy));
      return;
    }
    // Along the box's own axes, as its handles are.
    const own = turned(invertMatrix(seen(current.start)), dx, dy);
    actions.moving(current.key, resizeLayerBox(current.start, current.handle, own.x, own.y));
  };

  const onPointerEnd = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    drag.current = undefined;
    // A cancelled pointer, such as a lost capture, leaves the plan as it was.
    if (event.type === "pointercancel") actions.cancel();
    else if (current.moved) actions.commit();
  };
  const pointer = { onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd };

  const onKeyDown = (layer: ImageLayer) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      // Escape during a drag cancels the drag; otherwise it closes the layers.
      if (drag.current) {
        drag.current = undefined;
        actions.cancel();
      } else {
        actions.done();
      }
      return;
    }
    // With Alt, Control or Meta, a key is the browser's or the system's,
    // such as Back and Forward, and is left alone (docs/adr/0007).
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      // Focus moves to the frame of the layer selected instead, or the panel's button.
      const next = actions.remove(layer.key);
      // A hidden layer's frame appears once it's selected.
      if (next !== null) focusNext.current = next;
      else {
        overlay.current
          ?.closest(".hm-image-editor")
          ?.querySelector<HTMLElement>(".hm-image-layers-done")
          ?.focus();
      }
      return;
    }
    const arrow = ARROWS[event.key];
    if (!arrow) return;
    event.preventDefault();
    // Handled here, so the editor's shortcuts don't also take the arrows.
    event.stopPropagation();
    const [dx, dy] = arrow;
    const box = boxOf(layer);
    // As seen on screen, whatever the layer's turn and the plan's rotation
    // and flips: Shift moves the edge that faces right with Left and Right,
    // and the one that faces down with Up and Down.
    const moved = event.shiftKey
      ? resizeLayerBoxOnScreen(box, seen(box), dx !== 0 ? "right" : "down", dx + dy)
      : moveLayerBox(box, sceneToComposition, dx, dy);
    actions.moving(layer.key, moved);
    actions.commit(true);
  };

  const count = plan.layers.length;
  const shown = plan.layers.filter((layer) => layer.visible || layer.key === selected);
  // One tab stop: the selected frame, or the top one when none is.
  const tabStop = shown.some((layer) => layer.key === selected) ? selected : shown.at(-1)?.key;
  return (
    <div
      ref={overlay}
      className="hm-image-layers-overlay"
      // A press on the image outside every layer selects none.
      onPointerDown={(event) => {
        if (event.button === 0) actions.select(null);
      }}
    >
      {shown.map((layer) => {
        const index = plan.layers.indexOf(layer);
        const isSelected = layer.key === selected;
        const [a, b, c, d, e, f] = seen(layer);
        return (
          // A positioned keyboard control over the canvas, not a form's fieldset (docs/adr/0007).
          // biome-ignore lint/a11y/useSemanticElements: a focusable group, not a fieldset
          <div
            key={layer.key}
            className="hm-image-layer-frame"
            data-hm-layer={layer.key}
            data-hm-selected={isSelected ? "" : undefined}
            data-hm-hidden={layer.visible ? undefined : ""}
            role="group"
            aria-label={messages.t("layers.frame", {
              // As the list counts them: the top layer is the first.
              index: count - index,
              count,
              name: layerLabel(layer, messages),
            })}
            aria-describedby={`${describedBy}-${index}`}
            tabIndex={layer.key === tabStop ? 0 : -1}
            style={{
              width: `${layer.width * placed.scale}px`,
              height: `${layer.height * placed.scale}px`,
              // The layer's own transform, at the stage's scale: its turn,
              // the plan's rotation and flips, and its place.
              transform: `matrix(${a}, ${b}, ${c}, ${d}, ${placed.x + e * placed.scale}, ${
                placed.y + f * placed.scale
              })`,
            }}
            onFocus={() => actions.select(layer.key)}
            onKeyDown={onKeyDown(layer)}
            onPointerDown={onFramePointerDown(layer, "move")}
            {...pointer}
          >
            <span id={`${describedBy}-${index}`} hidden>
              {messages.t("layers.frameDescription", {
                width: layer.width,
                height: layer.height,
                x: layer.x,
                y: layer.y,
                degrees: layer.rotation / 10,
              })}
            </span>
            {isSelected
              ? LAYER_HANDLES.map((handle) => (
                  <span
                    key={handle}
                    className="hm-image-layer-handle"
                    data-hm-handle={handle}
                    aria-hidden="true"
                    style={{ cursor: handleCursor([a, b, c, d, e, f], handle) }}
                    onPointerDown={onFramePointerDown(layer, handle)}
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
