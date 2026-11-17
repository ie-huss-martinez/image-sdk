/// <reference lib="webworker" />
import {
  CANVAS_SIZES,
  type DecodeOutcome,
  ENCODED_TYPES,
  type FeatureOutcome,
  type GifFrameOutcome,
  type Request,
  SIDE_CEILING,
  TEXT_FAMILIES,
  type TextOutcome,
} from "./protocol.js";

/**
 * Measures, in a dedicated worker as the SDK's engine runs, what this
 * browser decodes with `createImageBitmap`, what `OffscreenCanvas` can draw
 * and encode, and how it composes a GIF (docs/adr/0001, docs/capabilities.md).
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

/** Draws red through `brightness(50%)`: an engine that applies the filter halves it. */
function contextFilter(): FeatureOutcome["contextFilter"] {
  try {
    const context = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
    if (!context || !("filter" in context)) return "not available";
    const red = new OffscreenCanvas(1, 1);
    const redContext = red.getContext("2d");
    if (!redContext) return "not available";
    redContext.fillStyle = "#ff0000";
    redContext.fillRect(0, 0, 1, 1);
    context.filter = "brightness(50%)";
    context.drawImage(red, 0, 0);
    const [r = 255] = context.getImageData(0, 0, 1, 1).data;
    return r < 200 ? "applies" : "ignored";
  } catch {
    return "not available";
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

/** Draws red into the page's transferred canvas and reads it back. */
function transferred(canvas: OffscreenCanvas | undefined): FeatureOutcome["transferredCanvas"] {
  if (!canvas) return "not available";
  try {
    canvas.width = 2;
    canvas.height = 2;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return "doesn't draw";
    context.fillStyle = "#ff0000";
    context.fillRect(0, 0, 2, 2);
    const [r, g, b, a] = context.getImageData(1, 1, 1, 1).data;
    return r === 255 && g === 0 && b === 0 && a === 255 ? "draws" : "doesn't draw";
  } catch {
    return "doesn't draw";
  }
}

/**
 * Draws on a white canvas and returns its pixels, or nothing when the worker
 * has no 2D canvas or drawing throws.
 */
function drawn(draw: (context: OffscreenCanvasRenderingContext2D) => void): Uint8ClampedArray {
  try {
    const context = new OffscreenCanvas(240, 120).getContext("2d", {
      colorSpace: "srgb",
      willReadFrequently: true,
    });
    if (!context) return new Uint8ClampedArray();
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 240, 120);
    context.fillStyle = "#000000";
    context.strokeStyle = "#000000";
    draw(context);
    context.setTransform(1, 0, 0, 1, 0, 0);
    return context.getImageData(0, 0, 240, 120, { colorSpace: "srgb" }).data;
  } catch {
    return new Uint8ClampedArray();
  }
}

/** Whether any pixel is no longer white. */
function inked(pixels: Uint8ClampedArray): boolean {
  for (let i = 0; i < pixels.length; i += 4) {
    if ((pixels[i] ?? 255) < 128 || (pixels[i + 1] ?? 255) < 128 || (pixels[i + 2] ?? 255) < 128) {
      return true;
    }
  }
  return false;
}

/** Whether any pixel's channels differ: a grey glyph has none. */
function coloured(pixels: Uint8ClampedArray): boolean {
  for (let i = 0; i < pixels.length; i += 4) {
    const [r = 0, g = 0, b = 0] = [pixels[i], pixels[i + 1], pixels[i + 2]];
    if (Math.abs(r - g) > 40 || Math.abs(g - b) > 40) return true;
  }
  return false;
}

/** What text the worker's canvas draws: the text renderer relies on each (docs/adr/0009). */
function text(): TextOutcome {
  const fills = Object.fromEntries(
    TEXT_FAMILIES.map((family) => [
      family,
      inked(
        drawn((context) => {
          context.font = `40px ${family}`;
          context.fillText("Hg", 10, 60);
        }),
      ),
    ]),
  ) as TextOutcome["fills"];
  const strokes = inked(
    drawn((context) => {
      context.font = "40px sans-serif";
      context.lineWidth = 2;
      context.strokeText("Hg", 10, 60);
    }),
  );
  let measures = false;
  try {
    const context = new OffscreenCanvas(1, 1).getContext("2d");
    if (context) {
      context.font = "40px sans-serif";
      measures = context.measureText("Hg").width > 0;
    }
  } catch {
    measures = false;
  }
  const emoji = drawn((context) => {
    context.font = "40px sans-serif";
    context.fillText("\u{1F600}", 10, 60);
  });
  const rightToLeft = inked(
    drawn((context) => {
      context.font = "40px sans-serif";
      context.fillText("\u05E9\u05DC\u05D5\u05DD", 120, 60);
    }),
  );
  const direct = drawn((context) => {
    context.font = "80px sans-serif";
    context.fillText("Hg", 10, 80);
  });
  const through = drawn((context) => {
    context.setTransform(0.5, 0, 0, 0.5, 0, 0);
    context.font = "160px sans-serif";
    context.fillText("Hg", 20, 160);
  });
  /** The pixels of a word in a font: two fonts, or two weights, that differ draw it differently. */
  const word = (font: string) =>
    drawn((context) => {
      context.font = font;
      context.fillText("Hamburg", 10, 80);
    });
  const differs = (a: Uint8ClampedArray, b: Uint8ClampedArray) =>
    a.length > 0 && a.some((value, index) => value !== b[index]);
  const bold = Object.fromEntries(
    TEXT_FAMILIES.map((family) => [
      family,
      differs(word(`60px ${family}`), word(`bold 60px ${family}`)),
    ]),
  ) as TextOutcome["bold"];
  return {
    serifDiffers: differs(word("60px serif"), word("60px sans-serif")),
    bold,
    fills,
    strokes,
    measures,
    emoji: !inked(emoji) ? "nothing" : coloured(emoji) ? "colour" : "one colour",
    rightToLeft,
    scaled:
      !inked(direct) || !inked(through)
        ? "nothing"
        : direct.every((value, index) => value === through[index])
          ? "same"
          : "differs",
  };
}

/**
 * One frame of a GIF as the browser composes it: the first through
 * `createImageBitmap`, the second through WebCodecs' `ImageDecoder`, the
 * only way a worker sees a later frame.
 */
async function gifFrame(bytes: ArrayBuffer, frame: 0 | 1): Promise<GifFrameOutcome> {
  try {
    let image: ImageBitmap | VideoFrame;
    if (frame === 0) {
      image = await createImageBitmap(new Blob([bytes]));
    } else {
      if (typeof ImageDecoder === "undefined") return { status: "unavailable" };
      const decoder = new ImageDecoder({ data: bytes, type: "image/gif" });
      image = (await decoder.decode({ frameIndex: frame })).image;
    }
    const width = "displayWidth" in image ? image.displayWidth : image.width;
    const height = "displayHeight" in image ? image.displayHeight : image.height;
    const context = new OffscreenCanvas(width, height).getContext("2d", {
      willReadFrequently: true,
    });
    if (!context) return { status: "rejected" };
    context.drawImage(image, 0, 0);
    image.close();
    return {
      status: "decoded",
      pixel: Array.from(context.getImageData(width - 1, height - 1, 1, 1).data),
    };
  } catch {
    return { status: "rejected" };
  }
}

async function features(canvas?: OffscreenCanvas): Promise<FeatureOutcome> {
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
  return {
    offscreen2d,
    encodes,
    displayP3: displayP3(),
    transferredCanvas: transferred(canvas),
    contextFilter: contextFilter(),
    draws: sizes,
    longestSide: low,
    text: text(),
  };
}

self.addEventListener("message", async (event: MessageEvent<Request>) => {
  const request = event.data;
  self.postMessage(
    request.kind === "decode"
      ? await decode(request.bytes, request.imageOrientation)
      : request.kind === "gifFrame"
        ? await gifFrame(request.bytes, request.frame)
        : await features(request.canvas),
  );
});
