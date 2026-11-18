import { readFile } from 'node:fs/promises';
import { degrees, PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { assemble, extractPages, loadPdf, paperName, parseGroups, parsePages, picturesToPdf, planSplit, readInfo, stampPdf, stampPreview, viewToPage, writeInfo } from '../../src/lib/pdf-edit';
import { embedUnicodeFont, latinOnly, setFontLoader, shape } from '../../src/lib/pdf-text';

/** A PDF whose pages say "Page N" so their order can be checked. */
async function sample(pages: number, rotate = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`Page ${i}`, { x: 50, y: 780, size: 20, font });
    if (rotate) page.setRotation(degrees(rotate));
  }
  doc.setTitle('Sample');
  doc.setAuthor('Benchtop tests');
  return doc.save();
}

/** Text of every page, in order, read back with PDF.js. */
async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), useWorkerFetch: false });
  const doc = await task.promise;
  const texts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    texts.push(
      content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
  }
  await task.destroy();
  return texts;
}

describe('page lists', () => {
  it('reads numbers, ranges, open ranges and keywords', () => {
    expect(parsePages('1-3, 5, 8-', 10)).toEqual([1, 2, 3, 5, 8, 9, 10]);
    expect(parsePages('1 - 3', 5)).toEqual([1, 2, 3]);
    expect(parsePages('5-3', 5)).toEqual([5, 4, 3]);
    expect(parsePages('-2', 5)).toEqual([1, 2]);
    expect(parsePages('odd', 5)).toEqual([1, 3, 5]);
    expect(parsePages('even', 5)).toEqual([2, 4]);
    expect(parsePages('last', 7)).toEqual([7]);
    expect(parsePages('', 3)).toEqual([]);
    expect(() => parsePages('9', 3)).toThrow(/does not exist/);
    expect(() => parsePages('a-b', 3)).toThrow(/not a page/);
    expect(parseGroups('1-2, 3, 4-', 6)).toEqual([[1, 2], [3], [4, 5, 6]]);
  });

  it('plans splits', () => {
    expect(planSplit('every', 3, {}, 'doc').map((p) => p.name)).toEqual(['doc p1.pdf', 'doc p2.pdf', 'doc p3.pdf']);
    expect(planSplit('chunks', 5, { size: 2 }, 'doc').map((p) => p.pages)).toEqual([[1, 2], [3, 4], [5]]);
    expect(planSplit('ranges', 6, { ranges: '1-2, 5-6' }, 'doc').map((p) => p.name)).toEqual(['doc part 1 (pages 1-2).pdf', 'doc part 2 (pages 5-6).pdf']);
    expect(planSplit('remove', 4, { ranges: '2, 4' }, 'doc')[0].pages).toEqual([1, 3]);
    expect(() => planSplit('remove', 2, { ranges: '1-2' }, 'doc')).toThrow(/every page/);
    expect(planSplit('every', 12, {}, 'x')[0].name).toBe('x p01.pdf');
  });

  it('names paper sizes', () => {
    expect(paperName(595.28, 841.89)).toBe('A4');
    expect(paperName(841.89, 595.28)).toBe('A4 landscape');
    expect(paperName(612, 792)).toBe('Letter');
    expect(paperName(500, 500)).toBe('176 × 176 mm');
  });
});

