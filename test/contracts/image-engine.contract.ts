import { describe, expect, it } from "vitest";
import { type ImageEngine, isImageError } from "../../src/index.js";
import { aborted, rejection, type TestImageSpec } from "./harness-types.js";

/**
 * What an engine's contract test needs: a way to create the engine and
 * files to read. The SDK's adapter supplies real PNG and JPEG files; the
 * fakes supply fake ones.
 */
export interface ImageEngineHarness {
  createEngine(): ImageEngine;
  file(spec: TestImageSpec): Promise<Blob>;
  /** A file whose header claims more pixels than its data holds. */
  lyingHeader(): Promise<Blob>;
  /** A file the decoder decodes to another size than its header declares. */
  mismatchedDecode(): Promise<Blob>;
  /** A file in a recognised format that's malformed. */
  malformed(): Promise<Blob>;
  /** A file in a format the engine doesn't recognise. */
  unknown(): Promise<Blob>;
}

const ORIENTATIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/**
 * The behaviour every {@link ImageEngine} must have (ADR 0001, ADR 0004,
 * ADR 0005, ADR 0008). Adapters run it with their own harness.
 */
export function describeImageEngineContract(name: string, harness: ImageEngineHarness): void {
  describe(`${name}: the ImageEngine contract`, () => {
    it.each(ORIENTATIONS)(
      "probes stored and oriented sizes for EXIF orientation %i",
      async (orientation) => {
        const engine = harness.createEngine();
        const probe = await engine.probe(await harness.file({ width: 4, height: 3, orientation }));
        const turned = orientation >= 5;
        expect(probe).toMatchObject({
          stored: { width: 4, height: 3 },
          oriented: turned ? { width: 3, height: 4 } : { width: 4, height: 3 },
          orientation,
          frames: 1,
        });
        expect(probe.decodedPixelBound).toBeGreaterThanOrEqual(12);
        await engine.destroy();
      },
    );

    it("reports which metadata a file carries, and its keepable fields", async () => {
      const engine = harness.createEngine();
      const probe = await engine.probe(
        await harness.file({
          width: 2,
          height: 2,
          metadata: { location: true, camera: true },
          keepable: { title: "Harbour" },
        }),
      );
      expect(probe.metadata).toMatchObject({ location: true, camera: true });
      expect(probe.keepable.title).toBe("Harbour");
      await engine.destroy();
    });

    it("registers a source upright, at the probe's oriented size", async () => {
      const engine = harness.createEngine();
      const file = await harness.file({ width: 4, height: 3, orientation: 6 });
      const info = await engine.register("a", file, await engine.probe(file));
      expect(info).toMatchObject({ id: "a", width: 3, height: 4, frames: 1, decodedBytes: 48 });
      await engine.destroy();
    });

    it("rejects a header that claims more than the file holds, at probe", async () => {
      const engine = harness.createEngine();
      const error = await rejection(engine.probe(await harness.lyingHeader()));
      expect(isImageError(error, "INVALID_IMAGE")).toBe(true);
      await engine.destroy();
    });

    it("rejects a decode whose size differs from the probe, and keeps nothing", async () => {
      const engine = harness.createEngine();
      const file = await harness.mismatchedDecode();
      const error = await rejection(engine.register("a", file, await engine.probe(file)));
      expect(isImageError(error, "INVALID_IMAGE")).toBe(true);
      await expect(engine.thumbnail("a", 10)).rejects.toThrow(TypeError);
      await engine.destroy();
    });

    it("fails malformed and unknown files with their codes", async () => {
      const engine = harness.createEngine();
      expect(
        isImageError(await rejection(engine.probe(await harness.malformed())), "INVALID_IMAGE"),
      ).toBe(true);
      expect(
        isImageError(await rejection(engine.probe(await harness.unknown())), "UNSUPPORTED_FORMAT"),
      ).toBe(true);
      await engine.destroy();
    });

    it("makes thumbnails that fit, keep the aspect ratio and never enlarge", async () => {
      const engine = harness.createEngine();
      const file = await harness.file({ width: 40, height: 20 });
      await engine.register("a", file, await engine.probe(file));
      const small = await engine.thumbnail("a", 10);
      expect([small.width, small.height]).toEqual([10, 5]);
      small.close();
      const large = await engine.thumbnail("a", 1_000);
      expect([large.width, large.height]).toEqual([40, 20]);
      large.close();
      await engine.destroy();
    });

    it("refuses a used id, and forgets a released source", async () => {
      const engine = harness.createEngine();
      const file = await harness.file({ width: 2, height: 2 });
      const probe = await engine.probe(file);
      await engine.register("a", file, probe);
      await expect(engine.register("a", file, probe)).rejects.toThrow(TypeError);
      await engine.release("a");
      await expect(engine.thumbnail("a", 10)).rejects.toThrow(TypeError);
      await engine.release("never-registered");
      await engine.destroy();
    });

    it("rejects with ABORTED when cancelled", async () => {
      const engine = harness.createEngine();
      const file = await harness.file({ width: 2, height: 2 });
      expect(
        isImageError(await rejection(engine.probe(file, { signal: aborted() })), "ABORTED"),
      ).toBe(true);
      const probe = await engine.probe(file);
      expect(
        isImageError(
          await rejection(engine.register("a", file, probe, { signal: aborted() })),
          "ABORTED",
        ),
      ).toBe(true);
      await engine.destroy();
    });

    it("rejects calls after destroy", async () => {
      const engine = harness.createEngine();
      const file = await harness.file({ width: 2, height: 2 });
      await engine.destroy();
      await expect(engine.probe(file)).rejects.toThrow();
    });
  });
}
