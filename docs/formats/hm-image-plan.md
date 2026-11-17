# `hm-image-plan` and `hm-image-command`, version 4

image-sdk's portable formats ([sdk-core ADR 0045](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0045-portable-formats-and-conformance-vectors.md)). A port in another language reads and writes them, and proves it applies commands as this SDK does by passing the vectors in [`conformance/`](../../conformance).

| Format | Schema | What it holds |
|---|---|---|
| `hm-image-plan` 4 | [`formats/hm-image-plan/v4.schema.json`](../../formats/hm-image-plan/v4.schema.json) | A plan ([ADR 0003](../adr/0003-layer-plan-document-model.md), [ADR 0009](../adr/0009-scene-space-layers-and-plan-versions.md), [ADR 0011](../adr/0011-gif-and-animation.md), [ADR 0014](../adr/0014-drawing-strokes-and-arrows.md)), with the sources it uses |
| `hm-image-command` 4 | [`formats/hm-image-command/v4.schema.json`](../../formats/hm-image-command/v4.schema.json) | One user-level edit command |

## Versions

Each release that widens the plan is a new version, with a migration from the one before, so every earlier version stays readable ([ADR 0009](../adr/0009-scene-space-layers-and-plan-versions.md)). The two formats take the same version numbers.

| Version | Release | Adds | Schemas |
|---|---|---|---|
| 1 | 0.3.0 | The base, the output and the kept metadata | [plan](../../formats/hm-image-plan/v1.schema.json), [command](../../formats/hm-image-command/v1.schema.json) |
| 2 | 0.4.0 | `layers`, with text, shape and image layers; `redactions`; `animation`, always `null`; and the layer and redaction commands | [plan](../../formats/hm-image-plan/v2.schema.json), [command](../../formats/hm-image-command/v2.schema.json) |
| 3 | 0.5.0 | The `drawing` and `arrow` kinds of layer, and the stroke commands | [plan](../../formats/hm-image-plan/v3.schema.json), [command](../../formats/hm-image-command/v3.schema.json) |
| 4 | 0.7.0 | `animation` as an object: frames of the source and a loop count; each source's `frames`; and the frame commands | [plan](../../formats/hm-image-plan/v4.schema.json), [command](../../formats/hm-image-command/v4.schema.json) |

- **A reader accepts every version up to its own, and writes its own.** `readImagePlanDocument` reads versions 1 to 4, and `toImagePlanDocument` writes version 4.
- **A later version is refused as later, never as damaged:** `UNSUPPORTED_FORMAT` with `unknown-format-version`, which an application can show as "update the application".
- **Version 1 to 2:** the document gains `layers: []`, `redactions: []` and `animation: null`, and nothing else changes. A version 1 document is checked as version 1 first, so one that already has those fields is refused, not migrated.
- **Version 2 to 3:** only the version changes. A version 2 document is read with version 2's kinds of layer, so one that holds a drawing or an arrow is refused as `unknown-layer-kind`, not read.
- **Version 3 to 4:** each source gains `frames: 1`, and nothing else changes: every source of an earlier version is a still. A version 3 document is read with what version 3 had, so one whose source has a frame count, or whose `animation` isn't `null`, is refused as `malformed-document`, not read.
- **Each version's commands are valid in the next, unchanged.**
- **A reader of an earlier version refuses a later document as later,** whatever it holds. That's why a new kind, or an animation, is a new version: had version 2 grown a kind, an older reader would call the document damaged.

## Loading the schemas

The schemas ship with the package, under `@hussmartinez/image-sdk/formats/`, so a host validates against the version that matches its installed reader. `readImagePlanDocument` already checks everything the schema does and more, so a host needs the schemas only to validate elsewhere, such as on a server that stores documents, or in another tool.

```ts
import { Ajv2020 } from "ajv/dist/2020.js";
import planSchema from "@hussmartinez/image-sdk/formats/hm-image-plan/v4.schema.json" with { type: "json" };
import commandSchema from "@hussmartinez/image-sdk/formats/hm-image-command/v4.schema.json" with { type: "json" };

const ajv = new Ajv2020({ strict: true });
// The command schema refers to the plan schema's definitions by its $id, so compile that first.
const isPlan = ajv.compile(planSchema);
const isCommand = ajv.compile(commandSchema);

if (!isPlan(JSON.parse(text))) console.error(isPlan.errors);
```

