# 0004. Image limits and session memory

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

Every SDK enforces limits on untrusted files with `defineLimits` from `sdk-core`, extending `coreLimits`, and hosts change them through `filePolicy` ([ADR 0020](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0020-file-policy.md)). SDKs may change the core limits' defaults. The family keeps one name per concept: `pdf-sdk` already defines `maxImagePixels` (`IMAGE_TOO_LARGE`, in pixels), so this SDK uses the same limit for the same concept.

An image's risk is the gap between its file size and its decoded size. A decoded pixel is 4 bytes of RGBA. Some examples:

| File | On disk | Decoded |
|---|---|---|
| A 24-megapixel JPEG photo | about 8 MB | about 96 MB |
| A 1000 × 1000 GIF with 300 frames | a few MB | about 1.2 GB, if every frame were held |
| A crafted PNG of one colour, 30000 × 30000 | under 1 MB | about 3.6 GB |

The sources live in the render worker ([ADR 0002](0002-workers-and-assets.md)), so running out of memory there crashes a worker, not the host's tab. But it still takes the browser's memory, and browsers on phones allow much less than on desktops. Canvases are capped too: iOS has historically limited a canvas's area to about 16.7 megapixels, which the capability matrix must confirm for the supported versions.

## Decision

### The limits

`imageLimits` is `coreLimits` with image defaults, plus five image limits, defined with `defineLimits` so that violations throw `ImageError`:

| Limit | Code | Default maximum | Default warning | Checked |
|---|---|---|---|---|
| `maxFileSize` (core) | `FILE_TOO_LARGE` | 100 MB | 50 MB | Each file, before it's read |
| `maxFiles` (core) | `TOO_MANY_FILES` | 20 | none | The sources in a session, on each open and insert |
| `maxDecodedSize` (core) | `DECODED_SIZE_TOO_LARGE` | 1 GB | 400 MB | Each file's decoded size, frames × oriented pixels × 4 bytes, from the probe's bound, before decoding |
| `maxProcessingTime` (core) | `PROCESSING_TIME_EXCEEDED` | 120 s | none | Each probe, decode, render for export and encode |
| `maxImagePixels` | `IMAGE_TOO_LARGE` | 50 megapixels | 24 megapixels | Each image or frame, from the probe; and the canvas and the export's output size, on each command that sets them |
| `maxImageDimension` | `IMAGE_DIMENSION_TOO_LARGE` | 16,384 pixels | none | The width and height of each image or frame, from the probe; and the canvas and output |
| `maxFrames` | `TOO_MANY_FRAMES` | 300 | 100 | Each animation, from the probe's walk of every frame |
| `maxSessionSize` | `SESSION_TOO_LARGE` | 1 GB | 500 MB | The decoded bytes of every source the session holds, including those only history refers to, on each open, insert and materialise |
| `maxLayers` | `TOO_MANY_LAYERS` | 256 | none | The plan, on each command that adds layers |

- **Starting values, measured before the first release.** The end-to-end suites open, edit and export files at each limit on all three engines, with WebKit as a stand-in for mobile Safari. If they're too high for phones, the defaults go down, and the change gets its own record.
- **`maxImagePixels` covers what's drawn, not only what's opened.** A canvas or output size over it fails when the command that sets it runs, so an export can never allocate more than the limit allows. If the capability matrix shows a supported browser's canvas cap below 50 megapixels, either the default goes down to that cap, or the renderer exports in tiles and encodes the result in parts. That choice is a follow-up record, made with the measurement.
- **`maxImageDimension` exists alongside the pixel count** because a 16,385 × 1 image is tiny in pixels but exceeds the side length browsers' canvases allow.

### How each limit behaves

- **Checked before decoding, against a bound our own code read.** Every limit except `maxSessionSize` and `maxLayers` is checked in the render worker after the probe and before any decoder sees the file ([ADR 0001](0001-image-engines.md)). The decoded output is then checked against the probe's exact size.
- **Animations are decoded frame by frame,** with a bounded cache of composited frames in the worker, so memory held for an animation is a few frames, not all of them. `maxDecodedSize` still counts every frame, because it bounds the total work a file can cause, not only what's held at once.
- **Warnings don't stop anything.** When a value is at or above its warning but within the maximum, the session adds a warning, which the editor shows, such as "This image is large; editing may be slow on some devices."
- **`maxSessionSize` is the memory budget.** It counts the decoded bytes of every source the session still holds, whether the plan or only the history refers to it. When an open or insert would exceed it, the session first drops the oldest history steps that are the only reference to a source, with `createHistory`'s `drop`, and marks history as trimmed. If that isn't enough, the action fails with `SESSION_TOO_LARGE`.
- **Rendering stays within budget.** The renderer allocates scratch canvases for filters and redaction only for the area that's drawn, clipped to the canvas, and counts them before allocating. Expensive filters, such as a large blur, are applied at preview resolution in the preview and at full resolution only on export.

### Text

Error text uses `errors.<CODE>` with the error's `details`, and warnings use `warnings.<limit>` ([ADR 0019](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0019-message-catalogues.md)). Sizes are formatted with `Intl`, and pixel counts as megapixels, such as "50 megapixels".

## Alternatives considered

- **A new name for the pixel limit, such as `maxPixels`:** the family already names this concept `maxImagePixels`, and two names for one concept would confuse hosts who use both SDKs.
- **Only `maxDecodedSize`, no pixel limit:** decoded size is the memory risk, but canvas caps are in pixels and side lengths, and an error that names pixels is clearer to users.
- **Holding every animation frame:** simpler, but a few hundred frames at a moderate size exceed what a phone can hold.

## Consequences

- **A decompression bomb is refused before decoding,** with an error that says which limit it hit.
- **The defaults are provisional** until the measurement on all three engines, and the canvas cap may lower `maxImagePixels` or bring tiled export.
- **Hosts can raise or lower every limit** through `filePolicy`, and a misspelt name throws ([ADR 0020](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0020-file-policy.md)).
