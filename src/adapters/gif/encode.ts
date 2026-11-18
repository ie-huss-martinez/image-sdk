import { applyPalette, GIFEncoder, type GifencPalette, quantize } from "gifenc";

/** The most colours a frame is written with, beside the transparent one (docs/adr/0011). */
export const MAX_FRAME_COLOURS = 255;

/** A pixel less opaque than this is written as transparent: half. */
const OPAQUE_FROM = 128;

/** What a GIF is written with (docs/adr/0011). */
export interface GifWriterOptions {
  /** The size of every frame, and of the file's screen. */
  readonly width: number;
  readonly height: number;
  /** `null`: play once, with no loop extension. 0: for ever. Otherwise that many repeats. */
  readonly loop: number | null;
}

/**
 * Writes a GIF, a frame at a time (docs/adr/0011). It holds the file so
 * far and nothing of the frames it has written.
 */
export interface GifWriter {
  /** How many frames have been written. */
  readonly frames: number;
  /**
   * Writes one frame, whole: `width × height` RGBA pixels, not
   * premultiplied, and its delay in hundredths of a second, 0 to 65,535.
   * The pixels aren't kept, and aren't changed.
   *
   * @throws `RangeError` for pixels of another size, or a delay out of range.
   */
  frame(pixels: Uint8ClampedArray | Uint8Array, delay: number): void;
  /**
   * Ends the file and returns its bytes. The writer can't be used again.
   *
   * @throws `RangeError` before any frame is written: a GIF has at least one.
   */
  finish(): Uint8Array<ArrayBuffer>;
}

/**
 * Creates a {@link GifWriter}, over `gifenc` (docs/adr/0011).
 *
 * - **Every frame is whole,** the size of the screen, with its own palette:
 *   at most {@link MAX_FRAME_COLOURS} colours, and index 0 kept for
 *   transparency. No opaque pixel is written as index 0.
 * - **A pixel under half opaque becomes transparent;** any other becomes
 *   opaque, with its colour as it is. A GIF has no partial transparency.
 * - **Each frame clears the screen before the next** (disposal 2). So no
 *   frame depends on the one before it: a transparent area never shows a
 *   ghost, and nothing a redaction destroyed in one frame can come back
 *   through another (docs/adr/0010).
 * - **Timing is written as it's given:** each delay, and the loop count.
 *
 * It only ever sees pixels the SDK rendered, never bytes from a file.
 */
export function createGifWriter(options: GifWriterOptions): GifWriter {
  const { width, height, loop } = options;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 65_535 ||
    height > 65_535
  ) {
    throw new RangeError("A GIF is from 1 × 1 to 65,535 × 65,535 pixels.");
  }
  if (loop !== null && (!Number.isInteger(loop) || loop < 0 || loop > 65_535)) {
    throw new RangeError("A loop count is null, or a whole number from 0 to 65,535.");
  }
  const encoder = GIFEncoder();
  const pixelCount = width * height;
  let frames = 0;
  let finished = false;

  return {
    get frames() {
      return frames;
    },
    frame(pixels, delay) {
      if (finished) throw new Error("The GIF is finished.");
      if (pixels.length !== pixelCount * 4) {
        throw new RangeError(`A frame is ${width} × ${height} RGBA pixels.`);
      }
      if (!Number.isInteger(delay) || delay < 0 || delay > 65_535) {
        throw new RangeError(
          "A delay is a whole number of hundredths of a second, from 0 to 65,535.",
        );
      }
      // The opaque pixels alone choose the palette: a transparent pixel has
      // no colour, and mustn't take one of the 255.
      let opaque = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        if ((pixels[i] as number) >= OPAQUE_FROM) opaque += 1;
      }
      const solid = new Uint8Array(opaque * 4);
      let to = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if ((pixels[i + 3] as number) < OPAQUE_FROM) continue;
        solid[to] = pixels[i] as number;
        solid[to + 1] = pixels[i + 1] as number;
        solid[to + 2] = pixels[i + 2] as number;
        solid[to + 3] = 255;
        to += 4;
      }
      const colours: GifencPalette = opaque > 0 ? quantize(solid, MAX_FRAME_COLOURS) : [];
      // Each opaque pixel's colour among them, then moved up by one: index 0
      // is the transparent one, whether or not this frame uses it.
      const nearest = opaque > 0 ? applyPalette(solid, colours) : new Uint8Array(0);
      const index = new Uint8Array(pixelCount);
      let from = 0;
      for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        if ((pixels[pixel * 4 + 3] as number) < OPAQUE_FROM) continue;
        index[pixel] = (nearest[from] as number) + 1;
        from += 1;
      }
      encoder.writeFrame(index, width, height, {
        palette: [[0, 0, 0], ...colours],
        // The library takes milliseconds, and writes hundredths.
        delay: delay * 10,
        transparent: opaque < pixelCount,
        transparentIndex: 0,
        // Clear the screen before the next frame, whatever this one holds.
        dispose: 2,
        repeat: loop === null ? -1 : loop,
      });
      frames += 1;
    },
    finish() {
      if (finished) throw new Error("The GIF is finished.");
      if (frames === 0) throw new RangeError("A GIF has at least one frame.");
      finished = true;
      encoder.finish();
      return encoder.bytes() as Uint8Array<ArrayBuffer>;
    },
  };
}
