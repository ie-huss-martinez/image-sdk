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
}

/**
 * One of the editor's tools (docs/adr/0007, sdk-core ADR 0009).
 *
 * @public
 */
export type ImageTool = Tool<ImageToolState, ImageToolContext, undefined>;

/** Whether a document is open. */
export const hasDocument = ({ snapshot }: ImageToolState): boolean => snapshot.plan !== null;
