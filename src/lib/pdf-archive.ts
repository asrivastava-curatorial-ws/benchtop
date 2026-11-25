/**
 * PDF/A-2b: what an archival PDF needs on top of its pages (identification in
 * XMP metadata that matches the document information, an output intent with a
 * colour profile, a document ID) and what it must not contain (scripts,
 * attachments, fonts that are not embedded).
 *
 * This writes those parts and reports what it found.  It is not a certified
 * validator: an archive that demands proof should check the result with veraPDF.
 */
import { PDFArray, PDFDict, type PDFDocument, PDFHexString, PDFName, type PDFObject, PDFRawStream, PDFRef, PDFString } from 'pdf-lib';
import type { Check } from './pdf-redact';

export interface ArchiveMeta {
  readonly title: string;
  readonly author: string;
  readonly subject: string;
  readonly keywords: string;
  /** A language tag such as en-IN, or empty. */
  readonly language: string;
}

export const PRODUCER = 'Benchtop (pdf-lib)';
export const CREATOR = 'Benchtop';

const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const stamp = (date: Date) => `${date.toISOString().slice(0, 19)}Z`;

/** The XMP packet of a PDF/A-2b file; every value here is also written to the document information. */
export function xmpPacket(meta: ArchiveMeta, created: Date, modified: Date): string {
  const dc = [
    '<dc:format>application/pdf</dc:format>',
    meta.title && `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xml(meta.title)}</rdf:li></rdf:Alt></dc:title>`,
    meta.author && `<dc:creator><rdf:Seq><rdf:li>${xml(meta.author)}</rdf:li></rdf:Seq></dc:creator>`,
    meta.subject && `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xml(meta.subject)}</rdf:li></rdf:Alt></dc:description>`,
  ].filter(Boolean);
  const pdf = [`<pdf:Producer>${xml(PRODUCER)}</pdf:Producer>`, meta.keywords && `<pdf:Keywords>${xml(meta.keywords)}</pdf:Keywords>`].filter(Boolean);
  return [
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">',
    '   <pdfaid:part>2</pdfaid:part>',
    '   <pdfaid:conformance>B</pdfaid:conformance>',
    '  </rdf:Description>',
    '  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    ...dc.map((line) => `   ${line}`),
    '  </rdf:Description>',
    '  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">',
    `   <xmp:CreatorTool>${xml(CREATOR)}</xmp:CreatorTool>`,
    `   <xmp:CreateDate>${stamp(created)}</xmp:CreateDate>`,
    `   <xmp:ModifyDate>${stamp(modified)}</xmp:ModifyDate>`,
    `   <xmp:MetadataDate>${stamp(modified)}</xmp:MetadataDate>`,
    '  </rdf:Description>',
    '  <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">',
    ...pdf.map((line) => `   ${line}`),
    '  </rdf:Description>',
    ' </rdf:RDF>',
    '</x:xmpmeta>',
    // Room for a later editor to change the packet in place, as the XMP specification suggests.
    ...Array.from({ length: 8 }, () => ' '.repeat(100)),
    '<?xpacket end="w"?>',
  ].join('\n');
}

const name = (key: string) => PDFName.of(key);

function dictOf(object: PDFObject | undefined): PDFDict | undefined {
  if (object instanceof PDFDict) return object;
  if (object instanceof PDFRawStream) return object.dict;
  return undefined;
}

function nameOf(dict: PDFDict, key: string): string {
  const value = dict.lookup(name(key));
  return value instanceof PDFName ? value.asString().slice(1) : '';
}

export interface Findings {
  /** Base names of fonts whose program is not in the file. */
  readonly fontsNotEmbedded: string[];
  readonly scripts: number;
  readonly attachments: number;
  readonly lzw: number;
  /** Sound, movie, 3D and file-attachment annotations, which PDF/A-2 does not allow. */
  readonly mediaAnnotations: number;
  readonly hasXfa: boolean;
}

