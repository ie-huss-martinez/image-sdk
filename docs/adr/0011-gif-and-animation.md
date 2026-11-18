# 0011. GIF: our own decoder, an animation in the plan, and export through a job worker

- **Status:** Accepted
- **Date:** 2026-11-17
- **Amends:** [ADR 0001](0001-image-engines.md), [ADR 0002](0002-workers-and-assets.md) and [ADR 0004](0004-image-limits.md), as "What this changes in earlier records" lists
- **Amended:** 2026-11-17, as the decoder was put behind opening a file: it and the probe open what browsers open where that's safe, under "What a malformed file does". The decoder was strict before, and the probe refused any file it couldn't walk to its trailer
- **Amended:** 2026-11-17, before the animation was built: it ships in 0.7.0, since 0.6.0 carried the decoder and the malformed-file fixes on their own; an animation ends at the frame before one that can't be decoded, decided when the file is opened, under "A later frame that can't be decoded"; and the reserved disposal methods' mapping is marked as read from decoders, not measured, until its test exists
- **Amended:** 2026-11-17, as the model was built: the format's ceiling of 4,096 frames and `too-many-frames`, which refusals are the schema's, the two commands that only undo, and that no command gives a plan an animation, under "The animation in the plan"
- **Amended:** 2026-11-17, as the frame store was built: the reserved disposal methods' mapping is measured, and how the cache is planned, under "What the worker holds"
- **Amended:** 2026-11-17, as the engine came to hold frames: how a source is registered with them, what it reports, and how a call names the frame it draws, under "Holding a source with its frames"
- **Amended:** 2026-11-18, as the session came to open animations: a file over `maxAnimationPixels` opens as its first frame with a notice, where this record refused it; and what the session does, under "Opening an animation in the session"
- **Amended:** 2026-11-18: `animations: false` keeps every file a still, under "Opening an animation in the session"
- **Amended:** 2026-11-18: one rule for an animation that can't be held. A file over `maxFrames` or, across its frames, `maxDecodedSize` opens as its first frame with a notice, as one over `maxAnimationPixels` does, where it was refused; under "An animation that can't be held opens as a still"

## Context

Releases up to 0.6.0 open a GIF as its first frame and can't write one. Up to 0.5.0 the probe walked every block of a GIF and counted its frames ([ADR 0001](0001-image-engines.md)), and the browser decoded the first; 0.6.0 decodes that frame with the decoder below. The animation, the timeline and writing a GIF are 0.7.0.

ADR 0001 decided the approach before any of it was built: our own strict decoder in the worker, and `gifenc` to encode. [ADR 0002](0002-workers-and-assets.md) decided a second worker for long jobs. This record fills in what those left open, and checks them against what has changed since:

- **Terminating the render worker now ends the session** ([ADR 0008](0008-terminal-engine-invalidation.md)). So an encode that must be stopped can't run there.
- **The plan has a place for an animation** ([ADR 0009](0009-scene-space-layers-and-plan-versions.md)): `animation`, `null` until format version 4.
- **Redaction sanitises every bitmap before it's drawn** ([ADR 0010](0010-redaction.md)), and a frame is a bitmap.

A GIF is hostile input twice over. Its size on disk says little about its decoded size: 300 frames of 1000 × 1000 are 1.2 GB of pixels from a few megabytes. And its compressed data is a code stream that a decoder must not trust.

## Decision

### Decoding: our own decoder, for every GIF

- **The render worker decodes GIFs with the SDK's own code,** written in TypeScript, with no third-party parser. That includes a GIF with one frame, so there's one path, and `createImageBitmap` never sees a GIF.
- **The probe's walk becomes the frame table.** For each frame it records the rectangle, the delay, the disposal, the transparent colour, whether it's interlaced, and where its colour table and data are. It also reads the loop count from the `NETSCAPE2.0` or `ANIMEXTS1.0` extension. The table is bounded: a file with more than 4,096 frames is refused with `TOO_MANY_FRAMES` whatever the file policy says, as AVIF's tiles are capped at 1,024 ([ADR 0001](0001-image-engines.md)).
- **LZW decodes a frame whole, or refuses it.** A frame's code stream must hold every pixel of its rectangle. The decoder's table has at most 4,096 entries, as the format allows, and its output buffer is the rectangle's size, which the probe already checked against the logical screen. So no allocation is sized by the code stream.
- **Composition follows GIF89a:** each frame is drawn over the logical screen, skipping its transparent colour, and any pixel that names a colour its table doesn't have. Disposal 0 and 1 keep the result, 2 clears the frame's rectangle, and 3 restores what was there before the frame. The screen starts transparent, and "clears" means to transparent, whatever background colour the file names. Browsers are expected to do the same, and the capability matrix gains a row that measures it before the decoder relies on it ([ADR 0001](0001-image-engines.md)).
- **Values are kept as the file has them:** a delay in hundredths of a second from 0 to 65,535, including 0, and a loop count that's absent (play once), 0 (for ever) or a number of repeats.
- **It's hostile-input code,** held to ADR 0001's bar: fixtures written by hand, truncated at every byte offset; random bytes; corrupted code streams; a property-based fuzz test that mutates valid files; and a fixed time for each case to settle with a result or `INVALID_IMAGE`. The decoder is pure, so these run in Node as well as in the three engines.

