/**
 * How long a test waits for the editor's first render after an open: the
 * preview appearing once the render worker has decoded the file and drawn
 * the stage's first frame. The first one starts the worker and its decoders,
 * which takes well over the default 5 s in WebKit on a loaded machine. An
 * image that never shows still fails; other assertions keep their defaults.
 */
export const FIRST_RENDER_TIMEOUT = 30_000;
