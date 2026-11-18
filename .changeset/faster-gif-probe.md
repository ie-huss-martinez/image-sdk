---
"@hussmartinez/image-sdk": patch
---

A large GIF starts to open sooner. Before decoding, the SDK walks the file's blocks to check its size and frame count. It now reads the data of each frame in 64 KiB views instead of one sub-block at a time. Nothing else changes: the same files open, with the same frames, and the same files are refused with the same errors.
