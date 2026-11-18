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
    // 26.0 kB (19.9 kB minified) with animations (docs/adr/0011): sources
    // that hold their frames, the session that opens them, with its
    // progress, the limits on holding an animation and the still it opens
    // as over them, and a host's animated plan applied as commands; 1.2 kB
    // over the 24.8 kB of the plan's format version 4: the
    // animation's frames and loop count, their commands and the document's
    // frame counts (docs/adr/0011), 1.3 kB over version 3's 23.6 kB; the
    // keyed-list reducer; the
    // layer model, its checks, commands and geometry, with text fitting and
    // new layers' placement; drawings, strokes and arrows, with the exact
    // stroke simplifier, the arrow's outline and their bounds
    // (docs/adr/0014); redaction's commands and geometry; the migrations;
    // the session's layer sources and its limits on drawn points; and the
    // text of errors and warnings. 27.0 kB (20.7 kB minified) with the
    // session's first frame while an animation opens (docs/adr/0011), 0.1 kB
    // over the 26.9 kB before it.
    path: ["dist/index.js", "dist/shared/core-*.js"],
    brotli: true,
    limit: "27.5 kB",
  },
  {
    // The core's 27.0 kB and the editor. Measured at 51.2 kB (39.4 kB
    // minified) with the editor's tools up to drawing (docs/adr/0013,
    // docs/adr/0015), the names of the frame commands for undo, an
    // animation's open, with its progress, notices and first frame on the
    // stage, and its playing: the bar under the stage, with a Pause icon
    // while it plays, and the play tool (docs/adr/0011), 0.3 kB over the
    // 50.9 kB before the first frame; crop, redact, the layers' list and
    // frames, the tools that add text, shapes and images with their fields,
    // and the interface's text.
    name: "React entry (./react), with the shared code it loads",
    path: ["dist/react.js", "dist/shared/*.js"],
    brotli: true,
    limit: "51.5 kB",
  },
  {
    // The React entry and the element's own mount: measured at 52.2 kB
    // (40.1 kB minified), 0.3 kB over the 51.9 kB before the first frame
    // while an animation opens.
    name: "Element entry (./element), with the shared code it loads",
    path: ["dist/element.js", "dist/shared/*.js"],
    brotli: true,
    limit: "52.5 kB",
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
    // decoder (docs/adr/0011) with its frame store and the check of every
    // frame of a source held with its frames, whose first frame is drawn while
    // the rest are checked. Measured at 23.5 kB (23.2 kB minified), 1.2 kB
    // over the 22.3 kB it was with the first frame only;
    // docs/adr/0009 expected the decoder to bring it to about 28 kB.
    name: "Render worker, inlined (lazy)",
    path: "dist/lazy/inline-worker-*.js",
    brotli: true,
    limit: "24 kB",
  },
  {
    // The job worker, inlined as a minified string and loaded on the first
    // GIF export (docs/adr/0011): gifenc and the SDK's GIF writer. Measured
    // at 6.8 kB; docs/adr/0011 expected about 8 kB.
    name: "Job worker, inlined (lazy)",
    path: "dist/lazy/inline-job-worker-*.js",
    brotli: true,
    limit: "7 kB",
  },
];
