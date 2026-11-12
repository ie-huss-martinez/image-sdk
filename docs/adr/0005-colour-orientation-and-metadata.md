# 0005. Colour, orientation and metadata: sRGB, oriented sources, and nothing kept by default

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

Three properties of image files are easy to get subtly wrong, and each has caused bugs in the application this SDK replaces:

- **Colour:** photos increasingly carry a wide-gamut ICC profile, such as Display P3. A canvas works in sRGB by default, so drawing such an image converts it, and an export without a profile is read as sRGB. Browsers differ in which colour spaces their canvases support.
- **Orientation:** most phone photos are stored sideways with an EXIF `Orientation` tag. If one part of an editor applies the tag and another doesn't, crops land in the wrong place. The replaced application left orientation to the decoder's default, while its RAW path took it from LibRaw: there was no single model of an oriented image.
- **Metadata:** EXIF, XMP and IPTC carry the photo's location, the camera's serial number, timestamps, the owner's name and embedded thumbnails that can show the image before it was cropped. People sharing an edited image rarely want any of that to travel with it, and a location is a real privacy leak. The replaced application did strip GPS on export, but never told the user, and wrote metadata through a library that re-encoded the whole image as a data URL.

## Decision

### Colour: an sRGB working space

- **The working space is sRGB.** Decoding uses `colorSpaceConversion: "default"` ([ADR 0001](0001-image-engines.md)), so the browser converts an embedded ICC profile into the canvas's sRGB. Every canvas the renderer creates asks for `colorSpace: "srgb"` explicitly, rather than relying on the default. Display-P3 canvases exist only in Chromium ([capability matrix](../capabilities.md)), so they aren't used.
- **Exports are sRGB,** and carry no ICC profile. A wide-gamut or otherwise profiled source is **converted** to sRGB when it's decoded, and its profile is **dropped**: the export's pixels are sRGB, and the profile segments and chunks a browser's encoder adds itself, such as Chromium's `ICC_PROFILE` in JPEG, are removed with the rest of its metadata. Readers treat an untagged image as sRGB, which is what it is.
- **JPEG has no alpha,** so a JPEG export is drawn on white; transparent areas would otherwise become black.
- **Wide gamut is clipped, and the editor says so.** When the probe finds a profile other than sRGB, the session adds a warning that colours outside sRGB will be clipped on export.
- **No colour management engine is bundled.** A Little CMS build in WebAssembly would cost size, `'wasm-unsafe-eval'` and native parsing code, for conversions the browser's decoder already does.
- **Wide-gamut editing is a later record.** Display P3 canvases aren't supported in every browser ADR 0013 covers, and the capability matrix records which do. A later record can add a P3 working space where it's available, with a P3 profile on export.

### Orientation: sources are oriented once, at decode

- **The probe reads the orientation** with our own reader, from the same carriers browsers read, as the [capability matrix](../capabilities.md) measures them:
  - EXIF in a JPEG's `APP1` segment;
  - a PNG's `eXIf` chunk, only before `IDAT`;
  - `irot` and `imir` in HEIF and AVIF, in `ipma` order, where `imir` axis 0 mirrors top to bottom and axis 1 left to right, as libavif writes them.

  It ignores what every engine there ignores, so a file opens as browsers show it: a WebP's `EXIF` orientation, an `eXIf` after `IDAT`, and the Exif item of a HEIF or AVIF, whose `irot` and `imir` win. It still reads their presence flags and keepable fields. It reports the stored size and the oriented size.
- **Browsers don't agree on applying it,** as the [capability matrix](../capabilities.md) shows pixel by pixel: WebKit ignores a PNG's `eXIf` and AVIF's `irot` and `imir`, which Chromium and Firefox apply, and `imageOrientation: "none"` doesn't give the stored pixels portably. So the worker decodes with `imageOrientation: "from-image"` and **calibrates** whether the result is upright, instead of trusting the browser or keeping a table of browsers:
  - **Per format, per worker, lazily.** The first file of a format whose probe reads an orientation other than 1 decodes a calibration image of that format: 48 × 32, with red, green, blue and yellow quadrants, oriented with a turn and a flip (7 for JPEG and PNG, 5 for AVIF), in exactly the carrier the probe reads (`APP1`, `eXIf` before `IDAT`, `irot` then `imir`). JPEG and PNG calibration files are encoded in the worker; AVIF and HEIF ones are small embedded files, which the matrix also decodes. Concurrent decodes share one calibration, which lives in the worker's memory only. Only classified results are kept: a calibration that failed, such as a canvas that couldn't be allocated under memory pressure, is `unknown` for the decodes that shared it, and the next oriented file of that format measures again.
  - **JPEG calibration files put EXIF after a leading JFIF `APP0`.** Firefox refuses its own encoder's JPEG with an `APP1` before that `APP0`, though it decodes the same file with `APP1` after it, and other encoders' files with `APP1` first. The probe reads `APP1` in either place.
  - **Classified by pixels, not size:** the quadrant centres must show exactly the orientation the SDK's probe reads from the calibration file (**applied**) or exactly the stored layout (**not applied**). Anything else, including a calibration file the browser can't decode, is **unknown**, and oriented files of that format fail closed with `DECODE_FAILED`.
  - **Not applied:** the worker draws the stored bitmap upright into an `OffscreenCanvas` with the orientation's transform, closes the stored bitmap as soon as it's drawn, and keeps the result. The peak is one stored and one upright frame, so the probe's bound counts one more upright frame for every file with an orientation, and `maxDecodedSize` covers it ([ADR 0004](0004-image-limits.md)).
  - **A file the probe calls upright (orientation 1) is never calibrated or transformed.**
  - **The size check stays,** after any transform: the bitmap must be the probe's oriented size exactly, or the decode fails with `INVALID_IMAGE` ([ADR 0001](0001-image-engines.md)).
