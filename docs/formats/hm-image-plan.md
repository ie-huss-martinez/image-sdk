# `hm-image-plan` and `hm-image-command`, version 1

image-sdk's portable formats ([sdk-core ADR 0045](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0045-portable-formats-and-conformance-vectors.md)). A port in another language reads and writes them, and proves it applies commands as this SDK does by passing the vectors in [`conformance/`](../../conformance).

| Format | Schema | What it holds |
|---|---|---|
| `hm-image-plan` 1 | [`formats/hm-image-plan/v1.schema.json`](../../formats/hm-image-plan/v1.schema.json) | A plan ([ADR 0003](../adr/0003-layer-plan-document-model.md)), with the sources it uses |
| `hm-image-command` 1 | [`formats/hm-image-command/v1.schema.json`](../../formats/hm-image-command/v1.schema.json) | One user-level edit command |

## Loading the schemas

The schemas ship with the package, under `@hussmartinez/image-sdk/formats/`, so a host validates against the version that matches its installed reader. `readImagePlanDocument` already checks everything the schema does and more, so a host needs the schemas only to validate elsewhere, such as on a server that stores documents, or in another tool.

```ts
import { Ajv2020 } from "ajv/dist/2020.js";
import planSchema from "@hussmartinez/image-sdk/formats/hm-image-plan/v1.schema.json" with { type: "json" };
import commandSchema from "@hussmartinez/image-sdk/formats/hm-image-command/v1.schema.json" with { type: "json" };

const ajv = new Ajv2020({ strict: true });
// The command schema refers to the plan schema's definitions by its $id, so compile that first.
const isPlan = ajv.compile(planSchema);
const isCommand = ajv.compile(commandSchema);

if (!isPlan(JSON.parse(text))) console.error(isPlan.errors);
```

In Node without a bundler, `createRequire(import.meta.url).resolve("@hussmartinez/image-sdk/formats/hm-image-plan/v1.schema.json")` gives the file's path. The vectors in `conformance/` stay in the repository: they're for ports and the SDK's own tests, not for hosts.

## `hm-image-plan`

```json
{
  "format": "hm-image-plan",
  "version": 1,
  "sources": { "s": { "width": 40, "height": 30 } },
  "base": {
    "source": "s",
    "crop": { "x": 2, "y": 3, "width": 20, "height": 10 },
    "orientation": { "rotate": 90, "flipX": true, "flipY": false },
    "develop": {
      "temperature": 0, "tint": 0, "exposure": 20, "highlights": 0,
      "shadows": 0, "contrast": -15, "saturation": 0, "vibrance": 0
    },
    "filter": { "preset": "sepia", "strength": 60 }
  },
  "output": { "kind": "scale", "scale": 0.5 },
  "metadata": { "title": "Harbour at dusk", "description": "", "artist": "", "copyright": "" }
}
```

- **Numbers:** crops and sizes are whole pixels of the oriented source, the image as its EXIF orientation shows it ([ADR 0005](../adr/0005-colour-orientation-and-metadata.md)). Develop levels and filter strengths are whole numbers. An output `scale` is the one float. It's copied, never computed, so it compares exactly (ADR 0045, section 3).
- **Sources** are keyed by ids that only mean something within the document, and the base names one of them. Each gives its oriented size. Once documents travel with their files, it also gives an `asset`: the SHA-256 of the bytes, their media type and their size. A document never inlines pixels, and never records a file name.
- **Beyond the schema,** a reader checks what depends on the whole document: the base's source is one the document lists, and its crop fits inside that source.
- **Text lengths:** kept fields hold at most 2,000 Unicode code points, as the schema's `maxLength` counts them, and as every language can (sdk-core ADR 0045, section 8). A character outside the BMP, such as an emoji, is one code point, though JavaScript's `length` counts it as two. The vectors check the boundary with such characters.
- **Strict:** an unknown field anywhere is refused, never dropped. So a later version's document can't be misread as this one.
- **Not in the format:** the editor's state, such as a crop in progress or a gesture's preview, and the session's history.

`readImagePlanDocument(json)` reads a document, and `toImagePlanDocument(plan, sources)` writes one.

## `hm-image-command`

