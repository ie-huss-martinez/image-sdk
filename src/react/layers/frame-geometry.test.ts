import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyMatrix,
  layerToOutput,
  layerToScene,
  sceneToOutput,
} from "../../core/model/layer-geometry.js";
import type { ImageLayerBox, ImageOrientation } from "../../core/model/plan.js";
import {
  edgeFacing,
  handleCursor,
  LAYER_HANDLES,
  type LayerHandle,
  moveLayerBox,
  resizeLayerBox,
  resizeLayerBoxOnScreen,
} from "./frame-geometry.js";

const SOURCE = { width: 200, height: 100 };
const CROP = { x: 0, y: 0, ...SOURCE };
const UPRIGHT: ImageOrientation = { rotate: 0, flipX: false, flipY: false };
const composition = (orientation: ImageOrientation) =>
  orientation.rotate % 180 === 0 ? SOURCE : { width: SOURCE.height, height: SOURCE.width };
const scene = (orientation: ImageOrientation) =>
  sceneToOutput(CROP, orientation, composition(orientation));
const seen = (box: ImageLayerBox, orientation: ImageOrientation) =>
  layerToOutput(box, CROP, orientation, composition(orientation));
const box = (rotation = 0, flipX = false): ImageLayerBox => ({
  x: 20,
  y: 10,
  width: 60,
  height: 30,
  rotation,
  flipX,
});

/** The corners of a box on screen, as the smallest rectangle around them. */
function bounds(layer: ImageLayerBox, orientation: ImageOrientation) {
  const matrix = seen(layer, orientation);
  const corners = [
    { x: 0, y: 0 },
    { x: layer.width, y: 0 },
    { x: 0, y: layer.height },
    { x: layer.width, y: layer.height },
  ].map((corner) => applyMatrix(matrix, corner));
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

const orientations = fc.record({
  rotate: fc.constantFrom(0 as const, 90 as const, 180 as const, 270 as const),
  flipX: fc.boolean(),
  flipY: fc.boolean(),
});
const boxes = fc.record({
  x: fc.integer({ min: -500, max: 500 }),
  y: fc.integer({ min: -500, max: 500 }),
  width: fc.integer({ min: 1, max: 400 }),
  height: fc.integer({ min: 1, max: 400 }),
  rotation: fc.integer({ min: 0, max: 3_599 }),
  flipX: fc.boolean(),
});
const handles = fc.constantFrom(...LAYER_HANDLES);

describe("moving a layer's box (ADR 0013)", () => {
  it("moves by whole scene pixels, as seen on screen, whatever the plan's turn and flips", () => {
    fc.assert(
      fc.property(
        boxes,
        orientations,
        fc.integer({ min: -50, max: 50 }),
        fc.integer({ min: -50, max: 50 }),
        (layer, orientation, dx, dy) => {
          const moved = moveLayerBox(layer, scene(orientation), dx, dy);
          expect(Number.isInteger(moved.x) && Number.isInteger(moved.y)).toBe(true);
          expect([moved.width, moved.height, moved.rotation]).toEqual([
            layer.width,
            layer.height,
            layer.rotation,
          ]);
          const before = bounds(layer, orientation);
          const after = bounds(moved, orientation);
          expect(after.left - before.left).toBeCloseTo(dx, 9);
          expect(after.top - before.top).toBeCloseTo(dy, 9);
        },
      ),
    );
  });

  it("stays within the scene's coordinates", () => {
    const far = moveLayerBox({ ...box(), x: 65_530 }, scene(UPRIGHT), 100, 0);
    expect(far.x).toBe(65_536);
  });
});

describe("resizing a layer's box (ADR 0013)", () => {
  it("keeps the opposite side of an upright box exactly, for every handle", () => {
    const start = box();
    const cases: [LayerHandle, ImageLayerBox][] = [
      ["e", { ...start, width: 65 }],
      ["w", { ...start, x: 25, width: 55 }],
      ["s", { ...start, height: 37 }],
      ["n", { ...start, y: 17, height: 23 }],
      ["se", { ...start, width: 65, height: 37 }],
      ["nw", { ...start, x: 25, y: 17, width: 55, height: 23 }],
      ["ne", { ...start, y: 17, width: 65, height: 23 }],
      ["sw", { ...start, x: 25, width: 55, height: 37 }],
    ];
    for (const [handle, expected] of cases) {
      expect(resizeLayerBox(start, handle, 5, 7), handle).toEqual(expected);
    }
  });

  it("never makes a box smaller than 1 × 1, and never a negative zero", () => {
    const tiny = resizeLayerBox({ ...box(), x: 0, y: 0 }, "se", -500, -500);
    expect(tiny).toEqual({ x: 0, y: 0, width: 1, height: 1, rotation: 0, flipX: false });
    expect(Object.is(tiny.x, -0) || Object.is(tiny.y, -0)).toBe(false);
    expect(resizeLayerBox(box(), "nw", 500, 500)).toEqual({
      x: 79,
      y: 39,
      width: 1,
      height: 1,
      rotation: 0,
      flipX: false,
    });
  });

  it("keeps what's opposite the handle within a pixel, for any turn, on the whole-pixel grid", () => {
    fc.assert(
      fc.property(
        boxes,
        handles,
        fc.integer({ min: -80, max: 80 }),
        fc.integer({ min: -80, max: 80 }),
        (layer, handle, dx, dy) => {
          const resized = resizeLayerBox(layer, handle, dx, dy);
          for (const value of [resized.x, resized.y, resized.width, resized.height]) {
            expect(Number.isInteger(value)).toBe(true);
          }
          expect(resized.width).toBeGreaterThanOrEqual(1);
          expect(resized.height).toBeGreaterThanOrEqual(1);
          expect(resized.rotation).toBe(layer.rotation);
          const west = handle.includes("w");
          const north = handle.includes("n");
          const before = applyMatrix(layerToScene(layer), {
            x: west ? layer.width : 0,
            y: north ? layer.height : 0,
          });
          const after = applyMatrix(layerToScene(resized), {
            x: west ? resized.width : 0,
            y: north ? resized.height : 0,
          });
          // Each of x and y is rounded by at most half a pixel.
          expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.5 + 1e-9);
          expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(0.5 + 1e-9);
        },
      ),
    );
  });

  it("changes only the sides its handle names", () => {
    fc.assert(
      fc.property(boxes, fc.integer({ min: -80, max: 80 }), (layer, by) => {
        expect(resizeLayerBox(layer, "e", by, 999).height).toBe(layer.height);
        expect(resizeLayerBox(layer, "n", 999, by).width).toBe(layer.width);
      }),
    );
  });
});

