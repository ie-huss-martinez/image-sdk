import { arrowOutline } from "../../core/model/drawing-geometry.js";
import { cropRect } from "../../core/model/geometry.js";
import {
  fitTextLines,
  isRightToLeft,
  layerToOutput,
  sceneToOutput,
} from "../../core/model/layer-geometry.js";
import type {
  ImageArrowLayer,
  ImageDrawingLayer,
  ImageImageLayer,
  ImagePlan,
  ImageShapeLayer,
  ImageTextLayer,
} from "../../core/model/plan.js";
import type { ImageSize } from "../../core/model/source.js";
import { pruneLayerCopies, sanitisedLayerSource } from "./redact.js";
import { checkpoint } from "./yield.js";

/**
 * Draws a plan's layers over the base, bottom to top (docs/adr/0009). Each
 * is drawn in its own box's pixels, through the transform from that box to
 * the output: the same code and the same layout for the preview and for
 * every export, at any size.
 */

type Context = OffscreenCanvasRenderingContext2D;

/** The size text is measured and laid out at, before it's scaled to its box. */
const TEXT_SIZE = 100;

function drawShape(context: Context, layer: ImageShapeLayer): void {
  const { width, height, shape, fill, stroke } = layer;
  // The stroke is inside the box, so the box is the shape's bounds: at most
  // half the shorter side, where it meets itself.
  const line = stroke ? Math.min(stroke.width, width / 2, height / 2) : 0;
  if (fill !== null) {
    context.fillStyle = fill;
    if (shape === "rectangle") {
      context.fillRect(0, 0, width, height);
    } else {
      context.beginPath();
      context.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      context.fill();
    }
  }
  if (stroke !== null) {
    context.strokeStyle = stroke.colour;
    context.lineWidth = line;
    context.lineJoin = "miter";
    if (shape === "rectangle") {
      context.strokeRect(line / 2, line / 2, width - line, height - line);
    } else {
      context.beginPath();
      context.ellipse(
        width / 2,
        height / 2,
        (width - line) / 2,
        (height - line) / 2,
        0,
        0,
        Math.PI * 2,
      );
      context.stroke();
    }
  }
}

function drawText(context: Context, layer: ImageTextLayer): void {
  if (layer.text === "") return;
  const lines = layer.text.split("\n");
  // The browser's bold for the family: a real face where the device has
  // one, synthesised or absent where it doesn't (docs/adr/0009).
  context.font = `${layer.bold ? "bold " : ""}${TEXT_SIZE}px ${layer.font}`;
  const rightToLeft = isRightToLeft(layer.text);
  context.direction = rightToLeft ? "rtl" : "ltr";
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  // The font's own ascent and descent, the same for every line, so lines
  // are evenly spaced whatever letters they hold.
  const metrics = context.measureText("Mg");
  const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent;
  const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
  const layout = fitTextLines(
    lines.map((line) => ({ width: context.measureText(line).width })),
    ascent + descent,
    ascent,
    layer,
    layer.align,
    rightToLeft,
  );
  if (!layout) return;
  context.fillStyle = layer.colour;
  lines.forEach((line, index) => {
    const placed = layout.lines[index];
    if (!placed || line === "") return;
    context.save();
    // Laid out at one size, and scaled by the transform: the same glyphs
    // and spacing at every output size.
    context.translate(placed.x, placed.baseline);
    context.scale(layout.scale, layout.scale);
    context.fillText(line, 0, 0);
    context.restore();
  });
}

async function drawImageLayer(
  context: Context,
  layer: ImageImageLayer,
  plan: ImagePlan,
  sources: (id: string) => ImageBitmap | undefined,
  signal: AbortSignal | undefined,
): Promise<void> {
  const source = sources(layer.source);
  if (!source) throw new TypeError(`There's no source with the id "${layer.source}".`);
  // Redacted pixels are replaced before the layer scales them (docs/adr/0010).
  const drawn = await sanitisedLayerSource(source, layer, plan, signal);
  const crop = cropRect(layer.crop, source);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    drawn,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    layer.width,
    layer.height,
  );
}

/**
 * A drawing's strokes (docs/adr/0014): each run a polyline through its
 * points, at the stroke's width, with round joins and round ends, and a run
 * of one point a disc as wide as the stroke. No curve is fitted.
 *
 * A run that starts where the one before it ended continues the same path,
 * as the simplifier's runs do. So a long stroke that was cut into runs is
 * drawn as the one line it is, joined where it was cut: pixel for pixel
 * what it would be uncut.
 */
