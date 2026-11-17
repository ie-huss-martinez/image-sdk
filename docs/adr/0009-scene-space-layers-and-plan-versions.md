# 0009. Scene space, layers and marks, and the plan's format versions

- **Status:** Accepted
- **Date:** 2026-11-17
- **Partially supersedes:** [ADR 0003](0003-layer-plan-document-model.md): its layer geometry (layers in canvas pixels), its list of layer kinds, its layer commands and `canvas`. The rest of ADR 0003 stands
- **Amended:** 2026-11-17: a font family and `bold` are requests the device answers, as measured, under "Text is drawn by the device's fonts"
- **Amended:** 2026-11-17: a layer's box has `flipX`, so a layer can be mirrored, and one added to a mirrored image reads as it should, under "A box can be mirrored"
- **Amended:** 2026-11-17, by [ADR 0014](0014-drawing-strokes-and-arrows.md): a stroke holds `runs` of points, so that a long stroke stays one stroke
- **Amended:** 2026-11-17: format version 4 and the animation ship in 0.7.0, not 0.6.0, which carried the GIF decoder and its fixes with no change to the plan

## Context

Releases up to 0.3.0 edit one image: the plan has a `base`, an `output` and `metadata`. The next releases add redaction and layers (0.4.0), drawing (0.5.0) and animation (0.7.0; 0.6.0 changed how a GIF is decoded, not the plan). [ADR 0003](0003-layer-plan-document-model.md) sketched layers before any were built. Three parts of that sketch don't hold up.

- **Layers in canvas pixels come loose from the photo.** ADR 0003 places layers in the canvas, after the base's crop and orientation. A layer then keeps its canvas position when the base is rotated or cropped again, while the photo moves beneath it. For an arrow that's a nuisance. For a redaction it's a leak: the bar stays where it was, and the face it covered is somewhere else.
- **A redaction as a layer has too many states.** A layer has an opacity, a visibility and a place in the stack. A redaction with any of those can be half-applied, or sit under something the user thinks it covers.
- **Floating-point positions aren't portable.** [sdk-core ADR 0045](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0045-portable-formats-and-conformance-vectors.md) asks for integers or a stated integer grid, so a port in another language reproduces a document exactly.

The plan and its commands have a portable format, `hm-image-plan` and `hm-image-command` version 1 ([the format record](../formats/hm-image-plan.md)), with strict schemas and readers. Every release here changes what a plan can hold, so each needs a rule for versions.

Two records follow this one: [ADR 0010](0010-redaction.md) decides how a redaction is rendered and proved, and [ADR 0011](0011-gif-and-animation.md) decides GIF decoding, animation and GIF export. This record decides the model they share.

## Decision

### Scene space: everything is anchored to the photo

- **The scene is the base's oriented source,** in its whole pixels: the grid the crop already uses ([ADR 0003](0003-layer-plan-document-model.md), [ADR 0005](0005-colour-orientation-and-metadata.md)). Every layer, mark and redaction is placed in it.
- **Crop, orientation and output scale apply to the composed scene,** not to the base alone. Rotating the image turns its annotations with it, and cropping crops them.
- **So an annotation never moves off what it marks.** `image.setCrop` and `image.setOrientation` don't touch layers or redactions, and their inverses stay as simple as they are.
- **Annotations may reach outside the source.** What falls outside the crop, or outside the source when there's no crop, isn't drawn.
- **One geometry.** `sourceToComposition` and its inverse already map a point through the crop, the rotation and the flips. The renderer draws layers through that mapping, and the page places handles with it. The plan's rotations are quarter turns, so an axis-aligned rectangle in the scene is axis-aligned in the output.
- **`canvas` is dropped from the model.** The composition is always the cropped, oriented scene. A canvas larger than the photo, and collages, would come back in a later record, as a crop that may extend past the source.

### The plan

```ts
interface ImagePlan {
  base: ImageBase;                    // unchanged
  layers: readonly ImageLayer[];      // bottom to top, over the base
  redactions: readonly ImageRedaction[]; // over everything (ADR 0010)
  animation: ImageAnimation | null;   // from 0.7.0 (ADR 0011)
  output: ImageOutput;                // unchanged
  metadata: ImageKeepableMetadata;    // unchanged
}
```

