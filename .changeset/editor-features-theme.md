---
"@hussmartinez/image-sdk": minor
---

`<ImageEditor>` takes `features` and `theme` (docs/adr/0007).

- **`features`** turns capabilities on and off: `adjust`, `filters` and `info`, the inspector's panels, and `export`, the Export tool and its dialog. Each is on unless it's `false`. With one panel on, the inspector shows it without a choice of panels. With `export` off, nothing in the editor exports, and the ref handle's `export()` still gives the host the file.
- **`theme`**, `light`, `dark` or `system`, sets ui's colour mode on the editor's root. Unset, the editor follows the page's.
