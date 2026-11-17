# 0010. Redaction destroys pixels, and a test proves it

- **Status:** Accepted
- **Date:** 2026-11-17
- **Partially supersedes:** [ADR 0001](0001-image-engines.md) and [ADR 0003](0003-layer-plan-document-model.md), only where they name a blurred redaction and a redaction as a kind of layer
- **Amended:** 2026-11-17: a redaction's frame takes the crop frame's keys ([ADR 0007](0007-editor-shell.md)): `Shift` with the arrows resizes, not `Alt`

## Context

People redact before they share: a face, an address, an account number in a screenshot. A redaction that can be undone by the person who receives the file is worse than none, because it's trusted. The known ways an editor gets this wrong:

- **The redaction is an overlay.** The file keeps the original beneath a shape, in a layer, an annotation or an embedded thumbnail.
- **The redaction is in the wrong place.** It was placed, then the image was cropped or rotated, and it stayed behind.
- **The edges leak.** The covered area ends on a fraction of a pixel, or the image is scaled after it's covered, and the pixels along the edge are a blend of the cover and what's beneath.
- **The effect is reversible.** A blur can be deconvolved, and a fine mosaic of text can be matched against renderings of candidate text.

[ADR 0009](0009-scene-space-layers-and-plan-versions.md) settles the second: redactions live in scene space, so they stay on the pixels they cover. This record settles the others. [ADR 0001](0001-image-engines.md) already says redaction is applied to pixels and that tests read exported bytes; this record says how, and what the tests are.

Exports are flat: PNG, JPEG, WebP and GIF hold one image, or frames, with no layers. Metadata is never copied from a source ([ADR 0005](0005-colour-orientation-and-metadata.md)). So the leaks to close are in the rendering.

One of them isn't obvious. A browser's scaler reads a neighbourhood of source pixels for each pixel it writes. If the image is scaled first and covered after, the pixels just outside the cover were computed partly from pixels inside it. Covering a slightly larger area would hide that, but then the preview would cover content that the full-size export shows.

## Decision

### The property

**An export's bytes don't depend on the redacted pixels.** For a solid redaction, changing any pixel inside the region, in the base or in an image layer, leaves every byte of every export unchanged. For a pixelated one, the export depends on those pixels only through the averages this record names. The preview holds to the same property at every zoom.

### The model

`plan.redactions` is a list of regions ([ADR 0009](0009-scene-space-layers-and-plan-versions.md)). Each has:

| Field | Value |
|---|---|
| `key` | Its identity, as for a layer |
| `mode` | `solid` or `pixelate` |
| `x`, `y`, `width`, `height` | A rectangle in whole scene pixels, at least 1 × 1 |
| `colour` | For `solid` only: `#rrggbb`. Black by default |

- **A redaction has no opacity, no visibility, no rotation and no name.** Each would be a state in which the region isn't fully covered. To stop redacting, remove the redaction, which is one undoable step.
- **Redactions apply after every layer,** so nothing can be placed above one, and nothing a user adds later is left uncovered. Their order in the list only decides how two overlapping ones look.
- **A region is a rectangle aligned with the scene.** The plan turns by quarters, so it's a whole-pixel rectangle in the composition too.
- **Commands:** `image.insertRedactions`, `image.removeRedactions`, `image.moveRedactions` and `image.updateRedactions`, with exact inverses, from the keyed-list reducer of ADR 0009. The rejections add `unknown-redaction` and `invalid-region`.
- **Limits:** redactions count against `maxLayers` with the layers.
- **Not built:** a blurred mode, regions drawn with a brush, rotated regions, and any detection of faces or text. ADR 0001 and ADR 0003 name a blurred mode; it's deferred, because it's the easiest to reverse and its result would depend on the size being rendered.

### Rendering: destroy at the source, finish at the output

Two passes, in the render worker, the same for the preview and for every export.

