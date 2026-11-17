import {
  Button,
  DeleteIcon,
  Field,
  IconButton,
  NumberField,
  SegmentedControl,
} from "@hussmartinez/ui/react";
import type { ReactNode } from "react";
import { MAX_SCENE_COORDINATE } from "../../core/model/plan.js";
import { DEFAULT_REDACTION_COLOUR } from "../../features/redact/redact-tool.js";
import { useImageDocument, useImageEditorState, useImageMessages } from "../hooks.js";
import { useRedactActions } from "./use-redact.js";

/** The colours a solid redaction can take: the plan holds any, the editor offers these. */
const COLOURS = [
  { value: DEFAULT_REDACTION_COLOUR, name: "black" },
  { value: "#ffffff", name: "white" },
] as const;

/**
 * Props of {@link ImageRedactPanel}.
 *
 * @public
 */
export interface ImageRedactPanelProps {
  readonly className?: string;
}

/**
 * The redact panel (docs/adr/0010), shown while redacting: what a new area
 * is covered with, a button that adds one without dragging (WCAG 2.5.7),
 * the selected area's position and size in source pixels, and the list of
 * every area, each with its mode, its size and a button to remove it, so
 * what's covered can be read without the preview.
 *
 * The panel keeps its size while redacting, whatever is selected or chosen.
 * Where the inspector sits under the stage, a panel that grew would shrink
 * the stage, and move the image under the pointer.
 *
 * @public
 */
export function ImageRedactPanel(props: ImageRedactPanelProps): ReactNode {
  const [state] = useImageEditorState();
  const { plan } = useImageDocument();
  const messages = useImageMessages();
  const actions = useRedactActions();
  const settings = state.redact;
  if (state.tool !== "redact" || !settings || !plan) return null;
  // The stage may show a gesture's plan; the panel lists what's committed.
  const { redactions } = plan;
  const selected = redactions.find((redaction) => redaction.key === settings.selected);
  // The fields are always there, so the panel keeps its size, and the stage
  // with it: with no area selected they're disabled, and their place is kept.
  const field = (name: "x" | "y" | "width" | "height") => {
    const length = name === "width" || name === "height";
    return (
      <Field key={name} label={messages.t(`redact.${name}`)}>
        <NumberField
          value={selected ? selected[name] : length ? 1 : 0}
          min={length ? 1 : -MAX_SCENE_COORDINATE}
          max={MAX_SCENE_COORDINATE}
          step={1}
          largeStep={10}
          disabled={!selected}
          onValueChange={(value) => {
            if (!selected) return;
            const { x, y, width, height } = selected;
            actions.setRegion(selected.key, { x, y, width, height, [name]: Math.round(value) });
          }}
        />
      </Field>
    );
  };
  const pixelating = settings.mode === "pixelate";
  return (
    <section
      className={["hm-image-redact-panel", props.className].filter(Boolean).join(" ")}
      aria-label={messages.t("redact.panel")}
    >
      <p className="hm-image-redact-intro">{messages.t("redact.intro")}</p>
      <SegmentedControl
        label={messages.t("redact.mode")}
        value={settings.mode}
        size="small"
        options={[
          { value: "solid", label: messages.t("redact.modes.solid") },
          { value: "pixelate", label: messages.t("redact.modes.pixelate") },
        ]}
        onValueChange={(value) => actions.setMode(value === "pixelate" ? "pixelate" : "solid")}
      />
      {/*
        The colour and pixelation's warning share one place, sized for the
        taller, so choosing a mode never moves what's below it or the stage.
        The one that doesn't apply is hidden, from sight, focus and
        assistive technology alike.
      */}
      <div className="hm-image-redact-cover">
        <div data-hm-inactive={pixelating ? "" : undefined}>
          <SegmentedControl
            label={messages.t("redact.colour")}
            // A colour from a plan that isn't one of these shows neither chosen.
            value={settings.colour}
            size="small"
            options={COLOURS.map(({ value, name }) => ({
              value,
              label: messages.t(`redact.colours.${name}`),
            }))}
            onValueChange={(value) => actions.setColour(value)}
          />
        </div>
        <p className="hm-image-redact-hint" data-hm-inactive={pixelating ? undefined : ""}>
          {messages.t("redact.pixelateHint")}
        </p>
      </div>
      <Button variant="secondary" className="hm-image-redact-add" onClick={() => actions.add()}>
        {messages.t("redact.add")}
      </Button>
      <div className="hm-image-redact-fields" data-hm-inactive={selected ? undefined : ""}>
        {(["x", "y", "width", "height"] as const).map(field)}
      </div>
      <section className="hm-image-redact-areas" aria-label={messages.t("redact.areas")}>
        {redactions.length === 0 ? (
          <p className="hm-image-redact-none">{messages.t("redact.none")}</p>
        ) : (
          <ul>
            {redactions.map((redaction, index) => (
              <li key={redaction.key}>
                <Button
                  variant="secondary"
                  pressed={redaction.key === settings.selected}
                  onClick={() => actions.select(redaction.key)}
                >
                  {messages.t("redact.area", {
                    index: index + 1,
                    mode: messages.t(`redact.modeNames.${redaction.mode}`),
                    width: redaction.width,
                    height: redaction.height,
                  })}
                </Button>
                <IconButton
                  label={messages.t("redact.remove", { index: index + 1 })}
                  icon={<DeleteIcon />}
                  onClick={() => actions.remove(redaction.key)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="hm-image-redact-actions">
        <Button variant="primary" onClick={() => actions.done()}>
          {messages.t("redact.done")}
        </Button>
      </div>
    </section>
  );
}
