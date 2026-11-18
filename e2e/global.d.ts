// The hooks the example pages expose (examples/vite/src/main.ts, engine.ts, editor.tsx and element.ts).
interface Window {
  imageEditor: {
    open(bytes: ArrayBuffer): Promise<void>;
    status(): string;
    /** The session's plan, as plain data, or null before an image is open. */
    plan(): unknown;
    /** Runs commands as a host does, such as inserting layers. */
    execute(commands: unknown): void;
  };
  imageElementEvents: { name: string; json: string }[];
  imageSdk: {
    run(
      bytes: ArrayBuffer,
      selfHosted: boolean,
    ): Promise<{
      status: string;
      width?: number;
      height?: number;
      orientation?: number;
      decodedBytes?: number;
      quadrants?: readonly (readonly number[])[];
    }>;
    /** Opens an animated GIF with all its frames, exports it to GIF and reads the file back. */
    exportGif(
      bytes: ArrayBuffer,
      selfHosted: boolean,
    ): Promise<{ status: string; type?: string; delays?: readonly number[] }>;
    readonly violations: readonly string[];
  };
  imageCapabilities: {
    decode(
      bytes: ArrayBuffer,
      imageOrientation?: "from-image" | "none",
    ): Promise<{
      status: "decoded" | "rejected" | "timeout";
      width?: number;
      height?: number;
      centre?: readonly number[];
      quadrants?: readonly (readonly number[])[];
      error?: string;
    }>;
    features(): Promise<
      | {
          offscreen2d: boolean;
          encodes: Readonly<Record<string, string>>;
          displayP3: boolean;
          transferredCanvas: "draws" | "doesn't draw" | "not available";
          contextFilter: "applies" | "ignored" | "not available";
          draws: Readonly<Record<string, boolean>>;
          longestSide: number;
          text: {
            fills: Readonly<Record<"sans-serif" | "serif" | "monospace", boolean>>;
            strokes: boolean;
            measures: boolean;
            emoji: "colour" | "one colour" | "nothing";
            rightToLeft: boolean;
            scaled: "same" | "differs" | "nothing";
            serifDiffers: boolean;
            bold: Readonly<Record<"sans-serif" | "serif" | "monospace", boolean>>;
          };
        }
      | undefined
    >;
    gifFrame(
      bytes: ArrayBuffer,
      frame: 0 | 1,
    ): Promise<{
      status: "decoded" | "rejected" | "unavailable" | "timeout";
      pixel?: readonly number[];
    }>;
  };
}
