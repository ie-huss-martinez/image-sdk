import { useAnnounce } from "@hussmartinez/ui/react";
import { useMemo } from "react";
import { aspectRatio, fitAspect, type ImageAspect, wholeCrop } from "../../core/model/crop.js";
import type { ImageCrop } from "../../core/model/plan.js";
import { useImageInternals } from "../hooks.js";

/** What the crop frame and panel do to a crop in progress (docs/adr/0007). */
export interface CropActions {
  /** Replaces the pending crop: a frame drag, a key or a field. */
  update(crop: ImageCrop): void;
  /** Chooses an aspect, and fits the pending crop to it. */
  setAspect(aspect: ImageAspect): void;
  /** Applies the pending crop as one undoable step, and ends cropping. */
  apply(): void;
  /** Ends cropping, changing nothing. */
  cancel(): void;
}

export function useCropActions(): CropActions {
  const { session, editor, messages } = useImageInternals();
  const announce = useAnnounce();
  return useMemo(() => {
    const pendingCrop = () => editor.getSnapshot().crop;
    return {
      update(crop) {
        const current = pendingCrop();
        if (!current) return;
        editor.set((state) => ({ ...state, crop: { ...current, pending: crop } }));
      },
      setAspect(aspect) {
        const current = pendingCrop();
        const source = session.getSnapshot().source;
        if (!current || !source) return;
        const pending = fitAspect(current.pending, aspectRatio(aspect, source));
        editor.set((state) => ({ ...state, crop: { aspect, pending } }));
      },
      apply() {
        const current = pendingCrop();
        const { plan, source } = session.getSnapshot();
        editor.set((state) => ({ ...state, tool: null, crop: null }));
        if (!current || !plan || !source) return;
        const whole = wholeCrop(source);
        const isWhole =
          current.pending.x === 0 &&
          current.pending.y === 0 &&
          current.pending.width === whole.width &&
          current.pending.height === whole.height;
        const crop = isWhole ? null : current.pending;
        // One crop session is one step, and only if it changed anything.
        if (JSON.stringify(crop) !== JSON.stringify(plan.base.crop)) {
          session.execute({ type: "image.setCrop", crop });
        }
        announce(
          messages.t("crop.applied", {
            width: current.pending.width,
            height: current.pending.height,
          }),
        );
      },
      cancel() {
        editor.set((state) => ({ ...state, tool: null, crop: null }));
      },
    };
  }, [announce, editor, messages, session]);
}
