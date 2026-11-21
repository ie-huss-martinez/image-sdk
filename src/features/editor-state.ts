import { createStore, type Store } from "@hussmartinez/sdk-core";
import type { ImageError } from "../core/errors/image-error.js";
import type { ImageAspect } from "../core/model/crop.js";
import type { ImageCrop, ImagePlan, ImageRedactionMode } from "../core/model/plan.js";

/**
 * The editor's own state, outside the session and its history
 * (docs/adr/0007): the active tool, a crop in progress, the redaction or
 * the layer that's selected, what's drawn with, and a gesture's transient plan, which the
 * stage renders instead of the session's.
 *
 * @public
 */
export interface ImageEditorState {
  /**
   * The tool that takes over the stage, such as `crop`, or `null`. With
   * `frames`, the inspector lists an animation's frames (docs/adr/0011);
   * the one selected is the one shown, `playback.frame`.
   */
  readonly tool: "crop" | "redact" | "layers" | "draw" | "frames" | null;
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
   * While drawing (docs/adr/0015): what the next stroke is drawn with, and
   * the key of the drawing layer it joins, if there is one.
   */
  readonly draw: {
    /** A pen draws opaque strokes; a highlighter wide ones in a see-through drawing. */
    readonly mode: "pen" | "highlighter";
    readonly colour: string;
    /** In scene pixels. */
    readonly width: number;
    /** The drawing the next stroke joins, or `null` to start a new one. */
    readonly target: string | null;
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
  /**
   * An animation's frame being shown, as an index into the plan's
   * `animation.frames`, and whether it's playing (docs/adr/0011). View
   * state, like the zoom: outside the plan and its history. No tool resets
   * it; another image opening does.
   */
  readonly playback: { readonly frame: number; readonly playing: boolean };
}

/** The first frame, paused: nothing plays on its own (docs/adr/0011). */
export const PAUSED = /* @__PURE__ */ Object.freeze({ frame: 0, playing: false });

/**
 * No tool on the stage: what a tool spreads before it sets its own state, so
 * one tool has the stage at a time, and what ends them all.
 */
export const NO_TOOL = /* @__PURE__ */ Object.freeze({
  tool: null,
  crop: null,
  redact: null,
  layers: null,
  draw: null,
} satisfies Partial<ImageEditorState>);

export const IDLE: ImageEditorState = /* @__PURE__ */ idle();

/**
 * Builds {@link IDLE}. A function, so the call can be marked free of side
 * effects: the spread of {@link NO_TOOL} otherwise keeps it in every bundle
 * that imports this module (sdk-core ADR 0056).
 */
function idle(): ImageEditorState {
  return Object.freeze({ ...NO_TOOL, error: null, preview: null, dialog: null, playback: PAUSED });
}

/** A store of the editor's state. */
export function createEditorStore(): Store<ImageEditorState> {
  return createStore<ImageEditorState>(IDLE);
}
