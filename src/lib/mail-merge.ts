/**
 * Mail merge to PDF: certificates, ID and name badges and address labels from
 * rows of data.  A layout is a card (in millimetres) with text, pictures, QR
 * codes, barcodes, lines and boxes on it; `{{Column}}` in any text is replaced
 * by that row's value.  Cards print one per page or several to a sheet (label
 * stationery, badge sheets) with optional cut marks.
 */
import { clip, endPath, PDFDocument, type PDFFont, type PDFImage, type PDFPage, popGraphicsState, pushGraphicsState, rectangle, rgb } from 'pdf-lib';
import { drawText, embedFontBytes, finishFonts, fontsFor, textWidth } from './pdf-text';

export const MM = 72 / 25.4;

export type Align = 'left' | 'center' | 'right';
export type ItemKind = 'text' | 'image' | 'qr' | 'barcode' | 'line' | 'box';

export interface Item {
  readonly id: string;
  readonly kind: ItemKind;
  /** Position and size in millimetres from the card's top-left corner. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Text (with {{Column}} fields), QR or barcode content, or the picture: "background", "logo" or a field naming a photo file. */
  readonly text: string;
  /** Font size in points (text). */
  readonly size: number;
  readonly bold: boolean;
  readonly align: Align;
  readonly color: string;
  /** Box fill ("" for none) and line or border width in millimetres. */
  readonly fill: string;
  readonly stroke: number;
  readonly fit: 'cover' | 'contain';
}

export interface Sheet {
  readonly paper: readonly [number, number];
  readonly cols: number;
  readonly rows: number;
  /** Top-left of the first card and the distance from one card to the next, in mm. */
  readonly left: number;
  readonly top: number;
  readonly pitchX: number;
  readonly pitchY: number;
}

export interface Layout {
  readonly card: { readonly w: number; readonly h: number };
  /** Several cards to a page; without it each card is its own page. */
  readonly sheet: Sheet | null;
  readonly items: readonly Item[];
  readonly cutMarks: boolean;
  readonly outlines: boolean;
}

export interface Picture {
  readonly bytes: Uint8Array;
  readonly type: 'png' | 'jpg';
}

export interface Assets {
  readonly background?: Picture | null;
  readonly logo?: Picture | null;
  /** Photos by lower-case file name, with and without the extension. */
  readonly photos?: ReadonlyMap<string, Picture>;
  /** Optional fonts for scripts Benchtop Sans does not cover. */
  readonly font?: Uint8Array | null;
  readonly boldFont?: Uint8Array | null;
}

export type Row = Readonly<Record<string, string>>;

/* ------------------------------------------------------------ presets -- */

export interface Preset {
  readonly id: string;
  readonly name: string;
  readonly group: 'Certificates' | 'Badges' | 'Labels';
  readonly card: { readonly w: number; readonly h: number };
  readonly sheet: Sheet | null;
}

const A4: readonly [number, number] = [210, 297];
const LETTER: readonly [number, number] = [215.9, 279.4];
const inch = (n: number) => Math.round(n * 25.4 * 1000) / 1000;

