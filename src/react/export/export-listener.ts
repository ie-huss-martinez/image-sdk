import { createContext } from "react";
import type { ImageKeepableMetadata, ImageMetadataPresence } from "../../core/model/source.js";
import type { ImageExportFormat } from "../../core/ports/image-processor.js";

/**
 * What the export dialog reports about a finished export, for the element's
 * `export` event: no pixels and no file, which an event must never carry
 * (sdk-core ADR 0012). The element's `export()` method returns the file.
 *
 * @public
 */
export interface ImageExportReport {
  readonly format: ImageExportFormat["type"];
  readonly width: number;
  readonly height: number;
  /** The file's size in bytes. */
  readonly size: number;
  readonly removed: readonly (keyof ImageMetadataPresence)[];
  readonly kept: readonly (keyof ImageKeepableMetadata)[];
}

/** Hears about every export the dialog finishes; the element provides it. */
export const ExportListenerContext = createContext<((report: ImageExportReport) => void) | null>(
  null,
);
