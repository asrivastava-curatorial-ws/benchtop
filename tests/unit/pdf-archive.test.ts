import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { srgbProfile } from '../../src/lib/icc-srgb';
import { identify, inspect, report, strip, xmpPacket } from '../../src/lib/pdf-archive';

const META = { title: 'Engine <Hall> & labels', author: 'A. Curator', subject: '', keywords: 'steam, labels', language: 'en-IN' };
const ID = new Uint8Array(16).fill(7);

describe('PDF/A-2b parts', () => {
  it('ships a real sRGB profile', () => {
    const profile = srgbProfile();
    expect(profile.length).toBe(456);
    expect(new TextDecoder().decode(profile.slice(36, 40))).toBe('acsp');
    expect(new TextDecoder().decode(profile.slice(16, 20))).toBe('RGB ');
  });

  it('writes an XMP packet that identifies the file and escapes its values', () => {
    const packet = xmpPacket(META, new Date('2026-11-23T10:00:00Z'), new Date('2026-11-23T11:30:00Z'));
    expect(packet.startsWith('<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>')).toBe(true);
    expect(packet.endsWith('<?xpacket end="w"?>')).toBe(true);
    expect(packet).toContain('<pdfaid:part>2</pdfaid:part>');
    expect(packet).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    expect(packet).toContain('<rdf:li xml:lang="x-default">Engine &lt;Hall&gt; &amp; labels</rdf:li>');
    expect(packet).toContain('<xmp:CreateDate>2026-11-23T10:00:00Z</xmp:CreateDate>');
    expect(packet).toContain('<xmp:ModifyDate>2026-11-23T11:30:00Z</xmp:ModifyDate>');
    expect(packet).not.toContain('dc:description');
    // Every element that opens also closes, in order.
    const open: string[] = [];
    for (const tag of packet.matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
      if (tag[1]) expect(open.pop()).toBe(tag[2]);
      else if (!tag[3]) open.push(tag[2] as string);
    }
    expect(open).toEqual([]);
  });

  it('identifies a document and reads the parts back from the saved file', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.setSubject('to be removed');
    identify(doc, META, srgbProfile(), new Date('2026-11-23T11:30:00.750Z'), ID);
    const bytes = await doc.save({ useObjectStreams: false });
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('/GTS_PDFA1');
    expect(text).toContain('<pdfaid:part>2</pdfaid:part>');
    expect(text).toMatch(/\/ID \[ <0707[0-9a-f]+> <0707[0-9a-f]+> \]/);
    expect(text).toContain('D:20261123113000Z');
    const saved = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(saved.getSubject()).toBeUndefined();
    expect(saved.getTitle()).toBe(META.title);
    const checks = report(saved, 'pictures');
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.map((c) => c.id)).toEqual(['id', 'meta', 'intent', 'docid', 'fonts', 'scripts', 'files', 'lzw', 'forms']);
  });

  it('finds fonts that are not embedded, scripts and attachments, and strips what it can', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    page.drawText('Not embedded', { font: await doc.embedFont(StandardFonts.Helvetica), size: 12, x: 10, y: 100 });
    doc.addJavaScript('hello', 'app.alert("hi")');
    await doc.attach(new Uint8Array([1, 2, 3]), 'data.bin', { mimeType: 'application/octet-stream' });
    const loaded = await PDFDocument.load(await doc.save());
    const before = inspect(loaded);
    expect(before.fontsNotEmbedded).toEqual(['Helvetica']);
    expect(before.scripts).toBeGreaterThan(0);
    expect(before.attachments).toBe(1);
    strip(loaded);
    identify(loaded, META, srgbProfile(), new Date(), ID);
    const after = await PDFDocument.load(await loaded.save({ useObjectStreams: false }), { updateMetadata: false });
    const names = after.catalog.lookup(PDFName.of('Names'));
    expect(String(names ?? '')).not.toContain('JavaScript');
    expect(new TextDecoder('latin1').decode(await after.save({ useObjectStreams: false }))).not.toContain('app.alert');
    const checks = report(after, 'kept');
    const failed = checks.filter((c) => !c.ok).map((c) => c.id);
    expect(failed).toEqual(['fonts']);
    expect(checks.find((c) => c.id === 'fonts')?.detail).toContain('Helvetica');
    expect(checks.at(-1)?.id).toBe('unchecked');
  });
});
