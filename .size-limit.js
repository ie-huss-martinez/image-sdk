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
    // 23.6 kB with the plan's format version 3: the keyed-list reducer; the
    // layer model, its checks, commands and geometry, with text fitting and
    // new layers' placement; drawings, strokes and arrows, with the exact
    // stroke simplifier, the arrow's outline and their bounds
    // (docs/adr/0014); redaction's commands and geometry; the migrations;
    // the session's layer sources and its limits on drawn points; and the
    // text of errors and warnings.
    path: ["dist/index.js", "dist/shared/core-*.js"],
    brotli: true,
    limit: "24 kB",
  },
  {
    // The core's 23.6 kB and the editor. Measured at 46.5 kB (35.6 kB
    // minified) with the editor's tools up to drawing (docs/adr/0013,
    // docs/adr/0015):
    // crop, redact, the layers' list and frames, the tools that add text,
    // shapes and images with their fields, and the interface's text.
    name: "React entry (./react), with the shared code it loads",
    path: ["dist/react.js", "dist/shared/*.js"],
    brotli: true,
    limit: "47 kB",
  },
  {
    // The React entry and the element's own mount: measured at 47.5 kB.
    name: "Element entry (./element), with the shared code it loads",
    path: ["dist/element.js", "dist/shared/*.js"],
    brotli: true,
    limit: "48 kB",
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
    // calibration, the renderer, the encoders' metadata rewrite, develop and
    // filters (docs/adr/0006), redaction's two passes (docs/adr/0010), the
    // layer renderer with drawings and arrows, and the SDK's own GIF
    // decoder (docs/adr/0011). Measured at 22.2 kB with the GIF decoder,
    // which docs/adr/0009 expected to bring it to about 28 kB.
    name: "Render worker, inlined (lazy)",
    path: "dist/lazy/inline-worker-*.js",
    brotli: true,
    limit: "23 kB",
  },
];
