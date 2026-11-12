# Browser capabilities

What each browser engine decodes, draws and encodes in a worker, measured by the end-to-end suite (`e2e/tests/capabilities.spec.ts`) on the example page. ADR 0001 says every claim about a browser is checked here before code relies on it.

The engines are those of the pinned browser image in `ci/Dockerfile`, where CI runs: Chromium 158.0.8127.18, Firefox 159.0 and WebKit 27.2, on Linux. Results depend on how a browser was built, and **Playwright's WebKit isn't Safari**: it doesn't have Safari's system decoders, such as HEIC, or iOS's canvas limits. Those need a device, and the records that rely on them say so.

In the pinned image, the suite fails when a browser's outcome differs from these tables. After the image or Playwright changes, regenerate them with `pnpm build:examples && tools/update-capabilities.sh`, which runs the suite in that image with Docker, and review the difference.

## Decoding with `createImageBitmap` in a worker

Each file is a generated solid colour (`tools/generate-capability-fixtures.sh`, `e2e/fixtures.ts`). The primary image is red; every secondary image, such as a preview, gain map or thumbnail, is blue and larger, so the size and colour show which one the browser decoded. Before the browser sees a file, the suite checks that the SDK's own probe reads the same upright size, or refuses the file where the table says so.

- **decodes:** the browser returned the primary image, red, at its upright size: the size the engine's check against the probe expects (ADR 0001). For the rows decoded with `imageOrientation: "none"`, it's the stored size instead, without the orientation.
- **decodes W × H, colour:** the browser returned something else, such as a secondary image, or the stored size without its orientation.
- **Four-colour rows** (named by their orientation carrier): the decode's pixels are read at the centre of each quadrant. **decodes** means they show exactly the orientation the SDK's probe reads; **decodes as stored** that the browser ignored it; **decodes as orientation N** that it applied another; and **unrecognised** that the pixels match none of the eight. The engine calibrates on this (ADR 0005).
- **doesn't decode:** `createImageBitmap` rejected the file. The engine reports that as `DECODE_FAILED`.
- **never settles:** the decode didn't finish within 10 seconds.

The SDK's probe refuses **GIF, frame outside the screen**, so the engine never decodes it. The row shows why: every engine grows the image to fit the frame, so a bound from the logical screen would be too small (ADR 0001).

**HEIC** doesn't decode in any of these engines. Safari on Apple platforms may decode it with the system's decoder, which Playwright's WebKit doesn't have and only a device can check. Where it doesn't decode, the SDK reports `DECODE_FAILED` (ADR 0001).

| File | Chromium | Firefox | WebKit |
|---|---|---|---|
| PNG | decodes | decodes | decodes |
| JPEG | decodes | decodes | decodes |
| JPEG with a larger EXIF thumbnail | decodes | decodes | decodes |
| JPEG with an MPF preview image | decodes | decodes | decodes |
| JPEG, Ultra HDR with a gain map | decodes | decodes | decodes |
| WebP, lossy | decodes | decodes | decodes |
| WebP, lossless | decodes | decodes | decodes |
| GIF | decodes | decodes | decodes |
| GIF, frame outside the screen | decodes 96 × 64, red | decodes 96 × 64, red | decodes 96 × 64, red |
| BMP | decodes | decodes | decodes |
| AVIF | decodes | decodes | decodes |
| AVIF with a thumbnail item | decodes | decodes | decodes |
| HEIC | doesn't decode | doesn't decode | doesn't decode |
| HEIC with a thumbnail item | doesn't decode | doesn't decode | doesn't decode |
| PNG, eXIf orientation 7 before IDAT | decodes | decodes | decodes as stored |
| PNG, eXIf orientation 7 after IDAT | decodes | decodes | decodes |
| JPEG, EXIF orientation 7 | decodes | decodes | decodes |
| JPEG, EXIF orientation 3 | decodes | decodes | decodes |
| WebP, EXIF orientation 7 | decodes | decodes | decodes |
| AVIF, irot 1 | decodes | decodes | decodes as stored |
| AVIF, imir 0 | decodes | decodes | decodes as stored |
| AVIF, imir 1 | decodes | decodes | decodes as stored |
| AVIF, irot 1 then imir 0 | decodes | decodes | decodes as stored |
| AVIF, irot 2 and an Exif item with orientation 6 | decodes | decodes | decodes as stored |
| HEIC, irot from heif-enc --rotate-cw 90 | doesn't decode | doesn't decode | doesn't decode |
| PNG, eXIf orientation 6, imageOrientation none | decodes 32 × 48, red | decodes 32 × 48, red | decodes |
| JPEG, EXIF orientation 6, imageOrientation none | decodes 32 × 48, red | decodes 32 × 48, red | decodes 32 × 48, red |
| WebP, EXIF orientation 6, imageOrientation none | decodes | decodes | decodes |
| AVIF, irot quarter turn, imageOrientation none | decodes 32 × 48, red | decodes 32 × 48, red | decodes |

## Canvas and encoding in a worker

- **convertToBlob:** `encodes` when the blob has the requested type. A browser that can't encode a type returns PNG instead, which is why the SDK checks the returned type (ADR 0001).
- **Display-P3 2D context:** whether `getContext("2d", { colorSpace: "display-p3" })` gives a Display-P3 context.
- **Canvas sizes:** whether a canvas of that size draws its far corner pixel. Some engines return a context for a canvas they can't back. 50.3 MP is the first size over `maxImagePixels`' 50 MP (ADR 0004). iOS Safari's own cap is lower than desktop WebKit's and can't be measured here.
- **Longest side:** the longest one-pixel-high canvas that draws, found by binary search up to 131,071 pixels; an engine that reaches that shows `at least`.

| Feature | Chromium | Firefox | WebKit |
|---|---|---|---|
| OffscreenCanvas 2D context | available | available | available |
| convertToBlob, image/png | encodes | encodes | encodes |
| convertToBlob, image/jpeg | encodes | encodes | encodes |
| convertToBlob, image/webp | encodes | encodes | encodes |
| convertToBlob, image/avif | returns image/png | returns image/png | returns image/png |
| Display-P3 2D context | available | not available | not available |
| Canvas of 4,096 × 4,096 (16.8 MP) | draws | draws | draws |
| Canvas of 8,192 × 6,144 (50.3 MP) | draws | draws | draws |
| Longest side of a one-pixel-high canvas | 65,535 pixels | 65,535 pixels | at least 131,071 pixels |
