import { createStore, type Store } from "@hussmartinez/sdk-core";
import type { ImageError } from "../core/errors/image-error.js";
import type { ImageAspect } from "../core/model/crop.js";
import type { ImageCrop, ImagePlan, ImageRedactionMode } from "../core/model/plan.js";

/**
 * The editor's own state, outside the session and its history
 * (docs/adr/0007): the active tool, a crop in progress, the redaction or
 * the layer that's selected, and a gesture's transient plan, which the
 * stage renders instead of the session's.
 *
 * @public
 */
export interface ImageEditorState {
  /** The tool that takes over the stage, such as `crop`, or `null`. */
  readonly tool: "crop" | "redact" | "layers" | null;
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
   * While the layers are shown: the key of the selected layer, if any
   * (docs/adr/0013). Selection is view state, outside the plan and its
   * history.
   */
  readonly layers: {
    readonly selected: string | null;
    /**
     * Where the panel moves focus, once, before it clears this: to the
     * selected layer in the `list`, when the layers tool starts; or to the
     * `text` field of a text layer just added. Unset, focus stays where it
     * is, as when a shape or an image is added.
     */
    readonly focus?: "list" | "text";
  } | null;
  /**
   * What an editor's own action failed with, such as adding a layer over
   * the limit or an image that can't be read. The stage shows its text
   * until the next such action succeeds, or another image opens.
   */
  readonly error: ImageError | null;
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
  layers: null,
  error: null,
  preview: null,
  dialog: null,
});

/** A store of the editor's state. */
export function createEditorStore(): Store<ImageEditorState> {
  return createStore<ImageEditorState>(IDLE);
}
