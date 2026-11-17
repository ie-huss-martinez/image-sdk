import { cropRect } from "../../core/model/geometry.js";
import type { ImagePlan, ImageRedaction } from "../../core/model/plan.js";
import {
  type ImageRect,
  redactionBlocksInOutput,
  redactionBlocksInScene,
  redactionRectInOutput,
} from "../../core/model/redaction-geometry.js";
import type { ImageSize } from "../../core/model/source.js";
import { checkpoint } from "./yield.js";

/**
 * Redaction's two passes (docs/adr/0010). Before anything is scaled, the
 * renderer draws from a sanitised copy of the source, in which the covered
 * pixels are already replaced; after everything is drawn, each redaction is
 * finished on whole output pixels. The first makes an export independent of
 * the redacted pixels, since no scaler ever reads one. The second makes the
 * region exactly its colour or its blocks, whatever was developed or drawn
 * over it.
 */

/** The most bytes read back at once, as for develop (docs/adr/0006). */
const BAND_BYTES = 4_000_000;

type Context = OffscreenCanvasRenderingContext2D;

/** The part of a rectangle inside another, or `null`. */
function intersect(a: ImageRect, b: ImageRect): ImageRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/** Fills whole pixels with an opaque colour, with no transform and no blending. */
function fill(context: Context, rect: ImageRect, colour: string): void {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.fillStyle = colour;
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  context.restore();
}

/** What a sanitised copy was built for: the redactions over it, and the crop. */
interface Sanitised {
  readonly key: string;
  readonly canvas: OffscreenCanvas;
}

/**
 * One sanitised copy per source, kept while the redactions over it and the
 * crop don't change, so zooming, panning and develop gestures reuse it. Its
 * key is the exact list of redactions it was built for: a plan with one
 * more, one fewer or one moved never draws from it.
 */
const copies = new WeakMap<ImageBitmap, Sanitised>();

/** Forgets a source's sanitised copy, when the source is released. */
export function forgetSanitised(source: ImageBitmap): void {
  const copy = copies.get(source);
  if (copy) copy.canvas.width = 0;
  copies.delete(source);
}

/**
 * The source to draw a plan from: the source itself when no redaction
 * covers any of it, otherwise a copy in which every redacted pixel is
 * already replaced, at the source's own resolution (docs/adr/0010).
 *
 * - A solid redaction's pixels take its colour.
 * - A pixelated redaction's pixels take the average of their block, over
 *   the part of the block that's rendered: a pixel the crop leaves out
 *   never reaches the export, even through an average. The rest of the
 *   region, outside the crop, is filled black.
 *
 * If the copy can't be made, this throws, and nothing is drawn: the
 * original is never drawn in its place.
 */
export async function sanitisedSource(
  source: ImageBitmap,
  plan: ImagePlan,
  signal?: AbortSignal,
): Promise<ImageBitmap | OffscreenCanvas> {
  const whole: ImageRect = { x: 0, y: 0, width: source.width, height: source.height };
  const crop = cropRect(plan.base.crop, source);
  const covering = plan.redactions.filter((redaction) => intersect(redaction, whole) !== null);
  if (covering.length === 0) return source;
  const key = JSON.stringify([covering, crop]);
  const cached = copies.get(source);
  if (cached?.key === key) return cached.canvas;

  const canvas = new OffscreenCanvas(source.width, source.height);
  const context = canvas.getContext("2d", {
    colorSpace: "srgb",
    willReadFrequently: covering.some((redaction) => redaction.mode === "pixelate"),
  });
  if (!context) throw new Error("The worker has no 2D canvas.");
  context.imageSmoothingEnabled = false;
  context.drawImage(source, 0, 0);
  for (const redaction of covering) {
    const covered = intersect(redaction, whole) as ImageRect;
    if (redaction.mode === "solid") {
      fill(context, covered, redaction.colour);
    } else {
      // The averages come from the copy as it stands, so a redaction listed
      // earlier is already applied beneath this one.
      const blocks = redactionBlocksInScene(redaction, crop);
      const rendered = await averages(context, blocks, signal);
      fill(context, covered, "#000000");
      rendered.forEach((mean, index) => {
        putBlock(context, blocks[index] as ImageRect, mean);
      });
    }
  }
  if (signal?.aborted) {
    canvas.width = 0;
    throw signal.reason;
  }
  // A copy another render still draws from isn't cleared: it's released
  // when nothing refers to it.
  copies.set(source, { key, canvas });
  return canvas;
}

