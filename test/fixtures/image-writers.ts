/**
 * Writers for the generated fixtures the probes are tested on: headers
 * written by hand, never real photos (ADR 0001, CONTRIBUTING.md).
 */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function be32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function be16(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

const latin1 = (text: string) => Array.from(text, (c) => c.charCodeAt(0) & 0xff);

export function concat(parts: readonly (readonly number[] | Uint8Array)[]): Uint8Array {
  return Uint8Array.from(parts.flatMap((part) => Array.from(part)));
}

export function pngChunk(type: string, data: readonly number[] | Uint8Array = []): Uint8Array {
  const typed = concat([latin1(type), data]);
  return concat([be32(data.length), typed, be32(crc32(typed))]);
}

export interface PngSpec {
  width: number;
  height: number;
  colourType?: number;
  /** Frames for APNG: each `{ width, height, x, y }`. */
  frames?: readonly { width: number; height: number; x?: number; y?: number }[];
  /** What `acTL` declares; defaults to the number of frames. */
  declaredFrames?: number;
  exif?: Uint8Array;
  text?: Record<string, string>;
  extraChunks?: readonly Uint8Array[];
}

export function png(spec: PngSpec): Uint8Array {
  const ihdr = pngChunk("IHDR", [
    ...be32(spec.width),
    ...be32(spec.height),
    8,
    spec.colourType ?? 2,
    0,
    0,
    0,
  ]);
  const chunks: Uint8Array[] = [ihdr];
  if (spec.frames !== undefined) {
    chunks.push(pngChunk("acTL", [...be32(spec.declaredFrames ?? spec.frames.length), ...be32(0)]));
  }
  if (spec.exif !== undefined) chunks.push(pngChunk("eXIf", spec.exif));
  for (const [keyword, value] of Object.entries(spec.text ?? {})) {
    chunks.push(pngChunk("tEXt", [...latin1(keyword), 0, ...latin1(value)]));
  }
  chunks.push(...(spec.extraChunks ?? []));
  (spec.frames ?? [undefined]).forEach((frame, index) => {
    if (frame !== undefined) {
      chunks.push(
        pngChunk("fcTL", [
          ...be32(index),
          ...be32(frame.width),
          ...be32(frame.height),
          ...be32(frame.x ?? 0),
          ...be32(frame.y ?? 0),
          0,
          1,
          0,
          1,
          0,
          0,
        ]),
      );
    }
    chunks.push(pngChunk("IDAT", [0x78, 0x9c, 0x63, 0, 0, 0, 1, 0, 1]));
  });
  chunks.push(pngChunk("IEND"));
  return concat([[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], ...chunks]);
}

export function jpegSegment(marker: number, data: readonly number[] | Uint8Array): Uint8Array {
  return concat([[0xff, marker, ...be16(data.length + 2)], data]);
}

export interface JpegSpec {
  width: number;
  height: number;
  exif?: Uint8Array;
  iccProfile?: boolean;
  /** Segments placed before the frame header, such as APP13. */
  before?: readonly Uint8Array[];
}

export function jpeg(spec: JpegSpec): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.of(0xff, 0xd8)];
  parts.push(jpegSegment(0xe0, [...latin1("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]));
  if (spec.exif !== undefined)
    parts.push(jpegSegment(0xe1, concat([latin1("Exif\0\0"), spec.exif])));
  if (spec.iccProfile) parts.push(jpegSegment(0xe2, [...latin1("ICC_PROFILE\0"), 1, 1, 0, 0]));
  parts.push(...(spec.before ?? []));
  parts.push(
    jpegSegment(0xc0, [
      8,
      ...be16(spec.height),
      ...be16(spec.width),
      3,
      1,
      0x22,
      0,
      2,
      0x11,
      1,
      3,
      0x11,
      1,
    ]),
  );
  parts.push(jpegSegment(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]));
  parts.push(Uint8Array.of(0x12, 0x34, 0x56, 0xff, 0xd9));
  return concat(parts);
}

export interface ExifSpec {
  orientation?: number;
  description?: string;
  artist?: string;
  copyright?: string;
  make?: string;
  dateTime?: string;
  gps?: boolean;
  thumbnail?: boolean;
  /** Windows' XPTitle, UCS-2: the EXIF title the probe reads. */
  xpTitle?: string;
  littleEndian?: boolean;
}

/** A TIFF-structured EXIF block, as in JPEG's APP1 after `Exif\0\0` or PNG's eXIf. */
export function exif(spec: ExifSpec): Uint8Array {
  const le = spec.littleEndian ?? false;
  const u16 = (v: number) => (le ? [v & 0xff, (v >>> 8) & 0xff] : be16(v));
  const u32 = (v: number) =>
    le ? [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff] : be32(v);
  type Entry = { tag: number; type: number; count: number; value: number[] };
  const entries: Entry[] = [];
  const strings: { entry: Entry; bytes: number[] }[] = [];
  const addText = (tag: number, text: string | undefined) => {
    if (text === undefined) return;
    const bytes = [...latin1(text), 0];
    const entry: Entry = { tag, type: 2, count: bytes.length, value: [] };
    entries.push(entry);
    strings.push({ entry, bytes });
  };
  if (spec.xpTitle !== undefined) {
    const bytes = [
      ...Array.from(spec.xpTitle, (c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >>> 8]).flat(),
      0,
      0,
    ];
    const entry: Entry = { tag: 0x9c9b, type: 1, count: bytes.length, value: [] };
    entries.push(entry);
    strings.push({ entry, bytes });
  }
  if (spec.orientation !== undefined)
    entries.push({ tag: 0x0112, type: 3, count: 1, value: [...u16(spec.orientation), 0, 0] });
  addText(0x010e, spec.description);
  addText(0x010f, spec.make);
  addText(0x0132, spec.dateTime);
  addText(0x013b, spec.artist);
  addText(0x8298, spec.copyright);
  const gpsEntry: Entry | undefined = spec.gps
    ? { tag: 0x8825, type: 4, count: 1, value: [] }
    : undefined;
  if (gpsEntry) entries.push(gpsEntry);
  entries.sort((a, b) => a.tag - b.tag);

  const ifd0At = 8;
  const ifd0Size = 2 + entries.length * 12 + 4;
  let cursor = ifd0At + ifd0Size;
  for (const s of strings) {
    if (s.bytes.length <= 4) {
      s.entry.value = [...s.bytes, 0, 0, 0, 0].slice(0, 4);
    } else {
      s.entry.value = u32(cursor);
      cursor += s.bytes.length;
    }
  }
  const gpsAt = cursor;
  if (gpsEntry) {
    gpsEntry.value = u32(gpsAt);
    cursor += 2 + 12 + 4;
  }
  const thumbAt = spec.thumbnail ? cursor : 0;
  const out: number[] = [...(le ? latin1("II") : latin1("MM")), ...u16(42), ...u32(ifd0At)];
  out.push(...u16(entries.length));
  for (const e of entries) out.push(...u16(e.tag), ...u16(e.type), ...u32(e.count), ...e.value);
  out.push(...u32(thumbAt));
  for (const s of strings) if (s.bytes.length > 4) out.push(...s.bytes);
  if (gpsEntry)
    out.push(...u16(1), ...u16(1), ...u16(2), ...u32(2), ...latin1("N\0"), 0, 0, ...u32(0));
  if (spec.thumbnail)
    out.push(...u16(1), ...u16(0x0201), ...u16(4), ...u32(1), ...u32(0), ...u32(0));
  return Uint8Array.from(out);
}

function le16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function le24(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff];
}

function le32(value: number): number[] {
  return [...le16(value & 0xffff), ...le16((value >>> 16) & 0xffff)];
}

export function webpChunk(type: string, data: readonly number[] | Uint8Array = []): Uint8Array {
  return concat([latin1(type), le32(data.length), data, data.length % 2 === 1 ? [0] : []]);
}

/** A VP8 key frame header and a byte of bitstream. */
export function vp8(width: number, height: number): Uint8Array {
  return webpChunk("VP8 ", [0x10, 0x02, 0, 0x9d, 0x01, 0x2a, ...le16(width), ...le16(height), 0]);
}

/** A VP8L header and a byte of bitstream. */
export function vp8l(width: number, height: number, alpha = false): Uint8Array {
  const bits = (width - 1) | ((height - 1) << 14) | (alpha ? 1 << 28 : 0);
  return webpChunk("VP8L", [0x2f, ...le32(bits >>> 0), 0]);
}

export interface WebpSpec {
  /** A simple file: one `VP8 ` or `VP8L` chunk and nothing else. */
  simple?: Uint8Array;
  /** An extended file's canvas. */
  canvas?: { width: number; height: number; alpha?: boolean; animated?: boolean };
  chunks?: readonly Uint8Array[];
}

export function webp(spec: WebpSpec): Uint8Array {
  const chunks: Uint8Array[] = [];
  if (spec.simple !== undefined) chunks.push(spec.simple);
  if (spec.canvas !== undefined) {
    const flags = (spec.canvas.alpha ? 0x10 : 0) | (spec.canvas.animated ? 0x02 : 0);
    chunks.push(
      webpChunk("VP8X", [
        flags,
        0,
        0,
        0,
        ...le24(spec.canvas.width - 1),
        ...le24(spec.canvas.height - 1),
      ]),
    );
  }
  chunks.push(...(spec.chunks ?? []));
  const body = concat([latin1("WEBP"), ...chunks]);
  return concat([latin1("RIFF"), le32(body.length), body]);
}

/** An animation frame wrapping a VP8L bitstream. */
export function anmf(frame: { x?: number; y?: number; width: number; height: number }): Uint8Array {
  return webpChunk(
    "ANMF",
    concat([
      le24((frame.x ?? 0) / 2),
      le24((frame.y ?? 0) / 2),
      le24(frame.width - 1),
      le24(frame.height - 1),
      le24(100),
      [0],
      vp8l(frame.width, frame.height),
    ]),
  );
}

export interface GifSpec {
  width: number;
  height: number;
  frames: readonly { width: number; height: number; x?: number; y?: number }[];
  transparent?: boolean;
  comment?: string;
  /** Overrides each frame's LZW minimum code size. */
  codeSize?: number;
}

export function gif(spec: GifSpec): Uint8Array {
  const parts: (number[] | Uint8Array)[] = [
    latin1("GIF89a"),
    [...le16(spec.width), ...le16(spec.height), 0x80, 0, 0],
    [0, 0, 0, 255, 255, 255],
  ];
  if (spec.frames.length > 1) {
    parts.push([0x21, 0xff, 11, ...latin1("NETSCAPE2.0"), 3, 1, 0, 0, 0]);
  }
  if (spec.comment !== undefined) {
    parts.push([0x21, 0xfe, spec.comment.length, ...latin1(spec.comment), 0]);
  }
  for (const frame of spec.frames) {
    parts.push([0x21, 0xf9, 4, spec.transparent ? 1 : 0, 10, 0, 0, 0]);
    parts.push([
      0x2c,
      ...le16(frame.x ?? 0),
      ...le16(frame.y ?? 0),
      ...le16(frame.width),
      ...le16(frame.height),
      0,
      spec.codeSize ?? 2,
      2,
      0x4c,
      0x01,
      0,
    ]);
  }
  parts.push([0x3b]);
  return concat(parts);
}

export interface BmpSpec {
  width: number;
  /** Negative for top-down rows. */
  height: number;
  bitCount?: number;
  /** 12 for `BITMAPCOREHEADER`, 40 for `BITMAPINFOHEADER`, 124 for V5. */
  headerSize?: number;
  /** Overrides where the pixel data starts. */
  dataOffset?: number;
  embeddedProfile?: boolean;
}

export function bmp(spec: BmpSpec): Uint8Array {
  const headerSize = spec.headerSize ?? 40;
  const bitCount = spec.bitCount ?? 24;
  const header: number[] = [...le32(headerSize)];
  if (headerSize === 12) {
    header.push(...le16(spec.width), ...le16(spec.height), ...le16(1), ...le16(bitCount));
  } else {
    header.push(...le32(spec.width), ...le32(spec.height >>> 0), ...le16(1), ...le16(bitCount));
    while (header.length < headerSize) header.push(0);
    if (headerSize === 124 && spec.embeddedProfile) header.splice(56, 4, ...le32(0x4d424544));
  }
  const pixels = [0, 0, 0, 0];
  const dataOffset = spec.dataOffset ?? 14 + headerSize;
  const fileSize = 14 + headerSize + pixels.length;
  return concat([latin1("BM"), le32(fileSize), [0, 0, 0, 0], le32(dataOffset), header, pixels]);
}

export function box(
  type: string,
  ...payload: readonly (readonly number[] | Uint8Array)[]
): Uint8Array {
  const body = concat(payload);
  return concat([be32(body.length + 8), latin1(type), body]);
}

export function fullBox(
  type: string,
  version: number,
  flags: number,
  ...payload: readonly (readonly number[] | Uint8Array)[]
): Uint8Array {
  return box(
    type,
    [version, (flags >>> 16) & 0xff, (flags >>> 8) & 0xff, flags & 0xff],
    ...payload,
  );
}

export const ispe = (width: number, height: number) =>
  fullBox("ispe", 0, 0, be32(width), be32(height));
export const irot = (quarterTurns: number) => box("irot", [quarterTurns]);
export const imir = (axis: number) => box("imir", [axis]);
/** A clean aperture of `width × height`, offset from the centre by whole pixels. */
export const clap = (width: number, height: number, dx = 0, dy = 0) =>
  box(
    "clap",
    be32(width),
    be32(1),
    be32(height),
    be32(1),
    be32(dx >>> 0),
    be32(1),
    be32(dy >>> 0),
    be32(1),
  );
export const auxC = (type: string) => fullBox("auxC", 0, 0, latin1(type), [0]);
export const ALPHA_AUX = "urn:mpeg:mpegB:cicp:systems:auxiliary:alpha";
export const GAIN_MAP_AUX = "urn:com:apple:photo:2020:aux:hdrgainmap";

/** An `ImageGrid` payload, with 32-bit output sizes when either exceeds 16 bits. */
export function gridData(rows: number, columns: number, width: number, height: number): Uint8Array {
  const wide = width > 0xffff || height > 0xffff;
  return concat([
    [0, wide ? 1 : 0, rows - 1, columns - 1],
    wide ? [...be32(width), ...be32(height)] : [...be16(width), ...be16(height)],
  ]);
}

export interface HeifItem {
  id: number;
  type: string;
  /** Omit for an item without an `ispe`. */
  size?: { width: number; height: number };
  /** More properties, associated after `ispe` in this order. */
  properties?: readonly Uint8Array[];
  /** Data stored in `idat`, as a grid's payload is. */
  data?: Uint8Array;
  /** Data stored in `mdat`, as an EXIF item's is. */
  mdat?: Uint8Array;
}

export interface HeifSpec {
  brand?: string;
  primary: number;
  items: readonly HeifItem[];
  references?: readonly { type: string; from: number; to: readonly number[] }[];
  /** Top-level boxes after `meta`, such as `moov`. */
  after?: readonly Uint8Array[];
}

/**
 * An AVIF or HEIF file: `ftyp`, then a `meta` box with every item, its
 * properties and locations, then `mdat`. Coded items carry no data, since
 * the probe never reads it.
 */
export function heif(spec: HeifSpec): Uint8Array {
  const brand = spec.brand ?? "avif";
  const ftyp = box("ftyp", latin1(brand), be32(0), latin1("mif1"), latin1(brand));
  const properties: Uint8Array[] = [];
  const ipmaEntries: number[] = [];
  const propertyCount = spec.items.reduce(
    (sum, item) => sum + (item.size ? 1 : 0) + (item.properties?.length ?? 0),
    0,
  );
  // Indices take 7 bits, or 15 when the flag says so.
  const wide = propertyCount > 127;
  for (const item of spec.items) {
    const own = [
      ...(item.size ? [ispe(item.size.width, item.size.height)] : []),
      ...(item.properties ?? []),
    ];
    ipmaEntries.push(...be16(item.id), own.length);
    for (const property of own) {
      properties.push(property);
      ipmaEntries.push(...(wide ? be16(properties.length) : [properties.length]));
    }
  }
  const idatParts = spec.items.filter((item) => item.data !== undefined);
  const mdatParts = spec.items.filter((item) => item.mdat !== undefined);
  const iref = (spec.references ?? []).map((reference) =>
    box(reference.type, be16(reference.from), be16(reference.to.length), ...reference.to.map(be16)),
  );
  const build = (mdatAt: number) => {
    const ilocEntries: number[] = [];
    let idatOffset = 0;
    for (const item of idatParts) {
      const length = item.data?.length ?? 0;
      ilocEntries.push(...be16(item.id), 0, 1, 0, 0, 0, 1, ...be32(idatOffset), ...be32(length));
      idatOffset += length;
    }
    let mdatOffset = mdatAt + 8;
    for (const item of mdatParts) {
      const length = item.mdat?.length ?? 0;
      ilocEntries.push(...be16(item.id), 0, 0, 0, 0, 0, 1, ...be32(mdatOffset), ...be32(length));
      mdatOffset += length;
    }
    return fullBox(
      "meta",
      0,
      0,
      fullBox("hdlr", 0, 0, be32(0), latin1("pict"), new Array(12).fill(0), [0]),
      fullBox("pitm", 0, 0, be16(spec.primary)),
      fullBox(
        "iinf",
        0,
        0,
        be16(spec.items.length),
        ...spec.items.map((item) =>
          fullBox("infe", 2, 0, be16(item.id), be16(0), latin1(item.type), [0]),
        ),
      ),
      ...(iref.length > 0 ? [fullBox("iref", 0, 0, ...iref)] : []),
      box(
        "iprp",
        box("ipco", ...properties),
        fullBox("ipma", 0, wide ? 1 : 0, be32(spec.items.length), ipmaEntries),
      ),
      fullBox("iloc", 1, 0, [0x44, 0x00], be16(idatParts.length + mdatParts.length), ilocEntries),
      ...(idatParts.length > 0 ? [box("idat", ...idatParts.map((item) => item.data ?? []))] : []),
    );
  };
  // The meta box's size doesn't depend on where mdat starts, so build it twice.
  const meta = build(ftyp.length + build(0).length);
  const mdat = box("mdat", ...mdatParts.map((item) => item.mdat ?? []));
  return concat([ftyp, meta, mdat, ...(spec.after ?? [])]);
}

/** An EXIF item's payload: the TIFF header offset, `Exif\0\0`, then the block. */
export function heifExif(block: Uint8Array): Uint8Array {
  return concat([be32(6), latin1("Exif\0\0"), block]);
}
