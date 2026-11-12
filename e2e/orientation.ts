/**
 * Reads how a decode was oriented from the four-colour fixtures
 * (tools/generate-capability-fixtures.sh): red, green, blue and yellow
 * quadrants, from the top left, reading across.
 */
export const QUADRANT_COLOURS = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
] as const;

/** Each EXIF orientation as a matrix on (x, y), with y pointing down. */
const MATRICES: Record<number, readonly [number, number, number, number]> = {
  1: [1, 0, 0, 1],
  2: [-1, 0, 0, 1],
  3: [-1, 0, 0, -1],
  4: [1, 0, 0, -1],
  5: [0, 1, 1, 0],
  6: [0, -1, 1, 0],
  7: [0, -1, -1, 0],
  8: [0, 1, -1, 0],
};
const CORNERS = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const;

/** Which stored quadrant each displayed quadrant shows, for an orientation. */
export function displayedQuadrants(orientation: number): number[] {
  const [a, b, c, d] = MATRICES[orientation] ?? [1, 0, 0, 1];
  const shown: number[] = [];
  CORNERS.forEach(([x, y], stored) => {
    const at = CORNERS.findIndex(([u, v]) => u === a * x + b * y && v === c * x + d * y);
    shown[at] = stored;
  });
  return shown;
}

const near = (pixel: readonly number[], colour: readonly number[]) =>
  colour.every((value, i) => Math.abs((pixel[i] ?? -999) - value) <= 64);

/**
 * The orientation a decode of a 48 × 32 four-colour file shows, or
 * `undefined` when its size and pixels match none of the eight.
 */
export function classify(
  width: number,
  height: number,
  quadrants: readonly (readonly number[])[] | undefined,
): number | undefined {
  if (quadrants === undefined) return undefined;
  for (let orientation = 1; orientation <= 8; orientation += 1) {
    const turned = orientation >= 5;
    if (width !== (turned ? 32 : 48) || height !== (turned ? 48 : 32)) continue;
    const shown = displayedQuadrants(orientation);
    if (shown.every((stored, at) => near(quadrants[at] ?? [], QUADRANT_COLOURS[stored] ?? []))) {
      return orientation;
    }
  }
  return undefined;
}