- **Everything after decode works in oriented pixels:** the source's size, the crop and the layer geometry ([ADR 0003](0003-layer-plan-document-model.md)). The file's orientation tag is never written to an export, because the exported pixels are already upright. The plan's own `rotate` and flips are separate, user-made edits.

### Metadata: read only what's needed, keep nothing by default

- **Reading:** our own EXIF/TIFF, XMP and PNG text-chunk readers, in the worker, read only:
  - the orientation;
  - the fields the editor shows and lets the user keep: title, description, artist and copyright;
  - what kinds of metadata the file carries, as presence flags, never values: location, camera and lens, timestamps, an embedded thumbnail, a colour profile, and other or unknown fields.

  They're hostile-input code ([ADR 0001](0001-image-engines.md)), with the same bounds and tests as the header readers. Strings are length-limited and only ever rendered as text.
- **Exports carry no metadata by default.** After encoding, the worker rewrites the file to its image data alone: a JPEG keeps `SOI`, a JFIF `APP0` if the encoder wrote one, and the segments from the frame on, dropping every other `APPn` and `COM`; a PNG keeps `IHDR`, `PLTE`, `tRNS`, `IDAT` and `IEND`; a WebP keeps its image chunks, and an extended file's ICC, EXIF and XMP flags are cleared. So nothing an encoder adds survives either. That includes a PNG's `pHYs` (its DPI) and its `gAMA`, `cHRM` and `sRGB` chunks; a JPEG keeps only the JFIF `APP0` its encoder wrote, with that encoder's default density. Untagged output is read as sRGB, which it is.
- **The user may keep title, description, artist and copyright,** which the SDK writes with its own minimal writer, into the rewritten file:
  - in JPEG, an EXIF `APP1` segment after any JFIF `APP0`, whose TIFF block has one IFD with only those fields: `XPTitle` in UTF-16, and `ImageDescription`, `Artist` and `Copyright` in UTF-8. It has no sub-IFD pointers, so a GPS, EXIF or thumbnail IFD can't exist in it, and the readers decode ASCII values as UTF-8 where they're valid UTF-8;
  - in PNG, uncompressed UTF-8 `iTXt` chunks, `Title`, `Description`, `Author` and `Copyright`, after `IHDR`.

  WebP exports carry none in the first releases.
- **Orientation is never written.** The exported pixels are already upright, so a tag could only turn them again.
- **A location is never written,** whatever the user chooses, and neither are camera serial numbers, timestamps or thumbnails. The editor doesn't offer them.
- **The summary before a download says what was removed:** for example "Location, camera details and timestamps were removed." It's built from the probe's presence flags, so it's accurate for what the source carried. The tests read the exported bytes and check that the summary is true: an exported file must contain no metadata except the fields the user kept.
- **Events** never carry metadata values ([ADR 0003](0003-layer-plan-document-model.md)).

## Alternatives considered

- **Keeping the source's metadata by default,** as many editors do: it's convenient for photographers, but it's the riskiest default for people sharing images, and the SDK's promise is privacy.
- **Offering every metadata field to keep:** a long list of technical fields, where one wrong choice leaks a location. The four fields people actually set cover the need.
- **Applying orientation in the renderer instead of the decoder:** possible, but then two places know about orientation again. Orienting once, at decode, keeps one.
- **Trusting the browser's `imageOrientation`:** every rotated WebP, and rotated PNG and AVIF files in WebKit, would fail the size check, and flips and half turns can't be detected by size at all.
- **A table of which browser applies which format:** it would break silently whenever a browser changes, and can't cover browsers the matrix doesn't run, such as Safari on iOS. The calibration measures the browser the user actually has.
- **Working in Display P3 now:** not every supported browser has P3 canvases, and a working space that differs by browser would make exports differ too.

## Consequences

- **Shared images leak nothing by default,** and users are told what was removed.
- **Photographers who want their camera data kept need another tool** in the first releases. A later record could add more fields, never location.
- **Wide-gamut photos lose some saturation on export,** with a warning, until a P3 record.
- **Orientation bugs fail loudly,** with `DECODE_FAILED` when a browser orients a format in a way the calibration doesn't recognise, and `INVALID_IMAGE` when a decode isn't the probe's size, instead of producing a wrong crop.
- **An oriented file costs one more upright frame** at its peak, and the first oriented file of each format one tiny extra decode.
