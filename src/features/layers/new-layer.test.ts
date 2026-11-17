import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compositionSize, cropRect } from "../../core/model/geometry.js";
import { applyMatrix, layerToOutput } from "../../core/model/layer-geometry.js";
import { createPlan, type ImageLayerBox, type ImagePlan } from "../../core/model/plan.js";
import { createImageReducer } from "../../core/operations/commands.js";
import {
  defaultStrokeWidth,
  insertOnTop,
  newImageLayer,
  newLayerBox,
  newLayerKey,
  newShapeLayer,
  newTextLayer,
} from "./new-layer.js";

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
    /** Whether the box's own top edge is its top on screen. */
    topIsUp:
      Math.abs((corners[0]?.y ?? 0) - (corners[1]?.y ?? 0)) < 1e-9 &&
      (corners[0]?.y ?? 0) < (corners[2]?.y ?? 0),
    composition,
  };
}

const orientations = fc.record({
  rotate: fc.constantFrom(0 as const, 90 as const, 180 as const, 270 as const),
  flipX: fc.boolean(),
  flipY: fc.boolean(),
});

describe("a new layer's box (ADR 0013)", () => {
  it("is the size asked for, in the middle of an upright image", () => {
    expect(newLayerBox(plan(), SOURCE, { width: 100, height: 40 })).toEqual({
      x: 150,
      y: 80,
      width: 100,
      height: 40,
      rotation: 0,
    });
  });

  it("is in the middle of the crop, not of the source", () => {
    const cropped = plan({ crop: { x: 200, y: 0, width: 200, height: 100 } });
    expect(newLayerBox(cropped, SOURCE, { width: 50, height: 20 })).toMatchObject({
      x: 275,
      y: 40,
    });
  });

  it("is seen at its size, in the middle, with its top up, whatever the plan's turn and flips", () => {
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
          expect(on.topIsUp).toBe(true);
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

  it("turns back a quarter for a plan turned a quarter", () => {
    const quarter = plan({ orientation: { rotate: 90, flipX: false, flipY: false } });
    expect(newLayerBox(quarter, SOURCE, { width: 60, height: 20 }).rotation).toBe(2_700);
    const half = plan({ orientation: { rotate: 180, flipX: false, flipY: false } });
    expect(newLayerBox(half, SOURCE, { width: 60, height: 20 }).rotation).toBe(1_800);
  });
});

describe("new layers (ADR 0013)", () => {
  const reducer = createImageReducer((id) =>
    id === "base" || id === "extra" ? { ...SOURCE, id } : undefined,
  );

  it("are layers the reducer takes, over every other, with keys the plan doesn't have", () => {
    let current = plan();
    const add = (create: (now: ImagePlan) => Parameters<typeof insertOnTop>[1]) => {
      const layer = create(current);
      current = reducer(current, insertOnTop(current, layer)).state;
      return layer;
    };
    const text = add((now) => newTextLayer(now, SOURCE));
    const rectangle = add((now) => newShapeLayer(now, SOURCE, "rectangle"));
    const ellipse = add((now) => newShapeLayer(now, SOURCE, "ellipse"));
    const image = add((now) =>
      newImageLayer(now, SOURCE, { id: "extra", width: 1_000, height: 250 }),
    );
    expect(current.layers.map((layer) => layer.key)).toEqual([
      text.key,
      rectangle.key,
      ellipse.key,
      image.key,
    ]);
    expect(new Set(current.layers.map((layer) => layer.key)).size).toBe(4);
    expect(current.layers.map((layer) => layer.key)).not.toContain(newLayerKey(current));
  });

  it("start text empty, centred, half the image wide and a fifth tall", () => {
    expect(newTextLayer(plan(), SOURCE)).toMatchObject({
      kind: "text",
      text: "",
      font: "sans-serif",
      bold: false,
      colour: "#000000",
      align: "center",
      name: "",
      visible: true,
      opacity: 100,
      x: 100,
      y: 80,
      width: 200,
      height: 40,
    });
  });

  it("start a shape as an outline with no fill, a quarter of the image each way", () => {
    expect(newShapeLayer(plan(), SOURCE, "ellipse")).toMatchObject({
      kind: "shape",
      shape: "ellipse",
      fill: null,
      stroke: { colour: "#e02020", width: 2 },
      x: 150,
      y: 75,
      width: 100,
      height: 50,
    });
    // A hundredth of the shorter side, on a large image.
    expect(defaultStrokeWidth(plan(), { width: 6_000, height: 4_000 })).toBe(40);
    // On a tiny image the outline still fits inside the shape.
    expect(newShapeLayer(plan(), { width: 8, height: 8 }, "rectangle")).toMatchObject({
      width: 2,
      height: 2,
      stroke: { width: 1 },
    });
  });

  it("fit an image in half of what's shown, and never enlarge it", () => {
    // 1000 × 250 into 200 × 100: a fifth.
    expect(newImageLayer(plan(), SOURCE, { id: "extra", width: 1_000, height: 250 })).toMatchObject(
      {
        kind: "image",
        source: "extra",
        crop: null,
        width: 200,
        height: 50,
        x: 100,
        y: 75,
      },
    );
    expect(newImageLayer(plan(), SOURCE, { id: "extra", width: 30, height: 20 })).toMatchObject({
      width: 30,
      height: 20,
    });
  });
});
