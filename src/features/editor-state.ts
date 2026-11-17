import { createStore, type Store } from "@hussmartinez/sdk-core";
import type { ImageAspect } from "../core/model/crop.js";
import type { ImageCrop, ImagePlan, ImageRedactionMode } from "../core/model/plan.js";

/**
 * The editor's own state, outside the session and its history
 * (docs/adr/0007): the active tool, a crop in progress, the redaction
 * that's selected, and a gesture's transient plan, which the stage renders
 * instead of the session's.
 *
 * @public
 */
export interface ImageEditorState {
  /** The tool that takes over the stage, such as `crop`, or `null`. */
  readonly tool: "crop" | "redact" | null;
  /** The crop being made, in whole pixels of the oriented source, and its aspect. */
  readonly crop: { readonly pending: ImageCrop; readonly aspect: ImageAspect } | null;
  /**
   * While redacting: the key of the selected redaction, if any, and the mode
   * and colour a new one takes (docs/adr/0010).
   */
  readonly redact: {
    readonly selected: string | null;
    readonly mode: ImageRedactionMode;
    readonly colour: string;
  } | null;
  /**
   * A gesture's plan while it runs: the session's plan with the gesture's
   * change, which isn't an edit until the gesture ends.
   */
  readonly preview: ImagePlan | null;
  /** The dialog the editor shows over the stage, such as `export`, or `null`. */
  readonly dialog: "export" | null;
}

export const IDLE: ImageEditorState = Object.freeze({
  tool: null,
  crop: null,
  redact: null,
  preview: null,
  dialog: null,
});

/** A store of the editor's state. */
export function createEditorStore(): Store<ImageEditorState> {
  return createStore<ImageEditorState>(IDLE);
}
