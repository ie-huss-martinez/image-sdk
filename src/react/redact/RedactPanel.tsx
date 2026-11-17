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
  const field = (name: "x" | "y" | "width" | "height") => {
    if (!selected) return null;
    const length = name === "width" || name === "height";
    return (
      <Field key={name} label={messages.t(`redact.${name}`)}>
        <NumberField
          value={selected[name]}
          min={length ? 1 : -MAX_SCENE_COORDINATE}
          max={MAX_SCENE_COORDINATE}
          step={1}
          largeStep={10}
          onValueChange={(value) => {
            const { x, y, width, height } = selected;
            actions.setRegion(selected.key, { x, y, width, height, [name]: Math.round(value) });
          }}
        />
      </Field>
    );
  };
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
      {settings.mode === "pixelate" ? (
        <p className="hm-image-redact-hint">{messages.t("redact.pixelateHint")}</p>
      ) : (
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
      )}
      <Button variant="secondary" className="hm-image-redact-add" onClick={() => actions.add()}>
        {messages.t("redact.add")}
      </Button>
      {selected ? (
        <div className="hm-image-redact-fields">
          {(["x", "y", "width", "height"] as const).map(field)}
        </div>
      ) : null}
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
