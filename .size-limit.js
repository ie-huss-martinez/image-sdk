import { entryBudget, importBudget } from "@hussmartinez/sdk-config/size";

/**
 * Size budgets (ADR 0015, sdk-core ADR 0055 and ADR 0056), in brotli.
 *
 * - **Entry ceilings** measure each built entry and the chunks it loads up
 *   front, as built: an upper bound on what any application receives.
 * - **Import budgets** measure what an application ships when it imports
 *   part of an entry: bundled and minified with esbuild, without React, the
 *   family's packages and the entry's lazy chunks. Each entry that comes
 *   apart has a floor, a budget for each export over about 2 kB, and a
 *   typical application's set. A floor's limit is its measurement rounded up
 *   to the next 0.1 kB, and any other's to the next 0.5 kB. A floor that
 *   moves is a leak to fix, never a budget to raise: before 0.7.5, every
 *   import from the React entry shipped about 40 kB, the whole editor.
 * - **Lazy chunks** have budgets of their own, measured as built: the
 *   workers load with import(), through package.json's imports, from
 *   dist/lazy.
 *
 * The element entry ships whole, so it has only a ceiling.
 */

/** A budget measured on the built files, not bundled by esbuild. */
const built = (budget) => ({ ...budget, brotli: true, disablePlugins: ["@size-limit/esbuild"] });

