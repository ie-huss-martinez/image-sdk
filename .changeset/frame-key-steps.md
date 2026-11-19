---
"@hussmartinez/image-sdk": minor
---

Moving or resizing a redaction or a layer with the arrow keys now makes one undo step per key press, and one for a key held down, as the sliders do. Before, a quick run of presses became one step, half a second after the last. Escape while an arrow key is held puts the frame back where it was, and leaves the tool open; Escape with nothing in progress still closes it. Typing in a text layer is unchanged: one step half a second after the last keystroke.
