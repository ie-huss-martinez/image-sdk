---
"@hussmartinez/image-sdk": minor
---

Add the Layers tool to the editor: a list of the plan's layers and a frame on the image for each ([ADR 0013](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0013-layers-in-the-editor.md)).

- **The tool.** `image.layers`, in the default toolbar after Redact, with the `L` shortcut. Like the editor's other single-key shortcuts, it works only while focus is inside the editor, and never in a field.
- **In the panel.** The layers, the top one first: each has a button that selects it and one that shows or hides it. Under the list, buttons move the selected layer up and down the stack, duplicate it and delete it, and fields set its name, position, size, turn and opacity.
- **On the stage.** Each layer has a frame, turned as the layer is. A press selects the top layer under the pointer, a drag moves it, and the selected frame's handles resize it. A hidden layer's frame shows while it's selected.
- **Keys.** On a focused frame, the arrow keys move the layer by a pixel, `Shift` with an arrow resizes it, `Delete` or `Backspace` removes it, and `Escape` closes the layers: the crop frame's keys. In the list, `Alt` (`Option` on macOS) with the Up or Down arrow moves the focused layer up or down the stack, and `Delete` or `Backspace` removes it.
- **Each gesture is one undo step,** and the preview shows the layer where it's being moved.
- **Building blocks and API:** `ImageLayersPanel`; and `layers` on `ImageEditorState`, with `"layers"` as a value of its `tool`.

This release doesn't add layers from the editor yet: the text, shape and image tools come next. A layer comes from a plan, from `image.insertLayers`, or from `session.insertImage(file)`.

If you pass your own `toolbar` groups, add `"image.layers"` to show the tool. If you render the building blocks yourself, render `ImageLayersPanel` with the others: `ImageStage` shows the frames whenever the tool is active.
