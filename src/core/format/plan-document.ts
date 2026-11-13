import { ImageError } from "../errors/image-error.js";
import type { ImageBase, ImageDevelop, ImagePlan } from "../model/plan.js";
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
export const IMAGE_PLAN_VERSION = 1;

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
 * which a crop must fit inside, and, once documents travel with their files,
 * its content.
 *
 * @public
 */
export interface ImagePlanDocumentSource extends ImageSize {
  readonly asset?: ImageAssetReference;
}

/**
 * The plan as portable JSON: `hm-image-plan` version 1, which
 * `formats/hm-image-plan/v1.schema.json` describes
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
 *   document doesn't list; and, as for commands, `crop-outside-source`,
 *   `invalid-orientation`, `invalid-output`, `metadata-too-long`,
 *   `unknown-adjustment`, `invalid-level`, `unknown-preset` and
 *   `invalid-strength`.
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
  | "invalid-strength";

const DOCUMENT_FIELDS = ["format", "version", "sources", "base", "output", "metadata"];
const BASE_FIELDS = ["source", "crop", "orientation", "develop", "filter"];
const SOURCE_FIELDS = ["width", "height", "asset"];
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

function readSources(value: unknown): Record<string, ImagePlanDocumentSource> {
  if (!isRecord<Record<string, unknown>>(value)) malformed("sources is an object");
  // Object.fromEntries keeps ids such as __proto__ as own, ordinary keys.
  return Object.fromEntries(
    Object.entries(value).map(([id, source]) => {
      if (id === "") malformed("a source id is a non-empty string");
      if (!isRecord<ImagePlanDocumentSource>(source)) malformed("a source is an object");
      onlyFields(source, SOURCE_FIELDS, "a source");
      for (const name of ["width", "height"]) {
        if (!Object.hasOwn(source, name)) malformed(`a source needs "${name}"`);
      }
      const { width, height } = source;
      if (!isCount(width, 1) || !isCount(height, 1)) {
        malformed("a source's size is whole pixels, at least 1 × 1");
      }
      const entry: ImagePlanDocumentSource =
        source.asset === undefined
          ? { width, height }
          : { width, height, asset: readAsset(source.asset) };
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

function read(value: unknown): {
  plan: ImagePlan;
  sources: Record<string, ImagePlanDocumentSource>;
} {
  if (!isRecord<ImagePlanDocument>(value)) malformed("a document is an object");
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
  if (version !== IMAGE_PLAN_VERSION) malformed("version is 1");
  required(value, DOCUMENT_FIELDS, "a document");
  const sources = readSources(value.sources);
  return {
    plan: {
      base: readBase(value.base, sources),
      output: checkOutput(value.output),
      metadata: checkMetadata(value.metadata),
    },
    sources,
  };
}

/**
 * Reads a plan document, such as one parsed from JSON, checking it as
 * {@link ImagePlanDocument}'s schema does and more: the base's source must
 * be one the document lists, and its crop must fit inside it. Unknown fields
 * are refused, never dropped.
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
 *   written as given.
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
      Object.entries(sources).map(([id, { width, height, asset }]) => [
        id,
        asset === undefined ? { width, height } : { width, height, asset: { ...asset } },
      ]),
    ),
    base: {
      source: base.source,
      crop: base.crop === null ? null : { ...base.crop },
      orientation: { ...base.orientation },
      develop: { ...base.develop },
      filter: base.filter === null ? null : { ...base.filter },
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
