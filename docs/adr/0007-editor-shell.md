# 0007. The editor shell: layout, the stage, gestures, shortcuts and focus

- **Status:** Accepted
- **Date:** 2026-11-13
- **Amended:** 2026-11-15: `features` and `theme` on `<ImageEditor>` are defined, under "The React API"; and `renderer` is dropped from its props, since the engine already decides where pixels come from and a renderer attaches to the one canvas the stage creates. A factory can be added later without breaking anything
- **Amended:** 2026-11-17: Export works while Redact or Layers is open and ends the tool; while a crop is unapplied it waits and says why. See "Export while a tool is open"
- **Amended:** 2026-11-17: the crop frame resizes with `Shift` and the arrows, not `Alt`, which is the browser's Back and Forward with Left and Right; and there's no 10-pixel step. See "Checked against browser and system defaults"
- **Amended:** 2026-11-19: a slider's keys make one step per press, and one per key held down, as in every family editor, where a burst of presses was one step 500 ms after the last; ui's `Slider` says when a gesture ends and cancels it with Escape. See "Gestures: preview while they run, one step when they end"
- **Amended:** 2026-11-19: so do the arrow keys on a redaction's or a layer's frame, and Escape cancels a key held there. See the same section
- **Amended:** 2026-11-21: the export dialog's Download sends a `download` event to `onEvent`, so a host knows the browser was asked to download the file, not just that it was made ready. It isn't a confirmed save. There's none with `onExport`. See "The export dialog"

## Context

The headless core is built: the session ([ADR 0003](0003-layer-plan-document-model.md)), the engine and the processor ([ADR 0001](0001-image-engines.md)), develop and filters ([ADR 0006](0006-develop-and-filters.md)), and the preview renderer, which draws into a canvas transferred to the render worker and coalesces renders ([ADR 0002](0002-workers-and-assets.md)). The React entry and the custom element come next. The family fixes most of their shape:

- **Four layers:** the full editor, building blocks, hooks, and the headless core (STANDARDS, "React API"). Every editor takes the same configuration props, and a ref handle for programmatic control.
- **`ui` provides the controls:** Toolbar, Button, ToggleButton, Slider, NumberField, Field, SegmentedControl, Dialog, FileDropZone, ProgressBar, Spinner, Announcer, VisuallyHidden and the icon set ([ADR 0036](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0036-ui-as-a-dependency-of-the-sdks.md)), each to its component contract ([ui ADR 0003](https://github.com/ie-huss-martinez/ui/blob/main/docs/adr/0003-component-contract.md)). It has no crop frame.
- **Tools and shortcuts** go through `sdk-core`'s `defineTool`, `createToolRegistry` and `createShortcutRegistry`, with the family's shortcuts, scoped to the editor's root ([ADR 0009](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0009-features-as-tools.md), [ADR 0030](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0030-tools-and-keyboard-shortcuts.md)).
- **The element** is `sdk-core`'s `createEditorElement`, rendering the React editor into the light DOM ([ADR 0040](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0040-editor-element-base.md)).
- **WCAG 2.2 AA:** full keyboard support with an alternative to every drag, visible focus, native dialogs, `aria-live` results, and targets of at least 24 px (44 px on touch). No inline text.
- **video-sdk's [ADR 0007](https://github.com/ie-huss-martinez/video-sdk/blob/main/docs/adr/0007-editor-shell.md)** settled the same questions for a video editor. This record follows it wherever images don't differ.

What the family leaves to this SDK: the layout of an image editor; the crop frame and its keyboard model; how continuous controls, such as sliders and a crop drag, preview without filling the undo history; where focus goes after each action; and the export dialog's summary of what's removed.

## Decision

### Layout

`<ImageEditor>` renders one root, `.hm-image-editor`, with these regions in order, which is also the tab order:

1. **Toolbar** (`ui` Toolbar): open, undo and redo, rotate left and right, flip horizontally and vertically, crop, zoom, and export, built from the tool registry.
2. **Stage:** the preview canvas, with the crop frame over it while cropping.
3. **Inspector:** panels for the active tool. **Crop:** aspect presets and numeric position and size. **Adjust:** the develop sliders. **Filters:** the presets and a strength slider. **Info** (`ImageInfoPanel`): its upright size, format, frames and file size, the kinds of metadata it carries, and the fields kept on export. Never its file's name (sdk-core ADR 0012).

Below a container width of 720 px the inspector moves under the stage. Sizes come from a container query on the root, not the viewport, so an editor in a narrow column lays out for the column.

**Designed states** (STANDARDS, "UX"):

- **Empty:** `ui`'s FileDropZone fills the stage, with a button to choose a file, so dropping is never the only way.
- **Opening:** a Spinner over the stage, with a cancel button. The current image, if there is one, stays until the new one is ready ([ADR 0003](0003-layer-plan-document-model.md)).
- **Error:** the catalogue's text for the code, where the action was, with the next step. A failed open leaves the current document as it was.
- **Warnings:** the session's limit warnings, and a notice when the source has a colour profile, that colours outside sRGB will be clipped on export ([ADR 0005](0005-colour-orientation-and-metadata.md)). They're polite notices at the stage's foot, in a status region, each with a dismiss button, and a dismissed notice shows again for another image that has it.

### The stage's canvas

- **The canvas is `role="img"`,** named from the catalogue as "Edited image preview", with the image's upright size: "Edited image preview, 4032 × 3024". It's updated when the document changes, not on every render.
- **It's not in the tab order.** It handles no keys of its own: zoom and pan have toolbar buttons and the family's shortcuts, and the crop frame over it is its own focusable control.
- **It's created imperatively, never rendered by React,** as in video-sdk. A transferred canvas can't be transferred again, and React's StrictMode mounts effects twice in development. So an effect creates the `<canvas>`, appends it to the stage, and creates the renderer with it; its cleanup destroys the renderer and removes the canvas. A second mount gets a fresh canvas and renderer.
- **Its size follows the stage:** a ResizeObserver, and a change of `devicePixelRatio` through `matchMedia`, render with a new view. The renderer bounds the canvas by the file policy ([ADR 0004](0004-image-limits.md)).
- **The view lives outside the session:** zoom and pan are in a small store of their own, from `createStore` ([ADR 0003](0003-layer-plan-document-model.md)). The stage renders the session's plan with the view whenever either changes, and the renderer keeps only the latest render ([ADR 0002](0002-workers-and-assets.md)).

### Gestures: preview while they run, one step when they end

A slider drag, a held arrow key on a slider, or a crop-frame drag changes the image many times a second. Each change is a render, but it isn't an edit until the gesture ends:

- **While a gesture runs,** the stage renders a **transient plan**: the session's plan with the gesture's change applied, checked by the same reducer, without executing it. The session, its history and the host's `onChange` don't see it.
- **When it ends,** the shell executes **one command** with the final value. So a drag is one undo step, and `onChange` fires once.
  - **A slider's gesture** ends as ui's `Slider` reports it through `onValueCommit` ([ui 0.13](https://github.com/ie-huss-martinez/ui/blob/main/packages/ui/CHANGELOG.md)): when the pointer is let go, when the last key held is let go, or when focus leaves first. So each key press is one step, and so is a key held down however many times it repeats. This is the family's rule, as in audio-sdk and video-sdk. Until 2026-11-19, a burst of separate presses was one step, 500 ms after the last; that made image the only editor in the family whose undo merged presses, and it ended on a timer, so a slow machine ended it at a different place from a fast one.
  - **A drag on the stage,** of the crop, a redaction or a layer frame, ends on `pointerup` or `Enter`.
  - **A redaction's or a layer's frame, nudged with the arrow keys,** makes one step per press, and one per key held down, as a slider does and as audio-sdk's and video-sdk's moves with the keyboard do. The step is taken when the last arrow key held is let go, or when focus leaves the frame first. Until 2026-11-19, a burst of presses there was one step 500 ms after the last, too. A pointer drag and a run of arrow keys never share a step: the arrows don't move a frame while a pointer drags it, and a press ends a run of keys still going, as its own step, before the drag starts. The crop frame's keys change the pending crop, which is one step when it's applied.
  - **Typing in a text layer** is still one step 500 ms after the last keystroke. Typing isn't a nudge: a step per character would fill the history.
- **`Escape` cancels a gesture,** and the stage renders the session's plan again. On a frame with arrow keys held, it puts the frame back where the run started, and the rest of the run is ignored until its keys are let go; Escape with no drag or keys in progress still closes the tool. On a slider, ui's `Slider` puts the value back where the gesture started and calls `onValueCancel` (ui 0.15), whether it was a drag or a key held down, and the rest of that gesture is ignored. Escape with no gesture in progress is left to the editor. Losing focus during a pointer drag on the stage cancels it too; on a slider it ends the gesture as one step, as ui decides.
- **A value that the reducer refuses** never reaches the stage: the control clamps to the command's range first, and the reducer's `INVALID_COMMAND` would only mean a bug.

### The crop frame

The crop frame is DOM over the canvas, positioned from the same geometry the renderer uses ([ADR 0002](0002-workers-and-assets.md), [ADR 0003](0003-layer-plan-document-model.md)), so nothing interactive depends on the worker.

- **It's one focusable `role="group"`,** named "Crop area", whose description is its size in source pixels, announced when it changes: "1200 × 800, from 100, 40". One tab stop: the frame, not each handle.
- **Keys,** while the frame has focus, act as seen on screen, whatever the plan's rotation and flips:

  | Key | Does |
  |---|---|
  | Arrows | Move the frame by 1 pixel of the source |
  | `Shift` with an arrow | Resize it by 1 pixel: Left and Right move its right edge, Up and Down its bottom edge |
  | `Enter` | Apply the crop, and return focus to where it was |
  | `Escape` | Cancel a drag in progress; otherwise cancel the crop |

  A whole crop, from `C` to `Enter`, is one gesture: the stage shows the whole image with the frame over it, and only `Enter`, or the panel's Apply, executes one `image.setCrop`.
- **Checked against browser and system defaults.** The frame's first keys resized with `Alt` and moved by 10 pixels with `Shift`. `Alt` with Left and Right is Back and Forward in Chrome and Firefox on Windows and Linux, so a resize could leave the page and lose the edit. Preventing the key's default stops that in most cases, but not reliably across engines and assistive technology. pdf-sdk's [ADR 0008](https://github.com/ie-huss-martinez/pdf-sdk/blob/main/docs/adr/0008-page-organisation-in-the-editor.md) checked each modifier against Chrome's, Firefox's and Safari's shortcuts and those of Windows, macOS and GNOME, and its table decides this one:

  | Combination | Taken by, in that table | Here |
  |---|---|---|
  | `Alt` with Left or Right | Back and Forward in Chrome and Firefox on Windows and Linux | Not used |
  | `⌘` with Left or Right | Back and Forward in Firefox on macOS | Not used |
  | `Control` with Up or Down, on macOS | Mission Control and App Exposé | Not used |
  | `Alt` and `Shift` with arrows | Moving tiles in Windows; `Alt` and `Shift` alone switches the keyboard layout | Not used |
  | `Control` and `Alt` with arrows | Workspace switching on some Linux desktops; screen rotation with some Windows graphics drivers | Not used |
  | `Shift` with arrows | Nothing in that table. In a page, it extends a text selection, which the focused frame prevents | **Used, to resize** |
  | Arrows | Scrolling the page, which the focused frame prevents | **Used, to move** |

  - **No modifier is left for a larger step,** so there isn't one: holding an arrow repeats, and the panel's number fields take an exact value and have their own large step.
  - **The frame takes only the arrows alone and with `Shift`.** With `Alt`, `Control` or `Meta` it does nothing and prevents nothing, so the browser and the system keep their keys ([sdk-core ADR 0030](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0030-tools-and-keyboard-shortcuts.md): `preventDefault` only for an event it handles).
  - **Other frames over the stage use the same keys,** so the editor has one set to learn.
  - **Tests:** a browser test presses each key in all three engines, on a page that can scroll and has a history entry, and checks that nothing scrolls or navigates; a component test checks that the modified arrows aren't prevented and move nothing.
- **Handles** for the eight edges and corners are drag targets of at least 24 px, 44 px on touch, and `aria-hidden`: the keys and the panel's fields are their alternative ([WCAG 2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)).
- **The Crop panel** has `ui` NumberFields for x, y, width and height in source pixels, and aspect presets as a SegmentedControl: free, original, 1:1, 4:3, 3:2, 16:9, and their portrait forms. A preset fits the largest crop of that ratio, centred in the current one.
- **Crops are in whole pixels of the oriented source** ([ADR 0003](0003-layer-plan-document-model.md)). The frame snaps to them while dragging, so what's shown is what's applied.

### The Adjust and Filters panels

- **Adjust** has one `ui` Slider per develop adjustment, in the order they're applied ([ADR 0006](0006-develop-and-filters.md)), from −100 to 100, each with its value as text, a reset to 0 when it isn't 0, and a "Reset all" for the panel. Double-clicking a slider's thumb resets it too, as a shortcut, never the only way.
- **Filters** lists the presets as a `radiogroup` of ToggleButtons, "None" first, with a strength Slider under the selected one. The presets show their names; preview thumbnails are a later change, once they can be rendered from the stage's render without a second decode.

### Tools and shortcuts

Each feature is a folder under `src/features/` with its command, UI, styles, messages and tests, registered with `defineTool` ([ADR 0009](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0009-features-as-tools.md)). The shortcut registry is created with the platform, and the editor listens on its root.

| Tool | Keys | Notes |
|---|---|---|
| `image.undo`, `image.redo` | family `undo`, `redo` | |
| `image.rotate-left`, `image.rotate-right` | `[`, `]` | Quarter turns of the plan's own rotation |
| `image.flip-horizontal`, `image.flip-vertical` | none | Toolbar buttons |
| `image.crop` | `C` | Shows the crop frame and focuses it |
| `image.zoom-in`, `image.zoom-out`, `image.zoom-fit` | family zoom | `0` fits the image to the stage |
| `image.open` | none | `Mod+O` is the browser's own |
| `image.export` | none | Irreversible, so a click, through the export dialog |

**Single-key shortcuts,** `[`, `]`, `C`, `+`, `-` and `0`, are active only while focus is inside the editor's root, which is WCAG 2.1.4's condition for character-key shortcuts. They never fire in a text field, `select` or `contenteditable`, or on a slider, whose keys are its own. Each tool's button carries `aria-keyshortcuts` from the registry, and its tooltip shows the keys from the catalogue.

### Focus

Focus always lands somewhere meaningful, and never on `<body>`:

- **After an open,** on the toolbar's first enabled tool after open.
- **After the crop tool starts,** on the crop frame; after it applies or cancels, on the crop button.
- **After undo or redo,** where it was. An announcement says what was undone, such as "Undid rotate".
- **After "Reset all",** on the panel's first slider.
- **Dialogs** are `ui`'s native `<dialog>` with `showModal()`, which returns focus to the opener on close.
- **Announcements** go through `ui`'s Announcer, politely: open done or failed, crop applied, undo and redo, and export done.

### Export while a tool is open

Export was off whenever a tool had the stage, with no reason given: someone who added text and went straight to Export found it greyed out, and had to find the panel's Done first.

- **While redacting or arranging layers, Export works, and ends the tool.** Nothing in those tools is unconfirmed: every edit is already a step, except a gesture still running, such as text being typed or an area moved with the keys. That gesture becomes its step as the tool's panel and frames close, before the dialog reads the plan. So what's exported is what's on the stage.
- **While a crop is unapplied, Export waits, and says why.** A crop isn't an edit until it's applied ("The crop tool"). Exporting would have to choose between applying a crop the user hasn't confirmed and dropping one they've set up, and either is a surprise in a file that can't be taken back.
- **A button that waits with a reason stays in the keyboard's order.** It's `aria-disabled`, not `disabled`, and described by the reason, "Apply or cancel the crop before exporting.", in `ui`'s Tooltip, which sighted users get on hover and focus too. Pressing it does nothing.
- **How a tool says so:** `unavailable(state)` on an `ImageTool` returns a message key while the tool can't run for a reason the user can act on. The toolbar does the rest. With no image open, Export gives no reason: every tool is off, and the stage already says what to do.
- **Buttons without a reason stay plainly disabled,** as before.

### The export dialog

Export is irreversible, so its dialog shows a summary before anything is written (STANDARDS, "UX"):

1. **Choices:** the format as a SegmentedControl, PNG, JPEG and WebP, with a quality Slider for the lossy ones; the size, as a scale or a box to fit; and the fields to keep, title, description, artist and copyright, as text fields that start empty ([ADR 0005](0005-colour-orientation-and-metadata.md)).
2. **Summary,** before the export button: the output's dimensions and format, and what's removed, from the session's presence flags, such as "Location, camera details and timestamps will be removed". A field the user filled is listed as kept.
3. **Progress,** which can be cancelled.
4. **Done:** a download button, which gets focus, the file's size, and an announcement. With the host's `onExport`, the `Blob` goes to the host instead, and the dialog closes.

   Pressing Download asks the browser to download the file and sends a `download` event to the host's `onEvent`, each time it's pressed. The `export` event comes earlier, when the file is ready, and the user may still close the dialog without pressing Download. So a host that guards against leaving with unsaved work waits for `download`, as editor-apps does. The event carries what `export` carries, its type, outcome and an empty list of commands, and nothing about the file.

   `download` marks the request, not a confirmed save. A sandboxed frame without `allow-downloads` starts no download, and the person can cancel the browser's own prompt; the page can't tell either way. A host that needs a confirmed save passes `onExport` and saves the file itself, and then there's no `download`, since the host knows when it has saved. audio-sdk and video-sdk word their event the same way.

A browser that can't encode WebP fails the export with `UNSUPPORTED_FORMAT` ([ADR 0001](0001-image-engines.md)); the dialog then shows the catalogue's text and keeps the choices, so the user can pick another format.

### The React API

- **`<ImageEditor>`** takes the family's props. `initialFile` is opened on mount; `plan` and `onChange` are the controlled form, where `onChange` gets the plan after each committed command, never during a gesture. Then `engine` and `processor`, which default to the SDK's own on one engine; `filePolicy`, `assetsUrl`, `tools`, `toolbar` and `features`, `theme`, `className`, `classNames`, `unstyled`, `messages` and `locale`, `icons`, `onEvent`, and `onExport`, which gets the `Blob` instead of the download.
- **`features`** turns the editor's capabilities on and off, as STANDARDS's props table says, beside `tools` and `toolbar`, which choose the toolbar's tools. Its keys are `adjust`, `filters` and `info`, the inspector's panels, and `export`, the Export tool and its dialog. Each is on unless it's `false`. With one panel on, the inspector shows it without a choice of panels; with none, it shows only the crop panel while cropping. With `export` off, no button or key exports, and the ref handle's `export()` still gives the host the file.
- **`theme`** is `ui`'s colour mode, `light`, `dark` or `system`, set as `data-hm-theme` on the editor's root, as the element sets it on itself. Unset, the editor follows the page's.
- **The ref handle** has `open(file)`, `execute(commands)`, `export(format)`, `undo()` and `redo()`.
- **Building blocks:** `ImageStage`, `ImageToolbar`, `ImageCropPanel`, `ImageAdjustPanel`, `ImageFilterPanel`, `ImageInfoPanel` and `ImageExportDialog`, each usable inside an `ImageEditorProvider`.
- **Hooks:** `useImageSession`, which reads the session's snapshot with `useSyncExternalStore`, and `useImageView`, for zoom and pan.
- **The entry starts with `"use client"`** and does nothing on import. On a server it renders the empty state's markup, with no canvas, engine or worker ([ADR 0007 in sdk-core](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0007-server-rendering-and-nextjs.md)).

### The element

`defineImageEditorElement` is built with `createEditorElement`: kind `image`, the tag `hm-image-editor`, the attributes `theme`, `locale` and `tools`, the properties `file`, `plan`, `filePolicy`, `assetsUrl`, `messages`, `engine` and `processor`, the ref handle's methods, and the events `change`, `event`, `export` and `error`. It mounts `<ImageEditor>` into the light DOM ([ADR 0040](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0040-editor-element-base.md)).

### Tests

- **axe** on every designed state, and with each panel and the crop frame open, in all three engines.
- **Screenshots** of each designed state, in light and dark, compact and comfortable, on Chromium in the pinned image ([sdk-core ADR 0048](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0048-visual-regression-for-sdk-editors.md)). The states are listed in `e2e/visual/editor.spec.ts`.
- **Keyboard only, end to end:** open through the drop zone's button; crop with the frame's keys and with the panel's fields; rotate, flip and undo; adjust with a slider's keys; choose a filter; and export, checking the summary. Each step checks where focus is.
- **One step per gesture:** a slider drag, each press of an arrow key on a slider or on a redaction's or a layer's frame, a key held down on either, and a crop drag each add one undo step and call `onChange` once; `Escape` during each restores the plan, with no step.
- **Shortcuts** don't fire in fields or on sliders, and `Space` on a button presses it.
- **The canvas** has `role="img"` and its name, and isn't focusable.
- **StrictMode:** mounting, unmounting and mounting again leaves one canvas and one renderer, and every source released ([ADR 0002](0002-workers-and-assets.md)).
- **Server rendering:** the entry renders on a server, with no canvas.
- **The element:** attributes and properties reach the editor, a move keeps the session, and a removal tears it down.

### Order of the work

1. The React entry, with `ui` 0.3.0, in pull requests that each leave a working editor: the provider, stage, toolbar and open; the crop frame and panel; the Adjust and Filters panels; the export dialog.
2. The element, with `sdk-core` 0.4.0.

## Alternatives considered

- **A command per slider movement or per drag event:** dozens of undo steps for one gesture, and an `onChange` storm for controlled hosts. Transient plans render the same pixels without either.
- **Debouncing commits by time alone:** a slow drag would split into several steps, and a fast one could lose its last value. Gestures end on their own events; only keyboard adjustment, which has no end event, uses a short delay.
- **Rendering the canvas with React:** StrictMode's second mount would find the canvas already transferred, and fail.
- **A focusable canvas that handles crop keys itself:** a screen reader would meet an image that's also a control, with no structure. A separate crop frame, a group with its own name and description, says what it is.
- **The crop frame drawn by the worker into the canvas:** handles and focus rings couldn't be in the accessibility tree, and every pointer move would wait for the worker.
- **A crop frame component in `ui` now:** one consumer, and its design isn't settled. It moves to `ui` when a second SDK, such as video-sdk's crop, needs the same control, by the family's rule of two consumers.

## Consequences

- **Every action has a keyboard path, and a defined focus target,** which the end-to-end tests check step by step.
- **A gesture is one undo step, and one `onChange`,** in every control that changes continuously.
- **The stage shows uncommitted plans during gestures,** so the stage and the session can differ for the length of a gesture, and only then.
- **The canvas's lifecycle is the effect's,** not React's, which is the one place the editor touches the DOM directly besides the crop frame's positioning.
