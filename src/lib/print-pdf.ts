/**
 * PDFs for the press: printer's marks around the pages of a PDF, a CMYK
 * picture as a PDF with its profile as output intent, and nested pieces laid
 * out on sheets.  Lengths that come in are millimetres; a PDF's own unit is
 * the point (1/72 inch).
 */
import {
  degrees,
  PDFArray,
  type PDFDocument,
  type PDFEmbeddedPage,
  type PDFFont,
  type PDFImage,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  type PDFPage,
  PDFString,
  PDFDocument as PdfDoc,
  StandardFonts,
} from 'pdf-lib';
import type { Placement } from './nesting';

export const PT = 72 / 25.4;
const mm = (value: number) => value * PT;

export interface MarkOptions {
  /** Bleed the pages already carry around the trim on each side, when they have no trim box of their own. */
  readonly bleedInPage: number;
  /** Bleed to keep around the trim in the output. */
  readonly bleed: number;
  readonly crop: boolean;
  readonly bleedMarks: boolean;
  readonly registration: boolean;
  readonly colourBar: boolean;
  readonly info: boolean;
  /** The file's name, for the line of information. */
  readonly name: string;
  /** When the marks were made, for the line of information. */
  readonly date: string;
}

export const DEFAULT_MARKS: MarkOptions = { bleedInPage: 0, bleed: 3, crop: true, bleedMarks: false, registration: true, colourBar: true, info: true, name: '', date: '' };

/** How long crop marks are, how far outside the bleed they begin, and the room left for them all round. */
const MARK = { length: 5, clear: 1, weight: 0.25, slug: 14 };

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const boxOf = (page: PDFPage, key: string): Box | null => {
  const raw = page.node.lookup(PDFName.of(key));
  if (!(raw instanceof PDFArray) || raw.size() !== 4) return null;
  const n = [0, 1, 2, 3].map((i) => {
    const value = raw.lookup(i);
    return value instanceof PDFNumber ? value.asNumber() : Number.NaN;
  });
  if (n.some((value) => !Number.isFinite(value))) return null;
  return {
    x: Math.min(n[0] as number, n[2] as number),
    y: Math.min(n[1] as number, n[3] as number),
    width: Math.abs((n[2] as number) - (n[0] as number)),
    height: Math.abs((n[3] as number) - (n[1] as number)),
  };
};

/** The trim of a page: its own trim box when it has one smaller than the page, or the page less the bleed it is said to carry. */
export function trimOf(page: PDFPage, bleedInPage: number): { trim: Box; media: Box; own: boolean } {
  const size = page.getSize();
  const media = boxOf(page, 'MediaBox') ?? { x: 0, y: 0, width: size.width, height: size.height };
  const own = boxOf(page, 'TrimBox');
  if (own && (own.width < media.width - 0.5 || own.height < media.height - 0.5)) return { trim: own, media, own: true };
  const inset = Math.max(0, Math.min(mm(bleedInPage), media.width / 2 - 1, media.height / 2 - 1));
  return { trim: { x: media.x + inset, y: media.y + inset, width: media.width - 2 * inset, height: media.height - 2 * inset }, media, own: false };
}

const op = (name: PDFOperatorNames, ...args: (number | PDFName)[]) =>
  PDFOperator.of(
    name,
    args.map((arg) => (typeof arg === 'number' ? PDFNumber.of(arg) : arg)),
  );

/**
 * Registration colour: ink on every plate, whatever the plates are.  Marks drawn in plain
 * black would be on the black plate only, and no use for lining the others up.
 */
function registrationColour(doc: PDFDocument, page: PDFPage): PDFName {
  const tint = doc.context.register(doc.context.obj({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [1, 1, 1, 1], N: 1 }));
  const space = doc.context.register(doc.context.obj([PDFName.of('Separation'), PDFName.of('All'), PDFName.of('DeviceCMYK'), tint]));
  // (A page that nothing has been drawn on yet gets its list of resources here.)
  page.node.normalize();
  const resources = page.node.Resources();
  if (!resources) throw new Error('The page has nowhere to keep its colours.');
  const spaces = doc.context.obj({ BenchtopAll: space });
  resources.set(PDFName.of('ColorSpace'), spaces);
  return PDFName.of('BenchtopAll');
}

