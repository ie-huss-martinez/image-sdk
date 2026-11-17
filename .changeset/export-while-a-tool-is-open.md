---
"@hussmartinez/image-sdk": patch
---

Export no longer greys out while Redact or Layers is open ([ADR 0007](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0007-editor-shell.md)).

- **While redacting or arranging layers,** the toolbar's Export works: it ends the tool and opens the export dialog. A gesture still running, such as text being typed, is included in the export.
- **While a crop is unapplied,** Export still waits, and now says why: the button stays reachable with the keyboard and is described by "Apply or cancel the crop before exporting.", in a tooltip.
- **`ImageTool` gains an optional `unavailable(state)`,** which returns a message key while a tool can't run for a reason the user can act on. `ImageToolbar` keeps such a button focusable and describes it with the text. Your own tools can use it; the new string is `tools.exportWhileCropping`.
