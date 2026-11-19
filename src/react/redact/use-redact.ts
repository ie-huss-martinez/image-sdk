import { useAnnounce } from "@hussmartinez/ui/react";
import { useMemo } from "react";
import { compositionSize, cropRect } from "../../core/model/geometry.js";
import { createImageKey } from "../../core/model/keys.js";
import type { ImagePlan, ImageRedaction, ImageRedactionMode } from "../../core/model/plan.js";
import {
  compositionRectToScene,
  fitRedactionRegion,
  type ImageRect,
} from "../../core/model/redaction-geometry.js";
import type { ImageCommand } from "../../core/operations/commands.js";
import { NO_TOOL } from "../../features/editor-state.js";
import { DEFAULT_REDACTION_COLOUR } from "../../features/redact/redact-tool.js";
import { type Gesture, useSharedGesture } from "../gesture.js";
import { useImageInternals } from "../hooks.js";

/** What the redact frames and panel do (docs/adr/0010). */
export interface RedactActions {
  /** Adds a region at the middle of the image as it's shown, and selects it. */
  add(): void;
  /** Selects a redaction, or none. */
  select(key: string | null): void;
  /** Removes a redaction, as one step. */
  remove(key: string): void;
  /**
   * Shows a region being dragged out on the stage, in composition pixels,
   * without changing the plan. `commit` then adds it as one step.
   */
  drawing(key: string, rect: ImageRect): void;
  /** Shows a redaction's region while it's moved or resized, in scene pixels. */
  moving(key: string, region: ImageRect): void;
  /** Ends the gesture as one step: a drag let go, or the last arrow key held let go. */
  commit(): void;
  /** Ends the gesture with no step. */
  cancel(): void;
  /** Sets a redaction's region at once, as one step: a number field. */
  setRegion(key: string, region: ImageRect): void;
  /** Sets the mode of the selected redaction, and of the next one added. */
  setMode(mode: ImageRedactionMode): void;
  /** Sets the colour of the selected solid redaction, and of the next one added. */
  setColour(colour: string): void;
  /** Ends redacting. */
  done(): void;
  /** The gesture these actions run. */
  readonly gesture: Gesture;
}

/** Every key the plan uses. */
const keysOf = (plan: ImagePlan) =>
  new Set([...plan.layers, ...plan.redactions].map((item: { key: string }) => item.key));

/** A new key for the plan: the session's keys are generated here, before a command. */
export function newRedactionKey(plan: ImagePlan): string {
  return createImageKey(keysOf(plan));
}

export function useRedactActions(): RedactActions {
  const { session, editor, messages } = useImageInternals();
  const announce = useAnnounce();
  const gesture = useSharedGesture();
  return useMemo(() => {
    const settings = () =>
      editor.getSnapshot().redact ?? {
        selected: null,
        mode: "solid" as const,
        colour: DEFAULT_REDACTION_COLOUR,
      };
    const set = (changes: Partial<ReturnType<typeof settings>>) =>
      editor.set((state) =>
        state.tool === "redact" ? { ...state, redact: { ...settings(), ...changes } } : state,
      );
    const redaction = (key: string, region: ImageRect): ImageRedaction => {
      const { mode, colour } = settings();
      const fitted = fitRedactionRegion(region);
      return mode === "solid" ? { key, mode, ...fitted, colour } : { key, mode, ...fitted };
    };
    const insert = (item: ImageRedaction, plan: ImagePlan): ImageCommand => ({
      type: "image.insertRedactions",
      at: plan.redactions.length,
      redactions: [item],
    });
    const count = () => session.getSnapshot().plan?.redactions.length ?? 0;
    const actions: RedactActions = {
      gesture,
      add() {
        const { plan, source } = session.getSnapshot();
        if (!plan || !source) return;
        gesture.commit();
        // A quarter of the image as it's shown, in its middle.
        const { width, height } = compositionSize(plan, source);
        const shown = {
          x: Math.round(width * 0.375),
          y: Math.round(height * 0.375),
          width: Math.max(1, Math.round(width / 4)),
          height: Math.max(1, Math.round(height / 4)),
        };
        const key = newRedactionKey(plan);
        const region = compositionRectToScene(
          shown,
          cropRect(plan.base.crop, source),
          plan.base.orientation,
        );
        session.execute(insert(redaction(key, region), plan));
        set({ selected: key });
        announce(messages.t("redact.added", { count: count() }));
      },
      select(key) {
        if (settings().selected === key) return;
        gesture.commit();
        const item = session.getSnapshot().plan?.redactions.find((r) => r.key === key);
        // The panel shows the selected redaction's own mode and colour.
        set({
          selected: item ? key : null,
          ...(item ? { mode: item.mode } : {}),
          ...(item?.mode === "solid" ? { colour: item.colour } : {}),
        });
      },
      remove(key) {
        gesture.cancel();
        if (!session.getSnapshot().plan?.redactions.some((r) => r.key === key)) return;
        session.execute({ type: "image.removeRedactions", keys: [key] });
        if (settings().selected === key) set({ selected: null });
        announce(
          count() === 0
            ? messages.t("redact.removedLast")
            : messages.t("redact.removed", { count: count() }),
        );
      },
      drawing(key, rect) {
        const { plan, source } = session.getSnapshot();
        if (!plan || !source) return;
        const region = compositionRectToScene(
          rect,
          cropRect(plan.base.crop, source),
          plan.base.orientation,
        );
        // The selection waits for the release: selecting now would change
        // the panel, and with it the stage's size, under the drag.
        gesture.preview([insert(redaction(key, region), plan)]);
      },
      moving(key, region) {
        gesture.preview([
          {
            type: "image.updateRedactions",
            updates: [{ key, props: fitRedactionRegion(region) }],
          },
        ]);
      },
      commit() {
        const drew = gesture.active() && count();
        gesture.commit();
        if (drew !== false && count() > drew) {
          announce(messages.t("redact.added", { count: count() }));
        }
      },
      cancel() {
        gesture.cancel();
      },
      setRegion(key, region) {
        gesture.commit();
        session.execute({
          type: "image.updateRedactions",
          updates: [{ key, props: fitRedactionRegion(region) }],
        });
      },
      setMode(mode) {
        gesture.commit();
        const { selected, colour } = settings();
        const item = session.getSnapshot().plan?.redactions.find((r) => r.key === selected);
        if (item && item.mode !== mode) {
          session.execute({
            type: "image.updateRedactions",
            updates: [{ key: item.key, props: mode === "solid" ? { mode, colour } : { mode } }],
          });
        }
        set({ mode });
      },
      setColour(colour) {
        gesture.commit();
        const item = session
          .getSnapshot()
          .plan?.redactions.find((r) => r.key === settings().selected);
        if (item?.mode === "solid" && item.colour !== colour) {
          session.execute({
            type: "image.updateRedactions",
            updates: [{ key: item.key, props: { colour } }],
          });
        }
        set({ colour });
      },
      done() {
        gesture.commit();
        editor.set((state) =>
          state.tool === "redact" ? { ...state, ...NO_TOOL, preview: null } : state,
        );
      },
    };
    return actions;
  }, [announce, editor, gesture, messages, session]);
}
