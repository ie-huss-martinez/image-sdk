---
"@hussmartinez/image-sdk": patch
---

A GIF whose first frame is larger than its logical screen now opens, where it was refused with `INVALID_IMAGE` ([ADR 0011](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0011-gif-and-animation.md)).

Some encoders write a screen smaller than the image. When the first frame is at 0, 0 and at least as wide and as tall as the screen, the image is that frame, at the frame's size: what Chromium, Firefox and WebKit all show. The probe reports that size, so `maxImageDimension`, `maxImagePixels` and `maxDecodedSize` apply to it.

A first frame outside the screen in any other way is still refused: wider than the screen but not as tall, or away from its corner. Browsers open those at sizes that differ from one another.
