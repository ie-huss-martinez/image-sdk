import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { type ImageDevelop, type ImageFilter, NEUTRAL_DEVELOP } from "../../core/model/plan.js";
import { developPixels } from "./develop.js";

/**
 * How long develop takes on 4 megapixels (docs/adr/0006), with `pnpm bench`:
 * the median of ten runs after two warm-ups, on random and photo-like
 * pixels, written to
 * `test-results/develop-bench.txt`. Never run in CI, where timings
 * depend on the machine.
 */
const WIDTH = 2_500;
const HEIGHT = 1_600;

/** Random pixels: the worst case for branches and caches. */
const random = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
for (let i = 0; i < random.length; i += 1) random[i] = Math.imul(i + 1, 2_654_435_761) >>> 24;

/** Smooth gradients with a little noise, closer to a photo. */
const photoLike = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
let seed = 1;
const noise = () => {
  seed = Math.imul(seed, 1_664_525) + 1_013_904_223;
  return ((seed >>> 24) - 128) / 16;
};
for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    const i = (y * WIDTH + x) * 4;
    photoLike[i] = 128 + 100 * Math.sin(x / 300) + noise();
    photoLike[i + 1] = 40 + (180 * y) / HEIGHT + noise();
    photoLike[i + 2] = 200 - (150 * x) / WIDTH + noise();
    photoLike[i + 3] = 255;
  }
}
const work = new Uint8ClampedArray(random.length);

const FULL: ImageDevelop = {
  temperature: 20,
  tint: -10,
  exposure: 15,
  highlights: -30,
  shadows: 25,
  contrast: 20,
  saturation: 15,
  vibrance: 20,
};

const CASES: readonly [string, ImageDevelop, ImageFilter | null][] = [
  ["full develop, vivid at 60", FULL, { preset: "vivid", strength: 60 }],
  ["full develop, sepia at 60", FULL, { preset: "sepia", strength: 60 }],
  [
    "per-channel only: temperature, exposure, contrast",
    { ...NEUTRAL_DEVELOP, temperature: 20, exposure: 15, contrast: 20 },
    null,
  ],
  ["warm preset only, at 100", NEUTRAL_DEVELOP, { preset: "warm", strength: 100 }],
];

it("times develop on 4 MP", () => {
  const rows = CASES.flatMap(([name, develop, filter]) =>
    [
      ["random", random],
      ["photo-like", photoLike],
    ].map(([data, source]) => ({
      name: `${name}, ${data}`,
      develop,
      filter,
      source: source as Uint8ClampedArray,
    })),
  ).map(({ name, develop, filter, source }) => {
    const times: number[] = [];
    for (let run = 0; run < 12; run += 1) {
      work.set(source);
      const start = performance.now();
      developPixels(work, develop, filter);
      if (run > 1) times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    return { case: name, "median ms": Math.round(times[5] ?? 0) };
  });
  // Vitest hides console output from passing tests, so the timings go to a file.
  const table = rows
    .map((row) => `${String(row["median ms"]).padStart(6)} ms  ${row.case}`)
    .join("\n");
  writeFileSync(new URL("../../../test-results/develop-bench.txt", import.meta.url), `${table}\n`);
  expect(rows).toHaveLength(CASES.length);
});
