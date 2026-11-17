# 0015. Drawing in the editor: the draw tool, and frames for drawings and arrows

- **Status:** Accepted
- **Date:** 2026-11-17
- **Builds on:** [ADR 0014](0014-drawing-strokes-and-arrows.md) (strokes, arrows and what the tools build), [ADR 0013](0013-layers-in-the-editor.md) (the layers' list, frames and keys), [ADR 0007](0007-editor-shell.md) (gestures as transient plans) and [ADR 0009](0009-scene-space-layers-and-plan-versions.md) (keyboard access)

## Context

The plan holds drawings and arrows, and the renderer draws them ([ADR 0014](0014-drawing-strokes-and-arrows.md)). The editor can list them, and nothing more: nobody can draw a stroke or aim an arrow.

ADR 0014 already fixed what the tools build: a stroke is one command and one undo step; it joins a drawing whose opacity matches, or starts one; the preview runs the same simplifier as the commit; there's no eraser; and freehand drawing needs a pointer, with the arrow as the keyboard's way. This record decides the controls, the frames and the keys.

## Decision

### The draw tool

`image.draw` is a tool like Redact and Layers: a button in the default toolbar before Layers, the icon `pen`, and the shortcut `D`, which works only while focus is inside the editor and never in a field. While it's on, the inspector shows the draw panel, and the stage takes a pointer's strokes.

- **A press and a drag draw a stroke.** It's on the stage as a transient plan while it's drawn, simplified as it will be committed, and the release makes it one undoable step ([ADR 0007](0007-editor-shell.md), [ADR 0014](0014-drawing-strokes-and-arrows.md)). A press without a drag is a dot.
- **The tolerance is one screen pixel,** in whole scene pixels, at least 1: `max(1, round(1 / scale))`.
- **Every sample the browser has is used:** a pointer event's coalesced events, where the browser gives them.
- **`Escape` ends a stroke in progress with nothing added,** wherever focus is, and so does a lost pointer. With no stroke in progress the key isn't the tool's.
- **Touch draws too:** the surface sets `touch-action: none`, so a finger draws instead of scrolling the page.
- **It ends** with its button, `D`, the panel's Done, another tool, or Export ([ADR 0007](0007-editor-shell.md)). Focus stays on the tool's button when it starts: the surface has nothing to focus.

### Pen and highlighter

Two modes, one model: a highlighter is a wide stroke in a see-through drawing ([ADR 0014](0014-drawing-strokes-and-arrows.md)).

| Mode | The drawing's opacity | Starts with |
|---|---|---|
| Pen | 100 | Red, as wide as a new shape's outline: a hundredth of the image's shorter side, at least 2 pixels |
| Highlighter | 40 | Yellow, six times the pen's width |

- **The panel** has the mode; the colour, any `#rrggbb` or one of the six swatches a layer's colour has; the width, from 1 to 1,024 pixels; "Remove last stroke"; and Done. It keeps its size whatever is chosen, so the stage doesn't move under a stroke.
- **Choosing isn't an edit.** The mode, colour and width are the editor's state, for the next stroke.
- **Changing the mode gives that mode's own colour and width,** and the next stroke starts a new drawing. A pen and a highlighter never share one, because the opacity is the drawing's.

### Which drawing a stroke joins

The tool has a target: the drawing its strokes join.

- **Starting the tool from the layers with a drawing selected,** when a pen can add to it, aims at that drawing.
- **Otherwise the first stroke starts a new drawing,** over every layer, with its origin where the stroke began, and the target is that drawing from then on.
- **The target must still be in the plan, at the mode's opacity.** After an undo removes it, or its opacity is changed in the layers, the next stroke starts a new drawing.
- **So a signature is one layer,** one row in the list and one layer against `maxLayers`, however many strokes it has.

### Removing strokes

- **"Remove last stroke" removes the target's last stroke,** whole, however many runs it has ([ADR 0014](0014-drawing-strokes-and-arrows.md)). It's `image.removeStrokes`, one undoable step.
- **A drawing keeps at least one stroke,** so removing its only stroke removes the drawing: `image.removeLayers`, which undo brings back whole.
- **With no target the button waits,** `aria-disabled` and still in the keyboard's order, so a keyboard user who drew with a pointer earlier, or whose stroke was drawn by someone else, can find it.
- **Undo does the same** for the stroke just drawn. The button is for the stroke before the last edit of another kind.

### Limits

- **A stroke that would pass `maxDrawingPoints` isn't added.** The stage says why, with the error's text from the catalogue, as it does for a layer over `maxLayers` ([ADR 0013](0013-layers-in-the-editor.md)). The next stroke that fits clears it.
- **A stroke holds 64 runs,** 127,937 samples. There the tool commits the stroke and starts the next from the same point, the one case where a gesture is two strokes ([ADR 0014](0014-drawing-strokes-and-arrows.md)).

### The arrow tool

`image.add-arrow` is in the "Add" group, between the ellipse and the image, with no key of its own: it adds an arrow as the shape tools add shapes ([ADR 0013](0013-layers-in-the-editor.md)).

- **A new arrow is across the middle quarter of the image as it's shown, pointing right on screen,** whatever the plan's rotation and flips: its two ends are placed on screen and mapped back to the scene. It's a new shape's red, as wide as a new shape's outline.
- **It shows the layers with the arrow selected,** and focus stays on the tool's button.
- **Dragging out an arrow on the stage is left for later.** The button, then the frame or the fields, is the path that always works.

### Frames for drawings and arrows

In the layers ([ADR 0013](0013-layers-in-the-editor.md)), a drawing and an arrow have frames like every layer: focusable groups, named by their place in the stack, with one tab stop among all frames.

| Layer | Its frame | A drag | Arrow keys | Shift with an arrow |
|---|---|---|---|---|
| Text, shape, image | Its box | Moves it; a handle resizes it | Move it by a pixel | Resizes it |
| Drawing | The bounds of its strokes (`drawingBounds`) | Moves it | Move it by a pixel | Nothing: it has no size to set |
| Arrow | The bounds of its outline (`arrowBounds`) | Moves it; a handle on each end moves that end | Move it by a pixel | Moves its tip by a pixel |

- **`Delete` removes the layer and `Escape` closes the layers,** as for every frame. With Alt, Control or Meta, a key is left to the browser.
- **Moves are as seen on screen,** through the plan's rotation and flips, in whole scene pixels.
- **An arrow's ends differ,** so a drag or a key that would put one end on the other sets nothing.
- **A drawing's frame is described** by how many strokes it has, its size and its place; **an arrow's** by where it runs from and to.
- **In the panel,** a drawing's place is set with the Left and Top fields, which are its origin; it has no size, turn or mirror, so those are disabled. An arrow has its own fields: its tail's and its tip's left and top, its colour and its width. They re-aim it without a drag (WCAG 2.5.7), and a value that would put the tip on the tail isn't set.

### Keyboard access

- **Drawing a stroke needs a pointer.** WCAG 2.5.7 excepts dragging that's essential, and a freehand path is: no sequence of single presses stands in for it ([ADR 0009](0009-scene-space-layers-and-plan-versions.md)). The draw panel says so, and says where the keyboard's way to point at something is.
- **Everything else here has a keyboard way:** the tools, the mode, colour and width, removing the last stroke, adding and re-aiming an arrow, and moving, hiding, reordering and deleting a drawing.

## Alternatives considered

- **An eraser that rubs out part of a stroke:** it would cut strokes into pieces, each a new stroke with new points, and its result would depend on the pointer's exact path. Removing strokes whole is exact and undoable ([ADR 0014](0014-drawing-strokes-and-arrows.md)).
- **A highlighter as its own kind of layer, or an opacity on each stroke:** two strokes of a see-through colour darken where they cross. An opacity on the drawing, composited once, doesn't.
- **One drawing for everything drawn in a session:** a highlighter's strokes would need the pen's opacity.
- **A new drawing for each stroke:** a signature would use dozens of layers and fill the list.
- **Keeping each mode's last colour and width:** more state to explain, for a tool whose defaults are a click away.
- **Drawing with the arrow keys,** a cursor that leaves a trail: a way to draw straight segments slowly, which the arrow and the shapes already do better.
- **Resizing a drawing from its frame:** scaling points changes the strokes' shape on the whole-pixel grid and not their width. Moving is exact.
- **Shift with an arrow moving an arrow's tail:** the tip is what an arrow is aimed with; the tail has the fields and its handle.

## Consequences

- **People can draw on an image, highlight part of it and point at something in it,** with a pointer, and point at something with the keyboard alone.
- **`ImageEditorState` gains `draw`,** and `"draw"` as a value of `tool`. A host that builds its own shell renders `ImageDrawPanel`; `ImageStage` takes the strokes whenever the tool is on.
- **The default toolbar gains two buttons,** so every screenshot of the toolbar changed with them.
- **The React and element entries grow** by the tool, its panel and overlay, the two kinds' frames and an arrow's fields. Their budgets are raised from the measurement.
- **Freehand drawing stays a pointer's.** The record says why, and the panel tells the user.
