/**
 * Size budgets per entry point (ADR 0015): the brotli size of each built
 * entry, with the shared chunks it loads. They measure the unminified files in
 * dist, an upper bound: applications ship less, because their bundler
 * minifies and drops what they don't import.
 *
 * These are starting ceilings for what each entry should hold. Worker,
 * WebAssembly and image engine code loads lazily in its own chunks, which get
 * their own budgets when they're added. The feature pull requests revisit
 * these against real sizes.
 */
export default [
  {
    name: "Server-safe core (.), with the shared code it loads",
    // The core never loads the React editor's chunks, nor the interface's
    // text, which the React entry holds (docs/adr/0012). Measured at
    // 18.2 kB with the plan's format version 2: the keyed-list reducer; the
    // layer model, its checks and its commands; redaction's commands and
    // geometry; the migration; and the text of errors and warnings.
    path: ["dist/index.js", "dist/shared/core-*.js"],
    brotli: true,
    limit: "19 kB",
  },
  {
    name: "React entry (./react), with the shared code it loads",
    path: ["dist/react.js", "dist/shared/*.js"],
    brotli: true,
    limit: "40 kB",
  },
  {
    name: "Element entry (./element), with the shared code it loads",
    path: ["dist/element.js", "dist/shared/*.js"],
    brotli: true,
    limit: "40 kB",
  },
  {
    name: "Stylesheet (./styles.css)",
    path: "dist/styles.css",
    brotli: true,
    limit: "10 kB",
  },
  {
    // The render worker, inlined as a minified string and loaded on the first
    // call (docs/adr/0002): the probes, the decoder and its orientation
    // calibration, the renderer, the encoders' metadata rewrite, and develop
    // and filters (docs/adr/0006). Measured at 18.5 kB with develop and
    // redaction's two passes (docs/adr/0010); the layers will join it.
    name: "Render worker, inlined (lazy)",
    path: "dist/lazy/inline-worker-*.js",
    brotli: true,
    limit: "20 kB",
  },
];
