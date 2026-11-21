import {
  Button,
  DeleteIcon,
  DuplicateIcon,
  Field,
  FlipHorizontalIcon,
  HiddenIcon,
  IconButton,
  MoveDownIcon,
  MoveUpIcon,
  NumberField,
  ReorderableList,
  ReorderableListItem,
  TextField,
  VisibleIcon,
} from "@hussmartinez/ui/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { MAX_SCENE_COORDINATE } from "../../core/model/plan.js";
import {
  useImageDocument,
  useImageEditorState,
  useImageMessages,
  useImageSession,
} from "../hooks.js";
import { isBoxedLayer } from "./frame-geometry.js";
import { ArrowLayerFields, ShapeLayerFields, TextLayerFields } from "./LayerFields.js";
import { fitLayerName, layerLabel, useLayerActions } from "./use-layers.js";

/**
 * Props of {@link ImageLayersPanel}.
 *
 * @public
 */
export interface ImageLayersPanelProps {
  readonly className?: string;
}

type BoxField = "x" | "y" | "width" | "height";

/**
 * The selected layer's name: typed freely, and set on the layer when the
 * field is left or Enter is pressed, as one step. It shows the plan's name
 * again whenever that changes, such as after an undo.
 */
function NameField(props: {
  readonly layerKey: string | null;
  readonly name: string;
  readonly placeholder: string;
  readonly onRename: (value: string) => void;
}): ReactNode {
  const { layerKey, name, onRename } = props;
  const [value, setValue] = useState(name);
  // What was typed follows the plan's name whenever that changes, and so
  // does another layer with the same name. Reset while rendering, rather
  // than in an effect that would render twice.
  const [shown, setShown] = useState({ layerKey, name });
  if (shown.layerKey !== layerKey || shown.name !== name) {
    setShown({ layerKey, name });
    setValue(name);
  }
  return (
    <TextField
      autoComplete="off"
      value={value}
      placeholder={props.placeholder}
      disabled={layerKey === null}
      onValueChange={setValue}
      onBlur={() => {
        onRename(value);
        // What the plan took, which may be shorter than what was typed.
        setValue(fitLayerName(value));
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") onRename(event.currentTarget.value);
      }}
    />
  );
}

/**
 * The layers panel (docs/adr/0013), shown while the layers tool is on: the
 * list of layers, the top one first, each with a button that shows or hides
 * it; buttons that move the selected layer up and down the stack, mirror
 * it, copy it and delete it; and its name, place, size, turn and opacity as
 * fields, with its own kind's under them. Everything a frame on the stage
 * does with a drag, the panel does with a button or a field (WCAG 2.5.7).
 *
 * The list is ui's `ReorderableList`: one tab stop, the Up and Down arrows
 * between layers, `Alt` (`Option` on macOS) with them to move the focused
 * layer up and down the stack, and `Delete` to remove it: pdf-sdk's keys
 * for its pages.
 *
 * The panel keeps its size, whatever is selected: with no layer selected its
 * fields are disabled, and keep their place. Where the inspector sits under
 * the stage, a panel that grew would shrink the stage, and move the image
 * under the pointer.
 *
 * @public
 */
