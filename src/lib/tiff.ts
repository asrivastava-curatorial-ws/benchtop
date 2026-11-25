/**
 * Writes pictures as TIFF files, the format print shops take CMYK pictures in:
 * 8 bits an ink, the profile inside, the size in dots per inch, and the pixel
 * rows either plain or packed with Deflate ("ZIP" in picture editors).  Also
 * reads back what it writes, for checks.
 */
import { unzlibSync, zlibSync } from 'fflate';

export interface TiffPicture {
  readonly width: number;
  readonly height: number;
  /** Samples per pixel: 4 for CMYK, 3 for RGB, 1 for grey. */
  readonly channels: 1 | 3 | 4;
  /** The pixels, row by row, one byte a sample. */
  readonly data: Uint8Array;
  readonly dpi?: number;
  /** An ICC profile to put inside. */
  readonly profile?: Uint8Array;
  readonly compress?: boolean;
  readonly software?: string;
}

const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;
const ASCII = 2;
const UNDEFINED = 7;

/** A picture as a TIFF file (little-endian, strips of about a quarter megabyte). */
export function writeTiff(picture: TiffPicture): Uint8Array {
  const { width, height, channels, data } = picture;
  if (!(width > 0 && height > 0) || data.length !== width * height * channels) throw new Error('The picture and its size do not agree.');
  const rowBytes = width * channels;
  const rowsPerStrip = Math.max(1, Math.min(height, Math.floor(262_144 / rowBytes) || 1));
  const strips: Uint8Array[] = [];
  for (let row = 0; row < height; row += rowsPerStrip) {
    const piece = data.subarray(row * rowBytes, Math.min(height, row + rowsPerStrip) * rowBytes);
    strips.push(picture.compress ? zlibSync(piece, { level: 6 }) : piece);
  }

  // Values too long for an entry's four bytes go after the directory; `extra` collects them.
  const extra: Uint8Array[] = [];
  let extraSize = 0;
  const entries: { tag: number; type: number; count: number; value: number | Uint8Array }[] = [];
  const add = (tag: number, type: number, count: number, value: number | Uint8Array) => entries.push({ tag, type, count, value });
  const shorts = (values: number[]) => {
    const bytes = new Uint8Array(values.length * 2);
    const view = new DataView(bytes.buffer);
    for (const [i, value] of values.entries()) view.setUint16(i * 2, value, true);
    return bytes;
  };
  const longs = (values: number[]) => {
    const bytes = new Uint8Array(values.length * 4);
    const view = new DataView(bytes.buffer);
    for (const [i, value] of values.entries()) view.setUint32(i * 4, value, true);
    return bytes;
  };
  const dpi = picture.dpi && picture.dpi > 0 ? picture.dpi : 300;
  const rational = longs([Math.round(dpi * 1000), 1000]);
  const software = new TextEncoder().encode(`${picture.software ?? 'Benchtop'}\0`);

  add(256, LONG, 1, width);
  add(257, LONG, 1, height);
  add(258, SHORT, channels, channels === 1 ? 8 : shorts(Array(channels).fill(8)));
  add(259, SHORT, 1, picture.compress ? 8 : 1);
  // 5 is "separated" (inks), 2 RGB, 1 grey with black as zero.
  add(262, SHORT, 1, channels === 4 ? 5 : channels === 3 ? 2 : 1);
  const offsetsAt = entries.length;
  add(273, LONG, strips.length, 0);
  add(277, SHORT, 1, channels);
  add(278, LONG, 1, rowsPerStrip);
  add(279, LONG, strips.length, strips.length === 1 ? (strips[0] as Uint8Array).length : longs(strips.map((strip) => strip.length)));
  add(282, RATIONAL, 1, rational);
  add(283, RATIONAL, 1, rational);
  add(284, SHORT, 1, 1);
  add(296, SHORT, 1, 2);
  add(305, ASCII, software.length, software);
  if (channels === 4) add(332, SHORT, 1, 1);
  if (picture.profile) add(34675, UNDEFINED, picture.profile.length, picture.profile);

  const directory = 8;
  const directorySize = 2 + entries.length * 12 + 4;
  const place = (bytes: Uint8Array): number => {
    const at = directory + directorySize + extraSize;
    extra.push(bytes);
    // Values start on an even byte.
    const padded = bytes.length + (bytes.length % 2);
    if (padded !== bytes.length) extra.push(new Uint8Array(1));
    extraSize += padded;
    return at;
  };
  const fields: { tag: number; type: number; count: number; word: number }[] = [];
  for (const [index, entry] of entries.entries()) {
    if (index === offsetsAt) {
      fields.push({ ...entry, word: 0 });
      continue;
    }
    fields.push({ tag: entry.tag, type: entry.type, count: entry.count, word: typeof entry.value === 'number' ? entry.value : place(entry.value) });
  }
  // The strips come last; their offsets are known once everything before them is placed.
  let at = directory + directorySize + extraSize;
  const stripTable = strips.length > 1 ? new Uint8Array(strips.length * 4) : null;
  const tableAt = stripTable ? place(stripTable) : 0;
  at = directory + directorySize + extraSize;
  const offsets = strips.map((strip) => {
    const here = at;
    at += strip.length + (strip.length % 2);
    return here;
  });
  if (stripTable) stripTable.set(longs(offsets));
  (fields[offsetsAt] as { word: number }).word = stripTable ? tableAt : (offsets[0] as number);

  const out = new Uint8Array(at);
  const view = new DataView(out.buffer);
  out.set([0x49, 0x49, 42, 0], 0);
  view.setUint32(4, directory, true);
  view.setUint16(directory, fields.length, true);
  fields.forEach((field, i) => {
    const base = directory + 2 + i * 12;
    view.setUint16(base, field.tag, true);
    view.setUint16(base + 2, field.type, true);
    view.setUint32(base + 4, field.count, true);
    // A single short sits at the start of the four bytes, as the format wants.
    if (field.type === SHORT && field.count === 1) view.setUint16(base + 8, field.word, true);
    else view.setUint32(base + 8, field.word, true);
  });
  let cursor = directory + directorySize;
  for (const bytes of extra) {
    out.set(bytes, cursor);
    cursor += bytes.length;
  }
  for (const [i, strip] of strips.entries()) out.set(strip, offsets[i] as number);
  return out;
}

