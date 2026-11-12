# 0001. Image engines: our own readers, the browser's decoders and encoders

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

The SDK opens untrusted images: photos, screenshots, downloads and uploads, inside other people's applications. Every file is hostile ([ADR 0012](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0012-hostile-input-and-no-network.md), [ADR 0020](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0020-file-policy.md)), and engines never generate code or fetch anything ([ADR 0028](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0028-third-party-engines.md)).

Images have one risk above the others: **a small file can decode to an enormous bitmap.** A few kilobytes of PNG or WebP can declare tens of thousands of pixels on each side, and an animation can declare hundreds of frames. A decoder allocates what the file declares, so every limit must be checked against a bound the SDK itself has read, before any decoder sees the file.

Browsers already ship hardened, sandboxed image decoders and encoders. `createImageBitmap(blob)` and a 2D `OffscreenCanvas` are available in workers in every supported browser ([ADR 0013](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0013-browser-and-react-support.md); see [ADR 0002](0002-workers-and-assets.md) for how that's checked), so, under rule 1 of [ADR 0031](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0031-platform-decoders-on-the-page.md), decoding belongs in the worker, not on the page.

The application this SDK replaces decoded every image on the page with `createImageBitmap` just to learn its size, before checking any pixel limit, so a crafted file decoded fully before it was refused. It read metadata with a third-party library on the page, and wrote it back with another. This record avoids all three.

## Decision

The first releases bundle **no third-party runtime code**, except the small GIF encoder below. The SDK's own code probes files and reads their metadata; the browser decodes, renders and encodes.

### Probing: our own header readers, in the worker

- **Every file is probed before anything decodes it.** The worker reads the file through `sdk-core`'s windowed reader (`createWindowReader`, [ADR 0037](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0037-windowed-blob-reader.md)), never loading it whole for the probe. The probe returns the format, the stored and oriented width and height, the frame count, whether the image has alpha, its EXIF orientation, which metadata it carries ([ADR 0005](0005-colour-orientation-and-metadata.md)), and an upper bound on the decoded pixels. The limits are checked against that bound ([ADR 0004](0004-image-limits.md)).
- **Formats, identified by their signature bytes, never by the file name or MIME type:**

  | Format | Dimensions from | Frames from |
  |---|---|---|
  | PNG and APNG | `IHDR`, which must be the first chunk | `acTL`, cross-checked against every `fcTL`, each of which must fit inside `IHDR` |
  | JPEG | the `SOFn` segment that the scan follows, found by walking every segment | one |
  | WebP | `VP8 `, `VP8L` or the `VP8X` canvas | every `ANMF` frame, each of which must fit inside the `VP8X` canvas |
  | GIF | the logical screen descriptor | every image descriptor, each of which must fit inside the logical screen |
  | AVIF and HEIF | the primary item's `ispe` in the `meta` box, through `iprp`/`ipma`, cropped by its `clap` clean aperture, which encoders add when they pad to whole coding blocks, and turned by `irot` and `imir` as [ADR 0005](0005-colour-orientation-and-metadata.md) reads them; the decoded bound is the sum over every item decoded with it (see below) | one; image sequences are refused |
  | BMP | `BITMAPINFOHEADER` or later | one |

- **The bound comes from what the decoder will decode, not from the first header that claims something.** A JPEG's dimensions come from the frame header the scan uses, not from EXIF's `PixelXDimension`. Every animation frame is walked and must fit inside the declared canvas, and a header that claims fewer frames than the file carries is an error. A header that claims more than the file's bytes can hold, such as a chunk or segment longer than the rest of the file, fails with `INVALID_IMAGE`. Compressed image data is never inflated or read: the decoder allocates from the dimensions the probe read, which the limits already bound.
- **AVIF and HEIF are bounded by every item the decoder may decode, not by the output size.** The primary item's `ispe` is only the output; the decoder also decodes:
  - **every tile of a `grid` primary item,** each at its own `ispe`. Tiles can be far larger in total than the grid's output, since the output is cropped from them;
  - **every auxiliary or derived item linked to the primary,** such as an alpha plane (`auxl` with an alpha `auxC`), a depth map or a gain map, and thumbnails (`thmb`), each at its own `ispe`.

  So the probe follows every `dimg`, `auxl` and `thmb` reference that leads from or to the primary item, and its **decoded bound is the sum of the `ispe` pixels of the primary and every item reached**. A reference to an item without an `ispe`, or a cycle, is `INVALID_IMAGE`. For a grid:
  - the grid's declared output size must equal the primary item's `ispe`, and fit within its rows × columns of tiles;
  - every tile must have the same size, as the specification requires;
  - the number of tiles is capped at a fixed 1,024, independent of the file policy, because each tile is a separate decode;
  - anything else is `INVALID_IMAGE`.

  `maxDecodedSize` is checked against the sum, and `maxImagePixels` against the output ([ADR 0004](0004-image-limits.md)), so a small declared output over huge tiles or auxiliary planes fails before any decode.
- **Unknown fails closed.** A file whose format isn't one of the above, or whose bound can't be read, fails with `UNSUPPORTED_FORMAT` and never reaches a decoder. That includes SVG: the SDK doesn't open SVG in the first releases. A later record may add it, rasterised only through an `<img>` element, which runs no scripts ([ADR 0012](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0012-hostile-input-and-no-network.md)), and never inserted inline.
- **Malformed fails with a code.** A truncated or inconsistent header fails with `INVALID_IMAGE`, and `details` name the format and what was wrong, never data from the file.

### The readers are hostile-input code

The header and metadata readers are the SDK's own parsers of untrusted bytes, held to the same bar as audio-sdk's:

- **Bounded by construction:** every loop advances by at least one byte; every size read from a file is checked against the bytes that remain before it's used; nesting, such as ISOBMFF boxes or TIFF IFDs, has a fixed depth limit, and IFD offsets that loop are an error; no allocation is sized from file data before the limits are checked.
- **Tested against garbage:** each reader has tests that truncate every fixture at every byte offset, tests on random bytes and on deliberately corrupted headers, a property-based fuzz test with `fast-check` (MIT, a devDependency only) that mutates valid fixtures, and fixtures whose headers under-declare what their data carries, which must fail rather than pass the limits. For AVIF and HEIF these include a small grid output over oversized or too many tiles, tiles of unequal sizes, a grid output that doesn't fit its tiles, oversized auxiliary alpha and gain-map items, and reference cycles. Each case settles within a fixed time with a result, `INVALID_IMAGE` or `UNSUPPORTED_FORMAT`, and never hangs, throws anything else or crashes the worker.
- **Fixtures are generated** by code in the tests: solid colours, gradients and patterns, with headers written by hand. Never photos.

### Decoding: `createImageBitmap` in the worker

- **The worker decodes with `createImageBitmap(blob, { imageOrientation: "from-image", premultiplyAlpha: "none", colorSpaceConversion: "default" })`,** under rule 1 of [ADR 0031](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0031-platform-decoders-on-the-page.md). Nothing is decoded on the page.
- **The decoded size is checked against the probe.** The bitmap's width and height must equal the probe's oriented width and height exactly ([ADR 0005](0005-colour-orientation-and-metadata.md)). Anything else closes the bitmap and fails with `INVALID_IMAGE`. This is the image counterpart of rule 5 of ADR 0031: for a still image the bound is exact, so the tolerance is zero. Orientation is calibrated per format before the check ([ADR 0005](0005-colour-orientation-and-metadata.md)), so the check holds in every browser, and still catches a decoder that disagrees with the probe.
- **Animations:** `createImageBitmap` gives an animated PNG or WebP's first frame only. The first releases open those as still images, and the editor says so. Animated AVIF and HEIF are image sequences, which the decoder sizes from the track rather than from an item the probe bounds, so they're refused with `UNSUPPORTED_FORMAT`, as the table says. GIF animations are decoded frame by frame by our own decoder in the worker, as the replaced application's hardened decoder did, with strict LZW decoding that rejects invalid codes and truncated data, and disposal handled per the GIF89a specification. WebCodecs' `ImageDecoder`, which could decode other animations, is a later record, once it's available in every supported browser.
- **HEIF and other formats the browser may not decode,** such as HEIC outside Safari, are probed like the rest, and a decode the browser refuses fails with `DECODE_FAILED` and `details.format`, never with the browser's message.
- **Time:** every decode runs under `withProcessingTime`. A decode in a worker that doesn't settle in time ends with the worker terminated ([ADR 0018](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0018-worker-rpc-protocol.md)).

### Rendering: one plan, one renderer, for preview and export

- **The renderer is a pure function of the plan** ([ADR 0003](0003-layer-plan-document-model.md)): it turns the plan into an ordered list of 2D canvas operations, which the worker draws onto an `OffscreenCanvas`. The preview and every export draw through it, so what the editor shows is what the file contains, by construction.
- **Redaction is applied to pixels, never as an overlay that could be removed.** A pixelated or blurred region is computed from the pixels beneath it and drawn into the output, and a solid redaction replaces them. The tests read back exported bytes to check that the region's original pixels can't be recovered.

### Encoding: the browser's encoders, and `gifenc` for GIF

- **Still formats** are encoded with `OffscreenCanvas.convertToBlob` in the worker. PNG and JPEG are available everywhere. WebP is detected, never assumed: a browser that can't encode it returns PNG instead, so the SDK checks the returned type and fails with `UNSUPPORTED_FORMAT` and `details.format` rather than saving mislabelled bytes. AVIF encoding isn't offered.
- **Animated GIF** is encoded with **`gifenc`** (MIT, about 9 kB, credited in `NOTICE`), pinned exactly, in the worker. Frames are quantised to at most 255 colours plus one fully transparent index, and each frame clears what the previous frame drew, so transparent areas never leave ghosts.
- **Metadata** is never copied from the source. Exports carry only the fields the user chose to keep ([ADR 0005](0005-colour-orientation-and-metadata.md)).
- **Encoding support follows the browser.** The end-to-end suites keep a capability matrix of each format in Chromium, Firefox and WebKit, and every claim about a browser in these records is checked there before code relies on it. It also confirms that `createImageBitmap` decodes only the primary image of a JPEG that carries secondary images (MPF pictures, Ultra HDR gain maps) or an EXIF thumbnail, and of a HEIF with a `thmb` item. If a browser decodes a secondary image, the probe counts it in the decoded bound, as it does for AVIF's auxiliary items.

### Later engines, each with its own record

- **Camera RAW** through LibRaw compiled to WebAssembly. Its licences (LGPL-2.1 or CDDL-1.0, plus Little CMS and libjpeg) need review for an Apache-2.0 package, and the existing build needs threads, which require the host to be cross-origin isolated. Opt-in only.
- **Background removal** through ONNX Runtime Web (MIT) and a segmentation model, about 19 MB of assets that need `'wasm-unsafe-eval'`. Opt-in only, from self-hosted assets.
- **Wide-gamut colour** ([ADR 0005](0005-colour-orientation-and-metadata.md)).

## Alternatives considered

- **Reading dimensions by decoding:** `createImageBitmap` or an `<img>` element would tell us the size, but only after allocating it. It's the replaced application's bug.
- **A third-party metadata library, such as `exifr`:** it parses far more than the SDK needs, on the page in the replaced application, and its bundle includes a runtime `import()` that [ADR 0028](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0028-third-party-engines.md) doesn't allow. Our own readers parse only orientation and the fields the editor shows.
- **A WebAssembly decoder suite, such as libvips or a codec collection:** megabytes of WebAssembly, `'wasm-unsafe-eval'` in every host's CSP, and more native parsing code to keep patched, for formats the browser already decodes in a sandbox.
- **Decoding on the page with `<img>`:** it's available everywhere, but it's on the page, and ADR 0031 allows that only for decoders that don't exist in workers.
- **WebCodecs' `ImageDecoder` for every format:** it would bring animations, but it isn't in every supported browser yet, and the SDK would still need its own probe.

## Consequences

- **Every limit is checked before decoding,** from bounds our own code read, so a decompression bomb never reaches a decoder.
- **No WebAssembly in the first releases:** the CSP needs no `'wasm-unsafe-eval'` ([ADR 0002](0002-workers-and-assets.md)).
- **Format support depends on the browser** for decoding HEIF and encoding WebP, and the capability matrix documents it.
- **Animated PNG and WebP open as stills,** and AVIF and HEIF sequences are refused, until a later record.
- **The readers are the code most at risk,** so they carry the heaviest tests, and changing them needs fuzz and truncation tests in the same pull request.
