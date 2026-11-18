import { createStore, type Store } from "@hussmartinez/sdk-core";
import { act, type ReactNode, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageAnimation } from "../../core/model/plan.js";
import { IDLE, type ImageEditorState } from "../../features/editor-state.js";
import { usePlayback } from "./AnimationBar.js";

/**
 * Playing's timer against the editor's state (docs/adr/0011), on a fake
 * clock. A pause or a seek reaches the store at once, but the timer it
 * replaces is cleared only when React renders again: a tick already due
 * by then must not undo it.
 */

const animation: ImageAnimation = {
  loop: 0,
  frames: [0, 1, 2, 3].map((frame) => ({ key: `f${frame}`, frame, delay: 10 })),
};

function Player(props: { readonly editor: Store<ImageEditorState> }): ReactNode {
  const { editor } = props;
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  usePlayback(animation, state.playback, editor);
  return null;
}

let root: Root | undefined;
let host: HTMLElement | undefined;
let editor: Store<ImageEditorState>;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  editor = createStore<ImageEditorState>({ ...IDLE, playback: { frame: 0, playing: true } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<Player editor={editor} />));
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  vi.useRealTimers();
});

const playback = () => editor.getSnapshot().playback;

describe("playing's timer (docs/adr/0011)", () => {
  it("shows the next frame at each frame's delay while it plays", async () => {
    await act(async () => vi.advanceTimersByTime(100));
    expect(playback()).toEqual({ frame: 1, playing: true });
    await act(async () => vi.advanceTimersByTime(100));
    expect(playback()).toEqual({ frame: 2, playing: true });
  });

  it("doesn't undo a pause that arrives just before its tick", async () => {
    // The pause reaches the store, and the tick fires before React renders.
    editor.set((state) => ({ ...state, playback: { ...state.playback, playing: false } }));
    vi.advanceTimersByTime(100);
    await act(async () => {});
    expect(playback()).toEqual({ frame: 0, playing: false });
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(playback()).toEqual({ frame: 0, playing: false });
  });

  it("doesn't undo a seek that arrives just before its tick", async () => {
    editor.set((state) => ({ ...state, playback: { frame: 3, playing: false } }));
    vi.advanceTimersByTime(100);
    await act(async () => {});
    expect(playback()).toEqual({ frame: 3, playing: false });
  });

  it("goes on from a frame chosen while it plays, at that frame's own time", async () => {
    // Moved while playing, it carries on from there: the old tick is dropped.
    editor.set((state) => ({ ...state, playback: { frame: 2, playing: true } }));
    vi.advanceTimersByTime(100);
    await act(async () => {});
    expect(playback()).toEqual({ frame: 2, playing: true });
    await act(async () => vi.advanceTimersByTime(100));
    expect(playback()).toEqual({ frame: 3, playing: true });
  });
});