The edits a user makes: `image.setCrop`, `image.setOrientation`, `image.setOutput`, `image.setMetadata`, `image.setDevelop` and `image.setFilter`, as [ADR 0003](../adr/0003-layer-plan-document-model.md) describes them. Their inverses are commands of the same types, but their shape isn't part of the format. The reducer refuses unknown fields here too.

## Rejections

A refusal is compared by its code and `details.reason`, never its message:

| Code | Reasons |
|---|---|
| `UNSUPPORTED_FORMAT` | `unknown-format`, `unknown-format-version` |
| `INVALID_DOCUMENT` | `malformed-document`, `unknown-source`, and as for commands: `crop-outside-source`, `invalid-orientation`, `invalid-output`, `metadata-too-long`, `unknown-adjustment`, `invalid-level`, `unknown-preset`, `invalid-strength` |
| `INVALID_COMMAND` | `ImageCommandRejection`'s tokens: `malformed-command`, `unknown-command`, `unknown-source`, `crop-outside-source`, `invalid-orientation`, `invalid-output`, `unknown-metadata-field`, `metadata-too-long`, `unknown-adjustment`, `invalid-level`, `unknown-preset`, `invalid-strength` |

`unknown-source` from a command means the session's plan names a source the session doesn't hold; a document's reader refuses that earlier, so the vectors can't reach it.

## The vectors

| File | Subject | A case's input | Its expected result |
|---|---|---|---|
| [`conformance/hm-image-plan.json`](../../conformance/hm-image-plan.json) | `hm-image-plan` | A document | The document as a reader writes it back, or the rejection |
| [`conformance/hm-image-commands.json`](../../conformance/hm-image-commands.json) | `hm-image-commands` | `{ plan, command }` | The resulting document, or the rejection. The command's inverse must also restore the plan |
| [`conformance/hm-image-geometry.json`](../../conformance/hm-image-geometry.json) | `hm-image-geometry` | `{ operation, …arguments }` | The function's result, exactly |

Hand-written cases cover every outcome, including source ids, command types, adjustments and kept fields named `__proto__`, `constructor` and `toString` (ADR 0045, section 8). Generated ones come from the reducer's property-test generators, with a fixed seed: 60 commands that apply, and two of each refusal from commands with a field replaced or added. `pnpm conformance:update` rewrites the files, and the tests fail when the checked-in files differ from what the generator writes.

The TypeScript tests also check that the schemas agree with the readers. Every document and command the vectors accept passes its schema, and every structural refusal fails it. Over thousands of mutated inputs, the reducer and the reader never accept anything their schema refuses.

## Geometry

`hm-image-geometry` isn't a format: it's the pure geometry a port needs to show and export a plan as this SDK does. Each case names one function and gives its arguments, with `null` for a missing ratio:

| Operation | What it gives |
|---|---|
| `orientedSize` | A stored size under an EXIF orientation, 1 to 8 |
| `compositionSize` | The cropped source, turned by the plan's rotation |
| `outputSize` | The export's size: scaled or fitted, never enlarged, at least 1 × 1 |
| `sourceToComposition`, `compositionToSource` | A point mapped through the crop, the rotation and then the flips, and back |
| `aspectRatio`, `fitAspect` | An aspect's ratio, and the largest centred crop of it |
| `moveCrop`, `dragHandle`, `nudgeCropOnScreen` | A crop moved or resized, kept inside its source, in whole pixels |
| `cropInComposition`, `compositionDeltaToSource`, `handleInSource` | Where a crop shows on screen, and how a drag or a handle on screen maps back to the source |

The results compare exactly, with no tolerance. They need only IEEE addition, multiplication and division, which give the same doubles in every language, and rounding.

**Rounding is JavaScript's `Math.round`:** halves round toward positive infinity, so −2.5 rounds to −2. Many languages round halves away from zero, such as Rust's `f64::round`, which gives −3. A port rounds as `floor(x + 0.5)` does, and the vectors include negative halves. `fitAspect` centres with `floor`.

## Changing the formats

A breaking change is a new version, with its schema beside this one and a migration from version 1 (ADR 0045, section 1). A reader refuses a later version with `UNSUPPORTED_FORMAT` and `unknown-format-version`.
