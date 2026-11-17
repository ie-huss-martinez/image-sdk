---
"@hussmartinez/image-sdk": patch
---

Fix the crop frame's resize keys taking the browser's Back and Forward. The frame resized with `Alt` and the arrow keys, and `Alt` with Left or Right goes back or forward a page in Chrome and Firefox on Windows and Linux, so resizing a crop could leave the page and lose the edit.

**The keys have changed:**

| Key, on the crop frame | Before | Now |
|---|---|---|
| Arrows | Move by 1 pixel | Move by 1 pixel |
| `Shift` with an arrow | Move by 10 pixels | **Resize by 1 pixel** |
| `Alt` with an arrow | Resize by 1 pixel | Nothing: left to the browser |

There's no 10-pixel step now: hold an arrow, or type a value in the crop panel's fields. The frame's description, which screen readers read, names the new keys. If your own documentation lists the crop keys, update it.
