import type { WindowReader } from "@hussmartinez/sdk-core";
import { ImageError } from "../../core/errors/image-error.js";
import { orientedSize } from "../../core/model/geometry.js";
import type { ExifOrientation, ImageFormat, ImageProbe } from "../../core/model/source.js";
import { ascii, exact, invalid, u16be, u32be } from "./bytes.js";
import { emptyExif, readExif } from "./exif.js";

/** The brands an `ftyp` may lead with for the probe to read the file. */
const BRANDS = new Set([
  "avif",
  "avis",
  "avio",
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "mif1",
  "mif2",
  "msf1",
]);
const AVIF_BRANDS = new Set(["avif", "avis", "avio"]);
/** The coded item types a primary item or a tile may have. */
const CODED_TYPES = new Set(["av01", "hvc1"]);
/** The `auxC` types that mark an auxiliary item as an alpha plane. */
const ALPHA_TYPES = new Set([
  "urn:mpeg:mpegB:cicp:systems:auxiliary:alpha",
  "urn:mpeg:hevc:2015:auxid:1",
]);
/** The references the decoder may follow from or to the primary item (ADR 0001). */
const DECODED_REFERENCES = new Set(["dimg", "auxl", "thmb"]);

/** The most top-level boxes a file may have. */
const MAX_TOP_BOXES = 1_024;
/** The largest `meta` box the probe reads into memory. */
const MAX_META = 4 << 20;
/** The most items, references or properties one file may declare. */
const MAX_ITEMS = 4_096;
/** The most tiles one grid may have: each is a separate decode (ADR 0001). */
const MAX_GRID_TILES = 1_024;
/** The largest EXIF item the probe reads. */
const MAX_EXIF = 1 << 20;

/** Whether the first bytes are an `ftyp` box with a brand the probe reads. */
export function isHeif(head: Uint8Array): boolean {
  return ascii(head, 4, 4) === "ftyp" && BRANDS.has(ascii(head, 8, 4));
}

interface Box {
  readonly type: string;
  /** Where the payload starts, after the size and type. */
  readonly start: number;
  readonly end: number;
}

interface Cursor {
  at: number;
  readonly end: number;
  u8(): number;
  u16(): number;
  u32(): number;
  /** An unsigned integer of 0, 4 or 8 bytes, as `iloc` declares. */
  uint(size: number): number;
  fourcc(): string;
  /** A null-terminated string, which must end inside the box. */
  string(): string;
}

function u64(bytes: Uint8Array, at: number): number {
  return u32be(bytes, at) * 2 ** 32 + u32be(bytes, at + 4);
}

function cursor(format: ImageFormat, bytes: Uint8Array, start: number, end: number): Cursor {
  const need = (c: Cursor, length: number) => {
    if (c.at + length > end) {
      throw invalid(format, "a box is shorter than its fields");
    }
  };
  const c: Cursor = {
    at: start,
    end,
    u8() {
      need(c, 1);
      c.at += 1;
      return bytes[c.at - 1] ?? 0;
    },
    u16() {
      need(c, 2);
      c.at += 2;
      return u16be(bytes, c.at - 2);
    },
    u32() {
      need(c, 4);
      c.at += 4;
      return u32be(bytes, c.at - 4);
    },
    uint(size) {
      if (size === 0) return 0;
      if (size === 4) return c.u32();
      if (size === 8) {
        need(c, 8);
        c.at += 8;
        return u64(bytes, c.at - 8);
      }
      throw invalid(format, "a field has an unsupported size");
    },
    fourcc() {
      need(c, 4);
      c.at += 4;
      return ascii(bytes, c.at - 4, 4);
    },
    string() {
      const zero = bytes.subarray(c.at, end).indexOf(0);
      if (zero < 0) {
        throw invalid(format, "a string isn't terminated inside its box");
      }
      const text = ascii(bytes, c.at, zero);
      c.at += zero + 1;
      return text;
    },
  };
  return c;
}

