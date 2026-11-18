---
"@hussmartinez/image-sdk": minor
---

Export to GIF ([ADR 0011](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0011-gif-and-animation.md)): `processor.export({ plan, format: { type: "gif" } })`, `session.export({ type: "gif" })`, and a GIF choice in the export dialog.

- **An animated plan exports every frame,** in its order, with its delays and loop count; a still exports one frame that plays once. Everything else in the plan, the crop, the turn, develop, the layers and the redactions, applies to every frame.
- **Every frame is written whole,** with its own palette of up to 255 colours and one transparent colour, and clears the screen before the next. So a transparent area never shows the frame before, and nothing a redaction covers in one frame can show through another. A pixel under half opaque is written transparent: a GIF has no partial transparency. A file can come out larger than the GIF it was opened from.
- **A GIF carries no metadata.** The fields you keep aren't written to it, the session's `kept` is empty, and the dialog says so.
- **Bounded before it starts:** frames × output pixels × 4 bytes over `maxDecodedSize` fails with `DECODED_SIZE_TOO_LARGE`. Progress is reported by frame, and the export can be cancelled between frames.
- **A second worker writes the file,** started on the first GIF export and stopped after a while without work. It's inlined like the render worker, needing no new Content Security Policy directive. **If you self-host the assets,** copy `dist/assets/` again: it now holds `image/job.worker.js` beside `image/render.worker.js`.
- **The encoder is `gifenc` 1.0.3** (MIT), bundled into that worker and credited in the package's new `NOTICE` file.
- **`ImageExportFormat` gains `{ type: "gif" }`.** Code that switches over `format.type` needs a case for it. **If you pass your own `ImageProcessor`,** the editor's dialog and `session.export` can now ask it for a GIF: handle it, or reject it with `UNSUPPORTED_FORMAT`, which the dialog shows with the catalogue's text.
