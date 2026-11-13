import type { Messages, Store } from "@hussmartinez/sdk-core";
import { createContext } from "react";
import type { ImageEngine } from "../core/ports/image-engine.js";
import type { ImageSession } from "../core/session/session.js";
import type { ImageEditorState } from "../features/editor-state.js";
import type { ImageMessageCatalogue } from "../messages/en.js";
import type { ImageViewState } from "./view-store.js";

/** What the provider shares with every image component below it. */
export interface ImageContextValue {
  readonly session: ImageSession;
  /** The engine the session decodes with, which the stage's renderer shares. */
  readonly engine: ImageEngine;
  readonly messages: Messages<ImageMessageCatalogue>;
  readonly view: Store<ImageViewState>;
  readonly editor: Store<ImageEditorState>;
  readonly opener: ImageOpener;
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