export function ImageLayersPanel(props: ImageLayersPanelProps): ReactNode {
  const [state, editor] = useImageEditorState();
  const { plan } = useImageDocument();
  const messages = useImageMessages();
  const actions = useLayerActions();
  const session = useImageSession();
  const panel = useRef<HTMLElement>(null);
  /** What the session refused, such as a copy over the limit, until the next action. */
  const [problem, setProblem] = useState<unknown>(null);

  // A focus the tool asked for, once: the selected layer in the list when
  // the layers start, or the text field of a text layer just added.
  const focus = state.tool === "layers" ? state.layers?.focus : undefined;
  useEffect(() => {
    if (!focus) return;
    panel.current
      ?.querySelector<HTMLElement>(
        focus === "text"
          ? ".hm-image-layers-text textarea"
          : ".hm-image-layers-list [data-hm-tab-stop]",
      )
      ?.focus();
    editor.set((current) =>
      current.layers?.focus
        ? { ...current, layers: { selected: current.layers.selected } }
        : current,
    );
  }, [focus, editor]);

  if (state.tool !== "layers" || !state.layers || !plan) return null;
  // The stage may show a gesture's plan; the panel lists what's committed.
  const { layers } = plan;
  const selectedIndex = layers.findIndex((layer) => layer.key === state.layers?.selected);
  const selected = layers[selectedIndex];
  // Its box, when it has one: a drawing and an arrow don't, and their fields
  // for one keep their place, disabled (docs/adr/0014).
  const boxed = selected && isBoxedLayer(selected) ? selected : undefined;
  const count = layers.length;

  /** Runs an action, and keeps what the session refused to say why nothing changed. */
  const run = (action: () => void) => {
    try {
      action();
      setProblem(null);
    } catch (error) {
      setProblem(error);
    }
  };

  /** The list shows the top layer first: a place in it, as a place in the plan. */
  const moveTo = (key: string, toIndex: number) => {
    const from = layers.findIndex((layer) => layer.key === key);
    const to = count - 1 - toIndex;
    if (from < 0) return;
    // The layer that's moved is the one that's selected, as with the buttons.
    actions.select(key);
    // One place at a time, as the keys and the buttons move it.
    if (Math.abs(to - from) === 1) run(() => actions.shift(key, to > from ? 1 : -1));
  };
  const removeFromList = (key: string) =>
    run(() => {
      // The list keeps focus on the layer now in its place; with none left, it goes to Done.
      if (actions.remove(key) === null) {
        panel.current?.querySelector<HTMLElement>(".hm-image-layers-done")?.focus();
      }
    });

  // The fields are always there, so the panel keeps its size, and the stage
  // with it: with no layer selected they're disabled, and their place is kept.
  const boxField = (name: BoxField) => {
    const length = name === "width" || name === "height";
    // A drawing has a place, its origin, and no size; an arrow has its own fields.
    const placedLayer = boxed ?? (!length && selected?.kind === "drawing" ? selected : undefined);
    return (
      <Field key={name} label={messages.t(`layers.${name}`)}>
        <NumberField
          value={
            boxed
              ? boxed[name]
              : placedLayer?.kind === "drawing" && !length
                ? placedLayer[name as "x" | "y"]
                : length
                  ? 1
                  : 0
          }
          min={length ? 1 : -MAX_SCENE_COORDINATE}
          max={MAX_SCENE_COORDINATE}
          step={1}
          largeStep={10}
          disabled={!placedLayer}
          onValueChange={(value) => {
            if (placedLayer) run(() => actions.set(placedLayer.key, { [name]: Math.round(value) }));
          }}
        />
      </Field>
    );
  };
  const rename = (value: string) => {
    // Read from the session, not this render: Enter and the blur after it
    // can both arrive before the panel renders again.
    const current = session.getSnapshot().plan?.layers.find((layer) => layer.key === selected?.key);
    const name = fitLayerName(value);
    if (current && name !== current.name) run(() => actions.set(current.key, { name }));
  };

  return (
    <section
      ref={panel}
      className={["hm-image-layers-panel", props.className].filter(Boolean).join(" ")}
      aria-label={messages.t("layers.panel")}
    >
      <section className="hm-image-layers-list" aria-label={messages.t("layers.list")}>
        {count === 0 ? (
          <p className="hm-image-layers-none">{messages.t("layers.none")}</p>
        ) : (
          // ui's list: one tab stop, the arrows between rows, Alt or Option
          // with Up and Down to move a layer, Delete to remove it.
          <ReorderableList
            label={messages.t("layers.list")}
            selectedId={selected?.key ?? null}
            onSelectedChange={(key) => actions.select(key)}
            onMove={moveTo}
            onRemove={removeFromList}
            // A move is announced in the editor's own words, for the keys and the buttons alike.
            announceMoves={false}
          >
            {/* The top layer first, as it's seen. */}
            {[...layers].reverse().map((layer) => {
              const name = layerLabel(layer, messages);
              return (
                <ReorderableListItem
                  key={layer.key}
                  id={layer.key}
                  label={name}
                  data-hm-layer={layer.key}
                  classNames={{ item: "hm-image-layer-select" }}
                  controls={[
                    <IconButton
                      key="visibility"
                      className="hm-image-layer-visibility"
                      label={messages.t("layers.visible", { name })}
                      icon={layer.visible ? <VisibleIcon /> : <HiddenIcon />}
                      pressed={layer.visible}
                      onClick={() => run(() => actions.set(layer.key, { visible: !layer.visible }))}
                    />,
                  ]}
                >
                  {name}
                </ReorderableListItem>
              );
            })}
          </ReorderableList>
        )}
      </section>
      {/* biome-ignore lint/a11y/useSemanticElements: a named group of buttons, not a form's fieldset */}
      <div
        className="hm-image-layers-order"
        role="group"
        aria-label={messages.t("layers.selected")}
      >
        <IconButton
          label={messages.t("layers.moveUp")}
          icon={<MoveUpIcon />}
          disabled={!selected || selectedIndex === count - 1}
          focusableWhenDisabled
          // The list's own key for it, while focus is in the list.
          aria-keyshortcuts="Alt+ArrowUp"
          onClick={() => selected && run(() => actions.shift(selected.key, 1))}
        />
        <IconButton
          label={messages.t("layers.moveDown")}
          icon={<MoveDownIcon />}
          disabled={!selected || selectedIndex === 0}
          focusableWhenDisabled
          aria-keyshortcuts="Alt+ArrowDown"
          onClick={() => selected && run(() => actions.shift(selected.key, -1))}
        />
        <IconButton
          label={messages.t("layers.mirror")}
          icon={<FlipHorizontalIcon />}
          // Pressed while the layer is mirrored about its box (docs/adr/0009).
          pressed={boxed?.flipX ?? false}
          disabled={!boxed}
          focusableWhenDisabled
          onClick={() => boxed && run(() => actions.set(boxed.key, { flipX: !boxed.flipX }))}
        />
        <IconButton
          label={messages.t("layers.duplicate")}
          icon={<DuplicateIcon />}
          disabled={!selected}
          focusableWhenDisabled
          onClick={() => selected && run(() => actions.duplicate(selected.key))}
        />
        <IconButton
          label={messages.t("layers.remove")}
          icon={<DeleteIcon />}
          disabled={!selected}
          focusableWhenDisabled
          onClick={() => selected && run(() => void actions.remove(selected.key))}
        />
      </div>
      {problem === null ? null : (
        <p className="hm-image-layers-problem" role="alert">
          {messages.error(problem)}
        </p>
      )}
      <div className="hm-image-layers-fields" data-hm-inactive={selected ? undefined : ""}>
        <Field label={messages.t("layers.name")} className="hm-image-layers-name">
          <NameField
            layerKey={selected?.key ?? null}
            name={selected?.name ?? ""}
            placeholder={selected ? layerLabel({ ...selected, name: "" }, messages) : ""}
            onRename={rename}
          />
        </Field>
        {(["x", "y", "width", "height"] as const).map(boxField)}
        <Field label={messages.t("layers.rotation")}>
          <NumberField
            value={boxed ? boxed.rotation / 10 : 0}
            min={0}
            max={359.9}
            step={1}
            largeStep={15}
            disabled={!boxed}
            onValueChange={(value) => {
              if (!boxed) return;
              // The plan holds tenths of a degree, from 0 to 3599.
              const rotation = ((Math.round(value * 10) % 3_600) + 3_600) % 3_600;
              run(() => actions.set(boxed.key, { rotation }));
            }}
          />
        </Field>
        <Field label={messages.t("layers.opacity")}>
          <NumberField
            value={selected ? selected.opacity : 100}
            min={0}
            max={100}
            step={1}
            largeStep={10}
            disabled={!selected}
            onValueChange={(value) => {
              if (selected) run(() => actions.set(selected.key, { opacity: Math.round(value) }));
            }}
          />
        </Field>
      </div>
      {/*
        A text layer's fields, a shape's and an arrow's share one place,
        sized for the tallest, so selecting another kind of layer never
        moves the stage. The ones that don't apply are hidden, from sight,
        focus and assistive technology alike. An image layer and a drawing
        have none of their own.
      */}
      <div className="hm-image-layer-kinds">
        <TextLayerFields
          layer={selected?.kind === "text" ? selected : null}
          actions={actions}
          run={run}
        />
        <ShapeLayerFields
          layer={selected?.kind === "shape" ? selected : null}
          actions={actions}
          run={run}
        />
        <ArrowLayerFields
          layer={selected?.kind === "arrow" ? selected : null}
          actions={actions}
          run={run}
        />
      </div>
      <div className="hm-image-layers-actions">
        <Button variant="primary" className="hm-image-layers-done" onClick={() => actions.done()}>
          {messages.t("layers.done")}
        </Button>
      </div>
    </section>
  );
}
