import { sourceToComposition } from "./geometry.js";
import type { ImageCrop, ImageLayerBox, ImageOrientation } from "./plan.js";
import type { ImageSize } from "./source.js";

/**
 * A 2D affine transform, as the canvas takes it: `x' = a·x + c·y + e` and
 * `y' = b·x + d·y + f`.
 *
 * @public
 */
export type ImageMatrix = readonly [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
];

/** `first` then `second`: the transform that applies `first`, then `second`. */
function then(first: ImageMatrix, second: ImageMatrix): ImageMatrix {
  const [a1, b1, c1, d1, e1, f1] = first;
  const [a2, b2, c2, d2, e2, f2] = second;
  return [
    a2 * a1 + c2 * b1,
    b2 * a1 + d2 * b1,
    a2 * c1 + c2 * d1,
    b2 * c1 + d2 * d1,
    a2 * e1 + c2 * f1 + e2,
    b2 * e1 + d2 * f1 + f2,
  ];
}

/**
 * The transform from the scene to an output of the given size: through the
 * crop, the rotation and the flips, then the output's scale (ADR 0009). The
 * renderer draws layers through it, and the base through the same mapping,
 * so a layer stays on the pixels it was placed on.
 *
 * It's built from three points mapped by `sourceToComposition`, so it can't
 * disagree with the geometry the editor places frames with. Its entries are
 * exact for an output at the composition's own size.
 *
 * @param crop - The crop, or the whole source: `cropRect(plan.base.crop, source)`.
 * @public
 */
export function sceneToOutput(
  crop: ImageCrop,
  orientation: ImageOrientation,
  output: ImageSize,
): ImageMatrix {
  const turned = orientation.rotate % 180 !== 0;
  const composition = turned
    ? { width: crop.height, height: crop.width }
    : { width: crop.width, height: crop.height };
  const scaleX = output.width / composition.width;
  const scaleY = output.height / composition.height;
  const at = (x: number, y: number) => {
    const point = sourceToComposition({ x, y }, crop, orientation);
    return { x: point.x * scaleX, y: point.y * scaleY };
  };
  const origin = at(0, 0);
  const alongX = at(1, 0);
  const alongY = at(0, 1);
  return [
    alongX.x - origin.x,
    alongX.y - origin.y,
    alongY.x - origin.x,
    alongY.y - origin.y,
    origin.x,
    origin.y,
  ];
}

/**
 * The transform from a layer's own box to the scene: the box's top-left
 * corner is the origin, one unit is one scene pixel, and the box is mirrored
 * left to right when it's flipped, then turned about its centre by its
 * rotation, clockwise, in tenths of a degree (ADR 0009).
 *
 * @public
 */
export function layerToScene(box: ImageLayerBox): ImageMatrix {
  const radians = (box.rotation * Math.PI) / 1_800;
  // Quarter turns are exact: Math.cos(Math.PI / 2) isn't quite 0.
  const quarter = box.rotation % 900 === 0 ? (box.rotation / 900) % 4 : -1;
  const cos = quarter >= 0 ? ([1, 0, -1, 0][quarter] as number) : Math.cos(radians);
  const sin = quarter >= 0 ? ([0, 1, 0, -1][quarter] as number) : Math.sin(radians);
  // Never a negative zero, which JSON can't carry.
  const negative = (value: number) => (value === 0 ? 0 : -value);
  // A flipped box's own x axis runs the other way, before the turn.
  const a = box.flipX ? negative(cos) : cos;
  const b = box.flipX ? negative(sin) : sin;
  const c = negative(sin);
  const d = cos;
  // The box's centre stays where it is: flipped and turned about it.
  return [
    a,
    b,
    c,
    d,
    box.x + box.width / 2 - (a * box.width + c * box.height) / 2,
    box.y + box.height / 2 - (b * box.width + d * box.height) / 2,
  ];
}

/**
 * The transform from a layer's own box to an output: {@link layerToScene},
 * then {@link sceneToOutput}. The renderer sets it on the canvas and draws
 * the layer in its box's own pixels.
 *
 * @public
 */
