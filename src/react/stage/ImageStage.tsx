import { Button, FileDropZone, ProgressBar, Spinner } from "@hussmartinez/ui/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createImageRenderer } from "../../adapters/image-renderer.js";
import { compositionSize } from "../../core/model/geometry.js";
import { createPlan, type ImagePlan } from "../../core/model/plan.js";
import type { ImageRenderer } from "../../core/ports/image-renderer.js";
import { CropFrame } from "../crop/CropFrame.js";
import { DrawOverlay } from "../draw/DrawOverlay.js";
import {
  useImageDocument,
  useImageEditorState,
  useImageInternals,
  useImageView,
} from "../hooks.js";
import { LayersOverlay } from "../layers/LayersOverlay.js";
import { RedactOverlay } from "../redact/RedactOverlay.js";
import { StageNotices } from "./StageNotices.js";

/**
 * Props of {@link ImageStage}.
 *
 * @public
 */
export interface ImageStageProps {
  /** Extra classes on the stage. */
  readonly className?: string;
}

/**
 * The margin the image keeps inside the stage while cropping: half of the
 * largest handle target, 44 pixels on touch, so no handle is cut off where
 * the image meets the stage's edge (docs/adr/0007).
 */
const CROP_INSET = 24;

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
 * The frame of an animated plan the stage shows: the one asked for, or the
 * last when frames were removed under it (docs/adr/0011).
 *
 * @internal
 */
