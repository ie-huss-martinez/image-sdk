import {
  ColorField,
  Field,
  NumberField,
  SegmentedControl,
  TextArea,
  ToggleButton,
} from "@hussmartinez/ui/react";
import { type ReactNode, useState } from "react";
import {
  type ImageArrowLayer,
  type ImageShapeLayer,
  type ImageTextLayer,
  LAYER_ALIGNMENTS,
  LAYER_FONTS,
  MAX_SCENE_COORDINATE,
  MAX_STROKE_WIDTH,
} from "../../core/model/plan.js";
import {
  DEFAULT_SHAPE_COLOUR,
  DEFAULT_TEXT_COLOUR,
  defaultStrokeWidth,
} from "../../features/layers/new-layer.js";
import { useImageMessages, useImageSession } from "../hooks.js";
import { fitLayerText, type LayerActions } from "./use-layers.js";

/** The colours offered as swatches: the plan holds any, and the field takes any. */
const SWATCHES = [
  { value: "#000000", name: "black" },
  { value: "#ffffff", name: "white" },
  { value: "#e02020", name: "red" },
  { value: "#f0c020", name: "yellow" },
  { value: "#20a040", name: "green" },
  { value: "#2060e0", name: "blue" },
] as const;

export function useSwatches() {
  const messages = useImageMessages();
  return SWATCHES.map(({ value, name }) => ({
    value,
    label: messages.t(`layers.colours.${name}`),
  }));
}

interface FieldsProps<Layer> {
  /** The selected layer when it's of this kind; otherwise the fields keep their place, disabled. */
  readonly layer: Layer | null;
  readonly actions: LayerActions;
  /** Runs an action, keeping what the session refused for the panel to say. */
  readonly run: (action: () => void) => void;
}

/**
 * A text layer's fields (docs/adr/0013): its text, shown on the image as
 * it's typed and set as one step when the typing stops; its font, weight
 * and alignment; and its colour.
 */
export function TextLayerFields(props: FieldsProps<ImageTextLayer>): ReactNode {
  const { layer, actions, run } = props;
  const messages = useImageMessages();
  const swatches = useSwatches();
  const key = layer?.key ?? null;
  const text = layer?.text ?? "";
  const [value, setValue] = useState(text);
  // What was typed follows the layer's text whenever that changes, and so
  // does another layer with the same text. Reset while rendering, rather
  // than in an effect that would render twice.
  const [shown, setShown] = useState({ key, text });
  if (shown.key !== key || shown.text !== text) {
    setShown({ key, text });
    setValue(text);
  }
  const off = layer === null;
  return (
    <div className="hm-image-layer-kind" data-hm-inactive={off ? "" : undefined}>
      <Field label={messages.t("layers.text")} className="hm-image-layers-text">
        <TextArea
          rows={3}
          value={value}
          disabled={off}
          onValueChange={(typed) => {
            // What the plan takes: line feeds, and none of what text can't hold.
            const fitted = fitLayerText(typed);
            setValue(fitted);
            if (layer) run(() => actions.typing(layer.key, { text: fitted }));
          }}
          onBlur={() => actions.commit()}
        />
      </Field>
      <SegmentedControl
        label={messages.t("layers.font")}
        size="small"
        value={layer?.font ?? "sans-serif"}
        options={LAYER_FONTS.map((font) => ({
          value: font,
          label: messages.t(`layers.fonts.${font}`),
          disabled: off,
        }))}
        onValueChange={(font) => layer && run(() => actions.set(layer.key, { font }))}
      />
      <div className="hm-image-layer-row">
        <SegmentedControl
          label={messages.t("layers.align")}
          size="small"
          value={layer?.align ?? "center"}
          options={LAYER_ALIGNMENTS.map((align) => ({
            value: align,
            label: messages.t(`layers.alignments.${align}`),
            disabled: off,
          }))}
          onValueChange={(align) => layer && run(() => actions.set(layer.key, { align }))}
        />
        <ToggleButton
          size="small"
          pressed={layer?.bold ?? false}
          disabled={off}
          onPressedChange={(bold) => layer && run(() => actions.set(layer.key, { bold }))}
        >
          {messages.t("layers.bold")}
        </ToggleButton>
      </div>
      <Field label={messages.t("layers.colour")}>
        <ColorField
          value={layer?.colour ?? DEFAULT_TEXT_COLOUR}
          swatches={swatches}
          disabled={off}
          onValueChange={(colour) => {
            if (layer && colour !== layer.colour) run(() => actions.set(layer.key, { colour }));
          }}
        />
      </Field>
    </div>
  );
}

/**
 * A shape's fields (docs/adr/0013): its fill and its outline, each on or
 * off with a colour, and the outline's width. A shape always has one of
 * them (docs/adr/0009): turning off the only one turns on the other, in
 * its colour, so nothing is refused and the shape never disappears.
 */
