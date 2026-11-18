---
"@hussmartinez/image-sdk": minor
---

An animation shows its first frame while it opens ([ADR 0011](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0011-gif-and-animation.md)). Every frame of an animated GIF is checked once as it opens, which takes a few seconds for a large file. The editor now shows the first frame on the stage as soon as it's decoded, with the progress and Cancel at the stage's foot, instead of an empty stage. While playing, Play shows a Pause icon.

- **`ImageRegisterOptions.onFirstFrame`:** called once a source registered with all its frames has its first frame ready, before the rest are checked. From then until `register` settles, a renderer of the same engine may draw a still plan of that source.
- **`ImageSessionSnapshot.openingFrame`:** the opening animation's first frame, as a source id and size a renderer may draw, while it opens. `null` otherwise.
- The editor shows it only when no image is open yet. Opening another file over one that's open keeps the open one on the stage, since it stays editable until the new one is ready.

**If you have your own `ImageEngine` or `ImageRenderer`:** nothing changes unless you want this. An engine that never calls `onFirstFrame` gives no early frame, and the editor shows the progress alone, as before.
