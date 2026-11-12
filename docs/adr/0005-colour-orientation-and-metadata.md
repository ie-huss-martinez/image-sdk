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

- **The working space is sRGB.** Decoding uses `colorSpaceConversion: "default"` ([ADR 0001](0001-image-engines.md)), so the browser converts an embedded ICC profile into the canvas's sRGB. Every canvas the renderer creates is sRGB.
- **Exports are sRGB,** and carry no ICC profile. Readers treat an untagged image as sRGB, which is what it is.
- **Wide gamut is clipped, and the editor says so.** When the probe finds a profile other than sRGB, the session adds a warning that colours outside sRGB will be clipped on export.
- **No colour management engine is bundled.** A Little CMS build in WebAssembly would cost size, `'wasm-unsafe-eval'` and native parsing code, for conversions the browser's decoder already does.
- **Wide-gamut editing is a later record.** Display P3 canvases aren't supported in every browser ADR 0013 covers, and the capability matrix records which do. A later record can add a P3 working space where it's available, with a P3 profile on export.

### Orientation: sources are oriented once, at decode

- **The probe reads the orientation** from EXIF in JPEG, from the `eXIf` chunk in PNG and WebP's `EXIF` chunk, and from `irot` and `imir` in HEIF and AVIF, with our own reader. It reports the stored size and the oriented size.
- **The decoder applies it:** `createImageBitmap` with `imageOrientation: "from-image"` returns the oriented bitmap, and the worker checks that its size equals the probe's oriented size ([ADR 0001](0001-image-engines.md)). A mismatch, such as a browser that ignores the tag for some format, fails with `INVALID_IMAGE` rather than producing a sideways image with a misplaced crop.
- **Everything after decode works in oriented pixels:** the source's size, the crop and the layer geometry ([ADR 0003](0003-layer-plan-document-model.md)). The file's orientation tag is never written to an export, because the exported pixels are already upright. The plan's own `rotate` and flips are separate, user-made edits.

### Metadata: read only what's needed, keep nothing by default

- **Reading:** our own EXIF/TIFF, XMP and PNG text-chunk readers, in the worker, read only:
  - the orientation;
  - the fields the editor shows and lets the user keep: title, description, artist and copyright;
  - what kinds of metadata the file carries, as presence flags, never values: location, camera and lens, timestamps, an embedded thumbnail, a colour profile, and other or unknown fields.

  They're hostile-input code ([ADR 0001](0001-image-engines.md)), with the same bounds and tests as the header readers. Strings are length-limited and only ever rendered as text.
- **Exports carry no metadata by default.** Encoding through a canvas writes none, by construction.
- **The user may keep title, description, artist and copyright,** which the SDK writes with its own minimal writer: an EXIF `APP1` segment in JPEG and `iTXt` chunks in PNG. WebP exports carry none in the first releases.
- **A location is never written,** whatever the user chooses, and neither are camera serial numbers, timestamps or thumbnails. The editor doesn't offer them.
- **The summary before a download says what was removed:** for example "Location, camera details and timestamps were removed." It's built from the probe's presence flags, so it's accurate for what the source carried. The tests read the exported bytes and check that the summary is true: an exported file must contain no metadata except the fields the user kept.
- **Events** never carry metadata values ([ADR 0003](0003-layer-plan-document-model.md)).

## Alternatives considered

- **Keeping the source's metadata by default,** as many editors do: it's convenient for photographers, but it's the riskiest default for people sharing images, and the SDK's promise is privacy.
- **Offering every metadata field to keep:** a long list of technical fields, where one wrong choice leaks a location. The four fields people actually set cover the need.
- **Applying orientation in the renderer instead of the decoder:** possible, but then two places know about orientation again. The decoder's own option, checked against our probe, keeps one.
- **Working in Display P3 now:** not every supported browser has P3 canvases, and a working space that differs by browser would make exports differ too.

## Consequences

- **Shared images leak nothing by default,** and users are told what was removed.
- **Photographers who want their camera data kept need another tool** in the first releases. A later record could add more fields, never location.
- **Wide-gamut photos lose some saturation on export,** with a warning, until a P3 record.
- **Orientation bugs fail loudly** with `INVALID_IMAGE` instead of producing a wrong crop.
