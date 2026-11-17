---
"@hussmartinez/image-sdk": minor
---

Add `session.insertImage(file)`: open a second image and add it to the document as an image layer, as one undoable step ([ADR 0003](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0003-layer-plan-document-model.md), [ADR 0004](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0004-image-limits.md)).

- **Checked like any file:** probed from its headers and held to the file policy before it's decoded, in the worker.
- **Placed for you, or by you:** by default the image is centred on what's shown, at its own size or half the composition's, whichever is smaller, over every layer. `place` returns your own commands instead.
- **Held only while it's needed:** the session keeps the source while the plan, an undo or redo step, or an export in progress refers to it, and releases it then. Opening another file releases them all.
- **Limits:** `maxFiles` counts every source the session holds, and `maxSessionSize` their decoded bytes. When an image doesn't fit, the session drops the oldest undo steps that alone keep another image; if that can't free enough, nothing is dropped and it fails with `SESSION_TOO_LARGE`.
- **The snapshot** gains `sources`, every source held; `inserting`; and `historyTrimmed`, true once undo steps were dropped to make room.
- **Events:** `onEvent` gets `{ type: "insert" }`, with no file name, size or source id, like the others.

`ImageSessionSnapshot` has three new required fields, and `ImageSessionEvent["type"]` a new value: code that builds a snapshot by hand, such as a test double, or switches over every event type, needs them.

A plan with an image layer still can't be previewed or exported until the renderer draws layers.