In Node without a bundler, `createRequire(import.meta.url).resolve("@hussmartinez/image-sdk/formats/hm-image-plan/v4.schema.json")` gives the file's path. The vectors in `conformance/` stay in the repository: they're for ports and the SDK's own tests, not for hosts.

## `hm-image-plan`

```json
{
  "format": "hm-image-plan",
  "version": 4,
  "sources": { "s": { "width": 40, "height": 30, "frames": 1 } },
  "base": {
    "source": "s",
    "crop": { "x": 2, "y": 3, "width": 20, "height": 10 },
    "orientation": { "rotate": 90, "flipX": true, "flipY": false },
    "develop": {
      "temperature": 0, "tint": 0, "exposure": 20, "highlights": 0,
      "shadows": 0, "contrast": -15, "saturation": 0, "vibrance": 0
    },
    "filter": { "preset": "sepia", "strength": 60 }
  },
  "layers": [
    {
      "key": "caption", "kind": "text", "name": "", "visible": true, "opacity": 100,
      "x": 2, "y": 20, "width": 30, "height": 8, "rotation": 0, "flipX": false,
      "text": "Harbour\nat dusk", "font": "sans-serif", "bold": true, "colour": "#ffffff", "align": "center"
    },
    {
      "key": "ring", "kind": "shape", "name": "Ring", "visible": true, "opacity": 60,
      "x": -5, "y": 3, "width": 20, "height": 20, "rotation": 450, "flipX": false,
      "shape": "ellipse", "fill": null, "stroke": { "colour": "#ff0000", "width": 2 }
    }
  ],
  "redactions": [
    { "key": "face", "mode": "solid", "x": 4, "y": 5, "width": 12, "height": 8, "colour": "#000000" },
    { "key": "plate", "mode": "pixelate", "x": -3, "y": 20, "width": 30, "height": 15 }
  ],
  "animation": null,
  "output": { "kind": "scale", "scale": 0.5 },
  "metadata": { "title": "Harbour at dusk", "description": "", "artist": "", "copyright": "" }
}
```

- **Numbers:** crops and sizes are whole pixels of the oriented source, the image as its EXIF orientation shows it ([ADR 0005](../adr/0005-colour-orientation-and-metadata.md)). Develop levels and filter strengths are whole numbers. An output `scale` is the one float. It's copied, never computed, so it compares exactly (ADR 0045, section 3).
- **The scene** is the base's oriented source, in whole pixels: the grid the crop uses. Redactions are placed in it, so they stay on the pixels they cover when the image is cropped or turned ([ADR 0009](../adr/0009-scene-space-layers-and-plan-versions.md)). A position may be outside the source, from −65,536 to 65,536.
- **Layers** are drawn over the base, bottom to top, in the list's order ([ADR 0009](../adr/0009-scene-space-layers-and-plan-versions.md)). Every layer has a `key`; a `kind`; a `name` of up to 100 code points, empty for the editor's own label; `visible`; an `opacity` from 0 to 100; and a box in the scene: `x` and `y` from −65,536 to 65,536, `width` and `height` of at least 1, `rotation` in tenths of a degree clockwise about the box's centre, from 0 to 3599, and `flipX`, whether the layer is mirrored left to right about the box's own vertical axis before it's turned. Then, by kind:

  | Kind | Fields |
  |---|---|
  | `text` | `text`, up to 1,000 code points; `font`, one of `sans-serif`, `serif` and `monospace`; `bold`; `colour`; `align`, one of `start`, `center` and `end`. The text is drawn as large as fits in the box, breaking lines only at line feeds |
  | `shape` | `shape`, `rectangle` or `ellipse`; `fill`, a colour or `null`; `stroke`, `{ colour, width }` with a width from 1 to 1,024 pixels, or `null`. One of `fill` and `stroke` isn't `null`. The stroke is inside the box |
  | `image` | `source`, the id of a source the document lists; `crop`, in that source's pixels, or `null` for all of it. Drawn to fill the box |

  | `drawing` | No box: `x` and `y`, its origin, and `strokes`, 1 to 1,024 of them in the order they're drawn. A stroke is `{ colour, width, runs }`: a width from 1 to 1,024 pixels, and 1 to 64 runs, each `[x0, y0, x1, y1, …]` of 1 to 2,000 points in whole pixels from the origin. A run is drawn as a polyline with round joins and ends; one of a single point is a dot. A run that starts on the last point of the run before it continues that line, joined round, so a stroke cut into runs is drawn as one. The drawing is composited as one, so strokes that cross don't darken each other |
  | `arrow` | No box: `from` and `to`, each `{ x, y }` in scene pixels, which differ; `colour`; `width`, the shaft's, from 1 to 1,024 pixels. It's drawn as the polygon `arrowOutline` gives, filled |

  Colours are `#rrggbb` in lower case. Text, shape and image layers have the box; a drawing and an arrow have their own geometry instead ([ADR 0014](../adr/0014-drawing-strokes-and-arrows.md)).
