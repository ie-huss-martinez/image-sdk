// The hooks the example pages expose (examples/vite/src/main.ts and engine.ts).
interface Window {
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
        }
      | undefined
    >;
  };
}
