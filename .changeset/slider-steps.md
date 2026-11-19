---
"@hussmartinez/image-sdk": minor
---

The Adjust and Filters sliders now make one undo step per key press, and one for a key held down, as the other editors in the family do. Before, a quick run of separate presses became one step, half a second after the last. A drag is still one step, and Escape during a drag or while a key is held still puts the slider back, with no step.

The SDK now depends on `@hussmartinez/ui` `^0.15.0`, whose `Slider` decides when a gesture ends and cancels it with Escape.