describe("the edge a key moves (ADR 0013)", () => {
  it("is the right and bottom edge of an upright box in an upright plan", () => {
    expect(edgeFacing(seen(box(), UPRIGHT), "right")).toBe("e");
    expect(edgeFacing(seen(box(), UPRIGHT), "down")).toBe("s");
  });

  it("follows the layer's turn and the plan's rotation and flips", () => {
    // A quarter turn clockwise: the box's own top faces right.
    expect(edgeFacing(seen(box(900), UPRIGHT), "right")).toBe("n");
    expect(edgeFacing(seen(box(900), UPRIGHT), "down")).toBe("e");
    // A mirrored plan: the box's own left faces right.
    const mirrored = { rotate: 0, flipX: true, flipY: false } as const;
    expect(edgeFacing(seen(box(), mirrored), "right")).toBe("w");
    expect(edgeFacing(seen(box(), mirrored), "down")).toBe("s");
    // The plan turned a quarter.
    const quarter = { rotate: 90, flipX: false, flipY: false } as const;
    expect(edgeFacing(seen(box(), quarter), "right")).toBe("n");
  });

  it("takes one edge, the same each time, for a box turned an eighth", () => {
    expect(edgeFacing(seen(box(450), UPRIGHT), "right")).toBe("e");
    expect(edgeFacing(seen(box(450), UPRIGHT), "down")).toBe("e");
  });

  it("grows and shrinks what's seen on that side by a pixel, whatever the plan's turn and flips", () => {
    fc.assert(
      fc.property(
        boxes.map((layer) => ({
          ...layer,
          rotation: 0,
          flipX: false,
          width: layer.width + 1,
          height: layer.height + 1,
        })),
        orientations,
        fc.constantFrom("right" as const, "down" as const),
        fc.constantFrom(1, -1),
        (layer, orientation, direction, by) => {
          const before = bounds(layer, orientation);
          const after = bounds(
            resizeLayerBoxOnScreen(layer, seen(layer, orientation), direction, by),
            orientation,
          );
          // Only that side moves, by exactly one pixel.
          expect(after.left).toBeCloseTo(before.left, 9);
          expect(after.top).toBeCloseTo(before.top, 9);
          expect(after.right - before.right).toBeCloseTo(direction === "right" ? by : 0, 9);
          expect(after.bottom - before.bottom).toBeCloseTo(direction === "down" ? by : 0, 9);
        },
      ),
    );
  });
});

describe("a handle's cursor (ADR 0013)", () => {
  it("points along the handle's direction as it's seen", () => {
    const upright = seen(box(), UPRIGHT);
    expect(LAYER_HANDLES.map((handle) => handleCursor(upright, handle))).toEqual([
      "nwse-resize",
      "ns-resize",
      "nesw-resize",
      "ew-resize",
      "nwse-resize",
      "ns-resize",
      "nesw-resize",
      "ew-resize",
    ]);
    // Turned a quarter, the box's own east handle moves up and down.
    expect(handleCursor(seen(box(900), UPRIGHT), "e")).toBe("ns-resize");
    // Turned an eighth, it moves along a diagonal.
    expect(handleCursor(seen(box(450), UPRIGHT), "e")).toBe("nwse-resize");
    // Mirrored, a corner's diagonal is the other one.
    expect(handleCursor(seen(box(), { rotate: 0, flipX: true, flipY: false }), "nw")).toBe(
      "nesw-resize",
    );
  });
});
