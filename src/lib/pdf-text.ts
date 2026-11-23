/**
 * Text in PDFs beyond the 14 built-in fonts: Hindi (Devanagari), the rupee sign
 * and most European scripts, with Benchtop Sans (Noto Sans + Noto Sans
 * Devanagari, OFL).  pdf-lib only lays glyphs side by side, which breaks
 * Devanagari (conjuncts, half forms, reordered vowel signs), so the text is
 * shaped with HarfBuzz (WebAssembly) and every glyph is placed where HarfBuzz
 * puts it.  pdf-lib still embeds the font.  Plain Latin text keeps the
 * built-in Helvetica, which adds nothing to the file.
 */
import {
  beginText,
  type Color,
  endText,
  PDFArray,
  PDFDict,
  type PDFDocument,
  type PDFFont,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  StandardFonts,
  setFillingColor,
  setFontAndSize,
  setGraphicsState,
  setTextMatrix,
  setTextRise,
  showText,
} from 'pdf-lib';

type HarfBuzz = typeof import('harfbuzzjs');

interface Shaper {
  readonly hb: HarfBuzz;
  readonly font: InstanceType<HarfBuzz['Font']>;
  readonly upem: number;
  /** Plain advance of a glyph (what a PDF viewer moves by), in font units. */
  readonly advance: (glyph: number) => number;
  readonly glyphCount: number;
}

/** The number of glyphs in a TrueType or OpenType font (from its 'maxp' table). */
export function glyphCountOf(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = view.getUint16(4);
  for (let i = 0; i < tables; i++) {
    const record = 12 + i * 16;
    if (String.fromCharCode(...bytes.subarray(record, record + 4)) === 'maxp') return view.getUint16(view.getUint32(record + 8) + 4);
  }
  return 0;
}

type Loader = (file: string) => Promise<Uint8Array>;

let loader: Loader = async (file) => {
  const response = await fetch(new URL(`fonts/${file}`, document.baseURI));
  if (!response.ok) throw new Error(`Could not load the font ${file}.`);
  return new Uint8Array(await response.arrayBuffer());
};

/** Lets tests read the fonts from disk. */
export function setFontLoader(next: Loader): void {
  loader = next;
}

const files = new Map<string, Promise<Uint8Array>>();
const shapers = new WeakMap<PDFFont, Shaper>();

async function fontBytes(file: string): Promise<Uint8Array> {
  if (!files.has(file)) {
    const loading = loader(file);
    files.set(file, loading);
    loading.catch(() => files.delete(file));
  }
  return (await files.get(file)) as Uint8Array;
}

/** Benchtop Sans fonts embedded in each document, and the text behind every glyph drawn with them. */
const embedded = new WeakMap<PDFDocument, Set<PDFFont>>();
const drawn = new WeakMap<PDFFont, Map<number, readonly number[]>>();

/** Embeds Benchtop Sans (whole, so every shaped glyph is present) and prepares HarfBuzz for it. */
export async function embedUnicodeFont(doc: PDFDocument, bold = false): Promise<PDFFont> {
  return embedFontBytes(doc, await fontBytes(bold ? 'BenchtopSans-Bold.ttf' : 'BenchtopSans-Regular.ttf'));
}

/** Embeds any TrueType or OpenType font (for scripts Benchtop Sans lacks, such as Kannada) with HarfBuzz shaping. */
export async function embedFontBytes(doc: PDFDocument, bytes: Uint8Array): Promise<PDFFont> {
  // pdf-lib still measures with fontkit in places; its Indic code needs the regenerator runtime.
  await import('regenerator-runtime/runtime');
  const [{ default: fontkit }, hb] = await Promise.all([import('@pdf-lib/fontkit'), import('harfbuzzjs')]);
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(bytes, { subset: false });
  const face = new hb.Face(new hb.Blob(bytes), 0);
  const hbFont = new hb.Font(face);
  shapers.set(font, { hb, font: hbFont, upem: face.upem, advance: (glyph) => hbFont.glyphHAdvance(glyph), glyphCount: glyphCountOf(bytes) });
  const fonts = embedded.get(doc) ?? new Set<PDFFont>();
  fonts.add(font);
  embedded.set(doc, fonts);
  return font;
}

