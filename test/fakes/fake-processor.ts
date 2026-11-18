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
  ImageError,
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
    async export({ plan, format, frame = 0 }, options) {
      if (destroyed) {
        throw new Error("The processor was destroyed.");
      }
      throwIfAborted(options?.signal);
      // It draws the base, redactions, and the layers it can sample without
      // a canvas; it refuses anything else (ADR 0009).
      // And one frame of an animation, over a source that holds its frames.
      const held = engine.sources.get(plan.base.source)?.frames ?? 1;
      checkPlanSupport(
        plan,
        held > 1 ? ["layers", "redactions", "animation"] : ["layers", "redactions"],
      );
      const shown = plan.animation?.frames[frame];
      if (plan.animation !== null && (!shown || shown.frame >= held)) {
        throw new ImageError(
          "UNSUPPORTED_PLAN",
          "The plan shows a frame its source doesn't hold.",
          {
            details: { reason: "animation" },
          },
        );
      }
      for (const layer of plan.layers) {
        const plain =
          // A drawing or an arrow never reaches here: `checkPlanSupport` refuses it.
          layer.kind !== "drawing" &&
          layer.kind !== "arrow" &&
          layer.rotation === 0 &&
          !layer.flipX &&
          (layer.opacity === 100 || !layer.visible) &&
          (layer.kind === "image" ||
            (layer.kind === "shape" &&
              layer.shape === "rectangle" &&
              layer.fill !== null &&
              layer.stroke === null));
        if (!plain) {
          throw new ImageError("UNSUPPORTED_PLAN", "The fake processor can't draw this layer.", {
            details: { reason: "layers" },
          });
        }
      }
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
      // Layers, bottom to top, over the developed base: the nearest pixel of
      // each, for the scene point at the output pixel's centre.
      const hex = (colour: string) =>
        [1, 3, 5].map((at) => Number.parseInt(colour.slice(at, at + 2), 16));
      for (const layer of plan.layers) {
        if (!layer.visible || layer.kind === "drawing" || layer.kind === "arrow") continue;
        const from = layer.kind === "image" ? engine.sources.get(layer.source) : undefined;
        if (layer.kind === "image" && from === undefined) {
          throw new TypeError(`Unknown source "${layer.source}".`);
        }
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
            const u = (at.x - layer.x) / layer.width;
            const v = (at.y - layer.y) / layer.height;
            if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
            const to = (y * size.width + x) * 4;
            if (layer.kind === "shape") {
              developed.set([...hex(layer.fill as string), 255], to);
            } else if (from) {
              const part = cropRect(layer.kind === "image" ? layer.crop : null, from);
              const sx = part.x + Math.floor(u * part.width);
              const sy = part.y + Math.floor(v * part.height);
              const s = (sy * from.width + sx) * 4;
              developed.set(from.pixels.subarray(s, s + 4), to);
            }
          }
        }
      }
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
