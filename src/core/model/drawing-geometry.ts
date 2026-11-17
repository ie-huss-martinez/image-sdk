import {
  type ImageArrowLayer,
  type ImageDrawingLayer,
  type ImagePlan,
  type ImageScenePoint,
  MAX_RUN_POINTS,
  MAX_STROKE_RUNS,
} from "./plan.js";
import type { ImageRect } from "./redaction-geometry.js";

/**
 * Simplifies one run in place of its kept points: Ramer–Douglas–Peucker on
 * whole pixels, with distance to the segment (docs/adr/0014). Every
 * comparison is between whole numbers. A squared cross product reaches
 * 2⁷⁰, past what a double holds, so those are `BigInt`s; everything else is
 * exact in doubles.
 */
function simplifyRun(xs: readonly number[], ys: readonly number[], tolerance: number): number[] {
  const count = xs.length;
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  const limit = BigInt(tolerance) * BigInt(tolerance);
  // Its own stack, so a long run can't exhaust the call stack.
  const stack = [0, count - 1];
  while (stack.length > 0) {
    const last = stack.pop() as number;
    const first = stack.pop() as number;
    if (last - first < 2) continue;
    const ax = xs[first] as number;
    const ay = ys[first] as number;
    const dx = (xs[last] as number) - ax;
    const dy = (ys[last] as number) - ay;
    // Under 2³⁶: exact.
    const length = dx * dx + dy * dy;
    let farthest = -1;
    let most = -1n;
    for (let index = first + 1; index < last; index += 1) {
      const px = (xs[index] as number) - ax;
      const py = (ys[index] as number) - ay;
      let measure: bigint;
      if (length === 0) {
        // A closed loop: the distance to the point both ends are.
        measure = BigInt(px * px + py * py);
      } else {
        const along = px * dx + py * dy;
        if (along <= 0) {
          // Before the segment's start: as far as it is from the start.
          measure = BigInt(px * px + py * py) * BigInt(length);
        } else if (along >= length) {
          const qx = px - dx;
          const qy = py - dy;
          measure = BigInt(qx * qx + qy * qy) * BigInt(length);
        } else {
          const cross = BigInt(px * dy - py * dx);
          measure = cross * cross;
        }
      }
      // Among points equally far, the first.
      if (measure > most) {
        most = measure;
        farthest = index;
      }
    }
    if (most > (length === 0 ? limit : limit * BigInt(length))) {
      keep[farthest] = 1;
      stack.push(first, farthest, farthest, last);
    }
  }
  const points: number[] = [];
  for (let index = 0; index < count; index += 1) {
    if (keep[index] === 1) points.push(xs[index] as number, ys[index] as number);
  }
  return points;
}

/**
 * A pointer's samples as one stroke's `runs` (docs/adr/0014): repeats
 * dropped, long input cut into runs of at most 2,000 points that share
 * their end points, and each run simplified by Ramer–Douglas–Peucker with
 * distance to the segment. The same samples give the same runs in every
 * engine: every comparison is between whole numbers.
 *
 * A tolerance of 0 drops only repeats and points exactly on a segment.
 *
 * @param points - `[x0, y0, x1, y1, …]`, in whole pixels from the drawing's
 *   origin: at least one point.
 * @param tolerance - In whole scene pixels, from 0. The draw tool passes one
 *   screen pixel's worth.
 * @returns 1 to 64 runs, each `[x0, y0, …]` of 1 to 2,000 points.
 * @throws `RangeError` for no points, an odd number of coordinates, a
 *   coordinate or a tolerance that isn't a whole number, or more points
 *   than 64 runs hold: a caller's mistake, since samples aren't a file's.
 * @public
 */
export function simplifyStroke(points: readonly number[], tolerance: number): number[][] {
  if (points.length < 2 || points.length % 2 !== 0) {
    throw new RangeError("A stroke's samples are an x and a y for each of at least one point.");
  }
  if (!Number.isSafeInteger(tolerance) || tolerance < 0) {
    throw new RangeError("A tolerance is a whole number of pixels, from 0.");
  }
  // Repeats go first.
  const xs: number[] = [];
  const ys: number[] = [];
  for (let index = 0; index < points.length; index += 2) {
    const x = points[index] as number;
    const y = points[index + 1] as number;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
      throw new RangeError("A stroke's samples are in whole pixels.");
    }
    const previous = xs.length - 1;
    if (previous >= 0 && xs[previous] === x && ys[previous] === y) continue;
    xs.push(x);
    ys.push(y);
  }
  if (xs.length === 1) return [[xs[0] as number, ys[0] as number]];
  // Each run starts on the last point of the one before, so the runs join:
  // a run after the first adds 1,999 new points.
  const runs: number[][] = [];
  for (let start = 0; start < xs.length - 1; start += MAX_RUN_POINTS - 1) {
    if (runs.length === MAX_STROKE_RUNS) {
      throw new RangeError(`A stroke holds at most ${MAX_STROKE_RUNS} runs of samples.`);
    }
    const end = Math.min(start + MAX_RUN_POINTS, xs.length);
    runs.push(simplifyRun(xs.slice(start, end), ys.slice(start, end), tolerance));
  }
  return runs;
}

