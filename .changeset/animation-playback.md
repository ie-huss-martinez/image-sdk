---
"@hussmartinez/image-sdk": minor
---

The editor plays an animation ([ADR 0011](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0011-gif-and-animation.md)). An animated GIF shows a bar under the stage with Play, a frame scrubber, and which frame is shown with its delay.

- **Nothing plays on its own.** An animation opens paused on its first frame. Play shows when it's pressed; `Space` plays and pauses from anywhere in the editor except on a control, as the family's play-pause shortcut does. Moving the scrubber pauses.
- **A new tool, `image.play`,** carries that shortcut. It isn't on the toolbar, since the bar has Play; a host that lists its own `tools` adds it to keep Space.
- **Playing keeps the file's timing** and its loop count, and stops on the last frame when the count is spent. A delay under 2 hundredths of a second plays as 10, as browsers play it; the plan and the export keep it as it is.
- **The export dialog exports the frame shown** to PNG, JPEG and WebP, and every frame to GIF. Opening it stops playing.
- **`ImageEditorState` gains `playback`,** the frame shown and whether it's playing: view state, outside the plan and its undo history.
- A still image's editor looks as it did: the bar only appears for an animation.
