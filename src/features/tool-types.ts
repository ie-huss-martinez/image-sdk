import type { Store, Tool } from "@hussmartinez/sdk-core";
import type { ImageSession, ImageSessionSnapshot } from "../core/session/session.js";
import type { ImageEditorState } from "./editor-state.js";

/**
 * What a tool reads to decide whether it's available, enabled or active.
 *
 * @public
 */
export interface ImageToolState {
  readonly snapshot: ImageSessionSnapshot;
  readonly editor: ImageEditorState;
}

/**
 * What a tool runs against.
 *
 * @public
 */
export interface ImageToolContext {
  readonly session: ImageSession;
  readonly view: Store<{
    readonly zoom: number;
    readonly pan: { readonly x: number; readonly y: number };
  }>;
  /** The editor's own state, which tools such as crop take over. */
  readonly editor: Store<ImageEditorState>;
  /** Asks the user for an image, as the open tool does. */
  readonly chooseFile: () => void;
  /** Asks the user for an image to add as a layer (docs/adr/0013). */
  readonly chooseLayerImage: () => void;
}

/**
 * One of the editor's tools (docs/adr/0007, sdk-core ADR 0009).
 *
 * @public
 */
export type ImageTool = Tool<ImageToolState, ImageToolContext, undefined> & {
  /**
   * Why the tool can't run right now, as a key of the editor's messages,
   * when there's something the user can do about it. The toolbar keeps a
   * button with a reason in the keyboard's order and describes it with the
   * text, so "why is this greyed out" has an answer.
   */
  readonly unavailable?: (state: ImageToolState) => string | undefined;
};

/** Whether a document is open. */
export const hasDocument = ({ snapshot }: ImageToolState): boolean => snapshot.plan !== null;

/**
 * A tool with a reason it can't run, as `unavailable` says. A function, not an
 * object spread, so the call can be marked free of side effects and a bundle
 * that doesn't use the tool drops it (sdk-core ADR 0056).
 *
 * @internal
 */
export function withReason(
  tool: Tool<ImageToolState, ImageToolContext, undefined>,
  unavailable: NonNullable<ImageTool["unavailable"]>,
): ImageTool {
  return { ...tool, unavailable };
}
