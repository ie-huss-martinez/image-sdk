---
"@hussmartinez/image-sdk": minor
---

Add the Redact tool to the editor ([ADR 0010](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0010-redaction.md)).

- **The tool.** `image.redact`, in the default toolbar after Crop, with the `R` shortcut. Like the editor's other single-key shortcuts, it works only while focus is inside the editor, and never in a field.
- **On the stage.** Each redacted area is a frame over the image. Drag across the image to draw one. On a focused frame, the arrow keys move it by a pixel, `Shift` with an arrow resizes it, `Delete` or `Backspace` removes it, and `Escape` ends redacting: the crop frame's keys.
- **In the panel.** A solid colour (black or white) or pixelation, with a warning that pixelation may not hide text; "Add area", which needs no dragging; number fields for the selected area's position and size; and a list of every area, each with a button to remove it.
- **Each gesture is one undo step,** and the preview shows the area redacted while it's being drawn or moved.
- **The export summary** says how many areas are redacted, and warns when any is pixelated.
- **Building blocks and API:** `ImageRedactPanel`; `createImageKey`, for the keys new redactions need; `sceneRectToComposition`, `compositionRectToScene` and `fitRedactionRegion`, the geometry that places an area's frame; and `redact` on `ImageEditorState`, with `"redact"` as a value of its `tool`.

The editor offers black and white. The plan holds any `#rrggbb` colour, so a host that builds its own commands isn't limited to those.

If you pass your own `toolbar` groups, add `"image.redact"` to show the tool. If you render the building blocks yourself, render `ImageRedactPanel` with the others: `ImageStage` shows the frames whenever the tool is active.

This release needs `@hussmartinez/ui` 0.8.0 or later, for the tool's icon.
