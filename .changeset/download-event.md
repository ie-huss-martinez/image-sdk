---
"@hussmartinez/image-sdk": minor
---

`onEvent` now receives a `download` event when the export dialog's Download button is pressed: the editor asked the browser to download the file. Until now the last event was `export`, sent when the file is ready, before the user chooses to download it, so a guard against leaving with unsaved work could clear too early. Wait for `download` instead.

It marks the request, not a confirmed save: in a sandboxed frame without `allow-downloads` no download starts, and a person can cancel the browser's prompt. If you need to know the file was saved, pass `onExport` and save it yourself.

`ImageSessionEvent["type"]` gains `"download"`. The event carries what `export` carries, `{ type, outcome: "done", commands: [] }`, and nothing about the file. It's sent each time Download is pressed. With `onExport`, your code saves the file, so there's no `download` event. The `<hm-image-editor>` element's `event` passes it on too.
