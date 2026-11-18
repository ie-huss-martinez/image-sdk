---
"@hussmartinez/image-sdk": minor
---

An animated GIF opens as an animation ([ADR 0011](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0011-gif-and-animation.md)): the session's plan lists its frames with the file's timing, and the frame commands edit them. Playing, a timeline and writing a GIF come next; until then the editor shows the first frame, and an export is one frame.

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
