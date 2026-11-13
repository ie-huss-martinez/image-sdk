import { SegmentedControl } from "@hussmartinez/ui/react";
import { type ReactNode, useState } from "react";
import { ImageCropPanel } from "../crop/CropPanel.js";
import { useImageDocument, useImageEditorState, useImageMessages } from "../hooks.js";
import { ImageAdjustPanel } from "./AdjustPanel.js";
import { ImageFilterPanel } from "./FilterPanel.js";

type Panel = "adjust" | "filters";

/**
 * The inspector (docs/adr/0007): the crop panel while cropping; otherwise
 * a choice of the Adjust and Filters panels, once an image is open.
 */
export function ImageInspector(): ReactNode {
  const { plan } = useImageDocument();
  const [editor] = useImageEditorState();
  const messages = useImageMessages();
  const [panel, setPanel] = useState<Panel>("adjust");
  if (editor.tool === "crop") return <ImageCropPanel />;
  if (!plan) return null;
  return (
    <>
      <SegmentedControl
        label={messages.t("inspector.label")}
        value={panel}
        size="small"
        options={[
          { value: "adjust", label: messages.t("inspector.adjust") },
          { value: "filters", label: messages.t("inspector.filters") },
        ]}
        onValueChange={(value) => setPanel(value as Panel)}
      />
      {panel === "adjust" ? <ImageAdjustPanel /> : <ImageFilterPanel />}
    </>
  );
}
