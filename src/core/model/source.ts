/**
 * The formats the probe recognises, by their signature bytes (ADR 0001).
 *
 * @public
 */
export type ImageFormat = "png" | "jpeg" | "webp" | "gif" | "avif" | "heif" | "bmp";

/**
 * An EXIF orientation, 1 to 8: how the stored pixels must be turned to be
 * upright. 1 means they already are (ADR 0005).
 *
 * @public
 */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * A width and a height, in whole pixels.
 *
 * @public
 */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Which kinds of metadata a file carries, as presence flags, never values,
 * so the editor can say what an export removes (ADR 0005).
 *
 * @public
 */
export interface ImageMetadataPresence {
  readonly location: boolean;
  readonly camera: boolean;
  readonly timestamps: boolean;
  readonly thumbnail: boolean;
  readonly colourProfile: boolean;
  /** Any other field, such as maker notes or unknown tags. */
  readonly other: boolean;
}

/**
 * The metadata fields a user may keep on export (ADR 0005). Empty strings
 * mean the field isn't written.
 *
 * @public
 */
export interface ImageKeepableMetadata {
  readonly title: string;
  readonly description: string;
  readonly artist: string;
  readonly copyright: string;
}

/**
 * What the probe learned about a file before anything decodes it (ADR 0001,
 * ADR 0004, ADR 0005). Limits are checked against it.
 *
 * @public
 */
export interface ImageProbe {
  readonly format: ImageFormat;
  /** The size of the stored pixels, before orientation. */
  readonly stored: ImageSize;
  /** The upright size, after orientation: the size the decoder must return. */
  readonly oriented: ImageSize;
  /** The EXIF or `irot`/`imir` orientation; 1 when there's none. */
  readonly orientation: ExifOrientation;
  /** 1 for a still image, otherwise the number of frames the probe walked. */
  readonly frames: number;
  readonly hasAlpha: boolean;
  /**
   * The most pixels the decoder can produce for the file: frames × the
   * oriented size for most formats, and for AVIF and HEIF the sum over every
   * item decoded with the primary, such as grid tiles and auxiliary planes.
   * Never a count declared by one header (ADR 0001).
   */
  readonly decodedPixelBound: number;
  readonly metadata: ImageMetadataPresence;
  /** The keepable fields the file carries, length-limited, shown only as text. */
  readonly keepable: ImageKeepableMetadata;
}

/**
 * A source the session holds, without its pixels: what the snapshot shows
 * (ADR 0003). Its size is the oriented size.
 *
 * @public
 */
export interface ImageSourceInfo {
  readonly id: string;
  readonly format: ImageFormat;
  readonly width: number;
  readonly height: number;
  readonly frames: number;
  readonly hasAlpha: boolean;
  /** The bytes the decoded source takes in the worker: frames × width × height × 4. */
  readonly decodedBytes: number;
}

/**
 * A small rendering of a source for lists and frame strips. An `ImageBitmap`
 * is one; tests can supply their own. Close it when it's no longer shown.
 *
 * @public
 */
export interface ImageThumbnail {
  readonly width: number;
  readonly height: number;
  close(): void;
}

/**
 * Metadata presence with nothing present.
 *
 * @public
 */
export const NO_METADATA: ImageMetadataPresence = Object.freeze({
  location: false,
  camera: false,
  timestamps: false,
  thumbnail: false,
  colourProfile: false,
  other: false,
});

/**
 * Keepable metadata with every field empty.
 *
 * @public
 */
export const EMPTY_KEEPABLE_METADATA: ImageKeepableMetadata = Object.freeze({
  title: "",
  description: "",
  artist: "",
  copyright: "",
});

/**
 * The longest a kept metadata value may be, in UTF-16 code units (ADR 0005).
 *
 * @public
 */
export const MAX_METADATA_LENGTH = 2_000;
