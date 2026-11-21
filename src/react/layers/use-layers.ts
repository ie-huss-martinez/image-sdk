import type { Messages } from "@hussmartinez/sdk-core";
import { useAnnounce } from "@hussmartinez/ui/react";
import { useMemo } from "react";
import {
  type ImageLayer,
  MAX_LAYER_NAME_LENGTH,
  MAX_LAYER_TEXT_LENGTH,
  MAX_SCENE_COORDINATE,
} from "../../core/model/plan.js";
import { FORBIDDEN_IN_TEXT } from "../../core/operations/layers.js";
import { NO_TOOL } from "../../features/editor-state.js";
import type { ImageEditorMessageCatalogue } from "../../messages/editor-catalogue.js";
import { type Gesture, useSharedGesture } from "../gesture.js";
import { useImageInternals } from "../hooks.js";
import { newRedactionKey } from "../redact/use-redact.js";

/** How far a copy sits from its original, in scene pixels, so both can be seen. */
const DUPLICATE_OFFSET = 8;
/** How much of a text layer's own text names it in the list. */
const LABEL_LENGTH = 40;
const EVERY_FORBIDDEN = /* @__PURE__ */ everyMatch(FORBIDDEN_IN_TEXT);

/** A pattern's global form. A function, so the call can be marked free of side effects (sdk-core ADR 0056). */
function everyMatch(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, `${pattern.flags}g`);
}

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

/**
 * Text as the plan takes it (docs/adr/0009): every line break a line feed,
 * whatever it was where the text came from; a tab a space; without the
 * characters text can't hold; within its length.
 */
export function fitLayerText(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\t/g, " ");
  return [...lines.replace(EVERY_FORBIDDEN, "")].slice(0, MAX_LAYER_TEXT_LENGTH).join("");
}

/** What the layers' frames and panel do (docs/adr/0013). */
export interface LayerActions {
  /** Selects a layer, or none. */
  select(key: string | null): void;
  /**
   * Removes a layer, as one step, and selects the one now in its place in
   * the list, which shows the top layer first: the one that was under it,
   * or the new bottom one. Returns the key selected, if any.
   */
  remove(key: string): string | null;
  /** Adds a copy over the layer, as one step, and selects it. Throws what the session refuses. */
  duplicate(key: string): void;
  /** Moves a layer one place up the stack, or down, as one step. */
  shift(key: string, by: 1 | -1): void;
  /**
   * Shows some of a layer's fields while it's moved, resized or re-aimed,
   * without changing the plan: a box's place and size, a drawing's origin,
   * an arrow's ends.
   */
  moving(key: string, props: Readonly<Record<string, unknown>>): void;
  /** Ends the gesture as one step: a drag let go, or the last arrow key held let go. */
  commit(): void;
  /** Ends the gesture with no step. */
  cancel(): void;
  /** Sets some of a layer's fields at once, as one step: a field of the panel. */
  set(key: string, props: Readonly<Record<string, unknown>>): void;
  /**
   * Shows some of a layer's fields while they're typed, and sets them as
   * one step once the typing stops: a text field.
   */
  typing(key: string, props: Readonly<Record<string, unknown>>): void;
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
        // As the list shows them, the top one first: the layer now in the
        // removed one's place there, which was under it, or the new last one.
        const next = (layers()[index - 1] ?? layers()[0])?.key ?? null;
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
        const moved = (value: number) => Math.min(value + DUPLICATE_OFFSET, MAX_SCENE_COORDINATE);
        const copyKey = newRedactionKey(plan);
        // An arrow is placed by its two ends; every other kind by its x and y.
        const copy: ImageLayer =
          layer.kind === "arrow"
            ? {
                ...layer,
                key: copyKey,
                from: { x: moved(layer.from.x), y: moved(layer.from.y) },
                to: { x: moved(layer.to.x), y: moved(layer.to.y) },
              }
            : { ...layer, key: copyKey, x: moved(layer.x), y: moved(layer.y) };
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
      moving(key, props) {
        gesture.preview([{ type: "image.updateLayers", updates: [{ key, props }] }]);
      },
      commit() {
        gesture.commit();
      },
      cancel() {
        gesture.cancel();
      },
      set(key, props) {
        gesture.commit();
        session.execute({ type: "image.updateLayers", updates: [{ key, props }] });
      },
      typing(key, props) {
        gesture.preview([{ type: "image.updateLayers", updates: [{ key, props }] }]);
        gesture.commitSoon();
      },
      done() {
        gesture.commit();
        editor.set((state) =>
          state.tool === "layers" ? { ...state, ...NO_TOOL, preview: null } : state,
        );
      },
    };
    return actions;
  }, [announce, editor, gesture, messages, session]);
}
