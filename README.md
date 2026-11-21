# image-sdk

Edit images entirely in the browser with **`@hussmartinez/image-sdk`**: crop, rotate, flip, adjust colour and tone, apply filter presets, resize on export, and export PNG, JPEG or WebP. It offers a headless core, a React editor (`ImageEditor`) and a `<hm-image-editor>` custom element. The SDK processes images on the user's device and uploads nothing; the host controls what it does with files returned by the SDK.

## Install

```sh
pnpm add @hussmartinez/image-sdk @hussmartinez/ui@^0.7.0 react react-dom
```

Use the same `@hussmartinez/ui` minor as the SDK's dependency (`^0.7.0` for image-sdk 0.2.0). React and React DOM `>=18.3` are required for the React editor and custom element. Headless consumers can install just `@hussmartinez/image-sdk`.

The package is ESM. Its root entry is server-safe and has no React or DOM access on import; image processing itself requires a browser. The `./react` entry starts with `"use client"`. Importing `./element` registers nothing until you call `defineImageEditorElement()`.

## React editor

Import `@hussmartinez/ui`'s stylesheet once, then this package's. **ui's stylesheet is required:** it carries the focus rings and minimum target sizes the editor's accessibility relies on ([sdk-core ADR 0036](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0036-ui-as-a-dependency-of-the-sdks.md)). Give the editor a height in your application's CSS.

```tsx
import "@hussmartinez/ui/styles.css";
import "@hussmartinez/image-sdk/styles.css";
import { ImageEditor } from "@hussmartinez/image-sdk/react";

export function Editor({ file }: { file: File }) {
  return <ImageEditor initialFile={file} onChange={(plan) => console.log(plan)} />;
}
```

`initialFile` opens on mount. To replace the image later, call `open(blob)` on an `ImageEditorHandle` ref. The controlled document is `plan` with `onChange`: it describes edits over the current source, and changes are undoable. `onChange` fires after committed edits, open, undo and redo, never during a gesture. The React editor has no `file` prop.

| Configuration | Public API |
|---|---|
| Tools and toolbar groups | `tools` (ordered tool IDs), `toolbar` (groups of IDs); see [`imageTools`](src/features/tools.ts) |
| Inspector panels and export dialog | `features: { adjust, filters, info, export }`, all enabled by default; disabling export still permits the ref's `export()` |
| Theme and styling | `theme: "light" \| "dark" \| "system"`, `className`, `classNames`, `unstyled`, `icons`; page attributes `data-hm-theme` and `data-hm-density` |
| Translation | `messages` overrides, including shared control text, and `locale` for formatting; [`imageEditorMessages`](src/react/editor-messages.ts), from `./react` and `./element`, is the editor's catalogue. The headless entry's [`imageMessages`](src/messages/en.ts) holds the errors and warnings only |
| Limits and assets | `filePolicy`, `assetsUrl`; see [host integration](docs/hosting.md) |
| Animations | `animations`, `true` by default: an animated GIF opens as an animation. With `false`, every file opens as a still |
| Host-owned processing | `engine`, `processor`, `session`; a supplied session must use the supplied engine |
| Host callbacks | `onEvent` receives anonymous usage events, including `download` when the export dialog's Download asks the browser to download the file (a request, not a confirmed save: use `onExport` for that); `onExport(blob, details)` receives the exported file instead of the dialog offering a download, and then there's no `download` event, since the host saves the file |

The ref provides `session`, `open(blob)`, `insertImage(blob)`, `execute(commandOrCommands)`, `export(format)`, `undo()` and `redo()`. For example, `await ref.current.export({ type: "jpeg", quality: 0.9 })` returns `{ blob, width, height, removed, kept }`; the host handles the returned file. The ref's export bypasses the dialog and its metadata summary, so show that summary in your own download flow.

**The ref is `null` until the editor has mounted,** as every React ref is. A call written as `ref.current?.open(file)` before that does nothing and reports nothing, so the file is lost. Give the first image as `initialFile`, and call the ref's methods from an event handler or an effect, which run after the editor has mounted:

```tsx
import { ImageEditor, type ImageEditorHandle } from "@hussmartinez/image-sdk/react";
import { useRef } from "react";

export function Editor({ first }: { first: File }) {
  const editor = useRef<ImageEditorHandle>(null);
  return (
    <>
      <input
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          // In a handler the editor has mounted, so the ref is set.
          if (file) void editor.current?.open(file);
        }}
      />
      <ImageEditor ref={editor} initialFile={first} />
    </>
  );
}
```

The custom element doesn't have this gap: its `open()`, `insertImage()` and `export()` wait for its first render, and a `file` property set before the element is defined is opened once it is.

