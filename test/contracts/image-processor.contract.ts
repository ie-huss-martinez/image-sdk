import { describe, expect, it } from "vitest";
import {
  createPlan,
  type ExifOrientation,
  type ImageEngine,
  type ImagePlan,
  type ImageProcessor,
  isImageError,
} from "../../src/index.js";
import { aborted, type InspectedExport, rejection, type TestImageSpec } from "./harness-types.js";

/**
 * What a processor's contract test needs: an engine and a processor that
 * share sources, files, and a way to read exports back.
 */
export interface ImageProcessorHarness {
  create(): { engine: ImageEngine; processor: ImageProcessor };
  file(spec: TestImageSpec): Promise<Blob>;
  /** The RGBA of the stored pixel at (x, y) in every file `file` makes. */
  storedColour(x: number, y: number): readonly number[];
  inspect(output: Blob): Promise<InspectedExport>;
}

const ORIENTATIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/** The reference for EXIF orientations, written independently of the SDK's geometry. */
function storedFor(orientation: ExifOrientation, x: number, y: number, w: number, h: number) {
  return [
    [x, y],
    [w - 1 - x, y],
    [w - 1 - x, h - 1 - y],
    [x, h - 1 - y],
    [y, x],
    [y, h - 1 - x],
    [w - 1 - y, h - 1 - x],
    [w - 1 - y, x],
  ][orientation - 1] as [number, number];
}

async function open(harness: ImageProcessorHarness, spec: TestImageSpec) {
  const { engine, processor } = harness.create();
  const file = await harness.file(spec);
  await engine.register("s", file, await engine.probe(file));
  return { engine, processor, plan: createPlan("s") };
}

/**
 * The behaviour every {@link ImageProcessor} must have (ADR 0001, ADR 0003,
 * ADR 0005, ADR 0008). Adapters run it with their own harness, exporting
 * PNG so pixels compare exactly.
 */
export function describeImageProcessorContract(name: string, harness: ImageProcessorHarness): void {
  describe(`${name}: the ImageProcessor contract`, () => {
    it.each(ORIENTATIONS)(
      "crops in upright pixels of a source with EXIF orientation %i",
      async (orientation) => {
        // A 5 × 4 stored image, cropped away from every edge, so a crop
        // applied before orientation or with the wrong axes shows.
        const { engine, processor, plan } = await open(harness, {
          width: 5,
          height: 4,
          orientation,
        });
        const crop = { x: 1, y: 1, width: 2, height: 2 };
        const output = await harness.inspect(
          await processor.export({
            plan: { ...plan, base: { ...plan.base, crop } },
            format: { type: "png" },
          }),
        );
        expect([output.width, output.height]).toEqual([2, 2]);
        for (let y = 0; y < 2; y += 1) {
          for (let x = 0; x < 2; x += 1) {
            const [sx, sy] = storedFor(orientation, crop.x + x, crop.y + y, 5, 4);
            expect(output.pixel(x, y), `${x},${y}`).toEqual(harness.storedColour(sx, sy));
          }
        }
        await processor.destroy();
        await engine.destroy();
      },
    );

    it.each([
      [0, false, false],
      [90, false, false],
      [180, false, false],
      [270, false, false],
      [0, true, false],
      [90, false, true],
    ] as const)(
      "applies rotate %i, flipX %s, flipY %s after the crop",
      async (rotate, flipX, flipY) => {
        const { engine, processor, plan } = await open(harness, { width: 4, height: 3 });
        const crop = { x: 1, y: 0, width: 3, height: 2 };
        const edited: ImagePlan = {
          ...plan,
          base: { ...plan.base, crop, orientation: { rotate, flipX, flipY } },
        };
        const output = await harness.inspect(
          await processor.export({ plan: edited, format: { type: "png" } }),
        );
        const turned = rotate % 180 !== 0;
        expect([output.width, output.height]).toEqual(turned ? [2, 3] : [3, 2]);
        for (let y = 0; y < output.height; y += 1) {
          for (let x = 0; x < output.width; x += 1) {
            // Undo the flips, then the clockwise rotation, by hand.
            const fx = flipX ? output.width - 1 - x : x;
            const fy = flipY ? output.height - 1 - y : y;
            const [cx, cy] =
              rotate === 90
                ? [fy, 1 - fx]
                : rotate === 180
                  ? [2 - fx, 1 - fy]
                  : rotate === 270
                    ? [2 - fy, fx]
                    : [fx, fy];
            expect(output.pixel(x, y), `${x},${y}`).toEqual(
              harness.storedColour(crop.x + cx, crop.y + cy),
            );
          }
        }
        await processor.destroy();
        await engine.destroy();
      },
    );

    it("scales to the output size, never enlarging", async () => {
      const { engine, processor, plan } = await open(harness, { width: 8, height: 4 });
      const half = await harness.inspect(
        await processor.export({
          plan: { ...plan, output: { kind: "scale", scale: 0.5 } },
          format: { type: "png" },
        }),
      );
      expect([half.width, half.height]).toEqual([4, 2]);
      const fitted = await harness.inspect(
        await processor.export({
          plan: { ...plan, output: { kind: "fit", width: 100, height: 2 } },
          format: { type: "png" },
        }),
      );
      expect([fitted.width, fitted.height]).toEqual([4, 2]);
      await processor.destroy();
      await engine.destroy();
    });

    it("writes only the kept metadata, and never a location", async () => {
      const { engine, processor, plan } = await open(harness, {
        width: 2,
        height: 2,
        metadata: { location: true, camera: true, timestamps: true, thumbnail: true },
        keepable: { title: "From the file", artist: "From the file" },
      });
      const plain = await harness.inspect(
        await processor.export({ plan, format: { type: "png" } }),
      );
      expect(plain.metadata).toEqual({});
      expect(plain.hasLocation).toBe(false);

      const kept = await harness.inspect(
        await processor.export({
          plan: {
            ...plan,
            metadata: { ...plan.metadata, title: "Harbour, à l'aube", copyright: "© 2026" },
          },
          format: { type: "png" },
        }),
      );
      expect(kept.metadata).toEqual({ title: "Harbour, à l'aube", copyright: "© 2026" });
      expect(kept.hasLocation).toBe(false);
      await processor.destroy();
      await engine.destroy();
    });

    it("reports progress that ends at 1", async () => {
      const { engine, processor, plan } = await open(harness, { width: 2, height: 2 });
      const progress: number[] = [];
      await processor.export(
        { plan, format: { type: "png" } },
        { onProgress: (f) => progress.push(f) },
      );
      expect(progress.at(-1)).toBe(1);
      expect(progress).toEqual([...progress].sort((a, b) => a - b));
      await processor.destroy();
      await engine.destroy();
    });

    it("rejects an unregistered source with TypeError, and ABORTED when cancelled", async () => {
      const { engine, processor, plan } = await open(harness, { width: 2, height: 2 });
      await expect(
        processor.export({ plan: createPlan("missing"), format: { type: "png" } }),
      ).rejects.toThrow(TypeError);
      const error = await rejection(
        processor.export({ plan, format: { type: "png" } }, { signal: aborted() }),
      );
      expect(isImageError(error, "ABORTED")).toBe(true);
      await processor.destroy();
      await expect(processor.export({ plan, format: { type: "png" } })).rejects.toThrow();
      await engine.destroy();
    });
  });
}
