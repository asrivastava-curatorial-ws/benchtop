/**
 * Imposition: arranging the pages of a PDF on printer sheets so that, once
 * printed, folded and cut, they read in order.  Booklets (saddle stitch, with
 * optional signatures and creep), the one-sheet eight-page zine, n-up and
 * step-and-repeat.
 */
import { degrees, type PDFDocument, type PDFEmbeddedPage, PDFDocument as PdfDoc, rgb } from 'pdf-lib';

export type Layout = 'booklet' | 'zine' | 'nup' | 'repeat';

/** A page in a cell; `page` is 0-based, null for a blank. Rotation is extra, counter-clockwise. */
export interface Slot {
  readonly page: number | null;
  readonly col: number;
  readonly row: number;
  readonly rotate: 0 | 180;
  /** Shift towards the spine in points (booklet creep); positive moves right. */
  readonly shift?: number;
}

export interface Side {
  readonly cols: number;
  readonly rows: number;
  readonly slots: readonly Slot[];
  /** Which sheet of the job this side belongs to, for reports. */
  readonly sheet: number;
  readonly back: boolean;
}

const blank = (page: number, count: number) => (page < count ? page : null);

/**
 * Saddle-stitched booklet sides in print order: sheet 1 front, sheet 1 back,
 * sheet 2 front... Pages are padded with blanks to a multiple of four.
 * `signature` splits long books into separately folded sections.
 */
export function bookletSides(count: number, signature = 0, creep = 0): Side[] {
  const total = Math.ceil(count / 4) * 4;
  const size = signature > 0 ? Math.max(4, Math.ceil(signature / 4) * 4) : total;
  const sides: Side[] = [];
  let sheet = 0;
  for (let start = 0; start < total; start += size) {
    const n = Math.min(size, total - start);
    const sheets = n / 4;
    for (let i = 0; i < sheets; i++) {
      const shift = creep * i;
      const page = (k: number) => blank(start + k, count);
      sides.push({
        cols: 2,
        rows: 1,
        sheet,
        back: false,
        slots: [
          { page: page(n - 1 - 2 * i), col: 0, row: 0, rotate: 0, shift },
          { page: page(2 * i), col: 1, row: 0, rotate: 0, shift: -shift },
        ],
      });
      sides.push({
        cols: 2,
        rows: 1,
        sheet,
        back: true,
        slots: [
          { page: page(2 * i + 1), col: 0, row: 0, rotate: 0, shift },
          { page: page(n - 2 - 2 * i), col: 1, row: 0, rotate: 0, shift: -shift },
        ],
      });
      sheet++;
    }
  }
  return sides;
}

/**
 * The classic eight-page mini zine from one sheet: fold in half both ways,
 * cut the middle of the long fold, and push into a book.  Rows are counted
 * from the top; the top row is upside down.
 */
export function zineSides(count: number): Side[] {
  const sides: Side[] = [];
  for (let start = 0, sheet = 0; start < Math.max(count, 1); start += 8, sheet++) {
    const page = (k: number) => blank(start + k, count);
    const top = [4, 3, 2, 1];
    const bottom = [5, 6, 7, 0];
    sides.push({
      cols: 4,
      rows: 2,
      sheet,
      back: false,
      slots: [...top.map((k, col) => ({ page: page(k), col, row: 0, rotate: 180 as const })), ...bottom.map((k, col) => ({ page: page(k), col, row: 1, rotate: 0 as const }))],
    });
  }
  return sides;
}

/** Pages in reading order across rows; "cut and stack" orders them so the cut piles read in order. */
export function nupSides(count: number, cols: number, rows: number, cutStack: boolean): Side[] {
  const per = cols * rows;
  const sheets = Math.max(1, Math.ceil(count / per));
  const sides: Side[] = [];
  for (let s = 0; s < sheets; s++) {
    const slots: Slot[] = [];
    for (let k = 0; k < per; k++) {
      const index = cutStack ? k * sheets + s : s * per + k;
      slots.push({ page: blank(index, count), col: k % cols, row: Math.floor(k / cols), rotate: 0 });
    }
    sides.push({ cols, rows, sheet: s, back: false, slots });
  }
  return sides;
}

/** Each page filled across a whole sheet: business cards, labels, tickets. */
export function repeatSides(count: number, cols: number, rows: number): Side[] {
  return Array.from({ length: Math.max(1, count) }, (_, s) => ({
    cols,
    rows,
    sheet: s,
    back: false,
    slots: Array.from({ length: cols * rows }, (_, k) => ({ page: s < count ? s : null, col: k % cols, row: Math.floor(k / cols), rotate: 0 as const })),
  }));
}

