import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compositionSize, cropRect } from "./geometry.js";
import { applyMatrix, layerToOutput } from "./layer-geometry.js";
import { fittedImageSize, newLayerBox } from "./layer-placement.js";
import { createPlan, type ImageLayerBox, type ImagePlan } from "./plan.js";

const SOURCE = { id: "base", width: 400, height: 200 };
const plan = (changes: Partial<ImagePlan["base"]> = {}): ImagePlan => {
  const created = createPlan("base");
  return { ...created, base: { ...created.base, ...changes } };
};

/** What a box covers on screen: the bounds of its corners, and where its top-left corner is. */
function seen(box: ImageLayerBox, of: ImagePlan) {
  const composition = compositionSize(of, SOURCE);
  const matrix = layerToOutput(
    box,
    cropRect(of.base.crop, SOURCE),
    of.base.orientation,
    composition,
  );
  const corners = [
    { x: 0, y: 0 },
    { x: box.width, y: 0 },
    { x: 0, y: box.height },
    { x: box.width, y: box.height },
  ].map((corner) => applyMatrix(matrix, corner));
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    /** Whether the box reads as it was made: its own top-left corner is the top left on screen. */
    asMade:
      Math.abs((corners[0]?.x ?? 0) - Math.min(...xs)) < 1e-9 &&
      Math.abs((corners[0]?.y ?? 0) - Math.min(...ys)) < 1e-9 &&
      Math.abs((corners[1]?.y ?? 0) - Math.min(...ys)) < 1e-9,
    composition,
  };
}

const orientations = fc.record({
  rotate: fc.constantFrom(0 as const, 90 as const, 180 as const, 270 as const),
  flipX: fc.boolean(),
  flipY: fc.boolean(),
});

describe("a new layer's box (ADR 0009)", () => {
  it("is the size asked for, in the middle of an upright image", () => {
    expect(newLayerBox(plan(), SOURCE, { width: 100, height: 40 })).toEqual({
      x: 150,
      y: 80,
      width: 100,
      height: 40,
      rotation: 0,
      flipX: false,
    });
  });

  it("is in the middle of the crop, not of the source", () => {
    const cropped = plan({ crop: { x: 200, y: 0, width: 200, height: 100 } });
    expect(newLayerBox(cropped, SOURCE, { width: 50, height: 20 })).toMatchObject({
      x: 275,
      y: 40,
    });
  });

  it("is seen at its size, in the middle, neither turned nor mirrored, whatever the plan's turn and flips", () => {
    fc.assert(
      fc.property(
        orientations,
        fc.integer({ min: 1, max: 300 }),
        fc.integer({ min: 1, max: 300 }),
        (orientation, width, height) => {
          const turned = plan({ orientation });
          const box = newLayerBox(turned, SOURCE, { width, height });
          for (const value of [box.x, box.y, box.width, box.height]) {
            expect(Number.isInteger(value)).toBe(true);
          }
          expect([0, 900, 1_800, 2_700]).toContain(box.rotation);
          const on = seen(box, turned);
          // Not turned and not mirrored, as it's seen: text in it reads as text.
          expect(on.asMade).toBe(true);
          expect(on.width).toBeCloseTo(width, 9);
          expect(on.height).toBeCloseTo(height, 9);
          // Centred, to the half pixel the whole-pixel grid allows.
          expect(Math.abs(on.left + on.width / 2 - on.composition.width / 2)).toBeLessThanOrEqual(
            0.5,
          );
          expect(Math.abs(on.top + on.height / 2 - on.composition.height / 2)).toBeLessThanOrEqual(
            0.5,
          );
        },
      ),
    );
  });

  it("mirrors back for a mirrored plan, so text added to it reads as text", () => {
    const mirrored = plan({ orientation: { rotate: 0, flipX: true, flipY: false } });
    expect(newLayerBox(mirrored, SOURCE, { width: 60, height: 20 })).toMatchObject({
      rotation: 0,
      flipX: true,
    });
    // Mirrored top to bottom: a mirror left to right, and a half turn.
    const upsideDown = plan({ orientation: { rotate: 0, flipX: false, flipY: true } });
    expect(newLayerBox(upsideDown, SOURCE, { width: 60, height: 20 })).toMatchObject({
      rotation: 1_800,
      flipX: true,
    });
    // Both flips are a half turn, and no mirror.
    const both = plan({ orientation: { rotate: 0, flipX: true, flipY: true } });
    expect(newLayerBox(both, SOURCE, { width: 60, height: 20 })).toMatchObject({
      rotation: 1_800,
      flipX: false,
    });
  });

  it("turns back a quarter for a plan turned a quarter", () => {
    const quarter = plan({ orientation: { rotate: 90, flipX: false, flipY: false } });
    expect(newLayerBox(quarter, SOURCE, { width: 60, height: 20 }).rotation).toBe(2_700);
    const half = plan({ orientation: { rotate: 180, flipX: false, flipY: false } });
    expect(newLayerBox(half, SOURCE, { width: 60, height: 20 }).rotation).toBe(1_800);
  });
});

describe("the size a new image layer is seen at (ADR 0009)", () => {
  it("fits half of what's shown, keeping its shape, and never enlarges", () => {
    // 1000 × 250 into 200 × 100: a fifth.
    expect(fittedImageSize(plan(), SOURCE, { width: 1_000, height: 250 })).toEqual({
      width: 200,
      height: 50,
    });
    expect(fittedImageSize(plan(), SOURCE, { width: 30, height: 20 })).toEqual({
      width: 30,
      height: 20,
    });
    // Half of what's shown: the crop, turned.
    const turned = plan({
      crop: { x: 0, y: 0, width: 100, height: 40 },
      orientation: { rotate: 90, flipX: false, flipY: false },
    });
    // Shown as 40 × 100: half is 20 × 50, and 200 × 100 fits it at a tenth.
    expect(fittedImageSize(turned, SOURCE, { width: 200, height: 100 })).toEqual({
      width: 20,
      height: 10,
    });
  });
});
