/** What decoding one file in the worker produced. */
export interface DecodeOutcome {
  /** `decoded`, `rejected` when `createImageBitmap` failed, or `timeout`. */
  readonly status: "decoded" | "rejected" | "timeout";
  readonly width?: number;
  readonly height?: number;
  /** The centre pixel as `[r, g, b, a]`, when a worker canvas could read it. */
  readonly centre?: readonly number[];
  /**
   * The centres of the four quadrants, top left, top right, bottom left and
   * bottom right, as `[r, g, b, a]`, which show how a decode was oriented.
   */
  readonly quadrants?: readonly (readonly number[])[];
  readonly error?: string;
}

/** What the worker's canvas can do, by feature. */
export interface FeatureOutcome {
  readonly offscreen2d: boolean;
  /** The type `convertToBlob` returned for each requested type, or `fails`. */
  readonly encodes: Readonly<Record<string, string>>;
  readonly displayP3: boolean;
  /** Whether a page canvas transferred with `transferControlToOffscreen` draws in the worker. */
  readonly transferredCanvas: "draws" | "doesn't draw" | "not available";
  /** Whether the 2D context's `filter` property exists, and whether drawing applies it. */
  readonly contextFilter: "applies" | "ignored" | "not available";
  /** Whether a canvas of each size drew, keyed `W×H`. */
  readonly draws: Readonly<Record<string, boolean>>;
  /** The longest side of a one-pixel-high canvas that still draws. */
  readonly longestSide: number;
  readonly text: TextOutcome;
}

/** What text the worker's 2D canvas draws (docs/adr/0009). */
export interface TextOutcome {
  /** Whether `fillText` left ink in each generic family. */
  readonly fills: Readonly<Record<(typeof TEXT_FAMILIES)[number], boolean>>;
  readonly strokes: boolean;
  /** Whether `measureText` gave a width above zero. */
  readonly measures: boolean;
  /** Whether an emoji drew, and whether any of its pixels had a colour. */
  readonly emoji: "colour" | "one colour" | "nothing";
  /** Whether Hebrew text left ink. */
  readonly rightToLeft: boolean;
  /**
   * Text drawn at 160 pixels through a half-scale transform, against the
   * same text drawn at 80: `same` when every pixel is equal.
   */
  readonly scaled: "same" | "differs" | "nothing";
  /** Whether `serif` draws other pixels than `sans-serif`: whether they're two fonts here. */
  readonly serifDiffers: boolean;
  /** Whether `bold` draws other pixels than regular, in each generic family. */
  readonly bold: Readonly<Record<(typeof TEXT_FAMILIES)[number], boolean>>;
}

/** What one frame of a GIF showed, as a browser composes it (docs/adr/0011). */
export interface GifFrameOutcome {
  /** `unavailable` when the frame needs `ImageDecoder` and the worker has none. */
  readonly status: "decoded" | "rejected" | "unavailable" | "timeout";
  /** The bottom-right pixel as `[r, g, b, a]`. */
  readonly pixel?: readonly number[];
}

export type Request =
  | { kind: "decode"; bytes: ArrayBuffer; imageOrientation: "from-image" | "none" }
  | { kind: "features"; canvas?: OffscreenCanvas }
  | { kind: "gifFrame"; bytes: ArrayBuffer; frame: 0 | 1 };

export const ENCODED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/avif"] as const;
/** The longest side the search tries; a result of one less means "at least that". */
export const SIDE_CEILING = 1 << 17;

export const TEXT_FAMILIES = ["sans-serif", "serif", "monospace"] as const;

export const CANVAS_SIZES = [
  [4_096, 4_096],
  [8_192, 6_144],
] as const;
