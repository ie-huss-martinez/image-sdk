import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compositionToSource } from "./geometry.js";
import type { ImageOrientation } from "./plan.js";
import {
  type ImageRect,
  redactionBlockSize,
  redactionBlocksInOutput,
  redactionBlocksInScene,
  redactionRectInOutput,
} from "./redaction-geometry.js";

const area = (rects: readonly ImageRect[]) =>
  rects.reduce((sum, { width, height }) => sum + width * height, 0);

/** Whether no two rectangles share a pixel. */
function disjoint(rects: readonly ImageRect[]): boolean {
  return rects.every((a, i) =>
    rects
      .slice(i + 1)
      .every(
        (b) =>
          a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y,
      ),
  );
}

const region = fc.record({
  x: fc.integer({ min: -30, max: 70 }),
  y: fc.integer({ min: -30, max: 60 }),
  width: fc.integer({ min: 1, max: 120 }),
  height: fc.integer({ min: 1, max: 120 }),
});
/** A crop inside a 60 × 40 source. */
const crop = fc.record({ x: fc.nat(59), y: fc.nat(39) }).chain(({ x, y }) =>
  fc.record({
    x: fc.constant(x),
    y: fc.constant(y),
    width: fc.integer({ min: 1, max: 60 - x }),
    height: fc.integer({ min: 1, max: 40 - y }),
  }),
);
const orientation: fc.Arbitrary<ImageOrientation> = fc.record({
  rotate: fc.constantFrom(0 as const, 90 as const, 180 as const, 270 as const),
  flipX: fc.boolean(),
  flipY: fc.boolean(),
});
const size = fc.record({
  width: fc.integer({ min: 1, max: 50 }),
  height: fc.integer({ min: 1, max: 50 }),
});

describe("redaction geometry (ADR 0010)", () => {
  it("sizes blocks at 8 pixels, or a twelfth of the longer side when that's more", () => {
    expect(redactionBlockSize({ width: 1, height: 1 })).toBe(8);
    expect(redactionBlockSize({ width: 96, height: 96 })).toBe(8);
    expect(redactionBlockSize({ width: 97, height: 5 })).toBe(9);
    expect(redactionBlockSize({ width: 5, height: 1_200 })).toBe(100);
    fc.assert(
      fc.property(region, (r) => {
        const block = redactionBlockSize(r);
        expect(block).toBeGreaterThanOrEqual(8);
        // Never more than 12 blocks along the longer side.
        expect(Math.ceil(Math.max(r.width, r.height) / block)).toBeLessThanOrEqual(12);
      }),
    );
  });

  it("tiles the part of a region inside the crop with blocks, exactly once", () => {
    fc.assert(
      fc.property(region, crop, (r, within) => {
        const blocks = redactionBlocksInScene(r, within);
        const left = Math.max(r.x, within.x);
        const top = Math.max(r.y, within.y);
        const right = Math.min(r.x + r.width, within.x + within.width);
        const bottom = Math.min(r.y + r.height, within.y + within.height);
        const inside = Math.max(0, right - left) * Math.max(0, bottom - top);
        expect(area(blocks)).toBe(inside);
        expect(disjoint(blocks)).toBe(true);
        const block = redactionBlockSize(r);
        for (const b of blocks) {
          expect(b.x).toBeGreaterThanOrEqual(left);
          expect(b.y).toBeGreaterThanOrEqual(top);
          expect(b.x + b.width).toBeLessThanOrEqual(right);
          expect(b.y + b.height).toBeLessThanOrEqual(bottom);
          expect(Math.max(b.width, b.height)).toBeLessThanOrEqual(block);
        }
      }),
    );
  });

  it("covers every output pixel that shows any part of the region", () => {
    fc.assert(
      fc.property(region, crop, orientation, size, (r, within, turn, output) => {
        const rect = redactionRectInOutput(r, within, turn, output);
        const turned = turn.rotate % 180 !== 0;
        const composition = turned
          ? { width: within.height, height: within.width }
          : { width: within.width, height: within.height };
        for (let y = 0; y < output.height; y += 1) {
          for (let x = 0; x < output.width; x += 1) {
            const covered =
              rect !== null &&
              x >= rect.x &&
              x < rect.x + rect.width &&
              y >= rect.y &&
              y < rect.y + rect.height;
            if (covered) continue;
            // The scene area an uncovered pixel shows, from its corners,
            // mapped back independently of the function under test.
            const corners = [
              [x, y],
              [x + 1, y + 1],
            ].map(([cx, cy]) =>
              compositionToSource(
                {
                  x: ((cx as number) * composition.width) / output.width,
                  y: ((cy as number) * composition.height) / output.height,
                },
                within,
                turn,
              ),
            );
            const [a, b] = corners as [{ x: number; y: number }, { x: number; y: number }];
            const overlapX =
              Math.min(Math.max(a.x, b.x), r.x + r.width) - Math.max(Math.min(a.x, b.x), r.x);
            const overlapY =
              Math.min(Math.max(a.y, b.y), r.y + r.height) - Math.max(Math.min(a.y, b.y), r.y);
            // It may touch the region's edge, within rounding, but shows none of it.
            expect(Math.min(overlapX, overlapY)).toBeLessThanOrEqual(1e-9);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it("tiles the region's output pixels with its blocks, exactly once", () => {
    fc.assert(
      fc.property(region, crop, orientation, size, (r, within, turn, output) => {
        const rect = redactionRectInOutput(r, within, turn, output);
        const blocks = redactionBlocksInOutput(r, within, turn, output);
        expect(area(blocks)).toBe(rect === null ? 0 : rect.width * rect.height);
        expect(disjoint(blocks)).toBe(true);
        for (const b of blocks) {
          expect(rect).not.toBeNull();
          if (rect === null) continue;
          expect(b.x).toBeGreaterThanOrEqual(rect.x);
          expect(b.y).toBeGreaterThanOrEqual(rect.y);
          expect(b.x + b.width).toBeLessThanOrEqual(rect.x + rect.width);
          expect(b.y + b.height).toBeLessThanOrEqual(rect.y + rect.height);
        }
      }),
    );
  });

  it("maps the scene's blocks to the same pixels at full size, upright", () => {
    fc.assert(
      fc.property(region, crop, (r, within) => {
        const upright = { rotate: 0, flipX: false, flipY: false } as const;
        const output = { width: within.width, height: within.height };
        const moved = redactionBlocksInScene(r, within).map((b) => ({
          ...b,
          x: b.x - within.x,
          y: b.y - within.y,
        }));
        expect(redactionBlocksInOutput(r, within, upright, output)).toEqual(moved);
      }),
    );
  });
});
