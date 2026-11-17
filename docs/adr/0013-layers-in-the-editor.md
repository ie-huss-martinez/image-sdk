# 0013. Layers in the editor: the list, the frames and their keys

- **Status:** Accepted
- **Date:** 2026-11-17
- **Builds on:** [ADR 0007](0007-editor-shell.md) (the editor shell, gestures and the frames' keys) and [ADR 0009](0009-scene-space-layers-and-plan-versions.md) (layers and their commands); in sdk-core, [ADR 0009](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0009-features-as-tools.md) (features as tools), [ADR 0014](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0014-accessibility-and-translatable-text.md) (accessibility) and [ADR 0030](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0030-tools-and-keyboard-shortcuts.md) (tools and shortcuts)
- **Amended:** 2026-11-17: the list is `@hussmartinez/ui`'s `ReorderableList`, with one tab stop, in place of a list of buttons; and after a delete, the layer now in its place in the list is selected. See "The list is ui's"
- **Amended:** 2026-11-17, by [ADR 0015](0015-drawing-in-the-editor.md): a drawing and an arrow have frames too, and the "Add" group has an arrow
- **Amended:** 2026-11-17: a new layer is mirrored back on a mirrored image, and the panel has a Mirror button, now that a layer's box has `flipX` ([ADR 0009](0009-scene-space-layers-and-plan-versions.md))
- **Amended:** 2026-11-17: the tools that add text, shapes and images, the fields of each kind, and where focus goes when a layer is added, under "Adding layers"
- **Follows:** pdf-sdk's [ADR 0008](https://github.com/ie-huss-martinez/pdf-sdk/blob/main/docs/adr/0008-page-organisation-in-the-editor.md), for the keys that reorder a list

## Context

The plan holds layers, the session has their commands, and the renderer draws them ([ADR 0009](0009-scene-space-layers-and-plan-versions.md)). The editor shows none of it: a host can add a layer with a command, and nobody can then select it, move it, hide it or delete it.

Layers need two views of one selection:

- **A list,** where every layer is found by name, whether or not it can be seen or reached on the image: hidden, covered by another, or outside the crop.
- **A frame on the image,** where a layer is moved and resized where it's seen.

Three things need one answer across both:

- **Which keys,** given that the crop and redaction frames already have theirs ([ADR 0007](0007-editor-shell.md)), that pdf-sdk already reorders a list with keys, and that browsers keep many combinations for themselves.
- **What is selected afterwards,** and where focus goes, so nobody loses their place.
- **How a turned layer is moved and resized,** when the plan may also be turned and mirrored, and holds whole pixels.

## Decision

### The tool

`image.layers` is a tool like Crop and Redact: a folder under `src/features/`, a button in the default toolbar after Redact, the icon `layers`, and the shortcut `L`, which works only while focus is inside the editor and never in a field (WCAG 2.1.4, sdk-core ADR 0030).

- **While it's on,** the inspector shows the layers panel and the stage shows the frames. One tool has the stage at a time: starting Crop or Redact ends it, and it ends them.
- **It starts with the top layer selected,** and focus on that layer's button in the list. With no layers, focus stays on the tool's button. The tool asks the panel for that focus through the editor's state, once; nothing else moves focus to the list.
- **It ends** with its button, `L`, the panel's Done, or `Escape` on a frame. Focus returns to where it was ([ADR 0007](0007-editor-shell.md)).

### Adding layers

Four tools, in one toolbar group before Layers: `image.add-text` (shortcut `T`), `image.add-rectangle`, `image.add-ellipse` and `image.add-image`. Each adds one layer over every other, as one undoable step, and shows the layers with it selected.

- **A new layer is in the middle of the image as it's shown, the right way round.** Layers live in the scene, which the plan's rotation and flips turn and mirror with the image ([ADR 0009](0009-scene-space-layers-and-plan-versions.md)). So a new layer's box is turned back by the plan's quarter turns and mirrored back by its flips: on screen it's neither turned nor mirrored, and it has the size it's given as it's seen. Text added to a mirrored image reads as text.
- **Flipping the image afterwards mirrors its layers with it.** That's what flipping the whole image means. Only a new layer is set against the orientation it's added under.
- **Text starts empty,** half the image wide and a fifth of it tall, black, centred. There's no placeholder: sample text in the plan would be in the export of anyone who forgot it. Focus moves to the layer's text field, so typing is the next thing that happens.
- **A shape starts as a red outline with no fill,** a quarter of the image each way: something to put around a detail. The outline is a hundredth of the image's shorter side, at least 2 pixels.
- **An image is chosen in the tool's own file picker** and added with `session.insertImage`, which places it: at its own size, or fitted in half of what's shown if that's smaller, the right way round. The placement is the session's own default, in the core, so a headless host that calls `insertImage` gets the same layer the editor does, and there's one implementation. While it's read, the stage shows a spinner with a cancel button, as it does for an open. `insertImage(file)` on the editor's handle and on `<hm-image-editor>` does the same for a file the host has.
- **A file's name is never used.** An image layer is unnamed, and goes by "Image".
- **Focus stays where it was when a shape or an image is added:** on the tool's button, to add another or move on from. Only text moves it, to its field. A host calling `insertImage` never has focus taken from its page.
- **What can't be added is said on the stage,** as a failed open is: a file that isn't an image, a layer over `maxLayers`. It's the error's text from the catalogue by its code, in `error` on the editor's state, until a layer is added or another image opens. Nothing changes.

### The fields of each kind

Under the fields every layer has, the panel shows the selected layer's own:

| Kind | Fields |
|---|---|
| Text | The text, in a multi-line field; the font, one of the three generic families; the alignment; bold; the colour |
| Shape | Fill, on or off, and its colour; outline, on or off, its colour and its width |
| Image | None of its own |

- **Text is drawn as it's typed.** Each change is a transient plan, and the typing becomes one undoable step when it pauses or the field is left ([ADR 0007](0007-editor-shell.md)).
- **The field takes what the plan takes.** Every line break becomes a line feed, whatever it was where the text came from; a tab becomes a space; the characters text can't hold are dropped; and anything past 1,000 code points is cut. So pasted text is never refused.
- **A colour is any `#rrggbb`,** typed, or one of six swatches: black, white, red, yellow, green and blue. The control is `@hussmartinez/ui`'s.
- **A shape always has a fill or an outline** ([ADR 0009](0009-scene-space-layers-and-plan-versions.md)). Turning off the only one turns on the other, in the same colour, as one step. Nothing is refused, and the shape never disappears.
- **The two sets of fields share one place,** as tall as the taller, with the set that doesn't apply hidden from sight, focus and assistive technology. So the panel keeps its size whichever kind is selected, and the stage doesn't move.
- **The panel is long.** Where the inspector is short it scrolls, and the list can scroll out of view while a layer's fields are used. Splitting it is left for later.

### Selection

- **One layer, or none.** Selection is view state, in the editor's state as `layers: { selected }`, outside the plan, the history, `onChange` and events ([ADR 0009](0009-scene-space-layers-and-plan-versions.md)).
- **A key that no longer names a layer selects nothing.** After an undo removes the selected layer, nothing is selected, and the list still has every layer one press away.
- **Selecting several is left for later.** `image.updateLayers` and `image.moveLayers` already take several keys.

### The panel

`ImageLayersPanel`, exported from `./react`:

- **The list shows the top layer first,** as the image stacks them. Each row is a layer, selected or not, with a button that shows or hides it, pressed while it's shown.
- **A layer goes by its name.** Unnamed, a text layer goes by the start of its first line, and any other by its kind: "Rectangle", "Ellipse", "Image". Names and text come from a plan, so they're untrusted: they're shown as text nodes, never as HTML ([ADR 0009](0009-scene-space-layers-and-plan-versions.md)).
- **Under the list, five buttons act on the selected layer:** move up, move down, mirror, duplicate and delete. Mirror is pressed while the layer is mirrored; it flips the layer left to right about its own box, where it is. They're the path that always works: with a pointer, with the keyboard, and with a screen reader in browse mode. A button that can't act is `aria-disabled` and keeps focus, so pressing "Move up" until the layer reaches the top never drops focus.
- **Then the selected layer's fields:** its name, its left, top, width and height in scene pixels, its turn in degrees and its opacity in percent. Each change is one undoable step. They do everything a drag on the frame does, without dragging (WCAG 2.5.7).
- **The name's field takes what the plan takes:** it drops the characters text can't hold and anything past 100 code points before it builds the command, so the reducer never refuses it.
- **A duplicate** is the layer with a new key, 8 pixels down and right so both can be seen, inserted over its original and selected.
- **What the session refuses is said in the panel,** by the error's code through the catalogue: a duplicate over `maxLayers`, for example. Nothing changes.
- **The panel keeps its size** whatever is selected, as the redact panel does: with no layer selected its fields are disabled and keep their place, and the list scrolls beyond three rows where the inspector sits under the stage. A panel that grew would shrink the stage and move the image under the pointer.

**The list is ui's.** It's `@hussmartinez/ui`'s `ReorderableList` (ui 0.10.0): a WAI-ARIA grid of one column of rows, with one tab stop for the whole list and a cell in each row for its visibility button.

- **↑ and ↓ move between layers and select;** ← and → move between a row's name and its button. So a list of forty layers is one tab stop, not eighty.
- **`Alt` or `Option` with ↑ and ↓ moves the focused layer,** and `Delete` or `Backspace` removes it: the keys this record chose, now the control's own. The control prevents their defaults, at the top and the bottom too, and keeps focus on a moved layer and on the next one after a removal.
- **A layer that's moved with the keys is selected,** so the keys and the panel's buttons act on the same layer.
- **Moves are announced in the editor's words,** for the keys and the buttons alike, so the control's own announcement is turned off.
- **Before ui had it,** the list was a plain list of buttons, two tab stops a layer, because the editor doesn't hand-roll a control ui should own. A listbox wasn't an answer: its options can't hold a row's button.

### The frames

Each layer that's shown has a frame over the canvas, placed and turned by the same transform the renderer draws the layer through (`layerToOutput`), so the frame can't be somewhere the layer isn't.

- **A press selects the top layer under the pointer.** The frames stack as the layers do, so the browser's own hit test finds it. A press on the image outside every layer selects none.
- **Only the selected frame, the one under the pointer and the one with focus are outlined,** so the image looks as it will be exported. The selected one has eight handles.
- **A hidden layer has a frame only while it's selected,** dashed, so its place can still be found and changed.
- **Each frame is a focusable group,** named "Layer 2 of 3: Rectangle", counted as the list counts, and described by its size, place and turn and by its keys. There's one tab stop among them: the selected frame, or the top one. Handles are pointer targets, hidden from assistive technology.
- **Every gesture is a transient plan** while it runs, and one undoable step when it ends ([ADR 0007](0007-editor-shell.md)). A press without a move is no edit.
- **Screen readers in browse mode** may not pass a group's keys to the page ([#67](https://github.com/ie-huss-martinez/image-sdk/issues/67)). The panel's buttons and fields don't depend on it.

### Keys

On a focused frame, the crop and redaction frames' keys ([ADR 0007](0007-editor-shell.md)):

| Action | Keys |
|---|---|
| Move by one pixel, as seen on screen | The arrows |
| Resize by one pixel | Shift with an arrow |
| Delete the layer | Delete, or Backspace |
| Close the layers; during a drag, cancel the drag | Escape |

While focus is in the list, on either button of a row, pdf-sdk's keys for its pages (its ADR 0008):

| Action | Keys (Windows, Linux) | Keys (macOS) |
|---|---|---|
| Move the layer up the stack | Alt+↑ | Option+↑ |
| Move the layer down the stack | Alt+↓ | Option+↓ |
| Delete the layer | Delete, or Backspace | Delete (⌫), or Fn+Delete (⌦) |

- **Up the list is up the stack,** because the list shows the top layer first.
- **The list's keys work only in the list,** where the order is shown, and act on the row that holds focus, which a move also selects. They aren't editor-wide shortcuts, and the frames don't take them: on a frame, `Alt` with an arrow stays the browser's, as it does on the crop frame, since `Alt`+← and `Alt`+→ are Back and Forward.
- **Every key taken has its default prevented,** including a move key at the top or bottom of the list, where nothing moves, so the page behind never scrolls instead.
- **No key is taken with another modifier, or in a field.** In the name's field, `Alt` with an arrow and `Delete` are the field's and the browser's.
- **The buttons advertise the keys** with `aria-keyshortcuts`.

#### Checked against browser and system defaults

pdf-sdk's ADR 0008 checked `Alt`+↑, `Alt`+↓, `Delete` and `Backspace` against Chrome's, Firefox's and Safari's shortcuts and those of macOS, Windows and GNOME, and records the table. The same keys are used here for the same action, moving the focused item of a list, so that table applies. What it found:

| Combination | Taken by | Outcome |
|---|---|---|
| Alt+← / Alt+→ | Back and Forward in Chrome and Firefox on Windows and Linux | Not used |
| Alt+Home, Alt+Page Up, Alt+Page Down | The home page; scrolling by a screen | Not used, so no "to the top" or "to the bottom" key |
| Ctrl or ⌘ with an arrow | Mission Control on macOS; Back and Forward in Firefox on macOS | Not used |
| **Alt+↑ / Alt+↓** | No browser shortcut in Chrome or Firefox. A page default in Safari and Firefox on macOS, scrolling by a screen, which the list prevents | **Used**, only in the list |
| **Delete, Backspace** | Not a browser shortcut; pages may handle them | **Used**, in the list and on a frame |

One thing was measured here: from a text field, Chromium on Linux scrolls the page for `Alt` with ↑ or ↓. The list prevents that default; the name's field doesn't take the key, so there the scroll is the browser's own.

**Tests:**
- A component test dispatches each key in Chromium, Firefox and WebKit, and checks that its default is prevented, and that it isn't with another modifier, in the field, or outside the list.
- An end-to-end test presses each key for real in all three, on a page taller than the window with a history entry behind it: the page must not scroll or navigate, and focus must stay.

### Selection and focus afterwards

| After | Selected | Focus |
|---|---|---|
| Moving up or down | The moved layer | Where it was: the same button of the same row, or the panel's button |
| Deleting | The layer now in its place in the list, which was under it, or the new bottom one | From the list, that layer's row; from a frame, that layer's frame; from the panel's Delete, the button itself |
| Deleting the last layer | None | The panel's Done |
| Duplicating | The copy | The Duplicate button |
| Hiding the selected layer | The same layer, whose frame stays, dashed | The visibility button |

- **Focus never falls to the page.** Moving a row can drop focus in some browsers, so the list puts it back on the button it was on, and only when focus is still in the list or was dropped: never taken from wherever it has gone since.
- **Announcements** go through the polite live region, with text from the catalogue: "Moved Rectangle up. It's layer 2 of 3.", "Duplicated Badge.", "Deleted Hello."
- **Undo doesn't restore the selection.** pdf-sdk records the selected pages with each step, because a deleted page takes its selection with it and several can be selected. Here one layer is selected, and it's still selected after an undo or redo whenever it still exists. Recording selection with history is left for when several layers can be selected.

### Moving and resizing a turned layer

A layer's box is whole scene pixels, mirrored or not, turned about its centre by tenths of a degree, and the plan may be turned by quarters and mirrored ([ADR 0009](0009-scene-space-layers-and-plan-versions.md)). The geometry is in `src/react/layers/frame-geometry.ts`, pure, with property tests. It's the editor's, so it adds nothing to the server-safe entry.

- **Moving is as seen on screen.** A distance on screen goes back through the plan's rotation and flips to the scene. The plan turns by quarters, so a whole pixel on screen is a whole pixel of the scene, whatever the layer's own turn.
- **A handle resizes along the layer's own sides,** as the frame shows them, and what's opposite the handle stays where it is: the other edge, or the other corner.
- **`Shift` with Right or Left moves the side that faces right on screen; with Down or Up, the side that faces down.** Right and Down grow the layer by a pixel, Left and Up shrink it. For an upright layer in an upright plan that's the redaction frame's rule; for a mirrored plan or a layer turned a quarter it's still the side that looks like the right one. A layer turned an eighth has two such sides; one is taken, the same each time.
- **A turned layer's far side stays within a pixel, not exactly.** The box turns about its centre, a resize moves the centre by half the change, and the plan holds whole pixels. An upright layer's far side stays exactly.
- **A handle's cursor points the way it moves on screen,** computed from the same transform.
- **Turning is a field, not a handle,** in this version. A rotate handle is an addition, and wouldn't be the only way.

## Alternatives considered

- **Layers always on, with no tool:** frames over the image at all times would sit between the pointer and the image for every other tool, and the image would never be seen without their outlines.
- **A listbox with reorder keys,** as pdf-sdk's thumbnails: the right pattern for items with no controls of their own. Rows here have a visibility button, which an option can't contain.
- **`[` and `]`, or `Ctrl` with them, to reorder,** as drawing applications do: `[` and `]` already rotate the image here, and a second family of keys for "move this item in its list" would differ from pdf-sdk's for no reason.
- **Reorder keys on the frame too:** the order isn't shown on the image, and `Alt` with an arrow on a frame is left to the browser for all four arrows, so that no frame key is one press from Back.
- **Resizing with the box's own width and height, whatever is seen:** simpler, but with the plan turned a quarter, `Shift` with Right would stretch the layer up and down the screen.
- **Resizing a turned layer about its centre,** so nothing drifts: the box's corner would land on half pixels, which the plan doesn't hold.
- **Dragging rows to reorder:** an addition for later, as in pdf-sdk. The buttons are the single-pointer path WCAG 2.5.7 requires either way.

## Consequences

- **Layers a host or a plan adds can be selected, moved, resized, turned, hidden, reordered, copied and deleted** from the editor, with a pointer or without one.
- **`ImageEditorState` gains `layers` and `error`,** and `"layers"` as a value of `tool`. `ImageToolContext` gains `chooseLayerImage`, which a host that builds its own tool context must provide. A host that builds its own shell renders `ImageLayersPanel`; `ImageStage` shows the frames whenever the tool is on.
- **The default toolbar gains a button,** so every screenshot of the editor's toolbar changed with it.
- **The list is one tab stop,** however many layers there are.
- **A gesture's transient plan now resolves image layers' sources,** as the session's reducer does: moving an image layer is checked against its own source's size.
