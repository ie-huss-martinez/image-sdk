import {
  Button,
  DeleteIcon,
  DuplicateIcon,
  Field,
  IconButton,
  MoveDownIcon,
  MoveUpIcon,
  NumberField,
  ReorderableList,
  ReorderableListItem,
  SegmentedControl,
} from "@hussmartinez/ui/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { MAX_FRAME_DELAY } from "../../core/model/plan.js";
import { useImageDocument, useImageEditorState, useImageInternals } from "../hooks.js";
import { shownFrame } from "../stage/ImageStage.js";
import { createThumbnailSlots, FrameThumbnail } from "./FrameThumbnail.js";
import { frameSeconds, useFrameActions } from "./use-frames.js";

/**
 * Props of {@link ImageFramesPanel}.
 *
 * @public
 */
export interface ImageFramesPanelProps {
  readonly className?: string;
}

type LoopKind = "once" | "repeat" | "forever";
const kindOf = (loop: number | null): LoopKind =>
  loop === null ? "once" : loop === 0 ? "forever" : "repeat";

/**
 * The frames panel (docs/adr/0011), shown while the frames tool is on: an
 * animation's frames in the order they play, each with its thumbnail and
 * named by its place and delay, such as "Frame 3, 0.10 seconds"; buttons
 * that move the selected frame earlier and later, copy it and delete it,
 * and reverse the order; the selected frame's delay; and how many times
 * the animation plays. The frame selected is the frame the stage shows.
 *
 * The list is ui's `ReorderableList`, as the layers' is: one tab stop, the
 * Up and Down arrows between frames, `Alt` (`Option` on macOS) with them to
 * move the focused frame, and `Delete` to remove it. Every edit is one undo
 * step, and the panel says what it did.
 *
 * Thumbnails are drawn only for the rows in view, at most
 * `MAX_FRAME_THUMBNAILS` at a time, and released when their rows scroll out
 * of view.
 *
 * @public
 */
