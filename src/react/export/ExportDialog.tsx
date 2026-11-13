import {
  Button,
  Dialog,
  Field,
  NumberField,
  ProgressBar,
  SegmentedControl,
  Slider,
  useAnnounce,
} from "@hussmartinez/ui/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { isImageError } from "../../core/errors/image-error.js";
import { compositionSize, outputSize } from "../../core/model/geometry.js";
import type { ImageOutput, ImagePlan } from "../../core/model/plan.js";
import {
  type ImageKeepableMetadata,
  type ImageMetadataPresence,
  MAX_METADATA_LENGTH,
} from "../../core/model/source.js";
import type { ImageCommand } from "../../core/operations/commands.js";
import type { ImageExportFormat } from "../../core/ports/image-processor.js";
import type { ImageSessionExport, ImageSessionSource } from "../../core/session/session.js";
import {
  useImageDocument,
  useImageEditorState,
  useImageMessages,
  useImageSession,
} from "../hooks.js";

/**
 * Props of {@link ImageExportDialog}.
 *
 * @public
 */
export interface ImageExportDialogProps {
  /**
   * Takes the exported file instead of the dialog's download button: the
   * dialog closes once it's called.
   */
  readonly onExport?: (blob: Blob, details: ImageSessionExport) => void;
  /** The downloaded file's name, without its extension. Defaults to `image`. */
  readonly fileName?: string;
  /** Extra classes on the dialog. */
  readonly className?: string;
}

type FormatType = ImageExportFormat["type"];

/** The dialog's choices, until Export applies them to the plan. */
interface Draft {
  readonly format: FormatType;
  /** For JPEG and WebP, 1 to 100. */
  readonly quality: number;
  readonly output: ImageOutput;
  readonly metadata: ImageKeepableMetadata;
}

type Phase =
  | { readonly kind: "choose" }
  | { readonly kind: "exporting"; readonly progress: number }
  | { readonly kind: "done"; readonly result: ImageSessionExport; readonly format: FormatType };

const FORMATS: readonly FormatType[] = ["png", "jpeg", "webp"];
const EXTENSIONS: Readonly<Record<FormatType, string>> = { png: "png", jpeg: "jpg", webp: "webp" };
const FIELDS: readonly (keyof ImageKeepableMetadata)[] = [
  "title",
  "description",
  "artist",
  "copyright",
];
const KINDS: readonly (keyof ImageMetadataPresence)[] = [
  "location",
  "camera",
  "timestamps",
  "thumbnail",
  "colourProfile",
  "other",
];
const DEFAULT_QUALITY = 92;

/** The choices a dialog opens with: the plan's size and fields, in the source's format if it can be written. */
function initialDraft(plan: ImagePlan, source: ImageSessionSource): Draft {
  const format = (FORMATS as readonly string[]).includes(source.format)
    ? (source.format as FormatType)
    : "png";
  return { format, quality: DEFAULT_QUALITY, output: plan.output, metadata: plan.metadata };
}

const sameOutput = (a: ImageOutput, b: ImageOutput) =>
  a.kind === "scale" && b.kind === "scale"
    ? a.scale === b.scale
    : a.kind === "fit" && b.kind === "fit" && a.width === b.width && a.height === b.height;

/** The commands that bring the plan's size and fields to the dialog's choices. */
function changes(plan: ImagePlan, draft: Draft): ImageCommand[] {
  const commands: ImageCommand[] = [];
  if (!sameOutput(plan.output, draft.output)) {
    commands.push({ type: "image.setOutput", output: draft.output });
  }
  for (const field of FIELDS) {
    if (plan.metadata[field] !== draft.metadata[field]) {
      commands.push({ type: "image.setMetadata", field, value: draft.metadata[field] });
    }
  }
  return commands;
}

const formatOf = (draft: Draft): ImageExportFormat =>
  draft.format === "png" ? { type: "png" } : { type: draft.format, quality: draft.quality / 100 };

/**
 * The export dialog (docs/adr/0007). Export is irreversible, so it shows a
 * summary before anything is written: the output's size and format, the
 * metadata the source carried that the file won't, and the fields the user
 * chose to keep. Then a progress bar that can stop the export, and a
 * download button, which gets focus, with the file's size.
 *
 * It opens when the editor state's `dialog` is `export`, as the export tool
 * sets it. On Export, the chosen size and fields become one undoable step
 * of the plan, so the plan records what was exported. A format the browser
 * can't encode shows the catalogue's text, and keeps the choices.
 *
 * @public
 */
