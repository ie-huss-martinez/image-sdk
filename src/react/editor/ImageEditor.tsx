import {
  createMessages,
  createShortcutRegistry,
  createToolRegistry,
  defineMessages,
  type Platform,
  sdkCoreMessages,
} from "@hussmartinez/sdk-core";
import { uiMessages } from "@hussmartinez/ui";
import { AnnouncerProvider, UiMessagesProvider, useAnnounce } from "@hussmartinez/ui/react";
import {
  type ForwardedRef,
  forwardRef,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import type { ImageSessionEvent } from "../../core/session/session.js";
import type { ImageToolContext } from "../../features/tool-types.js";
import { DEFAULT_TOOLBAR, imageTools } from "../../features/tools.js";
import { useImageDocument, useImageInternals } from "../hooks.js";
import { ImageEditorProvider } from "../ImageEditorProvider.js";
import { ImageStage } from "../stage/ImageStage.js";
import { ImageToolbar } from "../toolbar/ImageToolbar.js";
import { imageIcons } from "../toolbar/icons.js";
import type { ImageEditorHandle, ImageEditorProps } from "./types.js";

/** ui's text, for its components' own labels, such as the drop zone's button. */
const UI_CATALOGUE = /* @__PURE__ */ defineMessages({ ...sdkCoreMessages, ...uiMessages });

const join = (...names: (string | undefined | false)[]) => names.filter(Boolean).join(" ");

/** Apple platforms take `Cmd` for the family's `Mod`. */
function platform(): Platform {
  const nav = globalThis.navigator as
    | (Navigator & { userAgentData?: { platform?: string } })
    | undefined;
  const name = nav?.userAgentData?.platform ?? nav?.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(name) ? "apple" : "other";
}

interface BodyProps
  extends Pick<
    ImageEditorProps,
    | "initialFile"
    | "onChange"
    | "tools"
    | "toolbar"
    | "icons"
    | "className"
    | "classNames"
    | "unstyled"
  > {
  readonly handle: ForwardedRef<ImageEditorHandle>;
  readonly events: { current: ((event: ImageSessionEvent) => void) | undefined };
}

function ImageEditorBody(props: BodyProps): ReactNode {
  const { initialFile, onChange, classNames = {}, unstyled = false, handle, events } = props;
  const { session, messages, view, opener } = useImageInternals();
  const snapshot = useImageDocument();
  const announce = useAnnounce();
  const root = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const latestOnChange = useRef(onChange);
  latestOnChange.current = onChange;

  const registry = useMemo(
    () =>
      createToolRegistry(imageTools, {
        ...(props.tools ? { tools: props.tools } : {}),
        toolbar:
          props.toolbar ??
          DEFAULT_TOOLBAR.map((group) =>
            group.filter((id) => !props.tools || props.tools.includes(id)),
          ),
      }),
    [props.tools, props.toolbar],
  );
  const shortcuts = useMemo(
    () => createShortcutRegistry({ platform: platform(), tools: registry.tools }),
    [registry],
  );
  const context: ImageToolContext = useMemo(
    () => ({ session, view, chooseFile: () => input.current?.click() }),
    [session, view],
  );
  const icons = useMemo(() => ({ ...imageIcons, ...props.icons }), [props.icons]);

  useImperativeHandle(
    handle,
    () => ({
      session,
      open: (file) => opener.open(file),
      execute: (commands) => session.execute(commands),
      export: (format) => session.export(format),
      undo: () => {
        session.undo();
      },
      redo: () => {
        session.redo();
      },
    }),
    [session, opener],
  );

  // The host's first image opens on mount; a later one replaces it.
  const initial = useRef(initialFile);
  useEffect(() => {
    if (initial.current) void opener.open(initial.current);
  }, [opener]);

  // Committed changes reach the host, never a gesture's transient plans.
  useEffect(() => {
    let before = session.getSnapshot().plan;
    return session.subscribe(() => {
      const after = session.getSnapshot().plan;
      if (after === before) return;
      before = after;
      if (after) latestOnChange.current?.(after);
    });
  }, [session]);

  // Opens, undos and redos reach screen readers, politely.
  useEffect(() => {
    events.current = (event) => {
      if (event.outcome !== "done") return;
      const action = event.commands[0];
      const name = action ? messages.t(`actions.${action}`) : "";
      if (event.type === "undo") announce(messages.t("editor.undid", { action: name }));
      if (event.type === "redo") announce(messages.t("editor.redid", { action: name }));
      if (event.type === "open") {
        const source = session.getSnapshot().source;
        if (source)
          announce(messages.t("editor.opened", { width: source.width, height: source.height }));
      }
    };
    return () => {
      events.current = undefined;
    };
  }, [announce, events, messages, session]);

  // After an open, focus moves to the first tool it enabled, when focus was
  // in the editor or nowhere; focus elsewhere on the host's page stays.
  const previous = useRef(snapshot.source?.id);
  useEffect(() => {
    const id = snapshot.source?.id;
    if (id === previous.current) return;
    previous.current = id;
    if (!id) return;
    const active = document.activeElement;
    const ours = active === null || active === document.body || root.current?.contains(active);
    if (!ours) return;
    const buttons = root.current?.querySelectorAll<HTMLButtonElement>(
      ".hm-image-editor-toolbar button:not([disabled])",
    );
    const next = [...(buttons ?? [])].find((button) => button.dataset["tool"] !== "image.open");
    next?.focus();
  }, [snapshot.source?.id]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const id = shortcuts.match(event.nativeEvent);
    const tool = id ? registry.get(id) : undefined;
    if (!tool) return;
    if (!(tool.isEnabled?.({ snapshot: session.getSnapshot() }) ?? true)) return;
    event.preventDefault();
    void tool.run(context);
  };

  return (
    // The root takes the editor's shortcuts while focus is inside it, never
    // on window (WCAG 2.1.4, sdk-core ADR 0030). A named section is a region
    // landmark, so the editor is easy to find on a host's page.
    <section
      ref={root}
      className={join(
        "hm-image-editor",
        !unstyled && "hm-image-editor--styled",
        props.className,
        classNames.root,
      )}
      onKeyDown={onKeyDown}
      aria-label={messages.t("editor.label")}
    >
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        tabIndex={-1}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void opener.open(file);
        }}
      />
      <ImageToolbar
        registry={registry}
        shortcuts={shortcuts}
        context={context}
        icons={icons}
        className={join("hm-image-editor-toolbar", classNames.toolbar)}
      />
      <ImageStage className={join("hm-image-editor-stage", classNames.stage)} />
    </section>
  );
}