- **A stroke is what one gesture drew.** It has more than one run only when it's long: `simplifyStroke` cuts a long stroke into runs that share their end points. The format doesn't require a run to start where the last ended.
- **A drawing's points stay in the scene:** its origin plus each point is within 65,536 pixels of the scene's origin, when it's inserted, when strokes are added, and when it's moved.
- **What text can hold.** A layer's `text` and `name` can't hold:
  - the C0 control characters other than a line feed, U+0000 to U+0009 and U+000B to U+001F, or U+007F. A carriage return is one of them: lines end with a line feed alone;
  - the bidirectional embedding, override and isolate controls, U+202A to U+202E and U+2066 to U+2069. They can make text read in another order than it's stored: "invoice" then U+202E then "fdp.exe" shows as "invoiceexe.pdf". A caption that's reviewed in one tool and shown in another must read the same in both.

  Everything else is text, including the direction marks U+200E and U+200F, which don't reorder what follows them, the zero-width joiner that emoji sequences need, and right-to-left letters, which the renderer orders as the Unicode algorithm says. The schema's pattern and the reducer refuse the same characters; a test checks every code point up to U+2100 and random strings against both.
- **Redactions** are regions an export doesn't show ([ADR 0010](../adr/0010-redaction.md)), applied over everything else, in order. Each is a rectangle of at least 1 × 1, `solid` with a `colour` as `#rrggbb` in lower case, or `pixelate` with none. A redaction has no opacity, visibility, rotation or name. A document holds at most 1,024 layers and redactions together.
- **Keys** identify layers, redactions and frames. A key is any text of 1 to 64 Unicode code points, and no two items in a document share one, whichever list each is in. Keys are data: `__proto__`, `constructor` and `toString` are keys like any other, and the vectors use them.
- **`animation`** is `null` for a still, or an animation ([ADR 0011](../adr/0011-gif-and-animation.md)):

  ```json
  "animation": {
    "loop": 0,
    "frames": [
      { "key": "first", "frame": 0, "delay": 10 },
      { "key": "second", "frame": 1, "delay": 10 },
      { "key": "again", "frame": 0, "delay": 50 }
    ]
  }
  ```

  - **`frames`** are the frames in the order they play: 1 to 4,096 of them. Each names a `frame` of the base's source, from 0, and its `delay` in hundredths of a second, from 0 to 65,535. A frame holds no pixels, so two may show the same frame of the source, and a source's frame may be shown by none.
  - **`loop`** is `null` to play once, 0 to repeat for ever, or a number of repeats up to 65,535.
  - **Everything else in the plan applies to every frame:** the crop, the orientation, develop and the filter, the layers and the redactions. There are no per-frame layers.
  - **A still has no animation.** An `animation` whose base's source has one frame is refused as `not-animated`, and no command gives a plan an animation or takes it away: a plan is animated from the file it was opened from.
  - **The frame being shown isn't in the plan.** It's view state, like zoom.
