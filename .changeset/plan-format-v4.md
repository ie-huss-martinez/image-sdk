---
"@hussmartinez/image-sdk": minor
---

Add the animation to the plan: format version 4 ([ADR 0011](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0011-gif-and-animation.md)). This release adds the model, the commands and the format. Opening a file as an animation, playing it and writing a GIF come in later releases: until then every opened image is a still, and a renderer refuses an animated plan with `UNSUPPORTED_PLAN`.

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