### What a malformed file does

Many GIFs in use are malformed, and browsers show them. A decoder that refused every one would turn "this file has an error" into "my GIF won't open", for files that open everywhere else. So the probe and the decoder were measured against `createImageBitmap` in Chromium, Firefox and WebKit, defect by defect, and they follow one rule: **open a file when browsers open it and what to show isn't in doubt; refuse it when showing it would mean inventing or dropping pixels of the frame being shown.**

- **A frame is whole or it isn't shown.** Data that ends before a frame's last pixel, or uses a code that isn't defined yet, is `INVALID_IMAGE`. Chromium refuses these; Firefox shows a truncated frame with the missing part made up, and WebKit an empty image. A partial frame is never drawn.
- **Nothing after a frame's last pixel is read.** More pixels than the rectangle holds, codes after them, a missing end code and bytes after the end code are ignored: every browser shows the frame.
- **The file's frames end where it stops being a GIF,** once it has one whole frame: at the trailer, at the end of the file with no trailer, at a block cut short, at a block that isn't one, or at a frame the format doesn't allow (outside the screen, or with a code size out of range). The frames before that point are the file, and nothing after it is read. Chromium and Firefox show such a file's first frame in every case measured; WebKit does in most, and shows an empty image in the rest. The probe counts only those frames, so the bounds are for exactly what the decoder reads, and the decoder checks that its table is the one the probe walked.
- **A file with no whole frame is `INVALID_IMAGE`.**
- **A colour that isn't there isn't drawn.** A pixel that names a colour past the end of its table is left as it was, like a transparent one, and a frame with no table at all, neither its own nor the file's, draws nothing. Browsers open these, and each draws something else: black in Chromium, another colour of the table in Firefox, nothing in WebKit. Drawing nothing invents no colour.
- **The reserved disposal methods are read as browsers read them:** 4 as 3, and 5 to 7 as "keep". It's measured: a file whose later frames depend on each method from 0 to 7 is composed by our decoder and by each engine's `ImageDecoder`, and every frame is the same in Chromium, Firefox and WebKit. The mapping was first taken from reading Chromium's and Firefox's decoders, when 0.6.0 showed only the first frame; the test that replaced that reading is `frames.browser.test.ts`.
- **A code size of 1 is read,** as files with two colours have it, though the format says 2 to 8. Chromium reads it the same way; Firefox refuses such a file, and WebKit shows it empty.
- **A first frame at the screen's corner that covers it is the screen.** When the first frame is at 0, 0 and at least as wide and as tall as the logical screen, the image is that frame alone, at the frame's size, and later frames are held to it. Every browser shows exactly that. The probe reports the frame's size, so the limits are checked against what's decoded.
- **Still refused:** any other first frame outside the logical screen, where browsers don't agree on the image's size (wider than the screen but not as tall, or away from its corner: Chromium makes one size of it, Firefox and WebKit another); a screen with no pixels, which every browser refuses; and a first frame with a code size of 0 or above 8, which would name colours past 255.
- **Bytes after the trailer** were always ignored.

What this costs is that a truncated animation opens shorter than it was made. From 0.7.0 the editor says so: see "A later frame that can't be decoded".

These rules are held by tests in the three engines: each defect opens as exactly the sound file's first frame, and a corpus of 80 files from other decoders' test suites (`test/fixtures/gif-corpus`), of which 71 open as the frame the browser draws and 9 are refused, each for a reason the test names.

### A later frame that can't be decoded