- **Sources** are keyed by ids that only mean something within the document, and the base names one of them. Each gives its oriented size and how many `frames` it has, 1 for a still and at most 4,096. Once documents travel with their files, it also gives an `asset`: the SHA-256 of the bytes, their media type and their size. A document never inlines pixels, and never records a file name.
- **Beyond the schema,** a reader checks what depends on the whole document: the base's source and every image layer's are ones the document lists, their crops fit inside them, a shape has a fill or a stroke, no two items share a key, layers and redactions together are at most 1,024, each frame of an animation is one the base's source has, and a source with one frame has no animation.
- **Text lengths:** kept fields hold at most 2,000 Unicode code points, and keys at most 64, as the schema's `maxLength` counts them, and as every language can (sdk-core ADR 0045, section 8). A character outside the BMP, such as an emoji, is one code point, though JavaScript's `length` counts it as two. The vectors check the boundary with such characters.
- **Strict:** an unknown field anywhere is refused, never dropped. So a later version's document can't be misread as this one.
- **Not in the format:** the editor's state, such as a crop in progress or a gesture's preview, and the session's history.

`readImagePlanDocument(json)` reads a document, and `toImagePlanDocument(plan, sources)` writes one.

## `hm-image-command`

The edits a user makes, as [ADR 0003](../adr/0003-layer-plan-document-model.md), [ADR 0009](../adr/0009-scene-space-layers-and-plan-versions.md) and [ADR 0010](../adr/0010-redaction.md) describe them:

| Command | Changes |
|---|---|
| `image.setCrop`, `image.setOrientation`, `image.setDevelop`, `image.setFilter` | The base |
| `image.setOutput`, `image.setMetadata` | The export's size, and one kept field |
| `image.insertLayers { at, layers }` | Inserts layers at an index: 0 is under every layer, the number of layers is over them all |
| `image.removeLayers { keys }` | Removes layers |
| `image.moveLayers { keys, to }` | Moves layers to an index of the list without them. They keep the order they had |
| `image.updateLayers { updates: [{ key, props }] }` | Sets some fields of some layers: any field of the layer's kind except `key`, `kind` and a drawing's `strokes` |
| `image.addStrokes { key, strokes }` | Appends strokes to a drawing: one for each gesture |
| `image.removeStrokes { key, indexes }` | Removes strokes from a drawing, by index. A drawing keeps at least one: to remove the last, remove the layer |
| `image.insertRedactions { at, redactions }` | Inserts redactions at an index, from 0 to the number there are |
| `image.removeRedactions { keys }` | Removes redactions |
| `image.moveRedactions { keys, to }` | Moves redactions to an index of the list without them. They keep the order they had in the list, whatever order `keys` names them in |
| `image.updateRedactions { updates: [{ key, props }] }` | Sets some fields of some redactions: `mode`, `x`, `y`, `width`, `height` and `colour` |
| `image.insertFrames { at, frames }` | Inserts frames at an index, such as duplicates |
| `image.removeFrames { keys }` | Removes frames. An animation keeps at least one |
| `image.moveFrames { keys, to }` | Moves frames to an index of the list without them. They keep the order they had |
| `image.reverseFrames` | Reverses the order the frames play in |
| `image.updateFrames { updates: [{ key, props }] }` | Sets some frames' `delay`. Which frame of the source a frame shows can't be set: insert another |
| `image.setLoop { loop }` | Sets the loop count |

- **`keys`** lists at least one key, none twice.
- **An update's `props`** may be empty. Setting `mode` to `pixelate` drops the colour, so `colour` can't be set with it, or on a redaction that's already pixelated. Setting `mode` to `solid` needs a `colour` in the same `props`.
- **The frame commands need an animation.** On a plan whose `animation` is `null` each is refused as `not-animated`. Trimming is removing frames, and setting every delay is one `image.updateFrames`, so each is one step to undo.
- **Inverses aren't part of the format.** Each command's inverse restores the plan exactly, and the vectors check that, but an inverse's shape is the reducer's own. Seven commands exist only as inverses, `image.restoreLayers`, `image.setLayerOrder`, `image.restoreStrokes`, `image.restoreRedactions`, `image.setRedactionOrder`, `image.restoreFrames` and `image.setFrameOrder`: the TypeScript reducer applies them, the schema doesn't include them, and a port needn't have them.
- **The reducer refuses unknown fields here too.**

