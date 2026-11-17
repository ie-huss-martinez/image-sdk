import { describe, expect, it } from "vitest";
import { developPixels } from "../../src/adapters/export/develop.js";
import {
  compositionToSource,
  createPlan,
  type ExifOrientation,
  type ImageEngine,
  type ImageError,
  type ImagePlan,
  type ImageProcessor,
  imageLimits,
  isImageError,
  NEUTRAL_DEVELOP,
  redactionBlocksInScene,
  redactionRectInOutput,
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

    it.each([
      [{ exposure: 40, contrast: 25 }, null],
      [
        { temperature: -30, saturation: 60 },
        { preset: "sepia", strength: 70 },
      ],
      [{}, { preset: "fade", strength: 100 }],
    ] as const)(
      "develops %o with filter %o exactly as the reference math does (ADR 0006)",
      async (develop, filter) => {
        const { engine, processor, plan } = await open(harness, { width: 5, height: 4 });
        const output = await harness.inspect(
          await processor.export({
            plan: {
              ...plan,
              base: { ...plan.base, develop: { ...NEUTRAL_DEVELOP, ...develop }, filter },
            },
            format: { type: "png" },
          }),
        );
        for (let y = 0; y < 4; y += 1) {
          for (let x = 0; x < 5; x += 1) {
            const expected = Uint8ClampedArray.from(harness.storedColour(x, y));
            developPixels(expected, { ...NEUTRAL_DEVELOP, ...develop }, filter);
            // Opaque pixels round-trip exactly, so the result is exact.
            expect(output.pixel(x, y), `${x},${y}`).toEqual(Array.from(expected));
          }
        }
        await processor.destroy();
        await engine.destroy();
      },
    );

    it("refuses an output over the file policy before drawing it", async () => {
      const { engine, processor, plan } = await open(harness, { width: 8, height: 4 });
      const error = await rejection(
        processor.export(
          { plan, format: { type: "png" } },
          { filePolicy: imageLimits.resolve({ maxImagePixels: 31 }) },
        ),
      );
      expect(isImageError(error, "IMAGE_TOO_LARGE")).toBe(true);
      const wide = await rejection(
        processor.export(
          { plan, format: { type: "png" } },
          { filePolicy: imageLimits.resolve({ maxImageDimension: 7 }) },
        ),
      );
      expect(isImageError(wide, "IMAGE_DIMENSION_TOO_LARGE")).toBe(true);
      // Scaled down within the limits, it exports.
      await processor.export(
        { plan: { ...plan, output: { kind: "scale", scale: 0.5 } }, format: { type: "png" } },
        { filePolicy: imageLimits.resolve({ maxImagePixels: 31, maxImageDimension: 7 }) },
      );
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

    it("refuses a plan with a part it can't draw, and exports nothing without it", async () => {
      const { engine, processor, plan } = await open(harness, { width: 4, height: 4 });
      // An export that left a part out would show what the plan doesn't (ADR 0009).
      const animated = { ...plan, animation: { loop: 0, frames: [] } } as unknown as ImagePlan;
      for (const [unsupported, part] of [[animated, "animation"]] as const) {
        const error = await rejection(
          processor.export({ plan: unsupported, format: { type: "png" } }),
        );
        expect(isImageError(error, "UNSUPPORTED_PLAN"), part).toBe(true);
        expect((error as ImageError).details).toEqual({ reason: part });
      }
      await processor.destroy();
      await engine.destroy();
    });

    describe("layers (ADR 0009)", () => {
      const box = (x: number, y: number, width: number, height: number) => ({
        name: "",
        visible: true,
        opacity: 100,
        x,
        y,
        width,
        height,
        rotation: 0,
        flipX: false,
      });
      const rectangle = (key: string, fill: string, ...at: [number, number, number, number]) =>
        ({ ...box(...at), key, kind: "shape", shape: "rectangle", fill, stroke: null }) as const;

      it("draws a rectangle on exactly its box's pixels, over the base", async () => {
        const { engine, processor, plan } = await open(harness, { width: 12, height: 8 });
        const layered: ImagePlan = {
          ...plan,
          layers: [rectangle("r", "#10a0f0", 3, 2, 4, 3)],
        };
        const output = await harness.inspect(
          await processor.export({ plan: layered, format: { type: "png" } }),
        );
        for (let y = 0; y < 8; y += 1) {
          for (let x = 0; x < 12; x += 1) {
            const inside = x >= 3 && x < 7 && y >= 2 && y < 5;
            expect(output.pixel(x, y), `${x},${y}`).toEqual(
              inside ? [0x10, 0xa0, 0xf0, 255] : harness.storedColour(x, y),
            );
          }
        }
        await processor.destroy();
        await engine.destroy();
      });

      it("draws layers bottom to top, leaves out a hidden one, and redactions over them all", async () => {
        const { engine, processor, plan } = await open(harness, { width: 10, height: 8 });
        const layered: ImagePlan = {
          ...plan,
          layers: [
            rectangle("under", "#ff0000", 1, 1, 5, 5),
            rectangle("over", "#0000ff", 3, 3, 5, 4),
            { ...rectangle("hidden", "#00ff00", 0, 0, 10, 8), visible: false },
          ],
          redactions: [
            { key: "r", mode: "solid", x: 4, y: 4, width: 2, height: 2, colour: "#000000" },
          ],
        };
        const output = await harness.inspect(
          await processor.export({ plan: layered, format: { type: "png" } }),
        );
        expect(output.pixel(1, 1)).toEqual([255, 0, 0, 255]);
        expect(output.pixel(3, 3)).toEqual([0, 0, 255, 255]);
        expect(output.pixel(7, 6)).toEqual([0, 0, 255, 255]);
        expect(output.pixel(4, 4)).toEqual([0, 0, 0, 255]);
        expect(output.pixel(5, 5)).toEqual([0, 0, 0, 255]);
        expect(output.pixel(0, 0)).toEqual(harness.storedColour(0, 0));
        expect(output.pixel(9, 7)).toEqual(harness.storedColour(9, 7));
        await processor.destroy();
        await engine.destroy();
      });

      it("keeps a layer on the pixels it was placed on through every crop, turn and flip", async () => {
        const { engine, processor, plan } = await open(harness, { width: 10, height: 8 });
        const at = { x: 4, y: 3, width: 3, height: 2 };
        const crop = { x: 2, y: 1, width: 7, height: 6 };
        for (const rotate of [0, 90, 180, 270] as const) {
          for (const flipX of [false, true]) {
            const edited: ImagePlan = {
              ...plan,
              base: { ...plan.base, crop, orientation: { rotate, flipX, flipY: false } },
              layers: [rectangle("r", "#ff00ff", at.x, at.y, at.width, at.height)],
            };
            const output = await harness.inspect(
              await processor.export({ plan: edited, format: { type: "png" } }),
            );
            for (let y = 0; y < output.height; y += 1) {
              for (let x = 0; x < output.width; x += 1) {
                const point = compositionToSource(
                  { x: x + 0.5, y: y + 0.5 },
                  crop,
                  edited.base.orientation,
                );
                const sx = Math.floor(point.x);
                const sy = Math.floor(point.y);
                const inside =
                  sx >= at.x && sx < at.x + at.width && sy >= at.y && sy < at.y + at.height;
                expect(output.pixel(x, y), `${rotate} ${flipX} ${x},${y}`).toEqual(
                  inside ? [255, 0, 255, 255] : harness.storedColour(sx, sy),
                );
              }
            }
          }
        }
        await processor.destroy();
        await engine.destroy();
      });

      it("draws an image layer from its own source, pixel for pixel at its own size", async () => {
        const { engine, processor, plan } = await open(harness, { width: 12, height: 8 });
        // A second source, of which the layer draws a 3 × 2 part at its own size.
        const file = await harness.file({ width: 6, height: 5 });
        await engine.register("t", file, await engine.probe(file));
        const layered: ImagePlan = {
          ...plan,
          layers: [
            {
              ...box(5, 3, 3, 2),
              key: "i",
              kind: "image",
              source: "t",
              crop: { x: 2, y: 1, width: 3, height: 2 },
            },
          ],
        };
        const output = await harness.inspect(
          await processor.export({ plan: layered, format: { type: "png" } }),
        );
        for (let y = 0; y < 8; y += 1) {
          for (let x = 0; x < 12; x += 1) {
            const inside = x >= 5 && x < 8 && y >= 3 && y < 5;
            // Every file the harness makes has the same pixels, by position.
            expect(output.pixel(x, y), `${x},${y}`).toEqual(
              inside ? harness.storedColour(x - 5 + 2, y - 3 + 1) : harness.storedColour(x, y),
            );
          }
        }
        // A layer of a source that isn't registered is an error, never a blank.
        await expect(
          processor.export({
            plan: { ...layered, layers: [{ ...layered.layers[0], source: "missing" } as never] },
            format: { type: "png" },
          }),
        ).rejects.toThrow(TypeError);
        await processor.destroy();
        await engine.destroy();
      });
    });

    describe("redactions (ADR 0010)", () => {
      const BLACK = [0, 0, 0, 255];
      const solid = (x: number, y: number, width: number, height: number, colour = "#000000") =>
        ({ key: `s${x}-${y}`, mode: "solid", x, y, width, height, colour }) as const;

      it("fills a solid region with exactly its colour, and leaves every other pixel as it was", async () => {
        const { engine, processor, plan } = await open(harness, { width: 12, height: 8 });
        const redacted: ImagePlan = { ...plan, redactions: [solid(3, 2, 4, 3, "#10a0f0")] };
        const output = await harness.inspect(
          await processor.export({ plan: redacted, format: { type: "png" } }),
        );
        for (let y = 0; y < 8; y += 1) {
          for (let x = 0; x < 12; x += 1) {
            const inside = x >= 3 && x < 7 && y >= 2 && y < 5;
            expect(output.pixel(x, y), `${x},${y}`).toEqual(
              inside ? [0x10, 0xa0, 0xf0, 255] : harness.storedColour(x, y),
            );
          }
        }
        await processor.destroy();
        await engine.destroy();
      });

      it("keeps a redaction on the pixels it covers through every crop, turn and flip", async () => {
        const { engine, processor, plan } = await open(harness, { width: 10, height: 8 });
        const region = { x: 4, y: 3, width: 3, height: 2 };
        const crop = { x: 2, y: 1, width: 7, height: 6 };
        for (const rotate of [0, 90, 180, 270] as const) {
          for (const flipX of [false, true]) {
            const edited: ImagePlan = {
              ...plan,
              base: { ...plan.base, crop, orientation: { rotate, flipX, flipY: false } },
              redactions: [solid(region.x, region.y, region.width, region.height)],
            };
            const output = await harness.inspect(
              await processor.export({ plan: edited, format: { type: "png" } }),
            );
            // Every output pixel shows the source pixel the geometry says, or
            // black where that pixel is redacted.
            for (let y = 0; y < output.height; y += 1) {
              for (let x = 0; x < output.width; x += 1) {
                const at = compositionToSource(
                  { x: x + 0.5, y: y + 0.5 },
                  crop,
                  edited.base.orientation,
                );
                const sx = Math.floor(at.x);
                const sy = Math.floor(at.y);
                const inside =
                  sx >= region.x &&
                  sx < region.x + region.width &&
                  sy >= region.y &&
                  sy < region.y + region.height;
                expect(output.pixel(x, y), `${rotate} ${flipX} ${x},${y}`).toEqual(
                  inside ? BLACK : harness.storedColour(sx, sy),
                );
              }
            }
          }
        }
        await processor.destroy();
        await engine.destroy();
      });

      it("pixelates a region into blocks of one colour, the average of what they cover", async () => {
        const { engine, processor, plan } = await open(harness, { width: 15, height: 15 });
        const region = { x: 2, y: 1, width: 12, height: 12 };
        const redacted: ImagePlan = {
          ...plan,
          redactions: [{ key: "p", mode: "pixelate", ...region }],
        };
        const output = await harness.inspect(
          await processor.export({ plan: redacted, format: { type: "png" } }),
        );
        const blocks = redactionBlocksInScene(region, { x: 0, y: 0, width: 15, height: 15 });
        expect(blocks).toHaveLength(4);
        for (const block of blocks) {
          const sums = [0, 0, 0];
          for (let y = block.y; y < block.y + block.height; y += 1) {
            for (let x = block.x; x < block.x + block.width; x += 1) {
              harness
                .storedColour(x, y)
                .slice(0, 3)
                .forEach((value, channel) => {
                  sums[channel] = (sums[channel] as number) + value;
                });
            }
          }
          const mean = [...sums.map((sum) => Math.round(sum / (block.width * block.height))), 255];
          for (let y = block.y; y < block.y + block.height; y += 1) {
            for (let x = block.x; x < block.x + block.width; x += 1) {
              expect(output.pixel(x, y), `${x},${y}`).toEqual(mean);
            }
          }
        }
        expect(output.pixel(1, 1)).toEqual(harness.storedColour(1, 1));
        expect(output.pixel(14, 13)).toEqual(harness.storedColour(14, 13));
        await processor.destroy();
        await engine.destroy();
      });

      it("covers every output pixel a region touches when the export is scaled down", async () => {
        const { engine, processor, plan } = await open(harness, { width: 30, height: 20 });
        const region = { x: 7, y: 5, width: 9, height: 7 };
        const redacted: ImagePlan = {
          ...plan,
          output: { kind: "scale", scale: 0.4 },
          redactions: [solid(region.x, region.y, region.width, region.height, "#ff00ff")],
        };
        const output = await harness.inspect(
          await processor.export({ plan: redacted, format: { type: "png" } }),
        );
        const rect = redactionRectInOutput(
          region,
          { x: 0, y: 0, width: 30, height: 20 },
          plan.base.orientation,
          output,
        );
        // 7 to 16 at 0.4 is 2.8 to 6.4: pixels 2 to 6. 5 to 12 is 2 to 4.8: pixels 2 to 4.
        expect(rect).toEqual({ x: 2, y: 2, width: 5, height: 3 });
        for (let y = 2; y < 5; y += 1) {
          for (let x = 2; x < 7; x += 1) {
            expect(output.pixel(x, y), `${x},${y}`).toEqual([255, 0, 255, 255]);
          }
        }
        await processor.destroy();
        await engine.destroy();
      });

      it("applies redactions in order, and leaves out one that covers nothing", async () => {
        const { engine, processor, plan } = await open(harness, { width: 8, height: 8 });
        const redacted: ImagePlan = {
          ...plan,
          redactions: [
            solid(1, 1, 4, 4, "#ff0000"),
            solid(3, 3, 4, 4, "#0000ff"),
            solid(-20, -20, 5, 5, "#00ff00"),
          ],
        };
        const output = await harness.inspect(
          await processor.export({ plan: redacted, format: { type: "png" } }),
        );
        expect(output.pixel(1, 1)).toEqual([255, 0, 0, 255]);
        expect(output.pixel(4, 4)).toEqual([0, 0, 255, 255]);
        expect(output.pixel(6, 6)).toEqual([0, 0, 255, 255]);
        expect(output.pixel(0, 0)).toEqual(harness.storedColour(0, 0));
        expect(output.pixel(7, 7)).toEqual(harness.storedColour(7, 7));
        await processor.destroy();
        await engine.destroy();
      });
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
