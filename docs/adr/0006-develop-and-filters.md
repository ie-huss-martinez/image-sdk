# 0006. Develop adjustments and filter presets: our own pixel math in the render worker

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

[ADR 0003](0003-layer-plan-document-model.md) gives the plan's base two kinds of tonal and colour edits: **`develop`**, adjustments such as exposure, contrast, saturation and temperature, each a number in a fixed range where 0 means unchanged, and **`filter`**, a preset and its strength. It leaves open which adjustments there are, what each one does to a pixel, and where that runs.

The render worker draws the plan into a 2D `OffscreenCanvas` ([ADR 0002](0002-workers-and-assets.md)), for the preview, thumbnails and every export, through one renderer. Whatever implements develop and filters must therefore:

- run in a worker, in every engine [ADR 0013](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0013-browser-and-react-support.md) supports;
- give the same result in the preview and the export, and the same export in every browser, so that a document edited in one browser exports the same in another;
- stay within the memory limits of [ADR 0004](0004-image-limits.md) on a 50-megapixel export;
- be testable to the pixel in Node and in browser tests.

The [capability matrix](../capabilities.md) shows that the 2D context's `filter` property, which takes CSS filter functions such as `brightness()` and `saturate()`, works in Chromium's and Firefox's workers but **doesn't exist in WebKit's `OffscreenCanvas`**.

## Decision

### Our own per-pixel math, in the render worker

Develop and filters are **our own code**, applied to the rendered base's pixels in the render worker. They don't use the canvas `filter` property, WebGL or WebAssembly.

- **Where:** after the base is drawn at the size being rendered, and before any layer is drawn over it. Layers, such as text, shapes and redactions, are never developed. A redaction drawn over a developed base stays exactly as opaque as it was drawn.
- **At the size being rendered:** the preview develops the stage-sized render, and an export develops the output-sized one, with the same code. Every adjustment is per pixel, with no neighbourhood, so the result doesn't depend on the scale it's computed at, beyond resampling.
- **In strips:** the worker reads, adjusts and writes back the canvas in bands of rows with `getImageData` and `putImageData`, so the extra memory is one band, at most 4 MB, not a second full-size copy. Between bands it checks the call's `AbortSignal` and reports progress.
- **Fast paths:** adjustments that act on each channel alone are combined into lookup tables built once per render. Only the cross-channel steps, saturation, vibrance and the highlights and shadows masks, compute per pixel.
- **Deterministic:** the math uses only integer lookups and `Math` functions, with results rounded to 8 bits the same way everywhere. Given the same rendered base, every engine produces the same developed pixels. Browsers' decoders and resampling may still differ slightly, which the export tests' tolerances cover.

### The adjustments

Each is an integer from −100 to 100, 0 meaning unchanged, applied in this fixed order:

| Adjustment | What it does | Space |
|---|---|---|
| `temperature` | Warms (positive) or cools (negative): scales red and blue in opposite directions | linear light |
| `tint` | Toward magenta (positive) or green (negative): scales green | linear light |
| `exposure` | Multiplies light by 2^(value / 50), so ±100 is ±2 stops | linear light |
| `highlights` | Lifts or recovers the brightest tones, weighted by a smooth luminance mask | sRGB-encoded |
| `shadows` | Lifts or deepens the darkest tones, weighted by a smooth luminance mask | sRGB-encoded |
| `contrast` | An S-curve, or its inverse, pivoting on middle grey | sRGB-encoded |
| `saturation` | Scales every pixel's distance from its own luminance | linear light, Rec. 709 luminance |
| `vibrance` | Saturation weighted toward the least saturated pixels | linear light, Rec. 709 luminance |

- **Linear light** uses the sRGB transfer function both ways, through a 256-entry table in and a 4,096-entry table out. Pixels are clamped to the sRGB gamut on the way out, never wrapped.
- **Alpha is untouched.** The math works on the unpremultiplied values `getImageData` returns.
- **The formulas are the code,** in one pure module the core's tests cover with golden values: for each adjustment, the extremes and a midpoint, applied to a fixed set of colours. Changing a formula changes those values, so it's a visible, reviewed change to how documents render.
- **Out-of-range or non-integer values** are `INVALID_COMMAND` when an `image.setDevelop` command runs ([ADR 0003](0003-layer-plan-document-model.md)), never clamped by the renderer.

### Filter presets

- **A preset is data:** a set of develop values, applied after the user's own in the same pipeline, and optionally per-channel tone curves (a few control points per channel, interpolated into lookup tables) and a monochrome mix. No preset carries code, images or anything fetched.
- **Strength** is an integer from 0 to 100. The preset's result is mixed with the pixel before the preset, linearly in 8-bit values, so 0 is exactly no preset and 100 is the full preset.
- **The first presets** are a small, original set, named for what they do rather than after other products: `vivid`, `warm`, `cool`, `fade`, `mono`, `noir` and `sepia`. Each has a golden-value test like the adjustments. Presets are added in later releases; a document that names an unknown preset is `INVALID_COMMAND`, so a newer document fails visibly in an older SDK rather than rendering differently.

### Limits and cost

- **No new limit.** The strip is bounded, so a develop adds at most 4 MB to an export's peak ([ADR 0004](0004-image-limits.md)).
- **Time:** develop is linear in the pixels rendered. An export runs under the file policy's `maxProcessingTime`, so a slow device fails with `PROCESSING_TIME_EXCEEDED` rather than hanging. The preview only develops the stage-sized render, and coalesces frames ([ADR 0002](0002-workers-and-assets.md)).
- **Worker size:** the module is small, plain arithmetic and tables. The worker's size budget is raised in the implementation pull request, from the measured size.

## Alternatives considered

- **The 2D context's `filter` property:** the least code, but WebKit's `OffscreenCanvas` doesn't have it ([capability matrix](../capabilities.md)), so WebKit couldn't render develop at all. Where it exists, CSS `brightness()` and `saturate()` scale sRGB-encoded values rather than light, which isn't what a photographic adjustment means, and engines implement them independently, so exports would differ by browser.
- **WebGL in the worker:** much faster per pixel, but it adds a GPU context to every worker, context loss to handle, precision and readback that vary by GPU and driver, and a second rendering path for a feature the CPU handles in well under a second at preview sizes. A later record can add it as an accelerated path, if measurements on real devices show exports are too slow, with this record's math as the reference it must match.
- **WebAssembly:** faster loops, but `'wasm-unsafe-eval'` in every host's Content Security Policy ([ADR 0002](0002-workers-and-assets.md)) for a speed-up the first releases don't need.
- **Applying develop to the whole composition, layers included:** simpler, but it would recolour text and stickers and weaken solid redactions. People expect a photo filter to change the photo.
- **Presets as lookup images (LUT files):** flexible, but they're binary assets to ship or fetch, and hard to review. Data-defined presets are a few lines each.

## Consequences

- **Develop and filters render the same in every engine,** including WebKit, and in the preview and the export.
- **Their cost is CPU time in the worker,** linear in the pixels drawn. Large exports with develop are slower than with the browser's filters would be where those exist.
- **The formulas are fixed by golden tests,** so changing how a slider behaves is an explicit, reviewed change.
- **Preset names are part of the document format.** Removing or renaming one later would break documents, so presets are only added.