export function layerToOutput(
  box: ImageLayerBox,
  crop: ImageCrop,
  orientation: ImageOrientation,
  output: ImageSize,
): ImageMatrix {
  return then(layerToScene(box), sceneToOutput(crop, orientation, output));
}

/**
 * The inverse of a transform that has one: every transform here does, since
 * a box and an output have at least one pixel.
 *
 * @public
 */
export function invertMatrix(matrix: ImageMatrix): ImageMatrix {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ];
}

/**
 * The transform from the scene to an image layer's source pixels: where a
 * point of the scene falls in the bitmap the layer draws. The renderer uses
 * it to replace, in a copy of that bitmap, the pixels a redaction covers
 * (ADR 0010).
 *
 * @param crop - The part of the source the layer draws: its crop, or all of it.
 * @public
 */
export function sceneToLayerSource(box: ImageLayerBox, crop: ImageCrop): ImageMatrix {
  // The box's pixels to the crop's, then to the crop's place in the source.
  const boxToSource: ImageMatrix = [
    crop.width / box.width,
    0,
    0,
    crop.height / box.height,
    crop.x,
    crop.y,
  ];
  return then(invertMatrix(layerToScene(box)), boxToSource);
}

/**
 * Where a point goes under a transform.
 *
 * @public
 */
export function applyMatrix(
  matrix: ImageMatrix,
  point: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } {
  const [a, b, c, d, e, f] = matrix;
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
}

/**
 * What a line of text measures at the size it's laid out at.
 *
 * @public
 */
export interface ImageTextLine {
  /** Its advance: how far the pen moves. */
  readonly width: number;
}

/**
 * Where a text layer's lines go: the block of lines scaled uniformly to the
 * largest size that fits the box, centred in its height, and each line
 * placed by the alignment (ADR 0009). The layout is in the box's own
 * pixels, so it's the same for the preview and for every export.
 *
 * @param lines - Each line's advance, at the size they were measured at.
 * @param lineHeight - The height of one line at that size: the font's ascent
 *   and descent.
 * @param ascent - The font's ascent at that size: from a line's top to its baseline.
 * @param box - The layer's box: its width and height.
 * @param align - `start`, `center` or `end`, by the text's direction.
 * @param rightToLeft - Whether the text's direction is right to left, so
 *   `start` is the box's right edge.
 * @returns The scale from the measured size to the drawn size, and for each
 *   line the x of its left edge and the y of its baseline, in the box's
 *   pixels. `null` when there's nothing to draw: no line has a width.
 * @public
 */
export function fitTextLines(
  lines: readonly ImageTextLine[],
  lineHeight: number,
  ascent: number,
  box: ImageSize,
  align: "start" | "center" | "end",
  rightToLeft: boolean,
): {
  readonly scale: number;
  readonly lines: readonly { readonly x: number; readonly baseline: number }[];
} | null {
  const widest = Math.max(0, ...lines.map((line) => line.width));
  if (!(widest > 0) || !(lineHeight > 0)) return null;
  const scale = Math.min(box.width / widest, box.height / (lineHeight * lines.length));
  const top = (box.height - lineHeight * lines.length * scale) / 2;
  // Which edge of the box the lines sit against: 0 the left, 1 the right.
  const side = align === "center" ? 0.5 : (align === "start") === rightToLeft ? 1 : 0;
  return {
    scale,
    lines: lines.map((line, index) => ({
      x: (box.width - line.width * scale) * side,
      baseline: top + (index * lineHeight + ascent) * scale,
    })),
  };
}

/**
 * Whether text reads right to left: whether its first strongly directional
 * character is from a right-to-left script, such as Hebrew or Arabic. Text
 * with no such character reads left to right.
 *
 * @public
 */
export function isRightToLeft(text: string): boolean {
  for (const character of text) {
    if (RIGHT_TO_LEFT.test(character)) return true;
    if (LEFT_TO_RIGHT.test(character)) return false;
  }
  return false;
}

// Hebrew, Arabic, Syriac, Thaana, N'Ko, Samaritan, Mandaic and their
// presentation forms; then every other letter, which reads left to right.
const RIGHT_TO_LEFT =
  /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;
const LEFT_TO_RIGHT = /\p{L}/u;
