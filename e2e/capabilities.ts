import { readFileSync } from "node:fs";
import {
  fixture,
  gifFrameOutsideScreen,
  jpegRotated,
  jpegUltraHdr,
  jpegWithExifThumbnail,
  jpegWithMpfPreview,
  pngRotated,
  webpRotated,
} from "./fixtures.js";

export const BROWSERS = ["chromium", "firefox", "webkit"] as const;
export type Browser = (typeof BROWSERS)[number];

export const TABLE = new URL("../docs/capabilities.md", import.meta.url);

/**
 * Whether the suite runs in the pinned browser image of ci/Dockerfile (ADR
 * 0025 in sdk-core), where the table is measured. Engines elsewhere may be
 * built with other codecs.
 */
export const IN_PINNED_IMAGE = process.env["PLAYWRIGHT_BROWSERS_PATH"] === "/ms-playwright";
/** Where each test writes what it saw, for regenerating the table. */
export const RESULTS = new URL("./test-results/capabilities/", import.meta.url);

export interface DecodeCase {
  readonly name: string;
  readonly bytes: () => Uint8Array;
  /** The upright size of the primary image, which the decode must return (ADR 0001). */
  readonly primary: { readonly width: number; readonly height: number };
  /** Whether the SDK's probe accepts the file; the matrix also records files it refuses. */
  readonly probe: "accepts" | "refuses";
  /**
   * `none` asks the browser not to apply the file's orientation, so the
   * decode is the stored size, which the probe's oriented size then isn't.
   */
  readonly imageOrientation?: "none";
}

const SMALL = { width: 48, height: 32 };
const LARGE = { width: 96, height: 64 };

/**
 * One file per format the SDK reads, and the files whose structure decides
 * how the decode is bounded (ADR 0001): JPEG secondary images and EXIF
 * thumbnails, HEIF thumbnails, orientation, and a GIF frame that overflows
 * its screen.
 */
export const DECODE_CASES: readonly DecodeCase[] = [
  { name: "PNG", bytes: () => fixture("primary.png"), primary: SMALL, probe: "accepts" },
  {
    name: "PNG, eXIf orientation 6",
    bytes: pngRotated,
    primary: { width: 32, height: 48 },
    probe: "accepts",
  },
  { name: "JPEG", bytes: () => fixture("primary.jpg"), primary: SMALL, probe: "accepts" },
  {
    name: "JPEG, EXIF orientation 6",
    bytes: jpegRotated,
    primary: { width: 32, height: 48 },
    probe: "accepts",
  },
  {
    name: "JPEG with a larger EXIF thumbnail",
    bytes: jpegWithExifThumbnail,
    primary: SMALL,
    probe: "accepts",
  },
  {
    name: "JPEG with an MPF preview image",
    bytes: jpegWithMpfPreview,
    primary: SMALL,
    probe: "accepts",
  },
  {
    name: "JPEG, Ultra HDR with a gain map",
    bytes: jpegUltraHdr,
    primary: SMALL,
    probe: "accepts",
  },
  {
    name: "WebP, lossy",
    bytes: () => fixture("primary-lossy.webp"),
    primary: SMALL,
    probe: "accepts",
  },
  {
    name: "WebP, lossless",
    bytes: () => fixture("primary-lossless.webp"),
    primary: SMALL,
    probe: "accepts",
  },
  {
    name: "WebP, EXIF orientation 6",
    bytes: webpRotated,
    primary: { width: 32, height: 48 },
    probe: "accepts",
  },
  { name: "GIF", bytes: () => fixture("primary.gif"), primary: SMALL, probe: "accepts" },
  {
    name: "GIF, frame outside the screen",
    bytes: gifFrameOutsideScreen,
    primary: SMALL,
    probe: "refuses",
  },
  { name: "BMP", bytes: () => fixture("primary.bmp"), primary: SMALL, probe: "accepts" },
  { name: "AVIF", bytes: () => fixture("primary.avif"), primary: SMALL, probe: "accepts" },
  {
    name: "AVIF, irot quarter turn",
    bytes: () => fixture("rotated.avif"),
    primary: { width: 32, height: 48 },
    probe: "accepts",
  },
  {
    name: "AVIF with a thumbnail item",
    bytes: () => fixture("thumbnail.avif"),
    primary: LARGE,
    probe: "accepts",
  },
  { name: "HEIC", bytes: () => fixture("primary.heic"), primary: SMALL, probe: "accepts" },
  {
    name: "HEIC with a thumbnail item",
    bytes: () => fixture("thumbnail.heic"),
    primary: LARGE,
    probe: "accepts",
  },
  // The same oriented files, decoded without their orientation: the engine
  // applies it itself where browsers disagree.
  ...(
    [
      ["PNG, eXIf orientation 6", pngRotated],
      ["JPEG, EXIF orientation 6", jpegRotated],
      ["WebP, EXIF orientation 6", webpRotated],
      ["AVIF, irot quarter turn", () => fixture("rotated.avif")],
    ] as const
  ).map(([name, bytes]) => ({
    name: `${name}, imageOrientation none`,
    bytes,
    primary: SMALL,
    probe: "accepts" as const,
    imageOrientation: "none" as const,
  })),
];

