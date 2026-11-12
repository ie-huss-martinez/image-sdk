import type { ImageProbe, ImageSourceInfo, ImageThumbnail } from "../model/source.js";
import type { ImageCallOptions, ImageProgressOptions } from "./options.js";

/**
 * The port for reading images: probe a file's headers, decode it into a
 * source the engine holds, make thumbnails and release sources (ADR 0001,
 * ADR 0002, ADR 0003, ADR 0008). The SDK's own adapter probes with its own
 * readers and decodes with `createImageBitmap`, both in its render worker;
 * hosts can pass their own to the editor's `engine` prop, and every
 * implementation must pass the engine's contract tests.
 *
 * The engine doesn't apply the file policy: the session checks the probe
 * against it between `probe` and `register` (ADR 0004).
 *
 * Failures reject with `ImageError`: `INVALID_IMAGE` for a malformed file,
 * one whose headers claim more than its data holds, or one whose decoded
 * size differs from the probe's; `UNSUPPORTED_FORMAT` for one the probe
 * can't bound; `DECODE_FAILED` when the browser can't decode it; and
 * sdk-core's codes for cancellation and worker failures.
 *
 * @public
 */
export interface ImageEngine {
  /** Reads a file's headers and metadata, without decoding it. */
  probe(file: Blob, options?: ImageCallOptions): Promise<ImageProbe>;
  /**
   * Decodes a probed file into a source with the given id, upright. The
   * decoded size must equal the probe's oriented size, or the call rejects
   * with `INVALID_IMAGE` and keeps nothing. An id already in use is a
   * `TypeError`.
   */
  register(
    id: string,
    file: Blob,
    probe: ImageProbe,
    options?: ImageProgressOptions,
  ): Promise<ImageSourceInfo>;
  /**
   * A rendering of a source that fits inside `maxSize` × `maxSize`, keeping
   * its aspect ratio and never enlarging it. An unknown id is a `TypeError`.
   */
  thumbnail(id: string, maxSize: number, options?: ImageCallOptions): Promise<ImageThumbnail>;
  /** Frees a source's pixels. Releasing an unknown id does nothing. */
  release(id: string): Promise<void>;
  /** Releases the engine, its sources and its worker. Pending calls reject, and later calls throw. */
  destroy(): Promise<void>;
}
