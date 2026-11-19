---
"@hussmartinez/image-sdk": patch
---

A preview render cancelled through its `signal` while it waits for another render to finish is now refused with `ABORTED`, and is never drawn. Before, it was drawn in full and resolved `"drawn"`, as if it hadn't been cancelled.

The editor isn't affected: it never passes a signal to `render()`. Only hosts that call `createImageRenderer` themselves and cancel renders with a `signal` will see the difference.
