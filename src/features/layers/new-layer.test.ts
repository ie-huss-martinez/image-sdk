import { describe, expect, it } from "vitest";
import { compositionSize, sourceToComposition } from "../../core/model/geometry.js";
import { createPlan, type ImagePlan } from "../../core/model/plan.js";
import { createImageReducer } from "../../core/operations/commands.js";
import {
  defaultStrokeWidth,
  insertOnTop,
  newArrowLayer,
  newLayerKey,
  newShapeLayer,
  newTextLayer,
} from "./new-layer.js";

const SOURCE = { id: "base", width: 400, height: 200 };
const plan = (changes: Partial<ImagePlan["base"]> = {}): ImagePlan => {
  const created = createPlan("base");
  return { ...created, base: { ...created.base, ...changes } };
};

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
    expect(current.layers.map((layer) => layer.key)).toEqual([
      text.key,
      rectangle.key,
      ellipse.key,
    ]);
    expect(new Set(current.layers.map((layer) => layer.key)).size).toBe(3);
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

  it("are set against a mirrored image, so text added to it reads as text", () => {
    const mirrored = plan({ orientation: { rotate: 0, flipX: true, flipY: false } });
    expect(newTextLayer(mirrored, SOURCE).flipX).toBe(true);
    expect(newTextLayer(plan(), SOURCE).flipX).toBe(false);
    expect(newShapeLayer(mirrored, SOURCE, "ellipse").flipX).toBe(true);
  });

  it("aim a new arrow to the right on screen, whatever the plan's turn and flips, with two ends", () => {
    for (const rotate of [0, 90, 180, 270] as const) {
      for (const flipX of [false, true]) {
        for (const flipY of [false, true]) {
          const turned = plan({ orientation: { rotate, flipX, flipY } });
          const arrow = newArrowLayer(turned, SOURCE);
          const composition = compositionSize(turned, SOURCE);
          const seen = (point: { x: number; y: number }) =>
            sourceToComposition(point, { x: 0, y: 0, ...SOURCE }, turned.base.orientation);
          const from = seen(arrow.from);
          const to = seen(arrow.to);
          const what = JSON.stringify(turned.base.orientation);
          // Level, pointing right, across the middle quarter.
          expect(to.y, what).toBeCloseTo(from.y, 9);
          expect(to.x - from.x, what).toBeCloseTo(composition.width / 4, 0);
          expect(Math.abs((from.x + to.x) / 2 - composition.width / 2), what).toBeLessThanOrEqual(
            1,
          );
          expect(Math.abs(from.y - composition.height / 2), what).toBeLessThanOrEqual(1);
        }
      }
    }
    // On an image one pixel wide the ends still differ.
    const tiny = newArrowLayer(plan(), { width: 1, height: 1 });
    expect([tiny.from.x, tiny.from.y]).not.toEqual([tiny.to.x, tiny.to.y]);
  });
});