- **Rendering order:** the base, developed and filtered as [ADR 0006](0006-develop-and-filters.md) says; then the layers, bottom to top; then the redactions; then the output scale. Layers are never developed.
- **Redactions aren't layers.** They're their own list, applied after every layer, with no opacity, visibility, rotation or order that matters. [ADR 0010](0010-redaction.md) gives the reasons and the proof.
- **A renderer never skips what it can't draw.** A plan with a layer kind, a redaction mode or an animation the renderer or processor doesn't know fails with an error. Nothing is drawn or exported without it. `sdk-core` already refuses a self-hosted worker from another package version ([ADR 0038](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0038-self-hosted-assets-and-worker-version.md)); this covers custom engines and processors too.

### Layers

Every layer has:

| Field | Value |
|---|---|
| `key` | Its identity: 1 to 64 code points, unique among the plan's layers, redactions and frames. The session generates keys before it executes a command, so the reducer stays pure |
| `kind` | `text`, `shape` or `image`; from 0.5.0 also `drawing` and `arrow` |
| `name` | What the layers list calls it: up to 100 code points. Empty means the editor's own label for the kind |
| `visible` | Whether it's drawn |
| `opacity` | A whole number from 0 to 100 |

Positioned kinds (`text`, `shape`, `image`) have a **box**: `x`, `y`, `width` and `height` in whole scene pixels; `rotation` in tenths of a degree clockwise about the box's centre, from 0 to 3599; and `flipX`, whether the layer is mirrored. `width` and `height` are at least 1. `x` and `y` may be negative.

**A box can be mirrored.** `flipX` mirrors the layer left to right about the box's own vertical axis, before the box is turned.

- **Why a layer needs it.** The plan's flips mirror the whole scene, layers included, which is right when someone flips an image they've already annotated. But text added after a flip would read backwards, with nothing in the layer to undo it. With `flipX`, a new layer is mirrored back as well as turned back, so it reads as it's meant to whatever the base's orientation: by the editor's tools ([ADR 0013](0013-layers-in-the-editor.md)) and by the session's default placement for `insertImage`, from one calculation in the core. And an image layer can be mirrored for its own sake.
- **One flip, not two.** A mirror top to bottom is `flipX` with a half turn. One field means one way to write each box.
- **Required, like every other field.** An optional field would give two documents for one plan, absent and `false`, and `image.updateLayers`' inverse, which carries the previous value of each field it set, can't carry "absent".
- **In format version 2,** which no release has shipped, so it costs no version.
- **It's in the one transform.** `layerToScene` applies the mirror, and everything else is built on it: the renderer, the copy of an image layer's source that a redaction sanitises ([ADR 0010](0010-redaction.md)), and the editor's frames. The redaction proof covers mirrored image layers.

- **`text`:** `text`, up to 1,000 code points; `font`, one of `sans-serif`, `serif` and `monospace`; `bold`; `colour`; and `align`, one of `start`, `center` and `end`.
  - **The text fills its box.** Lines break only at line feeds. The renderer lays the lines out at one fixed size, then scales them uniformly to the largest size that fits inside the box, and never distorts them. So the box is the layer's whole geometry: the page needs no text measurement to place handles, and the layout can't depend on the size being rendered, because the same layout is scaled for the preview and for an export.
  - **Emoji are text.** There's no sticker kind and no sticker library.
  - **Control characters other than a line feed are refused,** as `invalid-text`.
- **`shape`:** `shape`, `rectangle` or `ellipse`; `fill`, a colour or none; and `stroke`, a colour and a width in whole pixels, or none. At least one of `fill` and `stroke` is set. The stroke is drawn inside the box, so the box is the shape's bounds.
- **`image`:** a registered `source` and its own `crop` in that source's pixels, drawn to fill the box. An animated source shows its first frame.
- **`drawing`** (0.5.0): `x` and `y`, its origin in the scene, and `strokes`. Each stroke has a `colour`, a `width` and `runs`, each a flat list `[x0, y0, x1, y1, …]` of whole pixels from the origin; a stroke has more than one run only when it's long ([ADR 0014](0014-drawing-strokes-and-arrows.md)). One drawing holds many strokes, so a scribble is one row in the layers list and one layer against `maxLayers`. Moving a drawing changes its origin, never its points. A highlighter is a wide stroke in a drawing with a lower `opacity`: the layer is composited as a group, so overlapping strokes don't darken each other.
- **`arrow`** (0.5.0): `from` and `to`, each a point in whole scene pixels, a `colour` and a `width`. The head's size follows the width. It's its own layer because each arrow is an object people select and re-aim.

