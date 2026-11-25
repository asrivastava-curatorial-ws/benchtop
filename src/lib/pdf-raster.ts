/**
 * PDF operations that look at the rendered pages (PDF.js, in the page):
 * recolouring by redrawing pages as pictures, finding blank pages, taking out
 * the pictures, turning pages whose text runs sideways, guessing a title for
 * the file name, and cutting several photos out of one scanned page.
 */
import { PDFDocument } from 'pdf-lib';
import { ToolError } from './errors';
import { openPdf, type PdfDocument, renderPage } from './pdf-render';

export type Recolour =
  | { readonly kind: 'grayscale' }
  | { readonly kind: 'invert' }
  | { readonly kind: 'contrast'; readonly amount: number }
  | { readonly kind: 'blackwhite'; readonly threshold: number }
  | { readonly kind: 'replace'; readonly from: string; readonly to: string; readonly tolerance: number }
  | { readonly kind: 'none' };

const hexRgb = (hex: string): [number, number, number] => {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? '000000';
  return [Number.parseInt(h.slice(0, 2), 16), Number.parseInt(h.slice(2, 4), 16), Number.parseInt(h.slice(4, 6), 16)];
};

/** Changes the pixels in place. */
export function recolour(data: Uint8ClampedArray, r: Recolour): void {
  if (r.kind === 'none') return;
  const from = r.kind === 'replace' ? hexRgb(r.from) : [0, 0, 0];
  const to = r.kind === 'replace' ? hexRgb(r.to) : [0, 0, 0];
  const k = r.kind === 'contrast' ? r.amount : 1;
  for (let i = 0; i < data.length; i += 4) {
    const red = data[i] ?? 0;
    const green = data[i + 1] ?? 0;
    const blue = data[i + 2] ?? 0;
    if (r.kind === 'grayscale' || r.kind === 'blackwhite') {
      const y = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      const v = r.kind === 'blackwhite' ? (y >= r.threshold ? 255 : 0) : y;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    } else if (r.kind === 'invert') {
      data[i] = 255 - red;
      data[i + 1] = 255 - green;
      data[i + 2] = 255 - blue;
    } else if (r.kind === 'contrast') {
      data[i] = (red - 128) * k + 128;
      data[i + 1] = (green - 128) * k + 128;
      data[i + 2] = (blue - 128) * k + 128;
    } else if (r.kind === 'replace') {
      const d = Math.hypot(red - (from[0] ?? 0), green - (from[1] ?? 0), blue - (from[2] ?? 0));
      if (d <= r.tolerance) {
        data[i] = to[0] ?? 0;
        data[i + 1] = to[1] ?? 0;
        data[i + 2] = to[2] ?? 0;
      }
    }
  }
}

async function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  if (!blob) throw new ToolError('A page could not be turned into a picture.');
  return new Uint8Array(await blob.arrayBuffer());
}

/** Every page redrawn as a picture at `dpi`, recoloured, in a new PDF of the same page sizes. Text stops being text. */
export async function rasterise(bytes: Uint8Array, r: Recolour, dpi: number, onPage: (n: number, of: number) => void = () => undefined): Promise<Uint8Array> {
  const { doc, close } = await openPdf(bytes);
  try {
    const out = await PDFDocument.create();
    for (let n = 1; n <= doc.numPages; n++) {
      onPage(n, doc.numPages);
      const page = await doc.getPage(n);
      const size = page.getViewport({ scale: 1 });
      const canvas = await renderPage(doc, n, dpi / 72);
      const ctx = canvas.getContext('2d');
      if (ctx && r.kind !== 'none') {
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        recolour(image.data, r);
        ctx.putImageData(image, 0, 0);
      }
      const png = r.kind === 'blackwhite';
      const data = await canvasBlob(canvas, png ? 'image/png' : 'image/jpeg', 0.9);
      const embedded = png ? await out.embedPng(data) : await out.embedJpg(data);
      out.addPage([size.width, size.height]).drawImage(embedded, { x: 0, y: 0, width: size.width, height: size.height });
    }
    return out.save({ useObjectStreams: true });
  } finally {
    await close();
  }
}