/** Common stationery.  Label positions follow the makers' templates (Avery and compatible). */
export const PRESETS: readonly Preset[] = [
  { id: 'cert-a4', name: 'Certificate, A4 landscape', group: 'Certificates', card: { w: 297, h: 210 }, sheet: null },
  { id: 'cert-letter', name: 'Certificate, Letter landscape', group: 'Certificates', card: { w: 279.4, h: 215.9 }, sheet: null },
  { id: 'cert-a5', name: 'Certificate, A5 landscape', group: 'Certificates', card: { w: 210, h: 148 }, sheet: null },
  { id: 'id-card', name: 'ID card 85.6 × 54 mm (CR80), 10 per A4', group: 'Badges', card: { w: 85.6, h: 54 }, sheet: { paper: A4, cols: 2, rows: 5, left: 15, top: 13.5, pitchX: 95, pitchY: 54 } },
  {
    id: 'id-card-portrait',
    name: 'ID card portrait 54 × 85.6 mm, 9 per A4',
    group: 'Badges',
    card: { w: 54, h: 85.6 },
    sheet: { paper: A4, cols: 3, rows: 3, left: 15, top: 15, pitchX: 63, pitchY: 89 },
  },
  { id: 'name-badge', name: 'Name badge 4 × 3 in, 6 per A4', group: 'Badges', card: { w: 101.6, h: 76.2 }, sheet: { paper: A4, cols: 2, rows: 3, left: 3.4, top: 34.2, pitchX: 101.6, pitchY: 76.2 } },
  {
    id: 'l7160',
    name: 'Labels 63.5 × 38.1 mm, 21 per A4 (L7160)',
    group: 'Labels',
    card: { w: 63.5, h: 38.1 },
    sheet: { paper: A4, cols: 3, rows: 7, left: 7.2, top: 15.15, pitchX: 66.04, pitchY: 38.1 },
  },
  {
    id: 'l7163',
    name: 'Labels 99.1 × 38.1 mm, 14 per A4 (L7163)',
    group: 'Labels',
    card: { w: 99.1, h: 38.1 },
    sheet: { paper: A4, cols: 2, rows: 7, left: 4.65, top: 15.15, pitchX: 101.6, pitchY: 38.1 },
  },
  { id: 'l7173', name: 'Labels 99.1 × 57 mm, 10 per A4 (L7173)', group: 'Labels', card: { w: 99.1, h: 57 }, sheet: { paper: A4, cols: 2, rows: 5, left: 4.65, top: 6, pitchX: 101.6, pitchY: 57 } },
  {
    id: 'l7651',
    name: 'Labels 38.1 × 21.2 mm, 65 per A4 (L7651)',
    group: 'Labels',
    card: { w: 38.1, h: 21.2 },
    sheet: { paper: A4, cols: 5, rows: 13, left: 4.75, top: 10.7, pitchX: 40.64, pitchY: 21.2 },
  },
  {
    id: '5160',
    name: 'Labels 2⅝ × 1 in, 30 per Letter (5160)',
    group: 'Labels',
    card: { w: inch(2.625), h: inch(1) },
    sheet: { paper: LETTER, cols: 3, rows: 10, left: inch(0.1875), top: inch(0.5), pitchX: inch(2.75), pitchY: inch(1) },
  },
  {
    id: '5163',
    name: 'Labels 4 × 2 in, 10 per Letter (5163)',
    group: 'Labels',
    card: { w: inch(4), h: inch(2) },
    sheet: { paper: LETTER, cols: 2, rows: 5, left: inch(0.15625), top: inch(0.5), pitchX: inch(4.1875), pitchY: inch(2) },
  },
];

let counter = 0;
const id = () => `i${Date.now().toString(36)}${(counter++).toString(36)}`;

export function item(kind: ItemKind, props: Partial<Omit<Item, 'kind' | 'id'>> = {}): Item {
  return {
    id: id(),
    kind,
    x: 10,
    y: 10,
    w: kind === 'qr' ? 20 : 60,
    h: kind === 'line' ? 0 : kind === 'qr' ? 20 : 12,
    text: kind === 'image' ? 'logo' : kind === 'qr' || kind === 'barcode' ? '{{ID}}' : kind === 'text' ? 'Text' : '',
    size: 14,
    bold: false,
    align: 'left',
    color: '#000000',
    fill: '',
    stroke: kind === 'line' ? 0.3 : kind === 'box' ? 0.5 : 0,
    fit: kind === 'image' && props.text === 'background' ? 'cover' : 'contain',
    ...props,
  };
}