export interface ImposeOptions {
  readonly layout: Layout;
  /** Sheet size in points, portrait; null means "fit two pages side by side" (booklets) or A4. */
  readonly sheet: { readonly width: number; readonly height: number } | null;
  readonly orientation: 'auto' | 'portrait' | 'landscape';
  readonly cols: number;
  readonly rows: number;
  readonly margin: number;
  readonly gutter: number;
  readonly signature: number;
  /** Creep per sheet in points, for thick booklets. */
  readonly creep: number;
  readonly cutStack: boolean;
  readonly marks: boolean;
  readonly fit: 'fit' | 'actual';
}

export interface ImposeResult {
  readonly bytes: Uint8Array;
  readonly sides: number;
  readonly sheets: number;
  readonly blanks: number;
  readonly sheetSize: { width: number; height: number };
}

const A4 = { width: 595.28, height: 841.89 };

export function planSides(count: number, o: Pick<ImposeOptions, 'layout' | 'cols' | 'rows' | 'signature' | 'creep' | 'cutStack'>): Side[] {
  switch (o.layout) {
    case 'booklet':
      return bookletSides(count, o.signature, o.creep);
    case 'zine':
      return zineSides(count);
    case 'repeat':
      return repeatSides(count, o.cols, o.rows);
    default:
      return nupSides(count, o.cols, o.rows, o.cutStack);
  }
}

