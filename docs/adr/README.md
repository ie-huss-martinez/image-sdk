# Architecture decision records

Decisions specific to `@hussmartinez/image-sdk`. Decisions for the whole SDK family live in [`sdk-core`'s `docs/adr`](https://github.com/ie-huss-martinez/sdk-core/tree/main/docs/adr); the records here build on them and never contradict them. To change a family decision, write a record in `sdk-core`.

Each record captures one significant decision: the context that forced it, what we chose, the alternatives we rejected and the consequences we accept. Records are numbered and immutable. To change a decision, write a new record that supersedes the old one and link the two.

Use [`template.md`](template.md) for new records. Name files `NNNN-short-title.md`, taking the next free number.

| # | Decision | Status |
|---|---|---|
| [0001](0001-image-engines.md) | Image engines: our own readers, the browser's decoders and encoders | Accepted |
| [0002](0002-workers-and-assets.md) | One render worker that owns the pixels, and assets without the network | Accepted |
| [0003](0003-layer-plan-document-model.md) | The layer plan: edits change a model, and pixels are rendered on export | Accepted |
| [0004](0004-image-limits.md) | Image limits and session memory | Accepted |
| [0005](0005-colour-orientation-and-metadata.md) | Colour, orientation and metadata: sRGB, oriented sources, and nothing kept by default | Accepted |
| [0006](0006-develop-and-filters.md) | Develop adjustments and filter presets: our own pixel math in the render worker | Accepted |
