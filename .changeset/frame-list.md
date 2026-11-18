---
"@hussmartinez/image-sdk": minor
---

An animation's frames can be edited in the editor ([ADR 0011](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0011-gif-and-animation.md)). A Frames tool (`image.frames`, shortcut `F`) is on the toolbar for an animated image. It opens a panel in the inspector that lists the frames in the order they play, each with a thumbnail and a name such as "Frame 3, 0.10 seconds".

- **Editing:** move a frame earlier or later, duplicate it, delete it, reverse the order, set a frame's delay or every frame's, and choose whether the animation plays once, a number of times or for ever. Each is one undo step, and moves, copies, deletions and reversals are announced. The list works from the keyboard as the layers list does: the arrows between frames, `Alt` (`Option` on macOS) with Up and Down to move one, and `Delete` to remove one.
- **The selected frame is the frame shown,** so the list, the scrubber and the stage always agree. Selecting a frame pauses playing.
- **Thumbnails are drawn only for the rows in view,** at most 24 at once, and released when their rows scroll away or the panel closes.
- **`ImageFramesPanel`** is exported from `./react` for hosts that lay out their own editor, as `ImageLayersPanel` is. `ImageEditorState["tool"]` can now be `"frames"`.
- **The toolbar leaves out a group with no tool to show,** such as the frames group for a still image, so a still's toolbar is as it was.
