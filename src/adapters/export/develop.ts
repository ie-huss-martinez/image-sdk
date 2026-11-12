import {
  type ImageDevelop,
  type ImageFilter,
  type ImageFilterPreset,
  NEUTRAL_DEVELOP,
} from "../../core/model/plan.js";

/**
 * The develop adjustments and filter presets of docs/adr/0006: pure
 * arithmetic over unpremultiplied 8-bit RGBA, with no DOM, so the core's
 * tests pin it with golden values in Node, and every engine computes the
 * same pixels. These formulas are the definition of how a document renders:
 * changing one changes the golden values.
 */

/** A per-channel tone curve: control points from input to output, 0 to 255, interpolated linearly. */
type Curve = readonly (readonly [number, number])[];

interface Preset {
  /** Develop values applied after the user's own. */
  readonly develop?: Partial<ImageDevelop>;
  /** Weights of red, green and blue for a monochrome mix, applied after the develop values. */
  readonly mono?: readonly [number, number, number];
  /** Tone curves for red, green and blue, applied last. */
  readonly curves?: readonly [Curve, Curve, Curve];
}

const REC709: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];

/** The presets: data, never code (docs/adr/0006). */
const PRESETS: Readonly<Record<ImageFilterPreset, Preset>> = {
  vivid: { develop: { contrast: 20, saturation: 35, vibrance: 25 } },
  warm: { develop: { temperature: 35, tint: 5, vibrance: 10 } },
  cool: { develop: { temperature: -35, tint: -5 } },
  fade: {
    develop: { contrast: -30, shadows: 25 },
    curves: [
      [
        [0, 30],
        [255, 240],
      ],
      [
        [0, 30],
        [255, 240],
      ],
      [
        [0, 30],
        [255, 240],
      ],
    ],
  },
  mono: { mono: REC709 },
  noir: { develop: { contrast: 50, shadows: -20 }, mono: REC709 },
  sepia: {
    mono: REC709,
    curves: [
      [
        [0, 40],
        [255, 255],
      ],
      [
        [0, 20],
        [255, 235],
      ],
      [
        [0, 0],
        [255, 190],
      ],
    ],
  },
};

const ENCODE_STEPS = 4095;
/** Linear light, in 4,096 steps, to sRGB-encoded 0 to 1. */
const TO_ENCODED = Float64Array.from({ length: ENCODE_STEPS + 1 }, (_, i) => {
  const l = i / ENCODE_STEPS;
  return l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
});

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const encode = (linear: number) => TO_ENCODED[Math.round(clamp01(linear) * ENCODE_STEPS)] ?? 0;
const decode = (encoded: number) => {
  const c = clamp01(encoded);
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** Whether a develop changes nothing. */
export function isNeutral(develop: ImageDevelop): boolean {
  return Object.values(develop).every((value) => value === 0);
}

/** One pixel through the develop pipeline, as encoded 0 to 1 values. */
type Rgb = [number, number, number];

function developRgb(rgb: Rgb, d: ImageDevelop): Rgb {
  // 1–3: white balance and exposure, in linear light.
  let [r, g, b] = [decode(rgb[0]), decode(rgb[1]), decode(rgb[2])];
  const temperature = d.temperature / 100;
  const tint = d.tint / 100;
  const gain = 2 ** (d.exposure / 50);
  r *= (1 + 0.2 * temperature) * gain;
  g *= (1 - 0.2 * tint) * gain;
  b *= (1 - 0.2 * temperature) * gain;
  // 4–6: highlights, shadows and contrast, on encoded values.
  r = encode(r);
  g = encode(g);
  b = encode(b);
  if (d.highlights !== 0 || d.shadows !== 0) {
    const y = REC709[0] * r + REC709[1] * g + REC709[2] * b;
    const lift =
      (d.highlights / 100) * 0.25 * smoothstep(0.5, 1, y) +
      (d.shadows / 100) * 0.25 * (1 - smoothstep(0, 0.5, y));
    r = clamp01(r + lift);
    g = clamp01(g + lift);
    b = clamp01(b + lift);
  }
  if (d.contrast !== 0) {
    const k = d.contrast / 100;
    const curve = (c: number) => clamp01(c + k * (c * c * (3 - 2 * c) - c));
    r = curve(r);
    g = curve(g);
    b = curve(b);
  }
  // 7–8: saturation and vibrance, around luminance in linear light.
  if (d.saturation !== 0 || d.vibrance !== 0) {
    let lr = decode(r);
    let lg = decode(g);
    let lb = decode(b);
    const y = REC709[0] * lr + REC709[1] * lg + REC709[2] * lb;
    const max = Math.max(lr, lg, lb);
    const chroma = max > 0 ? (max - Math.min(lr, lg, lb)) / max : 0;
    const scale = 1 + d.saturation / 100 + (d.vibrance / 100) * (1 - chroma);
    lr = y + (lr - y) * scale;
    lg = y + (lg - y) * scale;
    lb = y + (lb - y) * scale;
    r = encode(lr);
    g = encode(lg);
    b = encode(lb);
  }
  return [r, g, b];
}

/** A 256-entry table for a tone curve. */
function curveTable(curve: Curve): Uint8Array {
  return Uint8Array.from({ length: 256 }, (_, x) => {
    for (let i = 1; i < curve.length; i += 1) {
      const [x0, y0] = curve[i - 1] ?? [0, 0];
      const [x1, y1] = curve[i] ?? [255, 255];
      if (x <= x1) return Math.round(y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1));
    }
    return curve.at(-1)?.[1] ?? x;
  });
}

