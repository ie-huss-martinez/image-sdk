import { Button, FileDropZone, Spinner } from "@hussmartinez/ui/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createImageRenderer } from "../../adapters/image-renderer.js";
import { compositionSize } from "../../core/model/geometry.js";
import type { ImageRenderer } from "../../core/ports/image-renderer.js";
import { CropFrame } from "../crop/CropFrame.js";
import {
  useImageDocument,
  useImageEditorState,
  useImageInternals,
  useImageView,
} from "../hooks.js";

/**
 * Props of {@link ImageStage}.
 *
 * @public
 */
export interface ImageStageProps {
  /** Extra classes on the stage. */
  readonly className?: string;
}

/** The stage's size in CSS pixels, and the device pixel ratio. */
interface StageSize {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

/** Follows an element's size and the device pixel ratio. */
function useStageSize(element: HTMLElement | null): StageSize | undefined {
  const [size, setSize] = useState<StageSize>();
  useEffect(() => {
    if (!element) return;
    let ratioQuery: MediaQueryList | undefined;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      const pixelRatio = globalThis.devicePixelRatio || 1;
      setSize((current) =>
        current?.width === width && current.height === height && current.pixelRatio === pixelRatio
          ? current
          : { width, height, pixelRatio },
      );
    };
    // A change of devicePixelRatio, such as moving to another screen, ends the
    // current query's match: listen again for the new ratio.
    const watchRatio = () => {
      ratioQuery?.removeEventListener("change", onRatio);
      ratioQuery = globalThis.matchMedia?.(`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`);
      ratioQuery?.addEventListener("change", onRatio);
    };
    const onRatio = () => {
      measure();
      watchRatio();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    watchRatio();
    return () => {
      observer.disconnect();
      ratioQuery?.removeEventListener("change", onRatio);
    };
  }, [element]);
  return size;
}

/**
 * The editor's stage (docs/adr/0007): the preview canvas, drawn by the
 * engine's render worker, with the designed states around it. With no image
 * it's a drop zone with a button to choose one; while an image opens, a
 * spinner with a cancel button over the current one; after a failure, the
 * catalogue's text for it.
 *
 * The canvas is `role="img"`, named with the image's size, and isn't in the
 * tab order. It's created in an effect, never rendered by React: a canvas
 * transferred to a worker can't be transferred again, and StrictMode mounts
 * effects twice.
 *
 * @public
 */
export function ImageStage(props: ImageStageProps): ReactNode {
  const { engine, messages, opener } = useImageInternals();
  const snapshot = useImageDocument();
  const [view] = useImageView();
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const size = useStageSize(frame);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<{ renderer: ImageRenderer; attached: Promise<void> } | undefined>(
    undefined,
  );
  const [editorState] = useImageEditorState();
  const { source, status } = snapshot;
  const cropping = editorState.tool === "crop";
  // What the stage shows: while cropping, the whole image under the plan's
  // other edits; during a gesture, its transient plan; otherwise the plan.
  const plan = useMemo(() => {
    const committed = snapshot.plan;
    if (!committed) return null;
    if (cropping) return { ...committed, base: { ...committed.base, crop: null } };
    return editorState.preview ?? committed;
  }, [snapshot.plan, cropping, editorState.preview]);

  // The canvas and its renderer live and die with this effect.
  useEffect(() => {
    if (!frame) return;
    const canvas = document.createElement("canvas");
    canvas.className = "hm-image-stage-canvas";
    canvas.setAttribute("role", "img");
    frame.append(canvas);
    canvasRef.current = canvas;
    const renderer = createImageRenderer(engine);
    const attached = renderer.attach(canvas);
    // A failure to attach shows as an unrendered stage; renders report it.
    attached.catch(() => {});
    rendererRef.current = { renderer, attached };
    return () => {
      rendererRef.current = undefined;
      canvasRef.current = null;
      void renderer.destroy();
      canvas.remove();
    };
  }, [engine, frame]);

  // Its name says what it shows, and changes with the document, not each render.
  const composition = plan && source ? compositionSize(plan, source) : undefined;
  const shownWidth = composition?.width;
  const shownHeight = composition?.height;
  useEffect(() => {
    // The canvas appears in the commit after the frame does, so this runs
    // again then.
    const canvas = frame ? canvasRef.current : null;
    if (!canvas) return;
    canvas.hidden = shownWidth === undefined || shownHeight === undefined;
    if (shownWidth !== undefined && shownHeight !== undefined) {
      canvas.setAttribute(
        "aria-label",
        messages.t("editor.preview", { width: shownWidth, height: shownHeight }),
      );
    } else {
      canvas.removeAttribute("aria-label");
    }
  }, [shownWidth, shownHeight, messages, frame]);

  // Every change of plan, view or size renders; the renderer keeps the latest.
  useEffect(() => {
    const current = rendererRef.current;
    if (!current || !plan || !size || size.width < 1 || size.height < 1) return;
    const { renderer, attached } = current;
    void attached
      .then(() =>
        renderer.render(plan, {
          width: size.width,
          height: size.height,
          pixelRatio: size.pixelRatio,
          zoom: view.zoom,
          pan: view.pan,
        }),
      )
      .catch(() => {
        // A render that fails leaves the previous frame; the session's state is unaffected.
      });
  }, [plan, view, size]);

  const className = ["hm-image-stage", props.className].filter(Boolean).join(" ");
  return (
    <div className={className} data-status={status}>
      <div className="hm-image-stage-frame" ref={setFrame} />
      {cropping && snapshot.plan && source && size ? (
        <div className="hm-image-stage-overlay">
          <CropFrame
            plan={snapshot.plan}
            source={source}
            view={{
              width: size.width,
              height: size.height,
              pixelRatio: 1,
              zoom: view.zoom,
              pan: view.pan,
            }}
          />
        </div>
      ) : null}
      {status === "empty" && !snapshot.opening ? (
        <FileDropZone
          className="hm-image-stage-drop"
          accept="image/*"
          onFiles={(files) => {
            const [file] = files;
            if (file) void opener.open(file);
          }}
          buttonLabel={messages.t("editor.choose")}
          hint={messages.t("editor.dropHint")}
        >
          <p className="hm-image-stage-empty">{messages.t("editor.empty")}</p>
        </FileDropZone>
      ) : null}
      {snapshot.opening ? (
        <div className="hm-image-stage-opening">
          <Spinner label={messages.t("editor.opening")} />
          <Button variant="secondary" onClick={() => opener.cancel()}>
            {messages.t("editor.cancel")}
          </Button>
        </div>
      ) : null}
      {snapshot.error ? (
        <p className="hm-image-stage-error" role="alert">
          {messages.error(snapshot.error)}
        </p>
      ) : null}
    </div>
  );
}
