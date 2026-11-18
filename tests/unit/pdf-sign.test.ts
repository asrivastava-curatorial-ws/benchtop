import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { dropXfa, fillPdf, readForm, wrap } from '../../src/lib/pdf-forms';
import { createSelfSigned, isSigned, readP12, signPdf } from '../../src/lib/pdf-sign';
import { checkPdfSignatures } from '../../src/lib/pdf-signature';
import { embedUnicodeFont, setFontLoader } from '../../src/lib/pdf-text';

beforeAll(() => setFontLoader(async (file) => new Uint8Array(await readFile(new URL(`../../public/fonts/${file}`, import.meta.url)))));

async function sample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595.28, 841.89]);
  page.drawText('Agreement', { x: 50, y: 780, size: 20, font });
  return doc.save();
}

async function form(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const f = doc.getForm();
  f.createTextField('name').addToPage(page, { x: 50, y: 700, width: 300, height: 24 });
  const notes = f.createTextField('notes');
  notes.enableMultiline();
  notes.addToPage(page, { x: 50, y: 560, width: 300, height: 100 });
  f.createCheckBox('agree').addToPage(page, { x: 50, y: 520, width: 14, height: 14 });
  const city = f.createDropdown('city');
  city.addOptions(['Bengaluru', 'Delhi', 'मुंबई']);
  city.addToPage(page, { x: 50, y: 480, width: 200, height: 22 });
  return doc.save();
}

async function pageText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useWorkerFetch: false }).promise;
  const content = await (await doc.getPage(1)).getTextContent();
  const text = content.items.map((item) => ('str' in item ? item.str : '')).join('');
  await doc.cleanup();
  return text;
}

describe('certificates', () => {
  it('makes a self-signed certificate and reads it back', async () => {
    const { p12, signer } = await createSelfSigned({ name: 'Asha Rao', email: 'asha@example.org', organisation: 'Museum', country: 'in', years: 2, password: 'secret' });
    const read = readP12(p12, 'secret');
    expect(read.summary.commonName).toBe('Asha Rao');
    expect(read.summary.subject).toContain('C=IN');
    expect(read.summary.selfSigned).toBe(true);
    expect(read.summary.keyBits).toBe(2048);
    expect(read.summary.serial).toBe(signer.summary.serial);
    expect(() => readP12(p12, 'wrong')).toThrow(/password/);
    expect(() => readP12(new Uint8Array([1, 2, 3]), 'x')).toThrow(/not a readable/);
  });
});

describe('signing', () => {
  it('signs digitally with a visible signature that the checker accepts', async () => {
    const { signer } = await createSelfSigned({ name: 'राम शर्मा', years: 1, password: 'secret' });
    const picture = new Uint8Array(await readFile(new URL('../e2e/fixtures/sample.png', import.meta.url)));
    const signed = await signPdf(await sample(), { signer, picture, placement: { page: 1, x: 360, y: 60, width: 200, height: 60 }, reason: 'मंज़ूरी', location: 'Bengaluru' });
    if (process.env.BENCHTOP_KEEP) await writeFile(process.env.BENCHTOP_KEEP, signed);
    expect(isSigned(signed)).toBe(true);
    const [result] = await checkPdfSignatures(signed);
    expect(result?.integrity).toBe(true);
    expect(result?.signatureValid).toBe(true);
    expect(result?.coversWholeFile).toBe(true);
    expect(result?.reason).toBe('मंज़ूरी');
    // A second signature would break the first.
    await expect(signPdf(signed, { signer })).rejects.toThrow(/already digitally signed/);
    // Changing one byte of the signed part is detected.
    const tampered = signed.slice();
    const at = new TextDecoder('latin1').decode(tampered).indexOf('/Producer');
    tampered[at + 1] = 'p'.charCodeAt(0);
    const [broken] = await checkPdfSignatures(tampered);
    expect(broken?.integrity).toBe(false);
  });

  it('adds only a picture when there is no certificate', async () => {
    const picture = new Uint8Array(await readFile(new URL('../e2e/fixtures/sample.png', import.meta.url)));
    const out = await signPdf(await sample(), { picture, placement: { page: 1, x: 40, y: 40, width: 120, height: 40 } });
    expect(isSigned(out)).toBe(false);
    expect(new TextDecoder('latin1').decode(out)).toContain('/Image');
  });
});

describe('forms', () => {
  it('reads and fills fields in Hindi and English, then flattens', async () => {
    const original = await form();
    const info = readForm(await PDFDocument.load(original));
    expect(info.fields.map((f) => `${f.name}:${f.kind}`)).toEqual(['name:text', 'notes:text', 'agree:checkbox', 'city:dropdown']);
    expect(info.fields[3]?.options).toContain('मुंबई');
    const filled = await fillPdf(original, { values: { name: 'सुनीता देवी', notes: 'शुल्क ₹500 जमा किया। Paid in cash.', agree: true, city: 'मुंबई' } });
    const back = readForm(await PDFDocument.load(filled));
    expect(back.fields.find((f) => f.name === 'name')?.value).toBe('सुनीता देवी');
    expect(back.fields.find((f) => f.name === 'agree')?.value).toBe(true);
    const flat = await fillPdf(original, { values: { name: 'सुनीता देवी', agree: true }, flatten: true });
    expect(readForm(await PDFDocument.load(flat)).fields).toHaveLength(0);
    expect(await pageText(flat)).toContain('सुनीता');
  });

  it('places free text on flat forms without adding a form', async () => {
    const out = await fillPdf(await sample(), { values: {}, placed: [{ page: 1, x: 100, y: 500, text: 'नाम: Asha\n✓ 17.11.2026', size: 12, colour: '#000080' }] });
    const text = await pageText(out);
    expect(text).toContain('Asha');
    expect(new TextDecoder('latin1').decode(out)).not.toContain('/AcroForm');
    await expect(dropXfa(await sample())).resolves.toBeInstanceOf(Uint8Array);
  });

  it('wraps long text to the field width', async () => {
    const doc = await PDFDocument.create();
    const font = await embedUnicodeFont(doc);
    const lines = wrap(font, 'यह एक लंबा वाक्य है जो दो पंक्तियों में बँटेगा', 12, 120);
    expect(lines.length).toBeGreaterThan(1);
  });
});
