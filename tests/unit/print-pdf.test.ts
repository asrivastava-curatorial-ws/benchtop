import { inflateSync } from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFName, type PDFNumber, PDFRawStream, type PDFRef, rgb } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { addMarks, cmykPdf, DEFAULT_MARKS, nestPdf, PT, trimOf } from '../../src/lib/print-pdf';

const mm = (value: number) => value * PT;
const numbers = (page: ReturnType<PDFDocument['getPage']>, key: string) => {
  const box = page.node.lookup(PDFName.of(key));
  return box instanceof PDFArray ? [0, 1, 2, 3].map((i) => (box.lookup(i) as PDFNumber).asNumber() / PT) : null;
};
/** The drawing instructions of a page, as text. */
const contentOf = (doc: PDFDocument, index: number): string => {
  const contents = doc.getPage(index).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
  return streams
    .map((stream) => {
      if (!(stream instanceof PDFRawStream)) return String(stream);
      const packed = stream.dict.get(PDFName.of('Filter'));
      return Buffer.from(packed ? inflateSync(stream.contents) : stream.contents).toString('latin1');
    })
    .join('\n');
};

/** The pictures and embedded pages a page draws: each one's stream, once however often it is drawn. */
const drawn = (doc: PDFDocument, index: number): PDFRawStream[] => {
  const all = doc.getPage(index).node.Resources()?.lookup(PDFName.of('XObject'));
  if (!(all instanceof PDFDict)) return [];
  const refs = new Set(all.entries().map(([, ref]) => ref));
  return [...refs].map((ref) => doc.context.lookup(ref as PDFRef) as PDFRawStream);
};
const boxMm = (stream: PDFRawStream | undefined) => {
  const box = stream?.dict.lookup(PDFName.of('BBox')) as PDFArray;
  return [0, 1, 2, 3].map((i) => Math.round(((box.lookup(i) as PDFNumber).asNumber() / PT) * 10) / 10);
};
/** Whether a page's drawing has an instruction with these numbers before it (to a hundredth of a point). */
const has = (content: string, operator: string, wanted: number[]) =>
  content.split('\n').some((line) => {
    const parts = line.trim().split(/\s+/);
    if (parts.pop() !== operator || parts.length !== wanted.length) return false;
    return parts.every((part, i) => Math.abs(Number(part) - (wanted[i] as number)) < 0.01);
  });

async function artwork(pages = 2, withTrimBox = false): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    // A5 with 3 mm of bleed all round.
    const page = doc.addPage([mm(154), mm(216)]);
    page.drawRectangle({ x: 0, y: 0, width: mm(154), height: mm(216), color: rgb(0.1, 0.4, 0.7) });
    if (withTrimBox) page.node.set(PDFName.of('TrimBox'), doc.context.obj([mm(3), mm(3), mm(151), mm(213)]));
  }
  return PDFDocument.load(await doc.save());
}

