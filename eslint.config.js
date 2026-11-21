import { defineReactLint } from "@hussmartinez/sdk-config/eslint-react";

// React's own lint plugin, and nothing else: Biome stays the linter and
// formatter (sdk-core ADR 0063).
export default await defineReactLint({
  // Off while they have findings, each until the pull request that fixes it
  // turns it back on:
  // - refs, 2: ImageEditor's latest onChange, kept in a ref while it
  //   renders, and CropFrame's drag state; with ui's useLatest.
  off: ["refs"],
});