/** A starting design for each kind of stationery, sized to its card. */
export function starterItems(preset: Preset): Item[] {
  const { w, h } = preset.card;
  if (preset.group === 'Certificates') {
    const s = w / 297;
    return [
      item('box', { x: 8 * s, y: 8 * s, w: w - 16 * s, h: h - 16 * s, stroke: 1.2 * s, color: '#7a5c1e' }),
      item('box', { x: 11 * s, y: 11 * s, w: w - 22 * s, h: h - 22 * s, stroke: 0.4 * s, color: '#7a5c1e' }),
      item('image', { text: 'logo', x: w / 2 - 14 * s, y: 18 * s, w: 28 * s, h: 22 * s }),
      item('text', { text: 'Certificate of Participation', x: 20 * s, y: 44 * s, w: w - 40 * s, h: 16 * s, size: 34 * s, bold: true, align: 'center', color: '#5b4413' }),
      item('text', { text: 'This is to certify that', x: 20 * s, y: 68 * s, w: w - 40 * s, h: 9 * s, size: 14 * s, align: 'center', color: '#333333' }),
      item('text', { text: '{{Name}}', x: 30 * s, y: 80 * s, w: w - 60 * s, h: 16 * s, size: 30 * s, bold: true, align: 'center' }),
      item('line', { x: 70 * s, y: 98 * s, w: w - 140 * s, stroke: 0.3 * s, color: '#7a5c1e' }),
      item('text', { text: 'of {{School}} took part in {{Event}}\nheld on {{Date}} at the museum.', x: 30 * s, y: 104 * s, w: w - 60 * s, h: 22 * s, size: 15 * s, align: 'center', color: '#333333' }),
      item('line', { x: 40 * s, y: 165 * s, w: 60 * s, stroke: 0.3 * s }),
      item('text', { text: 'Education Officer', x: 40 * s, y: 167 * s, w: 60 * s, h: 7 * s, size: 11 * s, align: 'center', color: '#333333' }),
      item('line', { x: w - 100 * s, y: 165 * s, w: 60 * s, stroke: 0.3 * s }),
      item('text', { text: 'Director', x: w - 100 * s, y: 167 * s, w: 60 * s, h: 7 * s, size: 11 * s, align: 'center', color: '#333333' }),
      item('qr', { text: '{{ID}}', x: w / 2 - 9 * s, y: 158 * s, w: 18 * s, h: 18 * s }),
      item('text', { text: 'Certificate {{ID}}', x: w / 2 - 30 * s, y: 177 * s, w: 60 * s, h: 5 * s, size: 8 * s, align: 'center', color: '#555555' }),
    ];
  }
  if (preset.group === 'Badges') {
    const portrait = h > w;
    const band = Math.min(h, w) * 0.24;
    if (portrait)
      return [
        item('box', { x: 0, y: 0, w, h: band, fill: '#1f6f50', stroke: 0, color: '#1f6f50' }),
        item('text', { text: 'Visvesvaraya Museum', x: 3, y: band * 0.25, w: w - 6, h: band * 0.5, size: band * 1.15, bold: true, align: 'center', color: '#ffffff' }),
        item('image', { text: '{{Photo}}', x: w / 2 - w * 0.28, y: band + 4, w: w * 0.56, h: w * 0.66, fit: 'cover' }),
        item('text', { text: '{{Name}}', x: 3, y: band + 6 + w * 0.66, w: w - 6, h: 7, size: 13, bold: true, align: 'center' }),
        item('text', { text: '{{Role}}', x: 3, y: band + 13 + w * 0.66, w: w - 6, h: 5, size: 9, align: 'center', color: '#444444' }),
        item('barcode', { text: '{{ID}}', x: 6, y: h - 13, w: w - 12, h: 10 }),
      ];
    return [
      item('box', { x: 0, y: 0, w, h: band, fill: '#1f6f50', stroke: 0, color: '#1f6f50' }),
      item('text', { text: 'Visvesvaraya Museum', x: 4, y: band * 0.2, w: w - 8, h: band * 0.6, size: band * 1.25, bold: true, align: 'left', color: '#ffffff' }),
      item('image', { text: '{{Photo}}', x: 4, y: band + 3, w: (h - band - 6) * 0.8, h: h - band - 6, fit: 'cover' }),
      item('text', { text: '{{Name}}', x: 8 + (h - band - 6) * 0.8, y: band + 4, w: w - 12 - (h - band - 6) * 0.8, h: 7, size: 12, bold: true }),
      item('text', { text: '{{Role}}', x: 8 + (h - band - 6) * 0.8, y: band + 11, w: w - 12 - (h - band - 6) * 0.8, h: 5, size: 8.5, color: '#444444' }),
      item('qr', { text: '{{ID}}', x: w - 4 - (h - band) * 0.48, y: h - 3 - (h - band) * 0.48, w: (h - band) * 0.48, h: (h - band) * 0.48 }),
      item('text', { text: 'ID {{ID}}', x: 8 + (h - band - 6) * 0.8, y: h - 9, w: w - 4 - (h - band) * 0.48 - 10 - (h - band - 6) * 0.8, h: 5, size: 8, color: '#444444' }),
    ];
  }
  // Labels: a name and an address block.
  const pad = Math.min(4, w * 0.06);
  return [
    item('text', { text: '{{Name}}', x: pad, y: pad, w: w - 2 * pad, h: h * 0.24, size: Math.min(12, h * 0.26), bold: true }),
    item('text', { text: '{{Address}}\n{{City}} {{PIN}}', x: pad, y: pad + h * 0.26, w: w - 2 * pad, h: h - 2 * pad - h * 0.26, size: Math.min(10, h * 0.2) }),
  ];
}

