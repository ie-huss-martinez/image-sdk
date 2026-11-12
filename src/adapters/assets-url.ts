// TODO(sdk-core 0.3.0): replace with `resolveAssetsBase` from
// `@hussmartinez/sdk-core` (sdk-core ADR 0038) once 0.3.0 passes the
// release-age policy.
/**
 * `assetsUrl` as an absolute URL ending in a slash. `assetsUrl` is where the
 * application serves the package's `dist/assets/` directory, which holds
 * `image/render.worker.js` (docs/adr/0002). Relative URLs resolve against the
 * page.
 */
export function assetsBase(assetsUrl: string | URL | undefined): string | undefined {
  if (assetsUrl === undefined) return undefined;
  const base = new URL(String(assetsUrl), globalThis.location?.href).href;
  return base.endsWith("/") ? base : `${base}/`;
}