/** A ToUnicode CMap (in blocks of 100, as the format requires) from glyph ids to their text. */
export function toUnicodeCMap(glyphs: ReadonlyMap<number, readonly number[]>): string {
  const hex = (n: number) => n.toString(16).padStart(4, '0');
  const utf16 = (codePoint: number) => (codePoint > 0xffff ? hex(0xd800 + ((codePoint - 0x10000) >> 10)) + hex(0xdc00 + ((codePoint - 0x10000) & 0x3ff)) : hex(codePoint));
  const entries = [...glyphs].filter(([, points]) => points.length > 0).sort(([a], [b]) => a - b);
  const blocks: string[] = [];
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    blocks.push(`${chunk.length} beginbfchar\n${chunk.map(([id, points]) => `<${hex(id)}> <${points.map(utf16).join('')}>`).join('\n')}\nendbfchar`);
  }
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <ffff>\nendcodespacerange\n${blocks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
}

/**
 * Call just before saving.  pdf-lib maps glyphs to text through the font's character map,
 * which misses conjuncts and half forms; this replaces that map with the text each drawn
 * glyph came from, so copying and searching give back the Hindi that was written.
 */
export async function finishFonts(doc: PDFDocument): Promise<void> {
  for (const font of embedded.get(doc) ?? []) {
    await font.embed();
    const dict = doc.context.lookup(font.ref);
    if (!(dict instanceof PDFDict)) continue;
    const glyphs = drawn.get(font);
    if (glyphs?.size) dict.set(PDFName.of('ToUnicode'), doc.context.register(doc.context.flateStream(toUnicodeCMap(glyphs))));
    // pdf-lib lists widths only for glyphs in the character map; conjuncts and half forms
    // would then advance by the default 1000 units.  Give every glyph its real width.
    const shaper = shapers.get(font);
    const cid = dict.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray)?.lookupMaybe(0, PDFDict);
    if (shaper && cid && shaper.glyphCount > 0) {
      const widths = Array.from({ length: shaper.glyphCount }, (_, glyph) => Math.round((shaper.advance(glyph) * 1000 * 100) / shaper.upem) / 100);
      cid.set(PDFName.of('W'), doc.context.obj([0, widths]));
    }
  }
}

/** Whether Helvetica (WinAnsi) can show all of `texts`. */
export function latinOnly(texts: readonly string[]): boolean {
  return texts.every((text) => /^[ -~\u00A0-ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ\n\r\t]*$/.test(text));
}

/** Helvetica for Latin text, Benchtop Sans when any text needs more. */
export async function fontsFor(doc: PDFDocument, texts: readonly string[]): Promise<{ regular: PDFFont; bold: PDFFont; unicode: boolean }> {
  if (latinOnly(texts)) return { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold), unicode: false };
  const [regular, bold] = await Promise.all([embedUnicodeFont(doc), embedUnicodeFont(doc, true)]);
  return { regular, bold, unicode: true };
}

interface Shaped {
  /** Glyph positions as fractions of the font size; null for the built-in fonts. */
  readonly glyphs: readonly { readonly id: number; readonly x: number; readonly y: number }[] | null;
  /** Advance of the whole text as a fraction of the font size. */
  readonly width: number;
}

export function shape(font: PDFFont, text: string): Shaped {
  const shaper = shapers.get(font);
  if (!shaper) return { glyphs: null, width: font.widthOfTextAtSize(text, 1) };
  const { hb, upem } = shaper;
  const buffer = new hb.Buffer();
  buffer.addText(text);
  buffer.guessSegmentProperties();
  hb.shape(shaper.font, buffer);
  const out = buffer.getGlyphInfosAndPositions();
  const seen = drawn.get(font) ?? new Map<number, readonly number[]>();
  drawn.set(font, seen);
  // Text behind each glyph for copying and search: a cluster's characters go to its glyphs,
  // each character to the glyph that is its plain form when there is one, the rest to the first.
  const units = [...text];
  const offsets: number[] = [];
  let offset = 0;
  for (const unit of units) {
    offsets.push(offset);
    offset += unit.length;
  }
  const clusters = [...new Set(out.map((g) => g.cluster))].sort((a, b) => a - b);
  for (const cluster of clusters) {
    const next = clusters.find((c) => c > cluster) ?? text.length;
    const chars = units.filter((_, i) => (offsets[i] as number) >= cluster && (offsets[i] as number) < next).map((ch) => ch.codePointAt(0) as number);
    const members = out.filter((g) => g.cluster === cluster).map((g) => g.codepoint);
    const left = [...chars];
    const given = new Map<number, number[]>();
    for (const glyph of members) {
      const i = left.findIndex((cp) => shaper.font.nominalGlyph(cp) === glyph);
      if (i >= 0) given.set(glyph, left.splice(i, 1));
    }
    const first = members.find((glyph) => !given.has(glyph)) ?? members[0];
    if (first !== undefined && left.length) given.set(first, [...(given.get(first) ?? []), ...left]);
    for (const [glyph, points] of given) if (!seen.has(glyph) && points.length) seen.set(glyph, points);
  }
  let pen = 0;
  const glyphs = out.map((g) => {
    const placed = { id: g.codepoint, x: (pen + (g.xOffset ?? 0)) / upem, y: (g.yOffset ?? 0) / upem };
    pen += g.xAdvance ?? 0;
    return placed;
  });
  return { glyphs, width: pen / upem };
}

