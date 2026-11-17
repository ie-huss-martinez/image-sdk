import { ImageError } from "../errors/image-error.js";
import type { ImageAnimation, ImageLayer } from "../model/plan.js";
import {
  type ImageBase,
  type ImageDevelop,
  type ImagePlan,
  type ImageRedaction,
  MAX_ANIMATION_FRAMES,
  MAX_PLAN_ITEMS,
} from "../model/plan.js";
import type { ImageSize } from "../model/source.js";
import {
  checkCrop,
  checkCropInSource,
  checkDevelop,
  checkFilter,
  checkMetadata,
  checkOrientation,
  checkOutput,
  Invalid,
  invalid,
  isRecord,
  onlyFields,
} from "../operations/commands.js";
import { checkAnimation } from "../operations/frames.js";
import { checkLayer } from "../operations/layers.js";
import { checkRedaction } from "../operations/redactions.js";

/**
 * The name of the plan's portable format (sdk-core ADR 0045).
 *
 * @public
 */
export const IMAGE_PLAN_FORMAT = "hm-image-plan";

/**
 * The version of {@link IMAGE_PLAN_FORMAT} this release writes, and the
 * latest it reads.
 *
 * @public
 */
export const IMAGE_PLAN_VERSION = 4;

/**
 * A content-addressed reference to binary data, such as a source's file
 * (sdk-core ADR 0045). Documents never inline bytes.
 *
 * @public
 */
export interface ImageAssetReference {
  /** `sha256:` and the lowercase hex SHA-256 of the bytes. */
  readonly asset: string;
  /** The bytes' media type, such as `image/jpeg`, in lowercase. */
  readonly mediaType: string;
  /** The size of the bytes. */
  readonly size: number;
}

/**
 * A source, as a plan document records it: its oriented size in pixels,
 * which a crop must fit inside; how many frames it has, which an
 * animation's frames must be among; and, once documents travel with their
 * files, its content.
 *
 * @public
 */
export interface ImagePlanDocumentSource extends ImageSize {
  /** 1 for a still. A document from before version 4 reads as 1. */
  readonly frames: number;
  readonly asset?: ImageAssetReference;
}

/**
 * The plan as portable JSON: `hm-image-plan` version 4, which
 * `formats/hm-image-plan/v4.schema.json` describes
 * (docs/formats/hm-image-plan.md). Positions are whole pixels of the
 * oriented source, and the base names its source by an id the document
 * lists.
 *
 * @public
 */
export interface ImagePlanDocument extends ImagePlan {
  readonly format: typeof IMAGE_PLAN_FORMAT;
  readonly version: typeof IMAGE_PLAN_VERSION;
  readonly sources: Readonly<Record<string, ImagePlanDocumentSource>>;
}

/**
 * Why a plan document was refused, as a stable token: `details.reason` on
 * the error (sdk-core ADR 0045).
 *
 * - With `UNSUPPORTED_FORMAT`: `unknown-format`, a document of another
 *   format, and `unknown-format-version`, a later version than this release
 *   reads.
 * - With `INVALID_DOCUMENT`: `malformed-document`, a document that isn't
 *   shaped as the schema says; `unknown-source`, a base whose source the
 *   document doesn't list; `duplicate-key`, a key two items share; and, as
 *   for commands, `crop-outside-source`, `invalid-orientation`,
 *   `invalid-output`, `metadata-too-long`, `unknown-adjustment`,
 *   `invalid-level`, `unknown-preset`, `invalid-strength`, `invalid-key`,
 *   `unknown-redaction-mode`, `invalid-region`, `invalid-colour`,
 *   `unknown-layer-kind`, `invalid-box`, `invalid-opacity`, `invalid-text`,
 *   `text-too-long`, `empty-shape`, `empty-drawing`, `empty-arrow`,
 *   `invalid-points`, `too-many-layers`, `invalid-frame`, `invalid-delay`
 *   and `invalid-loop`. `unknown-source` and
 *   `crop-outside-source` apply to an image layer too. A drawing or an
 *   arrow in a document of version 2, which has neither, is
 *   `unknown-layer-kind`. An animation over a source with one frame is
 *   `not-animated`.
 *
 * @public
 */
