import { createGifComposer, type GifSnapshot } from "./compose.js";
import type { GifFile } from "./frames.js";

/** How much a store's cache of composed frames may hold, unless it's told otherwise: 64 MiB. */
export const GIF_CACHE_BYTES = 64 * 1024 * 1024;

/**
 * Any frame of a GIF, composed, without holding every frame
 * (docs/adr/0011). A frame of an animation depends on the frames before
 * it, so reaching one means composing forward from a frame that's known.
 * The store holds:
 *
 * - the file's bytes and its frame table, which it's given;
 * - one screen, as it stands after the last frame asked for;
 * - a cache of snapshots, evenly spaced through the frames, bounded in
 *   bytes.
 *
 * Playing forward decodes one frame for each frame. A jump decodes forward
 * from the nearest of: the frame the screen shows, the cached snapshot at
 * or before the frame wanted, and the start. The snapshots are spaced so
 * that, once a stretch has been played through, a jump into it costs at
 * most {@link GifFrameStore.spacing} decodes.
 */
export interface GifFrameStore {
  /** How many frames the file has. */
  readonly frames: number;
  /**
   * How far apart the cached snapshots are: 1 when the cache holds every
   * frame, more for a file too large for that, and 0 when it holds none.
   */
  readonly spacing: number;
  /** The bytes the cache holds now. */
  readonly cached: number;
  /** The most bytes the cache can come to hold, from how it was planned: within its bound. */
  readonly ceiling: number;
  /** How many frames have been decoded since the store was made: what its work has cost. */
  readonly decoded: number;
  /**
   * The screen as frame `index` shows it: `width × height` RGBA pixels, not
   * premultiplied. It's the store's own buffer, changed by the next call:
   * copy it to keep it.
   *
   * @throws `RangeError` for a frame the file doesn't have, and `ImageError`
   *   with `INVALID_IMAGE` for a frame that can't be decoded, on the way or
   *   itself. The store can still be asked for the frames before it.
   */
  frame(index: number): Uint8ClampedArray<ArrayBuffer>;
}

/** Options of {@link createGifFrameStore}. */
export interface GifFrameStoreOptions {
  /** The most bytes the cache of snapshots holds. */
  readonly cacheBytes?: number;
}

/**
 * Creates a {@link GifFrameStore} over a file and its frame table.
 *
 * The cache is planned from the file before anything is decoded: a
 * snapshot is a screen, and for a frame that restores what was under it
 * (disposal 3) a second copy of at most a screen, so the worst case is two.
 * The spacing is the smallest that keeps every snapshot within the bound.
 */
export function createGifFrameStore(
  bytes: Uint8Array,
  file: GifFile,
  options: GifFrameStoreOptions = {},
): GifFrameStore {
  const composer = createGifComposer(bytes, file);
  const count = file.frames.length;
  const screenBytes = file.width * file.height * 4;
  const restores = file.frames.some((frame) => frame.disposal === 3);
  const room = Math.floor(
    (options.cacheBytes ?? GIF_CACHE_BYTES) / (screenBytes * (restores ? 2 : 1)),
  );
  // Snapshots at frames 0, spacing, 2 × spacing…: as many as there's room for.
  const spacing = room <= 0 ? 0 : Math.ceil(count / room);
  const snapshots = new Map<number, GifSnapshot>();
  let cached = 0;
  let decoded = 0;
  const keep = (index: number) => {
    if (spacing === 0 || index % spacing !== 0 || snapshots.has(index)) return;
    const snapshot = composer.snapshot();
    snapshots.set(index, snapshot);
    cached += snapshot.screen.byteLength + (snapshot.saved?.byteLength ?? 0);
  };

  return {
    frames: count,
    spacing,
    ceiling: spacing === 0 ? 0 : Math.ceil(count / spacing) * screenBytes * (restores ? 2 : 1),
    get cached() {
      return cached;
    },
    get decoded() {
      return decoded;
    },
    frame(index) {
      if (!Number.isInteger(index) || index < 0 || index >= count) {
        throw new RangeError(`The GIF has no frame ${index}.`);
      }
      if (composer.shown !== index) {
        // The nearest known frame at or before the one wanted: the screen
        // as it stands, a snapshot, or the start.
        const from = composer.shown <= index ? composer.shown : -1;
        const nearest = spacing === 0 ? -1 : index - (index % spacing);
        const snapshot = nearest > from ? snapshots.get(nearest) : undefined;
        if (snapshot) composer.restore(snapshot);
        else if (composer.shown > index) composer.reset();
        while (composer.shown < index) {
          composer.next();
          decoded += 1;
          keep(composer.shown);
        }
      }
      return composer.screen;
    },
  };
}