describe('printer’s marks', () => {
  it('finds the trim from the page’s own trim box, or from the bleed it is said to carry', async () => {
    const plain = await artwork(1);
    const found = trimOf(plain.getPage(0), 3);
    expect(found.own).toBe(false);
    expect([found.trim.x, found.trim.y, found.trim.width, found.trim.height].map((v) => Math.round((v / PT) * 10) / 10)).toEqual([3, 3, 148, 210]);
    expect(trimOf(plain.getPage(0), 0).trim.width / PT).toBeCloseTo(154);
    const boxed = await artwork(1, true);
    const own = trimOf(boxed.getPage(0), 0);
    expect(own.own).toBe(true);
    expect(own.trim.width / PT).toBeCloseTo(148);
    // A bleed larger than the page leaves a sliver, not a negative size.
    expect(trimOf(plain.getPage(0), 500).trim.width).toBeGreaterThan(0);
  });

  it('puts each page on a larger one, with the trim and bleed boxes set and marks on every plate', async () => {
    const source = await artwork(2);
    const result = await addMarks(source, { ...DEFAULT_MARKS, bleedInPage: 3, bleed: 3, bleedMarks: true, name: 'Gallery guide — ಕನ್ನಡ.pdf', date: '2026-11-24' });
    expect(result.pages).toBe(2);
    expect(result.trim.width).toBeCloseTo(148);
    expect(result.trim.height).toBeCloseTo(210);
    expect(result.bleedFound).toBeCloseTo(3);
    // Trim, 3 mm of bleed and 14 mm for the marks on every side.
    expect(result.sheet.width).toBeCloseTo(148 + 2 * 17);
    expect(result.sheet.height).toBeCloseTo(210 + 2 * 17);
    const made = await PDFDocument.load(result.bytes);
    expect(made.getPageCount()).toBe(2);
    const page = made.getPage(0);
    expect(page.getSize().width / PT).toBeCloseTo(182);
    expect(numbers(page, 'TrimBox')?.map((v) => Math.round(v * 10) / 10)).toEqual([17, 17, 165, 227]);
    expect(numbers(page, 'BleedBox')?.map((v) => Math.round(v * 10) / 10)).toEqual([14, 14, 168, 230]);
    // Registration colour: a separation named All, used for the marks' strokes and the text.
    const spaces = page.node.Resources()?.lookup(PDFName.of('ColorSpace'));
    expect(spaces).toBeInstanceOf(PDFDict);
    const all = (spaces as PDFDict).lookup(PDFName.of('BenchtopAll'));
    expect(all).toBeInstanceOf(PDFArray);
    expect((all as PDFArray).lookup(0)).toBe(PDFName.of('Separation'));
    expect((all as PDFArray).lookup(1)).toBe(PDFName.of('All'));
    const content = contentOf(made, 0);
    expect(content).toContain('/BenchtopAll CS');
    expect(content).toContain('/BenchtopAll cs');
    // Eight crop marks, eight bleed marks and four targets of two lines each: 24 straight strokes, and four circles.
    expect(content.match(/ l\nS/g)).toHaveLength(24);
    expect(content.match(/ c\nS/g)).toHaveLength(4);
    // The first crop mark starts 1 mm outside the bleed, below the bottom left corner of the trim.
    expect(has(content, 'm', [mm(17), mm(13)])).toBe(true);
    expect(has(content, 'l', [mm(17), mm(8)])).toBe(true);
    // The colour bar: fifteen patches filled in ink numbers.
    expect(content.match(/ k\n/g)).toHaveLength(15);
    expect(content).toContain('1 0 0 0 k');
    // It lies beyond the crop marks and the targets (which end 7.5 mm outside the bleed), within the 14 mm left for marks.
    expect(has(content, 're', [mm(17), mm(227 + 3 + 8.5), mm(4), mm(4)])).toBe(true);
    // So does the line of information, below the page.
    expect(has(content, 'Tm', [1, 0, 0, 1, mm(17), mm(17 - 3 - 8.5 - 3)])).toBe(true);
    // The line of information, with what the standard font cannot write replaced.
    expect(content).toContain('Tj');
    expect(contentOf(made, 1)).toContain('BT');
  });

  it('keeps no more bleed than the page has, leaves old marks behind, and can do without any mark', async () => {
    const source = await artwork(1);
    // The page is taken as having no bleed at all: 5 mm are asked for, none can be kept.
    const none = await addMarks(source, { ...DEFAULT_MARKS, bleedInPage: 0, bleed: 5 });
    expect(none.bleedFound).toBeCloseTo(0);
    expect(none.trim.width).toBeCloseTo(154);
    const made = await PDFDocument.load(none.bytes);
    // The page is shown through a window of exactly its trim.
    expect(drawn(made, 0)).toHaveLength(1);
    expect(boxMm(drawn(made, 0)[0])).toEqual([0, 0, 154, 216]);
    const bare = await addMarks(await artwork(1, true), { ...DEFAULT_MARKS, bleed: 2, crop: false, registration: false, colourBar: false, info: false });
    const bareDoc = await PDFDocument.load(bare.bytes);
    const content = contentOf(bareDoc, 0);
    expect(content.match(/ l\nS/g)).toBeNull();
    expect(content).not.toContain(' k\n');
    expect(content).not.toContain('BT');
    expect(bare.trim.width).toBeCloseTo(148);
    // Only 2 of the page's 3 mm of bleed are kept: the window is the trim and 2 mm.
    expect(boxMm(drawn(bareDoc, 0)[0])).toEqual([1, 1, 153, 215]);
    // A page with nothing on it still gets its marks.
    const blank = await PDFDocument.create();
    blank.addPage([mm(100), mm(60)]);
    const marked = await addMarks(await PDFDocument.load(await blank.save()), DEFAULT_MARKS);
    expect(marked.pages).toBe(1);
    expect(contentOf(await PDFDocument.load(marked.bytes), 0)).toContain('/BenchtopAll CS');
    await expect(addMarks(await PDFDocument.create(), DEFAULT_MARKS)).rejects.toThrow(/no pages/);
  });
});