**Colours** are `#rrggbb` in lower case. Transparency is the layer's `opacity`.

### The integer grid

Every number this record adds is a whole number: scene pixels for positions, sizes and widths; tenths of a degree for rotation; percent for opacity. Positions are within ±65,536, four times the largest side `maxImageDimension` allows by default. Nothing is computed from them in the reducer except comparisons and sums, so the vectors compare plans exactly ([sdk-core ADR 0045](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0045-portable-formats-and-conformance-vectors.md), section 3). The output `scale` stays the format's one float.

The editor snaps what people drag to the grid before it builds a command, as the crop frame does ([ADR 0007](0007-editor-shell.md)).

### Commands

Layers, redactions and, later, frames are each a list of keyed items, and one reducer for keyed lists serves all three. For layers:

| Command | Changes | Its inverse |
|---|---|---|
| `image.insertLayers { at, layers }` | Inserts layers at an index | `image.removeLayers` |
| `image.removeLayers { keys }` | Removes layers | `image.restoreLayers { entries }`, which puts each back at its index, with every field as it was |
| `image.moveLayers { keys, to }` | Moves layers to an index, keeping their order | `image.setLayerOrder { keys }`, the whole previous order |
| `image.updateLayers { updates: [{ key, props }] }` | Sets some of a layer's fields: its box, its opacity, its text | The same command, with the previous values of exactly those fields |
| `image.addStrokes { key, strokes }` (0.5.0) | Appends strokes to a drawing | Removes that many from its end |
| `image.removeStrokes { key, indexes }` (0.5.0) | Removes strokes | Puts each back at its index |

- **`image.updateLayers` replaces ADR 0003's `image.transformLayers` and `image.setLayerProps`.** Moving, resizing and restyling several selected layers is one command, so one undo step. `props` may hold any field of the layer's kind except `key` and `kind`.
- **`image.addStrokePoints` is dropped.** A stroke in progress is a transient plan ([ADR 0007](0007-editor-shell.md)), and one `image.addStrokes` commits it when the pointer lifts.
- **`image.restoreLayers` and `image.setLayerOrder` are inverses only.** They aren't in the portable command format, like every inverse (sdk-core ADR 0045, section 1).
- **Redactions have the same four commands,** `image.insertRedactions`, `image.removeRedactions`, `image.moveRedactions` and `image.updateRedactions` ([ADR 0010](0010-redaction.md)).
- **Every inverse is exact.** A property test applies any valid command to any valid plan, then its inverse, and requires the original plan back, field for field. The vectors carry the same round trip.
- **Rejections** keep their form: `INVALID_COMMAND` with a `details.reason`. The new reasons are `unknown-layer`, `duplicate-key`, `invalid-index`, `wrong-kind`, `invalid-box`, `invalid-opacity`, `invalid-colour`, `invalid-text`, `text-too-long`, `empty-shape` and, as today, `unknown-source` and `crop-outside-source` for an image layer. The format record lists them all.
- **Selection is view state.** Which layers are selected lives in the editor's state, outside the plan and the history, as ADR 0003 says.

### Format versions: one for each release that widens the plan

| Format version | Release | Adds |
|---|---|---|
| 2 | 0.4.0 | `layers` with `text`, `shape` and `image`; `redactions`; `animation`, always `null` |
| 3 | 0.5.0 | The `drawing` and `arrow` kinds, and the stroke commands |
| 4 | 0.7.0 | `animation` as an object, and the frame commands ([ADR 0011](0011-gif-and-animation.md)) |