The frame table ends where the file stops being a GIF, and the probe counts the frames before that. But a frame can be whole in the table and still not decode: its data holds fewer pixels than its rectangle, or uses a code that isn't defined. Only decoding finds that, and 0.6.0, which shows the first frame, never decodes the others.

- **An animation ends at the frame before the first one that can't be decoded.** It's the rule the frame table already follows, one step later: the frames before the damage are the file. Dropping only the bad frame and keeping those after it would compose them over a screen the file never described.
- **It's decided when the file is opened.** Registering an animated source decodes every frame once, in order, composing as it goes, and stops at the first that fails. The source's `frames` is the count that decoded, and the plan's `animation` lists exactly those. The probe's count stays what it was, the bound the limits were checked against: it can only be the same or larger. So a plan never names a frame that can't be drawn, a timeline never shows one, and an export can't fail half way on a frame that was always bad.
- **What that pass costs** is one decode of each frame, with one screen held. It's bounded before it starts by `maxFrames`, `maxAnimationPixels` and `maxDecodedSize`, and it runs under the open's `withProcessingTime`. It fills the frame cache as it goes, so it isn't work thrown away. A first frame that can't be decoded is still `INVALID_IMAGE`: there's nothing to show.
- **Measured:** 200 frames of 800 × 600, each a whole frame of 256 colours, through this decoder on the page's thread of each pinned engine, on a 12-core desktop that was running other work:

  | Content | File | Chromium | Firefox | WebKit | First frame |
  |---|---|---|---|---|---|
  | A dithered gradient with noise, the worst case for LZW: a video clip | 91 MB | 2.4 to 2.8 s | 1.6 to 3.0 s | 1.3 to 1.4 s | 15 to 44 ms |
  | Flat areas with a moving box: a screen recording | 1.7 MB | 0.9 to 1.0 s | 0.7 s | 0.5 to 0.9 s | 4 to 25 ms |

  That's 7 to 15 ms a frame for the worst content and 3 to 5 ms for flat content, and no single frame took over 30 ms. Reading the frame table took under 15 ms. The largest animation the default limits allow is 250 million pixels across its frames (`maxDecodedSize`, 1 GB), 2.6 times this one: about 4 to 8 s of the worst content on this machine. A phone hasn't been measured, and should be assumed several times slower; `maxProcessingTime` (120 s) is the ceiling either way. These are a desktop's numbers, to be measured again on phones with `maxAnimationPixels`.
- **So the open stays responsive, by design and not by being fast:**
  - **The first frame shows as soon as it's decoded,** not after the last. The stage draws it while the rest are checked, with the tools disabled: the image is there in tens of milliseconds, and it can't be edited until the open is done, because the plan doesn't exist yet.
  - **The open reports progress:** frames decoded of the total, from the worker through `sdk-core`'s call progress ([sdk-core ADR 0018](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0018-worker-rpc-protocol.md)). The session's snapshot carries it while `status` is `"opening"`, as `progress: { done, total } | null`, `null` for a still. The stage shows it as a progress bar with a name and the count in words, "Checking frames: 40 of 200", in place of the spinner. It's announced when it starts and when the image is open, not at each step.
  - **It can be cancelled like any open:** the same Cancel button beside the progress, and opening another file. The worker checks its signal between frames, so a cancel is answered within one frame's decode. A cancelled open leaves the document that was open as it was, as today.
  - **The worker stays answerable:** it yields to its messages between frames, as develop does between strips ([ADR 0006](0006-develop-and-filters.md)), so the document still open keeps rendering while another file is checked.
- **What a user sees for a large animation near the limits:** the first frame at once; a progress bar that moves for some seconds, or tens of seconds on a slow phone, with Cancel beside it; then the timeline. If the processing time runs out, `PROCESSING_TIME_EXCEEDED`, with its text from the catalogue, and the document that was open stays. Above `maxFrames`, `maxDecodedSize` across its frames or `maxAnimationPixels`, the file opens as its first frame, with a notice, and none of this starts. Between a limit's warning and its maximum, the open's warning says the animation is large, as for a large still.
- **The editor says so.** A source records whether its file's frames ended early, either way: before its trailer, or at a frame that couldn't be decoded. `ImageSourceInfo` gains `incomplete: boolean` for it, `false` for every still. When it's `true`, the editor says, once, at open and in the Info panel, that the file is damaged and how many frames opened, in text from the catalogue. It's information, not an error: the image is open and can be edited and exported.
- **The usage event** for an open carries nothing new: no file name, no frame count.
- **Tests:** a file whose third frame is short opens as two frames in the three engines, with `incomplete` set and the notice shown; the same for a file with no trailer; a sound file has neither. The plan, the timeline and the export of such a file hold exactly the frames that decoded. An open of many frames shows its first frame and its progress before it's done; cancelling it mid-way leaves the earlier document open and usable, and the worker answers a render of that document while the check runs.

