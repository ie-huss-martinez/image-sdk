---
"@hussmartinez/image-sdk": minor
---

GIFs are decoded by the SDK's own decoder, and malformed GIFs that browsers show now open ([ADR 0011](https://github.com/ie-huss-martinez/image-sdk/blob/main/docs/adr/0011-gif-and-animation.md)).

- **What you see is the same.** A GIF still opens as its first frame, and that frame is, pixel for pixel, the one the browser's decoder drew, in Chromium, Firefox and WebKit.
- **The browser's decoder no longer sees a GIF.** The file's blocks were already walked by the SDK's own code before anything decoded it; now its pixels are decoded by it too, the same way in every browser.
- **Fixed: GIFs that browsers show were refused.** Up to 0.5.0, a GIF was refused with `INVALID_IMAGE` unless every block of it could be read through to its trailer, so a file that had lost its last bytes, or had a damaged frame after its first, didn't open. Now the file's frames end where it stops being a GIF, and it opens as long as its first frame is whole.
- **A GIF that can't be shown whole fails as `INVALID_IMAGE`,** with what was wrong in `details.problem`. Before, it could fail as `DECODE_FAILED`, or open as a partly drawn or empty image, depending on the browser.

What opens, beside what `createImageBitmap` makes of the same file's first frame in each browser:

| The file's defect | Chromium | Firefox | WebKit | 0.5.0 | Now |
| --- | --- | --- | --- | --- | --- |
| Bytes after the trailer | opens | opens | opens | opens | opens |
| Data after a frame's last pixel: more pixels, or bytes after the end code | opens | opens | opens | opens | opens |
| No end code, with every pixel there | opens | opens | opens | opens | opens |
| No trailer | opens | opens | empty image | refused | opens |
| A later frame cut short, or the file cut inside a later block | opens | opens | opens, or empty image | refused | opens, as the frames before it |
| A block that isn't one, after a frame | opens | opens | opens | refused | opens, as the frames before it |
| A later frame outside the screen, or with a code size out of range | opens | opens | opens | refused | opens, as the frames before it |
| A reserved disposal method | opens | opens | opens | refused | opens |
| A code size of 1 | opens | refused | empty image | refused | opens |
| A pixel that names a colour its table doesn't have | opens, as black | opens, as another colour | opens, not drawn | as the browser | opens, not drawn |
| A frame with no colour table at all | opens | opens | empty image | as the browser | opens, nothing drawn |
| The first frame's data cut short | refused | opens, partly made up | empty image | refused | refused |
| The first frame's data holds fewer pixels than the frame, or uses a code that isn't defined | refused | refused, or made up | empty image | as the browser | refused |
| The first frame outside the screen | refused, or opens | opens, at another size than Chromium, or refused | opens, or empty image | refused | refused |

If you matched on `DECODE_FAILED` for GIFs, match on `INVALID_IMAGE` too. Opening a GIF as an animation, and writing one, come in a later release.