/** Reads a TIFF of the kinds `writeTiff` makes (8-bit strips, plain or Deflate, little-endian). */
export function readTiff(
  bytes: Uint8Array,
): Required<Pick<TiffPicture, 'width' | 'height' | 'channels' | 'data' | 'dpi'>> & { profile: Uint8Array | null; photometric: number; inkSet: number | null; compression: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || view.getUint16(0, true) !== 0x4949 || view.getUint16(2, true) !== 42) throw new Error('This is not a little-endian TIFF file.');
  const directory = view.getUint32(4, true);
  const count = view.getUint16(directory, true);
  const fields = new Map<number, { type: number; count: number; at: number }>();
  for (let i = 0; i < count; i++) {
    const base = directory + 2 + i * 12;
    fields.set(view.getUint16(base, true), { type: view.getUint16(base + 2, true), count: view.getUint32(base + 4, true), at: base + 8 });
  }
  const sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };
  const values = (tag: number): number[] => {
    const field = fields.get(tag);
    if (!field) return [];
    const size = sizes[field.type] ?? 1;
    const at = size * field.count > 4 ? view.getUint32(field.at, true) : field.at;
    return Array.from({ length: field.count }, (_, i) =>
      field.type === SHORT ? view.getUint16(at + i * 2, true) : field.type === LONG ? view.getUint32(at + i * 4, true) : (bytes[at + i] as number),
    );
  };
  const one = (tag: number, fallback: number) => values(tag)[0] ?? fallback;
  const width = one(256, 0);
  const height = one(257, 0);
  const channels = one(277, 1) as 1 | 3 | 4;
  const compression = one(259, 1);
  if (values(258).some((bits) => bits !== 8) || (compression !== 1 && compression !== 8)) throw new Error('Only 8-bit TIFF files, plain or packed with Deflate, are read here.');
  const offsets = values(273);
  const lengths = values(279);
  const data = new Uint8Array(width * height * channels);
  let cursor = 0;
  offsets.forEach((offset, i) => {
    const strip = bytes.subarray(offset, offset + (lengths[i] as number));
    const plain = compression === 8 ? unzlibSync(strip) : strip;
    data.set(plain, cursor);
    cursor += plain.length;
  });
  const resolution = fields.get(282);
  const dpi = resolution ? view.getUint32(view.getUint32(resolution.at, true), true) / view.getUint32(view.getUint32(resolution.at, true) + 4, true) : 0;
  const icc = fields.get(34675);
  const profile = icc ? bytes.slice(view.getUint32(icc.at, true), view.getUint32(icc.at, true) + icc.count) : null;
  return { width, height, channels, data, dpi, profile, photometric: one(262, 0), inkSet: fields.has(332) ? one(332, 0) : null, compression };
}
