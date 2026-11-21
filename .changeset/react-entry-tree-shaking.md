---
"@hussmartinez/image-sdk": patch
---

Importing one part of `@hussmartinez/image-sdk/react` no longer ships the whole editor. Before, every import from the React entry, even the message catalogue `imageEditorMessages` alone, brought about 40 kB (brotli, minified) into your bundle, because module-level values that a bundler couldn't prove free of side effects kept the editor's code alive. Now each import carries only what it uses:

- the hooks, such as `useImageSession`: about 0.7 kB;
- `imageEditorMessages`: 4.7 kB, its text;
- a panel: from 1.1 kB (`ImageInfoPanel`) to 10.6 kB (`ImageLayersPanel`);
- `ImageEditor`: 40.6 kB, as before.

Constants from the `.` entry, such as `UPRIGHT`, go from 1.4 kB to 0.2 kB. The API is unchanged. Bundling the whole editor costs about 0.1 kB more than before.
