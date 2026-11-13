import { SegmentedControl, Slider } from "@hussmartinez/ui/react";
import type { ReactNode } from "react";
import { FILTER_PRESETS, type ImageFilterPreset } from "../../core/model/plan.js";
import { useGesture } from "../gesture.js";
import {
  useImageDocument,
  useImageEditorState,
  useImageMessages,
  useImageSession,
} from "../hooks.js";
import { sliderGesture } from "./use-slider-gesture.js";

/**
 * Props of {@link ImageFilterPanel}.
 *
 * @public
 */
export interface ImageFilterPanelProps {
  readonly className?: string;
}

/**
 * The Filters panel (docs/adr/0006, docs/adr/0007): the presets, "None"
 * first, as one choice, each one undo step; and the chosen preset's
 * strength, whose slider gesture is one undo step.
 *
 * @public
 */
export function ImageFilterPanel(props: ImageFilterPanelProps): ReactNode {
  const session = useImageSession();
  const { plan } = useImageDocument();
  const [editor] = useImageEditorState();
  const messages = useImageMessages();
  const gesture = useGesture();
  if (!plan) return null;
  const filter = (editor.preview ?? plan).base.filter;
  const options = [
    { value: "none", label: messages.t("filters.none") },
    ...FILTER_PRESETS.map((preset) => ({ value: preset, label: messages.t(`filters.${preset}`) })),
  ];
  return (
    <section
      className={["hm-image-filter-panel", props.className].filter(Boolean).join(" ")}
      aria-label={messages.t("filters.panel")}
    >
      <SegmentedControl
        label={messages.t("filters.label")}
        value={filter?.preset ?? "none"}
        options={options}
        onValueChange={(value) => {
          gesture.cancel();
          session.execute({
            type: "image.setFilter",
            filter:
              value === "none"
                ? null
                : { preset: value as ImageFilterPreset, strength: filter?.strength ?? 100 },
          });
        }}
      />
      {filter ? (
        <Slider
          label={messages.t("filters.strength")}
          min={0}
          max={100}
          step={1}
          largeStep={10}
          value={filter.strength}
          {...sliderGesture(gesture, (value) => ({
            type: "image.setFilter",
            filter: { preset: filter.preset, strength: Math.round(value) },
          }))}
        />
      ) : null}
    </section>
  );
}
