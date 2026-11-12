import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  compositionSize,
  compositionToSource,
  cropRect,
  orientedSize,
  outputSize,
  sourceToComposition,
} from "./geometry.js";
import type { ImageCrop, ImageOrientation } from "./plan.js";
import { createPlan } from "./plan.js";
import type { ExifOrientation } from "./source.js";

/**
 * Where an upright pixel comes from in the stored pixels, for each EXIF
 * orientation, written from the EXIF specification and independently of the
 * code under test.
 */
function exifStoredFor(tag: ExifOrientation, x: number, y: number, w: number, h: number) {
  return [
    [x, y],
    [w - 1 - x, y],
    [w - 1 - x, h - 1 - y],
    [x, h - 1 - y],
    [y, x],
    [y, h - 1 - x],
    [w - 1 - y, h - 1 - x],
    [w - 1 - y, x],
  ][tag - 1] as [number, number];
}

/** The plan orientation that turns pixels the way each EXIF orientation does. */
const EXIF_AS_PLAN: Record<ExifOrientation, ImageOrientation> = {
  1: { rotate: 0, flipX: false, flipY: false },
  2: { rotate: 0, flipX: true, flipY: false },
  3: { rotate: 180, flipX: false, flipY: false },
  4: { rotate: 0, flipX: false, flipY: true },
  5: { rotate: 90, flipX: true, flipY: false },
  6: { rotate: 90, flipX: false, flipY: false },
  7: { rotate: 270, flipX: true, flipY: false },
  8: { rotate: 270, flipX: false, flipY: false },
};

const TAGS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

describe("orientedSize", () => {
  it.each(TAGS)("swaps width and height only for orientations 5 to 8 (tag %i)", (tag) => {
    expect(orientedSize({ width: 4, height: 3 }, tag)).toEqual(
      tag >= 5 ? { width: 3, height: 4 } : { width: 4, height: 3 },
    );
  });
});

describe("mapping between the source and the composition", () => {
  // A crop away from every edge of a 7 × 5 source, so swapped axes, an
  // offset applied in the wrong space, or a flip about the wrong extent shows.
  const SOURCE = { width: 7, height: 5 };
  const CROP: ImageCrop = { x: 2, y: 1, width: 4, height: 3 };

  it.each(TAGS)("matches EXIF orientation %i, pixel for pixel, inside a non-zero crop", (tag) => {
    const orientation = EXIF_AS_PLAN[tag];
    const plan = createPlan("s");
    const size = compositionSize(
      { ...plan, base: { ...plan.base, crop: CROP, orientation } },
      SOURCE,
    );
    expect(size).toEqual(orientedSize({ width: CROP.width, height: CROP.height }, tag));
    for (let y = 0; y < size.height; y += 1) {
      for (let x = 0; x < size.width; x += 1) {
        const at = compositionToSource({ x: x + 0.5, y: y + 0.5 }, CROP, orientation);
        const [cx, cy] = exifStoredFor(tag, x, y, CROP.width, CROP.height);
        expect([Math.floor(at.x), Math.floor(at.y)], `${x},${y}`).toEqual([
          CROP.x + cx,
          CROP.y + cy,
        ]);
      }
    }
  });

  it.each(TAGS)("maps the crop's corners to the composition's corners (tag %i)", (tag) => {
    const orientation = EXIF_AS_PLAN[tag];
    const { width, height } = orientedSize(CROP, tag);
    const corners = [
      { x: CROP.x, y: CROP.y },
      { x: CROP.x + CROP.width, y: CROP.y },
      { x: CROP.x, y: CROP.y + CROP.height },
      { x: CROP.x + CROP.width, y: CROP.y + CROP.height },
    ].map((corner) => sourceToComposition(corner, CROP, orientation));
    expect(new Set(corners.map(({ x, y }) => `${x},${y}`))).toEqual(
      new Set([`0,0`, `${width},0`, `0,${height}`, `${width},${height}`]),
    );
  });

  it("round-trips any point through every rotation and flip, with any crop", () => {
    fc.assert(
      fc.property(
        fc.record({ x: fc.integer({ min: 0, max: 50 }), y: fc.integer({ min: 0, max: 50 }) }),
        fc.record({
          width: fc.integer({ min: 1, max: 50 }),
          height: fc.integer({ min: 1, max: 50 }),
        }),
        fc.constantFrom(0, 90, 180, 270),
        fc.boolean(),
        fc.boolean(),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (offset, size, rotate, flipX, flipY, u, v) => {
          const crop = { ...offset, ...size };
          const orientation = { rotate, flipX, flipY } as ImageOrientation;
          const point = { x: crop.x + u * crop.width, y: crop.y + v * crop.height };
          const back = compositionToSource(
            sourceToComposition(point, crop, orientation),
            crop,
            orientation,
          );
          expect(back.x).toBeCloseTo(point.x, 9);
          expect(back.y).toBeCloseTo(point.y, 9);
        },
      ),
    );
  });
});

describe("sizes", () => {
  it("uses the whole source without a crop, and turns the composition with the rotation", () => {
    const plan = createPlan("s");
    expect(cropRect(null, { width: 6, height: 4 })).toEqual({ x: 0, y: 0, width: 6, height: 4 });
    const turned = {
      ...plan,
      base: { ...plan.base, orientation: { rotate: 90, flipX: false, flipY: false } as const },
    };
    expect(compositionSize(turned, { width: 6, height: 4 })).toEqual({ width: 4, height: 6 });
  });

  it("scales or fits the output, never enlarging, with whole pixels of at least 1", () => {
    const composition = { width: 3_000, height: 2_000 };
    expect(outputSize({ kind: "scale", scale: 0.5 }, composition)).toEqual({
      width: 1_500,
      height: 1_000,
    });
    expect(outputSize({ kind: "fit", width: 300, height: 300 }, composition)).toEqual({
      width: 300,
      height: 200,
    });
    expect(outputSize({ kind: "fit", width: 10_000, height: 10_000 }, composition)).toEqual(
      composition,
    );
    expect(outputSize({ kind: "scale", scale: 0.0001 }, composition)).toEqual({
      width: 1,
      height: 1,
    });
  });
});
