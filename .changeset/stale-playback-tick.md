---
"@hussmartinez/image-sdk": patch
---

Pausing an animation, or moving to another frame, while it plays now always holds. Before, on a busy device, the frame that was about to show could still come and start the animation playing again, or replace the frame chosen.