export interface MarkResult {
  readonly bytes: Uint8Array;
  readonly pages: number;
  /** The first page's trimmed size and its size with marks, in millimetres. */
  readonly trim: { width: number; height: number };
  readonly sheet: { width: number; height: number };
  /** Bleed the first page really has to give, the least of its four sides, in millimetres. */
  readonly bleedFound: number;
}

/**
 * Puts each page of a PDF on a larger page with printer's marks around it: crop marks at the
 * trim, bleed marks, registration targets, a colour bar and a line of information.  The new
 * pages say where the trim and the bleed are (their trim and bleed boxes), which is what a
 * print shop's software reads.
 */
export async function addMarks(source: PDFDocument, options: MarkOptions): Promise<MarkResult> {
  const count = source.getPageCount();
  if (!count) throw new Error('The PDF has no pages.');
  const out = await PdfDoc.create();
  out.setProducer('Benchtop');
  out.setCreator('Benchtop Print Production Studio');
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bleed = mm(Math.max(0, options.bleed));
  const slug = mm(MARK.slug);
  let first: Pick<MarkResult, 'trim' | 'sheet' | 'bleedFound'> | null = null;

  for (let index = 0; index < count; index++) {
    const from = source.getPage(index);
    const { trim, media } = trimOf(from, options.bleedInPage);
    // What the page has beyond its trim on each side; the bleed asked for is cut from it.
    const have = { left: trim.x - media.x, bottom: trim.y - media.y, right: media.x + media.width - (trim.x + trim.width), top: media.y + media.height - (trim.y + trim.height) };
    const keep = { left: Math.min(bleed, have.left), bottom: Math.min(bleed, have.bottom), right: Math.min(bleed, have.right), top: Math.min(bleed, have.top) };
    const width = trim.width + 2 * (bleed + slug);
    const height = trim.height + 2 * (bleed + slug);
    const page = out.addPage([width, height]);
    // The trim's bottom left corner on the new page.
    const tx = slug + bleed;
    const ty = slug + bleed;
    if (from.node.Contents()) {
      // Only the trim and the bleed that is kept are shown; anything further out (old marks, say) is left behind.
      const clip = { left: trim.x - keep.left, bottom: trim.y - keep.bottom, right: trim.x + trim.width + keep.right, top: trim.y + trim.height + keep.top };
      const embedded = await out.embedPage(from, clip);
      page.drawPage(embedded, { x: tx - keep.left, y: ty - keep.bottom });
    }
    const box = (x: number, y: number, w: number, h: number) => out.context.obj([x, y, x + w, y + h]);
    page.node.set(PDFName.of('TrimBox'), box(tx, ty, trim.width, trim.height));
    page.node.set(PDFName.of('BleedBox'), box(tx - bleed, ty - bleed, trim.width + 2 * bleed, trim.height + 2 * bleed));

    const all = registrationColour(out, page);
    const ops: PDFOperator[] = [
      op(PDFOperatorNames.PushGraphicsState),
      op(PDFOperatorNames.StrokingColorspace, all),
      op(PDFOperatorNames.StrokingColorN, 1),
      op(PDFOperatorNames.NonStrokingColorspace, all),
      op(PDFOperatorNames.NonStrokingColorN, 1),
      op(PDFOperatorNames.SetLineWidth, MARK.weight),
    ];
    const line = (x1: number, y1: number, x2: number, y2: number) => ops.push(op(PDFOperatorNames.MoveTo, x1, y1), op(PDFOperatorNames.LineTo, x2, y2), op(PDFOperatorNames.StrokePath));
    const left = tx;
    const right = tx + trim.width;
    const bottom = ty;
    const top = ty + trim.height;
    // Marks begin clear of the bleed, so that none of them prints into the finished piece.
    const start = bleed + mm(MARK.clear);
    const end = start + mm(MARK.length);
    if (options.crop) {
      for (const x of [left, right]) {
        line(x, bottom - start, x, bottom - end);
        line(x, top + start, x, top + end);
      }
      for (const y of [bottom, top]) {
        line(left - start, y, left - end, y);
        line(right + start, y, right + end, y);
      }
    }
    if (options.bleedMarks && bleed > 0) {
      // Shorter marks at the corners of the bleed, set off from the crop marks.
      const short = mm(MARK.length) * 0.6;
      for (const x of [left - bleed, right + bleed]) {
        line(x, bottom - start - mm(1), x, bottom - start - mm(1) - short);
        line(x, top + start + mm(1), x, top + start + mm(1) + short);
      }
      for (const y of [bottom - bleed, top + bleed]) {
        line(left - start - mm(1), y, left - start - mm(1) - short, y);
        line(right + start + mm(1), y, right + start + mm(1) + short, y);
      }
    }
    if (options.registration) {
      // A target at the middle of each side: a circle with a cross through it.
      const r = mm(1.6);
      const reach = mm(3);
      const k = 0.5523 * r;
      const target = (cx: number, cy: number) => {
        ops.push(
          op(PDFOperatorNames.MoveTo, cx + r, cy),
          op(PDFOperatorNames.AppendBezierCurve, cx + r, cy + k, cx + k, cy + r, cx, cy + r),
          op(PDFOperatorNames.AppendBezierCurve, cx - k, cy + r, cx - r, cy + k, cx - r, cy),
          op(PDFOperatorNames.AppendBezierCurve, cx - r, cy - k, cx - k, cy - r, cx, cy - r),
          op(PDFOperatorNames.AppendBezierCurve, cx + k, cy - r, cx + r, cy - k, cx + r, cy),
          op(PDFOperatorNames.StrokePath),
        );
        line(cx - reach, cy, cx + reach, cy);
        line(cx, cy - reach, cx, cy + reach);
      };
      const out1 = start + reach + mm(0.5);
      target((left + right) / 2, bottom - out1);
      target((left + right) / 2, top + out1);
      target(left - out1, (bottom + top) / 2);
      target(right + out1, (bottom + top) / 2);
    }
    ops.push(op(PDFOperatorNames.PopGraphicsState));
    page.pushOperators(...ops);

    // The colour bar and the line of information lie beyond the marks, in the outer part of the room left for them,
    // so that neither covers a crop mark or a target however narrow the piece is.
    const beyond = bleed + mm(MARK.clear + MARK.length + 2.5);
    if (options.colourBar) drawColourBar(page, left, top + beyond, trim.width);
    if (options.info) {
      const words = [
        options.name,
        `page ${index + 1} of ${count}`,
        `${(trim.width / PT).toFixed(1)} × ${(trim.height / PT).toFixed(1)} mm`,
        bleed > 0 ? `bleed ${(bleed / PT).toFixed(1)} mm` : 'no bleed',
        options.date,
      ]
        .filter(Boolean)
        .join('   ');
      drawInfo(page, font, all, safeText(words), left, bottom - beyond - mm(3), trim.width);
    }
    if (!first)
      first = {
        trim: { width: trim.width / PT, height: trim.height / PT },
        sheet: { width: width / PT, height: height / PT },
        bleedFound: Math.min(have.left, have.right, have.top, have.bottom) / PT,
      };
  }
  return { bytes: await out.save(), pages: count, ...(first as Pick<MarkResult, 'trim' | 'sheet' | 'bleedFound'>) };
}

