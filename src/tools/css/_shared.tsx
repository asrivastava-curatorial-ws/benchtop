/** Helpers shared by the CSS generators. */
import { cssColor, trimNumber } from '../../lib/color';
import { context2d, createCanvas, encodeCanvas, rasterizeSvg } from '../../ui/canvas';
import type { CodeOutput, Download } from '../types';

export type Declaration = readonly [property: string, value: string];

/** `a: b; c: d;` for a style attribute (Preact accepts a string). */
export function inline(declarations: readonly Declaration[]): string {
  return declarations.map(([property, value]) => `${property}: ${value};`).join(' ');
}

export function rule(selector: string, declarations: readonly Declaration[]): string {
  if (declarations.length === 0) return `${selector} {}\n`;
  return `${selector} {\n${declarations.map(([property, value]) => `  ${property}: ${value};`).join('\n')}\n}\n`;
}

export const px = (value: number): string => (value === 0 ? '0' : `${trimNumber(value, 2)}px`);
export const pct = (value: number): string => `${trimNumber(value, 2)}%`;
export const deg = (value: number): string => `${trimNumber(value, 2)}deg`;
export const num = (value: number, digits = 3): string => trimNumber(value, digits);
export const color = cssColor;

/** A Tailwind arbitrary value: spaces become underscores. */
export function arbitrary(value: string): string {
  return `[${value.replace(/_/g, '\\_').replace(/\s+/g, '_')}]`;
}

/** A Tailwind arbitrary property utility, e.g. `[text-shadow:...]`. */
export function arbitraryProperty(property: string, value: string): string {
  return `[${property}:${value.replace(/_/g, '\\_').replace(/\s+/g, '_')}]`;
}

export const css = (code: string, label = 'CSS', filename?: string): CodeOutput => ({ label, language: 'css', code, filename });
export const html = (code: string, label = 'HTML', filename?: string): CodeOutput => ({ label, language: 'html', code, filename });
export const xml = (code: string, label: string, filename?: string): CodeOutput => ({ label, language: 'xml', code, filename });
export const js = (code: string, label: string, filename?: string): CodeOutput => ({ label, language: 'javascript', code, filename });
export const text = (code: string, label: string, filename?: string): CodeOutput => ({ label, language: 'text', code, filename });

export function tailwind(classes: readonly (string | false | null | undefined)[], note?: string): CodeOutput {
  const list = classes.filter(Boolean).join(' ');
  return { label: 'Tailwind', language: 'html', code: `${note ? `<!-- ${note} -->\n` : ''}<div class="${list}"></div>\n` };
}

async function pngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return encodeCanvas(canvas, { format: 'png', quality: 100 });
}

export function svgDownload(svg: () => string, filename: string): Download {
  return { label: 'SVG', filename, make: () => svg() };
}

export function svgPngDownload(svg: () => string, width: number, height: number, filename: string, label = 'PNG'): Download {
  return { label, filename, make: async () => pngBlob(await rasterizeSvg(svg(), width, height)) };
}

/** A PNG drawn by a canvas routine. */
export function canvasPngDownload(draw: (context: CanvasRenderingContext2D, width: number, height: number) => void, width: number, height: number, filename: string, label = 'PNG'): Download {
  return {
    label,
    filename,
    make: async () => {
      const canvas = createCanvas(width, height);
      draw(context2d(canvas), canvas.width, canvas.height);
      return pngBlob(canvas);
    },
  };
}

export function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** A data URI for SVG that is safe inside `url("...")`. */
export function svgDataUri(svg: string): string {
  const compact = svg
    .replace(/\s*\n\s*/g, ' ')
    .replace(/"/g, "'")
    .replace(/[\r\n%#()<>?[\\\]^`{|}]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
  return `data:image/svg+xml,${compact}`;
}

/** Sample artwork for previews (an original illustration, embedded so nothing loads from the network). */
export const SAMPLE_SCENE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d4e89"/><stop offset=".55" stop-color="#f0a35e"/><stop offset="1" stop-color="#f6d6a8"/></linearGradient></defs>
<rect width="480" height="320" fill="url(#sky)"/>
<circle cx="350" cy="150" r="48" fill="#ffe08a"/>
<path d="M0 230 L90 150 L170 220 L250 130 L360 230 L480 170 V320 H0Z" fill="#2f5d50"/>
<path d="M0 260 Q120 220 240 262 T480 250 V320 H0Z" fill="#17694e"/>
<rect x="60" y="250" width="70" height="40" fill="#c8962e"/><path d="M52 252 L95 222 L138 252Z" fill="#8a3b2e"/>
<rect x="88" y="266" width="14" height="24" fill="#3b2a1e"/>
</svg>`;
