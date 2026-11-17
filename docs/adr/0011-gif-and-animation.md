# 0011. GIF: our own decoder, an animation in the plan, and export through a job worker

- **Status:** Accepted
- **Date:** 2026-11-17
- **Amends:** [ADR 0001](0001-image-engines.md), [ADR 0002](0002-workers-and-assets.md) and [ADR 0004](0004-image-limits.md), as "What this changes in earlier records" lists

## Context

Releases up to 0.5.0 open a GIF as its first frame and can't write one. The probe already walks every block of a GIF and counts its frames ([ADR 0001](0001-image-engines.md)), but nothing decodes them.

ADR 0001 decided the approach before any of it was built: our own strict decoder in the worker, and `gifenc` to encode. [ADR 0002](0002-workers-and-assets.md) decided a second worker for long jobs. This record fills in what those left open, and checks them against what has changed since:

- **Terminating the render worker now ends the session** ([ADR 0008](0008-terminal-engine-invalidation.md)). So an encode that must be stopped can't run there.
- **The plan has a place for an animation** ([ADR 0009](0009-scene-space-layers-and-plan-versions.md)): `animation`, `null` until format version 4.
- **Redaction sanitises every bitmap before it's drawn** ([ADR 0010](0010-redaction.md)), and a frame is a bitmap.

A GIF is hostile input twice over. Its size on disk says little about its decoded size: 300 frames of 1000 × 1000 are 1.2 GB of pixels from a few megabytes. And its compressed data is a code stream that a decoder must not trust.

## Decision

### Decoding: our own decoder, for every GIF

- **The render worker decodes GIFs with the SDK's own code,** written in TypeScript, with no third-party parser. That includes a GIF with one frame, so there's one path, and `createImageBitmap` never sees a GIF.
- **The probe's walk becomes the frame table.** For each frame it records the rectangle, the delay, the disposal, the transparent colour, whether it's interlaced, and where its colour table and data are. It also reads the loop count from the `NETSCAPE2.0` or `ANIMEXTS1.0` extension. The table is bounded: a file with more than 4,096 frames is refused with `TOO_MANY_FRAMES` whatever the file policy says, as AVIF's tiles are capped at 1,024 ([ADR 0001](0001-image-engines.md)).
- **Strict LZW.** A frame's code stream must decode to exactly its rectangle's pixels. A code that isn't defined yet, more pixels than the rectangle holds, fewer, or data that ends early is `INVALID_IMAGE`. The decoder's table has at most 4,096 entries, as the format allows, and its output buffer is the rectangle's size, which the probe already checked against the logical screen. So no allocation is sized by the code stream.
- **A frame with no colour table,** neither its own nor the file's, is `INVALID_IMAGE`. So are the reserved disposal methods, as today.
- **Composition follows GIF89a:** each frame is drawn over the logical screen, skipping its transparent colour. Disposal 0 and 1 keep the result, 2 clears the frame's rectangle, and 3 restores what was there before the frame. The screen starts transparent, and "clears" means to transparent, whatever background colour the file names. Browsers are expected to do the same, and the capability matrix gains a row that measures it before the decoder relies on it ([ADR 0001](0001-image-engines.md)).
- **Values are kept as the file has them:** a delay in hundredths of a second from 0 to 65,535, including 0, and a loop count that's absent (play once), 0 (for ever) or a number of repeats.
- **It's hostile-input code,** held to ADR 0001's bar: fixtures written by hand, truncated at every byte offset; random bytes; corrupted code streams; a property-based fuzz test that mutates valid files; and a fixed time for each case to settle with a result or `INVALID_IMAGE`. The decoder is pure, so these run in Node as well as in the three engines.

### What the worker holds

- **Never every frame.** For an animated source the worker holds the compressed file, the frame table, the screen as it stands, a copy for disposal 3 when a frame uses it, and a cache of composed frames bounded at 64 MiB.
- **Any frame can be reached.** Playing forward decodes one frame at a time. Jumping decodes forward from the nearest cached frame; the cache keeps frames spaced so that a jump is a bounded number of decodes.
- **`maxAnimationPixels`** (`ANIMATION_TOO_LARGE`) is new: the logical screen of a file with more than one frame holds at most 8 megapixels, with a warning at 2. An animation's working set is several screens, so it needs a lower ceiling than a still's 50 megapixels. It's checked from the probe, before decoding, with the other per-file limits ([ADR 0004](0004-image-limits.md)). Like them, it's a starting value until it's measured on phones.
- **`maxFrames` and `maxDecodedSize` are unchanged.** They bound the work a file can cause: frames × the screen's pixels × 4 bytes.
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
- **Rejections** add `unknown-frame`, `invalid-frame` (an index the source doesn't have), `invalid-delay`, `invalid-loop`, `no-frames` and `not-animated` (frame commands on a plan whose `animation` is `null`, or an `animation` over a source with one frame).
- **`maxFrames` applies to the plan too,** on each command that adds frames, so duplicating can't pass what opening allows.
- **In a document,** each source gains `frames`, and the migration from version 3 sets it to 1.
- **The frame being shown is view state,** like zoom: outside the plan and the history. The renderer's and the processor's calls take it.
- **Making a GIF from several stills** isn't in this record. It needs frames from different sources, each fitted to one size, and comes after 0.6.0 with its own format version.

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
- **Agreement with the browser:** for the fixtures browsers animate, the decoder's first frame equals `createImageBitmap`'s, in each engine.
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

- **[ADR 0001](0001-image-engines.md):** a GIF is no longer decoded by `createImageBitmap`, even a still one, and from 0.6.0 it opens as an animation. Animated PNG and WebP still open as stills.
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
- **Memory for an animation is a few screens and a bounded cache,** whatever the number of frames.
- **The SDK has its first bundled third-party code,** `gifenc`, and a `NOTICE` file with it.
- **There are two workers,** and a self-hosting application serves both files.
- **Exported GIFs can be larger than their sources,** because every frame is whole.
- **Frames pass through the page during a GIF export,** transferred and unread. A test holds that line.
