import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  arrowBounds,
  arrowOutline,
  drawingBounds,
  drawingPoints,
  simplifyStroke,
} from "./drawing-geometry.js";
import { createPlan, type ImageDrawingLayer } from "./plan.js";

const flat = (points: readonly (readonly [number, number])[]) => points.flat();
const pairs = (run: readonly number[]) => {
  const points: [number, number][] = [];
  for (let i = 0; i < run.length; i += 2) points.push([run[i] as number, run[i + 1] as number]);
  return points;
};

/** The distance from a point to a segment, in floating point: only to check the exact result. */
function distance(
  p: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

describe("simplifying a stroke (docs/adr/0014)", () => {
  it("keeps the ends of a run of collinear points", () => {
    expect(
      simplifyStroke(
        flat([
          [0, 0],
          [1, 1],
          [2, 2],
          [5, 5],
          [9, 9],
        ]),
        0,
      ),
    ).toEqual([[0, 0, 9, 9]]);
    expect(
      simplifyStroke(
        flat([
          [0, 0],
          [10, 0],
          [20, 0],
          [30, 0],
        ]),
        1,
      ),
    ).toEqual([[0, 0, 30, 0]]);
  });

  it("drops repeated points, and makes a single point a dot", () => {
    expect(
      simplifyStroke(
        flat([
          [3, 4],
          [3, 4],
          [3, 4],
        ]),
        1,
      ),
    ).toEqual([[3, 4]]);
    expect(simplifyStroke([7, -2], 0)).toEqual([[7, -2]]);
    expect(
      simplifyStroke(
        flat([
          [0, 0],
          [0, 0],
          [5, 0],
          [5, 0],
          [5, 5],
        ]),
        0,
      ),
    ).toEqual([[0, 0, 5, 0, 5, 5]]);
  });

  it("keeps a point farther than the tolerance, and drops one within it", () => {
    const bump = (height: number) =>
      flat([
        [0, 0],
        [10, height],
        [20, 0],
      ]);
    expect(simplifyStroke(bump(2), 2)).toEqual([[0, 0, 20, 0]]);
    expect(simplifyStroke(bump(3), 2)).toEqual([[0, 0, 10, 3, 20, 0]]);
    // With a tolerance of 0, only points exactly on the segment go.
    expect(simplifyStroke(bump(1), 0)).toEqual([[0, 0, 10, 1, 20, 0]]);
  });

  it("measures to the segment, not the line: a stroke that doubles back keeps its turn", () => {
    // Out to 30, then back along itself to 10: on the line through the ends, far from the segment.
    expect(
      simplifyStroke(
        flat([
          [0, 0],
          [30, 0],
          [10, 0],
        ]),
        5,
      ),
    ).toEqual([[0, 0, 30, 0, 10, 0]]);
    // Within the tolerance of the far end, the turn goes.
    expect(
      simplifyStroke(
        flat([
          [0, 0],
          [13, 0],
          [10, 0],
        ]),
        5,
      ),
    ).toEqual([[0, 0, 10, 0]]);
  });

  it("keeps a closed loop's far point, measured from the point both ends are", () => {
    expect(
      simplifyStroke(
        flat([
          [0, 0],
          [8, 0],
          [8, 8],
          [0, 8],
          [0, 0],
        ]),
        3,
      ),
    ).toEqual([[0, 0, 8, 0, 8, 8, 0, 8, 0, 0]]);
    // A loop that stays within the tolerance is its two ends, which are one place.
    expect(
      simplifyStroke(
        flat([
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ]),
        2,
      ),
    ).toEqual([[0, 0, 0, 0]]);
  });

  it("takes the first of points equally far", () => {
    // Two peaks of the same height: the first splits first, and both are kept.
    expect(
      simplifyStroke(
        flat([
          [0, 0],
          [5, 4],
          [10, 0],
          [15, 4],
          [20, 0],
        ]),
        1,
      ),
    ).toEqual([[0, 0, 5, 4, 10, 0, 15, 4, 20, 0]]);
    // Two points equally far, where keeping the first leaves the second within the tolerance.
    expect(
      simplifyStroke(
        flat([
          [0, 0],
          [4, 3],
          [6, 3],
          [10, 0],
        ]),
        2,
      ),
    ).toEqual([[0, 0, 4, 3, 10, 0]]);
  });

  it("is exact at the scene's limits, where a double would round", () => {
    // A point one pixel off a segment 131,072 long each way: its squared
    // cross product is past 2⁵³.
    const far = 65_536;
    expect(
      simplifyStroke(
        flat([
          [-far, -far],
          [0, 1],
          [far, far],
        ]),
        0,
      ),
    ).toEqual([[-far, -far, 0, 1, far, far]]);
    expect(
      simplifyStroke(
        flat([
          [-far, -far],
          [0, 0],
          [far, far],
        ]),
        0,
      ),
    ).toEqual([[-far, -far, far, far]]);
    // 0.7071 pixels from the line: within a tolerance of 1.
    expect(
      simplifyStroke(
        flat([
          [-far, -far],
          [0, 1],
          [far, far],
        ]),
        1,
      ),
    ).toEqual([[-far, -far, far, far]]);
  });

  it("cuts long input into runs of at most 2,000 points that share their ends", () => {
    // A zigzag, where every point is a turn and none can go.
    const zigzag = (count: number) =>
      flat(Array.from({ length: count }, (_, i) => [i * 4, i % 2 === 0 ? 0 : 40] as const));
    expect(simplifyStroke(zigzag(2_000), 1).map((run) => run.length / 2)).toEqual([2_000]);
    expect(simplifyStroke(zigzag(2_001), 1).map((run) => run.length / 2)).toEqual([2_000, 2]);
    const runs = simplifyStroke(zigzag(4_500), 1);
    expect(runs.map((run) => run.length / 2)).toEqual([2_000, 2_000, 502]);
    // Each run starts on the last point of the one before.
    for (let i = 1; i < runs.length; i += 1) {
      expect(runs[i]?.slice(0, 2)).toEqual(runs[i - 1]?.slice(-2));
    }
    // Together they're the input, with each shared point once.
    const joined = runs.flatMap((run, i) => (i === 0 ? run : run.slice(2)));
    expect(joined).toEqual(zigzag(4_500));
  });

  it("holds at most 64 runs, and refuses what isn't samples", () => {
    // A straight line, which simplifies in one pass a run: the limit is on samples, not on what's kept.
    const line = (count: number) => flat(Array.from({ length: count }, (_, i) => [i, 0] as const));
    // 1 + 64 × 1,999 points fill 64 runs; one more doesn't fit.
    const most = 1 + 64 * 1_999;
    expect(simplifyStroke(line(most), 0)).toHaveLength(64);
    expect(() => simplifyStroke(line(most + 1), 0)).toThrow(RangeError);
    expect(() => simplifyStroke([], 1)).toThrow(RangeError);
    expect(() => simplifyStroke([1, 2, 3], 1)).toThrow(RangeError);
    expect(() => simplifyStroke([1.5, 2], 1)).toThrow(RangeError);
    expect(() => simplifyStroke([1, 2], -1)).toThrow(RangeError);
    expect(() => simplifyStroke([1, 2], 0.5)).toThrow(RangeError);
  });

  it("keeps the ends, a subsequence of the input, with every dropped point within the tolerance", () => {
    const strokes = fc.array(
      fc.tuple(fc.integer({ min: -300, max: 300 }), fc.integer({ min: -300, max: 300 })),
      {
        minLength: 1,
        maxLength: 120,
      },
    );
    fc.assert(
      fc.property(strokes, fc.integer({ min: 0, max: 12 }), (points, tolerance) => {
        const runs = simplifyStroke(flat(points), tolerance);
        expect(runs).toHaveLength(1);
        const kept = pairs(runs[0] ?? []);
        // Without repeats, as the simplifier sees it.
        const input = points.filter(
          (p, i) => i === 0 || p[0] !== points[i - 1]?.[0] || p[1] !== points[i - 1]?.[1],
        );
        expect(kept[0]).toEqual(input[0]);
        expect(kept.at(-1)).toEqual(input.at(-1));
        // A subsequence, in order; and each point between two kept ones is near their segment.
        let at = 0;
        for (let k = 0; k + 1 < kept.length || k === 0; k += 1) {
          const a = kept[k] as [number, number];
          const b = kept[k + 1];
          while (at < input.length && (input[at]?.[0] !== a[0] || input[at]?.[1] !== a[1])) at += 1;
          expect(at).toBeLessThan(input.length);
          if (!b) break;
          let next = at + 1;
          while (next < input.length && (input[next]?.[0] !== b[0] || input[next]?.[1] !== b[1])) {
            expect(distance(input[next] as [number, number], a, b)).toBeLessThanOrEqual(
              tolerance + 1e-9,
            );
            next += 1;
          }
          expect(next).toBeLessThan(input.length);
        }
        // Simplifying again changes nothing.
        expect(simplifyStroke(runs[0] ?? [], tolerance)).toEqual(runs);
      }),
    );
  });
});

describe("an arrow's outline (docs/adr/0014)", () => {
  it("has its tip on the point it aims at, a head four widths long and across, and a square tail", () => {
    // Along x, 100 long, 4 wide: the head is 16 long and 16 across.
    expect(arrowOutline({ x: 0, y: 0 }, { x: 100, y: 0 }, 4)).toEqual([
      { x: 0, y: -2 },
      { x: 0, y: 2 },
      { x: 84, y: 2 },
      { x: 84, y: 8 },
      { x: 100, y: 0 },
      { x: 84, y: -8 },
      { x: 84, y: -2 },
    ]);
    // Down the image: its left, as it points, is the scene's right.
    expect(arrowOutline({ x: 10, y: 10 }, { x: 10, y: 60 }, 2)).toEqual([
      { x: 11, y: 10 },
      { x: 9, y: 10 },
      { x: 9, y: 52 },
      { x: 6, y: 52 },
      { x: 10, y: 60 },
      { x: 14, y: 52 },
      { x: 11, y: 52 },
    ]);
  });

  it("is all head when it's shorter than its head, keeping the head's proportions", () => {
    // 8 long and 4 wide: a head of 8 by 8, with its base centred on the tail.
    expect(arrowOutline({ x: 0, y: 0 }, { x: 8, y: 0 }, 4)).toEqual([
      { x: 0, y: -2 },
      { x: 0, y: 2 },
      { x: 0, y: 2 },
      { x: 0, y: 4 },
      { x: 8, y: 0 },
      { x: 0, y: -4 },
      { x: 0, y: -2 },
    ]);
    // Shorter than its own width: the shaft's points stay inside the base.
    const tiny = arrowOutline({ x: 0, y: 0 }, { x: 2, y: 0 }, 8);
    expect(tiny[4]).toEqual({ x: 2, y: 0 });
    expect(tiny.map((point) => Math.abs(point.y)).sort((a, b) => b - a)[0]).toBe(1);
  });

  it("always has seven points, its fifth the tip, and never a negative zero", () => {
    const points = fc.record({
      x: fc.integer({ min: -65_536, max: 65_536 }),
      y: fc.integer({ min: -65_536, max: 65_536 }),
    });
    fc.assert(
      fc.property(points, points, fc.integer({ min: 1, max: 1_024 }), (from, to, width) => {
        fc.pre(from.x !== to.x || from.y !== to.y);
        const outline = arrowOutline(from, to, width);
        expect(outline).toHaveLength(7);
        expect(outline[4]).toEqual(to);
        for (const point of outline) {
          expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
          expect(Object.is(point.x, -0) || Object.is(point.y, -0)).toBe(false);
        }
        // Nothing is drawn past the tip: every point is behind it, along the arrow.
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        for (const point of outline) {
          const along =
            ((point.x - from.x) * (to.x - from.x) + (point.y - from.y) * (to.y - from.y)) / length;
          expect(along).toBeLessThanOrEqual(length + 1e-6);
          expect(along).toBeGreaterThanOrEqual(-1e-6);
        }
      }),
    );
    expect(() => arrowOutline({ x: 3, y: 3 }, { x: 3, y: 3 }, 2)).toThrow(RangeError);
  });
});

describe("bounds and counts (docs/adr/0014)", () => {
  const drawing: ImageDrawingLayer = {
    key: "d",
    kind: "drawing",
    name: "",
    visible: true,
    opacity: 100,
    x: 100,
    y: 50,
    strokes: [
      {
        colour: "#000000",
        width: 4,
        runs: [
          [0, 0, 10, 0],
          [10, 0, 10, 20],
        ],
      },
      { colour: "#ff0000", width: 3, runs: [[-5, 7]] },
    ],
  };

  it("holds a drawing's points and half of each stroke's width around them, in whole pixels", () => {
    // Points from 95 to 110 across and 50 to 70 down; widths 4 and 3.
    expect(drawingBounds(drawing)).toEqual({ x: 93, y: 48, width: 19, height: 24 });
    // A dot of width 3 at the origin: 1.5 each way, outward to whole pixels.
    expect(
      drawingBounds({ x: 0, y: 0, strokes: [{ colour: "#000000", width: 3, runs: [[0, 0]] }] }),
    ).toEqual({ x: -2, y: -2, width: 4, height: 4 });
  });

  it("holds an arrow's outline", () => {
    expect(arrowBounds({ from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, width: 4 })).toEqual({
      x: 0,
      y: -8,
      width: 100,
      height: 16,
    });
  });

  it("counts a plan's drawing points, across runs and strokes", () => {
    const plan = { ...createPlan("s"), layers: [drawing, { ...drawing, key: "e" }] };
    expect(drawingPoints(plan)).toBe(10);
    expect(drawingPoints(createPlan("s"))).toBe(0);
  });
});
