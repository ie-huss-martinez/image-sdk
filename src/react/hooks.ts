import type { Messages, Store } from "@hussmartinez/sdk-core";
import { useContext, useSyncExternalStore } from "react";
import type { ImageSession, ImageSessionSnapshot } from "../core/session/session.js";
import type { ImageEditorState } from "../features/editor-state.js";
import type { ImageMessageCatalogue } from "../messages/en.js";
import { ImageContext, type ImageContextValue } from "./context.js";
import type { ImageViewState } from "./view-store.js";

function useImageContext(hook: string): ImageContextValue {
  const value = useContext(ImageContext);
  if (!value) throw new Error(`${hook}() must be used inside an ImageEditorProvider.`);
  return value;
}

/**
 * The session of the nearest `ImageEditorProvider`, to open images, run
 * commands, undo and export.
 *
 * @public
 */
export function useImageSession(): ImageSession {
  return useImageContext("useImageSession").session;
}

/**
 * The session's snapshot, re-rendering whenever it changes, through
 * `useSyncExternalStore`, so it's safe with concurrent and server rendering.
 *
 * @public
 */
export function useImageDocument(): ImageSessionSnapshot {
  const { session } = useImageContext("useImageDocument");
  return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
}

/**
 * The stage's zoom and pan, and the store to change them (docs/adr/0007).
 *
 * @public
 */
export function useImageView(): readonly [ImageViewState, Store<ImageViewState>] {
  const { view } = useImageContext("useImageView");
  const state = useSyncExternalStore(view.subscribe, view.getSnapshot, view.getSnapshot);
  return [state, view] as const;
}

/**
 * The editor's own state: the active tool, a crop in progress, and a
 * gesture's transient plan (docs/adr/0007).
 *
 * @public
 */
export function useImageEditorState(): readonly [ImageEditorState, Store<ImageEditorState>] {
  const { editor } = useImageContext("useImageEditorState");
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
  return [state, editor] as const;
}

/**
 * The SDK's text for the provider's locale and overrides (ADR 0019).
 *
 * @public
 */
export function useImageMessages(): Messages<ImageMessageCatalogue> {
  return useImageContext("useImageMessages").messages;
}

/** The provider's whole context, for the SDK's own components. */
export function useImageInternals(): ImageContextValue {
  return useImageContext("useImageInternals");
}
