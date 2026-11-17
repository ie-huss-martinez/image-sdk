# @hussmartinez/image-sdk

## 0.5.0

### Minor Changes

- [#83](https://github.com/ie-huss-martinez/image-sdk/pull/83) [`92d17b7`](https://github.com/ie-huss-martinez/image-sdk/commit/92d17b75bac87c292ea938cc6604171664cb4e87) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add the Draw tool and the arrow tool to the editor ([ADR 0015](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0015-drawing-in-the-editor.md)).
  
  - **Draw.** `image.draw`, in the default toolbar before Layers, with the `D` shortcut. Drag across the image to draw a stroke: it shows as it's drawn, and is one undo step when the pointer lifts. A press without a drag is a dot. `Escape` ends a stroke in progress with nothing added.
  - **Pen and highlighter.** The panel chooses between them, and sets the colour and the width. A highlighter draws wide, see-through strokes that don't darken where they cross. "Remove last stroke" takes the last stroke back.
  - **One drawing, many strokes.** Strokes go into one drawing layer, so a signature is one row in the layers list. Starting Draw with a drawing selected in the layers adds to it.
  - **Arrows.** `image.add-arrow`, in the "Add" group, adds an arrow across the middle of the image, pointing right. In the layers its frame has a handle on each end; the arrow keys move it, and `Shift` with an arrow moves its tip. The panel has fields for both ends, its colour and its width.
  - **Drawings in the layers.** A drawing has a frame around its strokes: drag it or use the arrow keys to move it.
  - **Drawing needs a pointer:** a mouse, a pen or a finger. The panel says so. The arrow tool is the keyboard's way to point at something.
  - **Building blocks and API:** `ImageDrawPanel`; and `draw` on `ImageEditorState`, with `"draw"` as a value of its `tool`.
  
  If you pass your own `toolbar` groups, add `"image.draw"` and `"image.add-arrow"` to show the tools. If you render the building blocks yourself, render `ImageDrawPanel` with the others: `ImageStage` takes the strokes whenever the tool is active.

- [#79](https://github.com/ie-huss-martinez/image-sdk/pull/79) [`031453f`](https://github.com/ie-huss-martinez/image-sdk/commit/031453f2d05c24a5f8fa550eedc983fe4937a417) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add drawings and arrows to the plan: format version 3 ([ADR 0009](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0009-scene-space-layers-and-plan-versions.md), [ADR 0014](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0014-drawing-strokes-and-arrows.md)).
  
  - **Two new kinds of layer.** `ImageDrawingLayer` holds freehand strokes at an origin; `ImageArrowLayer` points from one place to another. Neither has a box. `ImageBoxedLayer` names the three kinds that do.
  - **A stroke is what one gesture drew:** a colour, a width, and `runs` of points. It has more than one run only when it's long.
  - **Stroke commands.** `image.addStrokes` appends strokes to a drawing and `image.removeStrokes` removes them by index, each with an exact inverse. A drawing keeps at least one stroke. `image.updateLayers` moves a drawing by its origin and re-aims an arrow.
  - **Geometry, pure and in the vectors:** `simplifyStroke` turns a pointer's samples into a stroke's runs, the same in every browser; `arrowOutline` gives the polygon an arrow is drawn as; `drawingBounds` and `arrowBounds` give what a layer covers; `drawingPoints` counts a plan's points.
  - **A new limit, `maxDrawingPoints`:** 200,000 points across a plan's drawings, with a warning at 100,000, and the `TOO_MANY_POINTS` error code. The session also bounds the points its undo history holds, and trims the oldest steps beyond a million.
  - **`checkPlanSupport` has a `drawings` part,** for a renderer or processor that draws the other layers and not these.
  
  **Format version 3**
  
  - `toImagePlanDocument` writes version 3, and `readImagePlanDocument` reads versions 1, 2 and 3. A version 2 document reads to the same plan.
  - A reader from 0.4 refuses a version 3 document with `UNSUPPORTED_FORMAT` and `unknown-format-version`, which an application can show as "update the application". Keep documents at the version their readers have until every reader is updated.
  - The schemas are `formats/hm-image-plan/v3.schema.json` and `formats/hm-image-command/v3.schema.json`; version 2's stay.
  
  **If you handle layers yourself**
  
  - `ImageLayer` is a wider union: code that reads `x`, `width` or `rotation` from any layer needs to check its `kind` first, or take an `ImageBoxedLayer`.
  - A custom renderer or processor should pass `drawings` to `checkPlanSupport` only once it draws them.

- [#81](https://github.com/ie-huss-martinez/image-sdk/pull/81) [`4451f68`](https://github.com/ie-huss-martinez/image-sdk/commit/4451f68402ff46be2b7479fb8f42a58bffca776e) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Draw drawings and arrows, in the preview and in every export ([ADR 0014](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0014-drawing-strokes-and-arrows.md)).
  
  - **Strokes** are drawn as lines through their points, at their width, with round joins and round ends; a single point is a dot. No curve is fitted, so a drawn corner stays a corner.
  - **A long stroke is one line.** A stroke that `simplifyStroke` cut into runs is drawn joined where it was cut, the same pixels as if it hadn't been.
  - **A drawing is composited as one,** at its layer's opacity, so strokes that cross don't darken each other. A highlighter is a wide stroke in a drawing with a low opacity.
  - **An arrow** is drawn as `arrowOutline`'s polygon, filled, with its tip exactly on the point it aims at and nothing past it.
  - **Like every layer,** they aren't developed with the base, they stay on the pixels they were drawn on when the image is cropped, turned or mirrored, and redactions cover them.
  
  The built-in renderer and processor now take the `drawings` part of a plan. A custom processor that doesn't draw them still refuses such a plan through `checkPlanSupport`.

### Patch Changes

- [#82](https://github.com/ie-huss-martinez/image-sdk/pull/82) [`d4b4264`](https://github.com/ie-huss-martinez/image-sdk/commit/d4b42645dabc4b81f2412ce47dddd712b83d1fe8) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Export no longer greys out while Redact or Layers is open ([ADR 0007](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0007-editor-shell.md)).
  
  - **While redacting or arranging layers,** the toolbar's Export works: it ends the tool and opens the export dialog. A gesture still running, such as text being typed, is included in the export.
  - **While a crop is unapplied,** Export still waits, and now says why: the button stays reachable with the keyboard and is described by "Apply or cancel the crop before exporting.", in a tooltip.
  - **`ImageTool` gains an optional `unavailable(state)`,** which returns a message key while a tool can't run for a reason the user can act on. `ImageToolbar` keeps such a button focusable and describes it with the text. Your own tools can use it; the new string is `tools.exportWhileCropping`.

- [#84](https://github.com/ie-huss-martinez/image-sdk/pull/84) [`4d36ed4`](https://github.com/ie-huss-martinez/image-sdk/commit/4d36ed42655de13dce770daeb108ed66c65b31b1) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The layers list is one tab stop ([ADR 0013](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0013-layers-in-the-editor.md)).
  
  - **The list is `@hussmartinez/ui`'s `ReorderableList`,** in place of a list of buttons with two tab stops for each layer. Tab reaches the list once; the Up and Down arrows move between layers and select, and Left and Right move between a layer's name and its show-or-hide button.
  - **The same keys as before** move and remove: `Alt` (`Option` on macOS) with Up or Down moves the focused layer, and `Delete` or `Backspace` removes it.
  - **After a delete,** the layer now in its place in the list is selected: the one that was under it. Before, it was the one over it.
  - **For assistive technology** the list is a grid of rows, each selected or not, where it was a list of pressed and unpressed buttons.
  
  If you style the list, its rows are now ui's (`.hm-reorderable-list-row`); `.hm-image-layer-select` is still on each layer's name, and `.hm-image-layer-visibility` on its button.
  
  This release needs `@hussmartinez/ui` 0.10.0 or later.

## 0.4.0

### Minor Changes

- [#72](https://github.com/ie-huss-martinez/image-sdk/pull/72) [`3b155e4`](https://github.com/ie-huss-martinez/image-sdk/commit/3b155e48a51eeaa84f9ecc4550ffde78fc61ddd8) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add `session.insertImage(file)`: open a second image and add it to the document as an image layer, as one undoable step ([ADR 0003](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0003-layer-plan-document-model.md), [ADR 0004](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0004-image-limits.md)).
  
  - **Checked like any file:** probed from its headers and held to the file policy before it's decoded, in the worker.
  - **Placed for you, or by you:** by default the image is centred on what's shown, at its own size or half the composition's, whichever is smaller, over every layer, and set against the plan's rotation and flips, so it's seen as the file is, not turned or mirrored. `place` returns your own commands instead.
  - **Held only while it's needed:** the session keeps the source while the plan, an undo or redo step, or an export in progress refers to it, and releases it then. Opening another file releases them all.
  - **Limits:** `maxFiles` counts every source the session holds, and `maxSessionSize` their decoded bytes. When an image doesn't fit, the session drops the oldest undo steps that alone keep another image; if that can't free enough, nothing is dropped and it fails with `SESSION_TOO_LARGE`.
  - **The snapshot** gains `sources`, every source held; `inserting`; and `historyTrimmed`, true once undo steps were dropped to make room.
  - **Events:** `onEvent` gets `{ type: "insert" }`, with no file name, size or source id, like the others.
  
  `ImageSessionSnapshot` has three new required fields, and `ImageSessionEvent["type"]` a new value: code that builds a snapshot by hand, such as a test double, or switches over every event type, needs them.
  
  A plan with an image layer still can't be previewed or exported until the renderer draws layers.

- [#73](https://github.com/ie-huss-martinez/image-sdk/pull/73) [`e8fef44`](https://github.com/ie-huss-martinez/image-sdk/commit/e8fef444f7d4f64ad53f9c4cd22b0ef887807637) Thanks [@hussmartinez](https://github.com/hussmartinez)! - **Breaking:** the editor's text moves out of the server-safe entry. `imageMessages`, from `@hussmartinez/image-sdk`, now holds only what the headless entry produces: sdk-core's messages, and the text of every error code and limit warning. The editor's own text, and ui's, are in `imageEditorMessages`, from `@hussmartinez/image-sdk/react` and `@hussmartinez/image-sdk/element` ([ADR 0012](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0012-interface-text-outside-the-server-safe-entry.md)).
  
  The headless entry is about 1.9 kB smaller (20.09 kB to 18.16 kB brotli), and servers that import it no longer carry text they never show. No key or text changes, and the `messages` props and the element's `messages` property work as before.
  
  ### Migrating
  
  Most hosts change nothing: `<ImageEditor messages={{ "tools.crop": "Trim" }} />` works as it did.
  
  If you type your overrides, or build your own `Messages` for the editor's components:
  
  ```ts
  // Before
  import { type ImageMessageCatalogue, imageMessages } from "@hussmartinez/image-sdk";
  const overrides: MessageOverrides<ImageMessageCatalogue> = { "tools.crop": "Trim" };
  const messages = createMessages(imageMessages, { overrides });
  
  // After
  import {
    type ImageEditorMessageCatalogue,
    imageEditorMessages,
  } from "@hussmartinez/image-sdk/react";
  const overrides: MessageOverrides<ImageEditorMessageCatalogue> = { "tools.crop": "Trim" };
  const messages = createMessages(imageEditorMessages, { overrides });
  ```
  
  Headless code that shows errors keeps `imageMessages`: `createMessages(imageMessages).error(error)` still has every code's text.

- [#78](https://github.com/ie-huss-martinez/image-sdk/pull/78) [`dd51552`](https://github.com/ie-huss-martinez/image-sdk/commit/dd51552de0352ae6f06ed9ff26e6b6f8147086c2) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Layers can be mirrored, and a layer added to a mirrored image reads as it should ([ADR 0009](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0009-scene-space-layers-and-plan-versions.md)).
  
  - **`flipX` on a layer's box.** Every text, shape and image layer has `flipX`, a boolean: whether it's mirrored left to right about its box's own vertical axis, before the box is turned. It's required, in the plan, in `image.insertLayers` and in a plan document of format version 2; `image.updateLayers` sets it. A mirror top to bottom is `flipX` with a half turn (`rotation: 1800`).
  - **New layers read correctly.** The tools that add text, shapes and images set a new layer against the image's flips as well as its rotation, so text added to a mirrored image isn't backwards. Flipping the image afterwards still mirrors its layers with it.
  - **`session.insertImage` does the same by default:** without `place`, the image is placed neither turned nor mirrored in the output, whatever the plan's orientation.
  - **"Mirror" in the layers panel** flips the selected layer about its own box.
  - **`layerToScene`** applies the mirror, so `layerToOutput`, `sceneToLayerSource`, the renderer and the editor's frames follow. Exports stay redacted under a mirrored image layer.
  
  If you build layers yourself, add `flipX: false` to each.

- [#71](https://github.com/ie-huss-martinez/image-sdk/pull/71) [`774279c`](https://github.com/ie-huss-martinez/image-sdk/commit/774279cb7cf2054f30c34cb1c8313a3d76d3f2d8) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add layers to the plan: text, shapes and images over the base ([ADR 0009](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0009-scene-space-layers-and-plan-versions.md)). This is the model and its commands; drawing them and the editor's tools follow.
  
  - **`plan.layers`** is a list of `ImageLayer`s, drawn bottom to top: `ImageTextLayer`, `ImageShapeLayer` and `ImageImageLayer`. Each has a key, a name, `visible`, an `opacity` from 0 to 100, and a box in whole pixels of the base's oriented source, turned about its centre in tenths of a degree, with `flipX` to mirror it. Like redactions, layers stay on the pixels they cover when the image is cropped or turned.
  - **Text** is drawn as large as fits in its box, in one of three generic fonts, and can't hold control characters other than a line feed, or the bidirectional override and isolate controls, which can make text read differently from what's stored.
  - **Commands:** `image.insertLayers`, `image.removeLayers`, `image.moveLayers` and `image.updateLayers`, each undone exactly. `image.updateLayers` sets any field of a layer's kind except its key and kind, for several layers at once. New `INVALID_COMMAND` reasons, such as `wrong-kind` and `invalid-text`, are listed in `ImageCommandRejection`.
  - **Keys and limits are shared with redactions:** a key is unique across both lists, and `maxLayers` counts both.
  - **Format version 2** now holds layers. `formats/hm-image-plan/v2.schema.json` and `formats/hm-image-command/v2.schema.json` describe them, and `readImagePlanDocument` checks that an image layer's source is one the document lists.
  
  `ImagePlan["layers"]` changes type, from an always-empty list to `readonly ImageLayer[]`. Code that only reads plans from `createPlan` or the session needs no change.
  
  Until the renderer draws layers, exporting or previewing a plan with any fails with `UNSUPPORTED_PLAN`, as for any part a renderer can't draw. An image layer's source must be one the session holds; today that's the open image, and opening further images for layers comes with the image tool.

- [#77](https://github.com/ie-huss-martinez/image-sdk/pull/77) [`f26d606`](https://github.com/ie-huss-martinez/image-sdk/commit/f26d60609eac4a7e09be1fe6e21468e273cf07b5) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add the tools that add text, shapes and images to an image, and the fields that edit them ([ADR 0013](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0013-layers-in-the-editor.md)).
  
  - **Four tools,** in the default toolbar before Layers: `image.add-text` (shortcut `T`), `image.add-rectangle`, `image.add-ellipse` and `image.add-image`. Each adds a layer in the middle of the image as it's shown, the right way round whatever the image's rotation and flips, as one undo step, and shows the layers with it selected.
  - **Text** starts empty, with focus in its field. It's drawn as it's typed, and the typing is one undo step when it pauses. Its panel sets the font (sans, serif or mono, drawn by the device's fonts), alignment, bold and colour. Pasted text is taken as the plan takes it: line breaks become line feeds, and what text can't hold is dropped.
  - **Shapes** start as a red outline. Their panel turns the fill and the outline on and off and sets their colours and the outline's width; a shape always keeps one of the two.
  - **Images** are chosen in the tool's own file picker and stay on the device. `insertImage(file)` is new on `ImageEditorHandle` and on `<hm-image-editor>`, for a file the host has.
  - **Colours** are any `#rrggbb`, typed or picked from six swatches.
  - **What can't be added,** such as a file that isn't an image or a layer over `maxLayers`, is said on the stage, and nothing changes.
  
  **API changes**
  
  - `ImageEditorHandle` and the element gain `insertImage(file)`.
  - `ImageEditorState` gains `error`, and `focus` on `layers`.
  - `ImageToolContext` gains `chooseLayerImage`. If you build your own tool context for `ImageToolbar`, add it: a function that asks for an image and passes it to `session.insertImage`.
  - If you pass your own `toolbar` groups, add the four tool ids to show them.
  
  This release needs `@hussmartinez/ui` 0.9.0 or later, for its colour field and multi-line text field.

- [#75](https://github.com/ie-huss-martinez/image-sdk/pull/75) [`d5268b3`](https://github.com/ie-huss-martinez/image-sdk/commit/d5268b3cbb8464546e74437e9edcce6b93a0d128) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add the Layers tool to the editor: a list of the plan's layers and a frame on the image for each ([ADR 0013](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0013-layers-in-the-editor.md)).
  
  - **The tool.** `image.layers`, in the default toolbar after Redact, with the `L` shortcut. Like the editor's other single-key shortcuts, it works only while focus is inside the editor, and never in a field.
  - **In the panel.** The layers, the top one first: each has a button that selects it and one that shows or hides it. Under the list, buttons move the selected layer up and down the stack, duplicate it and delete it, and fields set its name, position, size, turn and opacity.
  - **On the stage.** Each layer has a frame, turned as the layer is. A press selects the top layer under the pointer, a drag moves it, and the selected frame's handles resize it. A hidden layer's frame shows while it's selected.
  - **Keys.** On a focused frame, the arrow keys move the layer by a pixel, `Shift` with an arrow resizes it, `Delete` or `Backspace` removes it, and `Escape` closes the layers: the crop frame's keys. In the list, `Alt` (`Option` on macOS) with the Up or Down arrow moves the focused layer up or down the stack, and `Delete` or `Backspace` removes it.
  - **Each gesture is one undo step,** and the preview shows the layer where it's being moved.
  - **Building blocks and API:** `ImageLayersPanel`; and `layers` on `ImageEditorState`, with `"layers"` as a value of its `tool`.
  
  This release doesn't add layers from the editor yet: the text, shape and image tools come next. A layer comes from a plan, from `image.insertLayers`, or from `session.insertImage(file)`.
  
  If you pass your own `toolbar` groups, add `"image.layers"` to show the tool. If you render the building blocks yourself, render `ImageLayersPanel` with the others: `ImageStage` shows the frames whenever the tool is active.

- [#62](https://github.com/ie-huss-martinez/image-sdk/pull/62) [`076426d`](https://github.com/ie-huss-martinez/image-sdk/commit/076426d31bba7be1263b0deaa8bd0bdf90067f99) Thanks [@hussmartinez](https://github.com/hussmartinez)! - **Breaking:** `ImagePlan` gains three required fields, `layers`, `redactions` and `animation`, and the plan's portable format is now `hm-image-plan` version 2.
  
  This is the model for redaction and layers, which arrive in the next changes ([ADR 0009](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0009-scene-space-layers-and-plan-versions.md), [ADR 0010](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0010-redaction.md)).
  
  - **Redactions in the plan.** `plan.redactions` is a list of `ImageRedaction`s: rectangles in whole pixels of the base's oriented source, `solid` with a colour or `pixelate`. They're placed in the scene, so they stay on the pixels they cover when the image is cropped or turned.
  - **Commands.** `image.insertRedactions`, `image.removeRedactions`, `image.moveRedactions` and `image.updateRedactions`, each undone exactly. New `INVALID_COMMAND` reasons, such as `duplicate-key` and `invalid-region`, are listed in `ImageCommandRejection`.
  - **`layers` and `animation`** are in the plan now, always `[]` and `null`, so later releases change what they hold, not the plan's shape.
  - **`maxLayers`** now applies: a step that adds redactions past it fails with `TOO_MANY_LAYERS`.
  - **`checkPlanSupport` and `UNSUPPORTED_PLAN`.** A renderer or processor refuses a plan with a part it can't draw, instead of drawing the image without it. Custom `ImageRenderer`s and `ImageProcessor`s should call `checkPlanSupport(plan, [...])` with the parts they draw.
  - **Format version 2.** `readImagePlanDocument` reads versions 1 and 2, and `toImagePlanDocument` writes version 2. The schemas are `formats/hm-image-plan/v2.schema.json` and `formats/hm-image-command/v2.schema.json`; version 1's stay in the package.
  
  ### Migrating
  
  - **Plans from `createPlan` and from the session** already have the new fields. Nothing changes.
  - **Stored plan documents** (`hm-image-plan` version 1): read them with `readImagePlanDocument`, which migrates them. No stored document needs rewriting.
  - **Plans you build or store as plain `ImagePlan` objects,** such as a controlled editor's `plan`: add `layers: []`, `redactions: []` and `animation: null`. `session.applyPlan`, and so `<ImageEditor plan>`, refuses a plan without them with `INVALID_COMMAND`, so an old plan is never mistaken for one with no redactions.
  - **Exhaustive `switch`es over `ImageCommand["type"]`** need the six new command types.

- [#69](https://github.com/ie-huss-martinez/image-sdk/pull/69) [`e51f74b`](https://github.com/ie-huss-martinez/image-sdk/commit/e51f74bb7f388d9a3c029eb0fb15cb3dc240d8ae) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add the Redact tool to the editor ([ADR 0010](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0010-redaction.md)).
  
  - **The tool.** `image.redact`, in the default toolbar after Crop, with the `R` shortcut. Like the editor's other single-key shortcuts, it works only while focus is inside the editor, and never in a field.
  - **On the stage.** Each redacted area is a frame over the image. Drag across the image to draw one. On a focused frame, the arrow keys move it by a pixel, `Shift` with an arrow resizes it, `Delete` or `Backspace` removes it, and `Escape` ends redacting: the crop frame's keys.
  - **In the panel.** A solid colour (black or white) or pixelation, with a warning that pixelation may not hide text; "Add area", which needs no dragging; number fields for the selected area's position and size; and a list of every area, each with a button to remove it.
  - **Each gesture is one undo step,** and the preview shows the area redacted while it's being drawn or moved.
  - **The export summary** says how many areas are redacted, and warns when any is pixelated.
  - **Building blocks and API:** `ImageRedactPanel`; `createImageKey`, for the keys new redactions need; `sceneRectToComposition`, `compositionRectToScene` and `fitRedactionRegion`, the geometry that places an area's frame; and `redact` on `ImageEditorState`, with `"redact"` as a value of its `tool`.
  
  The editor offers black and white. The plan holds any `#rrggbb` colour, so a host that builds its own commands isn't limited to those.
  
  If you pass your own `toolbar` groups, add `"image.redact"` to show the tool. If you render the building blocks yourself, render `ImageRedactPanel` with the others: `ImageStage` shows the frames whenever the tool is active.
  
  This release needs `@hussmartinez/ui` 0.8.0 or later, for the tool's icon.

- [#74](https://github.com/ie-huss-martinez/image-sdk/pull/74) [`5692971`](https://github.com/ie-huss-martinez/image-sdk/commit/5692971c4bf2b6d4594ee3a9eac281207cd58b0f) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Layers are now drawn: the preview shows text, shape and image layers, and exports contain them ([ADR 0009](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0009-scene-space-layers-and-plan-versions.md)).
  
  - **The preview is the export.** Both are drawn by the same code from the same layout, so a preview at the export's size matches it pixel for pixel.
  - **Text** is laid out once and scaled to the largest size that fits its box, breaking lines only at line feeds, aligned by the text's own direction: `start` is the right edge for Hebrew or Arabic text.
  - **Fonts are the device's.** `sans-serif`, `serif` and `monospace` are drawn by whatever the browser resolves them to, and `bold` by the browser's bold for that family. The SDK ships and fetches no font, so the same plan can look different on another device: two families may be the same font there, and `bold` may be a real bold face, a synthesised one, or no different from regular.
  - **Shapes** are rectangles and ellipses that fill their box, with the stroke inside it.
  - **Image layers** draw a crop of another source, scaled and turned.
  - **Opacity fades a layer as one:** a shape's stroke doesn't show through its fill.
  - **Layers are never developed:** adjustments and filters change the photo, not what's drawn over it.
  - **Redactions cover layers too.** An image layer's pixels under a redaction are replaced before the layer is scaled, as the base's are, so an export doesn't depend on them; text and shapes over a redaction are covered exactly.
  - **New geometry,** for hosts and other renderers: `layerToOutput`, `layerToScene`, `sceneToOutput`, `sceneToLayerSource`, `fitTextLines`, `isRightToLeft`, `applyMatrix`, `invertMatrix` and the `ImageMatrix` type.
  
  A layer with an opacity under 100 costs one more canvas the size of the output while it's drawn, and an image layer under a redaction one the size of its source, each checked against the file policy first.
  
  A plan that names an image layer's source the engine doesn't hold fails with a `TypeError`, as one that names an unknown base does. Custom `ImageRenderer`s and `ImageProcessor`s that don't draw layers keep refusing such plans through `checkPlanSupport`.

- [#66](https://github.com/ie-huss-martinez/image-sdk/pull/66) [`670bf9f`](https://github.com/ie-huss-martinez/image-sdk/commit/670bf9f1d7d002351de321d0a48d69bf7d6571f3) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Redactions are now rendered: the preview shows them, and exports don't contain what they cover ([ADR 0010](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0010-redaction.md)).
  
  - **A solid redaction destroys its pixels.** An export's bytes don't depend on them: two images that differ only inside the region export to identical files, in PNG, JPEG and WebP, at any output size, crop and orientation. The covered pixels are replaced before the image is scaled, so nothing of them is left along the region's edge, and the region is then filled on whole output pixels, rounded outward.
  - **A pixelated redaction keeps only block averages.** Its blocks are the larger of 8 pixels and a twelfth of the region's longer side, so a strip over a line of text is one row of blocks. Pixelation obscures; for text and numbers, use solid.
  - **Redactions follow the image.** They're placed on the source's pixels, so they stay on what they cover through every crop, turn and flip.
  - **Nothing is drawn without them.** If the renderer can't make the copy it draws from, the preview keeps its last frame and an export fails, with the error's own code.
  - **Only exports are redacted.** The plan describes the redaction, and the source the session holds is unchanged; `engine.thumbnail` returns it as it is.
  - **New geometry,** for hosts and other renderers that place or draw redactions: `redactionRectInOutput`, `redactionBlocksInOutput`, `redactionBlocksInScene`, `redactionBlockSize` and the `ImageRect` type.
  
  A redaction costs memory while it exists: one more canvas the size of the image. It's checked against `maxImagePixels` and `maxImageDimension` before it's allocated.
  
  Custom `ImageRenderer`s and `ImageProcessor`s that don't draw redactions keep refusing such plans through `checkPlanSupport`. To draw them, follow ADR 0010's two passes, and pass `"redactions"` to `checkPlanSupport`.

### Patch Changes

- [#68](https://github.com/ie-huss-martinez/image-sdk/pull/68) [`8a5c4c8`](https://github.com/ie-huss-martinez/image-sdk/commit/8a5c4c8009301ab2c89f5624b6907701e3259746) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Fix the crop frame's resize keys taking the browser's Back and Forward. The frame resized with `Alt` and the arrow keys, and `Alt` with Left or Right goes back or forward a page in Chrome and Firefox on Windows and Linux, so resizing a crop could leave the page and lose the edit.
  
  **The keys have changed:**
  
  | Key, on the crop frame | Before | Now |
  |---|---|---|
  | Arrows | Move by 1 pixel | Move by 1 pixel |
  | `Shift` with an arrow | Move by 10 pixels | **Resize by 1 pixel** |
  | `Alt` with an arrow | Resize by 1 pixel | Nothing: left to the browser |
  
  There's no 10-pixel step now: hold an arrow, or type a value in the crop panel's fields. The frame's description, which screen readers read, names the new keys. If your own documentation lists the crop keys, update it.

- [#65](https://github.com/ie-huss-martinez/image-sdk/pull/65) [`4b19eba`](https://github.com/ie-huss-martinez/image-sdk/commit/4b19eba149ed911c7bad9ce19a62d22cbd98fe73) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Fix the empty editor ignoring the mouse: a click on "Choose an image" did nothing, and a file dropped on the empty stage wasn't opened. The stage's canvas frame covered the drop zone, so only the keyboard and the toolbar's "Open image" worked. The Cancel button shown while an image opens was covered the same way, and now takes clicks too.
  
  Nothing changes in how the editor looks. If you worked around this with your own `z-index` or `pointer-events` on `.hm-image-stage-frame` or `.hm-image-stage-drop`, you can remove it.

## 0.3.0

### Minor Changes

- [#57](https://github.com/ie-huss-martinez/image-sdk/pull/57) [`7ea0d2d`](https://github.com/ie-huss-martinez/image-sdk/commit/7ea0d2d2fde2b69167dfe479f5afb5b234b5fb80) Thanks [@hussmartinez](https://github.com/hussmartinez)! - An image engine that loses worker-owned sources or a transferred canvas now becomes terminal. Processing rejects `WORKER_TERMINATED` with `details.reason: "engine-invalidated"`; explicitly recreate the engine, processor and session, plus any renderer and its DOM canvas, then reopen the image. React hosts must remount and replace supplied resources; custom-element hosts must create a new element instance. The editor shows a translatable recovery notice. Unsaved edits need host-managed preservation; no automatic reload, remount or re-decoding occurs.

### Patch Changes

- [#54](https://github.com/ie-huss-martinez/image-sdk/pull/54) [`ee00acc`](https://github.com/ie-huss-martinez/image-sdk/commit/ee00acc737a4e3a6f172da3bd3ec16dc85b89e88) Thanks [@hussmartinez](https://github.com/hussmartinez)! - `ImageSession.open()` and `export()` now apply `filePolicy.maxProcessingTime` (120 seconds by default), aborting with `PROCESSING_TIME_EXCEEDED` and limit details. Custom adapters must honor the supplied signal; arbitrary host adapters cannot be preempted.

- [#51](https://github.com/ie-huss-martinez/image-sdk/pull/51) [`22b2286`](https://github.com/ie-huss-martinez/image-sdk/commit/22b22867280133f4b34c5064723b7120b1ac1a4b) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Fix crop handles in ImageEditor on right-to-left pages so each handle stays on the image edge it resizes.

- [#55](https://github.com/ie-huss-martinez/image-sdk/pull/55) [`fbcdb41`](https://github.com/ie-huss-martinez/image-sdk/commit/fbcdb4190762d3908dfc3a38306402592f50d149) Thanks [@hussmartinez](https://github.com/hussmartinez)! - `ImageEditor` and `createImageEngine` now accept relative `assetsUrl` values during server rendering without starting a worker. Asset URLs are validated at setup and resolved against the browser page only when the worker starts. The minimum `@hussmartinez/sdk-core` dependency is now `^0.4.4`.

## 0.2.0

### Minor Changes

- [#47](https://github.com/ie-huss-martinez/image-sdk/pull/47) [`a8f145b`](https://github.com/ie-huss-martinez/image-sdk/commit/a8f145b52115b0aabab588b78ddc855793e7782c) Thanks [@hussmartinez](https://github.com/hussmartinez)! - `<ImageEditor>` takes `features` and `theme` (docs/adr/0007).
  
  - **`features`** turns capabilities on and off: `adjust`, `filters` and `info`, the inspector's panels, and `export`, the Export tool and its dialog. Each is on unless it's `false`. With one panel on, the inspector shows it without a choice of panels. With `export` off, nothing in the editor exports, and the ref handle's `export()` still gives the host the file.
  - **`theme`**, `light`, `dark` or `system`, sets ui's colour mode on the editor's root. Unset, the editor follows the page's.

- [#46](https://github.com/ie-huss-martinez/image-sdk/pull/46) [`740c6e9`](https://github.com/ie-huss-martinez/image-sdk/commit/740c6e985a0d45fe7a57607edcaa3e428cbd8e5a) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The editor shows the stage's warnings and a new Info panel (docs/adr/0007).
  
  - **Notices:** the limits an opened image comes near, such as a large file or many frames, and, when it has a colour profile, that colours outside sRGB will be clipped in the exported file. They're polite notices at the foot of the stage, each with a Dismiss button. A dismissed notice shows again for another image that has it.
  - **`ImageInfoPanel`:** a third inspector panel, Info, with the image's upright size, format, frames and file size, the kinds of metadata it carries, and the fields kept on export. It never shows the file's name.
  - **`ImageSessionSource.fileSize`:** the opened file's size in bytes.

### Patch Changes

- [#42](https://github.com/ie-huss-martinez/image-sdk/pull/42) [`a5eb52a`](https://github.com/ie-huss-martinez/image-sdk/commit/a5eb52a9adef79b1f8e213bf082b0914b5703ffa) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The editor shows a failed first open inside the empty stage's drop zone, under its text and by the button that retries, instead of as a banner over the drop zone's border. Over an open image, a failure is still a banner at the foot of the stage.

## 0.1.0

### Minor Changes

- [#3](https://github.com/ie-huss-martinez/image-sdk/pull/3) [`7204bfe`](https://github.com/ie-huss-martinez/image-sdk/commit/7204bfe2d000658d0f67ef4d4450e6897b73ad61) Thanks [@hussmartinez](https://github.com/hussmartinez)! - First release of `@hussmartinez/image-sdk`, an image SDK that works entirely in the browser: images are opened, edited and exported on the user's device and never uploaded.
  
  - **Package shape:** an ES module package with a server-safe headless core (`@hussmartinez/image-sdk`), a React entry (`@hussmartinez/image-sdk/react`), a custom element entry (`@hussmartinez/image-sdk/element`) and one stylesheet (`@hussmartinez/image-sdk/styles.css`), which applications import once. React and React DOM 18.3 or later are optional peer dependencies.
  - **Errors:** every failure is an `ImageError` with a stable `code`, such as `INVALID_IMAGE`, `UNSUPPORTED_FORMAT`, `DECODE_FAILED` or `IMAGE_TOO_LARGE`, and structured `details`. `isImageError(error, code)` checks one, across workers and copies of the package.
  - **Limits for untrusted files:** `imageLimits` adds `maxImagePixels`, `maxImageDimension`, `maxFrames`, `maxSessionSize` and `maxLayers` to the family's limits on file size, file count, decoded size and processing time, with defaults sized for images: 50 megapixels per image and 1 GB of decoded images. `maxImagePixels` has the same name and code as in `@hussmartinez/pdf-sdk`. Set them with a `filePolicy`; a misspelt limit name throws instead of being ignored.
  - **Translatable text:** `imageMessages` is the English catalogue for every error code and limit warning, for `createMessages` from `@hussmartinez/sdk-core`. Error text comes from the code and its details, never from the error's message.
  - **The layer plan:** `ImagePlan` is the editor's document: an image's crop in whole upright pixels, its own rotation and flips, the export's size, and the metadata fields to keep, over a source that's never modified. `createPlan(sourceId)` makes one, and `compositionSize`, `outputSize`, `sourceToComposition` and `compositionToSource` measure it and map points between the image and the result, for every rotation and flip.
  - **Edits as commands:** `image.setCrop`, `image.setOrientation`, `image.setOutput` and `image.setMetadata` are plain, cloneable commands. `createImageReducer` applies one and returns the command that undoes it, and rejects an invalid one with `INVALID_COMMAND` rather than correcting it.
  - **The image engine:** `createImageEngine()` probes files with the SDK's own readers and decodes them upright with the browser's decoder, in a worker that holds the sources, and checks every decode against the probe. Oriented files come out upright in every browser, even where the browser's decoder ignores a format's orientation. The worker is inlined by default; `assetsUrl` loads it from your own origin instead. `register` checks a file's own limits from your `filePolicy` against the engine's own probe before decoding, with `checkFileLimits`, which is exported for your own engines.
  - **Export:** `createImageProcessor(engine)` renders a plan in the engine's worker and encodes PNG, JPEG or WebP, in sRGB, after checking the output size against your `filePolicy`. A format the browser can't encode fails with `UNSUPPORTED_FORMAT` rather than saving mislabelled bytes. Exports carry only the metadata the user kept, title, description, artist and copyright, and never a location, camera details, timestamps, a thumbnail, a colour profile or an orientation.
  - **Develop and filters:** `image.setDevelop` adjusts the image's temperature, tint, exposure, highlights, shadows, contrast, saturation and vibrance, each from -100 to 100, and `image.setFilter` applies one of the `vivid`, `warm`, `cool`, `fade`, `mono`, `noir` and `sepia` presets at a strength from 0 to 100. They're the SDK's own pixel math, so they render the same in every browser and in the preview and the export, and they never change text, shapes or redactions drawn over the image.
  - **The preview:** `createImageRenderer(engine)` hands a page `<canvas>` to the engine's worker, which draws the plan into it, fitted, zoomed and panned at the device pixel ratio, through the same renderer as the export. Renders are coalesced: when edits arrive faster than they're drawn, only the latest is drawn, and a render in progress stops early.
  - **The session:** `createImageSession({ engine, processor })` holds one document: `open(file)` probes it, checks it against your `filePolicy` before decoding it and makes it the document, and the newest open always wins; `execute`, `group`, `undo` and `redo` edit the plan as undoable steps; and `export` returns the file with a summary of the metadata that was removed and the fields that were kept. Its snapshot suits `useSyncExternalStore`, and its `onEvent` events never carry file names, text or metadata values.
  - **The React editor:** `<ImageEditor>` from `@hussmartinez/image-sdk/react` opens an image from a drop zone or a button, shows it on a stage drawn in the worker, and has a toolbar to open, undo, redo, rotate and zoom, with the family's keyboard shortcuts while focus is inside it, using ⌘ on Apple devices once the page has hydrated, so a server-rendered editor hydrates without a mismatch. Its preview is announced to screen readers as an image with its size, and stays out of the tab order. `ImageEditorProvider`, `ImageStage`, `ImageToolbar` and the `useImageSession`, `useImageDocument`, `useImageView` and `useImageMessages` hooks build your own layout. Import `@hussmartinez/ui/styles.css` once before this package's stylesheet.
  - **Cropping:** `C`, or the crop button, shows the whole image with a crop frame over it. Drag the frame or its handles, or use the keyboard: arrows move it as you see it, Shift by 10 pixels, Alt to resize, Enter to apply and Escape to cancel. The crop panel has the same crop as number fields, with aspect presets from free and original to 16:9 and portrait. A whole crop is one undo step. Flip buttons mirror the image, and a host can hold the plan itself with the editor's `plan` prop.
  - **Adjust and Filters panels:** a slider per adjustment, each with a reset, and "Reset all"; and the filter presets with a strength slider. Dragging a slider, or holding a key on it, previews on the stage and is one undo step, and one `onChange`, when it ends; Escape cancels it. Hosts translate ui's text, such as the drop zone's, through the editor's `messages` too.
  - **The export dialog:** the toolbar's Export button opens a dialog with the format, a quality for JPEG and WebP, the size, and the details to keep (title, description, artist and copyright, which start empty). Before anything is written it summarises the output's size and format, the metadata the image carried that the file won't, and the fields kept. The export shows progress and can be stopped; then a Download button takes focus. Pass `onExport` to take the file yourself instead. `ImageExportDialog` builds your own layout.
  - **The `<hm-image-editor>` element:** `defineImageEditorElement()` from `@hussmartinez/image-sdk/element` registers it; importing the entry registers nothing, and does nothing on a server. It renders the editor into its light DOM, with the attributes `theme`, `locale` and `tools`, the properties `file`, `plan`, `filePolicy`, `assetsUrl`, `messages`, `engine` and `processor`, the methods `open`, `execute`, `export`, `undo` and `redo`, and the events `hm-image-editor-change`, `-event`, `-export` and `-error`, none of which carries a file name or contents. It needs React and React DOM, the package's optional peer dependencies.
  - **A portable plan format** (sdk-core ADR 0045): `toImagePlanDocument(plan, sources)` writes the plan as `hm-image-plan` version 1, plain JSON, and `readImagePlanDocument(json)` reads one back and checks it fully. Another format or a later version fails with `UNSUPPORTED_FORMAT`, and anything else wrong with `INVALID_DOCUMENT`, each with a `details.reason`. Commands are strict, and every `INVALID_COMMAND` carries a `details.reason` from `ImageCommandRejection`. JSON Schemas for the plan and the commands ship under `@hussmartinez/image-sdk/formats/`, and language-neutral conformance vectors are in the repository.
  - **Contracts for your own engines:** `ImageEngine` probes files, decodes them into sources upright, makes thumbnails and releases sources, and `ImageProcessor` renders and encodes a plan, writing only the metadata the user kept and never a location. Pass your own implementations to replace the SDK's.
