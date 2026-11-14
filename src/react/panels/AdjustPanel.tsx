import { Button, Field, Slider, useAnnounce } from "@hussmartinez/ui/react";
import { type ReactNode, useRef } from "react";
import { DEVELOP_ADJUSTMENTS, type ImageDevelop } from "../../core/model/plan.js";
import { useGesture } from "../gesture.js";
import {
  useImageDocument,
  useImageEditorState,
  useImageMessages,
  useImageSession,
} from "../hooks.js";
import { sliderGesture } from "./use-slider-gesture.js";

/**
 * Props of {@link ImageAdjustPanel}.
 *
 * @public
 */
export interface ImageAdjustPanelProps {
  readonly className?: string;
}

const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

/**
 * The Adjust panel (docs/adr/0006, docs/adr/0007): a slider per develop
 * adjustment, in the order they're applied, from −100 to 100. A slider's
 * gesture previews on the stage and is one undo step when it ends; each
 * slider resets to 0 with its button, or by double-clicking it, and "Reset
 * all" resets every one in one step.
 *
 * @public
 */
export function ImageAdjustPanel(props: ImageAdjustPanelProps): ReactNode {
  const session = useImageSession();
  const { plan } = useImageDocument();
  const [editor] = useImageEditorState();
  const messages = useImageMessages();
  const gesture = useGesture();
  const announce = useAnnounce();
  const first = useRef<HTMLInputElement>(null);
  if (!plan) return null;
  // During a gesture the sliders show its values, which the stage renders.
  const develop = (editor.preview ?? plan).base.develop;
  const reset = (values: Partial<ImageDevelop>) => {
    gesture.cancel();
    session.execute({ type: "image.setDevelop", values });
  };
  const changed = DEVELOP_ADJUSTMENTS.filter((name) => plan.base.develop[name] !== 0);
  return (
    <section
      className={["hm-image-adjust-panel", props.className].filter(Boolean).join(" ")}
      aria-label={messages.t("develop.panel")}
    >
      {DEVELOP_ADJUSTMENTS.map((name, index) => {
        const label = messages.t(`develop.${name}`);
        return (
          // The Field shows the slider's name, and labels it (WCAG 2.5.3).
          <Field key={name} label={label} className="hm-image-slider-field">
            {(control) => (
              <div className="hm-image-adjust-row">
                <Slider
                  {...control}
                  {...(index === 0 ? { ref: first } : {})}
                  min={-100}
                  max={100}
                  step={1}
                  largeStep={10}
                  value={develop[name]}
                  formatValue={signed}
                  {...sliderGesture(gesture, (value) => ({
                    type: "image.setDevelop",
                    values: { [name]: Math.round(value) },
                  }))}
                  onDoubleClick={() => {
                    if (plan.base.develop[name] !== 0) reset({ [name]: 0 });
                  }}
                />
                <output className="hm-image-adjust-value" aria-hidden="true">
                  {signed(develop[name])}
                </output>
                {plan.base.develop[name] !== 0 ? (
                  <Button variant="quiet" size="small" onClick={() => reset({ [name]: 0 })}>
                    {messages.t("develop.reset", { name: label })}
                  </Button>
                ) : null}
              </div>
            )}
          </Field>
        );
      })}
      <Button
        variant="secondary"
        disabled={changed.length === 0}
        onClick={() => {
          reset(Object.fromEntries(changed.map((name) => [name, 0])));
          first.current?.focus();
          announce(messages.t("develop.wasReset"));
        }}
      >
        {messages.t("develop.resetAll")}
      </Button>
    </section>
  );
}