### Holding a source with its frames

- **A source is a still unless it's registered with its frames.** `engine.register` takes `frames: "first" | "all"`, and `"first"` is the default: the file's first frame, held as before. So an animated file can still be opened as a still, which is what a file over `maxAnimationPixels` gets, and what a host that doesn't want animations asks for. With `"all"`, a GIF of several frames is held with every frame that decodes; a file of one frame is a still either way, and so, for now, is any other format.
- **What a source says of itself:** `frames` is how many frames it holds, 1 for a still; `timing` is the file's loop count and each held frame's delay, `null` for a still; `incomplete` says the file's frames ended early; and `decodedBytes` is what the worker holds for it: for a source with its frames, its first frame's bitmap, the file's bytes, one screen and the frame cache at its fullest, not every frame.
- **Progress is one report for each frame checked,** as the fraction of the frames the file lists, through `register`'s `onProgress`. The first report comes when the first frame has decoded. A file whose frames end early stops short of 1, and the call's last report is 1 as it resolves.
- **A call names the frame it draws by its place in the plan:** `frame` on an export's job and on a render's view is an index into the plan's `animation.frames`, 0 when omitted. The frame shown is view state, so it's on the view with the zoom. A frame the plan doesn't have is a `RangeError`, found on the page.
- **The worker draws a frame from a bitmap of its own for that call,** made from the frame store's screen and closed when the call ends, with what a redaction kept of it. Two calls can then draw two frames at once, such as an export of one frame while the preview shows another. The source's first frame keeps the bitmap it was registered with.
- **A plan with an animation is drawn only over a source that holds its frames.** Over a still, or naming a frame the source doesn't hold, it's `UNSUPPORTED_PLAN` with `animation`: drawing the first frame instead would show what the plan doesn't say ([ADR 0009](0009-scene-space-layers-and-plan-versions.md)).
- **Tests:** in the three engines, through the real engine and worker, every frame of a plan exports as the browser's `ImageDecoder` composes it, in any order, reordered, repeated and cropped; the preview draws the view's frame; a file with a bad frame holds the frames before it and never draws past them; a registration is cancelled while its frames are checked and the engine goes on working; and another call is answered while a check runs.

### Opening an animation in the session

- **The session decides, from the probe.** A file of several frames whose screen is within `maxAnimationPixels` is registered with all its frames; any other is registered as before. So the engine's check of every frame runs only for a file that will be an animation.
- **A host can ask for stills only:** `animations: false` on the session, the editor and the element, `true` when omitted. Then every file is registered as before, and an animated one says it's open as its first frame. It's an option of its own because a limit used as a switch is a trap: `maxAnimationPixels` says how large an animation may be, and setting it to almost nothing to mean "never" would read as a limit and warn as one.
- **The plan it makes** plays the source's frames in order, with the file's delays and loop count, under the keys `frame-1`, `frame-2` and so on. A source that holds one frame, because the file has one, is too large, isn't a GIF, or lost every frame after its first, gets a still's plan.
- **The snapshot says how the open is going:** `progress` is the frames checked of those the file lists, while an animation is being opened, and `null` otherwise. The stage shows it as a progress bar named for the open, with the count in words, and Cancel beside it.
- **A source says what the file had:** `fileFrames` is the frames the file lists, beside `frames`, the frames held. An animated file open as a still has more of the first than the second.
- **The snapshot's warnings name `maxAnimationPixels`** both when an animation is near it and when a file is over it and so open as a still. The editor tells the two apart by whether the source holds its frames, and says "This animation is too large to edit as an animation. Its first frame is open as a still image." for the second.
- **Notices, not errors:** a file whose frames ended early says so, with how many opened; an animated PNG or WebP, which still opens as its first frame, now says that too. Each can be dismissed, as the other notices can.
- **What an animation holds counts against `maxSessionSize`** once it's registered, when it's known: over it, the open fails with `SESSION_TOO_LARGE` and the document that was open stays.
- **`maxFrames` applies to commands that add frames,** as it does to layers: only a step that adds is checked, so a plan already over a lowered limit can still be trimmed.
- **A host's plan can change an animation, in one step:** frames added, removed, reordered and retimed, and the loop count. It can't make a still play or an animation a still, and a frame can't show another frame of the source under the same key: no command does either, so `applyPlan` refuses them, as `not-animated`, `no-frames` and `duplicate-key`.
- **An export to PNG, JPEG or WebP takes a `frame`,** the frame being shown, 0 when omitted.
- **Not yet, and coming with the timeline:** the first frame shown on the stage while the rest are checked, and the Info panel's line for a file that was incomplete. Until then the stage shows the progress bar alone.
- **Tests:** through the editor, in the three engines: an animation over `maxAnimationPixels` opens as a still with its notice and exports; one near it opens as an animation with a warning; a damaged one says how many frames opened; and a long one shows its progress, with the count in words, and is cancelled from the button beside it, leaving nothing open and nothing shown as failed.