/** The standard fonts know Latin-1 only: anything else in a file's name becomes a question mark rather than an error. */
const safeText = (text: string) => text.replace(/[^\x20-\x7e\xa0-\xff]/g, '?');

/** The colour bar's patches: each ink solid and at half, the overprints, and steps of black. */
const BAR: readonly (readonly [number, number, number, number])[] = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
  [1, 1, 0, 0],
  [0, 1, 1, 0],
  [1, 0, 1, 0],
  [1, 1, 1, 0],
  [0.5, 0, 0, 0],
  [0, 0.5, 0, 0],
  [0, 0, 0.5, 0],
  [0, 0, 0, 0.5],
  [0, 0, 0, 0.25],
  [0, 0, 0, 0.75],
  [0.5, 0.4, 0.4, 0],
];

function drawColourBar(page: PDFPage, x: number, y: number, room: number): void {
  // Patches of 4 mm, fewer when the piece is narrower than the whole bar.
  const size = mm(4);
  const fits = Math.max(0, Math.min(BAR.length, Math.floor(room / size)));
  const ops: PDFOperator[] = [op(PDFOperatorNames.PushGraphicsState)];
  for (let i = 0; i < fits; i++) {
    const [c, m, yy, k] = BAR[i] as readonly [number, number, number, number];
    ops.push(op(PDFOperatorNames.NonStrokingColorCmyk, c, m, yy, k), op(PDFOperatorNames.AppendRectangle, x + i * size, y, size, size), op(PDFOperatorNames.FillNonZero));
  }
  ops.push(op(PDFOperatorNames.PopGraphicsState));
  page.pushOperators(...ops);
}

