/** Canvas helpers shared by previews and the image tools. */

import type { ImageFormat } from '../tools/types';
import { encodeImage } from '../worker/client';

export const FORMAT_INFO: Record<ImageFormat, { label: string; mime: string; ext: string; lossy: boolean }> = {
  png: { label: 'PNG', mime: 'image/png', ext: 'png', lossy: false },
  jpeg: { label: 'JPEG', mime: 'image/jpeg', ext: 'jpg', lossy: true },
  webp: { label: 'WebP', mime: 'image/webp', ext: 'webp', lossy: true },
  avif: { label: 'AVIF', mime: 'image/avif', ext: 'avif', lossy: true },
};

/** Largest canvas edge / area the common engines handle reliably. */
export const MAX_EDGE = 16384;
export const MAX_PIXELS = 64_000_000;

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (w > MAX_EDGE || h > MAX_EDGE || w * h > MAX_PIXELS) {
    throw new Error(`An image of ${w} × ${h} px is too large to process (the limit is ${MAX_EDGE} px per side and 64 megapixels).`);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

export function context2d(canvas: HTMLCanvasElement, readsOften = false): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', readsOften ? { willReadFrequently: true } : undefined);
  if (!context) throw new Error('This device could not create a 2D drawing surface.');
  return context;
}

/** Decodes any image the platform understands (PNG, JPEG, WebP, AVIF, GIF, BMP, ICO, SVG). */
export async function loadImage(source: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('This file could not be read as an image.'));
      image.src = url;
    });
    // SVG without intrinsic size reports 0; fall back to a sensible default.
    const width = image.naturalWidth || 512;
    const height = image.naturalHeight || 512;
    const canvas = createCanvas(width, height);
    context2d(canvas).drawImage(image, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Draws SVG markup at an exact pixel size. */
export async function rasterizeSvg(svg: string, width: number, height: number, background?: string): Promise<HTMLCanvasElement> {
  const canvas = createCanvas(width, height);
  const context = context2d(canvas);
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The SVG could not be rendered. Check that it is valid, self-contained SVG.'));
      image.src = url;
    });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        // Engines that cannot encode a format silently fall back to PNG; treat that as a failure.
        if (blob && blob.type === mime) resolve(blob);
        else reject(new Error(`This device cannot encode ${mime}.`));
      },
      mime,
      quality,
    );
  });
}

export interface EncodeOptions {
  readonly format: ImageFormat;
  /** 1-100, used by lossy formats. */
  readonly quality: number;
  readonly lossless?: boolean;
  /** Fill colour behind transparent pixels for formats without alpha (JPEG). */
  readonly matte?: string;
}

export async function encodeCanvas(canvas: HTMLCanvasElement, options: EncodeOptions): Promise<Blob> {
  const info = FORMAT_INFO[options.format];
  if (options.format === 'png') return canvasToBlob(canvas, info.mime);
  if (options.format === 'jpeg') {
    const flat = createCanvas(canvas.width, canvas.height);
    const context = context2d(flat);
    context.fillStyle = options.matte ?? '#ffffff';
    context.fillRect(0, 0, flat.width, flat.height);
    context.drawImage(canvas, 0, 0);
    return canvasToBlob(flat, info.mime, options.quality / 100);
  }
  const pixels = context2d(canvas, true).getImageData(0, 0, canvas.width, canvas.height);
  const bytes = await encodeImage({
    format: options.format,
    width: canvas.width,
    height: canvas.height,
    rgba: pixels.data.buffer.slice(0) as ArrayBuffer,
    quality: options.quality,
    lossless: options.lossless === true,
  });
  return new Blob([bytes as BlobPart], { type: info.mime });
}

export function replaceExtension(name: string, ext: string): string {
  const base = name.replace(/\.[^./\\]+$/, '') || 'image';
  return `${base}.${ext}`;
}

/** Scales a canvas down so its longest side is at most `maxEdge` (never up). */
export function downscale(canvas: HTMLCanvasElement, maxEdge: number): { canvas: HTMLCanvasElement; scale: number } {
  const longest = Math.max(canvas.width, canvas.height);
  if (longest <= maxEdge) return { canvas, scale: 1 };
  const scale = maxEdge / longest;
  const small = createCanvas(canvas.width * scale, canvas.height * scale);
  const context = context2d(small);
  context.imageSmoothingQuality = 'high';
  context.drawImage(canvas, 0, 0, small.width, small.height);
  return { canvas: small, scale };
}