export function ImageFramesPanel(props: ImageFramesPanelProps): ReactNode {
  const [state] = useImageEditorState();
  const { plan } = useImageDocument();
  const { engine, messages } = useImageInternals();
  const actions = useFrameActions();
  const panel = useRef<HTMLElement>(null);
  const slots = useMemo(() => createThumbnailSlots(), []);
  /** What the session refused, such as a copy over the limit, until the next action. */
  const [problem, setProblem] = useState<unknown>(null);
  const on = state.tool === "frames" && plan?.animation != null;
  const loop = plan?.animation?.loop ?? null;
  /** The number of repeats offered when Repeats is chosen. */
  const [repeats, setRepeats] = useState(loop !== null && loop > 0 ? loop : 1);
  // The last count of repeats, offered again when Repeats is chosen after
  // Once or For ever. Followed while rendering, as the loop changes, rather
  // than in an effect that would render twice.
  const [seenLoop, setSeenLoop] = useState(loop);
  if (loop !== seenLoop) {
    setSeenLoop(loop);
    if (loop !== null && loop > 0) setRepeats(loop);
  }

  // The list takes focus when the panel opens, on the frame shown.
  useEffect(() => {
    if (!on) return;
    panel.current?.querySelector<HTMLElement>(".hm-image-frames-list [data-hm-tab-stop]")?.focus();
  }, [on]);

  const animation = plan?.animation;
  if (!on || !plan || !animation) return null;
  const { frames } = animation;
  const count = frames.length;
  const index = shownFrame(plan, state.playback.frame);
  const selected = frames[index];
  const keyAt = new Map(frames.map((frame, at) => [frame.key, at]));

  /** Runs an action, and keeps what the session refused to say why nothing changed. */
  const run = (action: () => void) => {
    try {
      action();
      setProblem(null);
    } catch (error) {
      setProblem(error);
    }
  };
  const at = (key: string) => keyAt.get(key) ?? -1;
  const moveTo = (key: string, toIndex: number) => {
    const from = at(key);
    if (from < 0) return;
    actions.select(from);
    // One place at a time, as the keys and the buttons move it.
    if (Math.abs(toIndex - from) === 1) run(() => actions.shift(from, toIndex > from ? 1 : -1));
  };
  const removeFromList = (key: string) => {
    if (count > 1) run(() => actions.remove(at(key)));
  };
  const setLoopKind = (kind: LoopKind) =>
    run(() => actions.setLoop(kind === "once" ? null : kind === "forever" ? 0 : repeats));

  return (
    <section
      ref={panel}
      className={["hm-image-frames-panel", props.className].filter(Boolean).join(" ")}
      aria-label={messages.t("frames.panel")}
    >
      <section className="hm-image-frames-list" aria-label={messages.t("frames.list")}>
        <ReorderableList
          label={messages.t("frames.list")}
          selectedId={selected?.key ?? null}
          onSelectedChange={(key) => actions.select(at(key))}
          onMove={moveTo}
          onRemove={removeFromList}
          // A move is announced in the editor's own words, for the keys and the buttons alike.
          announceMoves={false}
        >
          {frames.map((frame, place) => {
            const name = messages.t("frames.row", {
              index: place + 1,
              seconds: frameSeconds(frame.delay, messages.locale),
            });
            return (
              <ReorderableListItem
                key={frame.key}
                id={frame.key}
                label={name}
                classNames={{ item: "hm-image-frame-row" }}
              >
                <FrameThumbnail engine={engine} plan={plan} frame={frame.frame} slots={slots} />
                <span className="hm-image-frame-name">{name}</span>
              </ReorderableListItem>
            );
          })}
        </ReorderableList>
      </section>
      {/* biome-ignore lint/a11y/useSemanticElements: a named group of buttons, not a form's fieldset */}
      <div
        className="hm-image-frames-order"
        role="group"
        aria-label={messages.t("frames.selected")}
      >
        <IconButton
          label={messages.t("frames.moveEarlier")}
          icon={<MoveUpIcon />}
          disabled={index === 0}
          focusableWhenDisabled
          // The list's own key for it, while focus is in the list.
          aria-keyshortcuts="Alt+ArrowUp"
          onClick={() => run(() => actions.shift(index, -1))}
        />
        <IconButton
          label={messages.t("frames.moveLater")}
          icon={<MoveDownIcon />}
          disabled={index === count - 1}
          focusableWhenDisabled
          aria-keyshortcuts="Alt+ArrowDown"
          onClick={() => run(() => actions.shift(index, 1))}
        />
        <IconButton
          label={messages.t("frames.duplicate")}
          icon={<DuplicateIcon />}
          onClick={() => run(() => actions.duplicate(index))}
        />
        <IconButton
          label={messages.t("frames.remove")}
          icon={<DeleteIcon />}
          // An animation keeps at least one frame.
          disabled={count < 2}
          focusableWhenDisabled
          onClick={() => run(() => actions.remove(index))}
        />
        <Button
          variant="secondary"
          disabled={count < 2}
          onClick={() => run(() => actions.reverse())}
        >
          {messages.t("frames.reverse")}
        </Button>
      </div>
      {problem === null ? null : (
        <p className="hm-image-frames-problem" role="alert">
          {messages.error(problem)}
        </p>
      )}
      <div className="hm-image-frames-fields">
        <Field label={messages.t("frames.delay")}>
          <NumberField
            value={(selected?.delay ?? 0) / 100}
            min={0}
            max={MAX_FRAME_DELAY / 100}
            step={0.01}
            largeStep={0.1}
            locale={messages.locale}
            // As the rows show it: hundredths, with two decimals.
            format={(value) => frameSeconds(Math.round(value * 100), messages.locale)}
            onValueChange={(value) =>
              run(() =>
                actions.setDelay(
                  index,
                  Math.min(MAX_FRAME_DELAY, Math.max(0, Math.round(value * 100))),
                ),
              )
            }
          />
        </Field>
        <Button
          variant="quiet"
          size="small"
          disabled={frames.every((frame) => frame.delay === selected?.delay)}
          onClick={() => run(() => actions.delayAll(index))}
        >
          {messages.t("frames.delayAll")}
        </Button>
        <SegmentedControl
          label={messages.t("frames.loop")}
          size="small"
          value={kindOf(loop)}
          options={(["once", "repeat", "forever"] as const).map((kind) => ({
            value: kind,
            label: messages.t(`frames.loops.${kind}`),
          }))}
          onValueChange={(value) => setLoopKind(value as LoopKind)}
        />
        <Field label={messages.t("frames.repeats")}>
          <NumberField
            value={loop !== null && loop > 0 ? loop : repeats}
            min={1}
            max={MAX_FRAME_DELAY}
            step={1}
            largeStep={10}
            // Only a count of repeats has a number; once and for ever don't.
            disabled={kindOf(loop) !== "repeat"}
            onValueChange={(value) => {
              const next = Math.min(MAX_FRAME_DELAY, Math.max(1, Math.round(value)));
              setRepeats(next);
              run(() => actions.setLoop(next));
            }}
          />
        </Field>
      </div>
      <div className="hm-image-frames-actions">
        <Button variant="primary" onClick={() => actions.done()}>
          {messages.t("frames.done")}
        </Button>
      </div>
    </section>
  );
}
