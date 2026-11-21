---
"@hussmartinez/image-sdk": patch
---

`ImageEditor` no longer has its inner part change an object it was given to subscribe to the session's events: it now subscribes through a function and unsubscribes when it unmounts. The stage reads its canvas from its own ref when it updates the canvas's name. Nothing you can see changes: the editor announces opens, undos and redos as before, and the preview canvas keeps its label and hides until there's an image.
