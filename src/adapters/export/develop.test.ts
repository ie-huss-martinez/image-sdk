import { describe, expect, it } from "vitest";
import {
  DEVELOP_ADJUSTMENTS,
  FILTER_PRESETS,
  type ImageDevelop,
  type ImageFilter,
  NEUTRAL_DEVELOP,
} from "../../core/model/plan.js";
import { developPixels, needsDevelop } from "./develop.js";

/** A fixed set of colours: black, white, the primaries, a skin tone, a sky and a mid-grey. */
const SWATCHES = [
  [0, 0, 0],
  [255, 255, 255],
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [224, 172, 138],
  [96, 160, 224],
  [128, 128, 128],
] as const;

function developed(develop: Partial<ImageDevelop>, filter: ImageFilter | null = null) {
  const pixels = Uint8ClampedArray.from(SWATCHES.flatMap(([r, g, b]) => [r, g, b, 200]));
  developPixels(pixels, { ...NEUTRAL_DEVELOP, ...develop }, filter);
  return Array.from({ length: SWATCHES.length }, (_, i) =>
    Array.from(pixels.subarray(i * 4, i * 4 + 3)).join(","),
  ).join(" ");
}

describe("develop and filters (docs/adr/0006)", () => {
  it("changes nothing when neutral, or with a filter at strength 0", () => {
    const original = developed({});
    expect(original).toBe(SWATCHES.map((s) => s.join(",")).join(" "));
    expect(developed({}, { preset: "noir", strength: 0 })).toBe(original);
    expect(needsDevelop(NEUTRAL_DEVELOP, null)).toBe(false);
    expect(needsDevelop(NEUTRAL_DEVELOP, { preset: "noir", strength: 0 })).toBe(false);
  });

  it("never changes alpha", () => {
    const pixels = Uint8ClampedArray.of(10, 20, 30, 7, 200, 100, 50, 255);
    developPixels(
      pixels,
      { ...NEUTRAL_DEVELOP, exposure: 100, saturation: -100 },
      {
        preset: "sepia",
        strength: 100,
      },
    );
    expect([pixels[3], pixels[7]]).toEqual([7, 255]);
  });

  it("brightens with exposure, and warms with temperature", () => {
    const at = (develop: Partial<ImageDevelop>) => {
      const pixels = Uint8ClampedArray.of(128, 128, 128, 255);
      developPixels(pixels, { ...NEUTRAL_DEVELOP, ...develop }, null);
      return Array.from(pixels.subarray(0, 3));
    };
    const [r = 0, g = 0, b = 0] = at({ exposure: 50 });
    expect(r).toBeGreaterThan(128);
    expect(r).toBe(g);
    expect(g).toBe(b);
    const [wr = 0, , wb = 0] = at({ temperature: 100 });
    expect(wr).toBeGreaterThan(wb);
  });

  // Golden values: these are how documents render. A change here changes
  // every document with that adjustment, so it must be deliberate.
  it.each(DEVELOP_ADJUSTMENTS)("%s at -100, -50, 50 and 100", (name) => {
    expect(
      [-100, -50, 50, 100].map((value) => `${value}: ${developed({ [name]: value })}`),
    ).toMatchSnapshot();
  });

  it.each(FILTER_PRESETS)("the %s preset at strengths 50 and 100", (preset) => {
    expect(
      [50, 100].map((strength) => `${strength}: ${developed({}, { preset, strength })}`),
    ).toMatchSnapshot();
  });

  it("applies the preset after the user's own develop", () => {
    expect(
      developed({ exposure: 30, contrast: -20 }, { preset: "warm", strength: 60 }),
    ).toMatchSnapshot();
  });
});
