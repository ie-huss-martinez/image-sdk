---
"@hussmartinez/image-sdk": minor
---

An animation the SDK can't hold opens as its first frame, and says so ([ADR 0011](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0011-gif-and-animation.md)). It's one rule for the three limits on animations: `maxFrames`, `maxDecodedSize` across the frames, and `maxAnimationPixels`.

- **Files that 0.6.0 refused now open.** An animated GIF, PNG or WebP with more frames than `maxFrames` (300), or whose frames could decode to more than `maxDecodedSize` (1 GB), was refused with `TOO_MANY_FRAMES` or `DECODED_SIZE_TOO_LARGE`, though only its first frame was ever shown. It now opens as its first frame, a still, and the editor says "This animation is too large to edit as an animation. Its first frame is open as a still image."
- **The snapshot's `warnings` name the limits** such a file was over. A still's own limits still refuse: a file whose first frame alone is over `maxImagePixels`, `maxImageDimension`, `maxFileSize` or `maxDecodedSize` fails as before.
- **`engine.register` counts what it's asked to hold:** one frame for a still, the default, and every frame with `frames: "all"`, which is where the animation limits' codes can still be raised.
- **`checkFileLimits(policy, size, probe, frames?)`** takes `"first"` or `"all"`, and counts every frame when it isn't told, as before. `ANIMATION_LIMITS` and `animationLimits(policy, probe)` say which of the three a file is over and near, without throwing.

**If you relied on the refusal:** a host that showed `TOO_MANY_FRAMES` for a long animation now gets a still and a warning in the snapshot. To refuse such files, check `animationLimits(policy, probe).over` before opening.
