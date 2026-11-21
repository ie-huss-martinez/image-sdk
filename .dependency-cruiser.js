import preset from "@hussmartinez/sdk-config/dependency-cruiser";

/**
 * The GIF encoder is bundled into the package from an exactly pinned
 * devDependency, rather than installed by applications (docs/adr/0011,
 * sdk-core ADR 0028). Only the GIF adapter that wraps it may import it;
 * everywhere else in src/, the preset's rule against devDependencies
 * applies as it is. The PDF SDK does the same for its engines.
 */
const BUNDLED_ENGINES = ["gifenc"];
const ENGINE_LAYER = "(?:^|/)src/adapters/gif/";
const engines = `(?:^|/)node_modules/(?:${BUNDLED_ENGINES.join("|")})/`;

const forbidden = preset.forbidden.flatMap((rule) => {
  if (rule.name !== "not-to-dev-dep") return [rule];
  return [
    { ...rule, from: { ...rule.from, pathNot: [rule.from.pathNot, ENGINE_LAYER].flat() } },
    {
      ...rule,
      name: "not-to-dev-dep-except-bundled-engines",
      comment:
        "The GIF adapter may import only the bundled encoder from devDependencies (docs/adr/0011).",
      from: { ...rule.from, path: ENGINE_LAYER },
      to: { ...rule.to, pathNot: [rule.to.pathNot, engines].flat().filter(Boolean) },
    },
  ];
});

/**
 * The package's imports of its inlined workers (`#hm-image-*-worker`) name
 * built files, which don't exist before a build. tsconfig.json's paths map
 * them to their source, as for typecheck, so the layer rules check those
 * edges too (sdk-core ADR 0060).
 */
export default {
  ...preset,
  forbidden,
  options: { ...preset.options, tsConfig: { fileName: "tsconfig.json" } },
};
