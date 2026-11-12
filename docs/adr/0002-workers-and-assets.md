# 0002. One render worker that owns the pixels, and assets without the network

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

[ADR 0001](0001-image-engines.md) puts probing, decoding, rendering and encoding in a worker. Images differ from audio in where the decoded data is needed:

- audio-sdk keeps its sources on the page, because Web Audio playback needs them there;
- an image editor needs its decoded pixels where it draws them, and it draws both the preview and every export.

If the pixels lived on the page, every preview frame would copy them to the worker or render on the main thread. If they lived only in the worker, the page would need another way to show the result. The 2D `OffscreenCanvas` and `HTMLCanvasElement.transferControlToOffscreen()` solve that: the worker draws straight into a canvas the page shows.

The family's workers use `sdk-core`'s typed RPC ([ADR 0018](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0018-worker-rpc-protocol.md)), with assets inlined by default and self-hostable through `assetsUrl` ([ADR 0038](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0038-self-hosted-assets-and-worker-version.md)).

## Decision

### Where the pixels live

- **The render worker owns every decoded source,** as an `ImageBitmap`, created once and never modified ([ADR 0003](0003-layer-plan-document-model.md)). Rendering, exporting and building thumbnails all happen next to them, so no full-size pixels cross between the page and the worker.
- **The page keeps each source's original `Blob`,** which costs nothing extra: the browser already holds the file. If the worker crashes or is terminated, the session re-creates it and decodes the sources again from those `Blob`s when they're next drawn, after probing them again. No session data lives only in the worker.
- **The session counts what the worker holds** against `maxSessionSize` ([ADR 0004](0004-image-limits.md)), from the probe's sizes, so the page knows the worker's memory without asking it.

### The preview: a transferred canvas

- **The editor's canvas is transferred to the worker** with `transferControlToOffscreen()`, once per mount. The worker renders the plan into it at the stage's size, scaled to the device pixel ratio, through the same renderer as export ([ADR 0001](0001-image-engines.md)). Frames are coalesced: when edits arrive faster than the worker draws, only the latest plan is drawn. While one render is being drawn, a newer call replaces the one waiting, which resolves `superseded`, and cancels the one being drawn. Develop yields to the worker's messages between its strips, so that cancellation lands at the next strip, and a cancelled render never touches the visible canvas ([ADR 0006](0006-develop-and-filters.md)). The worker creates the canvas's 2D context once, when it's attached: Firefox refuses a second `getContext` on a transferred canvas.
- **Everything interactive stays in the DOM on the page:** the crop frame, the layer handles, focus and the keyboard. They're positioned from the same geometry the renderer uses, which is pure code the page and the worker share. So nothing in the accessibility tree depends on the worker.
- **Without `transferControlToOffscreen`** the editor fails with `UNSUPPORTED_ENVIRONMENT` and `details.feature`, as [ADR 0013](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0013-browser-and-react-support.md) requires. ADR 0013 supports the last two major versions of each browser. The 2D `OffscreenCanvas` arrived in Safari 16.4, older than the oldest Safari ADR 0013 supports today, so this fits the family's range. The end-to-end capability matrix checks `createImageBitmap`, the 2D `OffscreenCanvas` and `transferControlToOffscreen` in workers on all three engines, so a browser that changes fails a test, not a user.

### The workers: the family RPC

The worker module exposes the engine's, renderer's and processor's worker side with `exposeWorker` ([ADR 0003](0003-layer-plan-document-model.md) defines the ports). `createImageEngine()`, `createImageRenderer()` and `createImageProcessor()` reach it with `createWorkerClient`. Its methods are:

- **`probe(file)`:** reads a `Blob`'s headers and metadata ([ADR 0001](0001-image-engines.md), [ADR 0005](0005-colour-orientation-and-metadata.md)).
- **`register(id, file, probe)`:** decodes a probed file into a source, and checks it against the probe.
- **`attachCanvas(canvas)`** and **`render(plan, view)`:** take the transferred canvas, and draw a plan into it.
- **`thumbnail(id, size)`:** a small bitmap for the layers list and the frame strip, transferred to the page.
- **`export(plan, options)`:** renders at full size into its own `OffscreenCanvas` and encodes it, returning a `Blob`.
- **`release(id)`:** closes a source's bitmap once nothing refers to it ([ADR 0003](0003-layer-plan-document-model.md)).

