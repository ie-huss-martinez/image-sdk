# @hussmartinez/image-sdk

## 0.12.3

### Patch Changes

- [#149](https://github.com/ie-huss-martinez/image-sdk/pull/149) [`6845750`](https://github.com/ie-huss-martinez/image-sdk/commit/6845750da32e58cf19e7fce5bda918052ae0bce7) Thanks [@hussmartinez](https://github.com/hussmartinez)! - `ImageEditor` no longer has its inner part change an object it was given to subscribe to the session's events: it now subscribes through a function and unsubscribes when it unmounts. The stage reads its canvas from its own ref when it updates the canvas's name. Nothing you can see changes: the editor announces opens, undos and redos as before, and the preview canvas keeps its label and hides until there's an image.

- [#151](https://github.com/ie-huss-martinez/image-sdk/pull/151) [`26c1d8a`](https://github.com/ie-huss-martinez/image-sdk/commit/26c1d8aa276a12341b6d15cdb8ad624c454af564) Thanks [@hussmartinez](https://github.com/hussmartinez)! - `ImageEditor` now keeps your latest `onChange` with `@hussmartinez/ui`'s `useLatest`, which takes it as each render commits, instead of writing a ref while rendering. The crop frame no longer builds its pointer handlers while it renders. Nothing you can see changes. The package now depends on `@hussmartinez/ui` `^0.16.3`.

## 0.12.2

### Patch Changes

- [#147](https://github.com/ie-huss-martinez/image-sdk/pull/147) [`234aec7`](https://github.com/ie-huss-martinez/image-sdk/commit/234aec7f604d42d72c04656c2f973d9a30ca66ac) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The export dialog, the frames panel and the layer fields no longer reset their state in an effect after a render. They adjust it while rendering, as React recommends, so a change takes one render instead of two. Nothing you can see changes: the export dialog still reopens fresh, Repeats still offers the last count, and the Name and Text fields still show the plan's value after an undo or another layer is selected.

## 0.12.1

### Patch Changes

- [#139](https://github.com/ie-huss-martinez/image-sdk/pull/139) [`1fb9c7a`](https://github.com/ie-huss-martinez/image-sdk/commit/1fb9c7ab85d3cbc29c1d2b41eefe16a7d394ae08) Thanks [@hussmartinez](https://github.com/hussmartinez)! - A build that self-hosts the SDK's workers can now leave the inlined copies out. Set the family's `hm-self-hosted` resolve condition in your bundler, for example `resolve: { conditions: [...defaultClientConditions, "hm-self-hosted"] }` in Vite. The inlined render and job workers then resolve to a small stub instead, saving two chunks of about 91 kB together, 30 kB compressed, that your app never loaded.
  
  With the condition set, everything that creates an engine needs `assetsUrl`: `createImageEngine`, and the `assetsUrl` of `ImageEditor`, `ImageEditorProvider` and `<hm-image-editor>`. A worker started without it fails with `WORKER_START_FAILED`, whose `details` are `{ condition: "hm-self-hosted", missing: "assetsUrl" }`. Without the condition, nothing changes. `docs/hosting.md` shows the Vite and esbuild settings.

## 0.12.0

### Minor Changes

- [#137](https://github.com/ie-huss-martinez/image-sdk/pull/137) [`05782ff`](https://github.com/ie-huss-martinez/image-sdk/commit/05782ff4793f12c099f670fa2ab655db9c911709) Thanks [@hussmartinez](https://github.com/hussmartinez)! - `ImageEditorMessageCatalogue`, the type of the editor's message catalogue, is now exported from the main entry, `@hussmartinez/image-sdk`, and no longer from `@hussmartinez/image-sdk/react` or `@hussmartinez/image-sdk/element`. That's where the whole SDK family exports its editors' catalogue types (sdk-core ADR 0059). Importing it costs nothing at run time: it's a type, and the main entry still carries none of the editor's text.
  
  **Breaking:** if you import the type from `./react` or `./element`, import it from the main entry instead:
  
  ```ts
  import type { ImageEditorMessageCatalogue } from "@hussmartinez/image-sdk";
  ```
  
  Its keys and text haven't changed, and neither have `imageEditorMessages` or the `messages` props and property.

## 0.11.1

### Patch Changes

- [#135](https://github.com/ie-huss-martinez/image-sdk/pull/135) [`3a62f0b`](https://github.com/ie-huss-martinez/image-sdk/commit/3a62f0b3c5b4533dd226e745397e9368d0bef96b) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The export dialog cleans the download's name you pass as `fileName`, as sdk-core's `cleanFileName` cleans a file's name. A name you take from the user's own file can hold a path, control characters or a right-to-left override that disguises an extension. Those are removed, along with characters file systems refuse, and the name is shortened so it fits in 128 characters with its extension. A name with nothing usable left downloads as `image`. The SDK now depends on `@hussmartinez/sdk-core` `^0.4.7`.

## 0.11.0

### Minor Changes

- [#131](https://github.com/ie-huss-martinez/image-sdk/pull/131) [`4470b46`](https://github.com/ie-huss-martinez/image-sdk/commit/4470b468ac48e6de1364319088573477ad21dc84) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The SDK now depends on `@hussmartinez/ui` `^0.16.0`. Move your own `@hussmartinez/ui` dependency to `^0.16.0` too, so your application keeps one copy of ui beside image-sdk and the family's other SDKs. Nothing changes in the editor: ui 0.16 adds headings, and the editor renders none.

## 0.10.2

### Patch Changes

- [#126](https://github.com/ie-huss-martinez/image-sdk/pull/126) [`91716e5`](https://github.com/ie-huss-martinez/image-sdk/commit/91716e50da59297df092b643598982b473d0063b) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Pressing a key on the animation's scrubber, such as Home, or pressing the scrubber itself, now pauses playing even when it doesn't move the frame. Before, Home while the animation was on its first frame changed nothing and playing went on.

## 0.10.1

### Patch Changes

- [#124](https://github.com/ie-huss-martinez/image-sdk/pull/124) [`f97e327`](https://github.com/ie-huss-martinez/image-sdk/commit/f97e327ab53798968502587fb13204cc70087906) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Importing one part of `@hussmartinez/image-sdk/react` no longer ships the whole editor. Before, every import from the React entry, even the message catalogue `imageEditorMessages` alone, brought about 40 kB (brotli, minified) into your bundle, because module-level values that a bundler couldn't prove free of side effects kept the editor's code alive. Now each import carries only what it uses:
  
  - the hooks, such as `useImageSession`: about 0.7 kB;
  - `imageEditorMessages`: 4.7 kB, its text;
  - a panel: from 1.1 kB (`ImageInfoPanel`) to 10.6 kB (`ImageLayersPanel`);
  - `ImageEditor`: 40.6 kB, as before.
  
  Constants from the `.` entry, such as `UPRIGHT`, go from 1.4 kB to 0.2 kB. The API is unchanged. Bundling the whole editor costs about 0.1 kB more than before.

## 0.10.0

### Minor Changes

- [#121](https://github.com/ie-huss-martinez/image-sdk/pull/121) [`7000972`](https://github.com/ie-huss-martinez/image-sdk/commit/7000972ff9ecd032f19be01d7167535aa5a10197) Thanks [@hussmartinez](https://github.com/hussmartinez)! - `onEvent` now receives a `download` event when the export dialog's Download button is pressed: the editor asked the browser to download the file. Until now the last event was `export`, sent when the file is ready, before the user chooses to download it, so a guard against leaving with unsaved work could clear too early. Wait for `download` instead.
  
  It marks the request, not a confirmed save: in a sandboxed frame without `allow-downloads` no download starts, and a person can cancel the browser's prompt. If you need to know the file was saved, pass `onExport` and save it yourself.
  
  `ImageSessionEvent["type"]` gains `"download"`. The event carries what `export` carries, `{ type, outcome: "done", commands: [] }`, and nothing about the file. It's sent each time Download is pressed. With `onExport`, your code saves the file, so there's no `download` event. The `<hm-image-editor>` element's `event` passes it on too.

## 0.9.0

### Minor Changes

- [#119](https://github.com/ie-huss-martinez/image-sdk/pull/119) [`b7ca340`](https://github.com/ie-huss-martinez/image-sdk/commit/b7ca34017219c3ea0b83ada3a7a6e3a46157b6a9) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Moving or resizing a redaction or a layer with the arrow keys now makes one undo step per key press, and one for a key held down, as the sliders do. Before, a quick run of presses became one step, half a second after the last. Escape while an arrow key is held puts the frame back where it was, and leaves the tool open; Escape with nothing in progress still closes it. Typing in a text layer is unchanged: one step half a second after the last keystroke.

## 0.8.0

### Minor Changes

- [#117](https://github.com/ie-huss-martinez/image-sdk/pull/117) [`3f08d37`](https://github.com/ie-huss-martinez/image-sdk/commit/3f08d3748a1235dbd9dda6306ea943b49d267812) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The Adjust and Filters sliders now make one undo step per key press, and one for a key held down, as the other editors in the family do. Before, a quick run of separate presses became one step, half a second after the last. A drag is still one step, and Escape during a drag or while a key is held still puts the slider back, with no step.
  
  The SDK now depends on `@hussmartinez/ui` `^0.15.0`, whose `Slider` decides when a gesture ends and cancels it with Escape.

## 0.7.3

### Patch Changes

- [#114](https://github.com/ie-huss-martinez/image-sdk/pull/114) [`813a6d9`](https://github.com/ie-huss-martinez/image-sdk/commit/813a6d918b1dc5d62765fdc1ce833e95bb9a86bd) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The SDK now depends on `@hussmartinez/ui` `^0.14.4`. In a right-to-left page, the toolbar's Undo and Redo icons now point the way the text reads: Undo toward the start of the line, on the right. Two announcements made at the same moment are now both read out, where only the last was before.

## 0.7.2

### Patch Changes

- [#111](https://github.com/ie-huss-martinez/image-sdk/pull/111) [`72d61dc`](https://github.com/ie-huss-martinez/image-sdk/commit/72d61dc1105ea8a035f1557111ac5925edbb5762) Thanks [@hussmartinez](https://github.com/hussmartinez)! - A preview render cancelled through its `signal` while it waits for another render to finish is now refused with `ABORTED`, and is never drawn. Before, it was drawn in full and resolved `"drawn"`, as if it hadn't been cancelled.
  
  The editor isn't affected: it never passes a signal to `render()`. Only hosts that call `createImageRenderer` themselves and cancel renders with a `signal` will see the difference.

## 0.7.1

### Patch Changes

- [#107](https://github.com/ie-huss-martinez/image-sdk/pull/107) [`216ddf7`](https://github.com/ie-huss-martinez/image-sdk/commit/216ddf7d18baa8734097662f7152c16a2971a41a) Thanks [@hussmartinez](https://github.com/hussmartinez)! - A large GIF starts to open sooner. Before decoding, the SDK walks the file's blocks to check its size and frame count. It now reads the data of each frame in 64 KiB views instead of one sub-block at a time. Nothing else changes: the same files open, with the same frames, and the same files are refused with the same errors.

- [#110](https://github.com/ie-huss-martinez/image-sdk/pull/110) [`24c2676`](https://github.com/ie-huss-martinez/image-sdk/commit/24c267629bc348a701a3471a03c2b08a77d64431) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Pausing an animation, or moving to another frame, while it plays now always holds. Before, on a busy device, the frame that was about to show could still come and start the animation playing again, or replace the frame chosen.

- [#109](https://github.com/ie-huss-martinez/image-sdk/pull/109) [`c4ad289`](https://github.com/ie-huss-martinez/image-sdk/commit/c4ad289a304ed0fe0e4b50a08d8267dc4fa98a51) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The SDK now depends on `@hussmartinez/ui` `^0.14.0`, as audio-sdk 0.7 and video-sdk 0.3.1 do, so a page using image-sdk beside either has one copy of ui. Before, image-sdk asked for `^0.10.0`, which before 1.0 means 0.10 only.
  
  One behaviour comes with it, in the Layers and Frames lists: a row is now selected whenever it takes focus, by Tab or a click as well as the arrow keys. Tabbing into the Layers list with no layer selected selects the first one, so the buttons that act on it are ready at once.

## 0.7.0

### Minor Changes

- [#104](https://github.com/ie-huss-martinez/image-sdk/pull/104) [`c05da4f`](https://github.com/ie-huss-martinez/image-sdk/commit/c05da4fcd0493ee41d534085d34594a519b190b6) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The editor plays an animation ([ADR 0011](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0011-gif-and-animation.md)). An animated GIF shows a bar under the stage with Play, a frame scrubber, and which frame is shown with its delay.
  
  - **Nothing plays on its own.** An animation opens paused on its first frame. Play shows when it's pressed; `Space` plays and pauses from anywhere in the editor except on a control, as the family's play-pause shortcut does. Moving the scrubber pauses.
  - **A new tool, `image.play`,** carries that shortcut. It isn't on the toolbar, since the bar has Play; a host that lists its own `tools` adds it to keep Space.
  - **Playing keeps the file's timing** and its loop count, and stops on the last frame when the count is spent. A delay under 2 hundredths of a second plays as 10, as browsers play it; the plan and the export keep it as it is.
  - **The export dialog exports the frame shown** to PNG, JPEG and WebP, and every frame to GIF. Opening it stops playing.
  - **`ImageEditorState` gains `playback`,** the frame shown and whether it's playing: view state, outside the plan and its undo history.
  - A still image's editor looks as it did: the bar only appears for an animation.

- [#98](https://github.com/ie-huss-martinez/image-sdk/pull/98) [`281580d`](https://github.com/ie-huss-martinez/image-sdk/commit/281580dfea7b00fc84d037e231f226025bd4316b) Thanks [@hussmartinez](https://github.com/hussmartinez)! - A host can keep every file a still: `animations: false` ([ADR 0011](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0011-gif-and-animation.md)).
  
  - **`createImageSession({ animations: false })`,** the `animations` prop of `ImageEditor` and `ImageEditorProvider`, and the `animations` property of `<hm-image-editor>`. It's `true` when omitted.
  - **With `false`, an animated file opens as its first frame,** as it did before 0.7.0, and its frames aren't decoded. The editor says "This file is an animation. Its first frame is open as a still image."
  - It's the way to say so: `maxAnimationPixels` is a limit on an animation's size, not a switch.

- [#105](https://github.com/ie-huss-martinez/image-sdk/pull/105) [`24bf9fe`](https://github.com/ie-huss-martinez/image-sdk/commit/24bf9fe1d3143a38aaee70d3508bc4933ea4c166) Thanks [@hussmartinez](https://github.com/hussmartinez)! - An animation shows its first frame while it opens ([ADR 0011](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0011-gif-and-animation.md)). Every frame of an animated GIF is checked once as it opens, which takes a few seconds for a large file. The editor now shows the first frame on the stage as soon as it's decoded, with the progress and Cancel at the stage's foot, instead of an empty stage. While playing, Play shows a Pause icon.
  
  - **`ImageRegisterOptions.onFirstFrame`:** called once a source registered with all its frames has its first frame ready, before the rest are checked. From then until `register` settles, a renderer of the same engine may draw a still plan of that source.
  - **`ImageSessionSnapshot.openingFrame`:** the opening animation's first frame, as a source id and size a renderer may draw, while it opens. `null` otherwise.
  - The editor shows it only when no image is open yet. Opening another file over one that's open keeps the open one on the stage, since it stays editable until the new one is ready.
  
  **If you have your own `ImageEngine` or `ImageRenderer`:** nothing changes unless you want this. An engine that never calls `onFirstFrame` gives no early frame, and the editor shows the progress alone, as before.

- [#106](https://github.com/ie-huss-martinez/image-sdk/pull/106) [`a3df4dc`](https://github.com/ie-huss-martinez/image-sdk/commit/a3df4dc8dfe8413d6dcfc34187159fad3d5b2ad7) Thanks [@hussmartinez](https://github.com/hussmartinez)! - An animation's frames can be edited in the editor ([ADR 0011](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0011-gif-and-animation.md)). A Frames tool (`image.frames`, shortcut `F`) is on the toolbar for an animated image. It opens a panel in the inspector that lists the frames in the order they play, each with a thumbnail and a name such as "Frame 3, 0.10 seconds".
  
  - **Editing:** move a frame earlier or later, duplicate it, delete it, reverse the order, set a frame's delay or every frame's, and choose whether the animation plays once, a number of times or for ever. Each is one undo step, and moves, copies, deletions and reversals are announced. The list works from the keyboard as the layers list does: the arrows between frames, `Alt` (`Option` on macOS) with Up and Down to move one, and `Delete` to remove one.
  - **The selected frame is the frame shown,** so the list, the scrubber and the stage always agree. Selecting a frame pauses playing.
  - **Thumbnails are drawn only for the rows in view,** at most 24 at once, and released when their rows scroll away or the panel closes.
  - **`ImageFramesPanel`** is exported from `./react` for hosts that lay out their own editor, as `ImageLayersPanel` is. `ImageEditorState["tool"]` can now be `"frames"`.
  - **The toolbar leaves out a group with no tool to show,** such as the frames group for a still image, so a still's toolbar is as it was.

- [#101](https://github.com/ie-huss-martinez/image-sdk/pull/101) [`e15ca6f`](https://github.com/ie-huss-martinez/image-sdk/commit/e15ca6fe30d4f5f5662cfc396701a84bce765451) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Export to GIF ([ADR 0011](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0011-gif-and-animation.md)): `processor.export({ plan, format: { type: "gif" } })`, `session.export({ type: "gif" })`, and a GIF choice in the export dialog.
  
  - **An animated plan exports every frame,** in its order, with its delays and loop count; a still exports one frame that plays once. Everything else in the plan, the crop, the turn, develop, the layers and the redactions, applies to every frame.
  - **Every frame is written whole,** with its own palette of up to 255 colours and one transparent colour, and clears the screen before the next. So a transparent area never shows the frame before, and nothing a redaction covers in one frame can show through another. A pixel under half opaque is written transparent: a GIF has no partial transparency. A file can come out larger than the GIF it was opened from.
  - **A GIF carries no metadata.** The fields you keep aren't written to it, the session's `kept` is empty, and the dialog says so.
  - **Bounded before it starts:** frames × output pixels × 4 bytes over `maxDecodedSize` fails with `DECODED_SIZE_TOO_LARGE`. Progress is reported by frame, and the export can be cancelled between frames.
  - **A second worker writes the file,** started on the first GIF export and stopped after a while without work. It's inlined like the render worker, needing no new Content Security Policy directive. **If you self-host the assets,** copy `dist/assets/` again: it now holds `image/job.worker.js` beside `image/render.worker.js`.
  - **The encoder is `gifenc` 1.0.3** (MIT), bundled into that worker and credited in the package's new `NOTICE` file.
  - **`ImageExportFormat` gains `{ type: "gif" }`.** Code that switches over `format.type` needs a case for it. **If you pass your own `ImageProcessor`,** the editor's dialog and `session.export` can now ask it for a GIF: handle it, or reject it with `UNSUPPORTED_FORMAT`, which the dialog shows with the catalogue's text.

- [#96](https://github.com/ie-huss-martinez/image-sdk/pull/96) [`dc5ba28`](https://github.com/ie-huss-martinez/image-sdk/commit/dc5ba2819a4ac34c8ea3545889fc0efbe39b0fa4) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The engine can hold a GIF with all its frames, and draw any of them ([ADR 0011](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0011-gif-and-animation.md)). The editor and the session still open every file as a still: this is for hosts that use the engine, the processor and the renderer directly, and for the releases that follow.
  
  - **`engine.register(id, file, probe, { frames: "all" })`** holds every frame of an animated GIF. Each frame is decoded once to check it, so the call takes as long as that: `onProgress` reports each frame, and `signal` cancels it. The default, `"first"`, is a still, as before.
  - **`ImageSourceInfo` gains `timing` and `incomplete`.** `timing` is the file's loop count and each frame's delay, `null` for a still. `incomplete` is `true` when the file's frames ended early, before its end or at a frame that couldn't be decoded: the frames before that are the source's. `frames` is how many it holds, and `decodedBytes` what the worker holds for it, which for an animation isn't every frame.
  - **`frame` on an export's job and on a render's view** names which of the plan's `animation.frames` to draw, 0 when omitted. A frame the plan doesn't have is a `RangeError`.
  - **A plan with an animation is drawn only over a source registered with its frames.** Otherwise it's refused with `UNSUPPORTED_PLAN`, as before.
  
  **If you have your own `ImageEngine`:** return `timing: null` and `incomplete: false` from `register` for a still. The engine's contract tests check both.

- [#97](https://github.com/ie-huss-martinez/image-sdk/pull/97) [`a5ed827`](https://github.com/ie-huss-martinez/image-sdk/commit/a5ed827e94afcdaff7cd1618dc70407e3cba8515) Thanks [@hussmartinez](https://github.com/hussmartinez)! - An animated GIF opens as an animation ([ADR 0011](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0011-gif-and-animation.md)): the session's plan lists its frames with the file's timing, and the frame commands edit them. Playing, a timeline and writing a GIF come next; until then the editor shows the first frame, and an export is one frame.
  
  - **`session.open` gives an animated plan** for a GIF of several frames: `plan.animation` plays the source's frames in order, with the file's delays and loop count. Each frame is decoded once while it opens, so a long animation takes a moment: the snapshot's new `progress` says how many frames are checked, the stage shows it as a progress bar, and Cancel stops it.
  - **Nothing that opened before is refused.** A GIF whose screen is over the new `maxAnimationPixels` limit (8 megapixels, with a warning at 2) opens as its first frame, a still, as before, and the editor says why. Animated PNG and WebP still open as their first frame, and the editor now says that too.
  - **A damaged animation opens as the frames before the damage,** and the editor says how many opened. The source's `incomplete` is `true`.
  - **`ImageSessionSource.fileFrames`** is how many frames the file lists, beside `frames`, how many the source holds.
  - **`session.export(format, { frame })`** exports one frame of an animation: an index into `plan.animation.frames`, 0 when omitted.
  - **`applyPlan` takes an animation's changes** as one step: frames added, removed, reordered and retimed, and the loop count. It refuses a plan that would make a still play or an animation a still.
  - **`maxFrames` applies to commands that add frames,** with `TOO_MANY_FRAMES`.
  - **New texts** in the catalogue: `warnings.maxAnimationPixels` and `errors.ANIMATION_TOO_LARGE`, and in the editor's, `editor.checkingFrames` and four `notices.` keys.
  
  **What may need a change**
  
  - **If you have your own `ImageProcessor` or `ImageRenderer`:** a GIF that used to reach it as a still now has a plan with an `animation`. Pass `animation` to `checkPlanSupport` once it draws the job's or the view's `frame`; until then it refuses such a plan with `UNSUPPORTED_PLAN`, where it drew the first frame before. To keep every file a still, create the session with `animations: false`, or give the editor or the element `animations={false}`.
  - **If you store plans:** a GIF's plan now has an `animation`, which document version 4 holds.
  - **If you read `plan.animation`:** it's no longer always `null` after an open.

- [#92](https://github.com/ie-huss-martinez/image-sdk/pull/92) [`d589510`](https://github.com/ie-huss-martinez/image-sdk/commit/d589510155bf03ede3aafd1dbdbbbca2967d0517) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add the animation to the plan: format version 4 ([ADR 0011](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0011-gif-and-animation.md)). This release adds the model, the commands and the format. Opening a file as an animation, playing it and writing a GIF come in later releases: until then every opened image is a still, and a renderer refuses an animated plan with `UNSUPPORTED_PLAN`.
  
  - **`ImagePlan.animation` is `ImageAnimation | null`.** An animation is a loop count and `frames`: each an `ImageFrame` with a `key`, the `frame` of the base's source it shows, and its `delay` in hundredths of a second. A frame holds no pixels, so two may show the same one. Everything else in the plan applies to every frame.
  - **Frame commands,** each with an exact inverse: `image.insertFrames`, `image.removeFrames`, `image.moveFrames`, `image.reverseFrames`, `image.updateFrames` (delays) and `image.setLoop`. An animation keeps at least one frame and holds at most `MAX_ANIMATION_FRAMES` (4,096).
  - **New refusals** in `ImageCommandRejection`: `not-animated`, `unknown-frame`, `invalid-frame`, `invalid-delay`, `invalid-loop`, `no-frames` and `too-many-frames`. A frame command on a still is `not-animated`.
  - **Keys are unique among layers, redactions and frames.**
  
  **Format version 4**
  
  - `toImagePlanDocument` writes version 4, and `readImagePlanDocument` reads versions 1 to 4. A version 3 document reads to the same plan, each of its sources with one frame.
  - A reader from 0.6 or earlier refuses a version 4 document with `UNSUPPORTED_FORMAT` and `unknown-format-version`, which an application can show as "update the application". Keep documents at the version their readers have until every reader is updated.
  - The schemas are `formats/hm-image-plan/v4.schema.json` and `formats/hm-image-command/v4.schema.json`; earlier versions' stay.
  
  **What to change**
  
  - **`ImagePlanDocumentSource` has a required `frames`,** 1 for a still. If you build the `sources` you pass to `toImagePlanDocument` yourself, add it; the session's own sources (`ImageSourceInfo`) already have it.
  - **`createImageReducer`'s function may return `frames`** with a source's size (`ImageReducerSource`). A source that gives none has one frame, so existing callers work unchanged.
  - **Code that assumed `plan.animation` is `null`** should check it. A custom renderer or processor should pass `animation` to `checkPlanSupport` only once it plays one.

- [#99](https://github.com/ie-huss-martinez/image-sdk/pull/99) [`21f2dcd`](https://github.com/ie-huss-martinez/image-sdk/commit/21f2dcda9420919573aac5459debcf302ffdcb80) Thanks [@hussmartinez](https://github.com/hussmartinez)! - An animation the SDK can't hold opens as its first frame, and says so ([ADR 0011](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0011-gif-and-animation.md)). It's one rule for the three limits on animations: `maxFrames`, `maxDecodedSize` across the frames, and `maxAnimationPixels`.
  
  - **Files that 0.6.0 refused now open.** An animated GIF, PNG or WebP with more frames than `maxFrames` (300), or whose frames could decode to more than `maxDecodedSize` (1 GB), was refused with `TOO_MANY_FRAMES` or `DECODED_SIZE_TOO_LARGE`, though only its first frame was ever shown. It now opens as its first frame, a still, and the editor says "This animation is too large to edit as an animation. Its first frame is open as a still image."
  - **The snapshot's `warnings` name the limits** such a file was over. A still's own limits still refuse: a file whose first frame alone is over `maxImagePixels`, `maxImageDimension`, `maxFileSize` or `maxDecodedSize` fails as before.
  - **`engine.register` counts what it's asked to hold:** one frame for a still, the default, and every frame with `frames: "all"`, which is where the animation limits' codes can still be raised.
  - **`checkFileLimits(policy, size, probe, frames?)`** takes `"first"` or `"all"`, and counts every frame when it isn't told, as before. `ANIMATION_LIMITS` and `animationLimits(policy, probe)` say which of the three a file is over and near, without throwing.
  
  **If you relied on the refusal:** a host that showed `TOO_MANY_FRAMES` for a long animation now gets a still and a warning in the snapshot. To refuse such files, check `animationLimits(policy, probe).over` before opening.

### Patch Changes

- [#103](https://github.com/ie-huss-martinez/image-sdk/pull/103) [`cd2a8a9`](https://github.com/ie-huss-martinez/image-sdk/commit/cd2a8a953acd737de2fcc527bb05d3a3962c23ea) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The export summary no longer says details are kept in a WebP file. WebP exports carry no metadata, as they never have, but the dialog listed the fields you filled in under "Kept in the file", and `session.export` reported them in `kept`. Now, for WebP as for GIF, `kept` is empty and the dialog says "A WebP file carries no details: these aren't written to it." PNG and JPEG keep the fields as before.

## 0.6.0

### Minor Changes

- [#86](https://github.com/ie-huss-martinez/image-sdk/pull/86) [`b01b4c9`](https://github.com/ie-huss-martinez/image-sdk/commit/b01b4c9b6619b9d3195bb8974d4355cdbb5b4d77) Thanks [@hussmartinez](https://github.com/hussmartinez)! - GIFs are decoded by the SDK's own decoder, and malformed GIFs that browsers show now open ([ADR 0011](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0011-gif-and-animation.md)).
  
  - **What you see is the same.** A GIF still opens as its first frame, and that frame is, pixel for pixel, the one the browser's decoder drew, in Chromium, Firefox and WebKit.
  - **The browser's decoder no longer sees a GIF.** The file's blocks were already walked by the SDK's own code before anything decoded it; now its pixels are decoded by it too, the same way in every browser.
  - **Fixed: GIFs that browsers show were refused.** Up to 0.5.0, a GIF was refused with `INVALID_IMAGE` unless every block of it could be read through to its trailer, so a file that had lost its last bytes, or had a damaged frame after its first, didn't open. Now the file's frames end where it stops being a GIF, and it opens as long as its first frame is whole.
  - **A GIF that can't be shown whole fails as `INVALID_IMAGE`,** with what was wrong in `details.problem`. Before, it could fail as `DECODE_FAILED`, or open as a partly drawn or empty image, depending on the browser.
  
  What opens, beside what `createImageBitmap` makes of the same file's first frame in each browser:
  
  | The file's defect | Chromium | Firefox | WebKit | 0.5.0 | Now |
  | --- | --- | --- | --- | --- | --- |
  | Bytes after the trailer | opens | opens | opens | opens | opens |
  | Data after a frame's last pixel: more pixels, or bytes after the end code | opens | opens | opens | opens | opens |
  | No end code, with every pixel there | opens | opens | opens | opens | opens |
  | No trailer | opens | opens | empty image | refused | opens |
  | A later frame cut short, or the file cut inside a later block | opens | opens | opens, or empty image | refused | opens, as the frames before it |
  | A block that isn't one, after a frame | opens | opens | opens | refused | opens, as the frames before it |
  | A later frame outside the screen, or with a code size out of range | opens | opens | opens | refused | opens, as the frames before it |
  | A reserved disposal method | opens | opens | opens | refused | opens |
  | A code size of 1 | opens | refused | empty image | refused | opens |
  | A pixel that names a colour its table doesn't have | opens, as black | opens, as another colour | opens, not drawn | as the browser | opens, not drawn |
  | A frame with no colour table at all | opens | opens | empty image | as the browser | opens, nothing drawn |
  | The first frame's data cut short | refused | opens, partly made up | empty image | refused | refused |
  | The first frame's data holds fewer pixels than the frame, or uses a code that isn't defined | refused | refused, or made up | empty image | as the browser | refused |
  | The first frame outside the screen | refused, or opens | opens, at another size than Chromium, or refused | opens, or empty image | refused | refused |
  
  If you matched on `DECODE_FAILED` for GIFs, match on `INVALID_IMAGE` too. Opening a GIF as an animation, and writing one, come in a later release.

### Patch Changes

- [#88](https://github.com/ie-huss-martinez/image-sdk/pull/88) [`07e0d8f`](https://github.com/ie-huss-martinez/image-sdk/commit/07e0d8f560aefe1357acd1f5752685d199fa6271) Thanks [@hussmartinez](https://github.com/hussmartinez)! - A GIF whose first frame is larger than its logical screen now opens, where it was refused with `INVALID_IMAGE` ([ADR 0011](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0011-gif-and-animation.md)).
  
  Some encoders write a screen smaller than the image. When the first frame is at 0, 0 and at least as wide and as tall as the screen, the image is that frame, at the frame's size: what Chromium, Firefox and WebKit all show. The probe reports that size, so `maxImageDimension`, `maxImagePixels` and `maxDecodedSize` apply to it.
  
  A first frame outside the screen in any other way is still refused: wider than the screen but not as tall, or away from its corner. Browsers open those at sizes that differ from one another.

## 0.5.0

### Minor Changes

- [#83](https://github.com/ie-huss-martinez/image-sdk/pull/83) [`92d17b7`](https://github.com/ie-huss-martinez/image-sdk/commit/92d17b75bac87c292ea938cc6604171664cb4e87) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add the Draw tool and the arrow tool to the editor ([ADR 0015](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0015-drawing-in-the-editor.md)).
  
  - **Draw.** `image.draw`, in the default toolbar before Layers, with the `D` shortcut. Drag across the image to draw a stroke: it shows as it's drawn, and is one undo step when the pointer lifts. A press without a drag is a dot. `Escape` ends a stroke in progress with nothing added.
  - **Pen and highlighter.** The panel chooses between them, and sets the colour and the width. A highlighter draws wide, see-through strokes that don't darken where they cross. "Remove last stroke" takes the last stroke back.
  - **One drawing, many strokes.** Strokes go into one drawing layer, so a signature is one row in the layers list. Starting Draw with a drawing selected in the layers adds to it.
  - **Arrows.** `image.add-arrow`, in the "Add" group, adds an arrow across the middle of the image, pointing right. In the layers its frame has a handle on each end; the arrow keys move it, and `Shift` with an arrow moves its tip. The panel has fields for both ends, its colour and its width.
  - **Drawings in the layers.** A drawing has a frame around its strokes: drag it or use the arrow keys to move it.
  - **Drawing needs a pointer:** a mouse, a pen or a finger. The panel says so. The arrow tool is the keyboard's way to point at something.
  - **Building blocks and API:** `ImageDrawPanel`; and `draw` on `ImageEditorState`, with `"draw"` as a value of its `tool`.
  
  If you pass your own `toolbar` groups, add `"image.draw"` and `"image.add-arrow"` to show the tools. If you render the building blocks yourself, render `ImageDrawPanel` with the others: `ImageStage` takes the strokes whenever the tool is active.

- [#79](https://github.com/ie-huss-martinez/image-sdk/pull/79) [`031453f`](https://github.com/ie-huss-martinez/image-sdk/commit/031453f2d05c24a5f8fa550eedc983fe4937a417) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add drawings and arrows to the plan: format version 3 ([ADR 0009](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0009-scene-space-layers-and-plan-versions.md), [ADR 0014](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0014-drawing-strokes-and-arrows.md)).
  
  - **Two new kinds of layer.** `ImageDrawingLayer` holds freehand strokes at an origin; `ImageArrowLayer` points from one place to another. Neither has a box. `ImageBoxedLayer` names the three kinds that do.
  - **A stroke is what one gesture drew:** a colour, a width, and `runs` of points. It has more than one run only when it's long.
  - **Stroke commands.** `image.addStrokes` appends strokes to a drawing and `image.removeStrokes` removes them by index, each with an exact inverse. A drawing keeps at least one stroke. `image.updateLayers` moves a drawing by its origin and re-aims an arrow.
  - **Geometry, pure and in the vectors:** `simplifyStroke` turns a pointer's samples into a stroke's runs, the same in every browser; `arrowOutline` gives the polygon an arrow is drawn as; `drawingBounds` and `arrowBounds` give what a layer covers; `drawingPoints` counts a plan's points.
  - **A new limit, `maxDrawingPoints`:** 200,000 points across a plan's drawings, with a warning at 100,000, and the `TOO_MANY_POINTS` error code. The session also bounds the points its undo history holds, and trims the oldest steps beyond a million.
  - **`checkPlanSupport` has a `drawings` part,** for a renderer or processor that draws the other layers and not these.
  
  **Format version 3**
  
  - `toImagePlanDocument` writes version 3, and `readImagePlanDocument` reads versions 1, 2 and 3. A version 2 document reads to the same plan.
  - A reader from 0.4 refuses a version 3 document with `UNSUPPORTED_FORMAT` and `unknown-format-version`, which an application can show as "update the application". Keep documents at the version their readers have until every reader is updated.
  - The schemas are `formats/hm-image-plan/v3.schema.json` and `formats/hm-image-command/v3.schema.json`; version 2's stay.
  
  **If you handle layers yourself**
  
  - `ImageLayer` is a wider union: code that reads `x`, `width` or `rotation` from any layer needs to check its `kind` first, or take an `ImageBoxedLayer`.
  - A custom renderer or processor should pass `drawings` to `checkPlanSupport` only once it draws them.

- [#81](https://github.com/ie-huss-martinez/image-sdk/pull/81) [`4451f68`](https://github.com/ie-huss-martinez/image-sdk/commit/4451f68402ff46be2b7479fb8f42a58bffca776e) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Draw drawings and arrows, in the preview and in every export ([ADR 0014](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0014-drawing-strokes-and-arrows.md)).
  
  - **Strokes** are drawn as lines through their points, at their width, with round joins and round ends; a single point is a dot. No curve is fitted, so a drawn corner stays a corner.
  - **A long stroke is one line.** A stroke that `simplifyStroke` cut into runs is drawn joined where it was cut, the same pixels as if it hadn't been.
  - **A drawing is composited as one,** at its layer's opacity, so strokes that cross don't darken each other. A highlighter is a wide stroke in a drawing with a low opacity.
  - **An arrow** is drawn as `arrowOutline`'s polygon, filled, with its tip exactly on the point it aims at and nothing past it.
  - **Like every layer,** they aren't developed with the base, they stay on the pixels they were drawn on when the image is cropped, turned or mirrored, and redactions cover them.
  
  The built-in renderer and processor now take the `drawings` part of a plan. A custom processor that doesn't draw them still refuses such a plan through `checkPlanSupport`.

### Patch Changes

- [#82](https://github.com/ie-huss-martinez/image-sdk/pull/82) [`d4b4264`](https://github.com/ie-huss-martinez/image-sdk/commit/d4b42645dabc4b81f2412ce47dddd712b83d1fe8) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Export no longer greys out while Redact or Layers is open ([ADR 0007](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0007-editor-shell.md)).
  
  - **While redacting or arranging layers,** the toolbar's Export works: it ends the tool and opens the export dialog. A gesture still running, such as text being typed, is included in the export.
  - **While a crop is unapplied,** Export still waits, and now says why: the button stays reachable with the keyboard and is described by "Apply or cancel the crop before exporting.", in a tooltip.
  - **`ImageTool` gains an optional `unavailable(state)`,** which returns a message key while a tool can't run for a reason the user can act on. `ImageToolbar` keeps such a button focusable and describes it with the text. Your own tools can use it; the new string is `tools.exportWhileCropping`.

- [#84](https://github.com/ie-huss-martinez/image-sdk/pull/84) [`4d36ed4`](https://github.com/ie-huss-martinez/image-sdk/commit/4d36ed42655de13dce770daeb108ed66c65b31b1) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The layers list is one tab stop ([ADR 0013](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0013-layers-in-the-editor.md)).
  
  - **The list is `@hussmartinez/ui`'s `ReorderableList`,** in place of a list of buttons with two tab stops for each layer. Tab reaches the list once; the Up and Down arrows move between layers and select, and Left and Right move between a layer's name and its show-or-hide button.
  - **The same keys as before** move and remove: `Alt` (`Option` on macOS) with Up or Down moves the focused layer, and `Delete` or `Backspace` removes it.
  - **After a delete,** the layer now in its place in the list is selected: the one that was under it. Before, it was the one over it.
  - **For assistive technology** the list is a grid of rows, each selected or not, where it was a list of pressed and unpressed buttons.
  
  If you style the list, its rows are now ui's (`.hm-reorderable-list-row`); `.hm-image-layer-select` is still on each layer's name, and `.hm-image-layer-visibility` on its button.
  
  This release needs `@hussmartinez/ui` 0.10.0 or later.

## 0.4.0

### Minor Changes

- [#72](https://github.com/ie-huss-martinez/image-sdk/pull/72) [`3b155e4`](https://github.com/ie-huss-martinez/image-sdk/commit/3b155e48a51eeaa84f9ecc4550ffde78fc61ddd8) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add `session.insertImage(file)`: open a second image and add it to the document as an image layer, as one undoable step ([ADR 0003](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0003-layer-plan-document-model.md), [ADR 0004](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0004-image-limits.md)).
  
  - **Checked like any file:** probed from its headers and held to the file policy before it's decoded, in the worker.
  - **Placed for you, or by you:** by default the image is centred on what's shown, at its own size or half the composition's, whichever is smaller, over every layer, and set against the plan's rotation and flips, so it's seen as the file is, not turned or mirrored. `place` returns your own commands instead.
  - **Held only while it's needed:** the session keeps the source while the plan, an undo or redo step, or an export in progress refers to it, and releases it then. Opening another file releases them all.
  - **Limits:** `maxFiles` counts every source the session holds, and `maxSessionSize` their decoded bytes. When an image doesn't fit, the session drops the oldest undo steps that alone keep another image; if that can't free enough, nothing is dropped and it fails with `SESSION_TOO_LARGE`.
  - **The snapshot** gains `sources`, every source held; `inserting`; and `historyTrimmed`, true once undo steps were dropped to make room.
  - **Events:** `onEvent` gets `{ type: "insert" }`, with no file name, size or source id, like the others.
  
  `ImageSessionSnapshot` has three new required fields, and `ImageSessionEvent["type"]` a new value: code that builds a snapshot by hand, such as a test double, or switches over every event type, needs them.
  
  A plan with an image layer still can't be previewed or exported until the renderer draws layers.

- [#73](https://github.com/ie-huss-martinez/image-sdk/pull/73) [`e8fef44`](https://github.com/ie-huss-martinez/image-sdk/commit/e8fef444f7d4f64ad53f9c4cd22b0ef887807637) Thanks [@hussmartinez](https://github.com/hussmartinez)! - **Breaking:** the editor's text moves out of the server-safe entry. `imageMessages`, from `@hussmartinez/image-sdk`, now holds only what the headless entry produces: sdk-core's messages, and the text of every error code and limit warning. The editor's own text, and ui's, are in `imageEditorMessages`, from `@hussmartinez/image-sdk/react` and `@hussmartinez/image-sdk/element` ([ADR 0012](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0012-interface-text-outside-the-server-safe-entry.md)).
  
  The headless entry is about 1.9 kB smaller (20.09 kB to 18.16 kB brotli), and servers that import it no longer carry text they never show. No key or text changes, and the `messages` props and the element's `messages` property work as before.
  
  ### Migrating
  
  Most hosts change nothing: `<ImageEditor messages={{ "tools.crop": "Trim" }} />` works as it did.
  
  If you type your overrides, or build your own `Messages` for the editor's components:
  
  ```ts
  // Before
  import { type ImageMessageCatalogue, imageMessages } from "@hussmartinez/image-sdk";
  const overrides: MessageOverrides<ImageMessageCatalogue> = { "tools.crop": "Trim" };
  const messages = createMessages(imageMessages, { overrides });
  
  // After
  import {
    type ImageEditorMessageCatalogue,
    imageEditorMessages,
  } from "@hussmartinez/image-sdk/react";
  const overrides: MessageOverrides<ImageEditorMessageCatalogue> = { "tools.crop": "Trim" };
  const messages = createMessages(imageEditorMessages, { overrides });
  ```
  
  Headless code that shows errors keeps `imageMessages`: `createMessages(imageMessages).error(error)` still has every code's text.

- [#78](https://github.com/ie-huss-martinez/image-sdk/pull/78) [`dd51552`](https://github.com/ie-huss-martinez/image-sdk/commit/dd51552de0352ae6f06ed9ff26e6b6f8147086c2) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Layers can be mirrored, and a layer added to a mirrored image reads as it should ([ADR 0009](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0009-scene-space-layers-and-plan-versions.md)).
  
  - **`flipX` on a layer's box.** Every text, shape and image layer has `flipX`, a boolean: whether it's mirrored left to right about its box's own vertical axis, before the box is turned. It's required, in the plan, in `image.insertLayers` and in a plan document of format version 2; `image.updateLayers` sets it. A mirror top to bottom is `flipX` with a half turn (`rotation: 1800`).
  - **New layers read correctly.** The tools that add text, shapes and images set a new layer against the image's flips as well as its rotation, so text added to a mirrored image isn't backwards. Flipping the image afterwards still mirrors its layers with it.
  - **`session.insertImage` does the same by default:** without `place`, the image is placed neither turned nor mirrored in the output, whatever the plan's orientation.
  - **"Mirror" in the layers panel** flips the selected layer about its own box.
  - **`layerToScene`** applies the mirror, so `layerToOutput`, `sceneToLayerSource`, the renderer and the editor's frames follow. Exports stay redacted under a mirrored image layer.
  
  If you build layers yourself, add `flipX: false` to each.

- [#71](https://github.com/ie-huss-martinez/image-sdk/pull/71) [`774279c`](https://github.com/ie-huss-martinez/image-sdk/commit/774279cb7cf2054f30c34cb1c8313a3d76d3f2d8) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add layers to the plan: text, shapes and images over the base ([ADR 0009](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0009-scene-space-layers-and-plan-versions.md)). This is the model and its commands; drawing them and the editor's tools follow.
  
  - **`plan.layers`** is a list of `ImageLayer`s, drawn bottom to top: `ImageTextLayer`, `ImageShapeLayer` and `ImageImageLayer`. Each has a key, a name, `visible`, an `opacity` from 0 to 100, and a box in whole pixels of the base's oriented source, turned about its centre in tenths of a degree, with `flipX` to mirror it. Like redactions, layers stay on the pixels they cover when the image is cropped or turned.
  - **Text** is drawn as large as fits in its box, in one of three generic fonts, and can't hold control characters other than a line feed, or the bidirectional override and isolate controls, which can make text read differently from what's stored.
  - **Commands:** `image.insertLayers`, `image.removeLayers`, `image.moveLayers` and `image.updateLayers`, each undone exactly. `image.updateLayers` sets any field of a layer's kind except its key and kind, for several layers at once. New `INVALID_COMMAND` reasons, such as `wrong-kind` and `invalid-text`, are listed in `ImageCommandRejection`.
  - **Keys and limits are shared with redactions:** a key is unique across both lists, and `maxLayers` counts both.
  - **Format version 2** now holds layers. `formats/hm-image-plan/v2.schema.json` and `formats/hm-image-command/v2.schema.json` describe them, and `readImagePlanDocument` checks that an image layer's source is one the document lists.
  
  `ImagePlan["layers"]` changes type, from an always-empty list to `readonly ImageLayer[]`. Code that only reads plans from `createPlan` or the session needs no change.
  
  Until the renderer draws layers, exporting or previewing a plan with any fails with `UNSUPPORTED_PLAN`, as for any part a renderer can't draw. An image layer's source must be one the session holds; today that's the open image, and opening further images for layers comes with the image tool.

- [#77](https://github.com/ie-huss-martinez/image-sdk/pull/77) [`f26d606`](https://github.com/ie-huss-martinez/image-sdk/commit/f26d60609eac4a7e09be1fe6e21468e273cf07b5) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add the tools that add text, shapes and images to an image, and the fields that edit them ([ADR 0013](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0013-layers-in-the-editor.md)).
  
  - **Four tools,** in the default toolbar before Layers: `image.add-text` (shortcut `T`), `image.add-rectangle`, `image.add-ellipse` and `image.add-image`. Each adds a layer in the middle of the image as it's shown, the right way round whatever the image's rotation and flips, as one undo step, and shows the layers with it selected.
  - **Text** starts empty, with focus in its field. It's drawn as it's typed, and the typing is one undo step when it pauses. Its panel sets the font (sans, serif or mono, drawn by the device's fonts), alignment, bold and colour. Pasted text is taken as the plan takes it: line breaks become line feeds, and what text can't hold is dropped.
  - **Shapes** start as a red outline. Their panel turns the fill and the outline on and off and sets their colours and the outline's width; a shape always keeps one of the two.
  - **Images** are chosen in the tool's own file picker and stay on the device. `insertImage(file)` is new on `ImageEditorHandle` and on `<hm-image-editor>`, for a file the host has.
  - **Colours** are any `#rrggbb`, typed or picked from six swatches.
  - **What can't be added,** such as a file that isn't an image or a layer over `maxLayers`, is said on the stage, and nothing changes.
  
  **API changes**
  
  - `ImageEditorHandle` and the element gain `insertImage(file)`.
  - `ImageEditorState` gains `error`, and `focus` on `layers`.
  - `ImageToolContext` gains `chooseLayerImage`. If you build your own tool context for `ImageToolbar`, add it: a function that asks for an image and passes it to `session.insertImage`.
  - If you pass your own `toolbar` groups, add the four tool ids to show them.
  
  This release needs `@hussmartinez/ui` 0.9.0 or later, for its colour field and multi-line text field.

- [#75](https://github.com/ie-huss-martinez/image-sdk/pull/75) [`d5268b3`](https://github.com/ie-huss-martinez/image-sdk/commit/d5268b3cbb8464546e74437e9edcce6b93a0d128) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add the Layers tool to the editor: a list of the plan's layers and a frame on the image for each ([ADR 0013](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0013-layers-in-the-editor.md)).
  
  - **The tool.** `image.layers`, in the default toolbar after Redact, with the `L` shortcut. Like the editor's other single-key shortcuts, it works only while focus is inside the editor, and never in a field.
  - **In the panel.** The layers, the top one first: each has a button that selects it and one that shows or hides it. Under the list, buttons move the selected layer up and down the stack, duplicate it and delete it, and fields set its name, position, size, turn and opacity.
  - **On the stage.** Each layer has a frame, turned as the layer is. A press selects the top layer under the pointer, a drag moves it, and the selected frame's handles resize it. A hidden layer's frame shows while it's selected.
  - **Keys.** On a focused frame, the arrow keys move the layer by a pixel, `Shift` with an arrow resizes it, `Delete` or `Backspace` removes it, and `Escape` closes the layers: the crop frame's keys. In the list, `Alt` (`Option` on macOS) with the Up or Down arrow moves the focused layer up or down the stack, and `Delete` or `Backspace` removes it.
  - **Each gesture is one undo step,** and the preview shows the layer where it's being moved.
  - **Building blocks and API:** `ImageLayersPanel`; and `layers` on `ImageEditorState`, with `"layers"` as a value of its `tool`.
  
  This release doesn't add layers from the editor yet: the text, shape and image tools come next. A layer comes from a plan, from `image.insertLayers`, or from `session.insertImage(file)`.
  
  If you pass your own `toolbar` groups, add `"image.layers"` to show the tool. If you render the building blocks yourself, render `ImageLayersPanel` with the others: `ImageStage` shows the frames whenever the tool is active.

- [#62](https://github.com/ie-huss-martinez/image-sdk/pull/62) [`076426d`](https://github.com/ie-huss-martinez/image-sdk/commit/076426d31bba7be1263b0deaa8bd0bdf90067f99) Thanks [@hussmartinez](https://github.com/hussmartinez)! - **Breaking:** `ImagePlan` gains three required fields, `layers`, `redactions` and `animation`, and the plan's portable format is now `hm-image-plan` version 2.
  
  This is the model for redaction and layers, which arrive in the next changes ([ADR 0009](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0009-scene-space-layers-and-plan-versions.md), [ADR 0010](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0010-redaction.md)).
  
  - **Redactions in the plan.** `plan.redactions` is a list of `ImageRedaction`s: rectangles in whole pixels of the base's oriented source, `solid` with a colour or `pixelate`. They're placed in the scene, so they stay on the pixels they cover when the image is cropped or turned.
  - **Commands.** `image.insertRedactions`, `image.removeRedactions`, `image.moveRedactions` and `image.updateRedactions`, each undone exactly. New `INVALID_COMMAND` reasons, such as `duplicate-key` and `invalid-region`, are listed in `ImageCommandRejection`.
  - **`layers` and `animation`** are in the plan now, always `[]` and `null`, so later releases change what they hold, not the plan's shape.
  - **`maxLayers`** now applies: a step that adds redactions past it fails with `TOO_MANY_LAYERS`.
  - **`checkPlanSupport` and `UNSUPPORTED_PLAN`.** A renderer or processor refuses a plan with a part it can't draw, instead of drawing the image without it. Custom `ImageRenderer`s and `ImageProcessor`s should call `checkPlanSupport(plan, [...])` with the parts they draw.
  - **Format version 2.** `readImagePlanDocument` reads versions 1 and 2, and `toImagePlanDocument` writes version 2. The schemas are `formats/hm-image-plan/v2.schema.json` and `formats/hm-image-command/v2.schema.json`; version 1's stay in the package.
  
  ### Migrating
  
  - **Plans from `createPlan` and from the session** already have the new fields. Nothing changes.
  - **Stored plan documents** (`hm-image-plan` version 1): read them with `readImagePlanDocument`, which migrates them. No stored document needs rewriting.
  - **Plans you build or store as plain `ImagePlan` objects,** such as a controlled editor's `plan`: add `layers: []`, `redactions: []` and `animation: null`. `session.applyPlan`, and so `<ImageEditor plan>`, refuses a plan without them with `INVALID_COMMAND`, so an old plan is never mistaken for one with no redactions.
  - **Exhaustive `switch`es over `ImageCommand["type"]`** need the six new command types.

- [#69](https://github.com/ie-huss-martinez/image-sdk/pull/69) [`e51f74b`](https://github.com/ie-huss-martinez/image-sdk/commit/e51f74bb7f388d9a3c029eb0fb15cb3dc240d8ae) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Add the Redact tool to the editor ([ADR 0010](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0010-redaction.md)).
  
  - **The tool.** `image.redact`, in the default toolbar after Crop, with the `R` shortcut. Like the editor's other single-key shortcuts, it works only while focus is inside the editor, and never in a field.
  - **On the stage.** Each redacted area is a frame over the image. Drag across the image to draw one. On a focused frame, the arrow keys move it by a pixel, `Shift` with an arrow resizes it, `Delete` or `Backspace` removes it, and `Escape` ends redacting: the crop frame's keys.
  - **In the panel.** A solid colour (black or white) or pixelation, with a warning that pixelation may not hide text; "Add area", which needs no dragging; number fields for the selected area's position and size; and a list of every area, each with a button to remove it.
  - **Each gesture is one undo step,** and the preview shows the area redacted while it's being drawn or moved.
  - **The export summary** says how many areas are redacted, and warns when any is pixelated.
  - **Building blocks and API:** `ImageRedactPanel`; `createImageKey`, for the keys new redactions need; `sceneRectToComposition`, `compositionRectToScene` and `fitRedactionRegion`, the geometry that places an area's frame; and `redact` on `ImageEditorState`, with `"redact"` as a value of its `tool`.
  
  The editor offers black and white. The plan holds any `#rrggbb` colour, so a host that builds its own commands isn't limited to those.
  
  If you pass your own `toolbar` groups, add `"image.redact"` to show the tool. If you render the building blocks yourself, render `ImageRedactPanel` with the others: `ImageStage` shows the frames whenever the tool is active.
  
  This release needs `@hussmartinez/ui` 0.8.0 or later, for the tool's icon.

- [#74](https://github.com/ie-huss-martinez/image-sdk/pull/74) [`5692971`](https://github.com/ie-huss-martinez/image-sdk/commit/5692971c4bf2b6d4594ee3a9eac281207cd58b0f) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Layers are now drawn: the preview shows text, shape and image layers, and exports contain them ([ADR 0009](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0009-scene-space-layers-and-plan-versions.md)).
  
  - **The preview is the export.** Both are drawn by the same code from the same layout, so a preview at the export's size matches it pixel for pixel.
  - **Text** is laid out once and scaled to the largest size that fits its box, breaking lines only at line feeds, aligned by the text's own direction: `start` is the right edge for Hebrew or Arabic text.
  - **Fonts are the device's.** `sans-serif`, `serif` and `monospace` are drawn by whatever the browser resolves them to, and `bold` by the browser's bold for that family. The SDK ships and fetches no font, so the same plan can look different on another device: two families may be the same font there, and `bold` may be a real bold face, a synthesised one, or no different from regular.
  - **Shapes** are rectangles and ellipses that fill their box, with the stroke inside it.
  - **Image layers** draw a crop of another source, scaled and turned.
  - **Opacity fades a layer as one:** a shape's stroke doesn't show through its fill.
  - **Layers are never developed:** adjustments and filters change the photo, not what's drawn over it.
  - **Redactions cover layers too.** An image layer's pixels under a redaction are replaced before the layer is scaled, as the base's are, so an export doesn't depend on them; text and shapes over a redaction are covered exactly.
  - **New geometry,** for hosts and other renderers: `layerToOutput`, `layerToScene`, `sceneToOutput`, `sceneToLayerSource`, `fitTextLines`, `isRightToLeft`, `applyMatrix`, `invertMatrix` and the `ImageMatrix` type.
  
  A layer with an opacity under 100 costs one more canvas the size of the output while it's drawn, and an image layer under a redaction one the size of its source, each checked against the file policy first.
  
  A plan that names an image layer's source the engine doesn't hold fails with a `TypeError`, as one that names an unknown base does. Custom `ImageRenderer`s and `ImageProcessor`s that don't draw layers keep refusing such plans through `checkPlanSupport`.

- [#66](https://github.com/ie-huss-martinez/image-sdk/pull/66) [`670bf9f`](https://github.com/ie-huss-martinez/image-sdk/commit/670bf9f1d7d002351de321d0a48d69bf7d6571f3) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Redactions are now rendered: the preview shows them, and exports don't contain what they cover ([ADR 0010](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0010-redaction.md)).
  
  - **A solid redaction destroys its pixels.** An export's bytes don't depend on them: two images that differ only inside the region export to identical files, in PNG, JPEG and WebP, at any output size, crop and orientation. The covered pixels are replaced before the image is scaled, so nothing of them is left along the region's edge, and the region is then filled on whole output pixels, rounded outward.
  - **A pixelated redaction keeps only block averages.** Its blocks are the larger of 8 pixels and a twelfth of the region's longer side, so a strip over a line of text is one row of blocks. Pixelation obscures; for text and numbers, use solid.
  - **Redactions follow the image.** They're placed on the source's pixels, so they stay on what they cover through every crop, turn and flip.
  - **Nothing is drawn without them.** If the renderer can't make the copy it draws from, the preview keeps its last frame and an export fails, with the error's own code.
  - **Only exports are redacted.** The plan describes the redaction, and the source the session holds is unchanged; `engine.thumbnail` returns it as it is.
  - **New geometry,** for hosts and other renderers that place or draw redactions: `redactionRectInOutput`, `redactionBlocksInOutput`, `redactionBlocksInScene`, `redactionBlockSize` and the `ImageRect` type.
  
  A redaction costs memory while it exists: one more canvas the size of the image. It's checked against `maxImagePixels` and `maxImageDimension` before it's allocated.
  
  Custom `ImageRenderer`s and `ImageProcessor`s that don't draw redactions keep refusing such plans through `checkPlanSupport`. To draw them, follow ADR 0010's two passes, and pass `"redactions"` to `checkPlanSupport`.

### Patch Changes

- [#68](https://github.com/ie-huss-martinez/image-sdk/pull/68) [`8a5c4c8`](https://github.com/ie-huss-martinez/image-sdk/commit/8a5c4c8009301ab2c89f5624b6907701e3259746) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Fix the crop frame's resize keys taking the browser's Back and Forward. The frame resized with `Alt` and the arrow keys, and `Alt` with Left or Right goes back or forward a page in Chrome and Firefox on Windows and Linux, so resizing a crop could leave the page and lose the edit.
  
  **The keys have changed:**
  
  | Key, on the crop frame | Before | Now |
  |---|---|---|
  | Arrows | Move by 1 pixel | Move by 1 pixel |
  | `Shift` with an arrow | Move by 10 pixels | **Resize by 1 pixel** |
  | `Alt` with an arrow | Resize by 1 pixel | Nothing: left to the browser |
  
  There's no 10-pixel step now: hold an arrow, or type a value in the crop panel's fields. The frame's description, which screen readers read, names the new keys. If your own documentation lists the crop keys, update it.

- [#65](https://github.com/ie-huss-martinez/image-sdk/pull/65) [`4b19eba`](https://github.com/ie-huss-martinez/image-sdk/commit/4b19eba149ed911c7bad9ce19a62d22cbd98fe73) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Fix the empty editor ignoring the mouse: a click on "Choose an image" did nothing, and a file dropped on the empty stage wasn't opened. The stage's canvas frame covered the drop zone, so only the keyboard and the toolbar's "Open image" worked. The Cancel button shown while an image opens was covered the same way, and now takes clicks too.
  
  Nothing changes in how the editor looks. If you worked around this with your own `z-index` or `pointer-events` on `.hm-image-stage-frame` or `.hm-image-stage-drop`, you can remove it.

## 0.3.0

### Minor Changes

- [#57](https://github.com/ie-huss-martinez/image-sdk/pull/57) [`7ea0d2d`](https://github.com/ie-huss-martinez/image-sdk/commit/7ea0d2d2fde2b69167dfe479f5afb5b234b5fb80) Thanks [@hussmartinez](https://github.com/hussmartinez)! - An image engine that loses worker-owned sources or a transferred canvas now becomes terminal. Processing rejects `WORKER_TERMINATED` with `details.reason: "engine-invalidated"`; explicitly recreate the engine, processor and session, plus any renderer and its DOM canvas, then reopen the image. React hosts must remount and replace supplied resources; custom-element hosts must create a new element instance. The editor shows a translatable recovery notice. Unsaved edits need host-managed preservation; no automatic reload, remount or re-decoding occurs.

### Patch Changes

- [#54](https://github.com/ie-huss-martinez/image-sdk/pull/54) [`ee00acc`](https://github.com/ie-huss-martinez/image-sdk/commit/ee00acc737a4e3a6f172da3bd3ec16dc85b89e88) Thanks [@hussmartinez](https://github.com/hussmartinez)! - `ImageSession.open()` and `export()` now apply `filePolicy.maxProcessingTime` (120 seconds by default), aborting with `PROCESSING_TIME_EXCEEDED` and limit details. Custom adapters must honor the supplied signal; arbitrary host adapters cannot be preempted.

- [#51](https://github.com/ie-huss-martinez/image-sdk/pull/51) [`22b2286`](https://github.com/ie-huss-martinez/image-sdk/commit/22b22867280133f4b34c5064723b7120b1ac1a4b) Thanks [@hussmartinez](https://github.com/hussmartinez)! - Fix crop handles in ImageEditor on right-to-left pages so each handle stays on the image edge it resizes.

- [#55](https://github.com/ie-huss-martinez/image-sdk/pull/55) [`fbcdb41`](https://github.com/ie-huss-martinez/image-sdk/commit/fbcdb4190762d3908dfc3a38306402592f50d149) Thanks [@hussmartinez](https://github.com/hussmartinez)! - `ImageEditor` and `createImageEngine` now accept relative `assetsUrl` values during server rendering without starting a worker. Asset URLs are validated at setup and resolved against the browser page only when the worker starts. The minimum `@hussmartinez/sdk-core` dependency is now `^0.4.4`.

## 0.2.0

### Minor Changes

- [#47](https://github.com/ie-huss-martinez/image-sdk/pull/47) [`a8f145b`](https://github.com/ie-huss-martinez/image-sdk/commit/a8f145b52115b0aabab588b78ddc855793e7782c) Thanks [@hussmartinez](https://github.com/hussmartinez)! - `<ImageEditor>` takes `features` and `theme` (docs/adr/0007).
  
  - **`features`** turns capabilities on and off: `adjust`, `filters` and `info`, the inspector's panels, and `export`, the Export tool and its dialog. Each is on unless it's `false`. With one panel on, the inspector shows it without a choice of panels. With `export` off, nothing in the editor exports, and the ref handle's `export()` still gives the host the file.
  - **`theme`**, `light`, `dark` or `system`, sets ui's colour mode on the editor's root. Unset, the editor follows the page's.

- [#46](https://github.com/ie-huss-martinez/image-sdk/pull/46) [`740c6e9`](https://github.com/ie-huss-martinez/image-sdk/commit/740c6e985a0d45fe7a57607edcaa3e428cbd8e5a) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The editor shows the stage's warnings and a new Info panel (docs/adr/0007).
  
  - **Notices:** the limits an opened image comes near, such as a large file or many frames, and, when it has a colour profile, that colours outside sRGB will be clipped in the exported file. They're polite notices at the foot of the stage, each with a Dismiss button. A dismissed notice shows again for another image that has it.
  - **`ImageInfoPanel`:** a third inspector panel, Info, with the image's upright size, format, frames and file size, the kinds of metadata it carries, and the fields kept on export. It never shows the file's name.
  - **`ImageSessionSource.fileSize`:** the opened file's size in bytes.

### Patch Changes

- [#42](https://github.com/ie-huss-martinez/image-sdk/pull/42) [`a5eb52a`](https://github.com/ie-huss-martinez/image-sdk/commit/a5eb52a9adef79b1f8e213bf082b0914b5703ffa) Thanks [@hussmartinez](https://github.com/hussmartinez)! - The editor shows a failed first open inside the empty stage's drop zone, under its text and by the button that retries, instead of as a banner over the drop zone's border. Over an open image, a failure is still a banner at the foot of the stage.

## 0.1.0

### Minor Changes

- [#3](https://github.com/ie-huss-martinez/image-sdk/pull/3) [`7204bfe`](https://github.com/ie-huss-martinez/image-sdk/commit/7204bfe2d000658d0f67ef4d4450e6897b73ad61) Thanks [@hussmartinez](https://github.com/hussmartinez)! - First release of `@hussmartinez/image-sdk`, an image SDK that works entirely in the browser: images are opened, edited and exported on the user's device and never uploaded.
  
  - **Package shape:** an ES module package with a server-safe headless core (`@hussmartinez/image-sdk`), a React entry (`@hussmartinez/image-sdk/react`), a custom element entry (`@hussmartinez/image-sdk/element`) and one stylesheet (`@hussmartinez/image-sdk/styles.css`), which applications import once. React and React DOM 18.3 or later are optional peer dependencies.
  - **Errors:** every failure is an `ImageError` with a stable `code`, such as `INVALID_IMAGE`, `UNSUPPORTED_FORMAT`, `DECODE_FAILED` or `IMAGE_TOO_LARGE`, and structured `details`. `isImageError(error, code)` checks one, across workers and copies of the package.
  - **Limits for untrusted files:** `imageLimits` adds `maxImagePixels`, `maxImageDimension`, `maxFrames`, `maxSessionSize` and `maxLayers` to the family's limits on file size, file count, decoded size and processing time, with defaults sized for images: 50 megapixels per image and 1 GB of decoded images. `maxImagePixels` has the same name and code as in `@hussmartinez/pdf-sdk`. Set them with a `filePolicy`; a misspelt limit name throws instead of being ignored.
  - **Translatable text:** `imageMessages` is the English catalogue for every error code and limit warning, for `createMessages` from `@hussmartinez/sdk-core`. Error text comes from the code and its details, never from the error's message.
  - **The layer plan:** `ImagePlan` is the editor's document: an image's crop in whole upright pixels, its own rotation and flips, the export's size, and the metadata fields to keep, over a source that's never modified. `createPlan(sourceId)` makes one, and `compositionSize`, `outputSize`, `sourceToComposition` and `compositionToSource` measure it and map points between the image and the result, for every rotation and flip.
  - **Edits as commands:** `image.setCrop`, `image.setOrientation`, `image.setOutput` and `image.setMetadata` are plain, cloneable commands. `createImageReducer` applies one and returns the command that undoes it, and rejects an invalid one with `INVALID_COMMAND` rather than correcting it.
  - **The image engine:** `createImageEngine()` probes files with the SDK's own readers and decodes them upright with the browser's decoder, in a worker that holds the sources, and checks every decode against the probe. Oriented files come out upright in every browser, even where the browser's decoder ignores a format's orientation. The worker is inlined by default; `assetsUrl` loads it from your own origin instead. `register` checks a file's own limits from your `filePolicy` against the engine's own probe before decoding, with `checkFileLimits`, which is exported for your own engines.
  - **Export:** `createImageProcessor(engine)` renders a plan in the engine's worker and encodes PNG, JPEG or WebP, in sRGB, after checking the output size against your `filePolicy`. A format the browser can't encode fails with `UNSUPPORTED_FORMAT` rather than saving mislabelled bytes. Exports carry only the metadata the user kept, title, description, artist and copyright, and never a location, camera details, timestamps, a thumbnail, a colour profile or an orientation.
  - **Develop and filters:** `image.setDevelop` adjusts the image's temperature, tint, exposure, highlights, shadows, contrast, saturation and vibrance, each from -100 to 100, and `image.setFilter` applies one of the `vivid`, `warm`, `cool`, `fade`, `mono`, `noir` and `sepia` presets at a strength from 0 to 100. They're the SDK's own pixel math, so they render the same in every browser and in the preview and the export, and they never change text, shapes or redactions drawn over the image.
  - **The preview:** `createImageRenderer(engine)` hands a page `<canvas>` to the engine's worker, which draws the plan into it, fitted, zoomed and panned at the device pixel ratio, through the same renderer as the export. Renders are coalesced: when edits arrive faster than they're drawn, only the latest is drawn, and a render in progress stops early.
  - **The session:** `createImageSession({ engine, processor })` holds one document: `open(file)` probes it, checks it against your `filePolicy` before decoding it and makes it the document, and the newest open always wins; `execute`, `group`, `undo` and `redo` edit the plan as undoable steps; and `export` returns the file with a summary of the metadata that was removed and the fields that were kept. Its snapshot suits `useSyncExternalStore`, and its `onEvent` events never carry file names, text or metadata values.
  - **The React editor:** `<ImageEditor>` from `@hussmartinez/image-sdk/react` opens an image from a drop zone or a button, shows it on a stage drawn in the worker, and has a toolbar to open, undo, redo, rotate and zoom, with the family's keyboard shortcuts while focus is inside it, using ⌘ on Apple devices once the page has hydrated, so a server-rendered editor hydrates without a mismatch. Its preview is announced to screen readers as an image with its size, and stays out of the tab order. `ImageEditorProvider`, `ImageStage`, `ImageToolbar` and the `useImageSession`, `useImageDocument`, `useImageView` and `useImageMessages` hooks build your own layout. Import `@hussmartinez/ui/styles.css` once before this package's stylesheet.
  - **Cropping:** `C`, or the crop button, shows the whole image with a crop frame over it. Drag the frame or its handles, or use the keyboard: arrows move it as you see it, Shift by 10 pixels, Alt to resize, Enter to apply and Escape to cancel. The crop panel has the same crop as number fields, with aspect presets from free and original to 16:9 and portrait. A whole crop is one undo step. Flip buttons mirror the image, and a host can hold the plan itself with the editor's `plan` prop.
  - **Adjust and Filters panels:** a slider per adjustment, each with a reset, and "Reset all"; and the filter presets with a strength slider. Dragging a slider, or holding a key on it, previews on the stage and is one undo step, and one `onChange`, when it ends; Escape cancels it. Hosts translate ui's text, such as the drop zone's, through the editor's `messages` too.
  - **The export dialog:** the toolbar's Export button opens a dialog with the format, a quality for JPEG and WebP, the size, and the details to keep (title, description, artist and copyright, which start empty). Before anything is written it summarises the output's size and format, the metadata the image carried that the file won't, and the fields kept. The export shows progress and can be stopped; then a Download button takes focus. Pass `onExport` to take the file yourself instead. `ImageExportDialog` builds your own layout.
  - **The `<hm-image-editor>` element:** `defineImageEditorElement()` from `@hussmartinez/image-sdk/element` registers it; importing the entry registers nothing, and does nothing on a server. It renders the editor into its light DOM, with the attributes `theme`, `locale` and `tools`, the properties `file`, `plan`, `filePolicy`, `assetsUrl`, `messages`, `engine` and `processor`, the methods `open`, `execute`, `export`, `undo` and `redo`, and the events `hm-image-editor-change`, `-event`, `-export` and `-error`, none of which carries a file name or contents. It needs React and React DOM, the package's optional peer dependencies.
  - **A portable plan format** (sdk-core ADR 0045): `toImagePlanDocument(plan, sources)` writes the plan as `hm-image-plan` version 1, plain JSON, and `readImagePlanDocument(json)` reads one back and checks it fully. Another format or a later version fails with `UNSUPPORTED_FORMAT`, and anything else wrong with `INVALID_DOCUMENT`, each with a `details.reason`. Commands are strict, and every `INVALID_COMMAND` carries a `details.reason` from `ImageCommandRejection`. JSON Schemas for the plan and the commands ship under `@hussmartinez/image-sdk/formats/`, and language-neutral conformance vectors are in the repository.
  - **Contracts for your own engines:** `ImageEngine` probes files, decodes them into sources upright, makes thumbnails and releases sources, and `ImageProcessor` renders and encodes a plan, writing only the metadata the user kept and never a location. Pass your own implementations to replace the SDK's.
