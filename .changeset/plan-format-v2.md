---
"@hussmartinez/image-sdk": minor
---

**Breaking:** `ImagePlan` gains three required fields, `layers`, `redactions` and `animation`, and the plan's portable format is now `hm-image-plan` version 2.

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
