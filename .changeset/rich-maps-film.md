---
"@hussmartinez/image-sdk": minor
---

An image engine that loses worker-owned sources or a transferred canvas now becomes terminal. Processing rejects `WORKER_TERMINATED` with `details.reason: "engine-invalidated"`; explicitly recreate the engine, processor and session, plus any renderer and its DOM canvas, then reopen the image. React hosts must remount and replace supplied resources; custom-element hosts must create a new element instance. The editor shows a translatable recovery notice. Unsaved edits need host-managed preservation; no automatic reload, remount or re-decoding occurs.