**1. Before anything is scaled, each bitmap is sanitised.** A bitmap is the base, a frame of it, or an image layer's source. If a redaction covers any of it, the renderer draws from a copy in which the covered pixels are already replaced, at the bitmap's own resolution:

- **The base:** a scene pixel is a base pixel, so the region is a whole-pixel rectangle of the copy. A solid redaction fills it with its colour. A pixelated one fills each block with that block's average.
- **An image layer:** the region, mapped into the layer's source, is a quadrilateral. It's filled with the redaction's colour, or for a pixelated redaction with the average of the pixels it covers. Every source pixel that lies wholly inside the region is replaced. A pixel on the boundary is only partly inside, and partly visible outside the region by the layer's own geometry.
- **Nothing reads the original after that.** Scaling, the crop and orientation transform, develop and the filter all work from the sanitised copy.

**2. After every layer is drawn, each redaction is finished on whole output pixels.** The region is mapped to the output and rounded outward, so every output pixel it touches is covered whole, with no blended edge:

- **Solid:** the rectangle is filled with the colour, opaque, with no transform and no anti-aliasing. This restores the exact colour after develop changed the first pass's fill, and covers text, shapes and drawings over the region.
- **Pixelated:** each block's output pixels are replaced by their average.

Text, shapes and strokes are drawn as geometry at the output's size, so they have no pixels to sanitise; the second pass covers them.

**Why two passes.** The first makes the property hold: no scaler ever reads a redacted pixel. The second makes the result exact: the region shows precisely its colour or its blocks, whatever was developed or drawn over it. The second pass alone would leave the scaler's blend along the edge; the first alone would leave layers showing.

### Pixelation

- **Blocks are squares in scene pixels,** aligned to the region's top-left corner. Their side is the larger of 8 and the region's longer side divided by 12, rounded up. So a region has at most 12 blocks along its longer side, and a strip over a line of text is a single row of them. The size isn't a setting: there's no weak value to choose.
- **An average is the mean of each channel** of the pixels in the block that are inside the region and rendered, rounded to 8 bits, on premultiplied values. It's integer arithmetic, the same in every engine.
- **Pixelation obscures; it doesn't destroy.** Block averages are information about what was there. The editor's default is solid, the pixelate option says "For text and numbers, use solid", and the README says the same.
- **Memory:** blocks are read and written in bands of at most 4 MB, as develop is ([ADR 0006](0006-develop-and-filters.md)).

### Memory

- **A sanitised copy is one more canvas the size of its bitmap,** for each bitmap a redaction covers. The worker keeps it while the redactions over that bitmap don't change, so zooming, panning and develop gestures reuse it.
- **It's checked before it's allocated,** with `checkOutputLimits`, and counted in a render's peak ([ADR 0004](0004-image-limits.md)).
- **If it can't be allocated, the render fails.** The preview keeps its previous frame and shows a notice, and an export fails with its error. Nothing is ever drawn from the original to save memory.

### The preview

- **The same two passes,** at the view's size. At one screen pixel per output pixel, the preview's pixels equal the export's.
- **The visible canvas only ever receives a finished frame.** A frame is drawn off screen and copied when it's complete, as today ([ADR 0002](0002-workers-and-assets.md)). And because the sources are sanitised before they're drawn, even an unfinished frame holds no redacted pixel.
- **A gesture's transient plan is rendered the same way** ([ADR 0007](0007-editor-shell.md)). While a region is being placed, the preview shows it applied. While one is being moved, the preview shows the new place covered and the old one uncovered, which is what the move means.

### What isn't redacted

The README and the API documentation say this plainly.

- **Only exports are redacted.** The plan, a portable plan document, and what `onChange` gives a host describe the redaction; they don't contain the image.
- **The source isn't changed.** The session holds it for as long as the document is open, and `engine.thumbnail` returns a small copy of it, unredacted. The editor's own thumbnails of the edited image go through the renderer.
- **A host that removes a redaction from a plan gets an export without it.** The host is trusted with the image, since it's the application the user gave it to.

### In the editor

