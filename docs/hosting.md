# Host integration and security

This guide describes the shipped adapters and editor. Custom engines and processors must provide the same privacy, limits and error guarantees; the host is responsible for their behavior. The SDK processes local `Blob`/`File` inputs. Fetching a remote image, storing files, uploading an export and logging callback data are host actions.

## Workers and assets

The default engine starts its render worker lazily, on the first call that needs it. It probes file headers and metadata, checks resource bounds, decodes, draws the preview and encodes exports in that worker. A GIF export also starts a job worker, which writes the file from the frames the render worker draws, and stops after a while without work. The editor transfers its canvas to the worker. It loads no remote decoder, model, font or telemetry endpoint.

By default the worker code is bundled into the package and starts from a `blob:` URL. The application still serves its JavaScript chunks and styles as usual. For a policy that excludes blob workers, self-host the packaged assets:

1. Copy the installed package's **entire `dist/assets/` directory** to your application's static assets. Resolve the package directory through `@hussmartinez/image-sdk/package.json` in build tooling; `dist/` is not a public JavaScript import path.
2. Preserve the directory layout. The current package ships `image/render.worker.js` and `image/job.worker.js` under that directory. For example, copying to `public/image-sdk/` must serve `/image-sdk/image/render.worker.js` and `/image-sdk/image/job.worker.js` as JavaScript, rather than an HTML application fallback.
3. Set `assetsUrl` to that directory, on the editor or on `createImageEngine`. Use your own origin; both workers are module workers, and the same `worker-src` covers both.

```tsx
<ImageEditor assetsUrl="/image-sdk/" />
```

```ts
const engine = createImageEngine({ assetsUrl: "/image-sdk/" });
```

The base may be an absolute URL, a root-relative path such as `/image-sdk/`, or a path relative to the page such as `assets/image-sdk/`. Relative bases are safe to configure during server rendering: `createAssetsResolver` from `sdk-core` validates the URL at construction, then resolves it against the browser page when the worker first starts. The resolved base is reused after that. No worker starts during construction or server rendering. Malformed URLs and URLs with a query or fragment still fail at setup with `TypeError`.

Copy the assets again on every package upgrade. Deploy page bundles and worker assets from the same package version, preferably under a versioned directory so cached pages keep their matching worker. The worker handshake checks the package version before accepting calls; stale or missing versions fail with `WORKER_START_FAILED`, with `asset`, `expected` and `actual` in `details`. This version check is not an integrity signature: serve the files over HTTPS from trusted application assets.

### Leaving the inlined workers out

An application that passes `assetsUrl` everywhere never loads the inlined workers, but its bundler still emits them: two chunks of about 91 kB together, 30 kB compressed, that are never used. Set the family's `hm-self-hosted` resolve condition in the application's bundler to leave them out. The SDK reaches both workers through its package's `imports`, and the condition maps each one to a small stub instead ([sdk-core ADR 0060](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0060-leaving-inlined-workers-out-of-a-self-hosted-build.md)). The condition is the family's, so it does the same for every family SDK in the build.

With Vite, which replaces its default conditions with the list you give, so keep them:

```ts
import { defaultClientConditions, defineConfig } from "vite";

export default defineConfig({
  resolve: { conditions: [...defaultClientConditions, "hm-self-hosted"] },
});
```

With esbuild, which drops its `module` condition once you set any, so keep it:

```js
await build({ /* ... */ conditions: ["hm-self-hosted", "module"] });
```

webpack (`resolve.conditionNames: ["hm-self-hosted", "..."]`), Rollup (`nodeResolve({ exportConditions: ["hm-self-hosted"] })`) and Next.js through its webpack configuration should work the same way, but they aren't tested yet.

Set the condition only in a build that passes `assetsUrl` everywhere it creates an engine: `createImageEngine`, and the editor's, the provider's and the element's `assetsUrl`. The processor uses its engine's workers. A worker started without it in such a build fails with `WORKER_START_FAILED`, whose `details` are `{ condition: "hm-self-hosted", missing: "assetsUrl" }`. Without the condition, nothing changes.

## Content Security Policy

The required worker directive is:

| Engine mode | Directive |
|---|---|
| Inline (default) | `worker-src blob:` |
| Self-hosted on the page's origin | `worker-src 'self'` |

The following policies are exercised by the built **engine** example, including successful decode and intentional worker-blocking tests, on Chromium, Firefox and WebKit in [`csp.spec.ts`](../e2e/tests/csp.spec.ts):

```text
# Inline engine
default-src 'self'; script-src 'self'; worker-src blob:; connect-src 'self'; style-src 'self'

# Self-hosted engine
default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'; style-src 'self'
```

Neither mode requires `'unsafe-eval'` or `'wasm-unsafe-eval'`: the package ships no WebAssembly. Thumbnails use canvases, so the SDK adds no `img-src blob:` or `img-src data:` requirement. The download flow uses a blob URL for its link; it does not display the export as an image.

These are the tested engine policies, not a complete policy for every host application. Serve the application scripts and both stylesheets from sources your policy permits. Account separately for your framework's scripts, server-rendered style attributes, editor layout styles and any host preview/download flow. The full React editor example is not tested under these CSP headers. Validate your complete page and worker responses with your deployment's actual headers; `connect-src 'self'` permits same-origin connections and is not a network sandbox. Self-hosting adds the configured same-origin worker load; no file contents are sent to it over HTTP.

