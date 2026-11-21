# 0012. Interface text stays out of the server-safe entry

- **Status:** Accepted
- **Date:** 2026-11-17
- **Refines, for this SDK:** [sdk-core ADR 0019](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0019-message-catalogues.md) (message catalogues) and [sdk-core ADR 0046](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0046-ui-text-through-the-sdk.md) (ui's text through the SDK)
- **Amended:** 2026-11-21, as the family adopted this rule in [sdk-core ADR 0059](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0059-interface-text-outside-the-server-safe-entry.md), which this record now follows: `ImageEditorMessageCatalogue` is exported from `.` only, under "The type of the editor's catalogue"
- **Follows:** pdf-sdk's [ADR 0010](https://github.com/ie-huss-martinez/pdf-sdk/blob/main/docs/adr/0010-interface-text-outside-the-server-safe-entry.md), which made the same decision first

## Context

`.` is the server-safe, headless entry ([sdk-core ADR 0004](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0004-entry-points-and-module-format.md)). It exported `imageMessages`, which held every string the SDK has, and spread `@hussmartinez/ui`'s into it:

- 16 of its own keys are for errors and warnings, which the headless session produces and hosts show;
- 183 are for the interface: the editor, its stage, toolbar and tools, its panels, the redact tool and the export dialog. Nothing in `.` shows them.

So every interface string was shipped to every host of `.`, servers included, and counted against its size budget ([sdk-core ADR 0015](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0015-verification-and-releases.md)). Measured on the layer model's build, the catalogue's own text was 2.4 kB of the entry's 20.1 kB brotli, and the budget had been raised three times in a week, each time partly for strings: the Redact tool's alone added 26.

pdf-sdk met the same wall and moved its interface text behind its React entry. This record does the same, with the same shape and names, so the two SDKs read alike.

## Decision

- **`imageMessages`, from `.`, holds only text the headless entry produces:** sdk-core's messages, `errors.<CODE>` for every `ImageErrorCode`, and `warnings.<LIMIT>` for every limit. It no longer includes ui's messages. A unit test fails if any other key is added to it.
- **Interface text lives in `src/messages/editor-en.ts`,** as `imageEditorText`, which only the React entry imports. Every visible string still comes from `src/messages`.
- **`imageEditorMessages`, from `./react` and `./element`, is the components' catalogue:** `imageMessages`, ui's `uiMessages` and the interface text.
  - `ImageEditor`, `ImageEditorProvider` and `<hm-image-editor>` build their `Messages` from it.
  - `useImageMessages()` returns it.
  - Hosts type overrides of any key with `MessageOverrides<ImageEditorMessageCatalogue>`, from `.` (see below).
- **The keys and their text don't change,** nor does how the `messages` props and the element's `messages` property work.
- **Tools keep naming their labels by key,** such as `tools.crop`. A tool's definition holds the key, not the text, so tools stay where they are.
- **A headless host that shows errors needs nothing more:** `createMessages(imageMessages).error(error)` still has the text of every code and limit.

### The type of the editor's catalogue

Amended on 2026-11-21, for [sdk-core ADR 0059](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0059-interface-text-outside-the-server-safe-entry.md):

- **`ImageEditorMessageCatalogue` is exported from `.` only.** `./react` and `./element` both use it, and [sdk-core ADR 0033](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0033-api-reports-for-several-entry-points.md) lets them share a type without copying it only when `.` exports it.
- **It's written in `src/messages/editor-catalogue.ts`, from type-only imports.** It costs `.` no bytes and carries no interface text there.
- **Three unit tests hold the rule:**
  - `.`'s catalogue holds only sdk-core's keys, `errors.` and `warnings.`;
  - no interface key starts with one of those prefixes;
  - no interface key collides with `.`'s, sdk-core's or ui's.
- **This SDK names no other prefix for `.`,** and has no other aliases of the catalogue or its type to deprecate.

## Alternatives considered

- **Raising the budget of `.` again:** it would let interface text keep growing in an entry that never shows it, with drawing and animation still to add theirs.
- **Keeping ui's messages in `imageMessages`:** ui's text is for controls only the editor renders, so it's interface text too.
- **A third entry for the catalogue alone:** another entry point for hosts to learn and for the API reports to cover, when `./react` is already where the interface lives.
- **Different names from pdf-sdk's:** two SDKs that solve one problem two ways are harder to use together.

## Consequences

- **`.` dropped from 20.09 kB to 18.16 kB brotli,** and interface text no longer uses up its budget.
- **Breaking, before 1.0:**
  - a host that typed overrides of interface keys with `MessageOverrides<ImageMessageCatalogue>` types them with `ImageEditorMessageCatalogue`, from `.` since 0.12 (from `./react` or `./element` before);
  - a host that built its own `Messages` from `imageMessages` for the editor's components builds it from `imageEditorMessages`;
  - `imageMessages` no longer has ui's keys or the interface's.
- **`ImageEditorProvider` accepts overrides of the same keys as before,** ui's included.
- **The family adopted this rule** in sdk-core ADR 0059, as the amendment above records.
