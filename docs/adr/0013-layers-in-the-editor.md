# 0013. Layers in the editor: the list, the frames and their keys

- **Status:** Accepted
- **Date:** 2026-11-17
- **Builds on:** [ADR 0007](0007-editor-shell.md) (the editor shell, gestures and the frames' keys) and [ADR 0009](0009-scene-space-layers-and-plan-versions.md) (layers and their commands); in sdk-core, [ADR 0009](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0009-features-as-tools.md) (features as tools), [ADR 0014](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0014-accessibility-and-translatable-text.md) (accessibility) and [ADR 0030](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0030-tools-and-keyboard-shortcuts.md) (tools and shortcuts)
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
- **It starts with the top layer selected,** and focus on that layer's button in the list. With no layers, focus stays on the tool's button.
- **It ends** with its button, `L`, the panel's Done, or `Escape` on a frame. Focus returns to where it was ([ADR 0007](0007-editor-shell.md)).
- **Adding layers isn't here.** The text, shape and image tools come next; each will insert its layer and show the layers with it selected.

### Selection

- **One layer, or none.** Selection is view state, in the editor's state as `layers: { selected }`, outside the plan, the history, `onChange` and events ([ADR 0009](0009-scene-space-layers-and-plan-versions.md)).
- **A key that no longer names a layer selects nothing.** After an undo removes the selected layer, nothing is selected, and the list still has every layer one press away.
- **Selecting several is left for later.** `image.updateLayers` and `image.moveLayers` already take several keys.

### The panel

`ImageLayersPanel`, exported from `./react`:

- **The list shows the top layer first,** as the image stacks them. Each row has a button that selects the layer, pressed when it's selected, and a button that shows or hides it, pressed while it's shown.
- **A layer goes by its name.** Unnamed, a text layer goes by the start of its first line, and any other by its kind: "Rectangle", "Ellipse", "Image". Names and text come from a plan, so they're untrusted: they're shown as text nodes, never as HTML ([ADR 0009](0009-scene-space-layers-and-plan-versions.md)).
- **Under the list, four buttons act on the selected layer:** move up, move down, duplicate and delete. They're the path that always works: with a pointer, with the keyboard, and with a screen reader in browse mode. A button that can't act is `aria-disabled` and keeps focus, so pressing "Move up" until the layer reaches the top never drops focus.
- **Then the selected layer's fields:** its name, its left, top, width and height in scene pixels, its turn in degrees and its opacity in percent. Each change is one undoable step. They do everything a drag on the frame does, without dragging (WCAG 2.5.7).
- **The name's field takes what the plan takes:** it drops the characters text can't hold and anything past 100 code points before it builds the command, so the reducer never refuses it.
- **A duplicate** is the layer with a new key, 8 pixels down and right so both can be seen, inserted over its original and selected.
- **What the session refuses is said in the panel,** by the error's code through the catalogue: a duplicate over `maxLayers`, for example. Nothing changes.
- **The panel keeps its size** whatever is selected, as the redact panel does: with no layer selected its fields are disabled and keep their place, and the list scrolls beyond three rows where the inspector sits under the stage. A panel that grew would shrink the stage and move the image under the pointer.

**Why a list of buttons, not a listbox.** A listbox's options can't hold other controls, and each row needs its visibility button. `@hussmartinez/ui` has no listbox or reorderable list, and the editor doesn't hand-roll controls ui should own. A list of buttons is plain HTML that every screen reader reads as a list with positions. Its cost is two tab stops for each layer; a ui control with one tab stop is proposed for later.

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
- **The list's keys work only in the list,** where the order is shown, and act on the row that holds focus, which they also select. They aren't editor-wide shortcuts, and the frames don't take them: on a frame, `Alt` with an arrow stays the browser's, as it does on the crop frame, since `Alt`+← and `Alt`+→ are Back and Forward.
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
| Deleting | The layer now in its place in the stack, or the new top one | From the list, that layer's button; from a frame, that layer's frame; from the panel's Delete, the button itself |
| Deleting the last layer | None | The panel's Done |
| Duplicating | The copy | The Duplicate button |
| Hiding the selected layer | The same layer, whose frame stays, dashed | The visibility button |

- **Focus never falls to the page.** Moving a row can drop focus in some browsers, so the list puts it back on the button it was on, and only when focus is still in the list or was dropped: never taken from wherever it has gone since.
- **Announcements** go through the polite live region, with text from the catalogue: "Moved Rectangle up. It's layer 2 of 3.", "Duplicated Badge.", "Deleted Hello."
- **Undo doesn't restore the selection.** pdf-sdk records the selected pages with each step, because a deleted page takes its selection with it and several can be selected. Here one layer is selected, and it's still selected after an undo or redo whenever it still exists. Recording selection with history is left for when several layers can be selected.

### Moving and resizing a turned layer

A layer's box is whole scene pixels, turned about its centre by tenths of a degree, and the plan may be turned by quarters and mirrored ([ADR 0009](0009-scene-space-layers-and-plan-versions.md)). The geometry is in `src/react/layers/frame-geometry.ts`, pure, with property tests. It's the editor's, so it adds nothing to the server-safe entry.

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
- **`ImageEditorState` gains `layers`,** and `"layers"` as a value of `tool`. A host that builds its own shell renders `ImageLayersPanel`; `ImageStage` shows the frames whenever the tool is on.
- **The default toolbar gains a button,** so every screenshot of the editor's toolbar changed with it.
- **A long list costs two tab stops a layer** until ui has a control for it.
- **A gesture's transient plan now resolves image layers' sources,** as the session's reducer does: moving an image layer is checked against its own source's size.