function drawDrawing(context: Context, layer: ImageDrawingLayer): void {
  context.translate(layer.x, layer.y);
  context.lineJoin = "round";
  context.lineCap = "round";
  for (const stroke of layer.strokes) {
    context.strokeStyle = stroke.colour;
    context.fillStyle = stroke.colour;
    context.lineWidth = stroke.width;
    context.beginPath();
    const dots: number[] = [];
    let endX = Number.NaN;
    let endY = Number.NaN;
    for (const run of stroke.runs) {
      const x = run[0] as number;
      const y = run[1] as number;
      const joined = x === endX && y === endY;
      if (run.length === 2) {
        // A line of no length draws nothing in some engines: a dot is a disc,
        // unless it's on the end of a line, which already covers it.
        if (!joined) dots.push(x, y);
        endX = Number.NaN;
        continue;
      }
      if (!joined) context.moveTo(x, y);
      for (let index = 2; index + 1 < run.length; index += 2) {
        context.lineTo(run[index] as number, run[index + 1] as number);
      }
      endX = run[run.length - 2] as number;
      endY = run[run.length - 1] as number;
    }
    context.stroke();
    // The dots are filled, in the stroke's one colour: a stroked point has no outline to draw.
    if (dots.length > 0) {
      context.beginPath();
      for (let index = 0; index < dots.length; index += 2) {
        const x = dots[index] as number;
        const y = dots[index + 1] as number;
        context.moveTo(x + stroke.width / 2, y);
        context.arc(x, y, stroke.width / 2, 0, Math.PI * 2);
      }
      context.fill();
    }
  }
}

/** An arrow: its outline, filled, so nothing is drawn past its tip (docs/adr/0014). */
function drawArrow(context: Context, layer: ImageArrowLayer): void {
  const outline = arrowOutline(layer.from, layer.to, layer.width);
  context.fillStyle = layer.colour;
  context.beginPath();
  outline.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.closePath();
  context.fill();
}

/**
 * Draws the plan's visible layers into the output, in order.
 *
 * A layer with an opacity under 100 is drawn whole into a scratch canvas
 * the size of the output, then composited once: its fill and stroke, its
 * overlapping glyphs, or a drawing's crossing strokes, don't show through
 * each other. One scratch canvas is
 * reused from layer to layer.
 *
 * @param base - The base source's size, which the crop is in.
 * @param size - The output's size.
 * @param sources - The decoded source of an id, for image layers.
 */
export async function drawLayers(
  context: Context,
  plan: ImagePlan,
  base: ImageSize,
  size: ImageSize,
  sources: (id: string) => ImageBitmap | undefined,
  signal?: AbortSignal,
): Promise<void> {
  const crop = cropRect(plan.base.crop, base);
  let scratch: Context | undefined;
  for (const layer of plan.layers) {
    if (!layer.visible || layer.opacity === 0) continue;
    await checkpoint(signal);
    let target = context;
    if (layer.opacity < 100) {
      if (!scratch) {
        const made = new OffscreenCanvas(size.width, size.height).getContext("2d", {
          colorSpace: "srgb",
        });
        if (!made) throw new Error("The worker has no 2D canvas.");
        scratch = made;
      }
      scratch.setTransform(1, 0, 0, 1, 0, 0);
      scratch.clearRect(0, 0, size.width, size.height);
      target = scratch;
    }
    target.save();
    if (layer.kind === "drawing" || layer.kind === "arrow") {
      // Geometry in the scene, with no box of its own (docs/adr/0014).
      target.setTransform(...sceneToOutput(crop, plan.base.orientation, size));
      if (layer.kind === "drawing") drawDrawing(target, layer);
      else drawArrow(target, layer);
    } else {
      target.setTransform(...layerToOutput(layer, crop, plan.base.orientation, size));
      if (layer.kind === "shape") drawShape(target, layer);
      else if (layer.kind === "text") drawText(target, layer);
      else await drawImageLayer(target, layer, plan, sources, signal);
    }
    target.restore();
    if (target !== context) {
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = layer.opacity / 100;
      context.drawImage(target.canvas, 0, 0);
      context.restore();
    }
  }
  if (scratch) scratch.canvas.width = 0;
  // Copies made for image layers the plan no longer has aren't kept.
  const keys = new Set(plan.layers.map((layer) => layer.key));
  for (const id of new Set(
    plan.layers.flatMap((layer) => (layer.kind === "image" ? [layer.source] : [])),
  )) {
    const source = sources(id);
    if (source) pruneLayerCopies(source, keys);
  }
}
