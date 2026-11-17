---
"@hussmartinez/image-sdk": minor
---

The engine can hold a GIF with all its frames, and draw any of them ([ADR 0011](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0011-gif-and-animation.md)). The editor and the session still open every file as a still: this is for hosts that use the engine, the processor and the renderer directly, and for the releases that follow.

- **`engine.register(id, file, probe, { frames: "all" })`** holds every frame of an animated GIF. Each frame is decoded once to check it, so the call takes as long as that: `onProgress` reports each frame, and `signal` cancels it. The default, `"first"`, is a still, as before.
- **`ImageSourceInfo` gains `timing` and `incomplete`.** `timing` is the file's loop count and each frame's delay, `null` for a still. `incomplete` is `true` when the file's frames ended early, before its end or at a frame that couldn't be decoded: the frames before that are the source's. `frames` is how many it holds, and `decodedBytes` what the worker holds for it, which for an animation isn't every frame.
- **`frame` on an export's job and on a render's view** names which of the plan's `animation.frames` to draw, 0 when omitted. A frame the plan doesn't have is a `RangeError`.
- **A plan with an animation is drawn only over a source registered with its frames.** Otherwise it's refused with `UNSUPPORTED_PLAN`, as before.

**If you have your own `ImageEngine`:** return `timing: null` and `incomplete: false` from `register` for a still. The engine's contract tests check both.
