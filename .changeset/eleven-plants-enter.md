---
"@hussmartinez/image-sdk": patch
---

`ImageSession.open()` and `export()` now apply `filePolicy.maxProcessingTime` (120 seconds by default), aborting with `PROCESSING_TIME_EXCEEDED` and limit details. Custom adapters must honor the supplied signal; arbitrary host adapters cannot be preempted.