For a custom layout, `ImageEditorProvider` supplies `ImageStage`, `ImageToolbar`, `ImageCropPanel`, `ImageAdjustPanel`, `ImageFilterPanel`, `ImageInfoPanel` and `ImageExportDialog`. Hooks include `useImageSession`, `useImageDocument`, `useImageView`, `useImageEditorState` and `useImageMessages`. The complete public signatures are in the [React API report](api/image-sdk-react.api.md).

## Custom element

In a bundled browser entry, import both stylesheets and register the element explicitly:

```ts
import "@hussmartinez/ui/styles.css";
import "@hussmartinez/image-sdk/styles.css";
import { defineImageEditorElement } from "@hussmartinez/image-sdk/element";

defineImageEditorElement();
```

```html
<hm-image-editor theme="dark" locale="en"></hm-image-editor>
```

Set the element's height in host CSS. It renders into the light DOM and uses React internally. Its attributes are `theme`, `locale` and `tools` (space-separated IDs). Its properties are `file` (`Blob`), `plan`, `filePolicy`, `animations`, `assetsUrl`, `messages`, `engine` and `processor`, as well as the attribute-backed properties. Set processing configuration before connecting the element. Setting `file` opens an image; the methods `open`, `insertImage`, `execute`, `export`, `undo` and `redo` match the React handle.

Listen for `hm-image-editor-change` (plan), `hm-image-editor-event` (anonymous usage event), `hm-image-editor-error` (`{ code, details }`) and `hm-image-editor-export` (format, dimensions, size and metadata summary). Event payloads are in `event.detail`. The export event carries a report; call the element's `export(format)` method to obtain a file. See the [element API report](api/image-sdk-element.api.md).

## Headless session

A session holds one source and a serialisable edit plan, with undo and redo. Create the processor over the same engine, and release resources when finished:

```ts
import {
  createImageEngine,
  createImageProcessor,
  createImageSession,
} from "@hussmartinez/image-sdk";

export async function brighten(file: Blob): Promise<Blob> {
  const engine = createImageEngine();
  const processor = createImageProcessor(engine);
  const session = createImageSession({ engine, processor });
  try {
    await session.open(file);
    session.execute({ type: "image.setDevelop", values: { exposure: 20 } });
    const { blob } = await session.export({ type: "jpeg", quality: 0.9 });
    return blob;
  } finally {
    await session.destroy();
    await processor.destroy();
    await engine.destroy();
  }
}
```

Commands set crop, orientation, develop adjustments, filter, layers, redactions, output size and kept metadata. `insertImage(file)` checks and decodes a second image and adds it as a layer, as one undoable step; the session holds its source while the plan, an undo or redo step, or an export in progress refers to it, and counts every source it holds against `maxFiles` and `maxSessionSize`. `subscribe()` and `getSnapshot()` expose state, errors and limit warnings; `export()` accepts an abort signal and progress callback. A caller-supplied engine, processor or session remains the caller's responsibility to destroy. See the [core API report](api/image-sdk.api.md) and [portable format schemas](formats).

## Redaction

The editor's Redact tool covers parts of an image, and exports don't contain what's covered ([ADR 0010](docs/adr/0010-redaction.md)).

- **Solid colour destroys what it covers.** The exported file doesn't depend on the covered pixels at all: two images that differ only under a solid area export to identical files, at any size, crop and orientation, in PNG, JPEG and WebP. The tests check exactly that, in Chromium, Firefox and WebKit.
- **Pixelation obscures; it doesn't destroy.** A pixelated area keeps the average colour of each coarse block. That can be enough to recover text or numbers, so use a solid colour for those. The editor says so when pixelation is chosen, and again in the export summary.
- **Areas follow the image.** They're placed on the image's own pixels, so they stay on what they cover when it's cropped, turned or flipped.
- **Only the exported file is redacted.** The plan describes the areas; it isn't a redacted image. The original stays in the session while the image is open, and `engine.thumbnail()` returns it unredacted. Don't store or send the source, or a thumbnail of it, in place of an export.

In the editor, press `R` or the toolbar's Redact button. Drag across the image to draw an area, or use "Add area", which needs no dragging. On a focused area, the arrow keys move it, `Shift` with an arrow resizes it and `Delete` removes it; the panel has number fields for its position and size, and lists every area.

Headless, redactions are commands like any other edit:

```ts
import { createImageKey } from "@hussmartinez/image-sdk";

session.execute({
  type: "image.insertRedactions",
  at: 0,
  redactions: [
    // Whole pixels of the image as it's opened, before any crop or rotation.
    { key: createImageKey(), mode: "solid", x: 120, y: 80, width: 240, height: 60, colour: "#000000" },
  ],
});
const { blob } = await session.export({ type: "png" });
```