function drawInfo(page: PDFPage, font: PDFFont, colour: PDFName, text: string, x: number, y: number, room: number): void {
  const size = 5.5;
  let shown = text;
  while (shown.length > 4 && font.widthOfTextAtSize(shown, size) > room) shown = `${shown.slice(0, -4)}...`;
  const key = page.node.newFontDictionary(font.name, font.ref);
  page.pushOperators(
    op(PDFOperatorNames.PushGraphicsState),
    op(PDFOperatorNames.NonStrokingColorspace, colour),
    op(PDFOperatorNames.NonStrokingColorN, 1),
    op(PDFOperatorNames.BeginText),
    op(PDFOperatorNames.SetFontAndSize, key, size),
    PDFOperator.of(
      PDFOperatorNames.SetTextMatrix,
      [1, 0, 0, 1, x, y].map((value) => PDFNumber.of(value)),
    ),
    PDFOperator.of(PDFOperatorNames.ShowText, [font.encodeText(shown)]),
    op(PDFOperatorNames.EndText),
    op(PDFOperatorNames.PopGraphicsState),
  );
}

/* --------------------------------------------- a CMYK picture -- */

export interface CmykPicture {
  readonly width: number;
  readonly height: number;
  /** Four bytes a pixel: cyan, magenta, yellow, black. */
  readonly cmyk: Uint8Array;
  readonly dpi: number;
  /** The press profile the inks were made for; it goes in as the PDF's output intent. */
  readonly profile: Uint8Array;
  readonly profileName: string;
  readonly title: string;
}

/**
 * A CMYK picture as a one-page PDF at its printed size, with the inks as they are (no colour
 * is converted again on the way) and the profile they were made for named as the output
 * intent, the way PDF/X files tell a print shop which press the numbers are meant for.
 */
export async function cmykPdf(picture: CmykPicture): Promise<Uint8Array> {
  const { width, height, cmyk } = picture;
  if (cmyk.length !== width * height * 4) throw new Error('The picture and its size do not agree.');
  const doc = await PdfDoc.create();
  doc.setProducer('Benchtop');
  doc.setCreator('Benchtop Print Production Studio');
  if (picture.title) doc.setTitle(picture.title);
  const dpi = picture.dpi > 0 ? picture.dpi : 300;
  const w = (width / dpi) * 72;
  const h = (height / dpi) * 72;
  const page = doc.addPage([w, h]);
  const image = doc.context.register(doc.context.flateStream(cmyk, { Type: 'XObject', Subtype: 'Image', Width: width, Height: height, ColorSpace: 'DeviceCMYK', BitsPerComponent: 8 }));
  const key = page.node.newXObject('Picture', image);
  page.pushOperators(
    op(PDFOperatorNames.PushGraphicsState),
    PDFOperator.of(
      PDFOperatorNames.ConcatTransformationMatrix,
      [w, 0, 0, h, 0, 0].map((value) => PDFNumber.of(value)),
    ),
    op(PDFOperatorNames.DrawObject, key),
    op(PDFOperatorNames.PopGraphicsState),
  );
  page.node.set(PDFName.of('TrimBox'), doc.context.obj([0, 0, w, h]));
  const colours = doc.context.register(doc.context.flateStream(picture.profile, { N: 4 }));
  const intent = doc.context.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFX',
    OutputConditionIdentifier: PDFString.of(safeText(picture.profileName) || 'Custom'),
    Info: PDFString.of(safeText(picture.profileName) || 'Custom'),
    DestOutputProfile: colours,
  });
  doc.catalog.set(PDFName.of('OutputIntents'), doc.context.obj([doc.context.register(intent)]));
  return doc.save();
}

