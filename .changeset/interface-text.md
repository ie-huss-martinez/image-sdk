---
"@hussmartinez/image-sdk": minor
---

**Breaking:** the editor's text moves out of the server-safe entry. `imageMessages`, from `@hussmartinez/image-sdk`, now holds only what the headless entry produces: sdk-core's messages, and the text of every error code and limit warning. The editor's own text, and ui's, are in `imageEditorMessages`, from `@hussmartinez/image-sdk/react` and `@hussmartinez/image-sdk/element` ([ADR 0012](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0012-interface-text-outside-the-server-safe-entry.md)).

The headless entry is about 1.9 kB smaller (20.09 kB to 18.16 kB brotli), and servers that import it no longer carry text they never show. No key or text changes, and the `messages` props and the element's `messages` property work as before.

### Migrating

Most hosts change nothing: `<ImageEditor messages={{ "tools.crop": "Trim" }} />` works as it did.

If you type your overrides, or build your own `Messages` for the editor's components:

```ts
// Before
import { type ImageMessageCatalogue, imageMessages } from "@hussmartinez/image-sdk";
const overrides: MessageOverrides<ImageMessageCatalogue> = { "tools.crop": "Trim" };
const messages = createMessages(imageMessages, { overrides });

// After
import {
  type ImageEditorMessageCatalogue,
  imageEditorMessages,
} from "@hussmartinez/image-sdk/react";
const overrides: MessageOverrides<ImageEditorMessageCatalogue> = { "tools.crop": "Trim" };
const messages = createMessages(imageEditorMessages, { overrides });
```

Headless code that shows errors keeps `imageMessages`: `createMessages(imageMessages).error(error)` still has every code's text.
