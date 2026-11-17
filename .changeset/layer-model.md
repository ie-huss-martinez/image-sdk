---
"@hussmartinez/image-sdk": minor
---

Add layers to the plan: text, shapes and images over the base ([ADR 0009](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0009-scene-space-layers-and-plan-versions.md)). This is the model and its commands; drawing them and the editor's tools follow.

- **`plan.layers`** is a list of `ImageLayer`s, drawn bottom to top: `ImageTextLayer`, `ImageShapeLayer` and `ImageImageLayer`. Each has a key, a name, `visible`, an `opacity` from 0 to 100, and a box in whole pixels of the base's oriented source, turned about its centre in tenths of a degree. Like redactions, layers stay on the pixels they cover when the image is cropped or turned.
- **Text** is drawn as large as fits in its box, in one of three generic fonts, and can't hold control characters other than a line feed, or the bidirectional override and isolate controls, which can make text read differently from what's stored.
- **Commands:** `image.insertLayers`, `image.removeLayers`, `image.moveLayers` and `image.updateLayers`, each undone exactly. `image.updateLayers` sets any field of a layer's kind except its key and kind, for several layers at once. New `INVALID_COMMAND` reasons, such as `wrong-kind` and `invalid-text`, are listed in `ImageCommandRejection`.
- **Keys and limits are shared with redactions:** a key is unique across both lists, and `maxLayers` counts both.
- **Format version 2** now holds layers. `formats/hm-image-plan/v2.schema.json` and `formats/hm-image-command/v2.schema.json` describe them, and `readImagePlanDocument` checks that an image layer's source is one the document lists.

`ImagePlan["layers"]` changes type, from an always-empty list to `readonly ImageLayer[]`. Code that only reads plans from `createPlan` or the session needs no change.

Until the renderer draws layers, exporting or previewing a plan with any fails with `UNSUPPORTED_PLAN`, as for any part a renderer can't draw. An image layer's source must be one the session holds; today that's the open image, and opening further images for layers comes with the image tool.
