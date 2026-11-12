---
"@hussmartinez/image-sdk": minor
---

First release of `@hussmartinez/image-sdk`, an image SDK that works entirely in the browser: images are opened, edited and exported on the user's device and never uploaded.

- **Package shape:** an ES module package with a server-safe headless core (`@hussmartinez/image-sdk`), a React entry (`@hussmartinez/image-sdk/react`), a custom element entry (`@hussmartinez/image-sdk/element`) and one stylesheet (`@hussmartinez/image-sdk/styles.css`), which applications import once. React and React DOM 18.3 or later are optional peer dependencies.
- **Errors:** every failure is an `ImageError` with a stable `code`, such as `INVALID_IMAGE`, `UNSUPPORTED_FORMAT`, `DECODE_FAILED` or `IMAGE_TOO_LARGE`, and structured `details`. `isImageError(error, code)` checks one, across workers and copies of the package.
- **Limits for untrusted files:** `imageLimits` adds `maxImagePixels`, `maxImageDimension`, `maxFrames`, `maxSessionSize` and `maxLayers` to the family's limits on file size, file count, decoded size and processing time, with defaults sized for images: 50 megapixels per image and 1 GB of decoded images. `maxImagePixels` has the same name and code as in `@hussmartinez/pdf-sdk`. Set them with a `filePolicy`; a misspelt limit name throws instead of being ignored.
- **Translatable text:** `imageMessages` is the English catalogue for every error code and limit warning, for `createMessages` from `@hussmartinez/sdk-core`. Error text comes from the code and its details, never from the error's message.