### An animation that can't be held opens as a still

There's one rule: **an animation the SDK can't hold opens as its first frame, a still, and says so.** It's never refused for being an animation.

- **Three limits say whether an animation can be held:** `maxFrames`, its frames; `maxDecodedSize`, what its frames could decode to; and `maxAnimationPixels`, its screen. The fixed ceiling of 4,096 frames counts as `maxFrames`, whatever a policy allows. Over any of them the session registers the file as its first frame, and the snapshot's warnings name the limits it was over.
- **Up to 0.6.0 the first two refused the file,** with `TOO_MANY_FRAMES` or `DECODED_SIZE_TOO_LARGE`, from the probe, though only its first frame was ever shown. So this opens files that didn't open: a GIF of 400 frames, or one whose frames would decode to more than 1 GB, now opens as its first frame.
- **A still is held to a still's limits.** Held as its first frame, a file counts one frame against `maxFrames` and one frame's pixels against `maxDecodedSize`; `maxFileSize`, `maxImagePixels` and `maxImageDimension` apply as to any file. A file whose first frame alone is over a limit is refused, as before.
- **The engine does the same, by what it's asked.** `register` with `"first"`, the default, counts one frame, and reads no further than the first frame of a GIF, so the frame table's ceiling doesn't apply to a still. With `"all"` it counts every frame and refuses a file over a limit with that limit's code: the session never asks for one. `checkFileLimits` takes the same choice, and counts every frame when it isn't told, as it did.
- **The same for a layer:** an image added as a layer is a still, so an animated file over these limits can be added as its first frame.
- **Animated PNG and WebP** were always stills. Over `maxFrames` they were refused too, and now open as their first frame like the rest.
- **One notice says why,** whichever limits the file is over: "This animation is too large to edit as an animation. Its first frame is open as a still image."
- **Tests:** in the three engines, through the real engine and the real editor: a file over each limit, and over all three, opens as a still with the one notice and exports; a file of 4,097 frames opens as its first frame; the engine refuses the same files only when asked for all their frames; and a file whose first frame alone is over a limit is refused.

### What the worker holds

- **Never every frame.** For an animated source the worker holds the compressed file, the frame table, the screen as it stands, a copy for disposal 3 when a frame uses it, and a cache of composed frames bounded at 64 MiB.
- **Any frame can be reached.** Playing forward decodes one frame at a time. Jumping decodes forward from the nearest cached frame; the cache keeps frames spaced so that a jump is a bounded number of decodes.
- **The cache is planned from the file, before anything is decoded.** What it holds for a frame is a snapshot to go on from: the screen, and for a frame that restores what was under it (disposal 3), that too, so at most two screens. The spacing is the smallest that keeps every snapshot within the 64 MiB: 1 when there's room for every frame, more for a larger file, and none at all for a screen too large to hold once, which then goes back by playing again from the start. Once a stretch has been played, a jump into it costs fewer decodes than the spacing.
- **`maxAnimationPixels`** is new: the logical screen of an animation holds at most 8 megapixels, with a warning at 2. An animation's working set is several screens, so it needs a lower ceiling than a still's 50 megapixels. **It isn't a limit on what opens.** A file over it opens as its first frame, a still, as every animated file did before 0.7.0, and the editor says why; refusing it would stop files opening that open today. The session decides from the probe, before decoding, and registers such a file as its first frame. The engine, asked directly for all the frames of such a file, refuses with `ANIMATION_TOO_LARGE`. Like the other limits, the number is a starting value until it's measured on phones.
- **`maxFrames` and `maxDecodedSize` keep their numbers.** They bound the work an animation can cause: frames × the screen's pixels × 4 bytes. What changes is what happens over them: see "An animation that can't be held opens as a still".
- **`maxSessionSize` counts what's held, not what's possible.** An animated source counts as its screens in memory plus the cache's ceiling, not as every frame.
- **Each decode runs under `withProcessingTime`,** checks its `AbortSignal` between frames, and yields to the worker's messages, as develop does between strips ([ADR 0006](0006-develop-and-filters.md)).