- **The Redact tool** places a region by dragging, or from the keyboard: its button inserts one at the centre of the view, and the region is then a focusable frame like the crop's, moved with the arrow keys and resized with `Shift` and the arrows, the crop frame's keys, with number fields in its panel ([ADR 0007](0007-editor-shell.md), [ADR 0009](0009-scene-space-layers-and-plan-versions.md)).
- **The panel lists the redactions,** each with its mode, its size and a remove button, so someone who can't see the preview knows what's covered.
- **The export summary says how many areas are redacted,** and when any is pixelated, that pixelated areas may not hide text.
- **Events** say that a redaction command ran, never where ([ADR 0003](0003-layer-plan-document-model.md)).

### The proof

Every test runs on Chromium, Firefox and WebKit, in the worker that renders.

- **Solid redactions don't interfere.** Two sources are generated, equal everywhere except inside the region, where each holds different random pixels. Both are exported with the same plan. The two files must be equal, byte for byte. Equal files leave nowhere for the pixels to be: not in the image, a thumbnail, metadata or any other chunk.
  - **For every format:** PNG, JPEG, WebP, an animated GIF, and the still export of one frame of a GIF.
  - **For any plan:** a property test varies the region, the crop, the rotation and flips, the output scale, the develop values and the filter.
  - **For image layers:** the same, with the difference inside an image layer under the region, turned and scaled.
- **Pixelated redactions leak only averages.** Two sources that differ inside the region, but whose blocks have the same averages, export to equal files.
- **The region is what was asked for.** In a decoded PNG export, every pixel of a solid region is exactly its colour, and the pixels around it equal those of an export without the redaction, at full size.
- **Edges:** a line one pixel wide, just inside the region's edge, leaves no trace at any output scale. It's the non-interference test with the difference on the boundary.
- **The redaction stays on its pixels.** After a redaction is placed, cropping, rotating and flipping the plan still covers the same source pixels.
- **The preview never shows them.** The two sources are rendered to the preview at a range of zooms, above and below one to one, and the canvas's pixels, read back through the worker, must be equal. A test records every frame the visible canvas receives while a plan renders, and during a gesture that places a region with a transient plan, and no frame may differ between the two sources.
- **Metadata:** a source with an embedded thumbnail and descriptive fields that contain a marker exports with no marker in its bytes, with and without redactions. [ADR 0005](0005-colour-orientation-and-metadata.md)'s tests already require this; this one keeps it tied to redaction.
- **Failing closed:** when the sanitised copy can't be allocated, no frame and no file is produced.

## Alternatives considered

- **Covering after scaling, only:** one pass and no copy, but the scaler's blend along the edge depends on the covered pixels, and the byte-for-byte test fails.
- **Covering a larger area, to hide the blend:** how much larger depends on each browser's scaler, which no specification bounds. And a preview that covers more than the export does shows people content as hidden that their file reveals.
- **Rendering the whole composition at full size, then scaling:** correct for the base, but the preview of a large photo would develop every pixel on each change, seconds instead of a fraction of one, and an image layer's own scaling would still blend.
- **A redaction as a layer,** as ADR 0003 sketched: it could be hidden, faded or moved under another layer, each a way to believe something is covered when it isn't.
- **Blur:** the effect people ask for by name, and the weakest. It waits for a record that shows how it's bounded and rendered the same at every size.
- **A pixelation block size people choose:** more control, including the choice of blocks small enough to read through.
- **Redacting the source itself, once, and forgetting the original:** the strongest form, but it can't be undone, and every other edit in this SDK can.

## Consequences

- **A shared file can't give back what was redacted with a solid region,** and the test that shows it is one a reviewer can read: two inputs, equal outputs.
- **A redaction costs memory:** one more canvas for each bitmap it covers, while it exists.
- **Redactions are plain rectangles, always on top.** A caption can't be drawn over one.
- **Pixelation is offered with a warning,** because it isn't destruction.
- **The original stays in the session and in the plan's source.** Only exports are safe to share, and the documentation says so.
