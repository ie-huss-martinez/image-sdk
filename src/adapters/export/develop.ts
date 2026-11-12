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
 *
 * Every transfer between sRGB-encoded values and linear light goes through
 * a table computed once and rounded to fixed point, and the per-pixel code
 * uses only `+`, `-`, `*`, `/` and `Math.round`, which IEEE 754 specifies
 * exactly. So engines whose `Math.pow` differs in the last place still
 * produce the same pixels.
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

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;
const REC709 = [LUMA_R, LUMA_G, LUMA_B] as const;

const lift = (black: number, white: number): Curve => [
  [0, black],
  [255, white],
];

/** The presets: data, never code (docs/adr/0006). */
const PRESETS: Readonly<Record<ImageFilterPreset, Preset>> = {
  vivid: { develop: { contrast: 20, saturation: 35, vibrance: 25 } },
  warm: { develop: { temperature: 35, tint: 5, vibrance: 10 } },
  cool: { develop: { temperature: -35, tint: -5 } },
  fade: {
    develop: { contrast: -30, shadows: 25 },
    curves: [lift(30, 240), lift(30, 240), lift(30, 240)],
  },
  mono: { mono: REC709 },
  noir: { develop: { contrast: 50, shadows: -20 }, mono: REC709 },
  sepia: { mono: REC709, curves: [lift(40, 255), lift(20, 235), lift(0, 190)] },
};

/**
 * The fixed point every table is rounded to: 2⁻²⁰, which a 32-bit float
 * holds exactly for values up to 1, so the tables are `Float32Array`s, half
 * the cache of 64-bit ones.
 */
const FIXED = 2 ** 20;
const fixed = (value: number) => Math.round(value * FIXED) / FIXED;

/** The sRGB transfer functions, used only to build the tables. */
export const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
export const linearToSrgb = (l: number): number =>
  l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;

/** The steps of the continuous tables: 0 to 1 in 4,096 steps. */
const STEPS = 4095;
/** An 8-bit encoded value to linear light. */
const DECODE_8 = Float32Array.from({ length: 256 }, (_, i) => fixed(srgbToLinear(i / 255)));
/** An encoded value, in steps, to linear light. */
const DECODE = Float32Array.from({ length: STEPS + 1 }, (_, i) => fixed(srgbToLinear(i / STEPS)));
/** Linear light, in steps, to an encoded value. */
const ENCODE = Float32Array.from({ length: STEPS + 1 }, (_, i) => fixed(linearToSrgb(i / STEPS)));

/** The reciprocal of each DECODE entry, 0 for the first: for vibrance's chroma. */
const RECIPROCAL = Float64Array.from(DECODE, (linear) => (linear > 0 ? 1 / linear : 0));

/**
 * What the tables are built from, for the test that checks no entry sits
 * near a fixed-point rounding boundary, where an engine's last-place
 * difference in `Math.pow` could matter.
 */
export const TRANSFER = { FIXED, STEPS } as const;

// Two-argument Math.min and Math.max compile without branches, which
// measured fastest in the pixel loop (pnpm bench).
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const step = (value: number) => Math.round(clamp01(value) * STEPS);
const to8 = (value: number) => Math.round(clamp01(value) * 255);
const contrastCurve = (e: number, k: number) =>
  k === 0 ? e : clamp01(e + k * (e * e * (3 - 2 * e) - e));

type Tables = readonly [Uint8Array, Uint8Array, Uint8Array];

/** Runs a develop that mixes channels on one 8-bit pixel, writing encoded 0 to 1 values into `out`. */
type StageRunner = (r8: number, g8: number, b8: number, out: Float64Array) => void;

/** One develop, prepared for a render. */
interface Stage {
  /** Each channel's 8-bit value to its 8-bit result, when no step mixes channels. */
  readonly perChannel: Tables | undefined;
  readonly run: StageRunner;
}

const channels = <T>(make: (channel: 0 | 1 | 2) => T): readonly [T, T, T] => [
  make(0),
  make(1),
  make(2),
];

