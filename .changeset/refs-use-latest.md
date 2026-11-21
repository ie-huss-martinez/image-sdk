---
"@hussmartinez/image-sdk": patch
---

`ImageEditor` now keeps your latest `onChange` with `@hussmartinez/ui`'s `useLatest`, which takes it as each render commits, instead of writing a ref while rendering. The crop frame no longer builds its pointer handlers while it renders. Nothing you can see changes. The package now depends on `@hussmartinez/ui` `^0.16.3`.