- **Each widening is a new version, never an addition to the last one.** Readers are strict. A 0.4 reader given a document with a drawing must refuse it as `UNSUPPORTED_FORMAT` with `unknown-format-version`, which a host can show as "update the application". If version 2 had grown a new kind instead, that reader would refuse the same document as `INVALID_DOCUMENT`, which a host shows as a damaged file. Filter presets are different: a preset is a value in a field, and they're only ever added ([ADR 0006](0006-develop-and-filters.md)).
- **`hm-image-command` takes the same version numbers.** Version 1's commands are valid in every later version, unchanged.
- **Each version has a pure migration from the one before:** version 1 to 2 adds `layers: []`, `redactions: []` and `animation: null`; 2 to 3 changes only the version; 3 to 4 also gives each source its `frames`, 1. A reader accepts every version up to its own, migrates step by step, and writes its own. Every earlier version stays readable.
- **Strict, as version 1 is:** every object sets `additionalProperties: false`; kinds are told apart by `kind`; lists carry `maxItems` and text `maxLength`, in code points. A schema's ceilings are fixed: 1,024 layers and redactions together, and 2,000 points in a stroke's run, with 64 runs in a stroke. The file policy's limits apply below them.
- **Keys are data.** Layers are a list, so a key is a string in a field, never a property name. The vectors use `__proto__`, `constructor` and `toString` as keys and as source ids. A key repeated anywhere in a document is `duplicate-key`.
- **Beyond the schema,** a reader checks what depends on the whole document: an image layer's source is one the document lists, and its crop fits that source.
- **Vectors** cover each command with its inverse's round trip, each rejection, each migration, text at its limits with characters outside the Basic Multilingual Plane, and the scene geometry: a box's corners through every crop, rotation and flip, and stroke simplification.

### `ImagePlan` changes in 0.4.0

The three new fields are required, so `ImagePlan` breaks for a host that builds plans by hand. `createPlan` returns them, and `readImagePlanDocument` migrates a stored version 1 document. The changeset says so, with the migration.

### Limits and memory

- **`maxLayers`** (`TOO_MANY_LAYERS`, 256) counts layers and redactions together, on each command that adds one ([ADR 0004](0004-image-limits.md)).
- **`maxDrawingPoints`** (`TOO_MANY_POINTS`, new in 0.5.0): 200,000 points across a plan's drawings, with a warning at 100,000, on each command that adds strokes. The draw tool simplifies a stroke before it commits it, with a fixed algorithm the geometry vectors pin.
- **Image layers are sources.** `maxFiles` and `maxSessionSize` count them, including those only the history refers to, as ADR 0004 already says.
- **The history is bounded by what its steps hold.** `sdk-core`'s history keeps steps and leaves memory policies to each SDK, through `steps`, `dropOrder` and `drop`. Removing a large drawing leaves its points in the step's inverse. So the session counts the points its steps hold, and above 1,000,000 it drops the oldest steps and marks the history as trimmed, as it does for sources. No change to `sdk-core` is needed.
- **Drawing layers costs no second copy of the image.** Text, shapes and strokes are drawn straight into the output. A layer composited as a group, a drawing or a stroked text with an opacity under 100, is drawn into one scratch canvas no larger than the output, checked with `checkOutputLimits` before it's allocated and reused from layer to layer. An export's peak is its sources, the output, that one scratch canvas and the encoded file.

### Preview and export agree

- **One list of operations.** `planToOperations` in the core turns a plan into the operations the worker draws, for the preview and for every export ([ADR 0003](0003-layer-plan-document-model.md)). It's pure, so the vectors cover it.
- **Tests compare pixels.** On all three engines, for each layer kind and each orientation, a preview at one screen pixel per output pixel must equal the PNG export, pixel for pixel.
- **Text is drawn by the device's fonts.** The three families are generic, so the SDK ships no font and fetches none. The same plan can look different on another device, and even between engines on one. The preview and the export of one session always agree, because the same worker draws both from the same layout. The vectors assert operations, never pixels.
  - **A family is a request, not a font.** Two families may be the same font on a device. Measured in the pinned image, in a worker: `serif` and `sans-serif` are two fonts in Chromium, and one font in Firefox and in WebKit.
  - **`bold` is a request too.** The renderer asks the browser for the family's bold, which is a real bold face where the device has one, and the best result there. Where it doesn't, the browser may synthesise one, or change nothing. Measured in the same image: Chromium draws a real bold for `sans-serif` and `serif`, and for `monospace` exactly what it draws without `bold`; Firefox and WebKit synthesise a bold for all three.
  - **The renderer doesn't thicken text itself.** A bold made by stroking the regular face would look the same everywhere, and worse than a real bold face everywhere that has one.
  - **The capability matrix records it,** with the font file the image resolves each generic name to, so a change to the image's fonts shows as the reason the rows changed.
  - **Tests hold for any font.** None compares text with stored pixels or across engines, except the Chromium screenshots (sdk-core ADR 0048). They check that the preview equals the export, pixel for pixel, and properties: the ink is inside the box and as large as fits; alignment orders it by the text's direction; lines are evenly spaced; it turns with its box and stays on its pixels through a crop and a turn. Bold is tested as drawing, fitting and agreeing with the preview, never as differing from regular.
  - **A host can't supply a font in 0.4.0.** When it can, it will pass the font's bytes, never an address: the worker registers them with `FontFace` from a buffer, which makes no request, and the plan names the font by a key. That's a later format version, with its own record.
