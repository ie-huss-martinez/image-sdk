import { defineDependencyRules } from "@hussmartinez/sdk-config/dependency-cruiser";

/**
 * The family's layer rules, with the GIF encoder declared as a bundled
 * engine (sdk-core ADR 0061): it's built into the package from an exactly
 * pinned devDependency, rather than installed by applications
 * (docs/adr/0011, sdk-core ADR 0028), and only the GIF adapter that wraps
 * it may import it, as a value or as a type. `hm-check-bundled-engines`, in
 * `pnpm verify`, checks its pin.
 */
const rules = defineDependencyRules({
  bundledEngines: [{ packages: ["gifenc"], from: "adapters/gif" }],
});

/**
 * The package's imports of its inlined workers (`#hm-image-*-worker`) name
 * built files, which don't exist before a build. tsconfig.json's paths map
 * them to their source, as for typecheck, so the layer rules check those
 * edges too (sdk-core ADR 0060).
 *
 * Set on the rules rather than spread into a copy: the declared engines are
 * kept on them out of sight, for hm-check-bundled-engines, and a spread
 * would leave them behind.
 */
rules.options = { ...rules.options, tsConfig: { fileName: "tsconfig.json" } };

export default rules;
