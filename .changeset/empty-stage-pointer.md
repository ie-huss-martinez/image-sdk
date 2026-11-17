---
"@hussmartinez/image-sdk": patch
---

Fix the empty editor ignoring the mouse: a click on "Choose an image" did nothing, and a file dropped on the empty stage wasn't opened. The stage's canvas frame covered the drop zone, so only the keyboard and the toolbar's "Open image" worked. The Cancel button shown while an image opens was covered the same way, and now takes clicks too.

Nothing changes in how the editor looks. If you worked around this with your own `z-index` or `pointer-events` on `.hm-image-stage-frame` or `.hm-image-stage-drop`, you can remove it.
