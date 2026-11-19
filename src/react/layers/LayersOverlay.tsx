import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import { arrowBounds, drawingBounds } from "../../core/model/drawing-geometry.js";
import { compositionSize, cropRect } from "../../core/model/geometry.js";
import { invertMatrix, layerToOutput, sceneToOutput } from "../../core/model/layer-geometry.js";
import type {
  ImageLayer,
  ImageLayerBox,
  ImagePlan,
  ImageScenePoint,
} from "../../core/model/plan.js";
import { type ImageRect, sceneRectToComposition } from "../../core/model/redaction-geometry.js";
import type { ImageSize } from "../../core/model/source.js";
import { type ImageView, placement } from "../../core/ports/image-renderer.js";
import { useImageEditorState, useImageMessages } from "../hooks.js";
import { createKeyRun } from "../key-run.js";
import {
  boxOf,
  handleCursor,
  LAYER_HANDLES,
  type LayerHandle,
  moveLayerBox,
  moveScenePoint,
  placeOf,
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

/** Some of a layer's fields, as `image.updateLayers` takes them. */
type Props = Readonly<Record<string, unknown>>;

/**
 * The layers as frames over the canvas (docs/adr/0013, docs/adr/0015). A
 * press on a frame selects its layer, the top one under the pointer, and a
 * drag moves it.
 *
 * - **Text, a shape or an image** has its box as its frame, placed and
 *   turned with the transform the renderer draws it through; the selected
 *   one's handles resize it.
 * - **A drawing** has the bounds of its strokes as its frame, and moves.
 * - **An arrow** has the bounds of its outline, and a handle on each end
 *   that re-aims it.
 *
 * Each frame is a focusable group, named by its place in the stack and what
 * the list calls it, and described by where it is. Its keys are the crop
 * frame's (docs/adr/0007): the arrows move it by a pixel as it's seen,
 * `Shift` with them resizes a box or moves an arrow's tip, `Delete` removes
 * it. Handles are pointer targets only, hidden from assistive technology:
 * the keys and the panel's fields do what they do.
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
        /** The fields a drag by this much on screen sets, in composition pixels, or none. */
        at: (dx: number, dy: number) => Props | null;
        moved: boolean;
      }
    | undefined
  >(undefined);
  /** The key whose frame takes focus once it's rendered: the one selected after a removal. */
  const focusNext = useRef<string | null>(null);
  /** The arrow keys held on a frame: one step per press, and per key held down. */
  const keys = useRef(createKeyRun());

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
  /** A rectangle of the scene on the stage, in CSS pixels. */
  const onStage = (rect: ImageRect) => {
    const shown = sceneRectToComposition(rect, crop, orientation);
    return {
      left: placed.x + shown.x * placed.scale,
      top: placed.y + shown.y * placed.scale,
      width: shown.width * placed.scale,
      height: shown.height * placed.scale,
    };
  };

  /** An arrow's ends moved, when they still differ: an arrow has a direction. */
  const aimed = (from: ImageScenePoint, to: ImageScenePoint, fields: Props): Props | null =>
    from.x === to.x && from.y === to.y ? null : fields;

  /** What a drag on a layer, or on one of its handles, sets. */
  const dragOf = (
    layer: ImageLayer,
    part: LayerHandle | "move" | "from" | "to",
  ): ((dx: number, dy: number) => Props | null) => {
    if (layer.kind === "drawing") {
      return (dx: number, dy: number): Props => ({
        ...moveScenePoint(layer, sceneToComposition, dx, dy),
      });
    }
    if (layer.kind === "arrow") {
      return (dx: number, dy: number) => {
        const from =
          part === "to" ? layer.from : moveScenePoint(layer.from, sceneToComposition, dx, dy);
        const to =
          part === "from" ? layer.to : moveScenePoint(layer.to, sceneToComposition, dx, dy);
        // Both ends, always: a gesture's latest change replaces its earlier
        // ones, so a tip moved after the whole arrow must carry the tail too.
        return aimed(from, to, { from, to });
      };
    }
    const start = boxOf(layer);
    return (dx: number, dy: number) => {
      if (part === "move") return placeOf(moveLayerBox(start, sceneToComposition, dx, dy));
      // Along the box's own axes, as its handles are.
      const own = turned(invertMatrix(seen(start)), dx, dy);
      return placeOf(resizeLayerBox(start, part as LayerHandle, own.x, own.y));
    };
  };

  /** What an arrow key sets: a move by a pixel as it's seen, or with Shift a resize or a re-aim. */
  const nudgeOf = (layer: ImageLayer, dx: number, dy: number, shift: boolean): Props | null => {
    if (layer.kind === "drawing") {
      // A drawing has no size to change.
      return shift ? null : { ...moveScenePoint(layer, sceneToComposition, dx, dy) };
    }
    if (layer.kind === "arrow") return dragOf(layer, shift ? "to" : "move")(dx, dy);
    const box = boxOf(layer);
    // As seen on screen, whatever the layer's turn and the plan's rotation
    // and flips: Shift moves the edge that faces right with Left and Right,
    // and the one that faces down with Up and Down.
    return placeOf(
      shift
        ? resizeLayerBoxOnScreen(box, seen(box), dx !== 0 ? "right" : "down", dx + dy)
        : moveLayerBox(box, sceneToComposition, dx, dy),
    );
  };

  const capture = (event: PointerEvent<HTMLElement>) => {
    try {
      // Keeps the drag when the pointer leaves the element; a pointer the
      // browser doesn't track can't be captured, and the drag still works.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}
  };

  const onFramePointerDown =
    (layer: ImageLayer, part: LayerHandle | "move" | "from" | "to") =>
    (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      // A pointer takes the gesture: a run of arrow keys still going ends first, as its own step.
      if (keys.current.handOff()) actions.commit();
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
        at: dragOf(layer, part),
        moved: false,
      };
    };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    // In composition pixels: a move or a resize is by whole pixels of the scene.
    const fields = current.at(
      (event.clientX - current.x) / placed.scale,
      (event.clientY - current.y) / placed.scale,
    );
    if (!fields) return;
    current.moved = true;
    actions.moving(current.key, fields);
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
      // Escape during a drag, or while arrow keys are held, cancels it;
      // otherwise it closes the layers.
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
    // While a pointer drags, the arrows don't move the frame: the drag owns the gesture.
    if (drag.current) return;
    // A run cancelled with Escape is ignored until its keys are let go.
    if (!keys.current.press(event.key)) return;
    const fields = nudgeOf(layer, arrow[0], arrow[1], event.shiftKey);
    if (!fields) return;
    // Shown at once; it's a step when the last key held is let go.
    actions.moving(layer.key, fields);
  };
  const onKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    if (ARROWS[event.key] && keys.current.release(event.key)) actions.commit();
  };
  // Focus leaving with a key held ends its run as one step: the key let go
  // elsewhere isn't seen.
  const onBlur = () => {
    if (keys.current.leave()) actions.commit();
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
        // What every frame has: a positioned keyboard control over the
        // canvas, not a form's fieldset (docs/adr/0007).
        const frame = {
          className: "hm-image-layer-frame",
          "data-hm-layer": layer.key,
          "data-hm-kind": layer.kind,
          "data-hm-selected": isSelected ? "" : undefined,
          "data-hm-hidden": layer.visible ? undefined : "",
          role: "group",
          "aria-label": messages.t("layers.frame", {
            // As the list counts them: the top layer is the first.
            index: count - index,
            count,
            name: layerLabel(layer, messages),
          }),
          "aria-describedby": `${describedBy}-${index}`,
          tabIndex: layer.key === tabStop ? 0 : -1,
          onFocus: () => actions.select(layer.key),
          onKeyDown: onKeyDown(layer),
          onKeyUp,
          onBlur,
          onPointerDown: onFramePointerDown(layer, "move"),
          ...pointer,
        };
        if (layer.kind === "drawing" || layer.kind === "arrow") {
          const bounds = layer.kind === "drawing" ? drawingBounds(layer) : arrowBounds(layer);
          const box = onStage(bounds);
          /** Where a point of the scene is inside the frame, in CSS pixels. */
          const inFrame = (point: ImageScenePoint) => {
            const at = onStage({ ...point, width: 0, height: 0 });
            return { left: `${at.left - box.left}px`, top: `${at.top - box.top}px` };
          };
          return (
            <div
              key={layer.key}
              {...frame}
              style={{
                width: `${box.width}px`,
                height: `${box.height}px`,
                transform: `translate(${box.left}px, ${box.top}px)`,
              }}
            >
              <span id={`${describedBy}-${index}`} hidden>
                {layer.kind === "drawing"
                  ? messages.t("layers.drawingDescription", {
                      count: layer.strokes.length,
                      width: bounds.width,
                      height: bounds.height,
                      x: bounds.x,
                      y: bounds.y,
                    })
                  : messages.t("layers.arrowDescription", {
                      fromX: layer.from.x,
                      fromY: layer.from.y,
                      toX: layer.to.x,
                      toY: layer.to.y,
                    })}
              </span>
              {isSelected && layer.kind === "arrow"
                ? (["from", "to"] as const).map((end) => (
                    <span
                      key={end}
                      className="hm-image-layer-handle"
                      data-hm-end={end}
                      aria-hidden="true"
                      style={inFrame(layer[end])}
                      onPointerDown={onFramePointerDown(layer, end)}
                      {...pointer}
                    />
                  ))
                : null}
            </div>
          );
        }
        const [a, b, c, d, e, f] = seen(layer);
        return (
          <div
            key={layer.key}
            {...frame}
            style={{
              width: `${layer.width * placed.scale}px`,
              height: `${layer.height * placed.scale}px`,
              // The layer's own transform, at the stage's scale: its turn,
              // the plan's rotation and flips, and its place.
              transform: `matrix(${a}, ${b}, ${c}, ${d}, ${placed.x + e * placed.scale}, ${
                placed.y + f * placed.scale
              })`,
            }}
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