/* ---------------------------------------------------------- templates -- */

const TITLE_CASE = (s: string) => s.toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());

/** Fills {{Column}} fields (any case), {{#}} (the row number) and {{today}}; "|upper", "|lower" and "|title" change the case. */
export function fillTemplate(template: string, row: Row, index: number, today = new Date()): string {
  const keys = Object.keys(row);
  return template.replace(/\{\{\s*([^}|]+?)\s*(?:\|\s*(upper|lower|title)\s*)?\}\}/gi, (_, name: string, filter: string | undefined) => {
    let value: string;
    if (name === '#') value = String(index + 1);
    else if (name.toLowerCase() === 'today') value = today.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    else {
      const key = name in row ? name : keys.find((k) => k.toLowerCase() === name.toLowerCase());
      value = key === undefined ? '' : (row[key] ?? '');
    }
    const f = filter?.toLowerCase();
    return f === 'upper' ? value.toUpperCase() : f === 'lower' ? value.toLowerCase() : f === 'title' ? TITLE_CASE(value) : value;
  });
}

/** Field names used anywhere in a layout, to point out columns the data lacks. */
export function fieldsUsed(layout: Layout): string[] {
  const names = new Set<string>();
  for (const it of layout.items) for (const m of it.text.matchAll(/\{\{\s*([^}|]+?)\s*(?:\|[^}]*)?\}\}/g)) if (m[1] !== '#' && m[1]?.toLowerCase() !== 'today') names.add(m[1] as string);
  return [...names];
}

export const hexColor = (hex: string) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  return m ? rgb(Number.parseInt(m[1] as string, 16) / 255, Number.parseInt(m[2] as string, 16) / 255, Number.parseInt(m[3] as string, 16) / 255) : rgb(0, 0, 0);
};

export function findPhoto(photos: ReadonlyMap<string, Picture> | undefined, name: string): Picture | null {
  if (!photos || !name.trim()) return null;
  const key = name
    .trim()
    .toLowerCase()
    .replace(/^.*[\\/]/, '');
  return photos.get(key) ?? photos.get(key.replace(/\.[^.]+$/, '')) ?? null;
}

/* ------------------------------------------------------------ drawing -- */

interface Context {
  readonly doc: PDFDocument;
  readonly regular: PDFFont;
  readonly bold: PDFFont;
  readonly images: Map<string, Promise<PDFImage>>;
  readonly codes: Map<string, Promise<ParsedSvg | null>>;
  readonly assets: Assets;
}

interface ParsedSvg {
  readonly width: number;
  readonly height: number;
  readonly paths: readonly { readonly d: string; readonly stroke: number }[];
}