/** What is in a document that PDF/A-2 does not allow. */
export function inspect(doc: PDFDocument): Findings {
  const missing = new Set<string>();
  let scripts = 0;
  let lzw = 0;
  let media = 0;
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    const dict = dictOf(object);
    if (!dict) continue;
    if (object instanceof PDFRawStream) {
      const filter = dict.lookup(name('Filter'));
      const filters = filter instanceof PDFArray ? filter.asArray().map(String) : filter ? [String(filter)] : [];
      if (filters.includes('/LZWDecode')) lzw += 1;
    }
    if (dict.has(name('JS')) || nameOf(dict, 'S') === 'JavaScript') scripts += 1;
    const type = nameOf(dict, 'Type');
    const subtype = nameOf(dict, 'Subtype');
    if (type === 'Font' && subtype !== 'Type3' && subtype !== 'Type0') {
      const descriptor = dictOf(dict.lookup(name('FontDescriptor')));
      const embedded = descriptor && ['FontFile', 'FontFile2', 'FontFile3'].some((key) => descriptor.has(name(key)));
      if (!embedded) missing.add(nameOf(dict, 'BaseFont') || 'an unnamed font');
    }
    if (['Sound', 'Movie', 'Screen', '3D', 'FileAttachment', 'RichMedia'].includes(subtype) && (type === 'Annot' || dict.has(name('Rect')))) media += 1;
  }
  const names = dictOf(doc.catalog.lookup(name('Names')));
  const files = names ? dictOf(names.lookup(name('EmbeddedFiles'))) : undefined;
  const countNames = (node: PDFDict | undefined): number => {
    if (!node) return 0;
    const list = node.lookup(name('Names'));
    const kids = node.lookup(name('Kids'));
    let count = list instanceof PDFArray ? Math.floor(list.size() / 2) : 0;
    if (kids instanceof PDFArray) for (let i = 0; i < kids.size(); i++) count += countNames(dictOf(kids.lookup(i)));
    return count;
  };
  const form = dictOf(doc.catalog.lookup(name('AcroForm')));
  return { fontsNotEmbedded: [...missing].sort(), scripts, attachments: countNames(files), lzw, mediaAnnotations: media, hasXfa: form?.has(name('XFA')) === true };
}

/** Removes what can simply be left out: scripts, automatic actions, attachments and XFA forms. */
export function strip(doc: PDFDocument): void {
  const isScript = (object: PDFObject | undefined) => {
    const dict = dictOf(object);
    return dict ? dict.has(name('JS')) || nameOf(dict, 'S') === 'JavaScript' : false;
  };
  const gone: PDFRef[] = [];
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    const dict = dictOf(object);
    if (!dict) continue;
    dict.delete(name('AA'));
    if (isScript(dict.lookup(name('A')))) dict.delete(name('A'));
    // The objects themselves go too: pdf-lib writes every object it holds, referenced or not.
    const type = nameOf(dict, 'Type');
    if (isScript(dict) || type === 'Filespec' || type === 'EmbeddedFile') gone.push(ref);
  }
  if (isScript(doc.catalog.lookup(name('OpenAction')))) doc.catalog.delete(name('OpenAction'));
  for (const ref of gone) doc.context.delete(ref);
  const names = dictOf(doc.catalog.lookup(name('Names')));
  names?.delete(name('JavaScript'));
  names?.delete(name('EmbeddedFiles'));
  const form = dictOf(doc.catalog.lookup(name('AcroForm')));
  form?.delete(name('XFA'));
  form?.delete(name('NeedAppearances'));
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** Adds the PDF/A-2b identification, metadata, colour profile and ID.  `now` has whole seconds. */
export function identify(doc: PDFDocument, meta: ArchiveMeta, profile: Uint8Array, now: Date, id: Uint8Array): void {
  const when = new Date(Math.floor(now.getTime() / 1000) * 1000);
  const created = doc.getCreationDate() ?? when;
  const born = new Date(Math.floor(created.getTime() / 1000) * 1000);
  // The document information and the XMP packet must say the same.
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  if (info instanceof PDFDict) for (const key of ['Title', 'Author', 'Subject', 'Keywords', 'Trapped']) info.delete(name(key));
  if (meta.title) doc.setTitle(meta.title);
  if (meta.author) doc.setAuthor(meta.author);
  if (meta.subject) doc.setSubject(meta.subject);
  if (meta.keywords && info instanceof PDFDict) info.set(name('Keywords'), PDFHexString.fromText(meta.keywords));
  doc.setProducer(PRODUCER);
  doc.setCreator(CREATOR);
  doc.setCreationDate(born);
  doc.setModificationDate(when);
  if (meta.language) doc.catalog.set(name('Lang'), PDFString.of(meta.language));

  const old = doc.catalog.get(name('Metadata'));
  if (old instanceof PDFRef) doc.context.delete(old);
  const packet = new TextEncoder().encode(xmpPacket(meta, born, when));
  const metadata = doc.context.stream(packet, { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(name('Metadata'), doc.context.register(metadata));

  const colours = doc.context.register(doc.context.stream(profile, { N: 3 }));
  const intent = doc.context.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFA1',
    OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'),
    Info: PDFString.of('sRGB IEC61966-2.1'),
    DestOutputProfile: colours,
  });
  doc.catalog.set(name('OutputIntents'), doc.context.obj([doc.context.register(intent)]));
  const token = PDFHexString.of(hex(id));
  doc.context.trailerInfo.ID = doc.context.obj([token, token]);
}

