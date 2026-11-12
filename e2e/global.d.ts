// The hooks the example page exposes (examples/vite/src/main.ts).
interface Window {
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
          draws: Readonly<Record<string, boolean>>;
          longestSide: number;
        }
      | undefined
    >;
  };
}