const to8 = (c: number) => Math.round(clamp01(c) * 255);

/**
 * Develops and filters RGBA pixels in place (docs/adr/0006): the user's
 * develop values, then the filter preset's own develop values, monochrome
 * mix and tone curves, mixed with the pixel before the preset by its
 * strength. Alpha is never changed.
 *
 * @internal
 */
export function developPixels(
  pixels: Uint8ClampedArray,
  develop: ImageDevelop,
  filter: ImageFilter | null,
): void {
  const preset = filter === null || filter.strength === 0 ? undefined : PRESETS[filter.preset];
  const presetDevelop = preset?.develop ? { ...NEUTRAL_DEVELOP, ...preset.develop } : undefined;
  const curves = preset?.curves?.map(curveTable);
  const strength = (filter?.strength ?? 0) / 100;
  const neutral = isNeutral(develop);
  for (let i = 0; i < pixels.length; i += 4) {
    let rgb: Rgb = [(pixels[i] ?? 0) / 255, (pixels[i + 1] ?? 0) / 255, (pixels[i + 2] ?? 0) / 255];
    if (!neutral) rgb = developRgb(rgb, develop);
    let r = to8(rgb[0]);
    let g = to8(rgb[1]);
    let b = to8(rgb[2]);
    if (preset) {
      let p: Rgb = [r / 255, g / 255, b / 255];
      if (presetDevelop) p = developRgb(p, presetDevelop);
      if (preset.mono) {
        const [wr, wg, wb] = preset.mono;
        const y = wr * p[0] + wg * p[1] + wb * p[2];
        p = [y, y, y];
      }
      let pr = to8(p[0]);
      let pg = to8(p[1]);
      let pb = to8(p[2]);
      if (curves) {
        pr = curves[0]?.[pr] ?? pr;
        pg = curves[1]?.[pg] ?? pg;
        pb = curves[2]?.[pb] ?? pb;
      }
      r = Math.round(r + (pr - r) * strength);
      g = Math.round(g + (pg - g) * strength);
      b = Math.round(b + (pb - b) * strength);
    }
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
  }
}

/** Whether a base has anything to develop. */
export function needsDevelop(develop: ImageDevelop, filter: ImageFilter | null): boolean {
  return !isNeutral(develop) || (filter !== null && filter.strength > 0);
}