async function codeSvg(kind: 'qr' | 'barcode', text: string): Promise<ParsedSvg | null> {
  if (!text) return null;
  const { toSVG } = await import('bwip-js/generic');
  let svg: string;
  try {
    svg = toSVG(kind === 'qr' ? { bcid: 'qrcode', text, scale: 1 } : { bcid: 'code128', text, scale: 1, height: 10, includetext: true, textxalign: 'center' });
  } catch {
    return null;
  }
  const box = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!box) return null;
  const paths = [...svg.matchAll(/<path([^>]*)\/?>/g)].map((m) => {
    const attrs = m[1] as string;
    return { d: /\sd="([^"]+)"/.exec(attrs)?.[1] ?? '', stroke: /stroke="[^"n]/.test(attrs) ? Number(/stroke-width="([\d.]+)"/.exec(attrs)?.[1] ?? 1) : 0 };
  });
  return { width: Number(box[1]), height: Number(box[2]), paths: paths.filter((p) => p.d) };
}

function embedPicture(ctx: Context, key: string, picture: Picture): Promise<PDFImage> {
  let image = ctx.images.get(key);
  if (!image) {
    image = picture.type === 'png' ? ctx.doc.embedPng(picture.bytes) : ctx.doc.embedJpg(picture.bytes);
    ctx.images.set(key, image);
  }
  return image;
}

/** Splits text into lines that fit `width` at `size`, breaking at spaces. */
function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/ +/);
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(font, next, size) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/** Lines and the size that fits a text item's box: smaller type before wrapping, and only as far as half size. */
export function fitText(font: PDFFont, text: string, item: Pick<Item, 'w' | 'h' | 'size'>): { lines: string[]; size: number } {
  const width = item.w * MM;
  const height = Math.max(item.h, 1) * MM;
  const given = text.split('\n');
  let size = item.size;
  const widest = (s: number) => Math.max(...given.map((l) => textWidth(font, l, s)));
  // Shrink up to half size to keep each written line on one line.
  while (size > item.size / 2 && (widest(size) > width || given.length * size * 1.2 > height)) size -= 0.25;
  if (widest(size) <= width && given.length * size * 1.2 <= height * 1.05) return { lines: given, size };
  // Then wrap at the original size, shrinking until the block fits.
  size = item.size;
  let lines = wrap(font, text, size, width);
  while (size > 4 && (lines.length * size * 1.2 > height || Math.max(...lines.map((l) => textWidth(font, l, size))) > width)) {
    size -= 0.25;
    lines = wrap(font, text, size, width);
  }
  return { lines, size };
}

