import { throwIfAborted } from "../../src/core/errors/error-helpers.js";
import {
  compositionSize,
  compositionToSource,
  cropRect,
  outputSize,
} from "../../src/core/model/geometry.js";
import type { ImageProcessor } from "../../src/index.js";
import type { FakeEngine } from "./fake-engine.js";
import { encodeJson, type FakeExportFile } from "./fake-image.js";

/**
 * A processor over the fake engine's sources, which passes the processor's
 * contract suite. It samples the nearest source pixel for every output pixel.
 */
export function createFakeProcessor(engine: FakeEngine): ImageProcessor {
  let destroyed = false;
  return {
    async export({ plan, format }, options) {
      if (destroyed) {
        throw new Error("The processor was destroyed.");
      }
      throwIfAborted(options?.signal);
      const source = engine.sources.get(plan.base.source);
      if (source === undefined) {
        throw new TypeError(`Unknown source "${plan.base.source}".`);
      }
      const crop = cropRect(plan.base.crop, source);
      const composition = compositionSize(plan, source);
      const size = outputSize(plan.output, composition);
      const pixels: number[] = [];
      for (let y = 0; y < size.height; y += 1) {
        for (let x = 0; x < size.width; x += 1) {
          const at = compositionToSource(
            {
              x: ((x + 0.5) * composition.width) / size.width,
              y: ((y + 0.5) * composition.height) / size.height,
            },
            crop,
            plan.base.orientation,
          );
          const s = (Math.floor(at.y) * source.width + Math.floor(at.x)) * 4;
          pixels.push(...source.pixels.subarray(s, s + 4));
        }
      }
      const metadata = Object.fromEntries(
        Object.entries(plan.metadata).filter(([, value]) => value !== ""),
      );
      throwIfAborted(options?.signal);
      options?.onProgress?.(1);
      return encodeJson({
        magic: "FAKEOUT1",
        format: format.type,
        width: size.width,
        height: size.height,
        pixels,
        metadata,
      } satisfies FakeExportFile);
    },
    async destroy() {
      destroyed = true;
    },
  };
}
