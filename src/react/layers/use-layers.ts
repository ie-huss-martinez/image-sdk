import type { Messages } from "@hussmartinez/sdk-core";
import { useAnnounce } from "@hussmartinez/ui/react";
import { useMemo } from "react";
import {
  type ImageLayer,
  type ImageLayerBox,
  MAX_LAYER_NAME_LENGTH,
  MAX_SCENE_COORDINATE,
} from "../../core/model/plan.js";
import { FORBIDDEN_IN_TEXT } from "../../core/operations/layers.js";
import type { ImageEditorMessageCatalogue } from "../editor-messages.js";
import { type Gesture, useSharedGesture } from "../gesture.js";
import { useImageInternals } from "../hooks.js";
import { newRedactionKey } from "../redact/use-redact.js";

/** How far a copy sits from its original, in scene pixels, so both can be seen. */
const DUPLICATE_OFFSET = 8;
/** How much of a text layer's own text names it in the list. */
const LABEL_LENGTH = 40;
const EVERY_FORBIDDEN = new RegExp(FORBIDDEN_IN_TEXT.source, "gu");

/**
 * What the layers list and the frames call a layer: its name; or, unnamed,
 * the start of a text layer's first line, or its kind. It's shown as text,
 * never as HTML (docs/adr/0009).
 */
export function layerLabel(
  layer: ImageLayer,
  messages: Messages<ImageEditorMessageCatalogue>,
): string {
  if (layer.name !== "") return layer.name;
  if (layer.kind === "text") {
    const line = layer.text.split("\n").find((text) => text.trim() !== "");
    if (line) return [...line.trim()].slice(0, LABEL_LENGTH).join("");
  }
  return messages.t(`layers.kinds.${layer.kind === "shape" ? layer.shape : layer.kind}`);
}

/** A name as the plan takes it: without the characters it refuses, within its length. */
export function fitLayerName(name: string): string {
  return [...name.replace(EVERY_FORBIDDEN, "").trim()].slice(0, MAX_LAYER_NAME_LENGTH).join("");
}

/** What the layers' frames and panel do (docs/adr/0013). */
export interface LayerActions {
  /** Selects a layer, or none. */
  select(key: string | null): void;
  /**
   * Removes a layer, as one step, and selects the one now in its place, or
   * the new top one. Returns the key selected, if any.
   */
  remove(key: string): string | null;
  /** Adds a copy over the layer, as one step, and selects it. Throws what the session refuses. */
  duplicate(key: string): void;
  /** Moves a layer one place up the stack, or down, as one step. */
  shift(key: string, by: 1 | -1): void;
  /** Shows a layer's box while it's moved or resized, without changing the plan. */
  moving(key: string, box: ImageLayerBox): void;
  /** Ends the gesture as one step: at once, or after the keyboard's delay. */
  commit(soon?: boolean): void;
  /** Ends the gesture with no step. */
  cancel(): void;
  /** Sets some of a layer's fields at once, as one step: a field of the panel. */
  set(key: string, props: Readonly<Record<string, unknown>>): void;
  /** Stops showing the layers. */
  done(): void;
  /** The gesture these actions run. */
  readonly gesture: Gesture;
}

export function useLayerActions(): LayerActions {
  const { session, editor, messages } = useImageInternals();
  const announce = useAnnounce();
  const gesture = useSharedGesture();
  return useMemo(() => {
    const layers = () => session.getSnapshot().plan?.layers ?? [];
    const select = (key: string | null) =>
      editor.set((state) =>
        state.tool === "layers" && state.layers?.selected !== key
          ? { ...state, layers: { selected: key } }
          : state,
      );
    const actions: LayerActions = {
      gesture,
      select(key) {
        if (editor.getSnapshot().layers?.selected === key) return;
        gesture.commit();
        select(key !== null && layers().some((layer) => layer.key === key) ? key : null);
      },
      remove(key) {
        gesture.cancel();
        const index = layers().findIndex((layer) => layer.key === key);
        const layer = layers()[index];
        if (!layer) return null;
        session.execute({ type: "image.removeLayers", keys: [key] });
        const next = (layers()[index] ?? layers().at(-1))?.key ?? null;
        select(next);
        announce(messages.t("layers.removed", { name: layerLabel(layer, messages) }));
        return next;
      },
      duplicate(key) {
        gesture.commit();
        const plan = session.getSnapshot().plan;
        const index = layers().findIndex((layer) => layer.key === key);
        const layer = layers()[index];
        if (!plan || !layer) return;
        const copy: ImageLayer = {
          ...layer,
          key: newRedactionKey(plan),
          x: Math.min(layer.x + DUPLICATE_OFFSET, MAX_SCENE_COORDINATE),
          y: Math.min(layer.y + DUPLICATE_OFFSET, MAX_SCENE_COORDINATE),
        };
        session.execute({ type: "image.insertLayers", at: index + 1, layers: [copy] });
        select(copy.key);
        announce(messages.t("layers.duplicated", { name: layerLabel(layer, messages) }));
      },
      shift(key, by) {
        gesture.commit();
        const index = layers().findIndex((layer) => layer.key === key);
        const layer = layers()[index];
        const to = index + by;
        if (!layer || to < 0 || to >= layers().length) return;
        session.execute({ type: "image.moveLayers", keys: [key], to });
        // The list shows the top layer first: its place there, from 1.
        announce(
          messages.t(by > 0 ? "layers.movedUp" : "layers.movedDown", {
            name: layerLabel(layer, messages),
            index: layers().length - to,
            count: layers().length,
          }),
        );
      },
      moving(key, box) {
        const { x, y, width, height } = box;
        gesture.preview([
          { type: "image.updateLayers", updates: [{ key, props: { x, y, width, height } }] },
        ]);
      },
      commit(soon = false) {
        if (soon) gesture.commitSoon();
        else gesture.commit();
      },
      cancel() {
        gesture.cancel();
      },
      set(key, props) {
        gesture.commit();
        session.execute({ type: "image.updateLayers", updates: [{ key, props }] });
      },
      done() {
        gesture.commit();
        editor.set((state) =>
          state.tool === "layers" ? { ...state, tool: null, layers: null, preview: null } : state,
        );
      },
    };
    return actions;
  }, [announce, editor, gesture, messages, session]);
}