export function shownFrame(plan: ImagePlan, frame: number): number {
  const count = plan.animation?.frames.length ?? 1;
  return Math.min(Math.max(0, frame), count - 1);
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
  const { engine, messages, opener, inserter } = useImageInternals();
  const snapshot = useImageDocument();
  const [view] = useImageView();
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const size = useStageSize(frame);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<
    { renderer: ImageRenderer; attached: Promise<void>; failed: boolean } | undefined
  >(undefined);
  const [editorState] = useImageEditorState();
  const { source, status } = snapshot;
  const cropping = editorState.tool === "crop";
  const redacting = editorState.tool === "redact";
  // Room around the image for the handles of a frame at its edge.
  const layering = editorState.tool === "layers";
  const drawing = editorState.tool === "draw";
  // The same room while drawing, so the image doesn't move between it and the layers.
  const inset = cropping || redacting || layering || drawing ? CROP_INSET : 0;
  // What the stage shows: while cropping, the whole image under the plan's
  // other edits; during a gesture, its transient plan; otherwise the plan.
  // With no document yet, an animation being opened shows its first frame
  // while the rest are checked, as a still (docs/adr/0011).
  const opening = snapshot.plan === null ? snapshot.openingFrame : null;
  const plan = useMemo(() => {
    const committed = snapshot.plan;
    if (!committed) return opening ? createPlan(opening.source) : null;
    if (cropping) return { ...committed, base: { ...committed.base, crop: null } };
    return editorState.preview ?? committed;
  }, [snapshot.plan, cropping, editorState.preview, opening]);

  // The canvas and its renderer live and die with this effect.
  useEffect(() => {
    if (!frame) return;
    const canvas = document.createElement("canvas");
    canvas.className = "hm-image-stage-canvas";
    canvas.setAttribute("role", "img");
    frame.append(canvas);
    canvasRef.current = canvas;
    const renderer = createImageRenderer(engine);
    const current = { renderer, attached: renderer.attach(canvas), failed: false };
    current.attached.catch(() => {
      current.failed = true;
    });
    rendererRef.current = current;
    return () => {
      rendererRef.current = undefined;
      canvasRef.current = null;
      void renderer.destroy();
      canvas.remove();
    };
  }, [engine, frame]);

  /** Whether the canvas shows the first frame of a file still opening. */
  const showingOpening = snapshot.plan === null && opening !== null;
  // Its name says what it shows, and changes with the document, not each render.
  const composition = plan && source ? compositionSize(plan, source) : (opening ?? undefined);
  const shownWidth = composition?.width;
  const shownHeight = composition?.height;
  useEffect(() => {
    // The canvas appears in the commit after the frame does, so this runs
    // again then.
    const canvas = canvasRef.current;
    if (!frame || !canvas) return;
    canvas.hidden = shownWidth === undefined || shownHeight === undefined;
    if (shownWidth !== undefined && shownHeight !== undefined) {
      canvas.setAttribute(
        "aria-label",
        messages.t(showingOpening ? "editor.openingPreview" : "editor.preview", {
          width: shownWidth,
          height: shownHeight,
        }),
      );
    } else {
      canvas.removeAttribute("aria-label");
    }
  }, [shownWidth, shownHeight, messages, frame, showingOpening]);

  // Every change of plan, view or size renders; the renderer keeps the latest.
  useEffect(() => {
    const current = rendererRef.current;
    if (!current || !plan || !size || size.width < 1 || size.height < 1) return;
    const { renderer } = current;
    // A later explicit open may succeed after a startup/handshake failure.
    // No canvas was transferred before setup succeeded. Terminal engines
    // reject here and their boundary removes this stage; nothing restarts.
    if (current.failed && canvasRef.current) {
      current.failed = false;
      current.attached = renderer.attach(canvasRef.current);
      current.attached.catch(() => {
        current.failed = true;
      });
    }
    void current.attached
      .then(() =>
        renderer.render(plan, {
          width: size.width,
          height: size.height,
          pixelRatio: size.pixelRatio,
          zoom: view.zoom,
          pan: view.pan,
          inset,
          // An animation's frame being shown, kept within its frames as they change.
          ...(plan.animation === null
            ? {}
            : { frame: shownFrame(plan, editorState.playback.frame) }),
        }),
      )
      .catch(() => {
        // A render that fails leaves the previous frame; the session's state is unaffected.
      });
  }, [plan, view, size, inset, editorState.playback.frame]);

  const className = ["hm-image-stage", props.className].filter(Boolean).join(" ");
  const empty = status === "empty" && !snapshot.opening;
  // The document's failure, or what an editor's own action failed with.
  const failure = snapshot.error ?? editorState.error;
  const error = failure ? (
    <p className="hm-image-stage-error" role="alert">
      {messages.error(failure)}
    </p>
  ) : null;
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
              inset,
            }}
          />
        </div>
      ) : null}
      {redacting && plan && source && size ? (
        <div className="hm-image-stage-overlay">
          <RedactOverlay
            plan={plan}
            source={source}
            view={{
              width: size.width,
              height: size.height,
              pixelRatio: 1,
              zoom: view.zoom,
              pan: view.pan,
              inset,
            }}
          />
        </div>
      ) : null}
      {layering && plan && source && size ? (
        <div className="hm-image-stage-overlay">
          <LayersOverlay
            plan={plan}
            source={source}
            view={{
              width: size.width,
              height: size.height,
              pixelRatio: 1,
              zoom: view.zoom,
              pan: view.pan,
              inset,
            }}
          />
        </div>
      ) : null}
      {drawing && plan && source && size ? (
        <div className="hm-image-stage-overlay">
          <DrawOverlay
            plan={plan}
            source={source}
            view={{
              width: size.width,
              height: size.height,
              pixelRatio: 1,
              zoom: view.zoom,
              pan: view.pan,
              inset,
            }}
          />
        </div>
      ) : null}
      {empty ? (
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
          {/* With no image, the failure sits in the drop zone, by the button that retries. */}
          {error}
        </FileDropZone>
      ) : null}
      {snapshot.opening || snapshot.inserting ? (
        <div
          className={
            showingOpening
              ? "hm-image-stage-opening hm-image-stage-opening--over-image"
              : "hm-image-stage-opening"
          }
        >
          {snapshot.opening && snapshot.progress ? (
            // An animation's frames are checked one by one (docs/adr/0011):
            // how far that's got, in words, where the spinner would be.
            <>
              <ProgressBar
                label={messages.t("editor.opening")}
                value={snapshot.progress.done}
                max={snapshot.progress.total}
                valueText={messages.t("editor.checkingFrames", snapshot.progress)}
              />
              <span aria-hidden="true">
                {messages.t("editor.checkingFrames", snapshot.progress)}
              </span>
            </>
          ) : (
            <Spinner label={messages.t(snapshot.opening ? "editor.opening" : "editor.inserting")} />
          )}
          <Button
            variant="secondary"
            onClick={() => (snapshot.opening ? opener.cancel() : inserter.cancel())}
          >
            {messages.t("editor.cancel")}
          </Button>
        </div>
      ) : null}
      {/* Over an image, the notices and a failure stack at the stage's foot. */}
      {empty ? null : (
        <div className="hm-image-stage-foot">
          <StageNotices />
          {error}
        </div>
      )}
    </div>
  );
}
