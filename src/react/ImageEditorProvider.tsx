import { createMessages, type MessageOverrides } from "@hussmartinez/sdk-core";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { createImageEngine } from "../adapters/image-engine.js";
import { createImageProcessor } from "../adapters/image-processor.js";
import type { ImageFilePolicyOverrides } from "../core/errors/image-limits.js";
import type { ImageEngine } from "../core/ports/image-engine.js";
import type { ImageProcessor } from "../core/ports/image-processor.js";
import {
  createImageSession,
  type ImageSession,
  type ImageSessionEvent,
} from "../core/session/session.js";
import { createEditorStore } from "../features/editor-state.js";
import { type ImageMessageCatalogue, imageMessages } from "../messages/en.js";
import { createOpener, ImageContext } from "./context.js";
import { createViewStore } from "./view-store.js";

/**
 * Props of {@link ImageEditorProvider}.
 *
 * @public
 */
export interface ImageEditorProviderProps {
  /**
   * The engine that probes, decodes and holds images, and draws the stage.
   * Defaults to the SDK's own, created with `assetsUrl`. A session of your own
   * must use this engine.
   */
  readonly engine?: ImageEngine;
  /** The processor for exports. Defaults to the SDK's own, on the engine. */
  readonly processor?: ImageProcessor;
  /** A session of your own, over `engine`, instead of one the provider creates. */
  readonly session?: ImageSession;
  /**
   * Where the application serves the package's `dist/assets/` directory, for
   * the engine the provider creates (docs/adr/0002).
   */
  readonly assetsUrl?: string | URL;
  /** File limits for a session the provider creates (docs/adr/0004). */
  readonly filePolicy?: ImageFilePolicyOverrides;
  /** Anonymous usage events from a session the provider creates. */
  readonly onEvent?: (event: ImageSessionEvent) => void;
  /** Text overrides, typed against the English catalogue (ADR 0019). */
  readonly messages?: MessageOverrides<ImageMessageCatalogue>;
  /** The locale for numbers and plurals. Defaults to `"en"`. */
  readonly locale?: string;
  /** The components that use the session, such as `ImageStage`. */
  readonly children?: ReactNode;
}

interface Owned {
  readonly engine: ImageEngine;
  readonly session: ImageSession;
  pending?: ReturnType<typeof setTimeout>;
  dispose(): void;
}

/** Creates what the host didn't pass. Creating an engine starts nothing until its first call. */
function own(props: ImageEditorProviderProps): Owned {
  const engine =
    props.engine ??
    createImageEngine(props.assetsUrl === undefined ? {} : { assetsUrl: props.assetsUrl });
  const processor = props.processor ?? createImageProcessor(engine);
  const session =
    props.session ??
    createImageSession({
      engine,
      processor,
      ...(props.filePolicy ? { filePolicy: props.filePolicy } : {}),
      ...(props.onEvent ? { onEvent: props.onEvent } : {}),
    });
  return {
    engine,
    session,
    dispose() {
      // Only what the provider created itself is destroyed.
      if (!props.session) void session.destroy();
      if (!props.processor) void processor.destroy();
      if (!props.engine) void engine.destroy();
    },
  };
}

/**
 * Provides an image session, its engine, the stage's view and the SDK's
 * text to the components below it: `ImageStage`, `ImageToolbar` and the
 * hooks (docs/adr/0007). `ImageEditor` renders one itself.
 *
 * @example
 * ```tsx
 * <ImageEditorProvider locale="de" messages={{ "editor.empty": "Öffnen Sie ein Bild." }}>
 *   <ImageToolbar />
 *   <ImageStage />
 * </ImageEditorProvider>
 * ```
 *
 * @public
 */
export function ImageEditorProvider(props: ImageEditorProviderProps): ReactNode {
  const { messages: overrides, locale = "en", children } = props;
  const [owned] = useState(() => own(props));
  const [view] = useState(createViewStore);
  const [editor] = useState(createEditorStore);
  const [opener] = useState(() => createOpener(owned.session));

  useEffect(() => {
    // React's development mode unmounts and mounts again at once, so the
    // disposal waits a tick, and a remount cancels it.
    if (owned.pending !== undefined) clearTimeout(owned.pending);
    return () => {
      owned.pending = setTimeout(() => owned.dispose(), 0);
    };
  }, [owned]);

  const messages = useMemo(
    () =>
      createMessages(imageMessages, {
        locale,
        // Overrides are typed for hosts that write them as literals; at
        // runtime createMessages validates them and ignores what doesn't fit.
        ...(overrides ? { overrides: overrides as never } : {}),
      }),
    [locale, overrides],
  );
  const value = useMemo(
    () => ({ session: owned.session, engine: owned.engine, messages, view, editor, opener }),
    [owned, messages, view, editor, opener],
  );
  return <ImageContext.Provider value={value}>{children}</ImageContext.Provider>;
}
