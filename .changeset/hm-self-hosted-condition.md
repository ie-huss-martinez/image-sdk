---
"@hussmartinez/image-sdk": patch
---

A build that self-hosts the SDK's workers can now leave the inlined copies out. Set the family's `hm-self-hosted` resolve condition in your bundler, for example `resolve: { conditions: [...defaultClientConditions, "hm-self-hosted"] }` in Vite. The inlined render and job workers then resolve to a small stub instead, saving two chunks of about 91 kB together, 30 kB compressed, that your app never loaded.

With the condition set, everything that creates an engine needs `assetsUrl`: `createImageEngine`, and the `assetsUrl` of `ImageEditor`, `ImageEditorProvider` and `<hm-image-editor>`. A worker started without it fails with `WORKER_START_FAILED`, whose `details` are `{ condition: "hm-self-hosted", missing: "assetsUrl" }`. Without the condition, nothing changes. `docs/hosting.md` shows the Vite and esbuild settings.
