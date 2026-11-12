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
  /** Whether the 2D context's `filter` property exists, and whether drawing applies it. */
  readonly contextFilter: "applies" | "ignored" | "not available";
  /** Whether a canvas of each size drew, keyed `W×H`. */
  readonly draws: Readonly<Record<string, boolean>>;
  /** The longest side of a one-pixel-high canvas that still draws. */
  readonly longestSide: number;
}

export type Request =
  | { kind: "decode"; bytes: ArrayBuffer; imageOrientation: "from-image" | "none" }
  | { kind: "features" };

export const ENCODED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/avif"] as const;
/** The longest side the search tries; a result of one less means "at least that". */
export const SIDE_CEILING = 1 << 17;

export const CANVAS_SIZES = [
  [4_096, 4_096],
  [8_192, 6_144],
] as const;