export const textWidth = (font: PDFFont, text: string, size: number): number => shape(font, text).width * size;

/**
 * Operators that draw `text` with its baseline start at (x, y), turned `angle` degrees
 * anticlockwise.  Shaped glyphs go out as one TJ run whose spacing adjustments move each
 * glyph from its plain advance to its shaped place (text rise for raised or lowered marks),
 * so viewers still see one piece of text when copying or searching.
 */
export function textOperators(font: PDFFont, key: string | PDFName, text: string, at: { x: number; y: number; size: number; angle?: number }): PDFOperator[] {
  const { x, y, size } = at;
  const a = ((at.angle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const shaped = shape(font, text);
  const ops: PDFOperator[] = [beginText(), setFontAndSize(key, size), setTextMatrix(cos, sin, -sin, cos, x, y)];
  const shaper = shapers.get(font);
  if (!shaped.glyphs || !shaper) {
    ops.push(showText(font.encodeText(text)), endText());
    return ops;
  }
  const context = font.doc.context;
  const em = shaper.upem;
  let run = PDFArray.withContext(context);
  let rise = 0;
  let cursor = 0;
  const flush = () => {
    if (run.size() > 0) ops.push(PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [run]));
    run = PDFArray.withContext(context);
  };
  for (const glyph of shaped.glyphs) {
    if (glyph.y !== rise) {
      flush();
      rise = glyph.y;
      ops.push(setTextRise(rise * size));
    }
    const shift = glyph.x - cursor;
    if (Math.abs(shift) > 1e-6) run.push(PDFNumber.of(Math.round(-shift * 1000 * 1000) / 1000));
    run.push(PDFHexString.of(glyph.id.toString(16).padStart(4, '0')));
    cursor = glyph.x + shaper.advance(glyph.id) / em;
  }
  flush();
  if (rise !== 0) ops.push(setTextRise(0));
  ops.push(endText());
  return ops;
}

/**
 * Marks shaped text with its typed form, so copying gives back "दुनिया" rather than
 * the glyphs' visual order (ि is drawn before न but typed after it).
 */
export function actualText(font: PDFFont, text: string, ops: PDFOperator[]): PDFOperator[] {
  if (!shapers.has(font)) return ops;
  // An inline property list; pdf-lib's operator types omit dictionaries but write them correctly.
  const properties = font.doc.context.obj({ ActualText: PDFHexString.fromText(text) });
  return [PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of('Span'), properties as never]), ...ops, PDFOperator.of(PDFOperatorNames.EndMarkedContent)];
}

/** Draws shaped text on a page (the replacement for page.drawText). */
export function drawText(page: PDFPage, font: PDFFont, text: string, options: { x: number; y: number; size: number; color?: Color; opacity?: number; angle?: number }): void {
  const key = page.node.newFontDictionary(font.name, font.ref);
  const ops: PDFOperator[] = [pushGraphicsState()];
  if (options.opacity !== undefined && options.opacity < 1) {
    const state = page.doc.context.obj({ Type: 'ExtGState', ca: options.opacity, CA: options.opacity });
    ops.push(setGraphicsState(page.node.newExtGState('GS', state)));
  }
  if (options.color) ops.push(setFillingColor(options.color));
  ops.push(...actualText(font, text, textOperators(font, key, text, options)));
  ops.push(popGraphicsState());
  page.pushOperators(...ops);
}

export { PDFName };
