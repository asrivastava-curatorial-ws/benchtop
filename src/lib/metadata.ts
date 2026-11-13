/**
 * Removes metadata (EXIF, XMP, IPTC, comments, text chunks) from JPEG, PNG
 * and WebP files without re-encoding, so image quality is untouched.
 */
import { concatBytes } from './bytes';
import { ToolError } from './errors';

export type ImageKind = 'jpeg' | 'png' | 'webp';

export function imageKind(bytes: Uint8Array): ImageKind | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'webp';
  return null;
}

export interface StripOptions {
  /** Keep the colour profile (ICC), which affects how colours display. */
  readonly keepColorProfile: boolean;
  /** Keep the orientation flag so rotated photos still display upright. */
  readonly keepOrientation: boolean;
}

export interface StripResult {
  readonly bytes: Uint8Array;
  readonly removed: readonly string[];
  readonly orientation?: number;
}

const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));

/** Reads the orientation (1-8) from TIFF-structured EXIF data, if present. */
function tiffOrientation(tiff: Uint8Array): number | undefined {
  if (tiff.length < 8) return undefined;
  const order = ascii(tiff, 0, 2);
  if (order !== 'II' && order !== 'MM') return undefined;
  const little = order === 'II';
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const read16 = (offset: number) => view.getUint16(offset, little);
  const ifd = view.getUint32(4, little);
  if (ifd + 2 > tiff.length) return undefined;
  const count = read16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) break;
    if (read16(entry) === 0x0112) {
      const value = read16(entry + 8);
      return value >= 1 && value <= 8 ? value : undefined;
    }
  }
  return undefined;
}

/** Reads the EXIF orientation (1-8) from a JPEG APP1 payload, if present. */
function exifOrientation(payload: Uint8Array): number | undefined {
  if (ascii(payload, 0, 6) !== 'Exif\0\0') return undefined;
  return tiffOrientation(payload.subarray(6));
}

/** TIFF-structured EXIF data holding only the orientation tag. */
function orientationTiff(orientation: number): Uint8Array {
  return new Uint8Array([...[0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8], ...[0, 1], ...[0x01, 0x12, 0x00, 0x03, 0, 0, 0, 1, 0, orientation, 0, 0], ...[0, 0, 0, 0]]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/** A minimal JPEG EXIF segment holding only the orientation tag. */
function orientationApp1(orientation: number): Uint8Array {
  const body = concatBytes(new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0]), orientationTiff(orientation));
  return concatBytes(new Uint8Array([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff]), body);
}

function stripJpeg(bytes: Uint8Array, options: StripOptions): StripResult {
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  const removed: string[] = [];
  let orientation: number | undefined;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) throw new ToolError('This JPEG file is damaged: a segment marker is missing.');
    const marker = bytes[offset + 1] as number;
    if (marker === 0xff) {
      offset++;
      continue;
    }
    // Start of scan: everything after it is image data.
    if (marker === 0xda) {
      parts.push(bytes.subarray(offset));
      break;
    }
    const length = ((bytes[offset + 2] as number) << 8) | (bytes[offset + 3] as number);
    const segment = bytes.subarray(offset, offset + 2 + length);
    const payload = segment.subarray(4);
    let keep = true;
    if (marker === 0xe1) {
      const isExif = ascii(payload, 0, 6) === 'Exif\0\0';
      if (isExif) orientation = exifOrientation(payload) ?? orientation;
      removed.push(isExif ? 'EXIF' : ascii(payload, 0, 28).startsWith('http://ns.adobe.com/xap/1.0/') ? 'XMP' : 'APP1 data');
      keep = false;
    } else if (marker === 0xe2) {
      const icc = ascii(payload, 0, 12) === 'ICC_PROFILE\0';
      keep = icc && options.keepColorProfile;
      if (!keep) removed.push(icc ? 'Colour profile' : ascii(payload, 0, 4) === 'MPF\0' ? 'Multi-picture data' : 'APP2 data');
    } else if (marker === 0xed) {
      keep = false;
      removed.push('IPTC / Photoshop');
    } else if (marker === 0xfe) {
      keep = false;
      removed.push('Comment');
    } else if (marker >= 0xe3 && marker <= 0xef) {
      // APP14 "Adobe" carries the colour transform and must stay for correct colours.
      keep = marker === 0xee && ascii(payload, 0, 5) === 'Adobe';
      if (!keep) removed.push(`APP${marker - 0xe0} data`);
    }
    if (keep) parts.push(segment);
    offset += 2 + length;
  }
  if (options.keepOrientation && orientation !== undefined && orientation !== 1) {
    // JFIF requires its APP0 segment straight after the start marker, so the new EXIF block goes after it.
    const afterApp0 = parts[1]?.[0] === 0xff && parts[1]?.[1] === 0xe0 ? 2 : 1;
    parts.splice(afterApp0, 0, orientationApp1(orientation));
  }
  return { bytes: concatBytes(...parts), removed: [...new Set(removed)], orientation };
}