/** The rows of the worker canvas table, in order. */
export const FEATURES = [
  "OffscreenCanvas 2D context",
  "convertToBlob, image/png",
  "convertToBlob, image/jpeg",
  "convertToBlob, image/webp",
  "convertToBlob, image/avif",
  "Display-P3 2D context",
  "Canvas of 4,096 × 4,096 (16.8 MP)",
  "Canvas of 8,192 × 6,144 (50.3 MP)",
  "Longest side of a one-pixel-high canvas",
] as const;

/** The longest side the page's search can report (examples/vite/src/protocol.ts). */
const SEARCH_LIMIT = (1 << 17) - 1;

type Features = NonNullable<Awaited<ReturnType<Window["imageCapabilities"]["features"]>>>;

/** The table's cell for each feature row. */
export function featureCells(features: Features): Record<(typeof FEATURES)[number], string> {
  const encodes = (type: string) => {
    const returned = features.encodes[type] ?? "fails";
    return returned === type ? "encodes" : returned === "fails" ? "fails" : `returns ${returned}`;
  };
  const draws = (key: string) => (features.draws[key] ? "draws" : "doesn't draw");
  return {
    "OffscreenCanvas 2D context": features.offscreen2d ? "available" : "not available",
    "convertToBlob, image/png": encodes("image/png"),
    "convertToBlob, image/jpeg": encodes("image/jpeg"),
    "convertToBlob, image/webp": encodes("image/webp"),
    "convertToBlob, image/avif": encodes("image/avif"),
    "Display-P3 2D context": features.displayP3 ? "available" : "not available",
    "Canvas of 4,096 × 4,096 (16.8 MP)": draws("4096×4096"),
    "Canvas of 8,192 × 6,144 (50.3 MP)": draws("8192×6144"),
    // The search stops one short of 2^17: reaching that means "at least".
    "Longest side of a one-pixel-high canvas": `${features.longestSide >= SEARCH_LIMIT ? "at least " : ""}${features.longestSide.toLocaleString("en-US")} pixels`,
  };
}

/**
 * What a decode means in the table. `decodes` is the primary image, red, at
 * its upright size; anything else decoded says what it was, such as a
 * secondary image or a size without orientation.
 */
export function decodeCell(
  outcome: Awaited<ReturnType<Window["imageCapabilities"]["decode"]>>,
  primary: DecodeCase["primary"],
): string {
  if (outcome.status === "timeout") return "never settles";
  if (outcome.status !== "decoded") return "doesn't decode";
  const [r = 0, g = 0, b = 0] = outcome.centre ?? [];
  const colour =
    outcome.centre === undefined
      ? "unread"
      : r > 160 && g < 96 && b < 96
        ? "red"
        : b > 160 && r < 96
          ? "blue"
          : "other";
  const size = `${outcome.width} × ${outcome.height}`;
  if (outcome.width === primary.width && outcome.height === primary.height && colour === "red") {
    return "decodes";
  }
  return `decodes ${size}, ${colour}`;
}

/** The outcomes in docs/capabilities.md, by row and browser. */
export function readTable(): Map<string, Partial<Record<Browser, string>>> {
  const table = new Map<string, Partial<Record<Browser, string>>>();
  let text = "";
  try {
    text = readFileSync(TABLE, "utf8");
  } catch {
    return table;
  }
  for (const line of text.split("\n")) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (
      cells.length !== 4 ||
      ["File", "Feature"].includes(cells[0] ?? "") ||
      cells[0]?.startsWith("---")
    ) {
      continue;
    }
    const [name, chromium, firefox, webkit] = cells as [string, string, string, string];
    table.set(name, { chromium, firefox, webkit });
  }
  return table;
}
