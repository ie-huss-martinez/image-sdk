import { useAnnounce } from "@hussmartinez/ui/react";
import { useMemo } from "react";
import { asImageError } from "../../core/errors/error-helpers.js";
import { isImageError } from "../../core/errors/image-error.js";
import { simplifyStroke } from "../../core/model/drawing-geometry.js";
import {
  type ImageDrawingLayer,
  type ImagePlan,
  type ImageScenePoint,
  type ImageStroke,
  MAX_SCENE_COORDINATE,
  MAX_STROKE_WIDTH,
} from "../../core/model/plan.js";
import type { ImageCommand } from "../../core/operations/commands.js";
import {
  DRAW_COLOUR,
  DRAW_OPACITY,
  drawWidth,
  type ImageDrawMode,
} from "../../features/draw/draw-tool.js";
import { NO_TOOL } from "../../features/editor-state.js";
import { newLayerKey } from "../../features/layers/new-layer.js";
import { type Gesture, useSharedGesture } from "../gesture.js";
import { useImageInternals } from "../hooks.js";

/** What the draw overlay and panel do (docs/adr/0015). */
export interface DrawActions {
  /**
   * Shows a stroke being drawn, from its samples so far, without changing
   * the plan: simplified as it will be committed, so nothing shifts on
   * release (docs/adr/0014).
   *
   * @param key - The key a new drawing takes if this stroke starts one.
   * @param samples - Scene points, in the order they were drawn.
   * @param tolerance - One screen pixel, in whole scene pixels.
   */
  drawing(key: string, samples: readonly ImageScenePoint[], tolerance: number): void;
  /** Ends the stroke as one step. What the session refuses goes to the editor's state. */
  commit(key: string): void;
  /** Ends the stroke with no step. */
  cancel(): void;
  /** A key no layer has, for a drawing a stroke may start. */
  newKey(): string;
  /** Sets the mode, with its own colour and width, or the colour or width alone. */
  set(changes: { mode?: ImageDrawMode; colour?: string; width?: number }): void;
  /** Removes the last stroke of the drawing being drawn into, or the drawing with its only one. */
  removeLast(): void;
  /** The drawing the next stroke joins, if the plan still has one that the mode can add to. */
  target(): ImageDrawingLayer | undefined;
  /** Ends drawing. */
  done(): void;
  readonly gesture: Gesture;
}

const clamp = (value: number) =>
  Math.min(MAX_SCENE_COORDINATE, Math.max(-MAX_SCENE_COORDINATE, Math.round(value) || 0));

/** A stroke's samples as the commands' points: whole pixels of the scene, from an origin. */
function relative(samples: readonly ImageScenePoint[], origin: ImageScenePoint): number[] {
  return samples.flatMap((point) => [clamp(point.x) - origin.x, clamp(point.y) - origin.y]);
}

export function useDrawActions(): DrawActions {
  const context = useImageInternals();
  const { session, editor, messages } = context;
  const announce = useAnnounce();
  const gesture = useSharedGesture();
  return useMemo(() => {
    const settings = () => editor.getSnapshot().draw;
    const patch = (changes: Partial<NonNullable<ReturnType<typeof settings>>>) =>
      editor.set((state) =>
        state.tool === "draw" && state.draw
          ? { ...state, draw: { ...state.draw, ...changes } }
          : state,
      );
    /** The drawing the mode can add to: the target, if the plan has it at the mode's opacity. */
    const targetIn = (plan: ImagePlan | null) => {
      const current = settings();
      const layer = plan?.layers.find((item) => item.key === current?.target);
      return current && layer?.kind === "drawing" && layer.opacity === DRAW_OPACITY[current.mode]
        ? layer
        : undefined;
    };
    const actions: DrawActions = {
      gesture,
      newKey: () => {
        const plan = session.getSnapshot().plan;
        return plan ? newLayerKey(plan) : "";
      },
      target: () => targetIn(session.getSnapshot().plan),
      drawing(key, samples, tolerance) {
        const current = settings();
        const plan = session.getSnapshot().plan;
        const first = samples[0];
        if (!current || !plan || !first) return;
        const joined = targetIn(plan);
        // A stroke joins the drawing it's aimed at; otherwise it starts one,
        // whose origin is where the stroke began (docs/adr/0014).
        const origin = joined ?? { x: clamp(first.x), y: clamp(first.y) };
        const stroke: ImageStroke = {
          colour: current.colour,
          width: current.width,
          runs: simplifyStroke(relative(samples, origin), tolerance),
        };
        const command: ImageCommand = joined
          ? { type: "image.addStrokes", key: joined.key, strokes: [stroke] }
          : {
              type: "image.insertLayers",
              at: plan.layers.length,
              layers: [
                {
                  key,
                  kind: "drawing",
                  name: "",
                  visible: true,
                  opacity: DRAW_OPACITY[current.mode],
                  x: origin.x,
                  y: origin.y,
                  strokes: [stroke],
                },
              ],
            };
        gesture.preview([command]);
      },
      commit(key) {
        const started = targetIn(session.getSnapshot().plan) === undefined;
        try {
          gesture.commit();
          editor.set((state) => (state.error === null ? state : { ...state, error: null }));
        } catch (reason) {
          // Over the points limit, for one: said on the stage, and nothing is added.
          const error = isImageError(reason) ? reason : asImageError(reason);
          editor.set((state) => ({ ...state, error, preview: null }));
          return;
        }
        // The next stroke joins the drawing this one started.
        if (started && session.getSnapshot().plan?.layers.some((layer) => layer.key === key)) {
          patch({ target: key });
        }
      },
      cancel() {
        gesture.cancel();
      },
      set(changes) {
        gesture.commit();
        const current = settings();
        if (!current) return;
        if (changes.mode !== undefined && changes.mode !== current.mode) {
          // Another mode draws into another drawing, with its own colour and width.
          patch({
            mode: changes.mode,
            colour: DRAW_COLOUR[changes.mode],
            width: drawWidth(context, changes.mode),
            target: null,
          });
          return;
        }
        patch({
          ...(changes.colour === undefined ? {} : { colour: changes.colour }),
          ...(changes.width === undefined
            ? {}
            : { width: Math.min(MAX_STROKE_WIDTH, Math.max(1, Math.round(changes.width))) }),
        });
      },
      removeLast() {
        gesture.cancel();
        const drawing = targetIn(session.getSnapshot().plan);
        if (!drawing) return;
        if (drawing.strokes.length > 1) {
          session.execute({
            type: "image.removeStrokes",
            key: drawing.key,
            indexes: [drawing.strokes.length - 1],
          });
        } else {
          // A drawing keeps at least one stroke: its only one goes with it.
          session.execute({ type: "image.removeLayers", keys: [drawing.key] });
          patch({ target: null });
        }
        announce(messages.t("draw.removed"));
      },
      done() {
        gesture.commit();
        editor.set((state) =>
          state.tool === "draw" ? { ...state, ...NO_TOOL, preview: null } : state,
        );
      },
    };
    return actions;
  }, [announce, context, editor, gesture, messages, session]);
}
