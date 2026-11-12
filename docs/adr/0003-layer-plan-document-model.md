# 0003. The layer plan: edits change a model, and pixels are rendered on export

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

Every edit is a serialisable command, with undo and redo within a memory budget ([ADR 0010](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0010-edits-as-commands.md)). Sessions build on `sdk-core`'s `createStore`, `createHistory` and `Reducer` ([ADR 0029](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0029-session-store-and-history.md)), and the session depends only on ports ([ADR 0008](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0008-ports-adapters-and-session.md)).

An image editor could store each edit's result as new pixels. A 24-megapixel photo is about 96 MB of RGBA, so even a short history of pixel snapshots exhausts memory, and every edit would cost a full re-render before the next could start. Most of what people do to an image (crop, rotate, adjust, add text, draw, redact) is cheaper to describe than to apply.

The replaced application proved the approach: its document was a serialisable description of the edits over unchanged sources, with commands and inverses, and one renderer for preview and export. This record keeps those ideas, on the family's primitives.

## Decision

### The model

The session's document is a **layer plan** over immutable sources:

- **Sources:** each opened or inserted file, probed, decoded once in the render worker ([ADR 0002](0002-workers-and-assets.md)) and never modified. The core sees a source as its id, its oriented width and height, its format, whether it has alpha, and what metadata it carried ([ADR 0005](0005-colour-orientation-and-metadata.md)). It never sees pixels, so the core uses no DOM types and tests run in Node.
- **The plan:**
  - **`base`:** the image being edited, a source with:
    - **`crop`:** `{ x, y, width, height }` in whole pixels of the oriented source, or none for the whole image;
    - **`orientation`:** `rotate` (0, 90, 180 or 270 degrees) and `flipX`, `flipY`, applied after the crop;
    - **`develop`:** exposure, contrast, saturation, temperature and the other adjustments, each a number in a fixed range, with 0 meaning unchanged;
    - **`filter`:** a preset name and its strength, or none.
  - **`canvas`:** the composition's size and background colour. By default it follows the cropped, oriented base.
  - **`layers`:** an ordered list, drawn bottom to top over the base. Each has a stable `key`, `visible`, `opacity` and a kind:
    - `text`: the text, a font from a fixed system-font list, size, colour, alignment and an optional outline;
    - `shape` and `sticker`: a built-in shape or an emoji, with fill and stroke;
    - `image`: another source, with its own crop;
    - `stroke` and `arrow`: freehand and straight-line drawing, as point lists;
    - `redact`: a region that's pixelated, blurred or filled solid ([ADR 0001](0001-image-engines.md)).

    Positioned layers have a transform: centre, width, height and rotation in canvas pixels.
  - **`output`:** the export's size, as a scale or a box to fit.
  - **`metadata`:** the fields the user chose to keep on export ([ADR 0005](0005-colour-orientation-and-metadata.md)).
- **One renderer is the definition of the result.** `planToOperations(plan)` is pure, and the render worker draws its operations ([ADR 0001](0001-image-engines.md)). The preview, thumbnails and every export use it, so there's no second path that can disagree.

### Geometry

- **The crop is in whole pixels of the oriented source,** applied before the plan's own rotation and flips. So cropping then rotating is stable: rotating never moves the crop on the source.
- **Layers live in canvas pixels,** as floating-point numbers, after the base's crop and orientation. Output scaling scales the whole composition.
- **The geometry is pure code shared by the page and the worker:** the renderer uses it to draw, and the page uses its inverse to place handles and map the pointer. Its tests cover every rotation and flip, round-tripping points between canvas and source.

### Commands

Commands are plain, structured-cloneable data, named `image.*`:

| Command | Changes |
|---|---|
| `image.setCrop { crop }` | The base's crop, or none |
| `image.setOrientation { rotate, flipX, flipY }` | The base's rotation and flips |
| `image.setDevelop { values }` | Some of the base's adjustments |
| `image.setFilter { filter }` | The base's filter preset and strength |
| `image.setCanvas { width, height, background }` | The composition's size and background |
| `image.insertLayers { at, layers }` | Inserts layers at an index |
| `image.removeLayers { keys }` | Removes layers |
| `image.restoreLayers { entries }` | Puts layers back at their indexes, with every field as it was. The inverse of most layer edits |
| `image.transformLayers { keys, transforms }` | Moves, resizes or rotates layers |
| `image.reorderLayers { keys, to }` | Moves layers to an index |
| `image.setLayerProps { key, props }` | A layer's own properties, such as its text, colour or opacity |
| `image.addStrokePoints { key, points }` | Extends a stroke while drawing |
| `image.setOutput { output }` | The export's size |
| `image.setMetadata { field, value }` | One metadata field to keep on export |

