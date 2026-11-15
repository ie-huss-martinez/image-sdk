---
"@hussmartinez/image-sdk": minor
---

The editor shows the stage's warnings and a new Info panel (docs/adr/0007).

- **Notices:** the limits an opened image comes near, such as a large file or many frames, and, when it has a colour profile, that colours outside sRGB will be clipped in the exported file. They're polite notices at the foot of the stage, each with a Dismiss button. A dismissed notice shows again for another image that has it.
- **`ImageInfoPanel`:** a third inspector panel, Info, with the image's upright size, format, frames and file size, the kinds of metadata it carries, and the fields kept on export. It never shows the file's name.
- **`ImageSessionSource.fileSize`:** the opened file's size in bytes.