### The animation in the plan

From format version 4 ([ADR 0009](0009-scene-space-layers-and-plan-versions.md)):

```ts
interface ImageAnimation {
  loop: number | null;             // null: once; 0: for ever; n: that many repeats
  frames: readonly ImageFrame[];   // in the order they play, at least one
}
interface ImageFrame {
  key: string;
  frame: number;                   // a frame of the base's source
  delay: number;                   // hundredths of a second, 0 to 65,535
}
```

- **A plan is animated when `animation` isn't `null`.** Opening a file with more than one frame gives a plan whose `animation` lists every frame with its delay and the file's loop count. A still's is `null`.
- **Frames refer to the source; they don't hold pixels.** Reordering, duplicating and deleting change the list only. Two frames may show the same source frame.
- **Everything else in the plan applies to every frame:** the crop, the orientation, develop and the filter, the layers and the redactions. There are no per-frame layers.
- **Commands,** from the keyed-list reducer, each with an exact inverse:

  | Command | Changes |
  |---|---|
  | `image.insertFrames { at, frames }` | Inserts frames, such as duplicates |
  | `image.removeFrames { keys }` | Removes frames. Removing the last one is refused, as `no-frames` |
  | `image.moveFrames { keys, to }` | Moves frames to an index |
  | `image.reverseFrames` | Reverses the order. It's its own inverse |
  | `image.updateFrames { updates: [{ key, props }] }` | Sets delays |
  | `image.setLoop { loop }` | Sets the loop count |

