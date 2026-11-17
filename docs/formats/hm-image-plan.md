# `hm-image-plan` and `hm-image-command`, version 2

image-sdk's portable formats ([sdk-core ADR 0045](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0045-portable-formats-and-conformance-vectors.md)). A port in another language reads and writes them, and proves it applies commands as this SDK does by passing the vectors in [`conformance/`](../../conformance).

| Format | Schema | What it holds |
|---|---|---|
| `hm-image-plan` 2 | [`formats/hm-image-plan/v2.schema.json`](../../formats/hm-image-plan/v2.schema.json) | A plan ([ADR 0003](../adr/0003-layer-plan-document-model.md), [ADR 0009](../adr/0009-scene-space-layers-and-plan-versions.md)), with the sources it uses |
| `hm-image-command` 2 | [`formats/hm-image-command/v2.schema.json`](../../formats/hm-image-command/v2.schema.json) | One user-level edit command |

## Versions

Each release that widens the plan is a new version, with a migration from the one before, so every earlier version stays readable ([ADR 0009](../adr/0009-scene-space-layers-and-plan-versions.md)). The two formats take the same version numbers.

| Version | Release | Adds | Schemas |
|---|---|---|---|
| 1 | 0.3.0 | The base, the output and the kept metadata | [plan](../../formats/hm-image-plan/v1.schema.json), [command](../../formats/hm-image-command/v1.schema.json) |
| 2 | 0.4.0 | `layers`, always empty; `redactions`; `animation`, always `null`; and the redaction commands | [plan](../../formats/hm-image-plan/v2.schema.json), [command](../../formats/hm-image-command/v2.schema.json) |

- **A reader accepts every version up to its own, and writes its own.** `readImagePlanDocument` reads versions 1 and 2, and `toImagePlanDocument` writes version 2.
- **A later version is refused as later, never as damaged:** `UNSUPPORTED_FORMAT` with `unknown-format-version`, which an application can show as "update the application".
- **Version 1 to 2:** the document gains `layers: []`, `redactions: []` and `animation: null`, and nothing else changes. A version 1 document is checked as version 1 first, so one that already has those fields is refused, not migrated.
- **Version 1's commands are valid in version 2, unchanged.**

## Loading the schemas

The schemas ship with the package, under `@hussmartinez/image-sdk/formats/`, so a host validates against the version that matches its installed reader. `readImagePlanDocument` already checks everything the schema does and more, so a host needs the schemas only to validate elsewhere, such as on a server that stores documents, or in another tool.

```ts
import { Ajv2020 } from "ajv/dist/2020.js";
import planSchema from "@hussmartinez/image-sdk/formats/hm-image-plan/v2.schema.json" with { type: "json" };
import commandSchema from "@hussmartinez/image-sdk/formats/hm-image-command/v2.schema.json" with { type: "json" };

const ajv = new Ajv2020({ strict: true });
// The command schema refers to the plan schema's definitions by its $id, so compile that first.
const isPlan = ajv.compile(planSchema);
const isCommand = ajv.compile(commandSchema);

if (!isPlan(JSON.parse(text))) console.error(isPlan.errors);
```

In Node without a bundler, `createRequire(import.meta.url).resolve("@hussmartinez/image-sdk/formats/hm-image-plan/v2.schema.json")` gives the file's path. The vectors in `conformance/` stay in the repository: they're for ports and the SDK's own tests, not for hosts.

## `hm-image-plan`

```json
{
  "format": "hm-image-plan",
  "version": 2,
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
  "layers": [],
  "redactions": [
    { "key": "face", "mode": "solid", "x": 4, "y": 5, "width": 12, "height": 8, "colour": "#000000" },
    { "key": "plate", "mode": "pixelate", "x": -3, "y": 20, "width": 30, "height": 15 }
  ],
  "animation": null,
  "output": { "kind": "scale", "scale": 0.5 },
  "metadata": { "title": "Harbour at dusk", "description": "", "artist": "", "copyright": "" }
}
```

