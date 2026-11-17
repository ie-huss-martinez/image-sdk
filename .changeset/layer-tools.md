---
"@hussmartinez/image-sdk": minor
---

Add the tools that add text, shapes and images to an image, and the fields that edit them ([ADR 0013](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0013-layers-in-the-editor.md)).

- **Four tools,** in the default toolbar before Layers: `image.add-text` (shortcut `T`), `image.add-rectangle`, `image.add-ellipse` and `image.add-image`. Each adds a layer in the middle of the image as it's shown, the right way up, as one undo step, and shows the layers with it selected.
- **Text** starts empty, with focus in its field. It's drawn as it's typed, and the typing is one undo step when it pauses. Its panel sets the font (sans, serif or mono, drawn by the device's fonts), alignment, bold and colour. Pasted text is taken as the plan takes it: line breaks become line feeds, and what text can't hold is dropped.
- **Shapes** start as a red outline. Their panel turns the fill and the outline on and off and sets their colours and the outline's width; a shape always keeps one of the two.
- **Images** are chosen in the tool's own file picker and stay on the device. `insertImage(file)` is new on `ImageEditorHandle` and on `<hm-image-editor>`, for a file the host has.
- **Colours** are any `#rrggbb`, typed or picked from six swatches.
- **What can't be added,** such as a file that isn't an image or a layer over `maxLayers`, is said on the stage, and nothing changes.

On a mirrored image a new layer is mirrored too, because a flip mirrors the whole scene.

**API changes**

- `ImageEditorHandle` and the element gain `insertImage(file)`.
- `ImageEditorState` gains `error`, and `focus` on `layers`.
- `ImageToolContext` gains `chooseLayerImage`. If you build your own tool context for `ImageToolbar`, add it: a function that asks for an image and passes it to `session.insertImage`.
- If you pass your own `toolbar` groups, add the four tool ids to show them.

This release needs `@hussmartinez/ui` 0.9.0 or later, for its colour field and multi-line text field.