/**
 * Prepares one develop: white balance and exposure as a table per channel,
 * then, per pixel, highlights and shadows, contrast, and saturation and
 * vibrance in linear light. The runner captures its constants, and leaves
 * out the steps that are 0.
 */
function createStage(d: ImageDevelop): Stage {
  const exposure = fixed(2 ** (d.exposure / 50));
  const temperature = d.temperature / 100;
  const tint = d.tint / 100;
  const gains = [
    (1 + 0.2 * temperature) * exposure,
    (1 - 0.2 * tint) * exposure,
    (1 - 0.2 * temperature) * exposure,
  ] as const;
  const [br, bg, bb] = channels((c) =>
    Float32Array.from(DECODE_8, (linear) => ENCODE[step(linear * gains[c])] as number),
  );
  const k = d.contrast / 100;
  const highlights = (d.highlights / 100) * 0.25;
  const shadows = (d.shadows / 100) * 0.25;
  const saturation = d.saturation / 100;
  const vibrance = d.vibrance / 100;
  const tonal = highlights !== 0 || shadows !== 0;
  const colour = saturation !== 0 || vibrance !== 0;

  // The per-pixel steps, inlined by hand: V8 doesn't inline small helpers
  // reliably in this loop, and calls dominated the profile (pnpm bench).
  // Values are clamped before indexing, so `(x + 0.5) | 0` rounds as
  // Math.round does for them.
  const general: StageRunner = (r8, g8, b8, out) => {
    let r = br[r8] as number;
    let g = bg[g8] as number;
    let b = bb[b8] as number;
    if (tonal) {
      const y = LUMA_R * r + LUMA_G * g + LUMA_B * b;
      let h = (y - 0.5) * 2;
      h = Math.min(1, Math.max(0, h));
      let d = y * 2;
      d = Math.min(1, Math.max(0, d));
      const add = highlights * h * h * (3 - 2 * h) + shadows * (1 - d * d * (3 - 2 * d));
      r += add;
      g += add;
      b += add;
      r = Math.min(1, Math.max(0, r));
      g = Math.min(1, Math.max(0, g));
      b = Math.min(1, Math.max(0, b));
    }
    if (k !== 0) {
      r += k * (r * r * (3 - 2 * r) - r);
      g += k * (g * g * (3 - 2 * g) - g);
      b += k * (b * b * (3 - 2 * b) - b);
      r = Math.min(1, Math.max(0, r));
      g = Math.min(1, Math.max(0, g));
      b = Math.min(1, Math.max(0, b));
    }
    if (colour) {
      const ir = (r * STEPS + 0.5) | 0;
      const ig = (g * STEPS + 0.5) | 0;
      const ib = (b * STEPS + 0.5) | 0;
      const lr = DECODE[ir] as number;
      const lg = DECODE[ig] as number;
      const lb = DECODE[ib] as number;
      const y = LUMA_R * lr + LUMA_G * lg + LUMA_B * lb;
      let scale = 1 + saturation;
      if (vibrance !== 0) {
        // DECODE rises with its index, so the brightest and darkest channels
        // are the largest and smallest indexes: integer comparisons, and a
        // reciprocal from a table instead of a division per pixel.
        const top = Math.max(ir, Math.max(ig, ib));
        const chroma =
          top > 0
            ? ((DECODE[top] as number) - (DECODE[Math.min(ir, Math.min(ig, ib))] as number)) *
              (RECIPROCAL[top] as number)
            : 0;
        scale += vibrance * (1 - chroma);
      }
      r = y + (lr - y) * scale;
      g = y + (lg - y) * scale;
      b = y + (lb - y) * scale;
      r = ENCODE[(Math.min(1, Math.max(0, r)) * STEPS + 0.5) | 0] as number;
      g = ENCODE[(Math.min(1, Math.max(0, g)) * STEPS + 0.5) | 0] as number;
      b = ENCODE[(Math.min(1, Math.max(0, b)) * STEPS + 0.5) | 0] as number;
    }
    out[0] = r;
    out[1] = g;
    out[2] = b;
  };
  // Without highlights and shadows, contrast is per channel too, so white
  // balance, exposure and contrast fold into one table per channel that
  // gives saturation and vibrance their DECODE index directly.
  const [xr, xg, xb] = channels((c) =>
    Uint16Array.from([br, bg, bb][c] as Float32Array, (e) => step(contrastCurve(e, k))),
  );
  const colourOnly: StageRunner = (r8, g8, b8, out) => {
    const ir = xr[r8] as number;
    const ig = xg[g8] as number;
    const ib = xb[b8] as number;
    const lr = DECODE[ir] as number;
    const lg = DECODE[ig] as number;
    const lb = DECODE[ib] as number;
    const y = LUMA_R * lr + LUMA_G * lg + LUMA_B * lb;
    let scale = 1 + saturation;
    if (vibrance !== 0) {
      const top = Math.max(ir, Math.max(ig, ib));
      const chroma =
        top > 0
          ? ((DECODE[top] as number) - (DECODE[Math.min(ir, Math.min(ig, ib))] as number)) *
            (RECIPROCAL[top] as number)
          : 0;
      scale += vibrance * (1 - chroma);
    }
    let r = y + (lr - y) * scale;
    let g = y + (lg - y) * scale;
    let b = y + (lb - y) * scale;
    r = ENCODE[(Math.min(1, Math.max(0, r)) * STEPS + 0.5) | 0] as number;
    g = ENCODE[(Math.min(1, Math.max(0, g)) * STEPS + 0.5) | 0] as number;
    b = ENCODE[(Math.min(1, Math.max(0, b)) * STEPS + 0.5) | 0] as number;
    out[0] = r;
    out[1] = g;
    out[2] = b;
  };
  return {
    perChannel:
      tonal || colour
        ? undefined
        : channels((c) =>
            Uint8Array.from([br, bg, bb][c] as Float32Array, (e) => to8(contrastCurve(e, k))),
          ),
    run: tonal ? general : colourOnly,
  };
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

const isNeutral = (develop: ImageDevelop) => Object.values(develop).every((value) => value === 0);

/** Whether a base has anything to develop. */
export function needsDevelop(develop: ImageDevelop, filter: ImageFilter | null): boolean {
  return !isNeutral(develop) || (filter !== null && filter.strength > 0);
}

/**
 * The same bytes as a plain `Uint8Array`: every value the loops write is
 * already a whole number from 0 to 255, and a clamped array would clamp and
 * round each store again.
 */
const bytesOf = (pixels: Uint8ClampedArray) =>
  new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.length);

