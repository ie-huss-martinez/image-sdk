import { CloseIcon, IconButton } from "@hussmartinez/ui/react";
import { type ReactNode, useId, useState } from "react";
import type { ImageLimitName } from "../../core/errors/image-limits.js";
import type { ImageSessionSource } from "../../core/session/session.js";
import { useImageDocument, useImageMessages } from "../hooks.js";

interface Notice {
  /** The source and the notice, so a dismissal holds for this image only. */
  readonly key: string;
  readonly text: string;
}

/** A limit warning's values, from what the session knows of the source. */
function warningValues(limit: ImageLimitName, source: ImageSessionSource) {
  if (limit === "maxFileSize") return { actual: source.fileSize };
  if (limit === "maxFrames") return { actual: source.frames };
  return {};
}

/**
 * The stage's notices (docs/adr/0007, "Warnings"): the limits the open image
 * came near, and, when it has a colour profile, that colours outside sRGB
 * are clipped on export (ADR 0005). They're polite, in a status region,
 * since nothing failed; errors stay alerts. Each can be dismissed for this
 * image, and shows again for another that has it.
 */
export function StageNotices(): ReactNode {
  const { source, warnings, status } = useImageDocument();
  const messages = useImageMessages();
  const id = useId();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  if (!source || status !== "ready") return null;

  const t = messages.t as (key: string, values?: Record<string, number>) => string;
  const notices: Notice[] = [];
  for (const limit of warnings) {
    // The session reports only per-file limits when it opens an image.
    if (limit === "maxSessionSize" || limit === "maxLayers") continue;
    notices.push({
      key: `${source.id}:${limit}`,
      text: t(`warnings.${limit}`, warningValues(limit, source)),
    });
  }
  if (source.metadata.colourProfile) {
    notices.push({ key: `${source.id}:colourProfile`, text: messages.t("notices.colourProfile") });
  }
  const shown = notices.filter((notice) => !dismissed.has(notice.key));

  // The region stays while an image is open, so a notice that appears in it
  // is announced; an empty one shows nothing.
  return (
    <div className="hm-image-stage-notices" role="status" aria-label={messages.t("notices.label")}>
      {shown.length > 0 ? (
        <ul>
          {shown.map((notice, index) => (
            <li key={notice.key} className="hm-image-stage-notice">
              <span id={`${id}-${index}`}>{notice.text}</span>
              <IconButton
                label={messages.t("notices.dismiss")}
                aria-describedby={`${id}-${index}`}
                icon={<CloseIcon />}
                size="small"
                variant="quiet"
                onClick={() => setDismissed((before) => new Set(before).add(notice.key))}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