## Rejections

A refusal is compared by its code and `details.reason`, never its message:

| Code | Reasons |
|---|---|
| `UNSUPPORTED_FORMAT` | `unknown-format`, `unknown-format-version` |
| `INVALID_DOCUMENT` | `malformed-document`, `unknown-source`, `duplicate-key`, and as for commands: `crop-outside-source`, `invalid-orientation`, `invalid-output`, `metadata-too-long`, `unknown-adjustment`, `invalid-level`, `unknown-preset`, `invalid-strength`, `invalid-key`, `unknown-redaction-mode`, `invalid-region`, `invalid-colour`, `unknown-layer-kind`, `invalid-box`, `invalid-opacity`, `invalid-text`, `text-too-long`, `empty-shape`, `too-many-layers`, `not-animated`, `invalid-frame`, `invalid-delay`, `invalid-loop` |
| `INVALID_COMMAND` | `ImageCommandRejection`'s tokens: those of version 1, `malformed-command`, `unknown-command`, `unknown-source`, `crop-outside-source`, `invalid-orientation`, `invalid-output`, `unknown-metadata-field`, `metadata-too-long`, `unknown-adjustment`, `invalid-level`, `unknown-preset`, `invalid-strength`; and for layers and redactions, the table below. `unknown-source` and `crop-outside-source` apply to an image layer too |

| Reason | When |
|---|---|
| `invalid-key` | A key that's empty, or over 64 code points |
| `duplicate-key` | A new layer, redaction or frame whose key the plan already uses, in any list; two new items, or two updates, with one key |
| `invalid-index` | An index past the end of the list; a stroke index the drawing doesn't have, or one listed twice |
| `unknown-layer` | A key no layer has |
| `unknown-layer-kind` | A kind other than `text`, `shape`, `image`, `drawing` and `arrow`; in a version 2 document, a `drawing` or an `arrow` too |
| `invalid-box` | A box under 1 × 1, further than 65,536 pixels from the origin, or turned by other than 0 to 3599 |
| `invalid-opacity` | An opacity that isn't from 0 to 100 |
| `invalid-text` | Text or a name with a character it can't hold, as above |
| `text-too-long` | Text over 1,000 code points, or a name over 100 |
| `empty-shape` | A shape with neither a fill nor a stroke, new or after an update |
| `empty-drawing` | A drawing with no strokes, or a removal that would leave none |
| `empty-arrow` | An arrow whose `from` and `to` are one point, new or after an update |
| `invalid-points` | A run with an odd number of coordinates, or a point outside the scene's coordinates once its drawing's origin is added, when it's inserted, added to or moved |
| `too-many-strokes` | Strokes added to a drawing that would then have more than 1,024. A host's limit on points is the session's `maxDrawingPoints`, with the `TOO_MANY_POINTS` code |
| `wrong-kind` | An update that sets a field another kind of layer has, such as `fill` on a text layer or `width` on a drawing; a stroke command for a layer that isn't a drawing |
| `unknown-redaction` | A key no redaction has |
| `unknown-redaction-mode` | A mode other than `solid` and `pixelate` |
| `invalid-region` | A region under 1 × 1, or further than 65,536 pixels from the scene's origin |
| `invalid-colour` | A colour that isn't `#rrggbb` in lower case |
| `unexpected-colour` | An update that sets a colour on a pixelated redaction |
| `missing-colour` | An update that sets a redaction to `solid` without a colour |
| `too-many-layers` | More than 1,024 layers and redactions together, the format's ceiling. A host's lower `maxLayers` limit is the session's, with the `TOO_MANY_LAYERS` code |
| `not-animated` | A frame command for a plan whose `animation` is `null`; in a document, an `animation` whose base's source has one frame |
| `unknown-frame` | A key no frame has |
| `invalid-frame` | A frame of the source that the source doesn't have: `frame` at or past the source's `frames` |
| `invalid-delay` | A delay that isn't a whole number from 0 to 65,535 |
| `invalid-loop` | A loop count that isn't `null` or a whole number from 0 to 65,535 |
| `no-frames` | Removing every frame. An animation keeps at least one |
| `too-many-frames` | Frames inserted into an animation that would then have more than 4,096, the format's ceiling. A host's lower `maxFrames` limit is the session's, with the `TOO_MANY_FRAMES` code |
| `invalid-order` | Only from the order commands that undo a move, which aren't in the format |

