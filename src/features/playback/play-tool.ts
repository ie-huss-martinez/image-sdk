import { defineTool } from "@hussmartinez/sdk-core";
import type { ImageTool } from "../tool-types.js";
import { withPlaying } from "./playback.js";

/**
 * Plays and pauses an animation (docs/adr/0011), with the family's
 * play-pause shortcut, `Space` (sdk-core ADR 0030): from anywhere in the
 * editor, never on a field or a control, which keep Space as their own. It
 * isn't on the toolbar: the animation's bar has Play.
 */
export const playTool: ImageTool = /* @__PURE__ */ defineTool({
  id: "image.play",
  label: "tools.play",
  icon: "play",
  group: "playback",
  isEnabled: ({ snapshot }) => (snapshot.plan?.animation?.frames.length ?? 0) > 1,
  run: ({ session, editor }) => {
    editor.set((state) => withPlaying(state, session.getSnapshot().plan, !state.playback.playing));
  },
  shortcuts: "play-pause",
});
