import type { GifColourTable, GifFile, GifFrame } from "./frames.js";
import { decodeLzw } from "./lzw.js";

/** The table of a frame that has none, and whose file has none. */
const NO_COLOURS: GifColourTable = { offset: 0, size: 0 };

/** Where each pass of an interlaced frame starts, and how far apart its rows are. */
const PASSES: readonly (readonly [start: number, step: number])[] = [
  [0, 8],
  [4, 8],
  [2, 4],
  [1, 2],
];

/**
 * The colour indexes of one frame's rectangle, row by row from its top:
 * its LZW data decoded, every pixel of it or not at all, and its rows put
 * in order when it's interlaced.
 */
export function decodeGifFrame(bytes: Uint8Array, frame: GifFrame): Uint8Array {
  const { width, height } = frame;
  const indexes = new Uint8Array(width * height);
  decodeLzw(bytes, frame.data, frame.codeSize, indexes);
  if (!frame.interlaced) return indexes;
  const ordered = new Uint8Array(width * height);
  let from = 0;
  for (const [start, step] of PASSES) {
    for (let row = start; row < height; row += step) {
      ordered.set(indexes.subarray(from, from + width), row * width);
      from += width;
    }
  }
  return ordered;
}

/**
 * Composes a GIF's frames, one after another, as GIF89a says
 * (docs/adr/0011): each frame is drawn over the logical screen, skipping
 * its transparent colour, after the frame before it is disposed of.
 *
 * - The screen starts transparent, whatever background colour the file
 *   names.
 * - Disposal 0 and 1 keep the frame; 2 clears its rectangle to transparent;
 *   3 restores what was there before it.
 * - A pixel that names a colour its table doesn't have isn't drawn, like a
 *   transparent one, and a frame with no table at all draws nothing.
 *   Browsers open such files and each draws something else there; no
 *   colour is the only answer that invents none.
 *
 * It holds one screen, and one copy of a frame's rectangle while a frame
 * that restores is shown: never every frame.
 */
export interface GifComposer {
  /** The index of the frame the screen shows, or -1 before the first. */
  readonly shown: number;
  /**
   * The screen as it stands: what {@link GifComposer.next} returned last,
   * or a transparent screen before the first frame. The composer's own
   * buffer.
   */
  readonly screen: Uint8ClampedArray<ArrayBuffer>;
  /**
   * Draws the next frame, and returns the screen: `width × height` RGBA
   * pixels, not premultiplied. It's the composer's own buffer, changed by
   * the next call: copy it to keep it.
   *
   * @throws `RangeError` after the last frame.
   */
  next(): Uint8ClampedArray<ArrayBuffer>;
  /** Starts again from before the first frame. */
  reset(): void;
  /**
   * A copy of where the composer is: the screen, and what a frame that
   * restores covered. {@link GifComposer.restore} goes back to it.
   */
  snapshot(): GifSnapshot;
  /** Goes to where a snapshot was taken. The snapshot isn't changed, and can be used again. */
  restore(snapshot: GifSnapshot): void;
}

/**
 * A composer's state after a frame, enough to go on from it: the frame
 * shown, the screen's pixels, and for a frame that restores (disposal 3),
 * what was under it.
 */
export interface GifSnapshot {
  readonly shown: number;
  readonly screen: Uint8ClampedArray;
  readonly saved: Uint8ClampedArray | undefined;
}

/** Creates a {@link GifComposer} over a file and its frame table. */
export function createGifComposer(bytes: Uint8Array, file: GifFile): GifComposer {
  const screen = new Uint8ClampedArray(file.width * file.height * 4);
  let shown = -1;
  /** What a frame that restores covered, to put back before the next. */
  let saved: Uint8ClampedArray | undefined;

  const dispose = (frame: GifFrame) => {
    if (frame.disposal === 2) {
      for (let row = 0; row < frame.height; row += 1) {
        const start = ((frame.y + row) * file.width + frame.x) * 4;
        screen.fill(0, start, start + frame.width * 4);
      }
    } else if (frame.disposal === 3 && saved) {
      for (let row = 0; row < frame.height; row += 1) {
        screen.set(
          saved.subarray(row * frame.width * 4, (row + 1) * frame.width * 4),
          ((frame.y + row) * file.width + frame.x) * 4,
        );
      }
    }
    saved = undefined;
  };

  return {
    get shown() {
      return shown;
    },
    get screen() {
      return screen;
    },
    reset() {
      screen.fill(0);
      shown = -1;
      saved = undefined;
    },
    snapshot() {
      return { shown, screen: screen.slice(), saved: saved?.slice() };
    },
    restore(snapshot) {
      screen.set(snapshot.screen);
      shown = snapshot.shown;
      saved = snapshot.saved?.slice();
    },
    next() {
      const frame = file.frames[shown + 1];
      if (!frame) throw new RangeError("The GIF has no more frames.");
      // Decoded before anything is drawn, so a frame that fails leaves the screen as it was.
      const indexes = decodeGifFrame(bytes, frame);
      const table = frame.table ?? file.table ?? NO_COLOURS;
      const previous = file.frames[shown];
      if (previous) dispose(previous);
      if (frame.disposal === 3) {
        saved = new Uint8ClampedArray(frame.width * frame.height * 4);
        for (let row = 0; row < frame.height; row += 1) {
          const start = ((frame.y + row) * file.width + frame.x) * 4;
          saved.set(screen.subarray(start, start + frame.width * 4), row * frame.width * 4);
        }
      }
      for (let row = 0; row < frame.height; row += 1) {
        let to = ((frame.y + row) * file.width + frame.x) * 4;
        for (let column = 0; column < frame.width; column += 1, to += 4) {
          const index = indexes[row * frame.width + column] as number;
          if (index === frame.transparent || index >= table.size) continue;
          const colour = table.offset + index * 3;
          screen[to] = bytes[colour] as number;
          screen[to + 1] = bytes[colour + 1] as number;
          screen[to + 2] = bytes[colour + 2] as number;
          screen[to + 3] = 255;
        }
      }
      shown += 1;
      return screen;
    },
  };
}
