---
"@hussmartinez/image-sdk": patch
---

The export summary no longer says details are kept in a WebP file. WebP exports carry no metadata, as they never have, but the dialog listed the fields you filled in under "Kept in the file", and `session.export` reported them in `kept`. Now, for WebP as for GIF, `kept` is empty and the dialog says "A WebP file carries no details: these aren't written to it." PNG and JPEG keep the fields as before.
