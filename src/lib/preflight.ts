/**
 * Print preflight for PDFs: page and box sizes, fonts and whether they are
 * embedded, picture colour spaces, transparency, spot colours, output
 * intents, and (from a PDF.js operator list) the effective resolution of
 * every placed picture.
 */
import { PDFArray, PDFDict, type PDFDocument, PDFHexString, PDFName, PDFNumber, type PDFObject, type PDFPage, PDFRef, PDFStream, PDFString } from 'pdf-lib';

export const MM_PER_PT = 25.4 / 72;

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PageFacts {
  readonly number: number;
  readonly media: Box;
  readonly trim: Box | null;
  readonly bleed: Box | null;
  readonly rotate: number;
  /** Smallest bleed on any side in points, when both boxes are present. */
  readonly bleedAmount: number | null;
  readonly annotations: number;
  readonly widgets: number;
}

export interface FontFacts {
  readonly name: string;
  readonly type: string;
  readonly embedded: boolean;
  readonly subset: boolean;
  readonly pages: number[];
}

export interface ColourFacts {
  readonly rgbImages: number;
  readonly cmykImages: number;
  readonly grayImages: number;
  readonly otherImages: number;
  readonly spots: string[];
  readonly iccProfiles: number;
}

export interface StructureFacts {
  readonly version: string;
  readonly pages: PageFacts[];
  readonly fonts: FontFacts[];
  readonly colour: ColourFacts;
  readonly transparency: string[];
  readonly outputIntents: string[];
  readonly pdfx: string;
  readonly hasForms: boolean;
}

const name = (o: PDFObject | undefined): string | null => (o instanceof PDFName ? o.decodeText() : null);
const num = (o: PDFObject | undefined): number | null => (o instanceof PDFNumber ? o.asNumber() : null);
const text = (o: PDFObject | undefined): string => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : (name(o) ?? ''));

function deref(doc: PDFDocument, o: PDFObject | undefined): PDFObject | undefined {
  return o instanceof PDFRef ? doc.context.lookup(o) : o;
}

function dictOf(doc: PDFDocument, o: PDFObject | undefined): PDFDict | null {
  const v = deref(doc, o);
  if (v instanceof PDFStream) return v.dict;
  return v instanceof PDFDict ? v : null;
}

function boxOf(doc: PDFDocument, page: PDFPage, key: string): Box | null {
  const arr = deref(doc, page.node.get(PDFName.of(key)));
  if (!(arr instanceof PDFArray) || arr.size() < 4) return null;
  const v = [0, 1, 2, 3].map((i) => num(deref(doc, arr.get(i))) ?? 0) as [number, number, number, number];
  const x = Math.min(v[0], v[2]);
  const y = Math.min(v[1], v[3]);
  return { x, y, width: Math.abs(v[2] - v[0]), height: Math.abs(v[3] - v[1]) };
}

/** RGB, CMYK, Gray, Spot or Other for an image colour space. */
function classify(doc: PDFDocument, cs: PDFObject | undefined, spots: Set<string>, icc: { count: number }): 'rgb' | 'cmyk' | 'gray' | 'other' {
  const v = deref(doc, cs);
  const n = name(v);
  if (n) {
    if (n === 'DeviceRGB' || n === 'CalRGB') return 'rgb';
    if (n === 'DeviceCMYK') return 'cmyk';
    if (n === 'DeviceGray' || n === 'CalGray') return 'gray';
    return 'other';
  }
  if (v instanceof PDFArray && v.size() > 0) {
    const family = name(deref(doc, v.get(0)));
    if (family === 'ICCBased') {
      icc.count++;
      const stream = dictOf(doc, v.get(1));
      const components = num(deref(doc, stream?.get(PDFName.of('N'))));
      return components === 4 ? 'cmyk' : components === 1 ? 'gray' : 'rgb';
    }
    if (family === 'Indexed') return classify(doc, v.get(1), spots, icc);
    if (family === 'Separation') {
      const spot = name(deref(doc, v.get(1)));
      if (spot && spot !== 'All' && spot !== 'None') spots.add(spot);
      return 'other';
    }
    if (family === 'DeviceN') {
      const names = deref(doc, v.get(1));
      if (names instanceof PDFArray)
        for (let i = 0; i < names.size(); i++) {
          const spot = name(deref(doc, names.get(i)));
          if (spot && !['Cyan', 'Magenta', 'Yellow', 'Black', 'None', 'All'].includes(spot)) spots.add(spot);
        }
      return 'other';
    }
    if (family === 'CalRGB') return 'rgb';
    if (family === 'CalGray') return 'gray';
  }
  return 'other';
}

