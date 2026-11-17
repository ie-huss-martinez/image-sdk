import { developPixels } from "../../src/adapters/export/develop.js";
import { throwIfAborted } from "../../src/core/errors/error-helpers.js";
import {
  compositionSize,
  compositionToSource,
  cropRect,
  outputSize,
} from "../../src/core/model/geometry.js";
import {
  checkOutputLimits,
  checkPlanSupport,
  type ImageProcessor,
  type ImageRect,
  imageLimits,
  redactionBlocksInOutput,
  redactionRectInOutput,
} from "../../src/index.js";
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
      // It draws the base and redactions, and refuses anything else (ADR 0009).
      checkPlanSupport(plan, ["redactions"]);
      const source = engine.sources.get(plan.base.source);
      if (source === undefined) {
        throw new TypeError(`Unknown source "${plan.base.source}".`);
      }
      const crop = cropRect(plan.base.crop, source);
      const composition = compositionSize(plan, source);
      const size = outputSize(plan.output, composition);
      checkOutputLimits(options?.filePolicy ?? imageLimits.resolve(), size);
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
      // The same reference math as the SDK's renderer (ADR 0006).
      const developed = Uint8ClampedArray.from(pixels);
      developPixels(developed, plan.base.develop, plan.base.filter);
      // Redactions last, on whole output pixels (ADR 0010). It samples the
      // nearest pixel, with no scaler to read a neighbourhood, so it needs
      // no sanitised source.
      const paint = ({ x, y, width, height }: ImageRect, colour: readonly number[]) => {
        for (let row = y; row < y + height; row += 1) {
          for (let column = x; column < x + width; column += 1) {
            developed.set(colour, (row * size.width + column) * 4);
          }
        }
      };
      for (const redaction of plan.redactions) {
        if (redaction.mode === "solid") {
          const rect = redactionRectInOutput(redaction, crop, plan.base.orientation, size);
          const colour = [1, 3, 5].map((at) =>
            Number.parseInt(redaction.colour.slice(at, at + 2), 16),
          );
          if (rect) paint(rect, [...colour, 255]);
          continue;
        }
        const blocks = redactionBlocksInOutput(redaction, crop, plan.base.orientation, size);
        const means = blocks.map(({ x, y, width, height }) => {
          const sums = [0, 0, 0, 0];
          for (let row = y; row < y + height; row += 1) {
            for (let column = x; column < x + width; column += 1) {
              const at = (row * size.width + column) * 4;
              const alpha = developed[at + 3] as number;
              for (let channel = 0; channel < 3; channel += 1) {
                sums[channel] =
                  (sums[channel] as number) + (developed[at + channel] as number) * alpha;
              }
              sums[3] = (sums[3] as number) + alpha;
            }
          }
          const [red = 0, green = 0, blue = 0, alpha = 0] = sums;
          return alpha === 0
            ? [0, 0, 0, 0]
            : [red, green, blue]
                .map((sum) => Math.round(sum / alpha))
                .concat(Math.round(alpha / (width * height)));
        });
        blocks.forEach((block, index) => {
          paint(block, means[index] as number[]);
        });
      }
      pixels.splice(0, pixels.length, ...developed);
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