**What the schema sees is `malformed`.** A refusal the schema expresses on its own, such as a missing field, a fractional pixel, a negative index, a key listed twice in `keys` or a pixelated redaction with a colour, is `malformed-command` or `malformed-document`, unless it has a token of its own above. The other refusals depend on the plan, so the schema accepts those commands and the reducer refuses them. The TypeScript tests hold both sides to that.

`unknown-source` from a command means the session's plan names a source the session doesn't hold; a document's reader refuses that earlier, so the vectors can't reach it.

## The vectors

| File | Subject | A case's input | Its expected result |
|---|---|---|---|
| [`conformance/hm-image-plan.json`](../../conformance/hm-image-plan.json) | `hm-image-plan` | A document | The document as a reader writes it back, or the rejection |
| [`conformance/hm-image-commands.json`](../../conformance/hm-image-commands.json) | `hm-image-commands` | `{ plan, command }` | The resulting document, or the rejection. The command's inverse must also restore the plan |
| [`conformance/hm-image-geometry.json`](../../conformance/hm-image-geometry.json) | `hm-image-geometry` | `{ operation, …arguments }` | The function's result, exactly |

Hand-written cases cover every outcome, including source ids, keys, command types, adjustments and kept fields named `__proto__`, `constructor` and `toString` (ADR 0045, section 8); keys of 64 and 65 code points outside the Basic Multilingual Plane; text at 1,000 and 1,001 code points; each kind of character text can't hold, among them a right-to-left override; an image layer of a source named `constructor`; a plan with as many redactions as the format holds, and layers and redactions that pass it together; and a version 1 document, read and written back as version 2. Generated ones come from the reducer's property-test generators, with a fixed seed: 60 commands that apply, each valid for the plan it's given, and two of each refusal from commands with a field replaced or added. `pnpm conformance:update` rewrites the files, and the tests fail when the checked-in files differ from what the generator writes.

The TypeScript tests also check that the schemas agree with the readers. Every document and command the vectors accept passes its schema, a version 1 document version 1's, and every structural refusal fails it. Every command version 1's schema accepts, version 2's accepts. Over thousands of mutated inputs, the reducer and the reader never accept anything their schema refuses.

## Geometry

`hm-image-geometry` isn't a format: it's the pure geometry a port needs to show and export a plan as this SDK does. Each case names one function and gives its arguments, with `null` for a missing ratio:

| Operation | What it gives |
|---|---|
| `orientedSize` | A stored size under an EXIF orientation, 1 to 8 |
| `compositionSize` | The cropped source, turned by the plan's rotation |
| `outputSize` | The export's size: scaled or fitted, never enlarged, at least 1 × 1 |
| `sourceToComposition`, `compositionToSource` | A point mapped through the crop, the rotation and then the flips, and back |
| `aspectRatio`, `fitAspect` | An aspect's ratio, and the largest centred crop of it |
| `moveCrop`, `dragHandle`, `nudgeCropOnScreen` | A crop moved or resized, kept inside its source, in whole pixels |
| `cropInComposition`, `compositionDeltaToSource`, `handleInSource` | Where a crop shows on screen, and how a drag or a handle on screen maps back to the source |
| `redactionBlockSize` | The side of a pixelated region's blocks: the larger of 8 and a twelfth of its longer side, rounded up |
| `redactionBlocksInScene` | A pixelated region's blocks in the scene, from its top-left corner, each clipped to `within`, the crop |
| `redactionRectInOutput` | The output pixels a region covers, through the crop, the rotation, the flips and the output's size, or `null` |
| `redactionBlocksInOutput` | A pixelated region's blocks in the output, which tile exactly those pixels |
| `sceneRectToComposition`, `compositionRectToScene` | A rectangle of the scene as the composition shows it, without clipping, and back: where an editor places a region's frame, and what a rectangle dragged on screen covers |
| `fitRedactionRegion` | A rectangle as a region: whole pixels, rounded outward, at least 1 × 1, within 65,536 pixels of the origin |
| `layerToScene` | The transform from a layer's own box to the scene: its top-left corner the origin, mirrored about its own vertical axis when it's flipped, then turned about its centre by its rotation |
| `sceneToOutput`, `layerToOutput` | The transform from the scene, or from a layer's box, to an output of a given size, through the crop, the rotation and the flips |
| `sceneToLayerSource` | The transform from the scene to the pixels of an image layer's source, which a renderer uses to replace what a redaction covers |
| `fitTextLines` | Where a text layer's lines go: the scale that fits the block in the box, and each line's left edge and baseline |
| `isRightToLeft` | Whether text reads right to left: whether its first letter with a direction is from a right-to-left script |
| `simplifyStroke` | A pointer's samples as one stroke's runs: repeats dropped, long input cut into runs of at most 2,000 points that share their ends, each simplified by Ramer–Douglas–Peucker with distance to the segment, compared as whole numbers ([ADR 0014](../adr/0014-drawing-strokes-and-arrows.md)) |
| `arrowOutline` | An arrow's seven-point polygon, its tip exactly on `to` |
| `drawingBounds`, `arrowBounds` | The smallest whole-pixel rectangle of the scene that holds what the layer draws |
| `drawingPoints` | How many points a plan's drawings hold, which `maxDrawingPoints` limits |

A transform is six numbers, `[a, b, c, d, e, f]`, as a canvas takes them: `x' = a·x + c·y + e` and `y' = b·x + d·y + f`.

The results compare exactly, with no tolerance, except those of `layerToScene`, `sceneToOutput`, `layerToOutput`, `sceneToLayerSource`, `fitTextLines` and `arrowOutline`, whose cases state a tolerance of 10⁻⁹: they're computed with sines, cosines and divisions, which differ between languages in their last bits (ADR 0045, section 3). A quarter turn is exact: its sine and cosine are 0, 1 and −1, never the nearest double to them. The others need only IEEE addition, multiplication and division, which give the same doubles in every language, and rounding.

**A region is rounded outward, and its blocks to the nearest pixel** ([ADR 0010](../adr/0010-redaction.md)). `redactionRectInOutput` takes `size`, the size being rendered, which needn't keep the composition's proportions: each axis has its own scale, `size.width / composition.width` and `size.height / composition.height`. The region's two edges on each axis go to the output with `floor` for the lower and `ceil` for the upper, so every output pixel the region touches is covered, then are clipped to the output. `redactionBlocksInOutput` maps every block boundary the same way, rounds the ones between blocks with `Math.round`, keeps them in order, and leaves out a block with no pixel. A port that rounds a region's edge inward shows a sliver of what's redacted, so these cases matter more than most.

**Rounding is JavaScript's `Math.round`:** halves round toward positive infinity, so −2.5 rounds to −2. Many languages round halves away from zero, such as Rust's `f64::round`, which gives −3. A port rounds as `floor(x + 0.5)` does, and the vectors include negative halves. `fitAspect` centres with `floor`.

## Changing the formats

A breaking change is a new version, with its schema beside the others and a migration from the version before (ADR 0045, section 1). So is any widening of what a plan holds, such as a new kind of layer ([ADR 0009](../adr/0009-scene-space-layers-and-plan-versions.md)): a reader of the earlier version must refuse the document as a later version, not as a damaged one. A reader refuses a later version with `UNSUPPORTED_FORMAT` and `unknown-format-version`.