describe('a CMYK picture as a PDF', () => {
  it('keeps the ink numbers as they are and names the profile as the output intent', async () => {
    const width = 6;
    const height = 4;
    const cmyk = new Uint8Array(width * height * 4).map((_, i) => (i * 11) % 256);
    const profile = new Uint8Array(500).map((_, i) => i % 251);
    const bytes = await cmykPdf({ width, height, cmyk, dpi: 300, profile, profileName: 'Coated FOGRA39', title: 'Poster' });
    const doc = await PDFDocument.load(bytes);
    const page = doc.getPage(0);
    expect(page.getSize().width).toBeCloseTo((width / 300) * 72);
    expect(page.getSize().height).toBeCloseTo((height / 300) * 72);
    const picture = drawn(doc, 0)[0] as PDFRawStream;
    expect(picture.dict.lookup(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceCMYK'));
    expect((picture.dict.lookup(PDFName.of('Width')) as PDFNumber).asNumber()).toBe(6);
    expect((picture.dict.lookup(PDFName.of('BitsPerComponent')) as PDFNumber).asNumber()).toBe(8);
    expect(new Uint8Array(inflateSync(picture.contents))).toEqual(cmyk);
    const intents = doc.catalog.lookup(PDFName.of('OutputIntents')) as PDFArray;
    const intent = intents.lookup(0) as PDFDict;
    expect(intent.lookup(PDFName.of('S'))).toBe(PDFName.of('GTS_PDFX'));
    const stored = intent.lookup(PDFName.of('DestOutputProfile')) as PDFRawStream;
    expect((stored.dict.lookup(PDFName.of('N')) as PDFNumber).asNumber()).toBe(4);
    expect(new Uint8Array(inflateSync(stored.contents))).toEqual(profile);
    expect(doc.getTitle()).toBe('Poster');
    await expect(cmykPdf({ width: 2, height: 2, cmyk: new Uint8Array(3), dpi: 300, profile, profileName: '', title: '' })).rejects.toThrow(/do not agree/);
  });
});

describe('nested sheets as a PDF', () => {
  it('draws artwork at its place, turned where the nesting turned it, and outlines where there is none', async () => {
    const card = await PDFDocument.create();
    card.addPage([mm(90), mm(55)]).drawRectangle({ x: 0, y: 0, width: mm(90), height: mm(55), color: rgb(0.8, 0.2, 0.2) });
    const source = await PDFDocument.load(await card.save());
    const placements = [
      { id: 'card', copy: 0, sheet: 0, x: 10, y: 10, width: 90, height: 55, rotated: false },
      { id: 'card', copy: 1, sheet: 0, x: 104, y: 10, width: 55, height: 90, rotated: true },
      { id: 'label', copy: 0, sheet: 1, x: 10, y: 10, width: 60, height: 40, rotated: false },
    ];
    const bytes = await nestPdf(placements, { card: { kind: 'pdf', doc: source, page: 0 } }, { width: 320, height: 450, marks: true, names: { label: 'Shelf label' } });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getSize().width / PT).toBeCloseTo(320);
    expect(doc.getPage(0).getSize().height / PT).toBeCloseTo(450);
    const first = contentOf(doc, 0);
    // The card's page is embedded once and drawn twice.
    expect(drawn(doc, 0)).toHaveLength(1);
    expect(first.match(/ Do\n/g)).toHaveLength(2);
    // Upright: at 10 mm from the left and 450 - 10 - 55 mm from the bottom.
    expect(has(first, 'cm', [1, 0, 0, 1, mm(10), mm(385)])).toBe(true);
    // Crop marks for both pieces: eight strokes each.
    expect(first.match(/ l\nS/g)).toHaveLength(16);
    const second = contentOf(doc, 1);
    expect(second).toContain(' re\nS');
    expect(second).toContain('Tj');
    expect(second).not.toContain(' Do\n');
  });

  it('turns a piece each of the four ways, for fronts and for backs', async () => {
    const source = await artwork(1);
    const box = { sheet: 0, x: 20, y: 30, width: 90, height: 55 };
    const tall = { sheet: 0, x: 150, y: 30, width: 55, height: 90 };
    const bytes = await nestPdf(
      [
        { id: 'card', copy: 0, ...box, rotated: false },
        { id: 'card', copy: 1, ...tall, rotated: true },
        { id: 'card', copy: 2, ...box, sheet: 1, rotated: false, flip: true },
        { id: 'card', copy: 3, ...tall, sheet: 1, rotated: true, flip: true },
      ],
      { card: { kind: 'pdf', doc: source, page: 0 } },
      { width: 320, height: 450, marks: false, names: {} },
    );
    const doc = await PDFDocument.load(bytes);
    const front = contentOf(doc, 0);
    const back = contentOf(doc, 1);
    // A PDF counts from the bottom: the boxes' bottom edges are at 450 - 30 - their height.
    const low = mm(450 - 30 - 55);
    const lowTall = mm(450 - 30 - 90);
    // Upright: drawn from the box's bottom left corner.
    expect(has(front, 'cm', [1, 0, 0, 1, mm(20), low])).toBe(true);
    // A quarter turn anticlockwise: from the bottom right, with the drawing's width running up.
    expect(has(front, 'cm', [1, 0, 0, 1, mm(150 + 55), lowTall])).toBe(true);
    expect(has(front, 'cm', [0, 1, -1, 0, 0, 0])).toBe(true);
    // Half a turn: from the top right.
    expect(has(back, 'cm', [1, 0, 0, 1, mm(20 + 90), low + mm(55)])).toBe(true);
    expect(has(back, 'cm', [-1, 0, 0, -1, 0, 0])).toBe(true);
    // Three quarters: from the top left, with the drawing's width running down.
    expect(has(back, 'cm', [1, 0, 0, 1, mm(150), lowTall + mm(90)])).toBe(true);
    expect(has(back, 'cm', [0, -1, 1, 0, 0, 0])).toBe(true);
  });

  it('puts crop marks at the trim, and leaves out those that would print on a neighbour', async () => {
    const placements = [
      { id: 'a', copy: 0, sheet: 0, x: 10, y: 10, width: 60, height: 40, rotated: false },
      { id: 'a', copy: 1, sheet: 0, x: 70, y: 10, width: 60, height: 40, rotated: false },
    ];
    const bytes = await nestPdf(placements, {}, { width: 200, height: 100, marks: true, names: { a: 'Tag' }, inset: 3 });
    const doc = await PDFDocument.load(bytes);
    const content = contentOf(doc, 0);
    // Each piece keeps its marks above, below and on its outer side; the four between the pieces are left out.
    expect(content.match(/ l\nS/g)).toHaveLength(12);
    // The first piece's trim is 3 mm inside its box: its left crop mark runs from 4 mm outside the trim (1 mm outside the box).
    const top = mm(100 - 10 - 3);
    expect(has(content, 'm', [mm(13 - 4), top])).toBe(true);
    expect(has(content, 'l', [mm(13 - 7), top])).toBe(true);
    // The trim is outlined in full, and the box with its bleed in a broken line.
    expect(has(content, 're', [mm(13), mm(100 - 10 - 40 + 3), mm(54), mm(34)])).toBe(true);
    expect(has(content, 're', [mm(10), mm(100 - 10 - 40), mm(60), mm(40)])).toBe(true);
    expect(content).toMatch(/\[\s*2 2\s*\]\s*0 d/);
  });
});