const IDENTITY = Uint8Array.from({ length: 256 }, (_, i) => i);

/**
 * Prepares a develop and filter once per render (docs/adr/0006), and
 * returns the function that develops RGBA pixels in place, strip by strip:
 * the user's develop values, then the filter preset's own develop values,
 * monochrome mix and tone curves, mixed with the pixel before the preset by
 * its strength. Alpha is never changed. When no step mixes channels, each
 * channel maps through one fused table, and the pixel loop allocates
 * nothing either way.
 *
 * @internal
 */
export function createDeveloper(
  develop: ImageDevelop,
  filter: ImageFilter | null,
): (pixels: Uint8ClampedArray) => void {
  const user = isNeutral(develop) ? undefined : createStage(develop);
  const preset = filter === null || filter.strength === 0 ? undefined : PRESETS[filter.preset];
  const strength = (filter?.strength ?? 0) / 100;
  const presetStage = preset?.develop
    ? createStage({ ...NEUTRAL_DEVELOP, ...preset.develop })
    : undefined;
  const curves: Tables = preset?.curves
    ? channels((c) => curveTable(preset.curves?.[c] ?? []))
    : [IDENTITY, IDENTITY, IDENTITY];
  const mono = preset?.mono;
  const hasCurves = preset?.curves !== undefined;
  const out = new Float64Array(3);

  // Each channel's preset, mixed by strength, when the preset doesn't mix channels.
  const presetTables: Tables | undefined =
    preset !== undefined && mono === undefined && (!presetStage || presetStage.perChannel)
      ? channels((c) =>
          Uint8Array.from(IDENTITY, (a) => {
            const developed = presetStage?.perChannel?.[c][a] ?? a;
            const p = curves[c][developed] ?? developed;
            return Math.round(a + (p - a) * strength);
          }),
        )
      : undefined;
  const userTables: Tables | undefined = user ? user.perChannel : [IDENTITY, IDENTITY, IDENTITY];

  // The fast path: one fused table per channel for the whole render.
  if (userTables && (!preset || presetTables)) {
    const [tr, tg, tb] = channels((c) =>
      Uint8Array.from(userTables[c], (a) => (presetTables ? (presetTables[c][a] ?? a) : a)),
    );
    return (clamped) => {
      const pixels = bytesOf(clamped);
      for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = tr[pixels[i] ?? 0] ?? 0;
        pixels[i + 1] = tg[pixels[i + 1] ?? 0] ?? 0;
        pixels[i + 2] = tb[pixels[i + 2] ?? 0] ?? 0;
      }
    };
  }

  return (clamped) => {
    const pixels = bytesOf(clamped);
    for (let i = 0; i < pixels.length; i += 4) {
      let r = pixels[i] ?? 0;
      let g = pixels[i + 1] ?? 0;
      let b = pixels[i + 2] ?? 0;
      if (userTables) {
        r = userTables[0][r] ?? 0;
        g = userTables[1][g] ?? 0;
        b = userTables[2][b] ?? 0;
      } else if (user) {
        user.run(r, g, b, out);
        // Encoded values from a stage are already within 0 to 1.
        r = ((out[0] as number) * 255 + 0.5) | 0;
        g = ((out[1] as number) * 255 + 0.5) | 0;
        b = ((out[2] as number) * 255 + 0.5) | 0;
      }
      if (presetTables) {
        r = presetTables[0][r] ?? r;
        g = presetTables[1][g] ?? g;
        b = presetTables[2][b] ?? b;
      } else if (preset) {
        let pr: number;
        let pg: number;
        let pb: number;
        if (presetStage?.perChannel) {
          pr = (presetStage.perChannel[0][r] ?? 0) / 255;
          pg = (presetStage.perChannel[1][g] ?? 0) / 255;
          pb = (presetStage.perChannel[2][b] ?? 0) / 255;
        } else if (presetStage) {
          presetStage.run(r, g, b, out);
          pr = out[0] ?? 0;
          pg = out[1] ?? 0;
          pb = out[2] ?? 0;
        } else {
          pr = r / 255;
          pg = g / 255;
          pb = b / 255;
        }
        if (mono) {
          const y = mono[0] * pr + mono[1] * pg + mono[2] * pb;
          pr = y;
          pg = y;
          pb = y;
        }
        let cr = (pr * 255 + 0.5) | 0;
        let cg = (pg * 255 + 0.5) | 0;
        let cb = (pb * 255 + 0.5) | 0;
        if (hasCurves) {
          cr = curves[0][cr] as number;
          cg = curves[1][cg] as number;
          cb = curves[2][cb] as number;
        }
        // The mix stays within 0 to 255, so `| 0` rounds as Math.round does.
        r = (r + (cr - r) * strength + 0.5) | 0;
        g = (g + (cg - g) * strength + 0.5) | 0;
        b = (b + (cb - b) * strength + 0.5) | 0;
      }
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
    }
  };
}

/**
 * Develops and filters RGBA pixels in place: {@link createDeveloper} for
 * one call.
 *
 * @internal
 */
export function developPixels(
  pixels: Uint8ClampedArray,
  develop: ImageDevelop,
  filter: ImageFilter | null,
): void {
  createDeveloper(develop, filter)(pixels);
}