export function ShapeLayerFields(props: FieldsProps<ImageShapeLayer>): ReactNode {
  const { layer, actions, run } = props;
  const messages = useImageMessages();
  const session = useImageSession();
  const swatches = useSwatches();
  const off = layer === null;
  const fill = layer?.fill ?? null;
  const stroke = layer?.stroke ?? null;
  /** The outline a shape is given: as wide as a new shape's, and inside the box. */
  const outline = (colour: string) => {
    const { plan, source } = session.getSnapshot();
    const widest = layer ? Math.max(1, Math.floor(Math.min(layer.width, layer.height) / 2)) : 1;
    const width = plan && source ? Math.min(defaultStrokeWidth(plan, source), widest) : 1;
    return { colour, width };
  };
  const set = (props: Readonly<Record<string, unknown>>) => {
    if (layer) run(() => actions.set(layer.key, props));
  };
  return (
    <div className="hm-image-layer-kind" data-hm-inactive={off ? "" : undefined}>
      <div className="hm-image-layer-row">
        <ToggleButton
          size="small"
          pressed={fill !== null}
          disabled={off}
          onPressedChange={(on) => {
            if (on) set({ fill: stroke?.colour ?? DEFAULT_SHAPE_COLOUR });
            else if (stroke) set({ fill: null });
            else set({ fill: null, stroke: outline(fill ?? DEFAULT_SHAPE_COLOUR) });
          }}
        >
          {messages.t("layers.fill")}
        </ToggleButton>
        <ToggleButton
          size="small"
          pressed={stroke !== null}
          disabled={off}
          onPressedChange={(on) => {
            if (on) set({ stroke: outline(fill ?? DEFAULT_SHAPE_COLOUR) });
            else if (fill !== null) set({ stroke: null });
            else set({ stroke: null, fill: stroke?.colour ?? DEFAULT_SHAPE_COLOUR });
          }}
        >
          {messages.t("layers.outline")}
        </ToggleButton>
      </div>
      <Field label={messages.t("layers.fillColour")}>
        <ColorField
          value={fill ?? DEFAULT_SHAPE_COLOUR}
          swatches={swatches}
          disabled={off || fill === null}
          onValueChange={(colour) => {
            if (fill !== null && colour !== fill) set({ fill: colour });
          }}
        />
      </Field>
      <Field label={messages.t("layers.outlineColour")}>
        <ColorField
          value={stroke?.colour ?? DEFAULT_SHAPE_COLOUR}
          swatches={swatches}
          disabled={off || stroke === null}
          onValueChange={(colour) => {
            if (stroke && colour !== stroke.colour) set({ stroke: { ...stroke, colour } });
          }}
        />
      </Field>
      <Field label={messages.t("layers.outlineWidth")}>
        <NumberField
          value={stroke?.width ?? 1}
          min={1}
          max={MAX_STROKE_WIDTH}
          step={1}
          largeStep={5}
          disabled={off || stroke === null}
          onValueChange={(width) => {
            if (stroke) set({ stroke: { ...stroke, width: Math.round(width) } });
          }}
        />
      </Field>
    </div>
  );
}

/**
 * An arrow's fields (docs/adr/0015): where its tail and its tip are, in
 * scene pixels, its colour and its width. They re-aim it without a drag
 * (WCAG 2.5.7). An arrow's ends differ, so a value that would put one on
 * the other isn't set.
 */
export function ArrowLayerFields(props: FieldsProps<ImageArrowLayer>): ReactNode {
  const { layer, actions, run } = props;
  const messages = useImageMessages();
  const swatches = useSwatches();
  const off = layer === null;
  const end = (which: "from" | "to", axis: "x" | "y") => (
    <Field key={`${which}.${axis}`} label={messages.t(`layers.arrow.${which}.${axis}`)}>
      <NumberField
        value={layer ? layer[which][axis] : 0}
        min={-MAX_SCENE_COORDINATE}
        max={MAX_SCENE_COORDINATE}
        step={1}
        largeStep={10}
        disabled={off}
        onValueChange={(value) => {
          if (!layer) return;
          const moved = { ...layer[which], [axis]: Math.round(value) };
          const other = layer[which === "from" ? "to" : "from"];
          if (moved.x === other.x && moved.y === other.y) return;
          run(() => actions.set(layer.key, { [which]: moved }));
        }}
      />
    </Field>
  );
  return (
    <div className="hm-image-layer-kind" data-hm-inactive={off ? "" : undefined}>
      <div className="hm-image-layer-ends">
        {end("from", "x")}
        {end("from", "y")}
        {end("to", "x")}
        {end("to", "y")}
      </div>
      <Field label={messages.t("layers.colour")}>
        <ColorField
          value={layer?.colour ?? DEFAULT_SHAPE_COLOUR}
          swatches={swatches}
          disabled={off}
          onValueChange={(colour) => {
            if (layer && colour !== layer.colour) run(() => actions.set(layer.key, { colour }));
          }}
        />
      </Field>
      <Field label={messages.t("layers.arrow.width")}>
        <NumberField
          value={layer?.width ?? 1}
          min={1}
          max={MAX_STROKE_WIDTH}
          step={1}
          largeStep={5}
          disabled={off}
          onValueChange={(width) => {
            if (layer) run(() => actions.set(layer.key, { width: Math.round(width) }));
          }}
        />
      </Field>
    </div>
  );
}