/** Splits `bytes[start, end)` into boxes, each of which must end inside it. */
function boxes(format: ImageFormat, bytes: Uint8Array, start: number, end: number): Box[] {
  const found: Box[] = [];
  let at = start;
  while (at < end) {
    if (found.length >= MAX_ITEMS) {
      throw invalid(format, "a box holds too many boxes");
    }
    if (at + 8 > end) {
      throw invalid(format, "a box header ends past its parent");
    }
    let size = u32be(bytes, at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) {
        throw invalid(format, "a box header ends past its parent");
      }
      size = u64(bytes, at + 8);
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) {
      throw invalid(format, "a box ends past its parent");
    }
    found.push({ type: ascii(bytes, at + 4, 4), start: at + header, end: at + size });
    at += size;
  }
  return found;
}

/** The one child box of a type, or `undefined`; two of them is an error. */
function single(format: ImageFormat, children: readonly Box[], type: string): Box | undefined {
  const matches = children.filter((box) => box.type === type);
  if (matches.length > 1) {
    throw invalid(format, "a box that may appear once appears twice");
  }
  return matches[0];
}

interface Item {
  readonly id: number;
  readonly type: string;
}

interface Reference {
  readonly type: string;
  readonly from: number;
  readonly to: readonly number[];
}

interface Location {
  readonly method: number;
  readonly extents: readonly { readonly offset: number; readonly length: number }[];
}

interface Size {
  readonly width: number;
  readonly height: number;
}

/** The EXIF orientation for each `[a, b, c, d]` matrix acting on (x, y), y pointing down. */
const ORIENTATION_MATRICES: readonly (readonly [ExifOrientation, readonly number[]])[] = [
  [1, [1, 0, 0, 1]],
  [2, [-1, 0, 0, 1]],
  [3, [-1, 0, 0, -1]],
  [4, [1, 0, 0, -1]],
  [5, [0, 1, 1, 0]],
  [6, [0, -1, 1, 0]],
  [7, [0, -1, -1, 0]],
  [8, [0, 1, -1, 0]],
];

function matrixOf(orientation: ExifOrientation): readonly number[] {
  return ORIENTATION_MATRICES.find(([o]) => o === orientation)?.[1] ?? [1, 0, 0, 1];
}

/** Applies `next` after `current`. */
function compose(current: ExifOrientation, next: ExifOrientation): ExifOrientation {
  const [a = 0, b = 0, c = 0, d = 0] = matrixOf(next);
  const [e = 0, f = 0, g = 0, h = 0] = matrixOf(current);
  const product = [a * e + b * g, a * f + b * h, c * e + d * g, c * f + d * h];
  const match = ORIENTATION_MATRICES.find(([, m]) => m.every((v, i) => v === product[i]));
  return match?.[0] ?? 1;
}

/**
 * The size of a `clap` clean aperture: the part of the coded image the
 * decoder returns, as encoders that pad to whole coding blocks declare. Its
 * width and height must be whole pixels, and it must lie inside the coded
 * image, whose `ispe` still bounds the decode.
 */
function cleanAperture(format: ImageFormat, c: Cursor, coded: Size): Size {
  const fraction = (signed: boolean) => {
    const numerator = c.u32();
    const denominator = c.u32();
    if (denominator === 0) {
      throw invalid(format, "a clean aperture divides by zero");
    }
    return (signed ? numerator | 0 : numerator) / denominator;
  };
  const width = fraction(false);
  const height = fraction(false);
  const horizontalOffset = fraction(true);
  const verticalOffset = fraction(true);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw invalid(format, "a clean aperture isn't a whole number of pixels");
  }
  // The aperture is centred on the image's centre plus the offset.
  const left = (coded.width - width) / 2 + horizontalOffset;
  const top = (coded.height - height) / 2 + verticalOffset;
  if (left < 0 || top < 0 || left + width > coded.width || top + height > coded.height) {
    throw invalid(format, "a clean aperture lies outside the image");
  }
  return { width, height };
}

/** `irot` turns anticlockwise in quarter turns. */
const ROTATIONS: readonly ExifOrientation[] = [1, 8, 3, 6];