/** Visible size and the extra counter-clockwise turn needed to show a page upright. */
function pageGeometry(doc: PDFDocument, index: number): { width: number; height: number; turn: number } {
  const page = doc.getPage(index);
  const { width, height } = page.getSize();
  const r = (((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  // /Rotate turns clockwise; pdf-lib draws counter-clockwise.
  const turn = (360 - r) % 360;
  return r === 90 || r === 270 ? { width: height, height: width, turn } : { width, height, turn };
}

function chooseSheet(o: ImposeOptions, first: { width: number; height: number }): { width: number; height: number } {
  let base = o.sheet;
  if (!base) {
    if (o.layout === 'booklet') base = { width: Math.min(first.width, first.height) * 2, height: Math.max(first.width, first.height) };
    else base = A4;
  }
  const portrait = { width: Math.min(base.width, base.height), height: Math.max(base.width, base.height) };
  const landscape = { width: portrait.height, height: portrait.width };
  if (o.orientation === 'portrait') return portrait;
  if (o.orientation === 'landscape') return landscape;
  if (o.layout === 'booklet' || o.layout === 'zine') return o.sheet ? landscape : base;
  // Pick the orientation that shows the pages larger.
  const scaleFor = (s: { width: number; height: number }) => {
    const cw = (s.width - 2 * o.margin - (o.cols - 1) * o.gutter) / o.cols;
    const ch = (s.height - 2 * o.margin - (o.rows - 1) * o.gutter) / o.rows;
    return Math.min(cw / first.width, ch / first.height);
  };
  return scaleFor(landscape) > scaleFor(portrait) ? landscape : portrait;
}

export async function impose(source: PDFDocument, o: ImposeOptions): Promise<ImposeResult> {
  const count = source.getPageCount();
  if (!count) throw new Error('The PDF has no pages.');
  if (o.layout === 'nup' || o.layout === 'repeat') {
    if (!(o.cols >= 1 && o.rows >= 1 && o.cols * o.rows <= 64)) throw new RangeError('Use 1 to 64 pages per sheet.');
  }
  const sides = planSides(count, o);
  const first = pageGeometry(source, 0);
  const sheet = chooseSheet(o, first);
  const out = await PdfDoc.create();
  out.setProducer('Benchtop');
  out.setCreator('Benchtop imposer');
  const embedded = new Map<number, PDFEmbeddedPage | null>();
  // A page without a content stream is blank; pdf-lib cannot embed it, and there is nothing to draw.
  const embed = async (index: number) => {
    if (!embedded.has(index)) {
      const sourcePage = source.getPage(index);
      embedded.set(index, sourcePage.node.Contents() ? await out.embedPage(sourcePage) : null);
    }
    return embedded.get(index) ?? null;
  };
  const margin = o.layout === 'booklet' || o.layout === 'zine' ? o.margin : o.margin;
  let blanks = 0;
  for (const side of sides) {
    const page = out.addPage([sheet.width, sheet.height]);
    const gutter = o.layout === 'booklet' ? 0 : o.gutter;
    const cw = (sheet.width - 2 * margin - (side.cols - 1) * gutter) / side.cols;
    const ch = (sheet.height - 2 * margin - (side.rows - 1) * gutter) / side.rows;
    if (!(cw > 0 && ch > 0)) throw new RangeError('The margins and gaps leave no room for the pages.');
    for (const slot of side.slots) {
      if (slot.page === null) {
        blanks++;
        continue;
      }
      const g = pageGeometry(source, slot.page);
      const e = await embed(slot.page);
      if (!e) continue;
      // Turn a page a quarter if that fits the cell better (n-up only).
      const quarter = (o.layout === 'nup' || o.layout === 'repeat') && g.width > g.height !== cw > ch && Math.abs(g.width - g.height) > 1 ? 90 : 0;
      const shownW = quarter ? g.height : g.width;
      const shownH = quarter ? g.width : g.height;
      const scale = o.fit === 'actual' ? 1 : Math.min(cw / shownW, ch / shownH);
      const w = shownW * scale;
      const h = shownH * scale;
      const cellX = margin + slot.col * (cw + gutter);
      const cellY = sheet.height - margin - (slot.row + 1) * ch - slot.row * gutter;
      // Booklet pages sit against the fold; everything else is centred in its cell.
      let bx = cellX + (cw - w) / 2;
      if (o.layout === 'booklet') bx = slot.col === 0 ? cellX + cw - w : cellX;
      bx += slot.shift ?? 0;
      const by = cellY + (ch - h) / 2;
      const turn = (g.turn + quarter + slot.rotate) % 360;
      // pdf-lib turns about the drawing origin, so move the origin to keep the page in its box.
      const sw = e.width * scale;
      const sh = e.height * scale;
      const origin = turn === 0 ? { x: bx, y: by } : turn === 90 ? { x: bx + sh, y: by } : turn === 180 ? { x: bx + sw, y: by + sh } : { x: bx, y: by + sw };
      page.drawPage(e, { x: origin.x, y: origin.y, xScale: scale, yScale: scale, rotate: degrees(turn) });
    }
    if (o.marks) drawMarks(page, side, sheet, margin, gutter, cw, ch, o.layout);
  }
  return { bytes: await out.save(), sides: sides.length, sheets: new Set(sides.map((s) => s.sheet)).size, blanks, sheetSize: sheet };
}

function drawMarks(page: ReturnType<PDFDocument['addPage']>, side: Side, sheet: { width: number; height: number }, margin: number, gutter: number, cw: number, ch: number, layout: Layout) {
  const grey = rgb(0.55, 0.55, 0.55);
  const line = (x1: number, y1: number, x2: number, y2: number, dash = false) =>
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.5, color: grey, dashArray: dash ? [3, 3] : undefined });
  if (layout === 'booklet') {
    const x = sheet.width / 2;
    line(x, 0, x, 14, true);
    line(x, sheet.height - 14, x, sheet.height, true);
    return;
  }
  if (layout === 'zine') {
    // Fold lines dashed; the cut along the middle of the long fold solid.
    for (let c = 1; c < side.cols; c++) line(margin + c * cw, margin, margin + c * cw, sheet.height - margin, true);
    const y = sheet.height / 2;
    line(margin, y, margin + cw, y, true);
    line(margin + cw, y, margin + 3 * cw, y);
    line(margin + 3 * cw, y, sheet.width - margin, y, true);
    return;
  }
  if (margin < 6) return;
  // Crop marks in the margin at every cut.
  const len = Math.min(margin - 2, 12);
  const xs = new Set<number>();
  const ys = new Set<number>();
  for (let c = 0; c < side.cols; c++) {
    xs.add(margin + c * (cw + gutter));
    xs.add(margin + c * (cw + gutter) + cw);
  }
  for (let r = 0; r < side.rows; r++) {
    ys.add(margin + r * (ch + gutter));
    ys.add(margin + r * (ch + gutter) + ch);
  }
  for (const x of xs) {
    line(x, 0, x, len);
    line(x, sheet.height - len, x, sheet.height);
  }
  for (const y of ys) {
    line(0, y, len, y);
    line(sheet.width - len, y, sheet.width, y);
  }
}

export const POINTS_PER_MM = 72 / 25.4;