Every call takes an `AbortSignal` and runs under `withProcessingTime`. Long ones, such as decoding and exporting, report progress. Failures reach callers as `ImageError`s, adapted with `sdk-core`'s `createErrorHelpers` ([ADR 0034](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0034-shared-error-helpers.md)), so an aborted call keeps the file policy's code, and the browser's own messages never reach users.

### Clients and lifetimes

- **Two workers, each with its own client.**
  - **The render worker** probes, decodes, renders and exports. It holds the sources, so it lives as long as the session.
  - **The job worker** runs long jobs that don't need the sources, starting with GIF encoding: the render worker hands it frames one at a time.

  Cancelling a job can terminate the job worker, and with separate workers that never takes the session's sources with it ([ADR 0018](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0018-worker-rpc-protocol.md)).
- **Lifetimes:** the render worker starts on the first file and stops with its session. The job worker starts on its first job and stops after `sdk-core`'s idle timeout.

### Assets

- **Inline (the default):** both workers are inlined and started from `blob:` URLs.
- **Self-hosted:** `assetsUrl` is where the application serves the package's `dist/assets/` directory ([ADR 0038](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0038-self-hosted-assets-and-worker-version.md)), resolved with `sdk-core`'s `resolveAssetsBase`. The workers are `image/render.worker.js` and `image/job.worker.js` under it, each one minified file with a fixed name.
- **The worker's version is checked by `sdk-core`:** the SDK passes its package version as `packageVersion` to `exposeWorker` and `createWorkerClient`. A self-hosted worker from another version is refused with `WORKER_START_FAILED` before any call reaches it, naming the asset and both versions. There's no `version` method of our own.
- **No WebAssembly** in the first releases ([ADR 0001](0001-image-engines.md)). A later engine that needs it follows the same directory, with its hash checked before it's compiled, as in `pdf-sdk`.

### Content Security Policy

| Mode | Directives |
|---|---|
| Inline (default) | `worker-src blob:` |
| Self-hosted | `worker-src 'self'` |

Neither mode needs `'unsafe-eval'` or `'wasm-unsafe-eval'`. Decoding and encoding with the browser need no directive. Thumbnails reach the page as `ImageBitmap`s drawn into canvases, never as `blob:` or `data:` image URLs, so `img-src` needs nothing either.

### Tests

- The end-to-end suites fail on any request to another origin, and assert that inline mode makes no request at all beyond the page and its scripts.
- The self-hosted mode runs the same fixtures with `assetsUrl` set and a CSP without `blob:`.
- A browser test checks that a crashed render worker is re-created and redraws the same pixels from the sources' `Blob`s.
- A unit test checks that no message between the page and the render worker carries a full-size bitmap or pixel buffer, except an export's `Blob`.

## Alternatives considered

- **Sources on the page, rendering on the main thread:** simple, and what the replaced application did, but every preview frame and every export runs on the main thread, and decoding moves to the page, which [ADR 0031](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0031-platform-decoders-on-the-page.md) rule 1 forbids for a decoder workers have.
- **Rendering in the worker and sending each frame back as an `ImageBitmap`:** works without `transferControlToOffscreen`, but adds a transfer and a page-side draw per frame. Every supported browser has `transferControlToOffscreen`, so it isn't needed.
- **One worker for everything:** cancelling a slow GIF export would terminate the worker holding every source, and the session would decode them all again.
- **Pixels in `SharedArrayBuffer`s shared by page and worker:** needs the host to be cross-origin isolated, a large requirement to put on every application for no gain over the transferred canvas.

## Consequences

- **The main thread never decodes, renders or encodes,** so the editor stays responsive with large images.
- **A worker crash loses no work:** the plan is on the page, and the sources are decoded again from their `Blob`s.
- **The canvas belongs to the worker once transferred,** so the page can't read or draw into it. Hit-testing and handles use the shared geometry instead, and tests read pixels back through the worker.
- **Every interactive control is DOM,** which keeps the editor accessible regardless of how the image is drawn.