/** How much of a page is ink: the share of pixels darker than `level` (0–255). */
export function inkShare(data: Uint8ClampedArray, level = 230): number {
  let dark = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) if (0.2126 * (data[i] ?? 255) + 0.7152 * (data[i + 1] ?? 255) + 0.0722 * (data[i + 2] ?? 255) < level) dark++;
  return n ? dark / n : 0;
}

export interface BlankOptions {
  /** A page with less than this share of its area inked is blank (0.002 = 0.2 %). */
  readonly maxInk?: number;
  /** Pixels darker than this (0–255) count as ink. */
  readonly level?: number;
  /** A page carrying any text is kept, however little ink it has (a page with one short line, say). */
  readonly keepText?: boolean;
}

/** Pages (from 1) that are blank: no text (unless `keepText` is off) and almost no ink. */
export async function findBlankPages(bytes: Uint8Array, { maxInk = 0.002, level = 230, keepText = true }: BlankOptions = {}): Promise<number[]> {
  const { doc, close } = await openPdf(bytes);
  try {
    const blank: number[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      if (keepText && (await textItems(doc, n)).some((i) => i.str.trim())) continue;
      const canvas = await renderPage(doc, n, 0.6);
      const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
      if (data && inkShare(data, level) < maxInk) blank.push(n);
    }
    return blank;
  } finally {
    await close();
  }
}

export interface ExtractedImage {
  readonly page: number;
  readonly index: number;
  readonly width: number;
  readonly height: number;
  readonly png: Uint8Array;
}

interface PdfjsImage {
  readonly width: number;
  readonly height: number;
  readonly bitmap?: ImageBitmap;
  readonly data?: Uint8ClampedArray | Uint8Array;
  readonly kind?: number;
}

/** Draws a decoded PDF.js image on a canvas. */
function imageCanvas(img: PdfjsImage): HTMLCanvasElement | null {
  if (!(img.width > 0 && img.height > 0)) return null;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (img.bitmap) {
    ctx.drawImage(img.bitmap, 0, 0);
    return canvas;
  }
  const src = img.data;
  if (!src) return null;
  const out = ctx.createImageData(img.width, img.height);
  const px = img.width * img.height;
  if (img.kind === 3 && src.length >= px * 4) out.data.set(src.subarray(0, px * 4));
  else if (img.kind === 2 && src.length >= px * 3)
    for (let i = 0; i < px; i++) {
      out.data[i * 4] = src[i * 3] ?? 0;
      out.data[i * 4 + 1] = src[i * 3 + 1] ?? 0;
      out.data[i * 4 + 2] = src[i * 3 + 2] ?? 0;
      out.data[i * 4 + 3] = 255;
    }
  else if (img.kind === 1) {
    // One bit a pixel, rows padded to whole bytes; 1 is white.
    const row = Math.ceil(img.width / 8);
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const bit = ((src[y * row + (x >> 3)] ?? 0) >> (7 - (x & 7))) & 1;
        const v = bit ? 255 : 0;
        const i = (y * img.width + x) * 4;
        out.data[i] = v;
        out.data[i + 1] = v;
        out.data[i + 2] = v;
        out.data[i + 3] = 255;
      }
  } else return null;
  ctx.putImageData(out, 0, 0);
  return canvas;
}

/** The pictures in a PDF, each once, as PNG files. */
export async function extractImages(bytes: Uint8Array, minSide = 16, onPage: (n: number, of: number) => void = () => undefined): Promise<ExtractedImage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
  const { doc, close } = await openPdf(bytes);
  try {
    const out: ExtractedImage[] = [];
    const seen = new Set<string>();
    const wanted = new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageXObjectRepeat]);
    for (let n = 1; n <= doc.numPages; n++) {
      onPage(n, doc.numPages);
      const page = await doc.getPage(n);
      const ops = await page.getOperatorList();
      let index = 0;
      for (let i = 0; i < ops.fnArray.length; i++) {
        if (!wanted.has(ops.fnArray[i] as number)) continue;
        const arg = (ops.argsArray[i] as unknown[] | undefined)?.[0];
        let img: PdfjsImage | null = null;
        if (typeof arg === 'string') {
          if (seen.has(arg)) continue;
          seen.add(arg);
          const store = arg.startsWith('g_') ? page.commonObjs : page.objs;
          try {
            img = (store.get(arg) as PdfjsImage | null) ?? null;
          } catch {
            img = null;
          }
        } else if (arg && typeof arg === 'object') img = arg as PdfjsImage;
        if (!img || img.width < minSide || img.height < minSide) continue;
        const canvas = imageCanvas(img);
        if (!canvas) continue;
        index++;
        out.push({ page: n, index, width: img.width, height: img.height, png: await canvasBlob(canvas, 'image/png') });
      }
      page.cleanup();
    }
    return out;
  } finally {
    await close();
  }
}