- **Numbers:** crops and sizes are whole pixels of the oriented source, the image as its EXIF orientation shows it ([ADR 0005](../adr/0005-colour-orientation-and-metadata.md)). Develop levels and filter strengths are whole numbers. An output `scale` is the one float. It's copied, never computed, so it compares exactly (ADR 0045, section 3).
- **The scene** is the base's oriented source, in whole pixels: the grid the crop uses. Redactions are placed in it, so they stay on the pixels they cover when the image is cropped or turned ([ADR 0009](../adr/0009-scene-space-layers-and-plan-versions.md)). A position may be outside the source, from −65,536 to 65,536.
- **Redactions** are regions an export doesn't show ([ADR 0010](../adr/0010-redaction.md)), applied over everything else, in order. Each is a rectangle of at least 1 × 1, `solid` with a `colour` as `#rrggbb` in lower case, or `pixelate` with none. A redaction has no opacity, visibility, rotation or name. A document holds at most 1,024.
- **Keys** identify redactions, and later layers and frames. A key is any text of 1 to 64 Unicode code points, and no two items in a document share one. Keys are data: `__proto__`, `constructor` and `toString` are keys like any other, and the vectors use them.
- **`layers` and `animation`** are in the document from this version, so that later versions change what they hold, not the document's shape. Here `layers` is empty and `animation` is `null`, and anything else is refused.
- **Sources** are keyed by ids that only mean something within the document, and the base names one of them. Each gives its oriented size. Once documents travel with their files, it also gives an `asset`: the SHA-256 of the bytes, their media type and their size. A document never inlines pixels, and never records a file name.
- **Beyond the schema,** a reader checks what depends on the whole document: the base's source is one the document lists, its crop fits inside that source, and no two items share a key.
- **Text lengths:** kept fields hold at most 2,000 Unicode code points, and keys at most 64, as the schema's `maxLength` counts them, and as every language can (sdk-core ADR 0045, section 8). A character outside the BMP, such as an emoji, is one code point, though JavaScript's `length` counts it as two. The vectors check the boundary with such characters.
- **Strict:** an unknown field anywhere is refused, never dropped. So a later version's document can't be misread as this one.
- **Not in the format:** the editor's state, such as a crop in progress or a gesture's preview, and the session's history.

`readImagePlanDocument(json)` reads a document, and `toImagePlanDocument(plan, sources)` writes one.

## `hm-image-command`

The edits a user makes, as [ADR 0003](../adr/0003-layer-plan-document-model.md), [ADR 0009](../adr/0009-scene-space-layers-and-plan-versions.md) and [ADR 0010](../adr/0010-redaction.md) describe them:

| Command | Changes |
|---|---|
| `image.setCrop`, `image.setOrientation`, `image.setDevelop`, `image.setFilter` | The base |
| `image.setOutput`, `image.setMetadata` | The export's size, and one kept field |
| `image.insertRedactions { at, redactions }` | Inserts redactions at an index, from 0 to the number there are |
| `image.removeRedactions { keys }` | Removes redactions |
| `image.moveRedactions { keys, to }` | Moves redactions to an index of the list without them. They keep the order they had in the list, whatever order `keys` names them in |
| `image.updateRedactions { updates: [{ key, props }] }` | Sets some fields of some redactions: `mode`, `x`, `y`, `width`, `height` and `colour` |

- **`keys`** lists at least one key, none twice.
- **An update's `props`** may be empty. Setting `mode` to `pixelate` drops the colour, so `colour` can't be set with it, or on a redaction that's already pixelated. Setting `mode` to `solid` needs a `colour` in the same `props`.
- **Inverses aren't part of the format.** Each command's inverse restores the plan exactly, and the vectors check that, but an inverse's shape is the reducer's own. Two commands exist only as inverses, `image.restoreRedactions` and `image.setRedactionOrder`: the TypeScript reducer applies them, the schema doesn't include them, and a port needn't have them.
- **The reducer refuses unknown fields here too.**

## Rejections

A refusal is compared by its code and `details.reason`, never its message:

| Code | Reasons |
|---|---|
| `UNSUPPORTED_FORMAT` | `unknown-format`, `unknown-format-version` |
| `INVALID_DOCUMENT` | `malformed-document`, `unknown-source`, `duplicate-key`, and as for commands: `crop-outside-source`, `invalid-orientation`, `invalid-output`, `metadata-too-long`, `unknown-adjustment`, `invalid-level`, `unknown-preset`, `invalid-strength`, `invalid-key`, `unknown-redaction-mode`, `invalid-region`, `invalid-colour` |
| `INVALID_COMMAND` | `ImageCommandRejection`'s tokens: those of version 1, `malformed-command`, `unknown-command`, `unknown-source`, `crop-outside-source`, `invalid-orientation`, `invalid-output`, `unknown-metadata-field`, `metadata-too-long`, `unknown-adjustment`, `invalid-level`, `unknown-preset`, `invalid-strength`; and for redactions, the table below |

| Reason | When |
|---|---|
| `invalid-key` | A key that's empty, or over 64 code points |
| `duplicate-key` | A new redaction whose key the plan already uses; two new redactions, or two updates, with one key |
| `invalid-index` | An index past the end of the list |
| `unknown-redaction` | A key no redaction has |
| `unknown-redaction-mode` | A mode other than `solid` and `pixelate` |
| `invalid-region` | A region under 1 × 1, or further than 65,536 pixels from the scene's origin |
| `invalid-colour` | A colour that isn't `#rrggbb` in lower case |
| `unexpected-colour` | An update that sets a colour on a pixelated redaction |
| `missing-colour` | An update that sets a redaction to `solid` without a colour |
| `too-many-layers` | More than 1,024 layers and redactions together, the format's ceiling. A host's lower `maxLayers` limit is the session's, with the `TOO_MANY_LAYERS` code |
| `invalid-order` | Only from `image.setRedactionOrder`, which isn't in the format |

**What the schema sees is `malformed`.** A refusal the schema expresses on its own, such as a missing field, a fractional pixel, a negative index, a key listed twice in `keys` or a pixelated redaction with a colour, is `malformed-command` or `malformed-document`, unless it has a token of its own above. The other refusals depend on the plan, so the schema accepts those commands and the reducer refuses them. The TypeScript tests hold both sides to that.

`unknown-source` from a command means the session's plan names a source the session doesn't hold; a document's reader refuses that earlier, so the vectors can't reach it.

## The vectors

| File | Subject | A case's input | Its expected result |
|---|---|---|---|
| [`conformance/hm-image-plan.json`](../../conformance/hm-image-plan.json) | `hm-image-plan` | A document | The document as a reader writes it back, or the rejection |
| [`conformance/hm-image-commands.json`](../../conformance/hm-image-commands.json) | `hm-image-commands` | `{ plan, command }` | The resulting document, or the rejection. The command's inverse must also restore the plan |
| [`conformance/hm-image-geometry.json`](../../conformance/hm-image-geometry.json) | `hm-image-geometry` | `{ operation, …arguments }` | The function's result, exactly |

Hand-written cases cover every outcome, including source ids, keys, command types, adjustments and kept fields named `__proto__`, `constructor` and `toString` (ADR 0045, section 8); keys of 64 and 65 code points outside the Basic Multilingual Plane; a plan with as many redactions as the format holds; and a version 1 document, read and written back as version 2. Generated ones come from the reducer's property-test generators, with a fixed seed: 60 commands that apply, each valid for the plan it's given, and two of each refusal from commands with a field replaced or added. `pnpm conformance:update` rewrites the files, and the tests fail when the checked-in files differ from what the generator writes.

The TypeScript tests also check that the schemas agree with the readers. Every document and command the vectors accept passes its schema, a version 1 document version 1's, and every structural refusal fails it. Every command version 1's schema accepts, version 2's accepts. Over thousands of mutated inputs, the reducer and the reader never accept anything their schema refuses.

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

A breaking change is a new version, with its schema beside the others and a migration from the version before (ADR 0045, section 1). So is any widening of what a plan holds, such as a new kind of layer ([ADR 0009](../adr/0009-scene-space-layers-and-plan-versions.md)): a reader of the earlier version must refuse the document as a later version, not as a damaged one. A reader refuses a later version with `UNSUPPORTED_FORMAT` and `unknown-format-version`.
