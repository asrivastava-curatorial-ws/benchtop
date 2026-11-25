/** The text of a PDF page with the place of each piece (PDF.js), for redaction and hidden text layers. */

import type { TextItem } from './pdf-redact';
import type { PdfDocument } from './pdf-render';

type Matrix = readonly number[];

const multiply = (m: Matrix, n: Matrix): number[] => {
  const [a, b, c, d, e, f] = m as [number, number, number, number, number, number];
  const [g, h, i, j, k, l] = n as [number, number, number, number, number, number];
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
};

let ruler: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;

/**
 * Where each character of a piece begins, as fractions of the piece's width, measured with a
 * font of the same kind (PDF.js does not hand out the widths of single characters).
 */
function cutsOf(text: string, family: string): number[] | undefined {
  if (ruler === undefined) {
    ruler = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1).getContext('2d') : typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  }
  if (!ruler || text.length < 2) return undefined;
  ruler.font = `100px ${family}`;
  const cuts = [0];
  let sum = 0;
  for (const char of text) {
    sum += ruler.measureText(char).width;
    // One entry per UTF-16 unit, so the places agree with string indexes.
    for (let i = 0; i < char.length; i++) cuts.push(sum);
  }
  return sum > 0 ? cuts.map((at) => at / sum) : undefined;
}

export interface PageText {
  /** Size of the page as shown, in points. */
  readonly width: number;
  readonly height: number;
  readonly items: TextItem[];
}

/** One page's text pieces as boxes with the origin at the top left of the shown page. */
export async function pageText(doc: PdfDocument, number: number): Promise<PageText> {
  const page = await doc.getPage(number);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const styles = content.styles as Record<string, { fontFamily?: string } | undefined>;
  const items: TextItem[] = [];
  for (const item of content.items) {
    if (!('str' in item) || !item.str) continue;
    const m = multiply(viewport.transform, item.transform);
    // The baseline runs along (m0, m1), the glyphs rise along (m2, m3); in view space y grows downwards.
    const size = Math.hypot(m[2] as number, m[3] as number) || item.height || 1;
    const along = Math.hypot(m[0] as number, m[1] as number) || 1;
    const ux = (m[0] as number) / along;
    const uy = (m[1] as number) / along;
    const vx = (m[2] as number) / size;
    const vy = (m[3] as number) / size;
    const x0 = m[4] as number;
    const y0 = m[5] as number;
    const w = item.width;
    // Corners: a quarter of the size below the baseline (descenders) to the full size above it.
    const corners = [
      [x0 - vx * size * 0.25, y0 - vy * size * 0.25],
      [x0 + ux * w - vx * size * 0.25, y0 + uy * w - vy * size * 0.25],
      [x0 + vx * size, y0 + vy * size],
      [x0 + ux * w + vx * size, y0 + uy * w + vy * size],
    ] as const;
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const family = styles[item.fontName]?.fontFamily;
    const turned = Math.abs(uy) > 0.02;
    items.push({
      text: item.str,
      x,
      y,
      w: Math.max(...xs) - x,
      h: Math.max(...ys) - y,
      whole: turned || undefined,
      cuts: turned ? undefined : cutsOf(item.str, family === 'serif' || family === 'monospace' ? family : 'sans-serif'),
    });
  }
  page.cleanup();
  return { width: viewport.width, height: viewport.height, items };
}
