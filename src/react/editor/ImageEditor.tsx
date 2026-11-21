import { createShortcutRegistry, createToolRegistry } from "@hussmartinez/sdk-core";
import { AnnouncerProvider, useAnnounce, useLatest, usePlatform } from "@hussmartinez/ui/react";
import {
  type ForwardedRef,
  forwardRef,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useInsertionEffect,
  useMemo,
  useRef,
} from "react";
import { engineInternals } from "../../adapters/image-engine.js";
import type { ImageSessionEvent } from "../../core/session/session.js";
import { NO_TOOL, PAUSED } from "../../features/editor-state.js";
import type { ImageToolContext } from "../../features/tool-types.js";
import { DEFAULT_TOOLBAR, imageTools } from "../../features/tools.js";
import { EngineBoundary } from "../EngineBoundary.js";
import { ImageExportDialog } from "../export/ExportDialog.js";
import { useImageDocument, useImageEditorState, useImageInternals } from "../hooks.js";
import { ImageProvider } from "../ImageEditorProvider.js";
import { ImageInspector } from "../panels/Inspector.js";
import { ImageStage } from "../stage/ImageStage.js";
import { AnimationBar } from "../timeline/AnimationBar.js";
import { ImageToolbar } from "../toolbar/ImageToolbar.js";
import { imageIcons } from "../toolbar/icons.js";
import type { ImageEditorHandle, ImageEditorProps } from "./types.js";

const join = (...names: (string | undefined | false)[]) => names.filter(Boolean).join(" ");

interface BodyProps
  extends Pick<
    ImageEditorProps,
    | "initialFile"
    | "plan"
    | "onChange"
    | "tools"
    | "toolbar"
    | "icons"
    | "className"
    | "classNames"
    | "unstyled"
    | "onExport"
    | "features"
    | "theme"
  > {
  readonly handle: ForwardedRef<ImageEditorHandle>;
  /** Listens to the session's events until the returned function is called. */
  readonly listen: (listener: (event: ImageSessionEvent) => void) => () => void;
}