- **Trimming is removing frames,** and setting every delay is one `image.updateFrames`, so each is one undo step.
- **Two more commands exist only to undo:** `image.restoreFrames` puts removed frames back at their indexes, and `image.setFrameOrder` sets the whole order, as for layers and redactions ([ADR 0009](0009-scene-space-layers-and-plan-versions.md)). They aren't in the portable format.
- **`image.updateFrames` sets a frame's delay and nothing else.** Which frame of the source a frame shows is what it is: to show another, insert a frame.
- **No command gives a plan an animation, or takes it away.** A plan is animated from the file it was opened from. So a host can't make a still play, and an animation trimmed to one frame is still an animation, which exports as a GIF of one frame.
- **Rejections** add `unknown-frame`, `invalid-frame` (a frame the source doesn't have), `invalid-delay`, `invalid-loop`, `no-frames`, `too-many-frames` and `not-animated` (frame commands on a plan whose `animation` is `null`, or, in a document, an `animation` over a source with one frame).
- **Which of those the schema sees:** `invalid-delay` and `invalid-loop`, as it sees a level out of range. An empty list of frames in a document, or one over the ceiling, is the schema's too, so it's `malformed-document`; `no-frames` is only for a command that would remove the last frame, which depends on the plan.
- **An animation lists at most 4,096 frames,** the format's ceiling and the most the decoder keeps a table of: `MAX_ANIMATION_FRAMES`, with `too-many-frames` for a command that would pass it. The file policy's `maxFrames` applies below it.
- **Keys are unique among layers, redactions and frames,** as ADR 0009 said they would be.
- **`maxFrames` applies to the plan too,** on each command that adds frames, so duplicating can't pass what opening allows.
- **In a document,** each source gains `frames`, from 1 to 4,096, and the migration from version 3 sets it to 1. A version 3 document is read with what version 3 had: a frame count or an animation in one is refused. The reducer learns a source's frame count the way it learns its size, from the function it's created with; a source that gives none has one frame.
- **The frame being shown is view state,** like zoom: outside the plan and the history. The renderer's and the processor's calls take it.
- **Making a GIF from several stills** isn't in this record. It needs frames from different sources, each fitted to one size, and comes after 0.7.0 with its own format version.

### Encoding: `gifenc`, in a job worker

- **`gifenc` 1.0.3** (MIT, by Matt DesLauriers) is pinned exactly, bundled into the job worker and credited in `NOTICE`. Its published package was read for this record: one ES module of 9.1 kB, no dependencies, and no `eval`, `Function`, `import()`, `importScripts` or network call ([sdk-core ADR 0028](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0028-third-party-engines.md)). It was last published in 2022. That's acceptable for an encoder that only ever sees pixels the SDK rendered, never bytes from a file; if it needs a fix nobody ships, the encoder is small enough to replace with our own.
- **Every frame is written whole.** A frame is the plan rendered at that frame, at the output's size, through the one renderer ([ADR 0003](0003-layer-plan-document-model.md)). It's quantised to its own palette of at most 255 colours, with index 0 kept for transparency: a pixel under half opaque becomes transparent, and no opaque pixel maps to index 0. Each frame clears the screen before the next (disposal 2). So no frame depends on the one before, transparent areas never show a ghost, and nothing a redaction destroyed in one frame can come back through another ([ADR 0010](0010-redaction.md)).
- **The cost of whole frames is size.** A GIF that stored only what changed between frames can come out larger than it went in. The export summary shows the size, as for every format. Writing only what changed is a later record, and would have to keep ADR 0010's property.
- **Timing is written as the plan has it:** each frame's delay, and the loop count, with no extension when it's `null`.
- **A still plan exports to GIF as one frame.** An animated plan exports to PNG, JPEG or WebP as the frame being shown.
- **Bounded before it starts.** An export of frames × output pixels × 4 bytes over `maxDecodedSize` is refused with `DECODED_SIZE_TOO_LARGE`, the bound that applies to opening. The output's size is checked as for any export ([ADR 0004](0004-image-limits.md)).

### The job worker

[ADR 0002](0002-workers-and-assets.md) decided it; this is how it works.

- **It encodes, and holds no session data.** The render worker renders each frame; the job worker quantises it and writes it.
- **Frames cross the page, one at a time.** `sdk-core`'s workers talk only to the page. So the processor, on the page, asks the render worker for a frame, receives its pixels as a transferred buffer, and transfers that buffer on to the job worker in the same step. It asks for the next frame only when the job worker has taken the last. The page never reads a frame, never makes a view of one, and holds none after handing it on: transferring leaves the page's buffer empty.
- **Why not encode in the render worker:** stopping an encode that doesn't answer means terminating its worker, and terminating the render worker ends the session ([ADR 0008](0008-terminal-engine-invalidation.md)). The job worker can be terminated at any time and costs nothing: the next export starts another. ADR 0008's states and guards apply to the render worker only.
- **Cancelling** is checked between frames. A job worker that doesn't acknowledge within `sdk-core`'s grace period is terminated ([ADR 0018](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0018-worker-rpc-protocol.md)). The whole export runs under `maxProcessingTime` and reports progress by frame.
- **Lifetime and assets:** it starts on the first GIF export and stops after `sdk-core`'s idle timeout. It's inlined by default, and `image/job.worker.js` under `assetsUrl` when self-hosted, with the same version check as the render worker. The Content Security Policy is the one ADR 0002 gives: no new directive.
- **An export's peak** is the sources' working set, one output canvas and one frame in the render worker; one frame in transit; and one frame, its indexed copy and the file so far in the job worker.

### Playing in the editor

- **Nothing plays on its own.** An animated image opens paused on its first frame. Play, pause and a frame scrubber are controls with names, and `Space` plays and pauses when the timeline has focus. That meets WCAG 2.2's [2.2.2 Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html) for everyone, and so needs nothing more for people who prefer reduced motion.
- **Playback honours the plan's timing,** and stops after the loop count. A delay under 2 hundredths of a second is shown as 10, as browsers show it. The plan and the export keep the value.
- **The timeline is a list with one tab stop.** Each frame is an item named by its position and delay. Moving, duplicating and deleting have buttons, and each is announced.
- **Frame thumbnails come from the renderer,** so they show the plan: cropped, developed and redacted. `engine.thumbnail` shows the source ([ADR 0010](0010-redaction.md)).
- **Flashing content** is the user's own image, and the editor can't make it safe. Not playing until asked is what it can do.

### Tests

- **Decoding, against fixtures written by hand:** each disposal method; disposal 2 and 3 over transparent and opaque areas; a transparent colour; interlacing; a frame smaller than the screen; a local colour table; delays of 0, 7 and 65,535; and an absent, an infinite and a finite loop count. Every frame's pixels are checked.
- **Agreement with the browser:** for the fixtures browsers animate, the decoder's first frame equals `createImageBitmap`'s, in each engine. And every frame equals the one each engine's `ImageDecoder` composes: for each disposal method from 0 to 7, for written animations, and for the 36 animations of the corpus, 144 frames, except two files whose frames have no colour table.
- **The cache:** with a cache that holds one frame, every frame decodes to the same pixels as with a large one, forward and at random.
- **Hostile input:** as "Decoding" lists, and the limits: a screen over `maxAnimationPixels`, a file over `maxFrames`, and one over the fixed 4,096.
- **Round trip:** an exported GIF is decoded again by our decoder, and its frame count, order, size, delays, loop count and transparency are the plan's. A frame that goes from opaque to transparent leaves no ghost.
- **Editing:** after each timeline command and its undo, the export's frames are the expected ones.
- **Redaction** ([ADR 0010](0010-redaction.md)): the byte-for-byte test, with the difference inside the region in every frame, and with it in one frame only, where the frames before and after must not carry it.
- **The frame path:** with recording clients, the page's buffer is empty after each hand-off, at most one frame is in transit, and no page code reads one.
- **Cancelling and the deadline:** an export cancelled mid-way leaves the session usable; a job worker that never answers is terminated and the next export works.
- **No request:** the inline and self-hosted modes export a GIF with no request beyond the worker's own file.

### Size budgets

The decoder joins the render worker, within the 28 kB [ADR 0009](0009-scene-space-layers-and-plan-versions.md) expects. The job worker gets its own budget, expected at about 8 kB, set from its measured size in the pull request that adds it.

### What this changes in earlier records

- **[ADR 0001](0001-image-engines.md):** a GIF is no longer decoded by `createImageBitmap`, even a still one, from 0.6.0, and from 0.7.0 it opens as an animation. Animated PNG and WebP still open as stills. Its probe no longer needs every block up to a trailer, and takes a first frame that covers the screen as the image's size: ADR 0001 refused that file because the browser's decode would have been larger than the bound, and now the bound is the frame's and the decoder is ours.
- **[ADR 0002](0002-workers-and-assets.md):** its test that no message between the page and the render worker carries a pixel buffer gains one exception beside an export's `Blob`: a GIF export's frames, transferred through the page one at a time and never read there.
- **[ADR 0004](0004-image-limits.md):** `maxAnimationPixels` joins the limits, and an animated source counts against `maxSessionSize` as what the worker holds.

## Alternatives considered

- **WebCodecs' `ImageDecoder`:** the browser's own decoder, with nothing to maintain. But the SDK must walk every block anyway to bound the file before anything decodes it; `ImageDecoder` keeps its own frames, outside the memory the session counts; it reports a duration, not the file's delay, and doesn't tell an absent loop count from an infinite one; and engines differ in what they compose. Our decoder is a few hundred lines that give the same pixels everywhere, and run in Node tests.
- **A third-party GIF parser,** as the replaced application used: more untrusted-input code from outside, for a format whose block structure the probe already reads.
- **Holding every decoded frame:** the simplest random access, and 1.2 GB for a file the limits allow.
- **Encoding in the render worker:** one worker and no frames through the page, but an encode that hangs could only be stopped by ending the session.
- **A channel straight from the render worker to the job worker:** frames would never touch the page. `sdk-core`'s worker protocol has no way to pass one today. If it gains one, this record's frame path changes and its exception to ADR 0002 goes.
- **Our own encoder:** no dependency, but colour quantisation is where a GIF's quality is decided, and `gifenc`'s is good and small.
- **Writing only the changed part of each frame:** smaller files, but each frame would depend on the last, which is how ghosts and unredacted pixels survive.
- **Per-frame layers:** captions that change over time. That's a timeline for every layer, which ADR 0003 leaves to a later record.

## Consequences

- **A GIF opens, edits and exports as an animation,** with its timing kept exactly.
- **A hostile GIF is bounded three ways before it's decoded:** by its frames, by its screen, and by the total it could decode to. The decoder trusts nothing in its code stream.
- **A malformed GIF that browsers show opens here too,** as its whole frames, and one that can't be shown whole is refused with what was wrong.
- **Memory for an animation is a few screens and a bounded cache,** whatever the number of frames.
- **The SDK has its first bundled third-party code,** `gifenc`, and a `NOTICE` file with it.
- **There are two workers,** and a self-hosting application serves both files.
- **Exported GIFs can be larger than their sources,** because every frame is whole.
- **Frames pass through the page during a GIF export,** transferred and unread. A test holds that line.