interface TextItem {
  readonly str: string;
  readonly transform: number[];
}

async function textItems(doc: PdfDocument, n: number): Promise<TextItem[]> {
  const page = await doc.getPage(n);
  const content = await page.getTextContent();
  return (content.items as unknown[]).filter((i): i is TextItem => typeof (i as TextItem).str === 'string' && Array.isArray((i as TextItem).transform));
}

/** The way most of a page's text runs, in degrees anticlockwise (0, 90, 180 or 270), or null with no text. */
export function dominantAngle(items: readonly { str: string; transform: readonly number[] }[]): number | null {
  const weight = new Map<number, number>();
  for (const it of items) {
    const len = it.str.trim().length;
    if (!len) continue;
    const [a = 1, b = 0] = it.transform;
    const angle = (((Math.round((Math.atan2(b, a) * 180) / Math.PI / 90) * 90) % 360) + 360) % 360;
    weight.set(angle, (weight.get(angle) ?? 0) + len);
  }
  if (!weight.size) return null;
  return [...weight.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
}

/** For each page, the rotation that makes its text read upright (null where there is no text to go by). */
export async function uprightRotations(bytes: Uint8Array): Promise<(number | null)[]> {
  const { doc, close } = await openPdf(bytes);
  try {
    const out: (number | null)[] = [];
    for (let n = 1; n <= doc.numPages; n++) out.push(dominantAngle(await textItems(doc, n)));
    return out;
  } finally {
    await close();
  }
}

/** How many pages carry any text at all. */
export async function pagesWithText(bytes: Uint8Array): Promise<{ withText: number; total: number }> {
  const { doc, close } = await openPdf(bytes);
  try {
    let withText = 0;
    for (let n = 1; n <= doc.numPages; n++) if ((await textItems(doc, n)).some((i) => i.str.trim())) withText++;
    return { withText, total: doc.numPages };
  } finally {
    await close();
  }
}

/** A title from the biggest text near the top of the first page. */
export function titleFromItems(items: readonly { str: string; transform: readonly number[] }[], pageHeight: number): string {
  const sized = items.filter((i) => i.str.trim()).map((i) => ({ text: i.str.trim(), size: Math.hypot(i.transform[0] ?? 0, i.transform[1] ?? 0), y: i.transform[5] ?? 0, x: i.transform[4] ?? 0 }));
  const top = sized.filter((i) => i.y > pageHeight * 0.35);
  const pool = top.length ? top : sized;
  const biggest = Math.max(0, ...pool.map((i) => i.size));
  if (!biggest) return '';
  return pool
    .filter((i) => i.size >= biggest * 0.9)
    .sort((a, b) => b.y - a.y || a.x - b.x)
    .map((i) => i.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/** Text fit for a file name. */
export const fileNameFrom = (title: string) =>
  title
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '');

export async function guessTitle(bytes: Uint8Array): Promise<string> {
  const { doc, close } = await openPdf(bytes);
  try {
    const meta = await doc.getMetadata().catch(() => null);
    const page = await doc.getPage(1);
    const height = page.getViewport({ scale: 1 }).height;
    const fromText = titleFromItems(await textItems(doc, 1), height);
    const fromInfo = String((meta?.info as Record<string, unknown> | undefined)?.Title ?? '').trim();
    return fileNameFrom(fromText || fromInfo);
  } finally {
    await close();
  }
}

/* ------------------------------------------------------------ photos -- */

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Regions that stand out from the background (photos on a scanner bed):
 * the picture is cut into cells, cells unlike the background colour are
 * joined into groups, and each big enough group gives a box.
 */
export function findRegions(data: Uint8ClampedArray, width: number, height: number, options: { cell?: number; minShare?: number; difference?: number } = {}): Box[] {
  const cell = options.cell ?? 8;
  const minShare = options.minShare ?? 0.01;
  const difference = options.difference ?? 40;
  // The background: the commonest colour along the edges.
  const edge: number[][] = [];
  for (let x = 0; x < width; x += 4) edge.push([x, 0], [x, height - 1]);
  for (let y = 0; y < height; y += 4) edge.push([0, y], [width - 1, y]);
  const px = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return [data[i] ?? 255, data[i + 1] ?? 255, data[i + 2] ?? 255] as const;
  };
  const sums = [0, 0, 0];
  for (const [x = 0, y = 0] of edge) {
    const c = px(x, y);
    sums[0] = (sums[0] ?? 0) + c[0];
    sums[1] = (sums[1] ?? 0) + c[1];
    sums[2] = (sums[2] ?? 0) + c[2];
  }
  const bg = sums.map((s) => s / Math.max(1, edge.length));
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const on = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      let differ = 0;
      let count = 0;
      for (let y = cy * cell; y < Math.min(height, (cy + 1) * cell); y += 2)
        for (let x = cx * cell; x < Math.min(width, (cx + 1) * cell); x += 2) {
          const c = px(x, y);
          if (Math.hypot(c[0] - (bg[0] ?? 255), c[1] - (bg[1] ?? 255), c[2] - (bg[2] ?? 255)) > difference) differ++;
          count++;
        }
      on[cy * cols + cx] = differ > count * 0.25 ? 1 : 0;
    }
  // Close small gaps: a cell counts when any neighbour does.
  const grown = new Uint8Array(on.length);
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      let any = 0;
      for (let dy = -1; dy <= 1 && !any; dy++)
        for (let dx = -1; dx <= 1 && !any; dx++) any = on[(cy + dy) * cols + (cx + dx)] && cy + dy >= 0 && cy + dy < rows && cx + dx >= 0 && cx + dx < cols ? 1 : 0;
      grown[cy * cols + cx] = any;
    }
  // Groups of joined cells; each group's box is drawn round its original (not grown) cells.
  const label = new Uint8Array(on.length);
  const boxes: Box[] = [];
  for (let start = 0; start < grown.length; start++) {
    if (!grown[start] || label[start]) continue;
    const stack = [start];
    label[start] = 1;
    let x0 = cols;
    let y0 = rows;
    let x1 = -1;
    let y1 = -1;
    let cells = 0;
    while (stack.length) {
      const k = stack.pop() as number;
      const cx = k % cols;
      const cy = Math.floor(k / cols);
      if (on[k]) {
        cells++;
        x0 = Math.min(x0, cx);
        y0 = Math.min(y0, cy);
        x1 = Math.max(x1, cx);
        y1 = Math.max(y1, cy);
      }
      for (const [nx, ny] of [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1],
      ] as const) {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const nk = ny * cols + nx;
        if (grown[nk] && !label[nk]) {
          label[nk] = 1;
          stack.push(nk);
        }
      }
    }
    if (x1 < 0) continue;
    const box = { x: x0 * cell, y: y0 * cell, width: Math.min(width, (x1 + 1) * cell) - x0 * cell, height: Math.min(height, (y1 + 1) * cell) - y0 * cell };
    if (cells * cell * cell >= width * height * minShare && box.width > 2 * cell && box.height > 2 * cell) boxes.push(box);
  }
  return boxes;
}

/** Each photo on each scanned page, cut out as a PNG. */
export async function splitPhotos(bytes: Uint8Array, dpi = 150, onPage: (n: number, of: number) => void = () => undefined): Promise<ExtractedImage[]> {
  const { doc, close } = await openPdf(bytes);
  try {
    const out: ExtractedImage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      onPage(n, doc.numPages);
      const canvas = await renderPage(doc, n, dpi / 72);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const boxes = findRegions(data, canvas.width, canvas.height);
      let index = 0;
      for (const b of boxes) {
        const crop = document.createElement('canvas');
        crop.width = Math.round(b.width);
        crop.height = Math.round(b.height);
        crop.getContext('2d')?.drawImage(canvas, b.x, b.y, b.width, b.height, 0, 0, b.width, b.height);
        index++;
        out.push({ page: n, index, width: crop.width, height: crop.height, png: await canvasBlob(crop, 'image/png') });
      }
    }
    return out;
  } finally {
    await close();
  }
}