/** Draws one card with its top-left corner at (ox, oy) mm on a page `pageH` mm tall. */
async function drawCard(ctx: Context, page: PDFPage, layout: Layout, row: Row, index: number, ox: number, oy: number, pageH: number): Promise<void> {
  const px = (mm: number) => (ox + mm) * MM;
  const py = (mm: number) => (pageH - oy - mm) * MM;
  const { w: cw, h: ch } = layout.card;
  // Nothing spills over into the neighbouring card.
  page.pushOperators(pushGraphicsState(), rectangle(px(0), py(ch), cw * MM, ch * MM), clip(), endPath());
  for (const it of layout.items) {
    const color = hexColor(it.color);
    if (it.kind === 'box') {
      page.drawRectangle({
        x: px(it.x),
        y: py(it.y + it.h),
        width: it.w * MM,
        height: it.h * MM,
        color: it.fill ? hexColor(it.fill) : undefined,
        borderColor: it.stroke > 0 ? color : undefined,
        borderWidth: it.stroke > 0 ? it.stroke * MM : 0,
      });
    } else if (it.kind === 'line') {
      page.drawLine({ start: { x: px(it.x), y: py(it.y) }, end: { x: px(it.x + it.w), y: py(it.y) }, thickness: Math.max(0.1, it.stroke * MM), color });
    } else if (it.kind === 'text') {
      const text = fillTemplate(it.text, row, index).trim();
      if (!text) continue;
      const font = it.bold ? ctx.bold : ctx.regular;
      const { lines, size } = fitText(font, text, it);
      const lineHeight = size * 1.2;
      // The block is centred vertically in the box; cap height is about 0.7 em.
      const blockTop = py(it.y) - (it.h * MM - lines.length * lineHeight) / 2;
      lines.forEach((line, i) => {
        const width = textWidth(font, line, size);
        const x = it.align === 'center' ? px(it.x) + (it.w * MM - width) / 2 : it.align === 'right' ? px(it.x + it.w) - width : px(it.x);
        const baseline = blockTop - i * lineHeight - (lineHeight + size * 0.7) / 2;
        drawText(page, font, line, { x, y: baseline, size, color });
      });
    } else if (it.kind === 'image') {
      const name = it.text.trim().toLowerCase();
      let picture: Picture | null | undefined;
      let key: string;
      if (name === 'background') [picture, key] = [ctx.assets.background, 'background'];
      else if (name === 'logo') [picture, key] = [ctx.assets.logo, 'logo'];
      else {
        const file = fillTemplate(it.text, row, index);
        [picture, key] = [findPhoto(ctx.assets.photos, file), `photo:${file.toLowerCase()}`];
      }
      if (!picture) {
        // A placeholder shows where the picture goes.
        page.drawRectangle({ x: px(it.x), y: py(it.y + it.h), width: it.w * MM, height: it.h * MM, borderColor: rgb(0.75, 0.75, 0.75), borderWidth: 0.5, borderDashArray: [3, 2] });
        continue;
      }
      const image = await embedPicture(ctx, key, picture);
      const scale = it.fit === 'cover' ? Math.max((it.w * MM) / image.width, (it.h * MM) / image.height) : Math.min((it.w * MM) / image.width, (it.h * MM) / image.height);
      const iw = image.width * scale;
      const ih = image.height * scale;
      const x = px(it.x) + (it.w * MM - iw) / 2;
      const y = py(it.y + it.h) + (it.h * MM - ih) / 2;
      if (it.fit === 'cover') page.pushOperators(pushGraphicsState(), rectangle(px(it.x), py(it.y + it.h), it.w * MM, it.h * MM), clip(), endPath());
      page.drawImage(image, { x, y, width: iw, height: ih });
      if (it.fit === 'cover') page.pushOperators(popGraphicsState());
    } else if (it.kind === 'qr' || it.kind === 'barcode') {
      const text = fillTemplate(it.text, row, index).trim();
      const cacheKey = `${it.kind}:${text}`;
      let parsed = ctx.codes.get(cacheKey);
      if (!parsed) {
        parsed = codeSvg(it.kind, text);
        ctx.codes.set(cacheKey, parsed);
      }
      const svg = await parsed;
      if (!svg) continue;
      const scale = Math.min((it.w * MM) / svg.width, (it.h * MM) / svg.height);
      const x = px(it.x) + (it.w * MM - svg.width * scale) / 2;
      const y = py(it.y) - (it.h * MM - svg.height * scale) / 2;
      for (const path of svg.paths) {
        if (path.stroke > 0) page.drawSvgPath(path.d, { x, y, scale, borderColor: color, borderWidth: path.stroke });
        else page.drawSvgPath(path.d, { x, y, scale, color });
      }
    }
  }
  page.pushOperators(popGraphicsState());
}

function drawCutMarks(page: PDFPage, ox: number, oy: number, w: number, h: number, pageH: number): void {
  const color = rgb(0.45, 0.45, 0.45);
  const len = 3;
  const gap = 1;
  const corners: [number, number, number, number][] = [
    [ox, oy, -1, -1],
    [ox + w, oy, 1, -1],
    [ox, oy + h, -1, 1],
    [ox + w, oy + h, 1, 1],
  ];
  for (const [x, y, dx, dy] of corners) {
    page.drawLine({ start: { x: (x + dx * gap) * MM, y: (pageH - y) * MM }, end: { x: (x + dx * (gap + len)) * MM, y: (pageH - y) * MM }, thickness: 0.25, color });
    page.drawLine({ start: { x: x * MM, y: (pageH - y - dy * gap) * MM }, end: { x: x * MM, y: (pageH - y - dy * (gap + len)) * MM }, thickness: 0.25, color });
  }
}