/**
 * The image editor (docs/adr/0007): a toolbar and a stage over an image
 * session, with the family's shortcuts while focus is inside it. It creates
 * its engine, processor and session unless you pass them, and destroys only
 * what it created. Import `@hussmartinez/ui/styles.css` once, then this
 * package's `styles.css`: ui's stylesheet carries the focus rings and target
 * sizes the editor's accessibility relies on (sdk-core ADR 0036).
 *
 * @example
 * ```tsx
 * <ImageEditor initialFile={file} onChange={(plan) => save(plan)} />
 * ```
 *
 * @public
 */
export const ImageEditor = forwardRef(function ImageEditor(
  props: ImageEditorProps,
  ref: ForwardedRef<ImageEditorHandle>,
): ReactNode {
  const {
    initialFile,
    onChange,
    tools,
    toolbar,
    icons,
    className,
    classNames,
    unstyled,
    onEvent,
    ...provider
  } = props;
  const locale = provider.locale ?? "en";
  const uiText = useMemo(() => createMessages(UI_CATALOGUE, { locale }), [locale]);
  // The editor listens to the session's events for its announcements, and
  // passes them on to the host's handler.
  const events = useRef<((event: ImageSessionEvent) => void) | undefined>(undefined);
  const latestOnEvent = useRef(onEvent);
  latestOnEvent.current = onEvent;
  const [onSessionEvent] = useMemo(
    () => [
      (event: ImageSessionEvent) => {
        events.current?.(event);
        latestOnEvent.current?.(event);
      },
    ],
    [],
  );
  return (
    <ImageEditorProvider {...provider} onEvent={onSessionEvent}>
      <UiMessagesProvider messages={uiText}>
        <AnnouncerProvider>
          <ImageEditorBody
            handle={ref}
            events={events}
            {...(initialFile ? { initialFile } : {})}
            {...(onChange ? { onChange } : {})}
            {...(tools ? { tools } : {})}
            {...(toolbar ? { toolbar } : {})}
            {...(icons ? { icons } : {})}
            {...(className ? { className } : {})}
            {...(classNames ? { classNames } : {})}
            {...(unstyled === undefined ? {} : { unstyled })}
          />
        </AnnouncerProvider>
      </UiMessagesProvider>
    </ImageEditorProvider>
  );
});