/* ------------------------------------------------ nested sheets -- */

export type NestSource =
  | {
      readonly kind: 'pdf';
      readonly doc: PDFDocument;
      readonly page: number;
      /** The part of the page to show, in the page's own points: the rest is left behind (bleed beyond what is wanted, old marks). */
      readonly clip?: { readonly left: number; readonly bottom: number; readonly right: number; readonly top: number };
    }
  | { readonly kind: 'image'; readonly bytes: Uint8Array; readonly type: 'png' | 'jpeg' }
  | { readonly kind: 'outline' };

export interface NestSheet {
  /** Millimetres; `height` of a roll is the length used. */
  readonly width: number;
  readonly height: number;
  /** Crop marks at the corners of every piece; a mark that would print on another piece is left out. */
  readonly marks: boolean;
  /** Each piece's name inside its outline, for pieces with no artwork. */
  readonly names: Readonly<Record<string, string>>;
  /** Bleed inside each piece's box: marks and outlines then stand this far in, at the trim. */
  readonly inset?: number;
}

/** Where a drawing's origin goes, and how wide and tall it is drawn, for a box and a number of quarter turns anticlockwise. */
function turned(x: number, y: number, w: number, h: number, quarters: number): { x: number; y: number; width: number; height: number; angle: number } {
  // pdf-lib turns a drawing about its origin (its bottom left corner), which is moved so that the turned drawing fills the box.
  if (quarters === 1) return { x: x + w, y, width: h, height: w, angle: 90 };
  if (quarters === 2) return { x: x + w, y: y + h, width: w, height: h, angle: 180 };
  if (quarters === 3) return { x, y: y + h, width: h, height: w, angle: 270 };
  return { x, y, width: w, height: h, angle: 0 };
}

/**
 * The sheets of a nesting as a PDF: every piece's artwork at its place and size (turned
 * where the nesting turned it), or its outline and name where there is none.
 */
