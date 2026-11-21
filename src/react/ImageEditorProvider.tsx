import { createMessages, type MessageOverrides } from "@hussmartinez/sdk-core";
import { UiMessagesProvider } from "@hussmartinez/ui/react";
import { type ReactNode, useEffect, useInsertionEffect, useMemo, useRef, useState } from "react";
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
import type { ImageEditorMessageCatalogue } from "../messages/editor-catalogue.js";
import { createInserter, createOpener, ImageContext } from "./context.js";
import { EngineBoundary } from "./EngineBoundary.js";
import { imageEditorMessages } from "./editor-messages.js";
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
  /**
   * Whether an animated file opens as an animation, for a session the
   * provider creates (docs/adr/0011). `true` when omitted; with `false`,
   * every file opens as a still, an animated one as its first frame.
   */
  readonly animations?: boolean;
  /** Anonymous usage events from a session the provider creates. */
  readonly onEvent?: (event: ImageSessionEvent) => void;
  /** Text overrides, typed against the English catalogue (ADR 0019). */
  readonly messages?: MessageOverrides<ImageEditorMessageCatalogue>;
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
      ...(props.animations === undefined ? {} : { animations: props.animations }),
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
  return <ImageProvider {...props} />;
}

/** The full editor keeps its labelled/theme root around its own boundary. */
export function ImageProvider(
  props: ImageEditorProviderProps & { readonly boundary?: boolean },
): ReactNode {
  const { messages: overrides, locale = "en", children } = props;
  const [owned] = useState(() => own(props));
  const [view] = useState(createViewStore);
  const [editor] = useState(createEditorStore);
  const [opener] = useState(() => createOpener(owned.session));
  const [inserter] = useState(() => createInserter(owned.session, editor));
  // The latest committed handler, so events reach it however often the host
  // passes a new one. Set when the render commits, never during it: a render
  // React discards must not redirect events (useInsertionEffect runs before
  // any other effect, and isn't warned about when rendering on a server).
  const onEvent = useRef(props.onEvent);
  useInsertionEffect(() => {
    onEvent.current = props.onEvent;
  }, [props.onEvent]);
  const [emit] = useState(() => (event: ImageSessionEvent) => {
    try {
      onEvent.current?.(event);
    } catch {
      // A host's handler that throws doesn't break the editor, as with the session's events.
    }
  });

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
      createMessages(imageEditorMessages, {
        locale,
        ...(overrides ? { overrides } : {}),
      }),
    [locale, overrides],
  );
  const value = useMemo(
    () => ({
      session: owned.session,
      engine: owned.engine,
      messages,
      view,
      editor,
      opener,
      inserter,
      emit,
    }),
    [owned, messages, view, editor, opener, inserter, emit],
  );
  // The same object gives ui's components their text, so a host's
  // `messages` reach the drop zone and dialogs too (sdk-core ADR 0046).
  return (
    <ImageContext.Provider value={value}>
      <UiMessagesProvider messages={messages}>
        {props.boundary === false ? children : <EngineBoundary>{children}</EngineBoundary>}
      </UiMessagesProvider>
    </ImageContext.Provider>
  );
}
