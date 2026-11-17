---
"@hussmartinez/image-sdk": minor
---

Add drawings and arrows to the plan: format version 3 ([ADR 0009](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0009-scene-space-layers-and-plan-versions.md), [ADR 0014](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0014-drawing-strokes-and-arrows.md)).

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