export type ImageDocumentRejection =
  | "unknown-format"
  | "unknown-format-version"
  | "malformed-document"
  | "unknown-source"
  | "crop-outside-source"
  | "invalid-orientation"
  | "invalid-output"
  | "metadata-too-long"
  | "unknown-adjustment"
  | "invalid-level"
  | "unknown-preset"
  | "invalid-strength"
  | "duplicate-key"
  | "invalid-key"
  | "unknown-redaction-mode"
  | "invalid-region"
  | "invalid-colour"
  | "unknown-layer-kind"
  | "invalid-box"
  | "invalid-opacity"
  | "invalid-text"
  | "text-too-long"
  | "empty-shape"
  | "empty-drawing"
  | "empty-arrow"
  | "invalid-points"
  | "too-many-layers"
  | "not-animated"
  | "invalid-frame"
  | "invalid-delay"
  | "invalid-loop";

/** Version 1's fields: the plan before layers, redactions and animation. */
const V1_FIELDS = ["format", "version", "sources", "base", "output", "metadata"];
const DOCUMENT_FIELDS = [
  "format",
  "version",
  "sources",
  "base",
  "layers",
  "redactions",
  "animation",
  "output",
  "metadata",
];
const BASE_FIELDS = ["source", "crop", "orientation", "develop", "filter"];
/** A source's fields before version 4, and from it: it gained its frame count. */
const SOURCE_FIELDS_V3 = ["width", "height", "asset"];
const SOURCE_FIELDS = ["width", "height", "frames", "asset"];
const ASSET_FIELDS = ["asset", "mediaType", "size"];
/** The patterns the schema uses too, so both accept the same documents. */
const ASSET_ID = /^sha256:[0-9a-f]{64}$/;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

function malformed(message: string): never {
  return invalid("malformed-command", message);
}

