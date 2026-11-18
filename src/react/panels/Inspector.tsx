import { SegmentedControl } from "@hussmartinez/ui/react";
import { type ReactNode, useState } from "react";
import { ImageCropPanel } from "../crop/CropPanel.js";
import { ImageDrawPanel } from "../draw/DrawPanel.js";
import type { ImageEditorFeatures } from "../editor/types.js";
import { ImageFramesPanel } from "../frames/FramesPanel.js";
import { useImageDocument, useImageEditorState, useImageMessages } from "../hooks.js";
import { ImageLayersPanel } from "../layers/LayersPanel.js";
import { ImageRedactPanel } from "../redact/RedactPanel.js";
import { ImageAdjustPanel } from "./AdjustPanel.js";
import { ImageFilterPanel } from "./FilterPanel.js";
import { ImageInfoPanel } from "./InfoPanel.js";

type Panel = "adjust" | "filters" | "info";
const PANELS: readonly Panel[] = ["adjust", "filters", "info"];

/**
 * The inspector (docs/adr/0007): the crop panel while cropping, and the
 * redact panel while redacting, the layers panel while the layers are
 * shown, and the frames panel while an animation's frames are; otherwise
 * a choice of the Adjust, Filters and Info panels, once an image is open.
 */
export function ImageInspector(props: { readonly features?: ImageEditorFeatures }): ReactNode {
  const { plan } = useImageDocument();
  const [editor] = useImageEditorState();
  const messages = useImageMessages();
  const [chosen, setPanel] = useState<Panel>("adjust");
  if (editor.tool === "crop") return <ImageCropPanel />;
  if (editor.tool === "redact") return <ImageRedactPanel />;
  if (editor.tool === "layers") return <ImageLayersPanel />;
  if (editor.tool === "draw") return <ImageDrawPanel />;
  if (editor.tool === "frames") return <ImageFramesPanel />;
  if (!plan) return null;
  // The panels the host turned on, in order; the choice falls to the first.
  const panels = PANELS.filter((name) => props.features?.[name] !== false);
  const first = panels[0];
  if (first === undefined) return null;
  const panel = panels.includes(chosen) ? chosen : first;
  return (
    <>
      {panels.length > 1 ? (
        <SegmentedControl
          label={messages.t("inspector.label")}
          value={panel}
          size="small"
          options={panels.map((name) => ({ value: name, label: messages.t(`inspector.${name}`) }))}
          onValueChange={(value) => setPanel(value as Panel)}
        />
      ) : null}
      {panel === "adjust" ? <ImageAdjustPanel /> : null}
      {panel === "filters" ? <ImageFilterPanel /> : null}
      {panel === "info" ? <ImageInfoPanel /> : null}
    </>
  );
}
