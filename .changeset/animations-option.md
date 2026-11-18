---
"@hussmartinez/image-sdk": minor
---

A host can keep every file a still: `animations: false` ([ADR 0011](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0011-gif-and-animation.md)).

- **`createImageSession({ animations: false })`,** the `animations` prop of `ImageEditor` and `ImageEditorProvider`, and the `animations` property of `<hm-image-editor>`. It's `true` when omitted.
- **With `false`, an animated file opens as its first frame,** as it did before 0.7.0, and its frames aren't decoded. The editor says "This file is an animation. Its first frame is open as a still image."
- It's the way to say so: `maxAnimationPixels` is a limit on an animation's size, not a switch.