- **The reducer is `sdk-core`'s `Reducer<ImagePlan, ImageCommand>`:** a pure function that applies one command and returns its inverse. The session applies sequences with `applyCommands`, which returns the inverses in the order undo needs.
- **Commands carry everything the reducer needs,** so it stays pure. The keys of new layers are in the command, generated by the session before it executes.
- **Invalid commands throw `ImageError` with `INVALID_COMMAND`:** for example, a crop outside its source or smaller than one pixel, an unknown key, or an adjustment outside its range. The UI clamps what people enter before building a command. The reducer doesn't silently correct one.
- **Sources are registered, not carried in commands.** `session.open(file)` and `session.insertImage(file)` probe the file, check it against the file policy, decode it into a source, and then execute commands that refer to the source's id. Commands never carry pixels.
- **Edits that change pixels in a way the plan can't express,** such as painting a mask by hand or healing, would add an `image.materialize` command later: it renders a region into a new source, and its history step holds that source, which the memory policy counts ([ADR 0004](0004-image-limits.md)).

### The session

- **The store is `sdk-core`'s `createStore`.** The snapshot holds:
  - the status, the sources (without pixels), the plan and the metadata the sources carried;
  - the selection (which layers are selected) and the active tool, which are view state outside the history;
  - `canUndo`, `canRedo` and whether history was trimmed;
  - warnings and the last error.
- **The history is `sdk-core`'s `createHistory`,** with `group()` for gestures that make several commands, such as dragging a crop handle, drawing a stroke or typing into a text layer, which are each one undoable step.
- **Undo uses inverse commands, never pixel snapshots.** A step costs a few hundred bytes, plus any sources it still refers to, which [ADR 0004](0004-image-limits.md) counts.
- **Sources are released when nothing refers to them:** not the plan, not a history step, and no export in progress. Releasing closes the worker's bitmap.
- **The view isn't in the session.** Zoom and pan change many times a second, so the stage has its own small store, also from `createStore`, which the render worker reads with the plan.
- **Events:** each command emits an anonymous event with its type and outcome for the host's `onEvent`. Events never carry file names, pixels, text the user typed or metadata values.
- **Async results check what they started from.** A decode or export that finishes after the document it belongs to was replaced, or after the layer it targets was removed, applies nothing, and its resources are released. The replaced application's race between opening one file and another while the first was still loading is a test case here.

### Exporting

`session.export(options)` sends the plan to the render worker, which renders it at the output size and encodes it ([ADR 0001](0001-image-engines.md)):

1. **Render:** the renderer draws the plan into a full-size `OffscreenCanvas`.
2. **Encode:** PNG, JPEG or, where the browser can, WebP; or GIF through the job worker.
3. **Metadata:** only the fields the user kept are written, never a location ([ADR 0005](0005-colour-orientation-and-metadata.md)).

The result is a `Blob`. Export never downloads anything itself: the editor shows a summary first, with the format, dimensions, size and which metadata was removed ([STANDARDS](https://github.com/ie-huss-martinez/sdk-core/blob/main/STANDARDS.md#ux)), and the host's `onExport` can take the `Blob` instead. Export is cancellable and reports progress.

### The ports

| Port | Does | Default adapter |
|---|---|---|
| `ImageEngine` | probes files, decodes them into sources, makes thumbnails, releases sources | the render worker's readers and `createImageBitmap` ([ADR 0001](0001-image-engines.md)) |
| `ImageRenderer` | draws a plan into the editor's canvas | the render worker's `OffscreenCanvas` ([ADR 0002](0002-workers-and-assets.md)) |
| `ImageProcessor` | renders and encodes a plan for export | the render worker's encoders, and `gifenc` in the job worker |

The session depends only on the ports. Unit tests run it against fakes, without a browser, and every adapter passes its port's contract tests.

The model, commands, session and ports are the core: they import `@hussmartinez/sdk-core` and nothing else. Only `features/`, `react/` and `element/` import `@hussmartinez/ui` ([ADR 0036](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0036-ui-as-a-dependency-of-the-sdks.md)).

## Alternatives considered

- **Pixel snapshots for undo:** simple and general, but each step can cost a full-size bitmap, and history would hold only a handful of steps for a large photo.
- **Applying every edit to pixels as it's made:** each edit would wait for a full render, and undoing a crop would need the pixels it discarded.
- **Porting the replaced application's model as it is:** its ideas are kept, but it carries its own history, jobs, limits and store, which the family's primitives replace, and features this SDK doesn't have yet, such as collages and projects.

## Consequences

- **Every edit is instant and cheap to undo,** since it changes a description, and the render worker redraws the latest plan.
- **Preview and export agree by construction,** because both go through `planToOperations`.
- **What the plan can't express needs `image.materialize`,** whose history steps count against memory.
- **Collages, animation timelines and projects extend the model** in later records: a timeline would give layers and the base a frame range, and a collage would place several image layers in cells. The commands above stay valid, so these are extensions, not rewrites.
