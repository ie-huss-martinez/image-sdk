import type { ReactNode } from "react";
import type { ImageKeepableMetadata, ImageMetadataPresence } from "../../core/model/source.js";
import { useImageDocument, useImageMessages } from "../hooks.js";

/**
 * Props of {@link ImageInfoPanel}.
 *
 * @public
 */
export interface ImageInfoPanelProps {
  readonly className?: string;
}

const KINDS: readonly (keyof ImageMetadataPresence)[] = [
  "location",
  "camera",
  "timestamps",
  "thumbnail",
  "colourProfile",
  "other",
];
const FIELDS: readonly (keyof ImageKeepableMetadata)[] = [
  "title",
  "description",
  "artist",
  "copyright",
];

/**
 * The Info panel (docs/adr/0007): what the editor knows of the open image,
 * as a list of terms: its upright size, format, frames and file size, the
 * kinds of metadata the file carries, and the fields kept on export. It
 * shows only what the session already holds, and never a file name
 * (sdk-core ADR 0012).
 *
 * @public
 */
export function ImageInfoPanel(props: ImageInfoPanelProps): ReactNode {
  const { plan, source } = useImageDocument();
  const messages = useImageMessages();
  if (!plan || !source) return null;
  const carried = KINDS.filter((kind) => source.metadata[kind]);
  const kept = FIELDS.filter((field) => plan.metadata[field] !== "");
  return (
    <section
      className={["hm-image-info-panel", props.className].filter(Boolean).join(" ")}
      aria-label={messages.t("info.panel")}
    >
      <dl className="hm-image-info-list">
        <dt>{messages.t("info.size")}</dt>
        <dd>{messages.t("info.sizeValue", { width: source.width, height: source.height })}</dd>
        <dt>{messages.t("info.format")}</dt>
        <dd>{messages.t(`info.formats.${source.format}`)}</dd>
        {source.frames > 1 ? (
          <>
            <dt>{messages.t("info.frames")}</dt>
            <dd>{source.frames}</dd>
          </>
        ) : null}
        <dt>{messages.t("info.fileSize")}</dt>
        <dd>{messages.t("info.fileSizeValue", { size: source.fileSize })}</dd>
        <dt>{messages.t("info.metadata")}</dt>
        <dd>
          {carried.length > 0 ? (
            <ul>
              {carried.map((kind) => (
                <li key={kind}>{messages.t(`export.kind.${kind}`)}</li>
              ))}
            </ul>
          ) : (
            messages.t("info.metadataNone")
          )}
        </dd>
        <dt>{messages.t("info.kept")}</dt>
        <dd>
          {kept.length > 0 ? (
            <ul>
              {kept.map((field) => (
                <li key={field}>{messages.t(`export.field.${field}`)}</li>
              ))}
            </ul>
          ) : (
            messages.t("info.keptNone")
          )}
        </dd>
      </dl>
    </section>
  );
}
