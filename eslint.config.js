import { defineReactLint } from "@hussmartinez/sdk-config/eslint-react";

// React's own lint plugin, and nothing else, with every rule on: Biome
// stays the linter and formatter (sdk-core ADR 0063).
export default await defineReactLint();