const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME', 'caBX', 'dSIG']);

function stripPng(bytes: Uint8Array, options: StripOptions): StripResult {
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  const removed: string[] = [];
  let orientation: number | undefined;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
    const type = ascii(bytes, offset + 4, 4);
    const chunk = bytes.subarray(offset, offset + 12 + length);
    if (type === 'eXIf') orientation = tiffOrientation(chunk.subarray(8, 8 + length)) ?? orientation;
    const drop = PNG_DROP.has(type) || (type === 'iCCP' && !options.keepColorProfile);
    if (drop) removed.push(type === 'eXIf' ? 'EXIF' : type === 'tIME' ? 'Modification time' : type === 'iCCP' ? 'Colour profile' : `Text (${type})`);
    else parts.push(chunk);
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  if (options.keepOrientation && orientation !== undefined && orientation !== 1) {
    // eXIf must come before the image data; straight after IHDR is always valid.
    parts.splice(2, 0, pngChunk('eXIf', orientationTiff(orientation)));
  }
  return { bytes: concatBytes(...parts), removed: [...new Set(removed)], orientation };
}

function stripWebp(bytes: Uint8Array, options: StripOptions): StripResult {
  const parts: Uint8Array[] = [];
  const removed: string[] = [];
  let offset = 12;
  let vp8x: Uint8Array | null = null;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const size = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0, true);
    const chunk = bytes.slice(offset, offset + 8 + size + (size & 1));
    if (type === 'EXIF' || type === 'XMP ' || (type === 'ICCP' && !options.keepColorProfile)) {
      removed.push(type === 'EXIF' ? 'EXIF' : type === 'XMP ' ? 'XMP' : 'Colour profile');
    } else {
      if (type === 'VP8X') vp8x = chunk;
      parts.push(chunk);
    }
    offset += 8 + size + (size & 1);
  }
  if (vp8x) {
    // Clear the EXIF and XMP flags (and ICC when removed) in the extended header.
    let flags = vp8x[8] as number;
    flags &= ~0x0c;
    if (!options.keepColorProfile) flags &= ~0x20;
    vp8x[8] = flags;
  }
  const body = concatBytes(...parts);
  const header = new Uint8Array(12);
  header.set(bytes.subarray(0, 12));
  new DataView(header.buffer).setUint32(4, body.length + 4, true);
  return { bytes: concatBytes(header, body), removed: [...new Set(removed)] };
}

export function stripMetadata(bytes: Uint8Array, options: StripOptions): StripResult {
  switch (imageKind(bytes)) {
    case 'jpeg':
      return stripJpeg(bytes, options);
    case 'png':
      return stripPng(bytes, options);
    case 'webp':
      return stripWebp(bytes, options);
    default:
      throw new ToolError('Metadata can be removed from JPEG, PNG and WebP files.');
  }
}

/** The EXIF (as TIFF data) and XMP packets of a WebP file, which metadata readers often skip. */
export function readWebpMetadata(bytes: Uint8Array): { exif: Uint8Array | null; xmp: string | null } {
  let exif: Uint8Array | null = null;
  let xmp: string | null = null;
  if (imageKind(bytes) !== 'webp') return { exif, xmp };
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const size = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0, true);
    const data = bytes.subarray(offset + 8, Math.min(bytes.length, offset + 8 + size));
    // The specification says TIFF data, but many writers keep the JPEG-style "Exif\0\0" prefix.
    if (type === 'EXIF') exif = (ascii(data, 0, 6) === 'Exif\0\0' ? data.subarray(6) : data).slice();
    if (type === 'XMP ') xmp = new TextDecoder().decode(data);
    offset += 8 + size + (size & 1);
  }
  return { exif, xmp };
}
