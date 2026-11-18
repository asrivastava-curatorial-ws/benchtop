/**
 * Pixel helpers for the image operations.  Decoding uses the platform
 * (createImageBitmap + OffscreenCanvas, available in workers); PNG encoding is
 * done here so results are identical everywhere.
 */
import { OpError, type OpResult } from './core';
import { detectFileType } from './filetypes';

export interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

function canvas(width: number, height: number): OffscreenCanvas {
  if (typeof OffscreenCanvas === 'undefined') throw new OpError('Image operations need a newer system web view (OffscreenCanvas is missing).');
  return new OffscreenCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
}

function context(c: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new OpError('Could not create a drawing surface.');
  return ctx;
}

export async function decode(bytes: Uint8Array): Promise<Pixels> {
  if (typeof createImageBitmap === 'undefined') throw new OpError('Image operations need a newer system web view (createImageBitmap is missing).');
  const type = detectFileType(bytes);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: type?.mime ?? 'application/octet-stream' }));
  } catch {
    throw new OpError(type ? `This ${type.name} could not be decoded.` : 'The input is not an image this system can read (PNG, JPEG, GIF, WebP, BMP).');
  }
  const c = canvas(bitmap.width, bitmap.height);
  const ctx = context(c);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const image = ctx.getImageData(0, 0, c.width, c.height);
  return { width: image.width, height: image.height, data: image.data };
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC[(c ^ b) & 255] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export async function encodePng(px: Pixels): Promise<Uint8Array> {
  const { zlibSync } = await import('fflate');
  const stride = px.width * 4;
  const raw = new Uint8Array((stride + 1) * px.height);
  for (let y = 0; y < px.height; y++) raw.set(px.data.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  const chunk = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, px.width);
  hv.setUint32(4, px.height);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function encodeBmp(px: Pixels): Uint8Array {
  const stride = px.width * 4;
  const out = new Uint8Array(54 + stride * px.height);
  const v = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  v.setUint32(2, out.length, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, px.width, true);
  v.setInt32(22, -px.height, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 32, true);
  v.setUint32(34, stride * px.height, true);
  for (let i = 0; i < px.width * px.height; i++) {
    out[54 + i * 4] = px.data[i * 4 + 2] as number;
    out[55 + i * 4] = px.data[i * 4 + 1] as number;
    out[56 + i * 4] = px.data[i * 4] as number;
    out[57 + i * 4] = px.data[i * 4 + 3] as number;
  }
  return out;
}

/** Encodes through the platform (JPEG and WebP). */
export async function encodeAs(px: Pixels, mime: string, quality: number): Promise<Uint8Array> {
  const c = canvas(px.width, px.height);
  context(c).putImageData(new ImageData(new Uint8ClampedArray(px.data), px.width, px.height), 0, 0);
  const blob = await c.convertToBlob({ type: mime, quality });
  if (blob.type !== mime) throw new OpError(`This system cannot write ${mime.replace('image/', '').toUpperCase()} images.`);
  return new Uint8Array(await blob.arrayBuffer());
}

export async function pngResult(px: Pixels): Promise<OpResult> {
  const bytes = await encodePng(px);
  return { value: bytes, preview: { kind: 'image', bytes, mime: 'image/png' } };
}

export function blank(width: number, height: number): Pixels {
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)), data: new Uint8ClampedArray(Math.max(1, Math.round(width)) * Math.max(1, Math.round(height)) * 4) };
}

/** Draws pixels through a 2D canvas transform (rotation, scaling, cropping). */
export function draw(px: Pixels, width: number, height: number, paint: (ctx: OffscreenCanvasRenderingContext2D, source: OffscreenCanvas) => void, smooth = true): Pixels {
  const source = canvas(px.width, px.height);
  context(source).putImageData(new ImageData(new Uint8ClampedArray(px.data), px.width, px.height), 0, 0);
  const target = canvas(width, height);
  const ctx = context(target);
  ctx.imageSmoothingEnabled = smooth;
  ctx.imageSmoothingQuality = 'high';
  paint(ctx, source);
  const image = ctx.getImageData(0, 0, target.width, target.height);
  return { width: image.width, height: image.height, data: image.data };
}

export function mapPixels(px: Pixels, fn: (r: number, g: number, b: number, a: number) => [number, number, number, number]): Pixels {
  const data = new Uint8ClampedArray(px.data.length);
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = fn(px.data[i] as number, px.data[i + 1] as number, px.data[i + 2] as number, px.data[i + 3] as number);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return { width: px.width, height: px.height, data };
}

/** Separable box blur repeated three times, a close approximation of a Gaussian. */
export function blur(px: Pixels, radius: number, passes = 3): Pixels {
  const r = Math.max(1, Math.round(radius));
  let data = new Float32Array(px.data);
  const { width: w, height: h } = px;
  const pass = (src: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(src.length);
    const lines = horizontal ? h : w;
    const length = horizontal ? w : h;
    for (let line = 0; line < lines; line++) {
      for (let ch = 0; ch < 4; ch++) {
        let sum = 0;
        const at = (i: number) => {
          const clamped = Math.min(length - 1, Math.max(0, i));
          return (horizontal ? line * w + clamped : clamped * w + line) * 4 + ch;
        };
        for (let i = -r; i <= r; i++) sum += src[at(i)] as number;
        for (let i = 0; i < length; i++) {
          out[at(i)] = sum / (2 * r + 1);
          sum += (src[at(i + r + 1)] as number) - (src[at(i - r)] as number);
        }
      }
    }
    return out;
  };
  for (let p = 0; p < passes; p++) data = pass(pass(data, true), false);
  return { width: w, height: h, data: new Uint8ClampedArray(data) };
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}
