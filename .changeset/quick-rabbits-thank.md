---
"@hussmartinez/image-sdk": patch
---

`ImageEditor` and `createImageEngine` now accept relative `assetsUrl` values during server rendering without starting a worker. Asset URLs are validated at setup and resolved against the browser page only when the worker starts. The minimum `@hussmartinez/sdk-core` dependency is now `^0.4.4`.
