---
"@hussmartinez/image-sdk": minor
---

Layers can be mirrored, and a layer added to a mirrored image reads as it should ([ADR 0009](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0009-scene-space-layers-and-plan-versions.md)).

- **`flipX` on a layer's box.** Every text, shape and image layer has `flipX`, a boolean: whether it's mirrored left to right about its box's own vertical axis, before the box is turned. It's required, in the plan, in `image.insertLayers` and in a plan document of format version 2; `image.updateLayers` sets it. A mirror top to bottom is `flipX` with a half turn (`rotation: 1800`).
- **New layers read correctly.** The tools that add text, shapes and images set a new layer against the image's flips as well as its rotation, so text added to a mirrored image isn't backwards. Flipping the image afterwards still mirrors its layers with it.
- **`session.insertImage` does the same by default:** without `place`, the image is placed neither turned nor mirrored in the output, whatever the plan's orientation.
- **"Mirror" in the layers panel** flips the selected layer about its own box.
- **`layerToScene`** applies the mirror, so `layerToOutput`, `sceneToLayerSource`, the renderer and the editor's frames follow. Exports stay redacted under a mirrored image layer.

If you build layers yourself, add `flipX: false` to each.