const isCount = (value: unknown, min: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min;

function required(value: object, fields: readonly string[], what: string): void {
  onlyFields(value, fields, what);
  for (const name of fields) {
    if (!Object.hasOwn(value, name)) malformed(`${what} needs "${name}"`);
  }
}

function readAsset(value: unknown): ImageAssetReference {
  if (!isRecord<ImageAssetReference>(value)) malformed("an asset is an object");
  required(value, ASSET_FIELDS, "an asset");
  const { asset, mediaType, size } = value;
  if (typeof asset !== "string" || !ASSET_ID.test(asset)) malformed("an asset id is sha256:<hex>");
  if (typeof mediaType !== "string" || mediaType.length > 255 || !MEDIA_TYPE.test(mediaType)) {
    malformed("a media type is type/subtype, in lowercase");
  }
  if (!isCount(size, 0)) malformed("an asset's size is a whole number of bytes");
  return { asset, mediaType, size };
}

function readSources(value: unknown, counted: boolean): Record<string, ImagePlanDocumentSource> {
  if (!isRecord<Record<string, unknown>>(value)) malformed("sources is an object");
  // Object.fromEntries keeps ids such as __proto__ as own, ordinary keys.
  return Object.fromEntries(
    Object.entries(value).map(([id, source]) => {
      if (id === "") malformed("a source id is a non-empty string");
      if (!isRecord<ImagePlanDocumentSource>(source)) malformed("a source is an object");
      // A source has its own version's fields: a frame count before version 4 is refused.
      onlyFields(source, counted ? SOURCE_FIELDS : SOURCE_FIELDS_V3, "a source");
      for (const name of counted ? ["width", "height", "frames"] : ["width", "height"]) {
        if (!Object.hasOwn(source, name)) malformed(`a source needs "${name}"`);
      }
      const { width, height } = source;
      if (!isCount(width, 1) || !isCount(height, 1)) {
        malformed("a source's size is whole pixels, at least 1 × 1");
      }
      // Before version 4 every source was a still (docs/adr/0011).
      const frames = counted ? source.frames : 1;
      if (!isCount(frames, 1) || frames > MAX_ANIMATION_FRAMES) {
        malformed(`a source has 1 to ${MAX_ANIMATION_FRAMES} frames`);
      }
      const entry: ImagePlanDocumentSource =
        source.asset === undefined
          ? { width, height, frames }
          : { width, height, frames, asset: readAsset(source.asset) };
      return [id, entry];
    }),
  );
}

function readBase(value: unknown, sources: Record<string, ImagePlanDocumentSource>): ImageBase {
  if (!isRecord<ImageBase>(value)) malformed("base is an object");
  required(value, BASE_FIELDS, "base");
  const { source } = value;
  if (typeof source !== "string" || source === "") malformed("base.source is a source id");
  const size = Object.hasOwn(sources, source) ? sources[source] : undefined;
  if (size === undefined) invalid("unknown-source", `the document doesn't list source ${source}`);
  const crop = value.crop === null ? null : checkCrop(value.crop);
  if (crop !== null) checkCropInSource(crop, size);
  return {
    source,
    crop,
    orientation: checkOrientation(value.orientation),
    develop: checkDevelop(value.develop, true) as ImageDevelop,
    filter: checkFilter(value.filter),
  };
}

/** A document's fields, before any is checked. */
type RawDocument = { readonly [Field in keyof ImagePlanDocument]?: unknown };

/**
 * Version 1 as version 2: a plan with no layers, no redactions and no
 * animation (ADR 0009). It's checked as version 1 first, so a version 1
 * document with a later version's field is refused, not migrated.
 */
function migrateFromV1(value: RawDocument): RawDocument {
  required(value, V1_FIELDS, "a document");
  return { ...value, version: 2, layers: [], redactions: [], animation: null };
}

function readLayers(
  value: unknown,
  sources: Record<string, ImagePlanDocumentSource>,
  version: 2 | 3,
): ImageLayer[] {
  if (!Array.isArray(value)) malformed("layers is a list");
  if (value.length > MAX_PLAN_ITEMS) malformed(`a document holds at most ${MAX_PLAN_ITEMS} layers`);
  // An image layer's source is one the document lists, as the base's is.
  const sourceSize = (id: string) => (Object.hasOwn(sources, id) ? sources[id] : undefined);
  // A document has its own version's kinds: a drawing in version 2 is refused, not read.
  return value.map((layer) => checkLayer(layer, sourceSize, version));
}

function readRedactions(value: unknown): ImageRedaction[] {
  if (!Array.isArray(value)) malformed("redactions is a list");
  if (value.length > MAX_PLAN_ITEMS) {
    malformed(`a document holds at most ${MAX_PLAN_ITEMS} redactions`);
  }
  return value.map(checkRedaction);
}

/**
 * What depends on every list: no key twice, among layers, redactions and
 * frames, and no more layers and redactions than the format holds.
 */
function checkItems(
  layers: readonly ImageLayer[],
  redactions: readonly ImageRedaction[],
  animation: ImageAnimation | null,
): void {
  const keys = new Set<string>();
  for (const { key } of [...layers, ...redactions, ...(animation?.frames ?? [])]) {
    if (keys.has(key)) invalid("duplicate-key", `two items have the key "${key}"`);
    keys.add(key);
  }
  if (layers.length + redactions.length > MAX_PLAN_ITEMS) {
    invalid(
      "too-many-layers",
      `a document holds at most ${MAX_PLAN_ITEMS} layers and redactions together`,
    );
  }
}

function read(value: unknown): {
  plan: ImagePlan;
  sources: Record<string, ImagePlanDocumentSource>;
} {
  if (!isRecord<RawDocument>(value)) malformed("a document is an object");
  const { format, version } = value;
  if (typeof format !== "string") malformed("format is text");
  if (format !== IMAGE_PLAN_FORMAT) {
    throw new ImageError("UNSUPPORTED_FORMAT", `This isn't an ${IMAGE_PLAN_FORMAT} document.`, {
      details: { format: IMAGE_PLAN_FORMAT, reason: "unknown-format" },
    });
  }
  if (Number.isSafeInteger(version) && (version as number) > IMAGE_PLAN_VERSION) {
    throw new ImageError(
      "UNSUPPORTED_FORMAT",
      `This ${IMAGE_PLAN_FORMAT} document is a later version than this release reads.`,
      { details: { format: IMAGE_PLAN_FORMAT, reason: "unknown-format-version" } },
    );
  }
  if (version !== 1 && version !== 2 && version !== 3 && version !== IMAGE_PLAN_VERSION) {
    malformed("version is 1, 2, 3 or 4");
  }
  // Each version is read with what it had (ADR 0009): version 2 with its
  // layer kinds, and a version before 4 with no animation and no frame
  // counts, so it can't hold a later version's.
  const document = version === 1 ? migrateFromV1(value) : value;
  required(document, DOCUMENT_FIELDS, "a document");
  const { layers, redactions } = document;
  const animated = version === IMAGE_PLAN_VERSION;
  const sources = readSources(document.sources, animated);
  const base = readBase(document.base, sources);
  let animation: ImageAnimation | null = null;
  if (document.animation !== null) {
    if (!animated) malformed("animation is null before version 4");
    // Its frames are frames of the base's source, which readBase found.
    animation = checkAnimation(document.animation, sources[base.source]?.frames ?? 1);
  }
  const readLayerList = readLayers(layers, sources, version === 2 ? 2 : 3);
  const readRedactionList = readRedactions(redactions);
  checkItems(readLayerList, readRedactionList, animation);
  return {
    plan: {
      base,
      layers: readLayerList,
      redactions: readRedactionList,
      animation,
      output: checkOutput(document.output),
      metadata: checkMetadata(document.metadata),
    },
    sources,
  };
}

/**
 * Reads a plan document, such as one parsed from JSON, checking it as
 * {@link ImagePlanDocument}'s schema does and more: the base's source must
 * be one the document lists, as must an image layer's, their crops must fit
 * inside them, and no two items share a key. Unknown fields are refused, never dropped.
 *
 * A document of an earlier version is migrated, so every version stays
 * readable: version 1 reads as a plan with no layers or redactions, version
 * 2 as it is, with the kinds of layer it had, and version 3 as a still,
 * each of its sources with one frame.
 *
 * @param value - The parsed JSON.
 * @returns The plan, and its sources by id.
 * @throws `ImageError` with `UNSUPPORTED_FORMAT` for another format or a
 *   later version, and `INVALID_DOCUMENT` for anything else that's wrong,
 *   with an {@link ImageDocumentRejection} as `details.reason`.
 * @public
 */
export function readImagePlanDocument(value: unknown): {
  readonly plan: ImagePlan;
  readonly sources: Readonly<Record<string, ImagePlanDocumentSource>>;
} {
  try {
    return read(value);
  } catch (error) {
    if (!(error instanceof Invalid)) throw error;
    const reason = error.reason === "malformed-command" ? "malformed-document" : error.reason;
    throw new ImageError(
      "INVALID_DOCUMENT",
      `Invalid ${IMAGE_PLAN_FORMAT} document: ${error.message}.`,
      { details: { format: IMAGE_PLAN_FORMAT, reason } },
    );
  }
}

/**
 * Writes a plan as an {@link ImagePlanDocument}, plain JSON-ready data.
 *
 * @param plan - The plan.
 * @param sources - The sources by id, with at least the base's. They're
 *   written as given: each with its size and its frame count, 1 for a
 *   still.
 * @throws `TypeError` if the base's source is missing from `sources`.
 * @public
 */
export function toImagePlanDocument(
  plan: ImagePlan,
  sources: Readonly<Record<string, ImagePlanDocumentSource>>,
): ImagePlanDocument {
  const { base, output, metadata } = plan;
  if (!Object.hasOwn(sources, base.source)) {
    throw new TypeError(`The sources don't include ${base.source}, which the base uses.`);
  }
  return {
    format: IMAGE_PLAN_FORMAT,
    version: IMAGE_PLAN_VERSION,
    sources: Object.fromEntries(
      Object.entries(sources).map(([id, { width, height, frames, asset }]) => [
        id,
        asset === undefined
          ? { width, height, frames }
          : { width, height, frames, asset: { ...asset } },
      ]),
    ),
    base: {
      source: base.source,
      crop: base.crop === null ? null : { ...base.crop },
      orientation: { ...base.orientation },
      develop: { ...base.develop },
      filter: base.filter === null ? null : { ...base.filter },
    },
    layers: plan.layers.map((layer) => structuredClone(layer)),
    redactions: plan.redactions.map((redaction) => ({ ...redaction })),
    animation:
      plan.animation === null
        ? null
        : {
            loop: plan.animation.loop,
            frames: plan.animation.frames.map((frame) => ({ ...frame })),
          },
    output: { ...output },
    metadata: {
      title: metadata.title,
      description: metadata.description,
      artist: metadata.artist,
      copyright: metadata.copyright,
    },
  };
}
