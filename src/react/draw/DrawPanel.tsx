import { Button, ColorField, Field, NumberField, SegmentedControl } from "@hussmartinez/ui/react";
import type { ReactNode } from "react";
import { MAX_STROKE_WIDTH } from "../../core/model/plan.js";
import { useImageDocument, useImageEditorState, useImageMessages } from "../hooks.js";
import { useSwatches } from "../layers/LayerFields.js";
import { useDrawActions } from "./use-draw.js";

/**
 * Props of {@link ImageDrawPanel}.
 *
 * @public
 */
export interface ImageDrawPanelProps {
  readonly className?: string;
}

/**
 * The draw panel (docs/adr/0015), shown while drawing: the pen or the
 * highlighter, the colour and the width the next stroke takes, and a button
 * that removes the last stroke. It says that drawing needs a pointer, and
 * where the keyboard's way to point at something is.
 *
 * The panel keeps its size, whatever is chosen or drawn, so the stage
 * doesn't move under a stroke.
 *
 * @public
 */
export function ImageDrawPanel(props: ImageDrawPanelProps): ReactNode {
  const [state] = useImageEditorState();
  // Follows the plan: whether there's a stroke to remove.
  useImageDocument();
  const messages = useImageMessages();
  const actions = useDrawActions();
  const swatches = useSwatches();
  const settings = state.draw;
  if (state.tool !== "draw" || !settings) return null;
  const drawing = actions.target();
  return (
    <section
      className={["hm-image-draw-panel", props.className].filter(Boolean).join(" ")}
      aria-label={messages.t("draw.panel")}
    >
      <p className="hm-image-draw-intro">{messages.t("draw.intro")}</p>
      <SegmentedControl
        label={messages.t("draw.mode")}
        value={settings.mode}
        size="small"
        options={[
          { value: "pen", label: messages.t("draw.modes.pen") },
          { value: "highlighter", label: messages.t("draw.modes.highlighter") },
        ]}
        onValueChange={(mode) => actions.set({ mode })}
      />
      <Field label={messages.t("draw.colour")}>
        <ColorField
          value={settings.colour}
          swatches={swatches}
          onValueChange={(colour) => {
            if (colour !== settings.colour) actions.set({ colour });
          }}
        />
      </Field>
      <Field label={messages.t("draw.width")}>
        <NumberField
          value={settings.width}
          min={1}
          max={MAX_STROKE_WIDTH}
          step={1}
          largeStep={5}
          onValueChange={(width) => actions.set({ width })}
        />
      </Field>
      <div className="hm-image-draw-actions">
        <Button
          variant="secondary"
          className="hm-image-draw-remove"
          disabled={!drawing}
          focusableWhenDisabled
          onClick={() => actions.removeLast()}
        >
          {messages.t("draw.removeLast")}
        </Button>
        <Button variant="primary" className="hm-image-draw-done" onClick={() => actions.done()}>
          {messages.t("draw.done")}
        </Button>
      </div>
    </section>
  );
}