export interface MergeOptions {
  /** Draw only these rows (by index), for the preview or separate files. */
  readonly only?: readonly number[];
  /** Skip this many positions on the first sheet (labels already used). */
  readonly skip?: number;
  /** One card per page at its own size, whatever the layout's sheet (the preview). */
  readonly single?: boolean;
}

/** All texts a merge will draw, to choose fonts that can show them. */
function allTexts(layout: Layout, rows: readonly Row[], indexes: readonly number[]): string[] {
  const out: string[] = [];
  for (const i of indexes) for (const it of layout.items) if (it.kind === 'text') out.push(fillTemplate(it.text, rows[i] ?? {}, i));
  return out;
}

export async function mergePdf(layout: Layout, rows: readonly Row[], assets: Assets, options: MergeOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setCreator('Benchtop');
  doc.setProducer('Benchtop mail merge');
  const indexes = options.only ?? rows.map((_, i) => i);
  let regular: PDFFont;
  let bold: PDFFont;
  if (assets.font) {
    regular = await embedFontBytes(doc, assets.font);
    bold = assets.boldFont ? await embedFontBytes(doc, assets.boldFont) : regular;
  } else ({ regular, bold } = await fontsFor(doc, allTexts(layout, rows, indexes)));
  const ctx: Context = { doc, regular, bold, images: new Map(), codes: new Map(), assets };
  const { w, h } = layout.card;
  const sheet = options.single ? null : layout.sheet;
  if (!sheet) {
    for (const i of indexes) {
      const page = doc.addPage([w * MM, h * MM]);
      await drawCard(ctx, page, layout, rows[i] ?? {}, i, 0, 0, h);
    }
  } else {
    const perPage = sheet.cols * sheet.rows;
    const skip = Math.max(0, Math.min(perPage - 1, options.skip ?? 0));
    let page: PDFPage | null = null;
    for (let n = 0; n < indexes.length; n++) {
      const slot = (n + skip) % perPage;
      if (!page || slot === 0) page = doc.addPage([sheet.paper[0] * MM, sheet.paper[1] * MM]);
      const ox = sheet.left + (slot % sheet.cols) * sheet.pitchX;
      const oy = sheet.top + Math.floor(slot / sheet.cols) * sheet.pitchY;
      const i = indexes[n] as number;
      await drawCard(ctx, page, layout, rows[i] ?? {}, i, ox, oy, sheet.paper[1]);
      if (layout.outlines) page.drawRectangle({ x: ox * MM, y: (sheet.paper[1] - oy - h) * MM, width: w * MM, height: h * MM, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.3 });
      if (layout.cutMarks) drawCutMarks(page, ox, oy, w, h, sheet.paper[1]);
    }
  }
  if (doc.getPageCount() === 0) doc.addPage([w * MM, h * MM]);
  await finishFonts(doc);
  return doc.save();
}

/** How many sheets (or pages) a merge makes. */
export function pageCount(layout: Layout, count: number, skip = 0): number {
  if (!layout.sheet) return count;
  const per = layout.sheet.cols * layout.sheet.rows;
  return Math.ceil((count + Math.min(skip, per - 1)) / per);
}

/** Checks a layout's sheet: cards must fit on the paper. */
export function sheetProblems(layout: Layout): string[] {
  const s = layout.sheet;
  if (!s) return [];
  const problems: string[] = [];
  const right = s.left + (s.cols - 1) * s.pitchX + layout.card.w;
  const bottom = s.top + (s.rows - 1) * s.pitchY + layout.card.h;
  if (right > s.paper[0] + 0.01) problems.push(`The cards reach ${right.toFixed(1)} mm across, past the paper's width of ${s.paper[0]} mm.`);
  if (bottom > s.paper[1] + 0.01) problems.push(`The cards reach ${bottom.toFixed(1)} mm down, past the paper's height of ${s.paper[1]} mm.`);
  if (s.pitchX < layout.card.w - 0.01 && s.cols > 1) problems.push('Cards overlap from side to side: the distance between them is less than a card width.');
  if (s.pitchY < layout.card.h - 0.01 && s.rows > 1) problems.push('Cards overlap from top to bottom: the distance between them is less than a card height.');
  return problems;
}
