/**
 * How long a test waits for the editor's first open or first render: the
 * file decoded in the render worker, the stage's first frame, or the
 * announcement an export makes when it's done. The first one starts the
 * worker and its decoders, which takes well over the default 5 s in WebKit
 * on a loaded machine. A file that never opens still fails; other waits keep
 * their 5 s.
 */
export const FIRST_OPEN_TIMEOUT = 30_000;
