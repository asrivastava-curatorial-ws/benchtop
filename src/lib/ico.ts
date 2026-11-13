/**
 * Writes and reads Windows .ico files.
 *
 * An ICO is a small directory followed by one image per size.  Sizes below
 * 256 px are stored as 32-bit BMP data (understood by every Windows version
 * and tool); 256 px is stored as PNG, which is how Windows itself does it.
 */
import { ToolError } from './errors';

export interface IconImage {
  readonly size: number;
  /** RGBA pixels, `size * size * 4` bytes, top row first. */
  readonly rgba: Uint8ClampedArray | Uint8Array;
  /** PNG encoding of the same image (used for large sizes, or for all sizes when requested). */
  readonly png: Uint8Array;
}

export interface IcoOptions {
  /** Store every size as PNG.  Smaller files, but very old software cannot read them. */
  readonly pngOnly?: boolean;
}

function bmpEntry(image: IconImage): Uint8Array {
  const { size, rgba } = image;
  const maskRow = Math.ceil(size / 32) * 4;
  const out = new Uint8Array(40 + size * size * 4 + maskRow * size);
  const view = new DataView(out.buffer);
  view.setUint32(0, 40, true); // BITMAPINFOHEADER
  view.setInt32(4, size, true);
  view.setInt32(8, size * 2, true); // colour rows plus the 1-bit mask rows
  view.setUint16(12, 1, true);
  view.setUint16(14, 32, true);
  view.setUint32(20, size * size * 4 + maskRow * size, true);
  let offset = 40;
  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      out[offset++] = rgba[i + 2] as number;
      out[offset++] = rgba[i + 1] as number;
      out[offset++] = rgba[i] as number;
      out[offset++] = rgba[i + 3] as number;
    }
  }
  // AND mask: a set bit marks a fully transparent pixel, for software that ignores the alpha channel.
  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      if ((rgba[(y * size + x) * 4 + 3] as number) === 0) out[offset + (x >> 3)] = (out[offset + (x >> 3)] as number) | (0x80 >> (x & 7));
    }
    offset += maskRow;
  }
  return out;
}

export function encodeIco(images: readonly IconImage[], options: IcoOptions = {}): Uint8Array {
  if (images.length === 0) throw new ToolError('Choose at least one icon size.');
  for (const image of images) {
    if (!Number.isInteger(image.size) || image.size < 1 || image.size > 256) throw new ToolError('Icon sizes must be between 1 and 256 pixels.');
    if (image.rgba.length !== image.size * image.size * 4) throw new ToolError('Icon pixel data does not match its size.');
  }
  const ordered = [...images].sort((a, b) => a.size - b.size);
  const payloads = ordered.map((image) => (options.pngOnly || image.size >= 256 ? image.png : bmpEntry(image)));
  const headerSize = 6 + 16 * ordered.length;
  const out = new Uint8Array(headerSize + payloads.reduce((sum, payload) => sum + payload.length, 0));
  const view = new DataView(out.buffer);
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, ordered.length, true);
  let offset = headerSize;
  ordered.forEach((image, index) => {
    const entry = 6 + index * 16;
    const payload = payloads[index] as Uint8Array;
    out[entry] = image.size === 256 ? 0 : image.size;
    out[entry + 1] = image.size === 256 ? 0 : image.size;
    view.setUint16(entry + 4, 1, true); // colour planes
    view.setUint16(entry + 6, 32, true); // bits per pixel
    view.setUint32(entry + 8, payload.length, true);
    view.setUint32(entry + 12, offset, true);
    out.set(payload, offset);
    offset += payload.length;
  });
  return out;
}

export interface IcoEntry {
  readonly width: number;
  readonly height: number;
  readonly bitsPerPixel: number;
  readonly png: boolean;
  readonly data: Uint8Array;
}

/** Lists the images inside an .ico file. */
export function parseIco(bytes: Uint8Array): IcoEntry[] {
  if (bytes.length < 6) throw new ToolError('This file is too short to be an .ico file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1) throw new ToolError('This is not an .ico file.');
  const count = view.getUint16(4, true);
  const entries: IcoEntry[] = [];
  for (let index = 0; index < count; index++) {
    const entry = 6 + index * 16;
    if (entry + 16 > bytes.length) throw new ToolError('The .ico directory is truncated.');
    const length = view.getUint32(entry + 8, true);
    const offset = view.getUint32(entry + 12, true);
    if (offset + length > bytes.length) throw new ToolError('The .ico file is truncated.');
    const data = bytes.subarray(offset, offset + length);
    entries.push({
      width: bytes[entry] || 256,
      height: bytes[entry + 1] || 256,
      bitsPerPixel: view.getUint16(entry + 6, true),
      png: data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47,
      data,
    });
  }
  return entries;
}