/** What a finished file has, read back from the document. */
export function report(doc: PDFDocument, mode: 'pictures' | 'kept'): Check[] {
  const found = inspect(doc);
  const metadata = doc.catalog.lookup(name('Metadata'));
  const packet = metadata instanceof PDFRawStream ? new TextDecoder().decode(metadata.contents) : '';
  const intents = doc.catalog.lookup(name('OutputIntents'));
  const intent = intents instanceof PDFArray ? dictOf(intents.lookup(0)) : undefined;
  const profile = intent?.lookup(name('DestOutputProfile'));
  const title = doc.getTitle() ?? '';
  const author = doc.getAuthor() ?? '';
  const agree =
    packet.includes(`<pdf:Producer>${xml(doc.getProducer() ?? '')}</pdf:Producer>`) &&
    (!title || packet.includes(`>${xml(title)}</rdf:li>`)) &&
    (!author || packet.includes(`<rdf:li>${xml(author)}</rdf:li>`));
  const checks: Check[] = [
    { id: 'id', label: 'Says it is PDF/A-2b', ok: packet.includes('<pdfaid:part>2</pdfaid:part>') && packet.includes('<pdfaid:conformance>B</pdfaid:conformance>'), detail: 'In the XMP metadata.' },
    { id: 'meta', label: 'Metadata and document information agree', ok: agree, detail: 'Title, author, producer and dates are written in both places.' },
    { id: 'intent', label: 'Colour profile (output intent)', ok: nameOf(intent ?? doc.context.obj({}), 'S') === 'GTS_PDFA1' && profile instanceof PDFRawStream, detail: 'sRGB IEC61966-2.1' },
    { id: 'docid', label: 'Document ID', ok: doc.context.trailerInfo.ID !== undefined, detail: '' },
    {
      id: 'fonts',
      label: 'All fonts are embedded',
      ok: found.fontsNotEmbedded.length === 0,
      detail: found.fontsNotEmbedded.length ? `Not embedded: ${found.fontsNotEmbedded.slice(0, 8).join(', ')}${found.fontsNotEmbedded.length > 8 ? '…' : ''}. Choose “Turn pages into pictures”.` : '',
    },
    { id: 'scripts', label: 'No scripts or automatic actions', ok: found.scripts === 0, detail: found.scripts ? `${found.scripts} left` : '' },
    {
      id: 'files',
      label: 'No attachments',
      ok: found.attachments === 0 && found.mediaAnnotations === 0,
      detail: found.mediaAnnotations ? `${found.mediaAnnotations} sound, video, 3D or file annotations remain.` : '',
    },
    { id: 'lzw', label: 'No LZW compression', ok: found.lzw === 0, detail: found.lzw ? `${found.lzw} streams use LZW.` : '' },
    { id: 'forms', label: 'No XFA form', ok: !found.hasXfa, detail: '' },
  ];
  if (mode === 'kept')
    checks.push({
      id: 'unchecked',
      label: 'Colours and transparency inside the pages',
      ok: true,
      detail: 'Not examined: pages are kept as they are. CMYK content or unusual transparency can still break strict validation; “Turn pages into pictures” avoids this.',
    });
  return checks;
}