- **Text in a worker's canvas works in all three engines.** Measured in the pinned image, on Chromium 159, Firefox 159 and WebKit 27.2: `fillText`, `strokeText` and `measureText` on a 2D `OffscreenCanvas` draw Latin and Hebrew text and colour emoji, and a layout drawn at 160 pixels through a half-scale transform gives the same pixels as one drawn at 80. The capability matrix gains these rows before the text renderer relies on them ([ADR 0001](0001-image-engines.md)).

### Hostile text

A plan can come from a file or a host, so its text is untrusted. Text and names are length-limited in code points, drawn only with `fillText` in the worker, and shown in the editor only as text nodes, never as HTML. Events never carry them ([ADR 0003](0003-layer-plan-document-model.md)).

### Keyboard access

- **Everything except the freehand path has a keyboard way.** A text, shape, image, arrow or redaction is inserted at the centre of the view by its tool's button, moved with the arrow keys, resized and turned with keys and with number fields, like the crop frame ([ADR 0007](0007-editor-shell.md)).
- **Freehand drawing needs a pointer.** WCAG 2.2's [2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) excepts dragging that's essential. A freehand stroke is that case: the path is the content, and no sequence of single pointer presses or keys stands in for it. The arrow and the shapes are the keyboard's way to annotate.
- **A drawing layer is fully operable without a pointer once it exists:** it can be selected, moved, hidden, reordered and deleted from the layers list and with the keys, and its last stroke can be removed.
- **The layers list** is a list with one tab stop. Reordering has buttons, not only dragging, and each move is announced with the layer's new position.

### Size budgets

Each pull request sets its budget from the measured size, as [ADR 0006](0006-develop-and-filters.md) did for develop. The model, reducers, readers and migrations are expected to take the server-safe core from 14 kB to about 22 kB, and the layer renderer the worker from 17 kB to about 28 kB with [ADR 0010](0010-redaction.md)'s and [ADR 0011](0011-gif-and-animation.md)'s parts. The React entry stays within its 40 kB: tools that most sessions never open load in their own chunks.

## Alternatives considered

- **Layers in canvas pixels, as ADR 0003 had them:** it's what the replaced application did, and text stays upright when the photo turns. But every crop and rotation would either leave annotations behind or have to rewrite each one, with an inverse that restores them all. And a redaction left behind is a privacy failure.
- **Canvas pixels for layers, scene space only for redactions:** two coordinate systems in one plan, and an arrow that points at a face would stop pointing at it after a crop.
- **Floating-point positions:** finer than a pixel, but the format would need a stated tolerance, and the vectors couldn't compare plans exactly. A whole pixel of the source is finer than anyone places an annotation.
- **Each stroke as its own layer:** one set of commands for everything, but a signature would use dozens of layers and fill the list.
- **Text with a font size, measured to find its box:** the familiar model, but the box would depend on the device's fonts, so the core couldn't know a layer's bounds, and a plan opened elsewhere would have different geometry.
- **Widening version 2 in place for drawing and animation:** fewer versions, but an older reader would call a newer document damaged instead of newer.
- **One command per kind of edit,** such as `image.setLayerText`: clearer names, but dozens of commands with the same shape, and a multi-layer edit would be several undo steps or a group.

## Consequences

- **Annotations and redactions stay on what they mark** through every crop, rotation and flip, by construction.
- **Rotating the image turns its text too.** An annotation is part of the picture. Someone who wants upright text after a turn rotates the text layer.
- **The plan's format has three new versions in three releases,** each with a migration and vectors, and `ImagePlan` breaks once, in 0.4.0.
- **Plans compare exactly,** and a port can reproduce every edit, because no new number is a float.
- **Text depends on the device's fonts.** Documents are portable; their text's pixels aren't.
- **ADR 0003's layer geometry, kinds, commands and `canvas` are superseded.** Its sources, session, history, ports and exporting stand.
