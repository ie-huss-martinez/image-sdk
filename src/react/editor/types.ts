import type { IconComponent } from "@hussmartinez/ui/react";
import type { ImagePlan } from "../../core/model/plan.js";
import type { ImageCommand } from "../../core/operations/commands.js";
import type { ImageExportFormat } from "../../core/ports/image-processor.js";
import type { ImageSession, ImageSessionExport } from "../../core/session/session.js";
import type { ImageEditorProviderProps } from "../ImageEditorProvider.js";

/**
 * The parts of `ImageEditor` that take extra classes through `classNames`.
 *
 * @public
 */
export type ImageEditorPart = "root" | "toolbar" | "stage" | "inspector";

/**
 * Props of {@link ImageEditor}. The session props are the provider's: pass
 * a `session` of your own over your `engine`, or let the editor create one.
 *
 * @public
 */
export interface ImageEditorProps extends Omit<ImageEditorProviderProps, "children"> {
  /** An image to open on mount. Images the user opens in the editor replace it. */
  readonly initialFile?: Blob;
  /**
   * The plan, for a host that holds it: the controlled form. When it changes,
   * the editor applies it as one undoable step (`session.applyPlan`). Use it
   * with `onChange`, which gets the plans the editor makes.
   */
  readonly plan?: ImagePlan;
  /** Called with the plan after each committed edit, open, undo or redo, never during a gesture. */
  readonly onChange?: (plan: ImagePlan) => void;
  /** Which tools are present, by id, in order. All of them by default. */
  readonly tools?: readonly string[];
  /** The toolbar's groups, as tool ids. */
  readonly toolbar?: readonly (readonly string[])[];
  /** Icon components by name, over ui's. */
  readonly icons?: Readonly<Record<string, IconComponent>>;
  /** Extra classes on the root. */
  readonly className?: string;
  /** Extra classes on each part. */
  readonly classNames?: Readonly<Partial<Record<ImageEditorPart, string>>>;
  /** Drop the visual styles, keeping layout and accessibility. */
  readonly unstyled?: boolean;
  /**
   * Takes the exported file instead of the export dialog's download button;
   * the dialog closes once it's called.
   */
  readonly onExport?: (blob: Blob, details: ImageSessionExport) => void;
}

/**
 * What a ref to {@link ImageEditor} gives the host.
 *
 * @public
 */
export interface ImageEditorHandle {
  /** The editor's session, for state and commands beyond the handle's. */
  readonly session: ImageSession;
  /** Opens an image, replacing the current one once it has opened. */
  open(file: Blob): Promise<void>;
  /** Applies commands as one undoable step. */
  execute(commands: ImageCommand | readonly ImageCommand[]): void;
  /** Renders and encodes the image as it is now. */
  export(format: ImageExportFormat): Promise<ImageSessionExport>;
  /** Undoes the last edit, if there is one. */
  undo(): void;
  /** Redoes the last undone edit, if there is one. */
  redo(): void;
}
