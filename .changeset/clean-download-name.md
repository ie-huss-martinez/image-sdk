---
"@hussmartinez/image-sdk": patch
---

The export dialog cleans the download's name you pass as `fileName`, as sdk-core's `cleanFileName` cleans a file's name. A name you take from the user's own file can hold a path, control characters or a right-to-left override that disguises an extension. Those are removed, along with characters file systems refuse, and the name is shortened so it fits in 128 characters with its extension. A name with nothing usable left downloads as `image`. The SDK now depends on `@hussmartinez/sdk-core` `^0.4.7`.
