---
"@hussmartinez/image-sdk": patch
---

The layers list is one tab stop ([ADR 0013](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0013-layers-in-the-editor.md)).

- **The list is `@hussmartinez/ui`'s `ReorderableList`,** in place of a list of buttons with two tab stops for each layer. Tab reaches the list once; the Up and Down arrows move between layers and select, and Left and Right move between a layer's name and its show-or-hide button.
- **The same keys as before** move and remove: `Alt` (`Option` on macOS) with Up or Down moves the focused layer, and `Delete` or `Backspace` removes it.
- **After a delete,** the layer now in its place in the list is selected: the one that was under it. Before, it was the one over it.
- **For assistive technology** the list is a grid of rows, each selected or not, where it was a list of pressed and unpressed buttons.

If you style the list, its rows are now ui's (`.hm-reorderable-list-row`); `.hm-image-layer-select` is still on each layer's name, and `.hm-image-layer-visibility` on its button.

This release needs `@hussmartinez/ui` 0.10.0 or later.