/**
 * Each block's average: the mean of each channel on premultiplied values,
 * rounded to 8 bits, in integer arithmetic that's the same in every engine.
 * Every average is taken before any is written, so one block's result can't
 * change another's. Blocks are read in bands of bounded size, and the call
 * yields between blocks.
 */
async function averages(
  context: Context,
  blocks: readonly ImageRect[],
  signal: AbortSignal | undefined,
): Promise<number[][]> {
  const means: number[][] = [];
  for (const { x, y, width, height } of blocks) {
    await checkpoint(signal);
    const rows = Math.max(1, Math.floor(BAND_BYTES / (width * 4)));
    const sums = [0, 0, 0, 0];
    for (let top = 0; top < height; top += rows) {
      const { data } = context.getImageData(x, y + top, width, Math.min(rows, height - top), {
        colorSpace: "srgb",
      });
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3] as number;
        sums[0] = (sums[0] as number) + (data[i] as number) * a;
        sums[1] = (sums[1] as number) + (data[i + 1] as number) * a;
        sums[2] = (sums[2] as number) + (data[i + 2] as number) * a;
        sums[3] = (sums[3] as number) + a;
      }
    }
    const [red = 0, green = 0, blue = 0, alpha = 0] = sums;
    means.push(
      alpha > 0
        ? [
            Math.round(red / alpha),
            Math.round(green / alpha),
            Math.round(blue / alpha),
            Math.round(alpha / (width * height)),
          ]
        : [0, 0, 0, 0],
    );
  }
  return means;
}

/** Writes one colour over a block, exactly, in bands of bounded size. */
function putBlock(context: Context, { x, y, width, height }: ImageRect, mean: number[]): void {
  const rows = Math.max(1, Math.floor(BAND_BYTES / (width * 4)));
  // From the context, which is sRGB: Firefox's ImageData constructor takes
  // no settings in a worker.
  const band = context.createImageData(width, Math.min(rows, height));
  for (let i = 0; i < band.data.length; i += 4) band.data.set(mean, i);
  for (let top = 0; top < height; top += rows) {
    // The last band may be shorter: only its rows are written.
    context.putImageData(band, x, y + top, 0, 0, width, Math.min(rows, height - top));
  }
}

/**
 * Finishes every redaction on the rendered output, in order, after
 * everything else is drawn (docs/adr/0010). Each region is mapped to the
 * output and rounded outward, so every pixel it touches is covered whole.
 *
 * @param context - The output canvas's context.
 * @param source - The base source's size.
 * @param size - The output's size.
 */
export async function finishRedactions(
  context: Context,
  plan: ImagePlan,
  source: ImageSize,
  size: ImageSize,
  signal?: AbortSignal,
): Promise<void> {
  const crop = cropRect(plan.base.crop, source);
  const { orientation } = plan.base;
  for (const redaction of plan.redactions) {
    if (redaction.mode === "solid") {
      const rect = redactionRectInOutput(redaction, crop, orientation, size);
      if (rect) fill(context, rect, redaction.colour);
    } else {
      const blocks = redactionBlocksInOutput(redaction, crop, orientation, size);
      const means = await averages(context, blocks, signal);
      means.forEach((mean, index) => {
        putBlock(context, blocks[index] as ImageRect, mean);
      });
    }
  }
}

/** Whether the plan pixelates, so its canvases are read back. */
export function pixelates(redactions: readonly ImageRedaction[]): boolean {
  return redactions.some((redaction) => redaction.mode === "pixelate");
}