function fontFacts(doc: PDFDocument, dict: PDFDict): Omit<FontFacts, 'pages'> {
  const subtype = name(deref(doc, dict.get(PDFName.of('Subtype')))) ?? 'Unknown';
  const base = name(deref(doc, dict.get(PDFName.of('BaseFont')))) ?? text(deref(doc, dict.get(PDFName.of('Name')))) ?? '';
  if (subtype === 'Type3') return { name: base || 'Type 3 font', type: 'Type 3', embedded: true, subset: false };
  let descriptor = dictOf(doc, dict.get(PDFName.of('FontDescriptor')));
  if (subtype === 'Type0') {
    const descendants = deref(doc, dict.get(PDFName.of('DescendantFonts')));
    const first = descendants instanceof PDFArray ? dictOf(doc, descendants.get(0)) : null;
    descriptor = first ? dictOf(doc, first.get(PDFName.of('FontDescriptor'))) : null;
  }
  const embedded = !!descriptor && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => descriptor?.get(PDFName.of(k)) !== undefined);
  return { name: base.replace(/^[A-Z]{6}\+/, ''), type: subtype === 'Type0' ? 'Type 0 (CID)' : subtype, embedded, subset: /^[A-Z]{6}\+/.test(base) };
}

export function scanStructure(doc: PDFDocument, bytes: Uint8Array): StructureFacts {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 16));
  const version = /%PDF-(\d\.\d)/.exec(head)?.[1] ?? '?';
  const fonts = new Map<string, FontFacts>();
  const spots = new Set<string>();
  const icc = { count: 0 };
  const colour = { rgbImages: 0, cmykImages: 0, grayImages: 0, otherImages: 0 };
  const transparency = new Set<string>();
  const seenImages = new Set<string>();
  const seenResources = new Set<PDFDict>();

  const visit = (resources: PDFDict | null, pageNumber: number, depth: number) => {
    if (!resources || depth > 10 || seenResources.has(resources)) return;
    seenResources.add(resources);
    const fontDict = dictOf(doc, resources.get(PDFName.of('Font')));
    if (fontDict)
      for (const [key, value] of fontDict.entries()) {
        const f = dictOf(doc, value);
        if (!f) continue;
        const id = value instanceof PDFRef ? value.toString() : `${pageNumber}/${key.decodeText()}`;
        const known = fonts.get(id);
        if (known) {
          if (!known.pages.includes(pageNumber)) known.pages.push(pageNumber);
          continue;
        }
        fonts.set(id, { ...fontFacts(doc, f), pages: [pageNumber] });
      }
    const gs = dictOf(doc, resources.get(PDFName.of('ExtGState')));
    if (gs)
      for (const [, value] of gs.entries()) {
        const g = dictOf(doc, value);
        if (!g) continue;
        const ca = num(deref(doc, g.get(PDFName.of('ca'))));
        const CA = num(deref(doc, g.get(PDFName.of('CA'))));
        if ((ca !== null && ca < 1) || (CA !== null && CA < 1)) transparency.add('Opacity below 100%');
        const smask = deref(doc, g.get(PDFName.of('SMask')));
        if (smask && name(smask) !== 'None') transparency.add('Soft masks');
        const bm = deref(doc, g.get(PDFName.of('BM')));
        const mode = name(bm) ?? (bm instanceof PDFArray ? name(deref(doc, bm.get(0))) : null);
        if (mode && mode !== 'Normal' && mode !== 'Compatible') transparency.add(`Blend mode ${mode}`);
      }
    const cs = dictOf(doc, resources.get(PDFName.of('ColorSpace')));
    if (cs) for (const [, value] of cs.entries()) classify(doc, value, spots, icc);
    const xobjects = dictOf(doc, resources.get(PDFName.of('XObject')));
    if (xobjects)
      for (const [, value] of xobjects.entries()) {
        const x = dictOf(doc, value);
        if (!x) continue;
        const subtype = name(deref(doc, x.get(PDFName.of('Subtype'))));
        if (subtype === 'Image') {
          const id = value instanceof PDFRef ? value.toString() : `inline-${seenImages.size}`;
          if (seenImages.has(id)) continue;
          seenImages.add(id);
          if (x.get(PDFName.of('SMask'))) transparency.add('Pictures with transparency');
          if (x.get(PDFName.of('ImageMask'))) continue;
          const kind = classify(doc, x.get(PDFName.of('ColorSpace')), spots, icc);
          if (kind === 'rgb') colour.rgbImages++;
          else if (kind === 'cmyk') colour.cmykImages++;
          else if (kind === 'gray') colour.grayImages++;
          else colour.otherImages++;
        } else if (subtype === 'Form') {
          const group = dictOf(doc, x.get(PDFName.of('Group')));
          if (group && name(deref(doc, group.get(PDFName.of('S')))) === 'Transparency') transparency.add('Transparency groups');
          visit(dictOf(doc, x.get(PDFName.of('Resources'))), pageNumber, depth + 1);
        }
      }
  };

  const pages: PageFacts[] = doc.getPages().map((page, i) => {
    const media = boxOf(doc, page, 'MediaBox') ?? { x: 0, y: 0, ...page.getSize() };
    const trim = boxOf(doc, page, 'TrimBox');
    const bleed = boxOf(doc, page, 'BleedBox');
    let bleedAmount: number | null = null;
    if (trim) {
      const outer = bleed ?? media;
      bleedAmount = Math.min(trim.x - outer.x, trim.y - outer.y, outer.x + outer.width - (trim.x + trim.width), outer.y + outer.height - (trim.y + trim.height));
    }
    const annots = deref(doc, page.node.get(PDFName.of('Annots')));
    let annotations = 0;
    let widgets = 0;
    if (annots instanceof PDFArray)
      for (let k = 0; k < annots.size(); k++) {
        const a = dictOf(doc, annots.get(k));
        const sub = name(deref(doc, a?.get(PDFName.of('Subtype'))));
        if (sub === 'Widget') widgets++;
        else if (sub && sub !== 'Link') annotations++;
      }
    visit(page.node.Resources() ?? null, i + 1, 0);
    return { number: i + 1, media, trim, bleed, rotate: page.getRotation().angle, bleedAmount, annotations, widgets };
  });

  const catalog = doc.catalog;
  const intents = deref(doc, catalog.get(PDFName.of('OutputIntents')));
  const outputIntents: string[] = [];
  if (intents instanceof PDFArray)
    for (let i = 0; i < intents.size(); i++) {
      const d = dictOf(doc, intents.get(i));
      if (!d) continue;
      const s = name(deref(doc, d.get(PDFName.of('S')))) ?? '';
      const id = text(deref(doc, d.get(PDFName.of('OutputConditionIdentifier'))));
      outputIntents.push([s, id].filter(Boolean).join(': '));
    }
  const infoRef = doc.context.trailerInfo.Info;
  const info = infoRef ? dictOf(doc, infoRef as PDFObject) : null;
  const pdfx = info ? text(deref(doc, info.get(PDFName.of('GTS_PDFXVersion')))) : '';
  const hasForms = !!deref(doc, catalog.get(PDFName.of('AcroForm')));

  return {
    version,
    pages,
    fonts: [...fonts.values()].sort((a, b) => Number(a.embedded) - Number(b.embedded) || a.name.localeCompare(b.name)),
    colour: { ...colour, spots: [...spots].sort(), iccProfiles: icc.count },
    transparency: [...transparency],
    outputIntents,
    pdfx,
    hasForms,
  };
}

