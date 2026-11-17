---
"@hussmartinez/image-sdk": minor
---

Draw drawings and arrows, in the preview and in every export ([ADR 0014](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0014-drawing-strokes-and-arrows.md)).

- **Strokes** are drawn as lines through their points, at their width, with round joins and round ends; a single point is a dot. No curve is fitted, so a drawn corner stays a corner.
- **A long stroke is one line.** A stroke that `simplifyStroke` cut into runs is drawn joined where it was cut, the same pixels as if it hadn't been.
- **A drawing is composited as one,** at its layer's opacity, so strokes that cross don't darken each other. A highlighter is a wide stroke in a drawing with a low opacity.
- **An arrow** is drawn as `arrowOutline`'s polygon, filled, with its tip exactly on the point it aims at and nothing past it.
- **Like every layer,** they aren't developed with the base, they stay on the pixels they were drawn on when the image is cropped, turned or mirrored, and redactions cover them.

The built-in renderer and processor now take the `drawings` part of a plan. A custom processor that doesn't draw them still refuses such a plan through `checkPlanSupport`.
