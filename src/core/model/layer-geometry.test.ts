import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { sourceToComposition } from "./geometry.js";
import {
  applyMatrix,
  fitTextLines,
  invertMatrix,
  isRightToLeft,
  layerToOutput,
  layerToScene,
  sceneToLayerSource,
  sceneToOutput,
} from "./layer-geometry.js";
import type { ImageOrientation } from "./plan.js";

const box = fc.record({
  x: fc.integer({ min: -50, max: 200 }),
  y: fc.integer({ min: -50, max: 200 }),
  width: fc.integer({ min: 1, max: 300 }),
  height: fc.integer({ min: 1, max: 300 }),
  rotation: fc.integer({ min: 0, max: 3_599 }),
  flipX: fc.boolean(),
});
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
const point = fc.record({
  x: fc.integer({ min: -100, max: 300 }),
  y: fc.integer({ min: -100, max: 300 }),
});
const close = (a: { x: number; y: number }, b: { x: number; y: number }, by = 1e-9) =>
  Math.abs(a.x - b.x) <= by && Math.abs(a.y - b.y) <= by;

describe("layer geometry (ADR 0009)", () => {
  it("puts an unturned box's own pixels at its place in the scene, exactly", () => {
    const placed = { x: 12, y: -7, width: 40, height: 20, rotation: 0, flipX: false };
    expect(layerToScene(placed)).toEqual([1, 0, 0, 1, 12, -7]);
    expect(applyMatrix(layerToScene(placed), { x: 40, y: 20 })).toEqual({ x: 52, y: 13 });
  });

  it("mirrors a box left to right about its own centre, before it's turned, exactly", () => {
    const placed = { x: 12, y: -7, width: 40, height: 20, rotation: 0, flipX: true };
    // The box's own left edge is at the scene's right edge of it.
    expect(layerToScene(placed)).toEqual([-1, 0, 0, 1, 52, -7]);
    expect(applyMatrix(layerToScene(placed), { x: 0, y: 0 })).toEqual({ x: 52, y: -7 });
    expect(applyMatrix(layerToScene(placed), { x: 40, y: 20 })).toEqual({ x: 12, y: 13 });
    // Then a quarter turn clockwise: its own left edge is at the bottom.
    const turned = { x: 10, y: 20, width: 40, height: 20, rotation: 900, flipX: true };
    expect(layerToScene(turned)).toEqual([0, -1, -1, 0, 40, 50]);
    expect(applyMatrix(layerToScene(turned), { x: 20, y: 10 })).toEqual({ x: 30, y: 30 });
    // With a half turn, it's a mirror top to bottom.
    expect(layerToScene({ ...placed, rotation: 1_800 })).toEqual([1, 0, 0, -1, 12, 13]);
    // Never a negative zero, which JSON can't carry.
    for (const rotation of [0, 900, 1_800, 2_700]) {
      for (const flipX of [false, true]) {
        for (const entry of layerToScene({ ...placed, rotation, flipX })) {
          expect(Object.is(entry, -0)).toBe(false);
        }
      }
    }
    fc.assert(
      fc.property(box, (any) => {
        // The centre stays where it is, mirrored or not, and the mirror reverses the box's sense.
        const centre = applyMatrix(layerToScene(any), { x: any.width / 2, y: any.height / 2 });
        expect(centre.x).toBeCloseTo(any.x + any.width / 2, 6);
        expect(centre.y).toBeCloseTo(any.y + any.height / 2, 6);
        const [a, b, c, d] = layerToScene(any);
        expect(a * d - b * c).toBeCloseTo(any.flipX ? -1 : 1, 9);
      }),
    );
  });

  it("turns a box about its centre, clockwise, with exact quarter turns", () => {
    const placed = { x: 10, y: 20, width: 40, height: 20, rotation: 900, flipX: false };
    // The centre stays at 30, 30; the top-left corner goes to the top right.
    expect(applyMatrix(layerToScene(placed), { x: 20, y: 10 })).toEqual({ x: 30, y: 30 });
    expect(applyMatrix(layerToScene(placed), { x: 0, y: 0 })).toEqual({ x: 40, y: 10 });
    expect(layerToScene(placed)).toEqual([0, 1, -1, 0, 40, 10]);
    expect(layerToScene({ ...placed, rotation: 1_800 })).toEqual([-1, 0, 0, -1, 50, 40]);
    fc.assert(
      fc.property(box, (placed) => {
        const centre = { x: placed.width / 2, y: placed.height / 2 };
        expect(
          close(applyMatrix(layerToScene(placed), centre), {
            x: placed.x + centre.x,
            y: placed.y + centre.y,
          }),
        ).toBe(true);
        // A rotation keeps lengths: the box's width is still its width.
        const [a, b] = layerToScene(placed);
        expect(Math.abs(Math.hypot(a, b) - 1)).toBeLessThan(1e-12);
      }),
    );
  });

  it("maps the scene to the output as the composition's geometry does, scaled", () => {
    fc.assert(
      fc.property(
        crop,
        orientation,
        point,
        fc.integer({ min: 1, max: 4 }),
        (within, turn, at, factor) => {
          const turned = turn.rotate % 180 !== 0;
          const output = {
            width: (turned ? within.height : within.width) * factor,
            height: (turned ? within.width : within.height) * factor,
          };
          const expected = sourceToComposition(at, within, turn);
          expect(
            close(applyMatrix(sceneToOutput(within, turn, output), at), {
              x: expected.x * factor,
              y: expected.y * factor,
            }),
          ).toBe(true);
        },
      ),
    );
    // At the composition's own size, upright and uncropped, it's the identity.
    const whole = { x: 0, y: 0, width: 60, height: 40 };
    const upright = { rotate: 0, flipX: false, flipY: false } as const;
    expect(sceneToOutput(whole, upright, { width: 60, height: 40 })).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("composes a layer's box to the output, and inverts", () => {
    fc.assert(
      fc.property(box, crop, orientation, point, (placed, within, turn, at) => {
        const turned = turn.rotate % 180 !== 0;
        const output = {
          width: turned ? within.height : within.width,
          height: turned ? within.width : within.height,
        };
        const through = applyMatrix(
          sceneToOutput(within, turn, output),
          applyMatrix(layerToScene(placed), at),
        );
        const composed = layerToOutput(placed, within, turn, output);
        expect(close(applyMatrix(composed, at), through, 1e-6)).toBe(true);
        expect(
          close(applyMatrix(invertMatrix(composed), applyMatrix(composed, at)), at, 1e-6),
        ).toBe(true);
      }),
    );
  });

  it("maps the corners of a layer's box in the scene to the corners of its crop in its source", () => {
    fc.assert(
      fc.property(box, crop, (placed, part) => {
        const toSource = sceneToLayerSource(placed, part);
        const toScene = layerToScene(placed);
        for (const [u, v] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ] as const) {
          const inScene = applyMatrix(toScene, { x: u * placed.width, y: v * placed.height });
          expect(
            close(
              applyMatrix(toSource, inScene),
              { x: part.x + u * part.width, y: part.y + v * part.height },
              1e-6,
            ),
          ).toBe(true);
        }
      }),
    );
  });

  it("fits lines of text as large as the box allows, and no larger", () => {
    const lines = fc.array(
      fc.integer({ min: 0, max: 900 }).map((width) => ({ width })),
      {
        minLength: 1,
        maxLength: 6,
      },
    );
    const size = fc.record({
      width: fc.integer({ min: 1, max: 500 }),
      height: fc.integer({ min: 1, max: 500 }),
    });
    fc.assert(
      fc.property(
        lines,
        size,
        fc.constantFrom("start" as const, "center" as const, "end" as const),
        fc.boolean(),
        (measured, within, align, rightToLeft) => {
          const layout = fitTextLines(measured, 120, 90, within, align, rightToLeft);
          const widest = Math.max(...measured.map((line) => line.width));
          if (widest === 0) {
            expect(layout).toBeNull();
            return;
          }
          if (!layout) throw new Error("no layout");
          const blockWidth = widest * layout.scale;
          const blockHeight = 120 * measured.length * layout.scale;
          // Inside the box, and touching it one way.
          expect(blockWidth).toBeLessThanOrEqual(within.width + 1e-9);
          expect(blockHeight).toBeLessThanOrEqual(within.height + 1e-9);
          expect(
            Math.abs(blockWidth - within.width) < 1e-9 ||
              Math.abs(blockHeight - within.height) < 1e-9,
          ).toBe(true);
          measured.forEach((line, index) => {
            const placed = layout.lines[index];
            if (!placed) throw new Error("no line");
            expect(placed.x).toBeGreaterThanOrEqual(-1e-9);
            expect(placed.x + line.width * layout.scale).toBeLessThanOrEqual(within.width + 1e-9);
            // Each baseline is one line below the last.
            const first = layout.lines[0]?.baseline ?? 0;
            expect(Math.abs(placed.baseline - first - index * 120 * layout.scale)).toBeLessThan(
              1e-9,
            );
          });
        },
      ),
    );
  });

  it("aligns lines to the start, the centre and the end, by the text's direction", () => {
    // One line half as wide as the box at its fitted size: room across.
    const measured = [{ width: 100 }];
    const within = { width: 400, height: 100 };
    const x = (align: "start" | "center" | "end", rightToLeft: boolean) =>
      fitTextLines(measured, 100, 80, within, align, rightToLeft)?.lines[0]?.x;
    expect(x("start", false)).toBe(0);
    expect(x("center", false)).toBe(150);
    expect(x("end", false)).toBe(300);
    expect(x("start", true)).toBe(300);
    expect(x("center", true)).toBe(150);
    expect(x("end", true)).toBe(0);
    // The block is centred down the box, with the baseline an ascent below a line's top.
    const tall = fitTextLines(
      [{ width: 100 }],
      50,
      40,
      { width: 100, height: 200 },
      "start",
      false,
    );
    expect(tall).toEqual({ scale: 1, lines: [{ x: 0, baseline: 115 }] });
  });

  it("reads a text's direction from its first letter that has one", () => {
    expect(isRightToLeft("Hello")).toBe(false);
    expect(isRightToLeft("שלום")).toBe(true);
    expect(isRightToLeft("مرحبا")).toBe(true);
    // Digits, spaces, punctuation and emoji have no direction of their own.
    expect(isRightToLeft("123 … 📷 שלום abc")).toBe(true);
    expect(isRightToLeft("123 … 📷 abc שלום")).toBe(false);
    expect(isRightToLeft("中文")).toBe(false);
    expect(isRightToLeft("42 📷")).toBe(false);
    expect(isRightToLeft("")).toBe(false);
  });
});
