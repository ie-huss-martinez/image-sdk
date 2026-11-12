/// <reference lib="webworker" />
import {
  CANVAS_SIZES,
  type DecodeOutcome,
  ENCODED_TYPES,
  type FeatureOutcome,
  type Request,
  SIDE_CEILING,
} from "./protocol.js";

/**
 * Measures, in a dedicated worker as the SDK's engine runs, what this
 * browser decodes with `createImageBitmap`, and what `OffscreenCanvas` can
 * draw and encode (docs/adr/0001, docs/capabilities.md).
 */
declare const self: DedicatedWorkerGlobalScope;

async function decode(
  bytes: ArrayBuffer,
  imageOrientation: "from-image" | "none",
): Promise<DecodeOutcome> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes]), { imageOrientation });
  } catch (error) {
    return { status: "rejected", error: error instanceof Error ? error.name : String(error) };
  }
  const { width, height } = bitmap;
  let centre: number[] | undefined;
  let quadrants: number[][] | undefined;
  try {
    const context = new OffscreenCanvas(width, height).getContext("2d");
    if (context) {
      context.drawImage(bitmap, 0, 0);
      const pixel = (x: number, y: number) =>
        Array.from(context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data);
      centre = pixel(width / 2, height / 2);
      quadrants = [
        pixel(width / 4, height / 4),
        pixel((3 * width) / 4, height / 4),
        pixel(width / 4, (3 * height) / 4),
        pixel((3 * width) / 4, (3 * height) / 4),
      ];
    }
  } catch {
    // The size is still worth reporting without the colour.
  }
  bitmap.close();
  return {
    status: "decoded",
    width,
    height,
    ...(centre === undefined ? {} : { centre }),
    ...(quadrants === undefined ? {} : { quadrants }),
  };
}

/** Whether a canvas of this size really draws: some engines hand out a context that doesn't. */
function draws(width: number, height: number): boolean {
  try {
    const context = new OffscreenCanvas(width, height).getContext("2d", {
      willReadFrequently: true,
    });
    if (!context) return false;
    context.fillStyle = "#ff0000";
    context.fillRect(width - 1, height - 1, 1, 1);
    const [r, g, b, a] = context.getImageData(width - 1, height - 1, 1, 1).data;
    return r === 255 && g === 0 && b === 0 && a === 255;
  } catch {
    return false;
  }
}

async function encode(type: string): Promise<string> {
  try {
    const canvas = new OffscreenCanvas(8, 8);
    const context = canvas.getContext("2d");
    context?.fillRect(0, 0, 8, 8);
    return (await canvas.convertToBlob({ type, quality: 0.9 })).type;
  } catch {
    return "fails";
  }
}

function displayP3(): boolean {
  try {
    const context = new OffscreenCanvas(1, 1).getContext("2d", { colorSpace: "display-p3" });
    // Missing from TypeScript's types for OffscreenCanvas, though the
    // specification has it; engines without it don't support Display-P3.
    const attributes = (
      context as { getContextAttributes?: () => { colorSpace?: string } } | null
    )?.getContextAttributes?.();
    return attributes?.colorSpace === "display-p3";
  } catch {
    return false;
  }
}

async function features(): Promise<FeatureOutcome> {
  let offscreen2d = false;
  try {
    offscreen2d = new OffscreenCanvas(1, 1).getContext("2d") !== null;
  } catch {
    offscreen2d = false;
  }
  const encodes: Record<string, string> = {};
  for (const type of ENCODED_TYPES) encodes[type] = await encode(type);
  const sizes: Record<string, boolean> = {};
  for (const [width, height] of CANVAS_SIZES) sizes[`${width}×${height}`] = draws(width, height);
  // Binary search between a side every engine draws and one none does.
  let low = 1_024;
  let high = SIDE_CEILING;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (draws(middle, 1)) low = middle;
    else high = middle;
  }
  return { offscreen2d, encodes, displayP3: displayP3(), draws: sizes, longestSide: low };
}

self.addEventListener("message", async (event: MessageEvent<Request>) => {
  const request = event.data;
  self.postMessage(
    request.kind === "decode"
      ? await decode(request.bytes, request.imageOrientation)
      : await features(),
  );
});
