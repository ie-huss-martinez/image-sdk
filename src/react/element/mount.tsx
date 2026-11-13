import type { MessageOverrides } from "@hussmartinez/sdk-core";
import type { EditorElementContext, MountedEditor } from "@hussmartinez/sdk-core/element";
import { type ReactNode, type RefCallback, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { ImageError } from "../../core/errors/image-error.js";
import type { ImageFilePolicyOverrides } from "../../core/errors/image-limits.js";
import type { ImagePlan } from "../../core/model/plan.js";
import type { ImageEngine } from "../../core/ports/image-engine.js";
import type { ImageProcessor } from "../../core/ports/image-processor.js";
import type { ImageMessageCatalogue } from "../../messages/en.js";
import { ImageEditor } from "../editor/ImageEditor.js";
import type { ImageEditorHandle } from "../editor/types.js";
import { ExportListenerContext, type ImageExportReport } from "../export/export-listener.js";

/**
 * The `<hm-image-editor>` element's props: its attributes, `theme`, `locale`
 * and `tools`, and its properties (docs/adr/0007). They're writable, since a
 * host sets them on the element, such as `editor.file = file`.
 *
 * @public
 */
export interface ImageEditorElementProps {
  /** `light`, `dark` or `system`: ui's colour mode, on the element. Inherited when unset. */
  theme?: string;
  /** The locale for numbers and plurals. Defaults to `"en"`. */
  locale?: string;
  /** Which tools are present, by id, in order: the attribute is space-separated. */
  tools?: readonly string[];
  /** An image to open. Setting another opens it, replacing the current one. */
  file?: Blob;
  /** The plan, applied as one undoable step when it changes. */
  plan?: ImagePlan;
  filePolicy?: ImageFilePolicyOverrides;
  /** Where the application serves the package's `dist/assets/` directory. */
  assetsUrl?: string | URL;
  /** Text overrides, typed against the English catalogue. */
  messages?: MessageOverrides<ImageMessageCatalogue>;
  engine?: ImageEngine;
  processor?: ImageProcessor;
}

/**
 * The `<hm-image-editor>` element's methods: the React editor's ref handle.
 * They wait for the editor's first render; `export()` returns the file.
 *
 * @public
 */
export type ImageEditorElementMethods = Pick<
  ImageEditorHandle,
  "open" | "execute" | "export" | "undo" | "redo"
>;

/**
 * The element's events, fired as `hm-image-editor-<name>`. None carries a
 * file name or contents (sdk-core ADR 0012):
 *
 * - `change`: the plan, after each committed edit, open, undo or redo.
 * - `event`: the session's anonymous usage event.
 * - `export`: an {@link ImageExportReport} after the export dialog finishes.
 * - `error`: `{ code, details }` of a failure the editor shows.
 *
 * @public
 */
export type ImageEditorElementEvent = "change" | "event" | "export" | "error";

const MODES = new Set(["light", "dark", "system"]);

interface ElementEditorProps {
  readonly values: Partial<ImageEditorElementProps>;
  readonly setHandle: RefCallback<ImageEditorHandle>;
  readonly handle: { readonly current: ImageEditorHandle | null };
  readonly dispatch: EditorElementContext<ImageEditorElementEvent>["dispatch"];
  readonly report: (report: ImageExportReport) => void;
}

function ElementEditor(props: ElementEditorProps): ReactNode {
  const { values, setHandle, handle, dispatch, report } = props;
  const { file, theme: _theme, ...editorProps } = values;

  // A file opens when it's set, and another replaces it.
  const opened = useRef<Blob | undefined>(undefined);
  useEffect(() => {
    if (!file || file === opened.current) return;
    opened.current = file;
    void handle.current?.open(file);
  }, [file, handle]);

  // A failure the editor shows is an `error` event, once per failure.
  useEffect(() => {
    const session = handle.current?.session;
    if (!session) return;
    let last = session.getSnapshot().error;
    return session.subscribe(() => {
      const error = session.getSnapshot().error;
      if (error && error !== last) {
        dispatch("error", { code: error.code, details: error.details ?? {} });
      }
      last = error;
    });
  }, [handle, dispatch]);

  return (
    <ExportListenerContext.Provider value={report}>
      <ImageEditor
        ref={setHandle}
        {...editorProps}
        onChange={(plan) => dispatch("change", plan)}
        onEvent={(event) => dispatch("event", event)}
      />
    </ExportListenerContext.Provider>
  );
}

/**
 * Renders `<ImageEditor>` into the element's light DOM, for
 * `createEditorElement` (sdk-core ADR 0040). It renders without `flushSync`,
 * since the element may connect during a host's React commit; so `open()`
 * and `export()` wait for the first render, and `execute()`, `undo()` and
 * `redo()` act on the document there is.
 */
export function mountImageEditor(
  host: HTMLElement,
  initial: Partial<ImageEditorElementProps>,
  context: EditorElementContext<ImageEditorElementEvent>,
): MountedEditor<Partial<ImageEditorElementProps>, ImageEditorElementMethods> {
  const root = createRoot(host);
  const handle: { current: ImageEditorHandle | null } = { current: null };
  let resolveReady: (editor: ImageEditorHandle) => void = () => {};
  const ready = new Promise<ImageEditorHandle>((resolve) => {
    resolveReady = resolve;
  });
  const setHandle: RefCallback<ImageEditorHandle> = (editor) => {
    handle.current = editor;
    if (editor) resolveReady(editor);
  };
  const dispatch = context.dispatch;
  const report = (exported: ImageExportReport) => dispatch("export", exported);

  const render = (values: Partial<ImageEditorElementProps>) => {
    // The colour mode is ui's attribute on the element itself, so changing it
    // never re-renders the editor.
    const mode = values.theme;
    if (mode && MODES.has(mode)) host.setAttribute("data-hm-theme", mode);
    else host.removeAttribute("data-hm-theme");
    root.render(
      <ElementEditor
        values={values}
        setHandle={setHandle}
        handle={handle}
        dispatch={dispatch}
        report={report}
      />,
    );
  };
  render(initial);

  const now = (): ImageEditorHandle | null => handle.current;
  return {
    update: render,
    unmount: () => {
      root.unmount();
      host.removeAttribute("data-hm-theme");
    },
    handle: {
      open: async (file) => (await ready).open(file),
      export: async (format) => (await ready).export(format),
      execute: (commands) => {
        const editor = now();
        if (!editor) {
          throw new ImageError("INVALID_COMMAND", "There's nothing to edit before a file is open.");
        }
        editor.execute(commands);
      },
      undo: () => now()?.undo(),
      redo: () => now()?.redo(),
    },
  };
}
