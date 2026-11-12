import { orientedSize } from "../../core/model/geometry.js";
import type { ExifOrientation, ImageSize } from "../../core/model/source.js";

/**
 * Each EXIF orientation as the canvas transform `[a, b, c, d, e, f]` that
 * draws a stored image of `width × height` upright: a stored pixel at
 * (x, y) lands at (a·x + c·y + e, b·x + d·y + f).
 */
export function orientationTransform(
  orientation: ExifOrientation,
  { width, height }: ImageSize,
): readonly [number, number, number, number, number, number] {
  switch (orientation) {
    case 2:
      return [-1, 0, 0, 1, width, 0];
    case 3:
      return [-1, 0, 0, -1, width, height];
    case 4:
      return [1, 0, 0, -1, 0, height];
    case 5:
      return [0, 1, 1, 0, 0, 0];
    case 6:
      return [0, 1, -1, 0, height, 0];
    case 7:
      return [0, -1, -1, 0, height, width];
    case 8:
      return [0, -1, 1, 0, 0, width];
    default:
      return [1, 0, 0, 1, 0, 0];
  }
}

/**
 * Draws a stored bitmap upright into a new one, for a browser that didn't
 * apply the file's orientation (docs/adr/0005). The stored bitmap is closed
 * as soon as it's drawn, so the peak is one stored and one oriented copy,
 * which the probe's bound counts.
 */
export function orientBitmap(stored: ImageBitmap, orientation: ExifOrientation): ImageBitmap {
  const size = { width: stored.width, height: stored.height };
  const upright = orientedSize(size, orientation);
  const canvas = new OffscreenCanvas(upright.width, upright.height);
  const context = canvas.getContext("2d");
  if (!context) {
    stored.close();
    throw new Error("The worker has no 2D canvas.");
  }
  context.setTransform(...orientationTransform(orientation, size));
  context.drawImage(stored, 0, 0);
  stored.close();
  return canvas.transferToImageBitmap();
}

/**
 * The calibration image's colours: red, green, blue and yellow quadrants,
 * from the top left, reading across.
 */
export const QUADRANT_COLOURS: readonly (readonly [number, number, number])[] = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
];

/** Which stored quadrant each upright quadrant shows, for an orientation. */
export function displayedQuadrants(orientation: ExifOrientation): readonly number[] {
  // The transform of a unit square's corners, centred on its middle.
  const [a, b, c, d] = orientationTransform(orientation, { width: 0, height: 0 });
  const corners = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const;
  const shown: number[] = [];
  corners.forEach(([x, y], stored) => {
    const at = corners.findIndex(([u, v]) => u === a * x + c * y && v === b * x + d * y);
    shown[at] = stored;
  });
  return shown;
}

const near = (pixel: readonly number[], colour: readonly number[]) =>
  colour.every((value, i) => Math.abs((pixel[i] ?? Number.NaN) - value) <= 64);

/**
 * The orientation a decode of a four-colour image of `stored` size shows,
 * from its size and the centres of its quadrants, or `undefined` when they
 * match none of the eight exactly.
 */
export function classifyQuadrants(
  decoded: ImageSize,
  quadrants: readonly (readonly number[])[],
  stored: ImageSize,
): ExifOrientation | undefined {
  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
    const upright = orientedSize(stored, orientation);
    if (upright.width !== decoded.width || upright.height !== decoded.height) continue;
    const shown = displayedQuadrants(orientation);
    if (shown.every((from, at) => near(quadrants[at] ?? [], QUADRANT_COLOURS[from] ?? []))) {
      return orientation;
    }
  }
  return undefined;
}

/** The centres of a bitmap's four quadrants, as `[r, g, b, a]`, read through a 2D canvas. */
export function quadrantCentres(bitmap: ImageBitmap): number[][] {
  const { width, height } = bitmap;
  const context = new OffscreenCanvas(width, height).getContext("2d", {
    willReadFrequently: true,
  });
  if (!context) throw new Error("The worker has no 2D canvas.");
  context.drawImage(bitmap, 0, 0);
  return [
    [width / 4, height / 4],
    [(3 * width) / 4, height / 4],
    [width / 4, (3 * height) / 4],
    [(3 * width) / 4, (3 * height) / 4],
  ].map(([x = 0, y = 0]) =>
    Array.from(context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data),
  );
}
