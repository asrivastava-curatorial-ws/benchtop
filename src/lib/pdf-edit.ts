/**
 * PDF editing with pdf-lib, in the page (no upload, no server): merging and
 * reordering pages, splitting, stamping text and page numbers, properties,
 * and pictures to PDF.  Pages are counted from 1 in everything the user sees.
 */
import { degrees, PDFDocument, type PDFFont, PDFName, type PDFPage, PDFRef, rgb } from 'pdf-lib';
import { ToolError } from './errors';
import { drawText, finishFonts, fontsFor, textWidth } from './pdf-text';

export const ENCRYPTED_MESSAGE = 'This PDF is password-protected. Remove the password first with PDF Passwords and Compression (Unlock), then try again.';

/** Loads a PDF for editing, refusing encrypted files (pdf-lib cannot decrypt, so edits would be unreadable). */
export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch (error) {
    throw new ToolError(`This file could not be read as a PDF: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (doc.isEncrypted) throw new ToolError(ENCRYPTED_MESSAGE);
  return doc;
}

async function finish(doc: PDFDocument): Promise<Uint8Array> {
  doc.setModificationDate(new Date());
  await finishFonts(doc);
  return doc.save({ useObjectStreams: true });
}

/* ---------------------------------------------------------- pages -- */

/**
 * Reads a page list such as "1-3, 5, 8-" or "odd" against `total` pages.
 * Ranges keep their direction ("5-3" is 5, 4, 3); "-" alone means every page.
 */
export function parsePages(text: string, total: number): number[] {
  const pages: number[] = [];
  for (const raw of text.replace(/\s*-\s*/g, '-').split(/[,;\s]+/)) {
    const part = raw.trim().toLowerCase();
    if (!part) continue;
    if (part === 'odd' || part === 'even') {
      for (let p = part === 'odd' ? 1 : 2; p <= total; p += 2) pages.push(p);
      continue;
    }
    if (part === 'all' || part === '-') {
      for (let p = 1; p <= total; p++) pages.push(p);
      continue;
    }
    if (part === 'last' || part === 'end') {
      pages.push(total);
      continue;
    }
    const match = /^(\d+|last|end)?\s*-\s*(\d+|last|end)?$/.exec(part) ?? /^(\d+)$/.exec(part);
    if (!match) throw new ToolError(`"${raw}" is not a page or a range. Use numbers such as 1-3, 7, 10-.`);
    const value = (v: string | undefined, fallback: number) => (v === undefined ? fallback : v === 'last' || v === 'end' ? total : Number(v));
    const single = match.length === 2;
    const from = value(match[1], 1);
    const to = single ? from : value(match[2], total);
    for (const p of [from, to]) if (p < 1 || p > total) throw new ToolError(`Page ${p} does not exist; this PDF has ${total} page${total === 1 ? '' : 's'}.`);
    const step = from <= to ? 1 : -1;
    for (let p = from; p !== to + step; p += step) pages.push(p);
  }
  return pages;
}

/** Groups for "1-3, 4-6, 7-": each comma-separated part becomes one file. */
export function parseGroups(text: string, total: number): number[][] {
  const groups = text
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => parsePages(part, total));
  if (!groups.length) throw new ToolError('Enter the page ranges, such as 1-3, 4-10, 11-.');
  return groups;
}

export type SplitMode = 'every' | 'chunks' | 'ranges' | 'extract' | 'remove';

export interface SplitPart {
  readonly name: string;
  readonly pages: readonly number[];
}

const label = (pages: readonly number[]) =>
  pages.length === 1 ? `page ${pages[0]}` : pages.every((p, i) => i === 0 || p === pages[i - 1] + 1) ? `pages ${pages[0]}-${pages[pages.length - 1]}` : `${pages.length} pages`;

/** The files a split will make. */
export function planSplit(mode: SplitMode, total: number, options: { size?: number; ranges?: string }, base: string): SplitPart[] {
  const width = String(total).length;
  const pad = (n: number) => String(n).padStart(width, '0');
  switch (mode) {
    case 'every':
      return Array.from({ length: total }, (_, i) => ({ name: `${base} p${pad(i + 1)}.pdf`, pages: [i + 1] }));
    case 'chunks': {
      const size = Math.max(1, Math.floor(options.size ?? 1));
      const parts: SplitPart[] = [];
      for (let start = 1; start <= total; start += size) {
        const pages = Array.from({ length: Math.min(size, total - start + 1) }, (_, i) => start + i);
        parts.push({ name: `${base} p${pad(start)}-${pad(pages[pages.length - 1])}.pdf`, pages });
      }
      return parts;
    }
    case 'ranges':
      return parseGroups(options.ranges ?? '', total).map((pages, i) => ({ name: `${base} part ${i + 1} (${label(pages)}).pdf`, pages }));
    case 'extract': {
      const pages = parsePages(options.ranges ?? '', total);
      if (!pages.length) throw new ToolError('Enter the pages to keep, such as 1, 3, 5-7.');
      return [{ name: `${base} (${label(pages)}).pdf`, pages }];
    }
    case 'remove': {
      const drop = new Set(parsePages(options.ranges ?? '', total));
      const pages = Array.from({ length: total }, (_, i) => i + 1).filter((p) => !drop.has(p));
      if (!drop.size) throw new ToolError('Enter the pages to remove, such as 2, 4-5.');
      if (!pages.length) throw new ToolError('That would remove every page.');
      return [{ name: `${base} (without ${drop.size === 1 ? `page ${[...drop][0]}` : `${drop.size} pages`}).pdf`, pages }];
    }
  }
}

/** A new PDF with the given pages (1-based) of `source`, in that order. */
export async function extractPages(source: PDFDocument, pages: readonly number[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const copied = await out.copyPages(
    source,
    pages.map((p) => p - 1),
  );
  for (const page of copied) out.addPage(page);
  copyInfo(source, out);
  return finish(out);
}

function copyInfo(from: PDFDocument, to: PDFDocument) {
  const title = from.getTitle();
  const author = from.getAuthor();
  if (title) to.setTitle(title);
  if (author) to.setAuthor(author);
  to.setProducer('Benchtop (pdf-lib)');
}

export interface PageRef {
  /** Index into the list of source documents. */
  readonly source: number;
  /** 0-based page index in that source. */
  readonly index: number;
  /** Extra clockwise rotation: 0, 90, 180 or 270. */
  readonly rotate: number;
}

/** Merges and reorders: one new PDF with the listed pages, each turned by its extra rotation. */
export async function assemble(sources: readonly PDFDocument[], pages: readonly PageRef[]): Promise<Uint8Array> {
  if (!pages.length) throw new ToolError('There are no pages left to save.');
  const out = await PDFDocument.create();
  // Copy each source's pages in one call (shared resources are copied once).
  const wanted = new Map<number, number[]>();
  for (const ref of pages) wanted.set(ref.source, [...(wanted.get(ref.source) ?? []), ref.index]);
  const copied = new Map<string, PDFPage>();
  for (const [source, indices] of wanted) {
    const unique = [...new Set(indices)];
    const result = await out.copyPages(sources[source], unique);
    for (const [i, index] of unique.entries()) copied.set(`${source}:${index}`, result[i]);
  }
  const used = new Set<string>();
  for (const ref of pages) {
    const key = `${ref.source}:${ref.index}`;
    // The same page twice needs a second copy.
    const page = used.has(key) ? (await out.copyPages(sources[ref.source], [ref.index]))[0] : (copied.get(key) as PDFPage);
    used.add(key);
    const turn = (((page.getRotation().angle + ref.rotate) % 360) + 360) % 360;
    page.setRotation(degrees(turn));
    out.addPage(page);
  }
  if (sources[0]) copyInfo(sources[0], out);
  return finish(out);
}

/* ---------------------------------------------------------- stamp -- */

export type Corner = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';

export interface StampOptions {
  readonly pages: string;
  readonly watermark?: {
    readonly text: string;
    readonly size: number;
    readonly colour: string;
    readonly opacity: number;
    /** Degrees, anticlockwise as seen on the page. */
    readonly angle: number;
    readonly tiled: boolean;
    readonly bold: boolean;
  };
  readonly numbers?: {
    /** "{n}" is the number, "{total}" the last number. */
    readonly format: string;
    readonly position: Corner;
    readonly size: number;
    readonly colour: string;
    /** Number shown on the first numbered page. */
    readonly start: number;
    /** Distance from the edges, in millimetres. */
    readonly margin: number;
  };
  readonly text?: {
    readonly value: string;
    readonly position: Corner;
    readonly size: number;
    readonly colour: string;
    readonly margin: number;
  };
}

export function hexColour(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const value = m ? Number.parseInt(m[1], 16) : 0;
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

const MM = 72 / 25.4;

/**
 * Maps a point in the page as it is shown (origin bottom-left, after the
 * page's own /Rotate) to PDF user space, so stamps sit upright on turned pages.
 */
export function viewToPage(page: PDFPage) {
  const box = page.getCropBox();
  const turn = ((page.getRotation().angle % 360) + 360) % 360;
  const sideways = turn === 90 || turn === 270;
  const width = sideways ? box.height : box.width;
  const height = sideways ? box.width : box.height;
  const map = (x: number, y: number): [number, number] => {
    switch (turn) {
      case 90:
        return [box.x + box.width - y, box.y + x];
      case 180:
        return [box.x + box.width - x, box.y + box.height - y];
      case 270:
        return [box.x + y, box.y + box.height - x];
      default:
        return [box.x + x, box.y + y];
    }
  };
  return { width, height, turn, map };
}

/** Draws `text` with its centre (cx, cy) in view space, rotated by `angle` degrees as seen. */
function drawCentred(page: PDFPage, font: PDFFont, text: string, size: number, cx: number, cy: number, angle: number, colour: ReturnType<typeof rgb>, opacity: number) {
  const view = viewToPage(page);
  const width = textWidth(font, text, size);
  const cap = font.heightAtSize(size, { descender: false }) * 0.7;
  const a = (angle * Math.PI) / 180;
  const ox = cx - (width / 2) * Math.cos(a) + (cap / 2) * Math.sin(a);
  const oy = cy - (width / 2) * Math.sin(a) - (cap / 2) * Math.cos(a);
  const [x, y] = view.map(ox, oy);
  drawText(page, font, text, { x, y, size, color: colour, opacity, angle: view.turn + angle });
}

function drawAtCorner(page: PDFPage, font: PDFFont, text: string, size: number, corner: Corner, marginMm: number, colour: ReturnType<typeof rgb>) {
  const view = viewToPage(page);
  const margin = marginMm * MM;
  const width = textWidth(font, text, size);
  const [vertical, horizontal] = corner.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right'];
  const vx = horizontal === 'left' ? margin : horizontal === 'right' ? view.width - margin - width : (view.width - width) / 2;
  const vy = vertical === 'bottom' ? margin : view.height - margin - size * 0.75;
  const [x, y] = view.map(vx, vy);
  drawText(page, font, text, { x, y, size, color: colour, angle: view.turn });
}

interface Fonts {
  readonly regular: PDFFont;
  readonly bold: PDFFont;
}

/** Helvetica for Latin text; Benchtop Sans when a stamp has Hindi, the rupee sign or other scripts. */
async function prepareStamp(doc: PDFDocument, options: StampOptions): Promise<Fonts> {
  const { watermark: w, numbers: n, text: t } = options;
  const texts = [w?.text ?? '', n?.format ?? '', t?.value ?? ''];
  return fontsFor(doc, texts);
}

/** Which pages get stamped, and the number each shows. */
function numbering(options: StampOptions, total: number): { chosen: number[]; numberOf: (page: number) => number | null; last: number } {
  const chosen = [...new Set(options.pages.trim() ? parsePages(options.pages, total) : Array.from({ length: total }, (_, i) => i + 1))].sort((a, b) => a - b);
  const start = options.numbers?.start ?? 1;
  const rank = new Map(chosen.map((page, i) => [page, i]));
  return { chosen, numberOf: (page) => (rank.has(page) ? start + (rank.get(page) as number) : null), last: start + chosen.length - 1 };
}

function stampPage(page: PDFPage, fonts: Fonts, options: StampOptions, number: number, last: number) {
  const view = viewToPage(page);
  const { watermark: w, numbers: n, text: t } = options;
  if (w?.text) {
    const font = w.bold ? fonts.bold : fonts.regular;
    const colour = hexColour(w.colour);
    if (w.tiled) {
      const stepX = textWidth(font, w.text, w.size) * 1.6 + w.size * 2;
      const stepY = w.size * 5;
      let row = 0;
      for (let y = -view.height; y < view.height * 2; y += stepY, row++)
        for (let x = -view.width + (row % 2 ? stepX / 2 : 0); x < view.width * 2; x += stepX) {
          const [cx, cy] = rotateAround(x, y, view.width / 2, view.height / 2, w.angle);
          if (cx > -stepX && cx < view.width + stepX && cy > -stepY && cy < view.height + stepY) drawCentred(page, font, w.text, w.size, cx, cy, w.angle, colour, w.opacity);
        }
    } else {
      drawCentred(page, font, w.text, w.size, view.width / 2, view.height / 2, w.angle, colour, w.opacity);
    }
  }
  if (n?.format) {
    const value = n.format.replaceAll('{n}', String(number)).replaceAll('{total}', String(last));
    drawAtCorner(page, fonts.regular, value, n.size, n.position, n.margin, hexColour(n.colour));
  }
  if (t?.value) drawAtCorner(page, fonts.regular, t.value, t.size, t.position, t.margin, hexColour(t.colour));
}

/** Adds a watermark, page numbers and a header or footer line to the chosen pages. */
export async function stampPdf(doc: PDFDocument, options: StampOptions): Promise<Uint8Array> {
  const pages = doc.getPages();
  const { chosen, numberOf, last } = numbering(options, pages.length);
  const fonts = await prepareStamp(doc, options);
  for (const p of chosen) stampPage(pages[p - 1], fonts, options, numberOf(p) as number, last);
  return finish(doc);
}

/** One page (1-based) of `source`, stamped as it would be in the whole document, for previews. */
export async function stampPreview(source: PDFDocument, options: StampOptions, page: number): Promise<Uint8Array> {
  const { numberOf, last } = numbering(options, source.getPageCount());
  const out = await PDFDocument.create();
  const [copy] = await out.copyPages(source, [page - 1]);
  out.addPage(copy);
  const fonts = await prepareStamp(out, options);
  const number = numberOf(page);
  if (number !== null) stampPage(copy, fonts, options, number, last);
  await finishFonts(out);
  return out.save();
}

function rotateAround(x: number, y: number, cx: number, cy: number, angle: number): [number, number] {
  const a = (angle * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
}

/* ----------------------------------------------------- properties -- */

export interface PdfInfo {
  readonly title: string;
  readonly author: string;
  readonly subject: string;
  readonly keywords: string;
  readonly creator: string;
  readonly producer: string;
  readonly created: string;
  readonly modified: string;
}

export interface PdfFacts {
  readonly pages: number;
  readonly version: string;
  readonly sizes: readonly { readonly width: number; readonly height: number; readonly count: number; readonly name: string }[];
  readonly hasXmp: boolean;
  readonly forms: number;
}

const PAPER: readonly [string, number, number][] = [
  ['A3', 297, 420],
  ['A4', 210, 297],
  ['A5', 148, 210],
  ['A6', 105, 148],
  ['B5', 176, 250],
  ['Letter', 215.9, 279.4],
  ['Legal', 215.9, 355.6],
  ['Tabloid', 279.4, 431.8],
];

export function paperName(widthPt: number, heightPt: number): string {
  const w = widthPt / MM;
  const h = heightPt / MM;
  const [short, long] = w < h ? [w, h] : [h, w];
  const match = PAPER.find(([, a, b]) => Math.abs(a - short) < 2 && Math.abs(b - long) < 2);
  const orientation = Math.abs(w - h) < 1 ? '' : w > h ? ' landscape' : '';
  return match ? `${match[0]}${orientation}` : `${Math.round(w)} × ${Math.round(h)} mm`;
}

const isoDate = (date: Date | undefined) => (date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 16) : '');

export function readInfo(doc: PDFDocument, bytes: Uint8Array): { info: PdfInfo; facts: PdfFacts } {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 16));
  const version = /%PDF-(\d\.\d)/.exec(head)?.[1] ?? '?';
  const sizes = new Map<string, { width: number; height: number; count: number; name: string }>();
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const turned = page.getRotation().angle % 180 !== 0;
    const [w, h] = turned ? [height, width] : [width, height];
    const key = `${Math.round(w)}x${Math.round(h)}`;
    const entry = sizes.get(key) ?? { width: w, height: h, count: 0, name: paperName(w, h) };
    sizes.set(key, { ...entry, count: entry.count + 1 });
  }
  let forms = 0;
  // getForm() adds an empty form to documents without one, so look first.
  if (doc.catalog.has(PDFName.of('AcroForm'))) {
    try {
      forms = doc.getForm().getFields().length;
    } catch {
      forms = 0;
    }
  }
  return {
    info: {
      title: doc.getTitle() ?? '',
      author: doc.getAuthor() ?? '',
      subject: doc.getSubject() ?? '',
      keywords: doc.getKeywords() ?? '',
      creator: doc.getCreator() ?? '',
      producer: doc.getProducer() ?? '',
      created: isoDate(doc.getCreationDate()),
      modified: isoDate(doc.getModificationDate()),
    },
    facts: { pages: doc.getPageCount(), version, sizes: [...sizes.values()], hasXmp: doc.catalog.has(PDFName.of('Metadata')), forms },
  };
}

/** Writes the document properties; `clear` removes them all (and the XMP copy). */
export async function writeInfo(doc: PDFDocument, info: PdfInfo, clear: boolean): Promise<Uint8Array> {
  const dropXmp = () => {
    const xmp = doc.catalog.get(PDFName.of('Metadata'));
    if (xmp instanceof PDFRef) doc.context.delete(xmp);
    doc.catalog.delete(PDFName.of('Metadata'));
  };
  if (clear) {
    const infoRef = doc.context.trailerInfo.Info;
    if (infoRef instanceof PDFRef) doc.context.delete(infoRef);
    doc.context.trailerInfo.Info = undefined;
    dropXmp();
    return doc.save({ useObjectStreams: true });
  }
  doc.setTitle(info.title, { showInWindowTitleBar: Boolean(info.title) });
  doc.setAuthor(info.author);
  doc.setSubject(info.subject);
  doc.setKeywords(
    info.keywords
      .split(/[,;]/)
      .map((k) => k.trim())
      .filter(Boolean),
  );
  doc.setCreator(info.creator);
  doc.setProducer(info.producer);
  if (info.created) doc.setCreationDate(new Date(info.created));
  doc.setModificationDate(new Date());
  // The XMP copy would otherwise disagree with the new values in some readers.
  dropXmp();
  return doc.save({ useObjectStreams: true });
}

/* ------------------------------------------------- pictures to PDF -- */

export interface PictureInput {
  readonly bytes: Uint8Array;
  /** 'jpg' or 'png' (other formats are converted to PNG first). */
  readonly kind: 'jpg' | 'png';
}

export type PageSize = 'fit' | 'a4' | 'letter' | 'a3' | 'a5' | 'legal';

const SIZES: Record<Exclude<PageSize, 'fit'>, [number, number]> = {
  a4: [210, 297],
  a3: [297, 420],
  a5: [148, 210],
  letter: [215.9, 279.4],
  legal: [215.9, 355.6],
};

export async function picturesToPdf(pictures: readonly PictureInput[], options: { size: PageSize; orientation: 'auto' | 'portrait' | 'landscape'; margin: number; dpi: number }): Promise<Uint8Array> {
  if (!pictures.length) throw new ToolError('Add at least one picture.');
  const doc = await PDFDocument.create();
  for (const picture of pictures) {
    const image = picture.kind === 'jpg' ? await doc.embedJpg(picture.bytes) : await doc.embedPng(picture.bytes);
    // Pixels to points at the given resolution.
    const naturalW = (image.width * 72) / options.dpi;
    const naturalH = (image.height * 72) / options.dpi;
    if (options.size === 'fit') {
      const margin = options.margin * MM;
      const page = doc.addPage([naturalW + margin * 2, naturalH + margin * 2]);
      page.drawImage(image, { x: margin, y: margin, width: naturalW, height: naturalH });
      continue;
    }
    let [w, h] = SIZES[options.size].map((mm) => mm * MM) as [number, number];
    const landscape = options.orientation === 'landscape' || (options.orientation === 'auto' && image.width > image.height);
    if (landscape) [w, h] = [h, w];
    const page = doc.addPage([w, h]);
    const margin = options.margin * MM;
    const boxW = w - margin * 2;
    const boxH = h - margin * 2;
    const scale = Math.min(boxW / image.width, boxH / image.height);
    const drawW = image.width * scale;
    const drawH = image.height * scale;
    page.drawImage(image, { x: (w - drawW) / 2, y: (h - drawH) / 2, width: drawW, height: drawH });
  }
  doc.setProducer('Benchtop (pdf-lib)');
  doc.setCreationDate(new Date());
  return doc.save({ useObjectStreams: true });
}