export function ImageExportDialog(props: ImageExportDialogProps): ReactNode {
  const { onExport, fileName = "image" } = props;
  const session = useImageSession();
  const { plan, source } = useImageDocument();
  const [editor, editorStore] = useImageEditorState();
  const messages = useImageMessages();
  const announce = useAnnounce();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "choose" });
  const [error, setError] = useState<unknown>(null);
  const controller = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);
  const downloadButton = useRef<HTMLButtonElement>(null);

  const open = editor.dialog === "export" && plan !== null && source !== null;
  const current = draft ?? (plan && source ? initialDraft(plan, source) : null);

  const revoke = () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  };
  // A download's URL lives until the next one, the dialog closes, or this unmounts.
  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  // The download button takes focus when the file is ready.
  const done = phase.kind === "done";
  useEffect(() => {
    if (done) downloadButton.current?.focus();
  }, [done]);

  const close = () => {
    controller.current?.abort();
    controller.current = null;
    revoke();
    setDraft(null);
    setPhase({ kind: "choose" });
    setError(null);
    editorStore.set((state) => (state.dialog === null ? state : { ...state, dialog: null }));
  };

  if (!plan || !source || !current) {
    return null;
  }

  const update = (patch: Partial<Draft>) => setDraft({ ...current, ...patch });
  const formatName = (format: FormatType) => messages.t(`export.formats.${format}`);

  const run = async () => {
    setError(null);
    try {
      const commands = changes(plan, current);
      if (commands.length > 0) session.execute(commands);
    } catch (reason) {
      setError(reason);
      return;
    }
    const running = new AbortController();
    controller.current = running;
    setPhase({ kind: "exporting", progress: 0 });
    try {
      const result = await session.export(formatOf(current), {
        signal: running.signal,
        onProgress: (progress) =>
          setPhase((now) => (now.kind === "exporting" ? { kind: "exporting", progress } : now)),
      });
      if (running.signal.aborted) return;
      controller.current = null;
      announce(
        messages.t("export.done", { format: formatName(current.format), size: result.blob.size }),
      );
      if (onExport) {
        onExport(result.blob, result);
        close();
        return;
      }
      setPhase({ kind: "done", result, format: current.format });
    } catch (reason) {
      if (controller.current === running) controller.current = null;
      setPhase({ kind: "choose" });
      if (isImageError(reason) && reason.code === "ABORTED") {
        announce(messages.t("export.cancelled"));
        return;
      }
      setError(reason);
    }
  };

  const stop = () => controller.current?.abort();

  const download = () => {
    if (phase.kind !== "done") return;
    revoke();
    objectUrl.current = URL.createObjectURL(phase.result.blob);
    const link = document.createElement("a");
    link.href = objectUrl.current;
    link.download = `${fileName}.${EXTENSIONS[phase.format]}`;
    link.click();
  };

  const composition = compositionSize(plan, source);
  const size = outputSize(current.output, composition);
  const removed = KINDS.filter((kind) => source.metadata[kind]);
  const kept = FIELDS.filter((field) => current.metadata[field] !== "");
  const exporting = phase.kind === "exporting";

  const footer =
    phase.kind === "done" ? (
      <>
        <Button variant="secondary" onClick={close}>
          {messages.t("export.close")}
        </Button>
        <Button ref={downloadButton} variant="primary" onClick={download}>
          {messages.t("export.download")}
        </Button>
      </>
    ) : exporting ? (
      <Button variant="secondary" onClick={stop}>
        {messages.t("export.stop")}
      </Button>
    ) : (
      <>
        <Button variant="secondary" onClick={close}>
          {messages.t("export.cancel")}
        </Button>
        <Button variant="primary" onClick={() => void run()}>
          {messages.t("export.confirm")}
        </Button>
      </>
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={messages.t("export.title")}
      description={messages.t("export.description")}
      footer={footer}
      className={["hm-image-export", props.className].filter(Boolean).join(" ")}
    >
      {phase.kind === "done" ? (
        <p className="hm-image-export-result">
          {messages.t("export.ready", {
            width: phase.result.width,
            height: phase.result.height,
            format: formatName(phase.format),
            size: phase.result.blob.size,
          })}
        </p>
      ) : (
        <>
          <fieldset className="hm-image-export-choices" disabled={exporting}>
            <SegmentedControl
              label={messages.t("export.format")}
              value={current.format}
              size="small"
              options={FORMATS.map((format) => ({ value: format, label: formatName(format) }))}
              onValueChange={(format) => update({ format: format as FormatType })}
            />
            {current.format === "png" ? null : (
              <Slider
                label={messages.t("export.quality")}
                min={1}
                max={100}
                step={1}
                largeStep={10}
                value={current.quality}
                onValueChange={(quality) => update({ quality: Math.round(quality) })}
              />
            )}
            <SegmentedControl
              label={messages.t("export.size")}
              value={current.output.kind}
              size="small"
              options={[
                { value: "scale", label: messages.t("export.sizes.scale") },
                { value: "fit", label: messages.t("export.sizes.fit") },
              ]}
              onValueChange={(kind) =>
                update({
                  output:
                    kind === "fit"
                      ? { kind: "fit", width: composition.width, height: composition.height }
                      : { kind: "scale", scale: 1 },
                })
              }
            />
            <div className="hm-image-export-fields">
              {current.output.kind === "scale" ? (
                <Field label={messages.t("export.scale")}>
                  <NumberField
                    value={Math.round(current.output.scale * 100)}
                    min={1}
                    max={100}
                    step={1}
                    largeStep={10}
                    onValueChange={(percent) =>
                      update({ output: { kind: "scale", scale: Math.round(percent) / 100 } })
                    }
                  />
                </Field>
              ) : (
                (["width", "height"] as const).map((side) => {
                  const output = current.output as Extract<ImageOutput, { kind: "fit" }>;
                  return (
                    <Field
                      key={side}
                      label={messages.t(side === "width" ? "export.fitWidth" : "export.fitHeight")}
                    >
                      <NumberField
                        value={output[side]}
                        min={1}
                        step={1}
                        largeStep={100}
                        onValueChange={(value) =>
                          update({ output: { ...output, [side]: Math.max(1, Math.round(value)) } })
                        }
                      />
                    </Field>
                  );
                })
              )}
            </div>
            <fieldset className="hm-image-export-metadata">
              <legend>{messages.t("export.fields")}</legend>
              <p className="hm-image-export-hint">{messages.t("export.fieldsHint")}</p>
              <div className="hm-image-export-fields">
                {FIELDS.map((field) => (
                  <Field key={field} label={messages.t(`export.field.${field}`)}>
                    {(control) => (
                      <input
                        {...control}
                        className="hm-image-text-field"
                        type="text"
                        autoComplete="off"
                        maxLength={MAX_METADATA_LENGTH}
                        value={current.metadata[field]}
                        onChange={(event) =>
                          update({
                            metadata: { ...current.metadata, [field]: event.currentTarget.value },
                          })
                        }
                      />
                    )}
                  </Field>
                ))}
              </div>
            </fieldset>
          </fieldset>
          <section className="hm-image-export-summary" aria-label={messages.t("export.summary")}>
            <p>
              {messages.t("export.output", {
                width: size.width,
                height: size.height,
                format: formatName(current.format),
              })}
            </p>
            {removed.length > 0 ? (
              <>
                <p>{messages.t("export.removed")}</p>
                <ul>
                  {removed.map((kind) => (
                    <li key={kind}>{messages.t(`export.kind.${kind}`)}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p>{messages.t("export.removedNone")}</p>
            )}
            {kept.length > 0 ? (
              <>
                <p>{messages.t("export.kept")}</p>
                <ul>
                  {kept.map((field) => (
                    <li key={field}>{messages.t(`export.field.${field}`)}</li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
          {exporting ? (
            <ProgressBar
              label={messages.t("export.progress")}
              value={Math.round(phase.progress * 100)}
              max={100}
            />
          ) : null}
          {error ? (
            <p className="hm-image-export-error" role="alert">
              {messages.error(error)}
            </p>
          ) : null}
        </>
      )}
    </Dialog>
  );
}
