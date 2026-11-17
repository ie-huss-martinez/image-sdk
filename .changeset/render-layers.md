---
"@hussmartinez/image-sdk": minor
---

Layers are now drawn: the preview shows text, shape and image layers, and exports contain them ([ADR 0009](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0009-scene-space-layers-and-plan-versions.md)).

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