/* ------------------------------------------------------ picture resolution -- */

/** The PDF.js operator numbers this module reads. */
export const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  beginGroup: 76,
  endGroup: 77,
  paintImageXObject: 85,
  paintInlineImageXObject: 86,
} as const;

export interface Placement {
  readonly page: number;
  readonly pixelsWide: number;
  readonly pixelsHigh: number;
  /** Placed size in points. */
  readonly width: number;
  readonly height: number;
  /** Effective resolution: the lower of the two directions. */
  readonly dpi: number;
}

type Matrix = [number, number, number, number, number, number];
const multiply = (m: Matrix, n: readonly number[]): Matrix => {
  const [a, b, c, d, e, f] = m;
  const [a2 = 1, b2 = 0, c2 = 0, d2 = 1, e2 = 0, f2 = 0] = n;
  return [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f];
};

/** Walks a PDF.js operator list keeping the current transform, and measures every picture drawn. */
export function placements(page: number, fnArray: ArrayLike<number>, argsArray: ArrayLike<unknown>): Placement[] {
  const out: Placement[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[] | null;
    switch (fn) {
      case OPS.save:
        stack.push(ctm);
        break;
      case OPS.restore:
        ctm = stack.pop() ?? ctm;
        break;
      case OPS.transform:
        ctm = multiply(ctm, (args ?? []) as number[]);
        break;
      case OPS.paintFormXObjectBegin: {
        stack.push(ctm);
        const matrix = args?.[0] as number[] | null | undefined;
        if (matrix && matrix.length === 6) ctm = multiply(ctm, matrix);
        break;
      }
      case OPS.beginGroup: {
        stack.push(ctm);
        const matrix = (args?.[0] as { matrix?: number[] } | undefined)?.matrix;
        if (matrix && matrix.length === 6) ctm = multiply(ctm, matrix);
        break;
      }
      case OPS.paintFormXObjectEnd:
      case OPS.endGroup:
        ctm = stack.pop() ?? ctm;
        break;
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject: {
        let w: number;
        let h: number;
        if (fn === OPS.paintImageXObject) {
          w = Number(args?.[1]);
          h = Number(args?.[2]);
        } else {
          const img = args?.[0] as { width?: number; height?: number } | undefined;
          w = Number(img?.width);
          h = Number(img?.height);
        }
        if (!(w > 0 && h > 0)) break;
        const width = Math.hypot(ctm[0], ctm[1]);
        const height = Math.hypot(ctm[2], ctm[3]);
        if (width < 0.5 || height < 0.5) break;
        out.push({ page, pixelsWide: w, pixelsHigh: h, width, height, dpi: Math.min(w / (width / 72), h / (height / 72)) });
        break;
      }
    }
  }
  return out;
}
