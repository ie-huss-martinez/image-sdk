import type {
  ExifOrientation,
  ImageKeepableMetadata,
  ImageMetadataPresence,
} from "../../src/index.js";

/** What a test file holds, which each harness encodes in its own format. */
export interface TestImageSpec {
  /** The stored size, before orientation. */
  readonly width: number;
  readonly height: number;
  readonly orientation?: ExifOrientation;
  /** Metadata the file carries, such as a location, which no export may keep. */
  readonly metadata?: Partial<ImageMetadataPresence>;
  readonly keepable?: Partial<ImageKeepableMetadata>;
}

/** An exported file, read back by the harness. */
export interface InspectedExport {
  readonly width: number;
  readonly height: number;
  /** The RGBA of a pixel. */
  pixel(x: number, y: number): readonly number[];
  /** Every metadata field the file carries, by name. */
  readonly metadata: Readonly<Record<string, string>>;
  /** Whether the file carries a location in any form. */
  readonly hasLocation: boolean;
}

export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to reject");
}

export function aborted(): AbortSignal {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}