export default [
  // The server-safe core (.).
  entryBudget({
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
    name: "Core (.), as built",
    entry: "dist/index.js",
    limit: "27.5 kB",
  }),
  importBudget({
    // The floor: the error class, which a host uses to tell the SDK's errors
    // apart. Measured at 70 B, once sdk-config 0.12.1 stopped counting the
    // names a bundle imports and never uses; 178 B before.
    name: "Core: the floor, ImageError",
    entry: "dist/index.js",
    imports: "{ ImageError }",
    limit: "0.1 kB",
  }),
  importBudget({
    name: "Core: createImageSession",
    entry: "dist/index.js",
    imports: "{ createImageSession }",
    limit: "12 kB",
  }),
  importBudget({
    name: "Core: createImageReducer",
    entry: "dist/index.js",
    imports: "{ createImageReducer }",
    limit: "6.5 kB",
  }),
  importBudget({
    name: "Core: readImagePlanDocument",
    entry: "dist/index.js",
    imports: "{ readImagePlanDocument }",
    limit: "5 kB",
  }),
  importBudget({
    name: "Core: createImageEngine",
    entry: "dist/index.js",
    imports: "{ createImageEngine }",
    limit: "2.5 kB",
  }),
  importBudget({
    // What a headless editor uses together: a session over the engine and processor.
    name: "Core: a headless editor's set",
    entry: "dist/index.js",
    imports: "{ createImageSession, createImageEngine, createImageProcessor }",
    limit: "14.5 kB",
  }),

  // The React entry (./react).
  entryBudget({
    // The core's 27.0 kB and the editor. Measured at 53.6 kB (41.3 kB
    // minified) with the editor's tools up to drawing (docs/adr/0013,
    // docs/adr/0015), the names of the frame commands for undo, an
    // animation's open, with its progress, notices and first frame on the
    // stage, its playing: the bar under the stage and the play tool, and the
    // frames panel: its list, actions, lazily drawn thumbnails and text
    // (docs/adr/0011), 2.4 kB over the 51.2 kB before the panel; crop,
    // redact, the layers' list and frames, the tools that add text, shapes
    // and images with their fields, and the interface's text. 54.1 kB (41.7 kB
    // minified), 0.1 kB over the 54.0 kB before its parts could be imported
    // apart (sdk-core ADR 0056): the functions that build its module-level
    // values so the calls can be marked free of side effects. One import
    // alone ships far less, such as the catalogue's 4.7 kB, not 40.5 kB.
    // Then 54.52 kB, with the state the dialog, the frames panel and the
    // layer fields reset while rendering rather than in effects (#147), and
    // the subscription for the editor's announcements (#149).
    name: "React (./react), as built",
    entry: "dist/react.js",
    limit: "55 kB",
  }),
  importBudget({
    // The floor: a hook over the provider, which every panel reads. Measured
    // at 126 B. It was 704 B while the measure counted the shared editor
    // chunk's whole list of names imported from sdk-core, React and ui, used
    // or not; sdk-config 0.12.1 measures only the names an import keeps.
    name: "React: the floor, useImageMessages",
    entry: "dist/react.js",
    imports: "{ useImageMessages }",
    limit: "0.2 kB",
  }),
  importBudget({
    // The interface's text.
    name: "React: imageEditorMessages",
    entry: "dist/react.js",
    imports: "{ imageEditorMessages }",
    limit: "5 kB",
  }),
  importBudget({
    name: "React: ImageExportDialog",
    entry: "dist/react.js",
    imports: "{ ImageExportDialog }",
    limit: "3.5 kB",
  }),
  importBudget({
    name: "React: imageTools",
    entry: "dist/react.js",
    imports: "{ imageTools }",
    limit: "4 kB",
  }),
  importBudget({
    // Measured at 4.95 kB. It was raised to 5.5 kB when unused import names
    // counted (5.00 kB then); sdk-config 0.12.1 stopped counting them.
    name: "React: ImageFramesPanel",
    entry: "dist/react.js",
    imports: "{ ImageFramesPanel }",
    limit: "5 kB",
  }),
  importBudget({
    name: "React: ImageFilterPanel",
    entry: "dist/react.js",
    imports: "{ ImageFilterPanel }",
    limit: "8 kB",
  }),
  importBudget({
    name: "React: ImageAdjustPanel",
    entry: "dist/react.js",
    imports: "{ ImageAdjustPanel }",
    limit: "8 kB",
  }),
  importBudget({
    name: "React: ImageRedactPanel",
    entry: "dist/react.js",
    imports: "{ ImageRedactPanel }",
    limit: "9.5 kB",
  }),
  importBudget({
    name: "React: ImageDrawPanel",
    entry: "dist/react.js",
    imports: "{ ImageDrawPanel }",
    limit: "9.5 kB",
  }),
  importBudget({
    name: "React: ImageLayersPanel",
    entry: "dist/react.js",
    imports: "{ ImageLayersPanel }",
    limit: "11 kB",
  }),
  importBudget({
    // The stage, with its renderer and overlays.
    name: "React: ImageStage",
    entry: "dist/react.js",
    imports: "{ ImageStage }",
    limit: "19.5 kB",
  }),
  importBudget({
    // A provider creates the engine, processor and session it isn't given.
    // Measured at 19.49 kB locally and 19.52 kB in the release pull
    // request's CI, with the same code kept (hm-size --kept): 19.5 kB left
    // 10 B to spare, less than one build differs from another.
    name: "React: ImageEditorProvider",
    entry: "dist/react.js",
    imports: "{ ImageEditorProvider }",
    limit: "20 kB",
  }),
  importBudget({
    // What a typical application imports: the whole editor.
    name: "React: ImageEditor",
    entry: "dist/react.js",
    imports: "{ ImageEditor }",
    limit: "41 kB",
  }),

  // The element entry (./element), which ships whole.
  entryBudget({
    // The React entry and the element's own mount: measured at 55.1 kB
    // (42.4 kB minified), 0.1 kB over the 55.0 kB before the React entry's
    // parts could be imported apart (sdk-core ADR 0056). The element ships
    // whole. Then 55.51 kB, with the React entry's changes of #147 and #149.
    name: "Element (./element), as built",
    entry: "dist/element.js",
    limit: "56 kB",
  }),

  built({ name: "Stylesheet (./styles.css)", path: "dist/styles.css", limit: "10 kB" }),
  built({
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
    path: "dist/lazy/inline-worker.js",
    limit: "24 kB",
  }),
  built({
    // The job worker, inlined as a minified string and loaded on the first
    // GIF export (docs/adr/0011): gifenc and the SDK's GIF writer. Measured
    // at 6.8 kB; docs/adr/0011 expected about 8 kB.
    name: "Job worker, inlined (lazy)",
    path: "dist/lazy/inline-job-worker.js",
    limit: "7 kB",
  }),
];
