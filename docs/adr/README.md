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
| [0007](0007-editor-shell.md) | The editor shell: layout, the stage, gestures, shortcuts and focus | Accepted |
| [0008](0008-terminal-engine-invalidation.md) | Fail closed after a render worker loses its resources | Accepted |
| [0009](0009-scene-space-layers-and-plan-versions.md) | Scene space, layers and marks, and the plan's format versions | Accepted |
| [0010](0010-redaction.md) | Redaction destroys pixels, and a test proves it | Accepted |
| [0011](0011-gif-and-animation.md) | GIF: our own decoder, an animation in the plan, and export through a job worker | Accepted |
| [0012](0012-interface-text-outside-the-server-safe-entry.md) | Interface text stays out of the server-safe entry | Accepted |
| [0013](0013-layers-in-the-editor.md) | Layers in the editor: the list, the frames and their keys | Accepted |
| [0014](0014-drawing-strokes-and-arrows.md) | Drawing: how strokes are simplified, stored and drawn, and the arrow's shape | Accepted |
| [0015](0015-drawing-in-the-editor.md) | Drawing in the editor: the draw tool, and frames for drawings and arrows | Accepted |