export async function nestPdf(placements: readonly Placement[], sources: Readonly<Record<string, NestSource>>, sheet: NestSheet): Promise<Uint8Array> {
  const out = await PdfDoc.create();
  out.setProducer('Benchtop');
  out.setCreator('Benchtop Print Production Studio');
  const font = await out.embedFont(StandardFonts.Helvetica);
  const pages = new Map<string, PDFEmbeddedPage | null>();
  const images = new Map<string, PDFImage>();
  const sheets = placements.reduce((most, p) => Math.max(most, p.sheet + 1), 0);
  const W = mm(sheet.width);
  const H = mm(sheet.height);
  const inset = mm(Math.max(0, sheet.inset ?? 0));
  for (let s = 0; s < sheets; s++) {
    const page = out.addPage([W, H]);
    const here = placements.filter((placed) => placed.sheet === s);
    // Every piece's box in the page's own measure: placements count from the top left, a PDF from the bottom left.
    const boxes = here.map((p) => ({ x: mm(p.x), y: H - mm(p.y + p.height), w: mm(p.width), h: mm(p.height) }));
    const marks: PDFOperator[] = [];
    for (const [index, p] of here.entries()) {
      const { x, y, w, h } = boxes[index] as { x: number; y: number; w: number; h: number };
      const quarters = (p.rotated ? 1 : 0) + (p.flip ? 2 : 0);
      const at = turned(x, y, w, h, quarters);
      const source = sources[p.id] ?? { kind: 'outline' };
      if (source.kind === 'pdf') {
        if (!pages.has(p.id)) {
          const from = source.doc.getPage(source.page);
          pages.set(p.id, from.node.Contents() ? await out.embedPage(from, source.clip) : null);
        }
        const embedded = pages.get(p.id);
        if (embedded) page.drawPage(embedded, { x: at.x, y: at.y, xScale: at.width / embedded.width, yScale: at.height / embedded.height, rotate: degrees(at.angle) });
      } else if (source.kind === 'image') {
        let image = images.get(p.id);
        if (!image) {
          image = source.type === 'png' ? await out.embedPng(source.bytes) : await out.embedJpg(source.bytes);
          images.set(p.id, image);
        }
        page.drawImage(image, { x: at.x, y: at.y, width: at.width, height: at.height, rotate: degrees(at.angle) });
      } else {
        const ops: PDFOperator[] = [op(PDFOperatorNames.PushGraphicsState), op(PDFOperatorNames.SetLineWidth, 0.5), op(PDFOperatorNames.StrokingColorGray, 0.35)];
        if (inset > 0 && w > 2 * inset && h > 2 * inset) {
          // The trim as a full line, and the bleed around it as a broken one.
          ops.push(op(PDFOperatorNames.AppendRectangle, x + inset, y + inset, w - 2 * inset, h - 2 * inset), op(PDFOperatorNames.StrokePath));
          ops.push(PDFOperator.of(PDFOperatorNames.SetLineDashPattern, [out.context.obj([2, 2]), PDFNumber.of(0)]), op(PDFOperatorNames.SetLineWidth, 0.25));
        }
        ops.push(op(PDFOperatorNames.AppendRectangle, x, y, w, h), op(PDFOperatorNames.StrokePath), op(PDFOperatorNames.PopGraphicsState));
        page.pushOperators(...ops);
        const label = safeText(`${sheet.names[p.id] ?? p.id}${p.rotated ? ' (turned)' : ''}`);
        const room = Math.max(1, w - 2 * inset);
        const size = Math.max(4, Math.min(10, room / Math.max(4, label.length) / 0.55, (h - 2 * inset) * 0.5));
        page.drawText(label, { x: x + inset + 3, y: y + h - inset - size - 3, size, font });
      }
      if (sheet.marks) {
        const len = mm(3);
        const off = mm(1);
        // The trim's edges, and a mark's line, which is drawn only where it crosses no other piece.
        const left = x + inset;
        const right = x + w - inset;
        const bottom = y + inset;
        const top = y + h - inset;
        const clear = (x1: number, y1: number, x2: number, y2: number) =>
          !boxes.some((b, other) => other !== index && Math.max(x1, x2) > b.x + 0.01 && Math.min(x1, x2) < b.x + b.w - 0.01 && Math.max(y1, y2) > b.y + 0.01 && Math.min(y1, y2) < b.y + b.h - 0.01);
        const line = (x1: number, y1: number, x2: number, y2: number) => {
          if (clear(x1, y1, x2, y2)) marks.push(op(PDFOperatorNames.MoveTo, x1, y1), op(PDFOperatorNames.LineTo, x2, y2), op(PDFOperatorNames.StrokePath));
        };
        // Marks begin clear of the piece's own bleed.
        const from = inset + off;
        for (const cx of [left, right]) {
          line(cx, bottom - from, cx, bottom - from - len);
          line(cx, top + from, cx, top + from + len);
        }
        for (const cy of [bottom, top]) {
          line(left - from, cy, left - from - len, cy);
          line(right + from, cy, right + from + len, cy);
        }
      }
    }
    // Marks go on last, above every piece's artwork.
    if (marks.length)
      page.pushOperators(
        op(PDFOperatorNames.PushGraphicsState),
        op(PDFOperatorNames.SetLineWidth, 0.25),
        op(PDFOperatorNames.StrokingColorCmyk, 1, 1, 1, 1),
        ...marks,
        op(PDFOperatorNames.PopGraphicsState),
      );
  }
  return out.save();
}
