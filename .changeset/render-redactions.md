---
"@hussmartinez/image-sdk": minor
---

Redactions are now rendered: the preview shows them, and exports don't contain what they cover ([ADR 0010](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0010-redaction.md)).

- **A solid redaction destroys its pixels.** An export's bytes don't depend on them: two images that differ only inside the region export to identical files, in PNG, JPEG and WebP, at any output size, crop and orientation. The covered pixels are replaced before the image is scaled, so nothing of them is left along the region's edge, and the region is then filled on whole output pixels, rounded outward.
- **A pixelated redaction keeps only block averages.** Its blocks are the larger of 8 pixels and a twelfth of the region's longer side, so a strip over a line of text is one row of blocks. Pixelation obscures; for text and numbers, use solid.
- **Redactions follow the image.** They're placed on the source's pixels, so they stay on what they cover through every crop, turn and flip.
- **Nothing is drawn without them.** If the renderer can't make the copy it draws from, the preview keeps its last frame and an export fails, with the error's own code.
- **Only exports are redacted.** The plan describes the redaction, and the source the session holds is unchanged; `engine.thumbnail` returns it as it is.
- **New geometry,** for hosts and other renderers that place or draw redactions: `redactionRectInOutput`, `redactionBlocksInOutput`, `redactionBlocksInScene`, `redactionBlockSize` and the `ImageRect` type.

A redaction costs memory while it exists: one more canvas the size of the image. It's checked against `maxImagePixels` and `maxImageDimension` before it's allocated.

Custom `ImageRenderer`s and `ImageProcessor`s that don't draw redactions keep refusing such plans through `checkPlanSupport`. To draw them, follow ADR 0010's two passes, and pass `"redactions"` to `checkPlanSupport`.
