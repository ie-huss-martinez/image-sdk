import {
  Button,
  DeleteIcon,
  DuplicateIcon,
  Field,
  HiddenIcon,
  IconButton,
  MoveDownIcon,
  MoveUpIcon,
  NumberField,
  TextField,
  VisibleIcon,
} from "@hussmartinez/ui/react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { MAX_SCENE_COORDINATE } from "../../core/model/plan.js";
import {
  useImageDocument,
  useImageEditorState,
  useImageMessages,
  useImageSession,
} from "../hooks.js";
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: another layer with the same name also resets what was typed
  useEffect(() => setValue(name), [layerKey, name]);
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
 * list of layers, the top one first, each with a button that selects it and
 * one that shows or hides it; buttons that move the selected layer up and
 * down the stack, copy it and delete it; and its name, place, size, turn and
 * opacity as fields. Everything a frame on the stage does with a drag, the
 * panel does with a button or a field (WCAG 2.5.7).
 *
 * While focus is in the list, `Alt` (`Option` on macOS) with the Up and
 * Down arrows moves the focused layer up and down the stack, and `Delete`
 * removes it: pdf-sdk's keys for its pages.
 *
 * The panel keeps its size, whatever is selected: with no layer selected its
 * fields are disabled, and keep their place. Where the inspector sits under
 * the stage, a panel that grew would shrink the stage, and move the image
 * under the pointer.
 *
 * @public
 */
export function ImageLayersPanel(props: ImageLayersPanelProps): ReactNode {
  const [state] = useImageEditorState();
  const { plan } = useImageDocument();
  const messages = useImageMessages();
  const actions = useLayerActions();
  const session = useImageSession();
  const list = useRef<HTMLUListElement>(null);
  /** What the session refused, such as a copy over the limit, until the next action. */
  const [problem, setProblem] = useState<unknown>(null);
  /** The row's button that takes focus back once the list has rendered: moving a row can drop it. */
  const focusNext = useRef<{ key: string; visibility: boolean } | null>(null);
  useEffect(() => {
    const next = focusNext.current;
    if (!next) return;
    focusNext.current = null;
    // Only when the move dropped focus, or left it in the list: never taken
    // from somewhere else it has gone since.
    const active = document.activeElement;
    if (active && active !== document.body && !list.current?.contains(active)) return;
    list.current
      ?.querySelector<HTMLElement>(
        `[data-hm-layer="${CSS.escape(next.key)}"] ${
          next.visibility ? ".hm-image-layer-visibility" : ".hm-image-layer-select"
        }`,
      )
      ?.focus();
  });

  if (state.tool !== "layers" || !state.layers || !plan) return null;
  // The stage may show a gesture's plan; the panel lists what's committed.
  const { layers } = plan;
  const selectedIndex = layers.findIndex((layer) => layer.key === state.layers?.selected);
  const selected = layers[selectedIndex];
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

  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const key = target?.closest<HTMLElement>("[data-hm-layer]")?.dataset["hmLayer"];
    if (key === undefined || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const visibility = target?.closest(".hm-image-layer-visibility") != null;
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      // Taken even at the top and the bottom, where there's nowhere to move:
      // the page behind never scrolls instead.
      event.preventDefault();
      event.stopPropagation();
      actions.select(key);
      const by = event.key === "ArrowUp" ? 1 : -1;
      const to = layers.findIndex((layer) => layer.key === key) + by;
      if (to < 0 || to >= count) return;
      focusNext.current = { key, visibility };
      run(() => actions.shift(key, by));
      return;
    }
    if (!event.altKey && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      event.stopPropagation();
      run(() => {
        const next = actions.remove(key);
        // Focus goes to the layer now in its place, or to Done when none is left.
        if (next !== null) focusNext.current = { key: next, visibility: false };
        else {
          list.current
            ?.closest(".hm-image-layers-panel")
            ?.querySelector<HTMLElement>(".hm-image-layers-done")
            ?.focus();
        }
      });
    }
  };

  // The fields are always there, so the panel keeps its size, and the stage
  // with it: with no layer selected they're disabled, and their place is kept.
  const boxField = (name: BoxField) => {
    const length = name === "width" || name === "height";
    return (
      <Field key={name} label={messages.t(`layers.${name}`)}>
        <NumberField
          value={selected ? selected[name] : length ? 1 : 0}
          min={length ? 1 : -MAX_SCENE_COORDINATE}
          max={MAX_SCENE_COORDINATE}
          step={1}
          largeStep={10}
          disabled={!selected}
          onValueChange={(value) => {
            if (selected) run(() => actions.set(selected.key, { [name]: Math.round(value) }));
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
      className={["hm-image-layers-panel", props.className].filter(Boolean).join(" ")}
      aria-label={messages.t("layers.panel")}
    >
      <section className="hm-image-layers-list" aria-label={messages.t("layers.list")}>
        {count === 0 ? (
          <p className="hm-image-layers-none">{messages.t("layers.none")}</p>
        ) : (
          // The keys act on the row that holds focus, on its buttons.
          <ul ref={list} onKeyDown={onListKeyDown}>
            {/* The top layer first, as it's seen. */}
            {[...layers].reverse().map((layer) => {
              const name = layerLabel(layer, messages);
              return (
                <li key={layer.key} data-hm-layer={layer.key}>
                  <Button
                    variant="secondary"
                    className="hm-image-layer-select"
                    pressed={layer.key === selected?.key}
                    aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown Delete"
                    onClick={() => actions.select(layer.key)}
                  >
                    {name}
                  </Button>
                  <IconButton
                    className="hm-image-layer-visibility"
                    label={messages.t("layers.visible", { name })}
                    icon={layer.visible ? <VisibleIcon /> : <HiddenIcon />}
                    pressed={layer.visible}
                    onClick={() => run(() => actions.set(layer.key, { visible: !layer.visible }))}
                  />
                </li>
              );
            })}
          </ul>
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
          onClick={() => selected && run(() => actions.shift(selected.key, 1))}
        />
        <IconButton
          label={messages.t("layers.moveDown")}
          icon={<MoveDownIcon />}
          disabled={!selected || selectedIndex === 0}
          focusableWhenDisabled
          onClick={() => selected && run(() => actions.shift(selected.key, -1))}
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
            value={selected ? selected.rotation / 10 : 0}
            min={0}
            max={359.9}
            step={1}
            largeStep={15}
            disabled={!selected}
            onValueChange={(value) => {
              if (!selected) return;
              // The plan holds tenths of a degree, from 0 to 3599.
              const rotation = ((Math.round(value * 10) % 3_600) + 3_600) % 3_600;
              run(() => actions.set(selected.key, { rotation }));
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
      <div className="hm-image-layers-actions">
        <Button variant="primary" className="hm-image-layers-done" onClick={() => actions.done()}>
          {messages.t("layers.done")}
        </Button>
      </div>
    </section>
  );
}