describe('editing', () => {
  it('extracts pages in the order asked', async () => {
    const doc = await loadPdf(await sample(5));
    const out = await extractPages(doc, [4, 2]);
    expect(await pageTexts(out)).toEqual(['Page 4', 'Page 2']);
    const reread = await PDFDocument.load(out);
    expect(reread.getTitle()).toBe('Sample');
  });

  it('merges, reorders, repeats and rotates pages', async () => {
    const a = await loadPdf(await sample(2));
    const b = await loadPdf(await sample(3, 90));
    const out = await assemble(
      [a, b],
      [
        { source: 1, index: 2, rotate: 0 },
        { source: 0, index: 0, rotate: 90 },
        { source: 1, index: 0, rotate: 270 },
        { source: 0, index: 0, rotate: 0 },
      ],
    );
    expect(await pageTexts(out)).toEqual(['Page 3', 'Page 1', 'Page 1', 'Page 1']);
    const pages = (await PDFDocument.load(out)).getPages();
    expect(pages.map((p) => p.getRotation().angle)).toEqual([90, 90, 0, 0]);
  });

  it('refuses encrypted files with a clear message', async () => {
    // A minimal PDF with an /Encrypt entry in its trailer.
    const doc = await PDFDocument.create();
    doc.addPage();
    const bytes = await doc.save({ useObjectStreams: false });
    const text = new TextDecoder('latin1').decode(bytes).replace('trailer\n<<', 'trailer\n<<\n/Encrypt << /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -4 >>');
    const encrypted = Uint8Array.from(text, (c) => c.charCodeAt(0));
    await expect(loadPdf(encrypted)).rejects.toThrow(/password-protected/);
  });

  it('stamps numbers, a header and a watermark upright, also on turned pages', async () => {
    const doc = await loadPdf(await sample(3, 90));
    const out = await stampPdf(doc, {
      pages: '2-3',
      numbers: { format: 'Page {n} of {total}', position: 'bottom-center', size: 10, colour: '#333333', start: 1, margin: 10 },
      text: { value: 'Draft for review', position: 'top-left', size: 9, colour: '#666666', margin: 10 },
      watermark: { text: 'CONFIDENTIAL', size: 60, colour: '#cc0000', opacity: 0.2, angle: 45, tiled: false, bold: true },
    });
    const texts = await pageTexts(out);
    expect(texts[0]).toBe('Page 1');
    expect(texts[1]).toContain('Page 1 of 2');
    expect(texts[2]).toContain('Page 2 of 2');
    expect(texts[2]).toContain('CONFIDENTIAL');
    expect(texts[2]).toContain('Draft for review');
    // On a page turned 90°, the shown bottom edge is the page's right edge.
    const page = (await PDFDocument.load(out)).getPage(1);
    const view = viewToPage(page);
    expect(view.width).toBeCloseTo(841.89, 1);
    expect(view.map(0, 0)).toEqual([595.28, 0]);
  });

  it('previews one page numbered as in the whole document', async () => {
    const doc = await loadPdf(await sample(4));
    const options = { pages: '2-', numbers: { format: '{n}/{total}', position: 'bottom-right' as const, size: 10, colour: '#000000', start: 5, margin: 10 } };
    expect(await pageTexts(await stampPreview(doc, options, 3))).toEqual(['Page 3 6/7']);
    expect(await pageTexts(await stampPreview(doc, options, 1))).toEqual(['Page 1']);
  });

  it('stamps Hindi and the rupee sign with Benchtop Sans, shaped and searchable', async () => {
    setFontLoader(async (file) => new Uint8Array(await readFile(new URL(`../../public/fonts/${file}`, import.meta.url))));
    const doc = await loadPdf(await sample(1));
    const out = await stampPdf(doc, {
      pages: '',
      text: { value: 'मूल्य ₹100', position: 'top-left', size: 12, colour: '#000000', margin: 10 },
      watermark: { text: 'गोपनीय', size: 40, colour: '#ff0000', opacity: 0.3, angle: 45, tiled: false, bold: true },
    });
    const [text] = await pageTexts(out);
    expect(text).toContain('₹100');
    expect(text).toContain('Page 1');
    expect(text.replace(/\s/g, '')).toMatch(/[\u0900-\u097f]/);
    // Latin-only stamps keep the built-in font and add no font file.
    const plain = await stampPdf(await loadPdf(await sample(1)), { pages: '', text: { value: 'Draft', position: 'top-left', size: 9, colour: '#000000', margin: 10 } });
    expect(plain.length).toBeLessThan(out.length / 10);
  });

  it("lays out Devanagari with the font's positioning rules", async () => {
    setFontLoader(async (file) => new Uint8Array(await readFile(new URL(`../../public/fonts/${file}`, import.meta.url))));
    const doc = await PDFDocument.create();
    const font = await embedUnicodeFont(doc);
    const shaped = shape(font, 'दुनिया');
    // The vowel sign ि is drawn before न although it is typed after it.
    expect(shaped.glyphs?.length).toBeGreaterThanOrEqual(5);
    // Marks take no room: the shaped text is narrower than the sum of plain advance widths.
    const plain = [...'दुनिया'].reduce((sum, ch) => sum + font.widthOfTextAtSize(ch, 1), 0);
    expect(shaped.width).toBeLessThan(plain);
    expect(latinOnly(['Price 100 €'])).toBe(true);
    expect(latinOnly(['₹100'])).toBe(false);
  });

  it('reads, writes and clears properties', async () => {
    const bytes = await sample(2);
    const doc = await loadPdf(bytes);
    const { info, facts } = readInfo(doc, bytes);
    expect(info.title).toBe('Sample');
    expect(facts.pages).toBe(2);
    expect(facts.sizes).toEqual([{ width: 595.28, height: 841.89, count: 2, name: 'A4' }]);
    const written = await writeInfo(doc, { ...info, title: 'New title', keywords: 'one, two' }, false);
    const reread = await PDFDocument.load(written);
    expect(reread.getTitle()).toBe('New title');
    expect(reread.getKeywords()).toBe('one two');
    const cleared = await writeInfo(await loadPdf(written), info, true);
    const text = new TextDecoder('latin1').decode(cleared);
    expect(text).not.toContain('New title');
    expect(text).not.toContain('Benchtop tests');
  });

  it('places pictures on pages', async () => {
    // 2 × 1 px PNG.
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwnwEIGGAMAEb2Af9C/0gYAAAAAElFTkSuQmCC'), (c) => c.charCodeAt(0));
    const fit = await PDFDocument.load(await picturesToPdf([{ bytes: png, kind: 'png' }], { size: 'fit', orientation: 'auto', margin: 0, dpi: 72 }));
    expect(fit.getPage(0).getSize()).toEqual({ width: 2, height: 1 });
    const a4 = await PDFDocument.load(await picturesToPdf([{ bytes: png, kind: 'png' }], { size: 'a4', orientation: 'auto', margin: 10, dpi: 96 }));
    const size = a4.getPage(0).getSize();
    expect(size.width).toBeGreaterThan(size.height);
  });
});