## Resource policy

Treat file-picker selections, drops and programmatic inputs as untrusted. The worker reads signatures and headers with the SDK's own readers before decoding, checks declared dimensions, frame count and decoded-size bounds, then checks decoded dimensions against the probe. An extension or MIME type is not the security check. SVG is unsupported and is never rendered inline.

Set `filePolicy` when constructing the session or mounting the editor, based on the devices you support. For example:

```tsx
<ImageEditor
  filePolicy={{
    maxFileSize: 20_000_000,
    maxImagePixels: { maximum: 12_000_000, warning: 8_000_000 },
    maxImageDimension: 8_192,
    maxDecodedSize: 200_000_000,
  }}
/>
```

Sizes use decimal bytes, time uses milliseconds, and decoded-size accounting uses four bytes per pixel. Default resource maxima include 100 MB per file, 50 MP, 16,384 pixels per side, 300 frames, 1 GB decoded size and 120 seconds per session open/export. See [`imageLimitDefinitions`](../src/core/errors/image-limits.ts) for all maxima, warning thresholds and error codes, and [ADR 0004](adr/0004-image-limits.md) for the policy.

The session checks source memory against `maxSessionSize`, and the processor bounds output dimensions before export allocation. The engine also checks per-file limits against its own probe. Hosts using the low-level ports directly must supply their resolved policy.

The session applies `maxProcessingTime` to each open (one budget for probing and registration) and export. At the deadline, the adapter's signal aborts with `PROCESSING_TIME_EXCEEDED` and limit details. The built-in RPC rejects the call and requests cancellation; if its handler does not settle within the separate 30-second cancellation grace period, it terminates the worker and rejects other calls with `WORKER_TERMINATED`. The session cannot preempt a host-injected adapter that ignores its signal. Late results are rejected when they arrive.

Callers of `session.open()` and `session.export()` may also pass their own `AbortSignal`; caller cancellation and timeout reasons retain their distinct codes. Successful and failed operations clear their deadline timers. Low-level port calls still require host-managed time bounds. If a worker that has received source registrations or a transferred canvas is lost, the built-in engine becomes terminal. Its source IDs are invalidated; subsequent processing rejects with `WORKER_TERMINATED` and `details.reason: "engine-invalidated"`. The session's model remains inspectable, but the old engine cannot process it. Startup failures before a resource message was submitted remain retryable, and cooperative cancellation does not invalidate the engine.

**Migration after worker loss:** explicitly destroy and recreate your owned engine, processor, session and renderer, then reopen the caller's image. Renderer users need a new DOM canvas. For an editor that owns its resources, explicitly remount it (for example, with a new React key); if you supplied resources, replace those too. For a custom element, create a new element instance, not just move/reconnect the same one or reassign `file`. The editor replaces the stale surface and export dialog with a translatable recovery notice. Reloading the page is another explicit user option, and unsaved edits will be lost unless the host saved them. There is no automatic reload, remount, source retention, re-decoding or plan replay. See [ADR 0008](adr/0008-terminal-engine-invalidation.md).

Limits are ceilings, not a guarantee that a device can allocate that much memory. Browser canvas caps and available memory may be lower, especially on mobile. Keep bounds finite: `Infinity` disables the corresponding protection. Unknown policy keys fail with `TypeError`. The session snapshot's `warnings` lists limits approaching their maximum; the editor displays applicable file/output warnings.

## Files, metadata and callbacks

The original source stays in memory for editing; edits are a plan over it with undo/redo. An exported file is newly rendered at the requested output size, and cropped-away pixels are excluded. An edit plan is not a sanitised copy of the source: saving or uploading the original still preserves its original pixels and metadata.

Exports default to no source metadata. Explicitly kept title, description, artist and copyright are written as EXIF in JPEG or text fields in PNG. WebP exports carry no metadata. Location, camera details, timestamps and embedded thumbnails are never copied. Colour output is sRGB, so an input's wider-gamut colours can be clipped. The export dialog shows what is removed before download; callers of `session.export()` or the ref/element's `export()` must present their own summary from the returned `removed` and `kept` fields.

`onEvent` contains only event type, outcome and command types. It contains no file name, contents, typed text or metadata values, and the SDK sends it nowhere. In contrast, `onChange` exposes the edit plan, `onExport` exposes the file, and a session snapshot can expose explicitly keepable source metadata. Treat those values as user data. Keep file names, user text and metadata out of host telemetry, and render them as text rather than HTML.

## Errors and ownership

Catch `ImageError` and branch on its stable `code`, such as `FILE_TOO_LARGE`, `IMAGE_TOO_LARGE`, `DECODE_FAILED`, `UNSUPPORTED_FORMAT`, `UNSUPPORTED_ENVIRONMENT` or `WORKER_START_FAILED`. The built-in editor obtains user-facing text from the message catalogue by code; host interfaces should do the same, rather than displaying `error.message`. Configuration/programming errors can throw `TypeError` or `RangeError`.

The editor destroys engines, processors and sessions it creates. If you supply them, destroy them when their last consumer unmounts; a session releases its registered source but does not destroy its engine or processor. Configure these resources before mounting rather than expecting replacement configuration props to rebuild an existing session.

Keep the package and browsers updated. Vulnerabilities in the SDK and its bundled dependencies belong in the [private reporting process](../SECURITY.md); browser decoder vulnerabilities also need a report to the browser vendor.
