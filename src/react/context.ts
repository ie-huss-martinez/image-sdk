import type { Messages, Store } from "@hussmartinez/sdk-core";
import { createContext } from "react";
import { asImageError } from "../core/errors/error-helpers.js";
import { isImageError } from "../core/errors/image-error.js";
import type { ImageEngine } from "../core/ports/image-engine.js";
import type { ImageSession, ImageSessionEvent } from "../core/session/session.js";
import { type ImageEditorState, NO_TOOL } from "../features/editor-state.js";
import type { ImageEditorMessageCatalogue } from "../messages/editor-catalogue.js";
import type { ImageViewState } from "./view-store.js";

/** What the provider shares with every image component below it. */
export interface ImageContextValue {
  readonly session: ImageSession;
  /** The engine the session decodes with, which the stage's renderer shares. */
  readonly engine: ImageEngine;
  readonly messages: Messages<ImageEditorMessageCatalogue>;
  readonly view: Store<ImageViewState>;
  readonly editor: Store<ImageEditorState>;
  readonly opener: ImageOpener;
  readonly inserter: ImageInserter;
  /**
   * Sends the editor's own usage events, such as `download`, to the
   * provider's `onEvent`, where the session's go too (docs/adr/0007).
   */
  readonly emit: (event: ImageSessionEvent) => void;
}

/**
 * Adds images as layers for the editor's controls (docs/adr/0013): one at a
 * time, placed by the session in the middle of the image as it's shown, then
 * selected with the layers showing. A failure goes to the editor's state, which the stage
 * shows; a cancellation shows nothing.
 */
export interface ImageInserter {
  insert(file: Blob): Promise<void>;
  cancel(): void;
}

/** Creates an {@link ImageInserter} for a session and an editor's state. */
export function createInserter(
  session: ImageSession,
  editor: Store<ImageEditorState>,
): ImageInserter {
  let controller: AbortController | undefined;
  return {
    async insert(file) {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        // The session places it: in the middle, fitted, and neither turned
        // nor mirrored as it's seen.
        const image = await session.insertImage(file, { signal: current.signal });
        const layers = session.getSnapshot().plan?.layers ?? [];
        const added = [...layers]
          .reverse()
          .find((layer) => layer.kind === "image" && layer.source === image.id);
        const selected = added?.key ?? null;
        editor.set((state) => ({
          ...state,
          ...NO_TOOL,
          tool: "layers",
          preview: null,
          error: null,
          layers: { selected },
        }));
      } catch (reason) {
        const error = isImageError(reason) ? reason : asImageError(reason);
        // Cancelled, or another image was opened meanwhile: nothing to say.
        if (error.code !== "ABORTED") editor.set((state) => ({ ...state, error }));
      } finally {
        if (controller === current) controller = undefined;
      }
    },
    cancel() {
      controller?.abort();
      controller = undefined;
    },
  };
}

/**
 * Opens images for the editor's controls, cancelling one still opening when
 * another starts, or when the user cancels. A failure is in the session's
 * snapshot, which the stage shows.
 */
export interface ImageOpener {
  open(file: Blob): Promise<void>;
  cancel(): void;
}

/** Creates an {@link ImageOpener} for a session. */
export function createOpener(session: ImageSession): ImageOpener {
  let controller: AbortController | undefined;
  return {
    async open(file) {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      try {
        await session.open(file, { signal: current.signal });
      } catch {
        // In the snapshot: the stage shows it.
      } finally {
        if (controller === current) controller = undefined;
      }
    },
    cancel() {
      controller?.abort();
      controller = undefined;
    },
  };
}

export const ImageContext = /* @__PURE__ */ createContext<ImageContextValue | undefined>(undefined);
