import { PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  accessibility,
  addField,
  findJavaScript,
  flattenForm,
  insertBlankPages,
  insertTimestamp,
  listAttachments,
  listFields,
  onePage,
  overlay,
  prepareTimestamp,
  readOutline,
  removeAnnotations,
  removeAttachments,
  removeField,
  removeSignatures,
  report,
  resizePages,
  sanitise,
  setFieldFlags,
  streamBytes,
  timestampRequest,
  timestampToken,
  unlockFields,
  writeOutline,
} from '../../src/lib/pdf-toolbox';

async function blank(pages = 3, size: [number, number] = [300, 400]): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) doc.addPage(size).drawText(`Page ${i + 1}`, { x: 20, y: 20, size: 12, font });
  return doc;
}
const reload = async (doc: PDFDocument) => PDFDocument.load(await doc.save(), { updateMetadata: false });

describe('PDF toolbox', () => {
  it('writes and reads bookmarks', async () => {
    const doc = await blank(5);
    writeOutline(doc, [
      { title: 'Introduction', page: 1, children: [] },
      {
        title: 'Chapter 1 — मशीनें',
        page: 2,
        children: [
          { title: 'Section 1.1', page: 3, children: [] },
          { title: 'Section 1.2', page: 4, children: [] },
        ],
      },
      { title: 'Index', page: 5, children: [] },
    ]);
    const back = readOutline(await reload(doc));
    expect(back.map((b) => [b.title, b.page])).toEqual([
      ['Introduction', 1],
      ['Chapter 1 — मशीनें', 2],
      ['Index', 5],
    ]);
    expect(back[1]?.children.map((b) => b.page)).toEqual([3, 4]);
    writeOutline(doc, []);
    expect(readOutline(await reload(doc))).toEqual([]);
  });

  it('lists, adds and removes attachments', async () => {
    const doc = await blank(1);
    await doc.attach(new TextEncoder().encode('hello there'), 'notes.txt', { mimeType: 'text/plain', description: 'Some notes' });
    await doc.attach(new TextEncoder().encode('a,b\n1,2\n'), 'data.csv', { mimeType: 'text/csv' });
    const again = await reload(doc);
    const list = listAttachments(again);
    expect(list.map((a) => a.name).sort()).toEqual(['data.csv', 'notes.txt']);
    expect(new TextDecoder().decode(list.find((a) => a.name === 'notes.txt')?.bytes)).toBe('hello there');
    removeAttachments(again, ['notes.txt']);
    expect(listAttachments(await reload(again)).map((a) => a.name)).toEqual(['data.csv']);
    removeAttachments(again, []);
    expect(listAttachments(await reload(again))).toEqual([]);
  });

  it('works with form fields: add, list, flag, unlock, flatten, remove', async () => {
    const doc = await blank(2);
    addField(doc, { kind: 'text', name: 'name', page: 1, x: 50, y: 300, width: 150, height: 20, tooltip: 'Your name', required: true });
    addField(doc, { kind: 'checkbox', name: 'agree', page: 2, x: 50, y: 300, width: 14, height: 14 });
    addField(doc, { kind: 'dropdown', name: 'city', page: 1, x: 50, y: 250, width: 150, height: 20, options: ['Bengaluru', 'Guwahati'] });
    addField(doc, { kind: 'signature', name: 'sign', page: 2, x: 50, y: 100, width: 150, height: 40 });
    expect(() => addField(doc, { kind: 'text', name: 'name', page: 1, x: 0, y: 0, width: 1, height: 1 })).toThrow(/already/);
    const fields = listFields(await reload(doc));
    expect(fields.map((f) => [f.name, f.kind, f.page])).toEqual([
      ['name', 'Text', 1],
      ['agree', 'Check Box', 2],
      ['city', 'Dropdown', 1],
      ['sign', 'Signature', 2],
    ]);
    expect(fields[0]?.required).toBe(true);
    expect(fields[0]?.tooltip).toBe('Your name');
    // pdf-lib widens the box by half the border on each side.
    expect(fields[0]?.rect?.map(Math.round)).toEqual([50, 300, 151, 21]);
    setFieldFlags(doc, 'name', { readOnly: true });
    setFieldFlags(doc, 'city', { readOnly: true });
    expect(unlockFields(doc)).toBe(2);
    removeField(doc, 'city');
    expect(listFields(doc).map((f) => f.name)).not.toContain('city');
    // A signature value goes; the field stays empty.
    const sig = doc
      .getForm()
      .getFields()
      .find((f) => f.getName() === 'sign');
    sig?.acroField.dict.set(PDFName.of('V'), doc.context.obj({ Type: 'Sig', Contents: PDFHexString.of('00') }));
    expect(removeSignatures(doc)).toBe(1);
    expect(sig?.acroField.dict.has(PDFName.of('V'))).toBe(false);
    expect(flattenForm(doc)).toBeGreaterThan(0);
    expect(listFields(await reload(doc)).filter((f) => f.kind !== 'Signature')).toEqual([]);
  });

  it('finds JavaScript and sanitises it away, with links and metadata', async () => {
    const doc = await blank(1);
    const js = (code: string) => doc.context.obj({ S: 'JavaScript', JS: PDFString.of(code) });
    doc.catalog.set(PDFName.of('OpenAction'), doc.context.register(js('app.alert("hi")')));
    doc.catalog.set(PDFName.of('Names'), doc.context.obj({ JavaScript: doc.context.obj({ Names: [PDFHexString.fromText('init'), doc.context.register(js('var x = 1;'))] }) }));
    const page = doc.getPage(0);
    const link = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], A: doc.context.obj({ S: 'URI', URI: PDFString.of('https://example.org') }) });
    const button = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 20, 10, 30], A: js('this.print()') });
    page.node.addAnnot(doc.context.register(link));
    page.node.addAnnot(doc.context.register(button));
    doc.setTitle('Secret plans');
    const scripts = findJavaScript(doc);
    expect(scripts.map((s) => s.code).sort()).toEqual(['app.alert("hi")', 'this.print()', 'var x = 1;']);
    expect(scripts.find((s) => s.code === 'var x = 1;')?.where).toContain('init');
    const done = sanitise(doc, { javascript: true, embedded: true, metadata: true, links: true });
    expect(done.join(' ')).toContain('3 scripts');
    const after = await reload(doc);
    expect(findJavaScript(after)).toEqual([]);
    expect(after.getTitle()).toBeUndefined();
    expect(done.join(' ')).toContain('1 link');
    expect(removeAnnotations(after)).toBe(2);
  });

  it('reports on a PDF and checks its accessibility', async () => {
    const doc = await blank(2);
    const r = report(await reload(doc), await doc.save());
    expect(r.pageCount).toBe(2);
    expect((r.fonts as { name: string; embedded: boolean }[])[0]?.name).toBe('Helvetica');
    expect((r.fonts as { embedded: boolean }[])[0]?.embedded).toBe(false);
    const before = accessibility(doc, { withText: 2, total: 2 });
    expect(before.find((c) => c.id === 'tagged')?.result).toBe('fail');
    expect(before.find((c) => c.id === 'language')?.result).toBe('fail');
    expect(before.find((c) => c.id === 'fonts')?.result).toBe('fail');
    doc.catalog.set(PDFName.of('Lang'), PDFString.of('en-IN'));
    doc.setTitle('A museum guide', { showInWindowTitleBar: true });
    const after = accessibility(doc, { withText: 1, total: 2 });
    expect(after.find((c) => c.id === 'language')?.result).toBe('pass');
    expect(after.find((c) => c.id === 'title')?.result).toBe('pass');
    expect(after.find((c) => c.id === 'text')?.result).toBe('warn');
  });

  it('stacks, resizes and pads pages, and lays one PDF over another', async () => {
    const source = await blank(3, [100, 200]);
    const tall = await PDFDocument.create();
    await onePage(source, tall, 'down');
    expect(tall.getPage(0).getSize()).toEqual({ width: 100, height: 600 });
    const a4 = await PDFDocument.create();
    await resizePages(source, a4, [595.28, 841.89], 'keep', null);
    expect(a4.getPages().map((p) => Math.round(p.getWidth()))).toEqual([595, 595, 595]);
    const padded = await blank(4);
    expect(insertBlankPages(padded, [1, 3])).toBe(2);
    expect(padded.getPageCount()).toBe(6);
    const base = await blank(2);
    const letterhead = await blank(1);
    await overlay(base, letterhead, 'under', 'first');
    const saved = await reload(base);
    const contents = saved.getPage(0).node.Contents();
    const first =
      contents && 'get' in contents && typeof (contents as { get?: unknown }).get === 'function' ? saved.context.lookup((contents as unknown as { get: (i: number) => never }).get(0)) : contents;
    expect(new TextDecoder().decode(streamBytes(first as never))).toContain('Do');
  });

  it('builds RFC 3161 requests and reads the answers', async () => {
    const digest = new Uint8Array(32).fill(7);
    const request = timestampRequest(digest, new Uint8Array([0x81, 2, 3]));
    expect(request[0]).toBe(0x30);
    expect(request[1]).toBe(request.length - 2);
    expect([...request.slice(-3)]).toEqual([0x01, 0x01, 0xff]);
    // The nonce keeps positive: a leading zero before 0x81.
    expect([...request]).toEqual(expect.arrayContaining([0x02, 0x04, 0x00, 0x81, 2, 3]));
    const token = [0x30, 0x03, 0x02, 0x01, 0x05];
    const ok = new Uint8Array([0x30, 5 + token.length, 0x30, 0x03, 0x02, 0x01, 0x00, ...token]);
    expect([...timestampToken(ok)]).toEqual(token);
    expect(() => timestampToken(new Uint8Array([0x30, 0x05, 0x30, 0x03, 0x02, 0x01, 0x02]))).toThrow(/refused/);
    const doc = await blank(1);
    const { pdf, signed, contentsAt } = await prepareTimestamp(doc);
    const text = new TextDecoder('latin1').decode(pdf);
    const range = /\/ByteRange \[ 0 (\d+) (\d+) (\d+) \]/.exec(text);
    expect(Number(range?.[1])).toBe(contentsAt);
    expect(Number(range?.[2]) + Number(range?.[3])).toBe(pdf.length);
    expect(signed.length).toBe(pdf.length - (Number(range?.[2]) - contentsAt));
    const stamped = insertTimestamp(pdf, contentsAt, new Uint8Array(token));
    expect(new TextDecoder('latin1').decode(stamped)).toContain('<3003020105000000');
    expect(text).toContain('/ETSI.RFC3161');
  });
});
