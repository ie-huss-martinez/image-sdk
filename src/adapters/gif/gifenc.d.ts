/**
 * The parts of `gifenc` 1.0.3 the encoder uses (docs/adr/0011). The package
 * ships no types of its own.
 */
declare module "gifenc" {
  /** A palette: up to 256 colours, each `[r, g, b]`. */
  export type GifencPalette = number[][];

  export interface GifencFrameOptions {
    readonly palette: GifencPalette;
    /** In milliseconds: written as hundredths of a second, rounded. */
    readonly delay?: number;
    /** Whether `transparentIndex` isn't drawn. */
    readonly transparent?: boolean;
    readonly transparentIndex?: number;
    /** -1 to play once, 0 for ever, otherwise the number of repeats. Read on the first frame only. */
    readonly repeat?: number;
    /** The disposal method, 0 to 7. */
    readonly dispose?: number;
  }

  export interface GifencEncoder {
    writeFrame(index: Uint8Array, width: number, height: number, options: GifencFrameOptions): void;
    /** Writes the trailer. */
    finish(): void;
    /** A copy of the file so far. */
    bytes(): Uint8Array;
  }

  export function GIFEncoder(options?: { initialCapacity?: number; auto?: boolean }): GifencEncoder;
  /** Up to `maxColors` colours for RGBA pixels. */
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: "rgb565" | "rgb444" | "rgba4444" },
  ): GifencPalette;
  /** Each pixel's nearest colour in the palette, as an index. */
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifencPalette,
    format?: "rgb565" | "rgb444" | "rgba4444",
  ): Uint8Array;
}
