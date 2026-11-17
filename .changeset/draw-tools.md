---
"@hussmartinez/image-sdk": minor
---

Add the Draw tool and the arrow tool to the editor ([ADR 0015](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0015-drawing-in-the-editor.md)).

- **Draw.** `image.draw`, in the default toolbar before Layers, with the `D` shortcut. Drag across the image to draw a stroke: it shows as it's drawn, and is one undo step when the pointer lifts. A press without a drag is a dot. `Escape` ends a stroke in progress with nothing added.
- **Pen and highlighter.** The panel chooses between them, and sets the colour and the width. A highlighter draws wide, see-through strokes that don't darken where they cross. "Remove last stroke" takes the last stroke back.
- **One drawing, many strokes.** Strokes go into one drawing layer, so a signature is one row in the layers list. Starting Draw with a drawing selected in the layers adds to it.
- **Arrows.** `image.add-arrow`, in the "Add" group, adds an arrow across the middle of the image, pointing right. In the layers its frame has a handle on each end; the arrow keys move it, and `Shift` with an arrow moves its tip. The panel has fields for both ends, its colour and its width.
- **Drawings in the layers.** A drawing has a frame around its strokes: drag it or use the arrow keys to move it.
- **Drawing needs a pointer:** a mouse, a pen or a finger. The panel says so. The arrow tool is the keyboard's way to point at something.
- **Building blocks and API:** `ImageDrawPanel`; and `draw` on `ImageEditorState`, with `"draw"` as a value of its `tool`.

If you pass your own `toolbar` groups, add `"image.draw"` and `"image.add-arrow"` to show the tools. If you render the building blocks yourself, render `ImageDrawPanel` with the others: `ImageStage` takes the strokes whenever the tool is active.
