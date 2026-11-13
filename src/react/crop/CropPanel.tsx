import { Button, Field, NumberField, SegmentedControl } from "@hussmartinez/ui/react";
import type { ReactNode } from "react";
import { ASPECT_PRESETS, type ImageAspect, moveCrop, wholeCrop } from "../../core/model/crop.js";
import { useImageDocument, useImageEditorState, useImageMessages } from "../hooks.js";
import { useCropActions } from "./use-crop.js";

const aspectKey = (aspect: ImageAspect) =>
  typeof aspect === "string" ? aspect : `${aspect[0]}:${aspect[1]}`;

/**
 * Props of {@link ImageCropPanel}.
 *
 * @public
 */
export interface ImageCropPanelProps {
  readonly className?: string;
}

/**
 * The crop panel (docs/adr/0007): the crop's position and size in source
 * pixels as number fields, the aspect presets, and Apply, Cancel and Whole
 * image. It's the alternative to dragging the frame (WCAG 2.5.7), shown while
 * cropping.
 *
 * @public
 */
export function ImageCropPanel(props: ImageCropPanelProps): ReactNode {
  const [state] = useImageEditorState();
  const { source } = useImageDocument();
  const messages = useImageMessages();
  const actions = useCropActions();
  const crop = state.crop;
  if (state.tool !== "crop" || !crop || !source) return null;
  const { pending } = crop;
  const field = (name: "x" | "y" | "width" | "height") => {
    const max =
      name === "x"
        ? source.width - pending.width
        : name === "y"
          ? source.height - pending.height
          : name === "width"
            ? source.width - pending.x
            : source.height - pending.y;
    return (
      <Field key={name} label={messages.t(`crop.${name}`)}>
        <NumberField
          value={pending[name]}
          min={name === "width" || name === "height" ? 1 : 0}
          max={max}
          step={1}
          largeStep={10}
          onValueChange={(value) => {
            const next = { ...pending, [name]: Math.round(value) };
            actions.update(name === "x" || name === "y" ? moveCrop(next, 0, 0, source) : next);
          }}
        />
      </Field>
    );
  };
  const options = ASPECT_PRESETS.map((aspect) => ({
    value: aspectKey(aspect),
    label:
      typeof aspect === "string"
        ? messages.t(`crop.aspects.${aspect}`)
        : messages.t("crop.aspects.ratio", { width: aspect[0], height: aspect[1] }),
  }));
  return (
    <section
      className={["hm-image-crop-panel", props.className].filter(Boolean).join(" ")}
      aria-label={messages.t("crop.panel")}
    >
      <div className="hm-image-crop-fields">
        {(["x", "y", "width", "height"] as const).map(field)}
      </div>
      <SegmentedControl
        label={messages.t("crop.aspect")}
        value={aspectKey(crop.aspect)}
        options={options}
        size="small"
        onValueChange={(value) => {
          const aspect = ASPECT_PRESETS.find((a) => aspectKey(a) === value);
          if (aspect) actions.setAspect(aspect);
        }}
      />
      <div className="hm-image-crop-actions">
        <Button variant="secondary" onClick={() => actions.update(wholeCrop(source))}>
          {messages.t("crop.reset")}
        </Button>
        <Button variant="secondary" onClick={() => actions.cancel()}>
          {messages.t("crop.cancel")}
        </Button>
        <Button variant="primary" onClick={() => actions.apply()}>
          {messages.t("crop.apply")}
        </Button>
      </div>
    </section>
  );
}
