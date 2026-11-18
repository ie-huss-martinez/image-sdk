import { isImageError } from "../../core/errors/image-error.js";
import { createGifFrameStore, type GifFrameStore } from "./frame-store.js";
import type { GifFile } from "./frames.js";

/**
 * A GIF held with all its frames (docs/adr/0011): the store that reaches
 * any of them, how many decoded, and how the file plays them.
 */
export interface GifSource {
  readonly store: GifFrameStore;
  readonly width: number;
  readonly height: number;
  /** The frames that decoded: those the source holds, from the first. */
  readonly frames: number;
  /** Whether the file's frames ended early: before its trailer, or at one that couldn't be decoded. */
  readonly incomplete: boolean;
  readonly loop: number | null;
  /** One delay for each frame held, in hundredths of a second. */
  readonly delays: readonly number[];
  /** The bytes this holds: the file, a screen, and the cache at its fullest. */
  readonly bytes: number;
}

/** What the check of a file's frames needs from its caller. */
export interface GifCheckOptions {
  readonly signal: AbortSignal;
  /**
   * Called after each frame that decodes, with how many have, how many the
   * file lists, and the screen as that frame shows it: the store's own
   * buffer, which the next frame changes, so copy it to keep it.
   */
  readonly progress?: (done: number, total: number, screen: Uint8ClampedArray) => void;
  /** Lets other work run: called when a slice of decoding has taken long enough. */
  readonly pause?: () => Promise<void>;
  /** The clock, in milliseconds. */
  readonly now?: () => number;
}

/** How long decoding runs before it lets the worker's other messages in. */
const SLICE = 12;

/** A turn of the event loop, without the timer's minimum delay. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
}

/**
 * Decodes every frame of a GIF once, in order, and ends the animation at
 * the frame before the first that can't be decoded (docs/adr/0011): so no
 * frame the source holds can fail later. A frame can be whole in the frame
 * table and still not decode, and only decoding finds that.
 *
 * It reports each frame, stops when its signal is aborted, and pauses for
 * the worker's messages between slices, so a cancel is answered within one
 * frame's decode and other calls aren't held up. The frames it decodes fill
 * the store's cache, so the work isn't thrown away.
 *
 * @throws The signal's reason when it's aborted, and `ImageError` with
 *   `INVALID_IMAGE` when the first frame can't be decoded: there's nothing
 *   to show.
 */
export async function checkGifFrames(
  bytes: Uint8Array,
  file: GifFile,
  options: GifCheckOptions,
): Promise<GifSource> {
  const { signal, progress, pause = nextTask, now = () => performance.now() } = options;
  const store = createGifFrameStore(bytes, file);
  const total = file.frames.length;
  let frames = 0;
  let slice = now();
  while (frames < total) {
    if (signal.aborted) throw signal.reason;
    try {
      store.frame(frames);
    } catch (error) {
      // The first frame is the image: without it there's nothing to open.
      if (frames === 0 || !isImageError(error, "INVALID_IMAGE")) throw error;
      break;
    }
    frames += 1;
    // The frame just decoded: the store shows it without decoding it again.
    progress?.(frames, total, store.frame(frames - 1));
    if (frames < total && now() - slice >= SLICE) {
      await pause();
      slice = now();
    }
  }
  if (signal.aborted) throw signal.reason;
  const screen = file.width * file.height * 4;
  return {
    store,
    width: file.width,
    height: file.height,
    frames,
    incomplete: !file.complete || frames < total,
    loop: file.loop,
    delays: file.frames.slice(0, frames).map((frame) => frame.delay),
    // The cache's ceiling, not what it holds now: it fills as frames are asked for.
    bytes: bytes.byteLength + screen + store.ceiling,
  };
}