A redaction costs memory while it exists: one more canvas the size of the image, checked against the file policy before it's allocated. If it can't be allocated, the preview keeps its last frame and the export fails; the image is never drawn without its redactions.

## Layers

The editor adds text, rectangles, ellipses and other images over an image as layers, and its Layers tool lists them and lets people arrange them ([ADR 0013](docs/adr/0013-layers-in-the-editor.md)).

- **Adding:** the toolbar's "Add text" (or `T`), "Add a rectangle", "Add an ellipse" and "Add an image". Each puts a layer in the middle of the image, the right way up, and selects it. Text starts empty with focus in its field; an image is chosen in a file picker and never leaves the device. From a host, `insertImage(file)` on the editor's handle or on `<hm-image-editor>` adds one.
- **Drawing:** press `D` or the toolbar's Draw button, then drag across the image, with a pen or a highlighter in any colour and width. Each stroke is one undo step, and "Remove last stroke" takes the last one back. Drawing needs a mouse, a pen or a finger; "Add an arrow" is the keyboard's way to point at something ([ADR 0015](docs/adr/0015-drawing-in-the-editor.md)).
- **Arranging:** press `L` or the toolbar's Layers button.

- **In the panel:** the layers, the top one first, each with a button that selects it and one that shows or hides it; buttons that move the selected layer up and down, duplicate it and delete it; fields for its name, position, size, turn and opacity; and its own fields: a text layer's text, font, alignment, weight and colour, or a shape's fill and outline.
- **On the image:** each layer has a frame. Press one to select the top layer under the pointer, drag it to move the layer, and drag a handle of the selected one to resize it.
- **With the keyboard:** on a focused frame, the arrow keys move the layer by a pixel, `Shift` with an arrow resizes it, or moves an arrow's tip, and `Delete` removes it. The list is one tab stop: the Up and Down arrows move between layers, `Alt` (`Option` on macOS) with them moves the focused layer up or down the stack, and `Delete` removes it.

Text is drawn with the device's own fonts, in one of three generic families, so the same plan can look different on another device; the preview and the export of one session always agree ([ADR 0009](docs/adr/0009-scene-space-layers-and-plan-versions.md)). A new layer is set against the image's rotation and flips, so text added to a turned or mirrored image reads as text; "Mirror" in the panel flips a layer about its own box.

Headless, a layer is a command: `image.insertLayers`, or `session.insertImage(file)` for an image, which places it the same way: centred, fitted, and neither turned nor mirrored in the output. A plan can also hold freehand drawings and arrows ([ADR 0014](docs/adr/0014-drawing-strokes-and-arrows.md)): `simplifyStroke` turns a pointer's samples into a stroke, and `image.addStrokes` adds it.

## Formats and browsers

The engine reads PNG, JPEG, WebP, BMP and AVIF with the browser's decoder after checking headers and limits in its worker, and GIF with its own decoder, which the browser's never sees: a malformed GIF opens when browsers show it and its first frame is whole. An animated GIF opens as an animation, its frames and timing in the plan, unless it's too large to hold (over `maxFrames`, `maxDecodedSize` across its frames or `maxAnimationPixels`), when it opens as its first frame and the editor says so. Animated PNG and WebP open as their first frame. HEIC is recognised, but decoding depends on the browser: all three pinned test engines reject it with `DECODE_FAILED`. SVG is unsupported. Export formats are PNG, JPEG, WebP and GIF; an unavailable browser encoder fails with `UNSUPPORTED_FORMAT`. A GIF is written by the SDK's own encoder, `gifenc`, bundled into a second worker that starts on the first GIF export: every frame of an animation, or one frame of a still, with no metadata. See [`NOTICE`](NOTICE). Exports are sRGB; colours outside sRGB can be clipped.

The family's [support target](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0013-browser-and-react-support.md) is the last two major versions of Chrome, Edge, Firefox and Safari on desktop and mobile, with ES2022 output and no polyfills. The [measured capability matrix](docs/capabilities.md) records the exact pinned Chromium, Firefox and WebKit builds checked in CI. These runs prove the generated fixtures, orientation handling and worker canvas paths in those builds; they do not constitute testing of every browser version or device. Playwright WebKit is not Safari and does not prove Apple system HEIC decoding or iOS canvas limits. Validate your target devices and choose limits suitable for them.

The editor requires Web Workers, worker `createImageBitmap`, a 2D `OffscreenCanvas` and `transferControlToOffscreen`. The renderer reports `UNSUPPORTED_ENVIRONMENT` when canvas transfer is unavailable; other worker/platform startup and decoding failures can have different codes. The engine and CSP suites exercise inline and self-hosted workers on all three engines; editor tests cover keyboard flows and axe checks, with separate visual comparisons in Chromium.

