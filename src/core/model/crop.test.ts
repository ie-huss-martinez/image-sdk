import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  aspectRatio,
  compositionDeltaToSource,
  cropInComposition,
  dragHandle,
  fitAspect,
  handleInSource,
  moveCrop,
  nudgeCropOnScreen,
} from "./crop.js";
import { compositionToSource, cropRect } from "./geometry.js";
import type { ImageOrientation, ImageRotation } from "./plan.js";

const SOURCE = { width: 400, height: 300 };
const ORIENTATIONS: ImageOrientation[] = [0, 90, 180, 270].flatMap((rotate) =>
  [false, true].flatMap((flipX) =>
    [false, true].map((flipY) => ({ rotate: rotate as ImageRotation, flipX, flipY })),
  ),
);

const crop = fc.record({ x: fc.nat(399), y: fc.nat(299) }).chain(({ x, y }) =>
  fc.record({
    x: fc.constant(x),
    y: fc.constant(y),
    width: fc.integer({ min: 1, max: 400 - x }),
    height: fc.integer({ min: 1, max: 300 - y }),
  }),
);
const handle = fc.constantFrom("n", "s", "e", "w", "ne", "nw", "se", "sw" as const);

describe("crop geometry (docs/adr/0007)", () => {
  it("fits the largest crop of a ratio, centred, in whole pixels", () => {
    const whole = { x: 0, y: 0, width: 400, height: 300 };
    expect(fitAspect(whole, 1)).toEqual({ x: 50, y: 0, width: 300, height: 300 });
    expect(fitAspect(whole, 16 / 9)).toEqual({ x: 0, y: 37, width: 400, height: 225 });
    expect(fitAspect(whole, aspectRatio("original", SOURCE))).toEqual(whole);
    expect(fitAspect(whole, undefined)).toBe(whole);
    expect(aspectRatio([3, 4], SOURCE)).toBe(0.75);
  });

  it("moves a crop, kept inside the source", () => {
    const c = { x: 10, y: 10, width: 100, height: 50 };
    expect(moveCrop(c, -50, 5, SOURCE)).toEqual({ ...c, x: 0, y: 15 });
    expect(moveCrop(c, 1_000, 1_000, SOURCE)).toEqual({ ...c, x: 300, y: 250 });
  });

  it("nudges as seen on screen, and resizes the right and bottom edges on screen", () => {
    const c = { x: 10, y: 10, width: 100, height: 50 };
    const upright: ImageOrientation = { rotate: 0, flipX: false, flipY: false };
    expect(nudgeCropOnScreen(c, "ArrowRight", 10, false, upright, SOURCE)).toEqual({ ...c, x: 20 });
    expect(nudgeCropOnScreen(c, "ArrowLeft", 1, true, upright, SOURCE)).toEqual({
      ...c,
      width: 99,
    });
    expect(nudgeCropOnScreen(c, "ArrowDown", 10, true, upright, SOURCE)).toEqual({
      ...c,
      height: 60,
    });
    // Turned clockwise, right on screen is up in the source.
    const turned: ImageOrientation = { rotate: 90, flipX: false, flipY: false };
    expect(nudgeCropOnScreen(c, "ArrowRight", 5, false, turned, SOURCE)).toEqual({ ...c, y: 5 });
    // Mirrored, right on screen is left in the source, and the screen's right edge is the source's left.
    const mirrored: ImageOrientation = { rotate: 0, flipX: true, flipY: false };
    expect(nudgeCropOnScreen(c, "ArrowRight", 5, false, mirrored, SOURCE)).toEqual({ ...c, x: 5 });
    expect(nudgeCropOnScreen(c, "ArrowRight", 5, true, mirrored, SOURCE)).toEqual({
      ...c,
      x: 5,
      width: 105,
    });
  });

  it("keeps every handle drag inside the source, in whole pixels, at least 1 × 1", () => {
    fc.assert(
      fc.property(
        crop,
        handle,
        fc.integer({ min: -500, max: 500 }),
        fc.integer({ min: -500, max: 500 }),
        fc.option(fc.constantFrom(1, 16 / 9, 0.75), { nil: undefined }),
        (c, h, dx, dy, ratio) => {
          const out = dragHandle(c, h, dx, dy, SOURCE, ratio);
          for (const value of Object.values(out)) expect(Number.isInteger(value)).toBe(true);
          expect(out.width).toBeGreaterThanOrEqual(1);
          expect(out.height).toBeGreaterThanOrEqual(1);
          expect(out.x).toBeGreaterThanOrEqual(0);
          expect(out.y).toBeGreaterThanOrEqual(0);
          expect(out.x + out.width).toBeLessThanOrEqual(SOURCE.width);
          expect(out.y + out.height).toBeLessThanOrEqual(SOURCE.height);
          if (ratio !== undefined && out.width > 4 && out.height > 4) {
            // Whole pixels round the ratio by at most a pixel either way.
            expect(Math.abs(out.width / out.height - ratio)).toBeLessThanOrEqual(
              ratio / Math.min(out.width, out.height) + 1 / out.height + 1e-9,
            );
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it("keeps the opposite edge put when a free handle is dragged", () => {
    const c = { x: 100, y: 100, width: 100, height: 100 };
    expect(dragHandle(c, "se", 20, -30, SOURCE)).toEqual({
      x: 100,
      y: 100,
      width: 120,
      height: 70,
    });
    expect(dragHandle(c, "nw", -20, 10, SOURCE)).toEqual({ x: 80, y: 110, width: 120, height: 90 });
  });

  it.each(ORIENTATIONS)(
    "maps a crop into the composition as the renderer does: %o",
    (orientation) => {
      fc.assert(
        fc.property(crop, (c) => {
          const shown = cropInComposition(c, orientation, SOURCE);
          // Mapping its corners back gives the crop's corners, in some order.
          const whole = cropRect(null, SOURCE);
          const corners = [
            compositionToSource({ x: shown.x, y: shown.y }, whole, orientation),
            compositionToSource(
              { x: shown.x + shown.width, y: shown.y + shown.height },
              whole,
              orientation,
            ),
          ];
          const xs = corners.map((p) => p.x).sort((a, b) => a - b);
          const ys = corners.map((p) => p.y).sort((a, b) => a - b);
          expect([xs[0], ys[0], (xs[1] ?? 0) - (xs[0] ?? 0), (ys[1] ?? 0) - (ys[0] ?? 0)]).toEqual([
            c.x,
            c.y,
            c.width,
            c.height,
          ]);
        }),
        { numRuns: 50 },
      );
    },
  );

  it("maps a handle and a drag on screen to the source's own edges and axes", () => {
    const turned: ImageOrientation = { rotate: 90, flipX: false, flipY: false };
    // Turned clockwise, the source's top edge is on the right of the screen,
    // and its left edge at the top.
    expect(handleInSource("e", turned)).toBe("n");
    expect(handleInSource("ne", turned)).toBe("nw");
    expect(compositionDeltaToSource(10, 0, turned, SOURCE)).toEqual({ dx: 0, dy: -10 });
    const mirrored: ImageOrientation = { rotate: 0, flipX: true, flipY: false };
    expect(handleInSource("e", mirrored)).toBe("w");
  });
});
