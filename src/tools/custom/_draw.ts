/** Canvas drawing shared by the icon, store-graphic, cropping and stitching tools. */
import { context2d, createCanvas } from '../../ui/canvas';

export interface Fill {
  readonly kind: 'solid' | 'gradient' | 'none';
  readonly color1: string;
  readonly color2: string;
  /** Degrees; 0 runs left to right, 90 top to bottom. */
  readonly angle: number;
}

export function paintFill(context: CanvasRenderingContext2D, fill: Fill, x: number, y: number, w: number, h: number): void {
  if (fill.kind === 'none') return;
  if (fill.kind === 'solid') {
    context.fillStyle = fill.color1;
    context.fillRect(x, y, w, h);
    return;
  }
  const rad = (fill.angle * Math.PI) / 180;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const reach = (Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h) / 2;
  const gradient = context.createLinearGradient(cx - Math.cos(rad) * reach, cy - Math.sin(rad) * reach, cx + Math.cos(rad) * reach, cy + Math.sin(rad) * reach);
  gradient.addColorStop(0, fill.color1);
  gradient.addColorStop(1, fill.color2);
  context.fillStyle = gradient;
  context.fillRect(x, y, w, h);
}

export type Drawable = HTMLCanvasElement | HTMLImageElement;

const sizeOf = (source: Drawable) =>
  source instanceof HTMLImageElement ? { w: source.naturalWidth || source.width || 512, h: source.naturalHeight || source.height || 512 } : { w: source.width, h: source.height };

/** Draws a picture as large as fits inside the box, centred. */
export function drawContain(context: CanvasRenderingContext2D, source: Drawable, x: number, y: number, w: number, h: number): void {
  const { w: sw, h: sh } = sizeOf(source);
  const scale = Math.min(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** Draws a picture covering the box, cropped around a focal point (0 to 1 in each direction). */
export function drawCover(context: CanvasRenderingContext2D, source: Drawable, x: number, y: number, w: number, h: number, fx = 0.5, fy = 0.5): void {
  const { w: sw, h: sh } = sizeOf(source);
  const scale = Math.max(w / sw, h / sh);
  const cw = w / scale;
  const ch = h / scale;
  const sx = Math.min(Math.max(fx * sw - cw / 2, 0), sw - cw);
  const sy = Math.min(Math.max(fy * sh - ch / 2, 0), sh - ch);
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, sx, sy, cw, ch, x, y, w, h);
}

/** The picture without fully transparent margins. */
export function trimTransparent(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const { width, height } = canvas;
  const data = context2d(canvas, true).getImageData(0, 0, width, height).data;
  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[(y * width + x) * 4 + 3] as number) > 8) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0 || (left === 0 && top === 0 && right === width - 1 && bottom === height - 1)) return canvas;
  const out = createCanvas(right - left + 1, bottom - top + 1);
  context2d(out).drawImage(canvas, -left, -top);
  return out;
}

/** Every visible pixel painted one colour, keeping the transparency. */
export function silhouette(canvas: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const out = createCanvas(canvas.width, canvas.height);
  const context = context2d(out);
  context.drawImage(canvas, 0, 0);
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = color;
  context.fillRect(0, 0, out.width, out.height);
  return out;
}

/** Grey by luminance, keeping the transparency. */
export function greyscale(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const out = createCanvas(canvas.width, canvas.height);
  const context = context2d(out, true);
  context.drawImage(canvas, 0, 0);
  const image = context.getImageData(0, 0, out.width, out.height);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const grey = Math.round(0.2126 * (d[i] as number) + 0.7152 * (d[i + 1] as number) + 0.0722 * (d[i + 2] as number));
    d[i] = grey;
    d[i + 1] = grey;
    d[i + 2] = grey;
  }
  context.putImageData(image, 0, 0);
  return out;
}

/** The same picture on an opaque colour (app stores refuse transparency in some places). */
export function flatten(canvas: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const out = createCanvas(canvas.width, canvas.height);
  const context = context2d(out);
  context.fillStyle = color;
  context.fillRect(0, 0, out.width, out.height);
  context.drawImage(canvas, 0, 0);
  return out;
}

export async function pngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be encoded.'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

export async function jpegBytes(canvas: HTMLCanvasElement, quality = 0.9): Promise<Uint8Array> {
  const flat = flatten(canvas, '#ffffff');
  const blob = await new Promise<Blob>((resolve, reject) => flat.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be encoded.'))), 'image/jpeg', quality));
  return new Uint8Array(await blob.arrayBuffer());
}

export function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  context.beginPath();
  context.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

/** A superellipse ("squircle") path, as launchers and iOS use. */
export function squircle(context: CanvasRenderingContext2D, x: number, y: number, size: number, exponent = 5): void {
  const r = size / 2;
  const cx = x + r;
  const cy = y + r;
  context.beginPath();
  for (let i = 0; i <= 96; i++) {
    const t = (i / 96) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const px = cx + r * Math.sign(c) * Math.abs(c) ** (2 / exponent);
    const py = cy + r * Math.sign(s) * Math.abs(s) ** (2 / exponent);
    if (i === 0) context.moveTo(px, py);
    else context.lineTo(px, py);
  }
  context.closePath();
}

export type MaskShape = 'circle' | 'squircle' | 'rounded' | 'square' | 'teardrop';

export function shapePath(context: CanvasRenderingContext2D, shape: MaskShape, x: number, y: number, size: number): void {
  switch (shape) {
    case 'circle':
      context.beginPath();
      context.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
      return;
    case 'squircle':
      squircle(context, x, y, size);
      return;
    case 'rounded':
      roundedRect(context, x, y, size, size, size * 0.2);
      return;
    case 'teardrop':
      context.beginPath();
      context.roundRect(x, y, size, size, [size / 2, size / 2, size * 0.12, size / 2]);
      return;
    default:
      context.beginPath();
      context.rect(x, y, size, size);
  }
}

/** Loads an image element (for SVG, so it can be drawn sharply at any size). */
export async function imageElement(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('This file could not be read as an image.'));
      image.src = url;
    });
    await image.decode().catch(() => undefined);
    return image;
  } finally {
    // Keep the URL alive until decoding finished; drawing an SVG later still works from the decoded image.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/** Fits one line of text into a box, returning the font size used. */
export function fitText(context: CanvasRenderingContext2D, text: string, family: string, weight: number, maxWidth: number, maxHeight: number): number {
  let size = maxHeight;
  context.font = `${weight} ${size}px ${family}`;
  const metrics = context.measureText(text || ' ');
  const height = (metrics.actualBoundingBoxAscent || size * 0.75) + (metrics.actualBoundingBoxDescent || 0);
  size = Math.min(size * (maxWidth / Math.max(metrics.width, 1)), size * (maxHeight / Math.max(height, 1)));
  return Math.max(1, size);
}