## Privacy and host security

Images are parsed, decoded, drawn and encoded in workers. The SDK has no upload or telemetry service; `onEvent` calls only the host. Exports keep no source metadata by default. Users can explicitly keep title, description, artist and copyright in PNG/JPEG; WebP exports carry no metadata. Location is never written. The export dialog shows the removal summary before download.

If a worker loses its image/canvas resources, the built-in engine becomes terminal and the editor shows a recovery notice. Explicitly recreate the editor and any host-owned processing resources, then reopen the image; opening it on the old engine cannot restore the preview. Unsaved edits require host-managed preservation.

An application that self-hosts the workers with `assetsUrl` can leave the inlined copies out of its build with the family's `hm-self-hosted` resolve condition, for example `resolve: { conditions: [...defaultClientConditions, "hm-self-hosted"] }` in Vite. See [leaving the inlined workers out](docs/hosting.md#leaving-the-inlined-workers-out) for Vite and esbuild, and what fails without `assetsUrl`.

See [host integration and security](docs/hosting.md) for resource limits, error handling, asset deployment, exact tested CSP directives and the host's responsibilities. Report vulnerabilities through the [security policy](SECURITY.md).

## Development

The repository root is the published package, laid out as in the family's [standard layout](https://github.com/ie-huss-martinez/sdk-core/blob/main/STANDARDS.md#repository-layout): the source is in [`src`](src), and the pnpm workspace adds [`examples/`](examples), pages that run in the browser as hosts do, and [`e2e/`](e2e), the end-to-end suite.

You need Node 24 (see [`.node-version`](.node-version)) and pnpm. The exact pnpm version is pinned in `package.json`, and pnpm switches to it automatically.

```sh
pnpm install       # also installs the git hooks
pnpm verify        # everything CI runs
pnpm verify:fast   # the subset the pre-push hook runs
```

The browser and end-to-end tests need Docker: they run in the pinned browser test image from [`ci/Dockerfile`](ci/Dockerfile), as in CI, through `hm-in-image` from `@hussmartinez/sdk-config` ([sdk-core ADR 0049](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0049-local-browser-tests-in-the-pinned-image.md)). The first run builds the image and installs the dependencies into its volumes. `pnpm test:browser:all` runs all three engines, as CI does.

`pnpm verify` runs, in order:

| Step | Script | Tool |
|---|---|---|
| Format and lint | `lint` | Biome |
| CSS rules | `lint:css` | stylelint, with the `hm-` namespace and token rules |
| React rendering rules | `lint:react` | React's own ESLint plugin and nothing else, through `hm-lint-react` ([sdk-core ADR 0063](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0063-a-lint-for-what-react-components-do-while-rendering.md)) |
| Types | `typecheck` | TypeScript |
| Dependency rules | `lint:deps` | dependency-cruiser, through `hm-lint-deps` |
| One copy of each family package | `check:single-copy` | `hm-check-single-copy` (sdk-core ADR 0047) |
| Playwright pinned to the browser test image | `check:playwright-image` | `hm-check-playwright-image` (sdk-core ADR 0025) |
| Build | `build` | Vite, then api-extractor for the type declarations |
| Unit tests | `test` | Vitest |
| Browser tests | `test:browser` | Vitest in Chromium in the browser test image, and in Firefox and WebKit too in CI |
| Examples | `build:examples` | Vite, building `examples/vite` against the built package |
| End-to-end tests | `test:e2e` | Playwright in the browser test image, against the built example: the engine on every format it reads, upright, with the inlined worker under `worker-src blob:` and the self-hosted one under `worker-src 'self'`; the [browser capability matrix](docs/capabilities.md); and no requests to other origins |
| Screenshots | `test:visual` | Playwright in the browser test image, comparing each designed state with its committed screenshot (sdk-core ADR 0048); `test:visual:update` rewrites them |
| Size budgets | `check:size` | size-limit, brotli size of each entry point |
| API reports | `check:api` | api-extractor, one report per entry point in [`api`](api) |
| Package checks | `check:package` | publint and Are the Types Wrong? |

The configuration extends the shared presets in [`@hussmartinez/sdk-config`](https://www.npmjs.com/package/@hussmartinez/sdk-config). The git hooks ([ADR 0016](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0016-git-hooks-and-merge-guards.md)) run automatically: a secret scan and lint of staged files on commit, a Conventional Commits check of the message, and `pnpm verify:fast` on push.

When a change alters the public API on purpose, update the reports with `pnpm api:update` and commit them.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request. Coding agents also start with [`AGENTS.md`](AGENTS.md). Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately, as described in the [security policy](SECURITY.md).

## License

[Apache-2.0](LICENSE)