function ImageEditorBody(props: BodyProps): ReactNode {
  const { initialFile, onChange, classNames = {}, unstyled = false, handle, listen } = props;
  const { engine, session, messages, view, editor, opener, inserter } = useImageInternals();
  const snapshot = useImageDocument();
  const announce = useAnnounce();
  const root = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const layerInput = useRef<HTMLInputElement>(null);
  // The host's latest onChange, taken as each render commits, never during it.
  const latestOnChange = useLatest(onChange);

  // Export off takes its tool out of the registry, so no button or key runs it.
  const exportOn = props.features?.export !== false;
  const registry = useMemo(() => {
    const wanted = (id: string) =>
      (!props.tools || props.tools.includes(id)) && (exportOn || id !== "image.export");
    const tools = props.tools ?? imageTools.map((tool) => tool.id);
    return createToolRegistry(imageTools, {
      tools: tools.filter(wanted),
      toolbar: (props.toolbar ?? DEFAULT_TOOLBAR)
        .map((group) => group.filter(wanted))
        .filter((group) => group.length > 0),
    });
  }, [props.tools, props.toolbar, exportOn]);
  // "other" on the server and during hydration, then the device's own keys.
  const platform = usePlatform();
  const shortcuts = useMemo(
    () => createShortcutRegistry({ platform, tools: registry.tools }),
    [platform, registry],
  );
  const context: ImageToolContext = useMemo(
    () => ({
      session,
      view,
      editor,
      chooseFile: () => input.current?.click(),
      chooseLayerImage: () => layerInput.current?.click(),
    }),
    [session, view, editor],
  );
  const icons = useMemo(() => ({ ...imageIcons, ...props.icons }), [props.icons]);

  useImperativeHandle(
    handle,
    () => ({
      session,
      open: async (file) => {
        engineInternals(engine)?.check();
        await opener.open(file);
      },
      insertImage: async (file) => {
        engineInternals(engine)?.check();
        await inserter.insert(file);
      },
      execute: (commands) => session.execute(commands),
      export: (format) => session.export(format),
      undo: () => {
        session.undo();
      },
      redo: () => {
        session.redo();
      },
    }),
    [engine, session, opener, inserter],
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
  }, [session, latestOnChange]);

  // Opens, undos and redos reach screen readers, politely.
  useEffect(
    () =>
      listen((event) => {
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
      }),
    [announce, listen, messages, session],
  );

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

  // A host's plan is applied when it changes: one undoable step of the
  // commands that reach it. A plan for another image waits for that image.
  const hostPlan = props.plan;
  const openSource = snapshot.plan?.base.source;
  useEffect(() => {
    if (!hostPlan || openSource !== hostPlan.base.source) return;
    try {
      session.applyPlan(hostPlan);
    } catch {
      // In the snapshot: the stage shows it.
    }
  }, [hostPlan, session, openSource]);

  // Cropping and the export dialog end when another image opens, and an
  // animation starts again from its first frame, paused.
  const sourceId = snapshot.source?.id;
  useEffect(() => {
    if (sourceId === undefined) return;
    editor.set((state) =>
      state.tool === null &&
      state.dialog === null &&
      state.error === null &&
      state.playback === PAUSED
        ? state
        : {
            ...state,
            ...NO_TOOL,
            preview: null,
            dialog: null,
            error: null,
            playback: PAUSED,
          },
    );
  }, [editor, sourceId]);

  // Focus returns to where it was when a tool took the stage: its button, or
  // whatever had focus when its shortcut was pressed (docs/adr/0007).
  const [{ tool }] = useImageEditorState();
  const returnTo = useRef<HTMLElement | null>(null);
  const previousTool = useRef(tool);
  useEffect(
    () =>
      editor.subscribe(() => {
        const next = editor.getSnapshot().tool;
        if (next !== null && previousTool.current !== next) {
          const active = document.activeElement;
          returnTo.current =
            active instanceof HTMLElement && root.current?.contains(active) ? active : null;
        }
      }),
    [editor],
  );
  useEffect(() => {
    if (previousTool.current === tool) return;
    const was = previousTool.current;
    previousTool.current = tool;
    if (tool === "redact") {
      // Redacting starts on the button that adds an area without dragging;
      // cropping starts on its frame, which focuses itself.
      root.current?.querySelector<HTMLElement>(".hm-image-redact-add")?.focus();
      return;
    }
    // The layers' panel takes focus itself, when its tool asks: adding a
    // shape or an image leaves focus where it was.
    if (tool === "layers") return;
    if (was === null || tool !== null) return;
    const target = returnTo.current?.isConnected
      ? returnTo.current
      : root.current?.querySelector<HTMLElement>(`[data-tool="image.${was}"]`);
    target?.focus();
  }, [tool]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (engineInternals(engine)?.getSnapshot()) return;
    // The root bounds the search for a modal dialog: keys from one inside the
    // editor, such as export's, stay its own, while a host's dialog holding
    // the whole editor doesn't stop its shortcuts (sdk-core 0.4.2).
    const id = shortcuts.match(event.nativeEvent, { root: event.currentTarget });
    const tool = id ? registry.get(id) : undefined;
    if (!tool) return;
    const state = { snapshot: session.getSnapshot(), editor: editor.getSnapshot() };
    if (!(tool.isEnabled?.(state) ?? true)) return;
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
      // ui's colour mode for the editor alone; unset, it inherits the page's.
      {...(props.theme ? { "data-hm-theme": props.theme } : {})}
    >
      <EngineBoundary>
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
        <input
          ref={layerInput}
          type="file"
          accept="image/*"
          hidden
          tabIndex={-1}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void inserter.insert(file);
          }}
        />
        <div className="hm-image-editor-layout">
          <ImageToolbar
            registry={registry}
            shortcuts={shortcuts}
            context={context}
            icons={icons}
            className={join("hm-image-editor-toolbar", classNames.toolbar)}
          />
          <ImageStage className={join("hm-image-editor-stage", classNames.stage)} />
          <AnimationBar className="hm-image-editor-timeline" />
          <div className={join("hm-image-editor-inspector", classNames.inspector)}>
            <ImageInspector {...(props.features ? { features: props.features } : {})} />
          </div>
        </div>
        {exportOn ? (
          <ImageExportDialog {...(props.onExport ? { onExport: props.onExport } : {})} />
        ) : null}
      </EngineBoundary>
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
export const ImageEditor = /* @__PURE__ */ forwardRef(function ImageEditor(
  props: ImageEditorProps,
  ref: ForwardedRef<ImageEditorHandle>,
): ReactNode {
  const {
    initialFile,
    plan,
    onChange,
    tools,
    toolbar,
    icons,
    className,
    classNames,
    unstyled,
    onEvent,
    onExport,
    features,
    theme,
    ...provider
  } = props;
  // The editor listens to the session's events for its announcements, and
  // passes them on to the host's handler.
  const events = useRef<((event: ImageSessionEvent) => void) | undefined>(undefined);
  // Set when the render commits, never during it, as the provider does.
  const latestOnEvent = useRef(onEvent);
  useInsertionEffect(() => {
    latestOnEvent.current = onEvent;
  }, [onEvent]);
  const [onSessionEvent, listen] = useMemo(
    () =>
      [
        (event: ImageSessionEvent) => {
          events.current?.(event);
          latestOnEvent.current?.(event);
        },
        (listener: (event: ImageSessionEvent) => void) => {
          events.current = listener;
          return () => {
            if (events.current === listener) events.current = undefined;
          };
        },
      ] as const,
    [],
  );
  return (
    <ImageProvider {...provider} onEvent={onSessionEvent} boundary={false}>
      <AnnouncerProvider>
        <ImageEditorBody
          handle={ref}
          listen={listen}
          {...(initialFile ? { initialFile } : {})}
          {...(onChange ? { onChange } : {})}
          {...(plan ? { plan } : {})}
          {...(tools ? { tools } : {})}
          {...(toolbar ? { toolbar } : {})}
          {...(icons ? { icons } : {})}
          {...(className ? { className } : {})}
          {...(classNames ? { classNames } : {})}
          {...(unstyled === undefined ? {} : { unstyled })}
          {...(onExport ? { onExport } : {})}
          {...(features ? { features } : {})}
          {...(theme ? { theme } : {})}
        />
      </AnnouncerProvider>
    </ImageProvider>
  );
});
