import { withReactLint } from "@hussmartinez/sdk-config/lint-staged";

// sdk-config's preset, with the React lint after Biome whenever a commit
// stages TypeScript under src (sdk-core ADR 0063).
export default withReactLint();
