---
"@hussmartinez/image-sdk": patch
---

The export dialog, the frames panel and the layer fields no longer reset their state in an effect after a render. They adjust it while rendering, as React recommends, so a change takes one render instead of two. Nothing you can see changes: the export dialog still reopens fresh, Repeats still offers the last count, and the Name and Text fields still show the plan's value after an undo or another layer is selected.
