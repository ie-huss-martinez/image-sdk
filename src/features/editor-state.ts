import { createStore, type Store } from "@hussmartinez/sdk-core";
import type { ImageAspect } from "../core/model/crop.js";
import type { ImageCrop, ImagePlan } from "../core/model/plan.js";

/**
 * The editor's own state, outside the session and its history
 * (docs/adr/0007): the active tool, a crop in progress, and a gesture's
 * transient plan, which the stage renders instead of the session's.
 *
 * @public
 */
export interface ImageEditorState {
  /** The tool that takes over the stage, such as `crop`, or `null`. */
  readonly tool: "crop" | null;
  /** The crop being made, in whole pixels of the oriented source, and its aspect. */
  readonly crop: { readonly pending: ImageCrop; readonly aspect: ImageAspect } | null;
  /**
   * A gesture's plan while it runs: the session's plan with the gesture's
   * change, which isn't an edit until the gesture ends.
   */
  readonly preview: ImagePlan | null;
}

export const IDLE: ImageEditorState = Object.freeze({ tool: null, crop: null, preview: null });

/** A store of the editor's state. */
export function createEditorStore(): Store<ImageEditorState> {
  return createStore<ImageEditorState>(IDLE);
}
