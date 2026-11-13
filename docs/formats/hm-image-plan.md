# `hm-image-plan` and `hm-image-command`, version 1

image-sdk's portable formats ([sdk-core ADR 0045](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0045-portable-formats-and-conformance-vectors.md)). A port in another language reads and writes them, and proves it applies commands as this SDK does by passing the vectors in [`conformance/`](../../conformance).

| Format | Schema | What it holds |
|---|---|---|
| `hm-image-plan` 1 | [`formats/hm-image-plan/v1.schema.json`](../../formats/hm-image-plan/v1.schema.json) | A plan ([ADR 0003](../adr/0003-layer-plan-document-model.md)), with the sources it uses |
| `hm-image-command` 1 | [`formats/hm-image-command/v1.schema.json`](../../formats/hm-image-command/v1.schema.json) | One user-level edit command |

`readImagePlanDocument` already checks everything the schema does and more, so a host needs the schema only to validate elsewhere, such as on a server that stores documents, or in another tool. The command schema refers to the plan schema's definitions by its `$id`, so a validator adds the plan schema first.

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
- **Text lengths:** kept fields hold at most 2,000 UTF-16 code units, as JavaScript counts them. The schema's `maxLength` counts code points, which are never more, so the reader is the stricter of the two, and a port counts as JavaScript does.
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

Hand-written cases cover every outcome, including source ids, command types, adjustments and kept fields named `__proto__`, `constructor` and `toString` (ADR 0045, section 8). Generated ones come from the reducer's property-test generators, with a fixed seed: 60 commands that apply, and two of each refusal from commands with a field replaced or added. `pnpm conformance:update` rewrites the files, and the tests fail when the checked-in files differ from what the generator writes.

The TypeScript tests also check that the schemas agree with the readers. Every document and command the vectors accept passes its schema, and every structural refusal fails it. Over thousands of mutated inputs, the reducer and the reader never accept anything their schema refuses.

## Changing the formats

A breaking change is a new version, with its schema beside this one and a migration from version 1 (ADR 0045, section 1). A reader refuses a later version with `UNSUPPORTED_FORMAT` and `unknown-format-version`.
