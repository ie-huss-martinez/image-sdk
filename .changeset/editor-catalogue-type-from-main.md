---
"@hussmartinez/image-sdk": minor
---

`ImageEditorMessageCatalogue`, the type of the editor's message catalogue, is now exported from the main entry, `@hussmartinez/image-sdk`, and no longer from `@hussmartinez/image-sdk/react` or `@hussmartinez/image-sdk/element`. That's where the whole SDK family exports its editors' catalogue types (sdk-core ADR 0059). Importing it costs nothing at run time: it's a type, and the main entry still carries none of the editor's text.

**Breaking:** if you import the type from `./react` or `./element`, import it from the main entry instead:

```ts
import type { ImageEditorMessageCatalogue } from "@hussmartinez/image-sdk";
```

Its keys and text haven't changed, and neither have `imageEditorMessages` or the `messages` props and property.