/**
 * Probes an AVIF or HEIF file from its `meta` box (ADR 0001). The size is the
 * primary item's `ispe`, cropped by its `clap` clean aperture, then turned by
 * its `irot` and `imir` in the order `ipma` lists them. The decoded bound is the sum of the `ispe` pixels of the
 * primary and every item a `dimg`, `auxl` or `thmb` reference reaches from
 * or to it, such as grid tiles, alpha planes, gain maps and thumbnails. A
 * grid's output must equal its `ispe` and fit its tiles, which must all be
 * the same size and number at most 1,024. Reference cycles, references to
 * items without an `ispe`, and extents outside the file are errors. Image
 * sequences, whose frames the decoder sizes from the track rather than an
 * item, are refused. Coded data is never read.
 *
 * @internal
 */
export async function probeHeif(reader: WindowReader): Promise<ImageProbe> {
  const ftypHeader = await exact(reader, "heif", 0, 8, "the ftyp box");
  const ftypSize = u32be(ftypHeader, 0);
  if (ftypSize < 16 || ftypSize > 4096) {
    throw invalid("heif", "the ftyp box has an invalid size");
  }
  const ftyp = await exact(reader, "heif", 8, ftypSize - 8, "the ftyp box");
  const brands = [ascii(ftyp, 0, 4)];
  for (let at = 8; at + 4 <= ftyp.length; at += 4) brands.push(ascii(ftyp, at, 4));
  const format: ImageFormat = brands.some((brand) => AVIF_BRANDS.has(brand)) ? "avif" : "heif";

  // Walk the top-level boxes for `meta`, and refuse sequences.
  let meta: { start: number; end: number } | undefined;
  let offset = ftypSize;
  for (let count = 0; offset < reader.size; count += 1) {
    if (count >= MAX_TOP_BOXES) {
      throw invalid(format, "the file has too many boxes");
    }
    const header = await exact(reader, format, offset, 8, "a box header");
    let size = u32be(header, 0);
    let headerSize = 8;
    if (size === 1) {
      size = u64(await exact(reader, format, offset + 8, 8, "a box header"), 0);
      headerSize = 16;
    } else if (size === 0) {
      size = reader.size - offset;
    }
    if (size < headerSize || offset + size > reader.size) {
      throw invalid(format, "a box ends past the end of the file");
    }
    const type = ascii(header, 4, 4);
    if (type === "moov") {
      throw new ImageError("UNSUPPORTED_FORMAT", `Image sequences in ${format} aren't supported.`, {
        details: { format },
      });
    }
    if (type === "meta") {
      if (meta !== undefined) {
        throw invalid(format, "there are two meta boxes");
      }
      meta = { start: offset + headerSize, end: offset + size };
    }
    offset += size;
  }
  if (meta === undefined) {
    throw invalid(format, "there's no meta box");
  }
  if (meta.end - meta.start > MAX_META) {
    throw invalid(format, "the meta box is too large");
  }
  const bytes = await exact(reader, format, meta.start, meta.end - meta.start, "the meta box");
  const children = boxes(format, bytes, 4, bytes.length);

  const hdlr = single(format, children, "hdlr");
  const hdlrCursor = hdlr && cursor(format, bytes, hdlr.start + 8, hdlr.end);
  if (hdlrCursor === undefined || hdlrCursor.fourcc() !== "pict") {
    throw invalid(format, "the meta box isn't for a picture");
  }

  const pitm = single(format, children, "pitm");
  if (pitm === undefined) {
    throw invalid(format, "there's no primary item");
  }
  const pitmCursor = cursor(format, bytes, pitm.start, pitm.end);
  const pitmVersion = pitmCursor.u8();
  pitmCursor.at += 3;
  const primaryId = pitmVersion === 0 ? pitmCursor.u16() : pitmCursor.u32();

  // Items.
  const items = new Map<number, Item>();
  const iinf = single(format, children, "iinf");
  if (iinf === undefined) {
    throw invalid(format, "there's no item information");
  }
  const iinfCursor = cursor(format, bytes, iinf.start, iinf.end);
  const iinfVersion = iinfCursor.u8();
  iinfCursor.at += 3;
  const declaredItems = iinfVersion === 0 ? iinfCursor.u16() : iinfCursor.u32();
  const infes = boxes(format, bytes, iinfCursor.at, iinf.end).filter((box) => box.type === "infe");
  if (infes.length !== declaredItems) {
    throw invalid(format, "the item count doesn't match the item entries");
  }
  for (const infe of infes) {
    const c = cursor(format, bytes, infe.start, infe.end);
    const version = c.u8();
    c.at += 3;
    let item: Item;
    if (version < 2) {
      item = { id: c.u16(), type: "" };
    } else {
      const id = version === 2 ? c.u16() : c.u32();
      c.u16();
      item = { id, type: c.fourcc() };
    }
    if (items.has(item.id)) {
      throw invalid(format, "two items share an ID");
    }
    items.set(item.id, item);
  }
  const primary = items.get(primaryId);
  if (primary === undefined) {
    throw invalid(format, "the primary item isn't declared");
  }
  if (primary.type !== "grid" && !CODED_TYPES.has(primary.type)) {
    throw new ImageError(
      "UNSUPPORTED_FORMAT",
      `The ${format} file's primary image type isn't supported.`,
      {
        details: { format },
      },
    );
  }

  // References.
  const references: Reference[] = [];
  const iref = single(format, children, "iref");
  if (iref !== undefined) {
    const version = bytes[iref.start] ?? 0;
    for (const box of boxes(format, bytes, iref.start + 4, iref.end)) {
      const c = cursor(format, bytes, box.start, box.end);
      const from = version === 0 ? c.u16() : c.u32();
      const count = c.u16();
      const to: number[] = [];
      for (let i = 0; i < count; i += 1) to.push(version === 0 ? c.u16() : c.u32());
      references.push({ type: box.type, from, to });
    }
  }

  // Properties and their associations.
  const iprp = single(format, children, "iprp");
  if (iprp === undefined) {
    throw invalid(format, "there are no item properties");
  }
  const iprpChildren = boxes(format, bytes, iprp.start, iprp.end);
  const ipco = single(format, iprpChildren, "ipco");
  if (ipco === undefined) {
    throw invalid(format, "there's no property container");
  }
  const properties = boxes(format, bytes, ipco.start, ipco.end);
  const associations = new Map<number, Box[]>();
  for (const ipma of iprpChildren.filter((box) => box.type === "ipma")) {
    const c = cursor(format, bytes, ipma.start, ipma.end);
    const version = c.u8();
    c.u16();
    const wide = (c.u8() & 1) === 1;
    const entries = c.u32();
    if (entries > MAX_ITEMS) {
      throw invalid(format, "too many property associations");
    }
    for (let i = 0; i < entries; i += 1) {
      const id = version < 1 ? c.u16() : c.u32();
      if (associations.has(id)) {
        throw invalid(format, "an item's properties are associated twice");
      }
      const list: Box[] = [];
      const count = c.u8();
      for (let j = 0; j < count; j += 1) {
        const index = wide ? c.u16() & 0x7fff : c.u8() & 0x7f;
        if (index === 0) continue;
        const property = properties[index - 1];
        if (property === undefined) {
          throw invalid(format, "an item refers to a property that doesn't exist");
        }
        list.push(property);
      }
      associations.set(id, list);
    }
  }
  const propertiesOf = (id: number, type: string) =>
    (associations.get(id) ?? []).filter((box) => box.type === type);
  const sizeOf = (id: number): Size => {
    const ispes = propertiesOf(id, "ispe");
    const ispe = ispes[0];
    if (ispe === undefined || ispes.length > 1) {
      throw invalid(format, "an image item has no single ispe");
    }
    const c = cursor(format, bytes, ispe.start + 4, ispe.end);
    const size = { width: c.u32(), height: c.u32() };
    if (size.width < 1 || size.height < 1) {
      throw invalid(format, "an image item has no pixels");
    }
    return size;
  };

  // Item locations, checked against the file and `idat`.
  const idat = single(format, children, "idat");
  const locations = new Map<number, Location>();
  const iloc = single(format, children, "iloc");
  if (iloc !== undefined) {
    const c = cursor(format, bytes, iloc.start, iloc.end);
    const version = c.u8();
    c.at += 3;
    if (version > 2) {
      throw invalid(format, "the item location version is unknown");
    }
    const sizes = c.u8();
    const more = c.u8();
    const offsetSize = sizes >>> 4;
    const lengthSize = sizes & 0x0f;
    const baseSize = more >>> 4;
    const indexSize = version === 0 ? 0 : more & 0x0f;
    const count = version < 2 ? c.u16() : c.u32();
    if (count > MAX_ITEMS) {
      throw invalid(format, "too many item locations");
    }
    for (let i = 0; i < count; i += 1) {
      const id = version < 2 ? c.u16() : c.u32();
      const method = version === 0 ? 0 : c.u16() & 0x0f;
      c.u16();
      const base = c.uint(baseSize);
      const extentCount = c.u16();
      const extents: { offset: number; length: number }[] = [];
      for (let j = 0; j < extentCount; j += 1) {
        c.uint(indexSize);
        const extentOffset = base + c.uint(offsetSize);
        const length = c.uint(lengthSize);
        const limit =
          method === 0
            ? reader.size
            : method === 1
              ? (idat?.end ?? 0) - (idat?.start ?? 0)
              : Infinity;
        const resolved = length === 0 ? limit - extentOffset : length;
        if (extentOffset + resolved > limit || resolved < 0) {
          throw invalid(format, "an item's data lies outside the file");
        }
        extents.push({ offset: extentOffset, length: resolved });
      }
      if (locations.has(id)) {
        throw invalid(format, "an item is located twice");
      }
      locations.set(id, { method, extents });
    }
  }
  const dataOf = async (id: number, max: number): Promise<Uint8Array> => {
    const location = locations.get(id);
    if (location === undefined) {
      throw invalid(format, "an item's data has no location");
    }
    const total = location.extents.reduce((sum, extent) => sum + extent.length, 0);
    if (total > max) {
      throw invalid(format, "an item's data is too large");
    }
    const parts: Uint8Array[] = [];
    for (const extent of location.extents) {
      if (location.method === 0) {
        parts.push(await reader.bytes(extent.offset, extent.length));
      } else if (location.method === 1 && idat !== undefined) {
        const at = idat.start + extent.offset;
        parts.push(bytes.subarray(at, at + extent.length));
      } else {
        throw invalid(format, "an item's data is stored in a way the probe doesn't read");
      }
    }
    const data = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      data.set(part, at);
      at += part.length;
    }
    return data;
  };

  // Every item the decoder may decode with the primary.
  const decoded = references.filter((reference) => DECODED_REFERENCES.has(reference.type));
  const reached = new Set([primaryId]);
  for (let queue = [primaryId]; queue.length > 0; ) {
    const id = queue.pop() ?? primaryId;
    for (const reference of decoded) {
      const linked =
        reference.from === id ? reference.to : reference.to.includes(id) ? [reference.from] : [];
      for (const next of linked) {
        if (!items.has(next)) {
          throw invalid(format, "a reference names an item that isn't declared");
        }
        if (!reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
    }
  }
  // A cycle among them leaves items with references into it.
  const incoming = new Map([...reached].map((id) => [id, 0]));
  const edges = decoded.filter((reference) => reached.has(reference.from));
  for (const reference of edges) {
    for (const to of reference.to) incoming.set(to, (incoming.get(to) ?? 0) + 1);
  }
  const ready = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
  let removed = 0;
  while (ready.length > 0) {
    const id = ready.pop() ?? 0;
    removed += 1;
    for (const reference of edges) {
      if (reference.from !== id) continue;
      for (const to of reference.to) {
        const left = (incoming.get(to) ?? 0) - 1;
        incoming.set(to, left);
        if (left === 0) ready.push(to);
      }
    }
  }
  if (removed !== reached.size) {
    throw invalid(format, "item references form a cycle");
  }

  let decodedPixelBound = 0;
  for (const id of reached) {
    const size = sizeOf(id);
    decodedPixelBound += size.width * size.height;
    if (items.get(id)?.type === "grid") {
      await checkGrid(id, size);
    }
  }

  async function checkGrid(id: number, output: Size): Promise<void> {
    const dimgs = references.filter(
      (reference) => reference.type === "dimg" && reference.from === id,
    );
    const tiles = dimgs[0]?.to ?? [];
    if (dimgs.length !== 1 || tiles.length === 0) {
      throw invalid(format, "a grid doesn't name its tiles once");
    }
    if (tiles.length > MAX_GRID_TILES) {
      throw invalid(format, "a grid has too many tiles");
    }
    const data = await dataOf(id, 64);
    const c = cursor(format, data, 0, data.length);
    if (c.u8() !== 0) {
      throw invalid(format, "the grid version is unknown");
    }
    const wide = (c.u8() & 1) === 1;
    const rows = c.u8() + 1;
    const columns = c.u8() + 1;
    const declared = wide
      ? { width: c.u32(), height: c.u32() }
      : { width: c.u16(), height: c.u16() };
    if (rows * columns !== tiles.length) {
      throw invalid(format, "a grid's tile count doesn't match its rows and columns");
    }
    if (declared.width !== output.width || declared.height !== output.height) {
      throw invalid(format, "a grid's output differs from its ispe");
    }
    let tile: Size | undefined;
    for (const tileId of tiles) {
      if (!CODED_TYPES.has(items.get(tileId)?.type ?? "")) {
        throw invalid(format, "a grid tile isn't a coded image");
      }
      const size = sizeOf(tileId);
      if (tile !== undefined && (size.width !== tile.width || size.height !== tile.height)) {
        throw invalid(format, "a grid's tiles differ in size");
      }
      tile = size;
    }
    if (
      tile === undefined ||
      output.width > columns * tile.width ||
      output.height > rows * tile.height
    ) {
      throw invalid(format, "a grid's output doesn't fit its tiles");
    }
  }

  // The clean aperture, then the orientation, in the order the primary's
  // properties are listed; the specification puts `clap` first.
  const coded = sizeOf(primaryId);
  let stored: Size = coded;
  let orientation: ExifOrientation = 1;
  let transformed = false;
  for (const property of associations.get(primaryId) ?? []) {
    if (property.type === "clap") {
      if (transformed || stored !== coded) {
        throw invalid(format, "a clean aperture follows a transformation");
      }
      stored = cleanAperture(format, cursor(format, bytes, property.start, property.end), coded);
    } else if (property.type === "irot") {
      transformed = true;
      const c = cursor(format, bytes, property.start, property.end);
      orientation = compose(orientation, ROTATIONS[c.u8() & 0x03] ?? 1);
    } else if (property.type === "imir") {
      transformed = true;
      const c = cursor(format, bytes, property.start, property.end);
      // Axis 0 mirrors top to bottom and axis 1 left to right, as libavif
      // writes them and every engine in docs/capabilities.md decodes them.
      orientation = compose(orientation, (c.u8() & 0x01) === 0 ? 4 : 2);
    }
  }

  // Alpha, profile, thumbnails and metadata.
  const linkedToPrimary = (type: string) =>
    references.filter((reference) => reference.type === type && reference.to.includes(primaryId));
  const hasAlpha = linkedToPrimary("auxl").some((reference) =>
    propertiesOf(reference.from, "auxC").some((auxC) => {
      const c = cursor(format, bytes, auxC.start + 4, auxC.end);
      return ALPHA_TYPES.has(c.string());
    }),
  );
  const colourProfile = propertiesOf(primaryId, "colr").some((colr) => {
    const type = cursor(format, bytes, colr.start, colr.end).fourcc();
    return type === "prof" || type === "rICC";
  });
  const exif = emptyExif();
  const exifItem = [...items.values()].find((item) => item.type === "Exif");
  if (exifItem !== undefined) {
    const data = await dataOf(exifItem.id, MAX_EXIF);
    if (data.length < 4 || 4 + u32be(data, 0) > data.length) {
      throw invalid(format, "the EXIF item's header offset is out of range");
    }
    Object.assign(exif, readExif(data.subarray(4 + u32be(data, 0)), format));
  }
  const other =
    exif.other || [...items.values()].some((item) => item.type === "mime" || item.type === "uri ");

  return {
    format,
    stored,
    oriented: orientedSize(stored, orientation),
    orientation,
    frames: 1,
    hasAlpha,
    decodedPixelBound,
    metadata: {
      location: exif.location,
      camera: exif.camera,
      timestamps: exif.timestamps,
      thumbnail: exif.thumbnail || linkedToPrimary("thmb").length > 0,
      colourProfile,
      other,
    },
    keepable: {
      title: exif.title,
      description: exif.description,
      artist: exif.artist,
      copyright: exif.copyright,
    },
  };
}