/**
 * An arrow's outline (docs/adr/0014): seven points of a polygon, in scene
 * pixels, which the renderer fills. Its tip is exactly on `to`. The head is
 * a triangle `4 × width` long and `4 × width` across at its base; the shaft
 * is a rectangle `width` across from `from` to the middle of the head's
 * base. An arrow shorter than its head is all head: the triangle keeps its
 * proportions, as long as the arrow, and the shaft's four points are on its
 * base.
 *
 * In order: the shaft's tail, left then right as the arrow points; the
 * shaft's end on the base, right; the head's right corner; the tip; the
 * head's left corner; the shaft's end on the base, left.
 *
 * @throws `RangeError` when `from` equals `to`: there's no direction.
 * @public
 */
export function arrowOutline(
  from: ImageScenePoint,
  to: ImageScenePoint,
  width: number,
): ImageScenePoint[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) throw new RangeError("An arrow's ends differ.");
  // Along the arrow, and to its left as it points.
  const ux = dx / length;
  const uy = dy / length;
  const lx = uy;
  const ly = -ux;
  const head = Math.min(4 * width, length);
  // The head keeps its proportions when it's shortened.
  const half = head / 2;
  const shaft = Math.min(width / 2, half);
  const base = { x: to.x - ux * head, y: to.y - uy * head };
  const at = (origin: { x: number; y: number }, left: number): ImageScenePoint => ({
    x: origin.x + lx * left || 0,
    y: origin.y + ly * left || 0,
  });
  return [
    at(from, shaft),
    at(from, -shaft),
    at(base, -shaft),
    at(base, -half),
    { x: to.x, y: to.y },
    at(base, half),
    at(base, shaft),
  ];
}

/** The smallest whole-pixel rectangle around a box given by its edges. */
const around = (left: number, top: number, right: number, bottom: number): ImageRect => {
  const x = Math.floor(left);
  const y = Math.floor(top);
  return { x, y, width: Math.ceil(right) - x, height: Math.ceil(bottom) - y };
};

/**
 * The smallest whole-pixel rectangle of the scene that holds everything a
 * drawing draws: its points, and half of each stroke's width around them
 * (docs/adr/0014). The editor places a drawing's frame with it.
 *
 * @public
 */
export function drawingBounds(drawing: Pick<ImageDrawingLayer, "x" | "y" | "strokes">): ImageRect {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const stroke of drawing.strokes) {
    const reach = stroke.width / 2;
    for (const run of stroke.runs) {
      for (let index = 0; index + 1 < run.length; index += 2) {
        const x = drawing.x + (run[index] as number);
        const y = drawing.y + (run[index + 1] as number);
        left = Math.min(left, x - reach);
        top = Math.min(top, y - reach);
        right = Math.max(right, x + reach);
        bottom = Math.max(bottom, y + reach);
      }
    }
  }
  // A drawing has a stroke; one with none, which the plan refuses, is a point.
  if (left > right) return { x: drawing.x, y: drawing.y, width: 0, height: 0 };
  return around(left, top, right, bottom);
}

/**
 * The smallest whole-pixel rectangle of the scene that holds an arrow's
 * outline.
 *
 * @public
 */
export function arrowBounds(arrow: Pick<ImageArrowLayer, "from" | "to" | "width">): ImageRect {
  const outline = arrowOutline(arrow.from, arrow.to, arrow.width);
  const xs = outline.map((point) => point.x);
  const ys = outline.map((point) => point.y);
  return around(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
}

/**
 * How many points a plan's drawings hold, across every run of every stroke:
 * what `maxDrawingPoints` limits (ADR 0009).
 *
 * @public
 */
export function drawingPoints(plan: Pick<ImagePlan, "layers">): number {
  let points = 0;
  for (const layer of plan.layers) {
    if (layer.kind !== "drawing") continue;
    for (const stroke of layer.strokes) {
      for (const run of stroke.runs) points += run.length / 2;
    }
  }
  return points;
}
