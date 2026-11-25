/**
 * The working parts of PDF Studio that need a page to draw on: burning
 * redactions into page pictures, checking the result, turning pages into
 * PDF/A, and reading words with their places for OCR correction.
 */
import { PDFDocument } from 'pdf-lib';
import { type OcrLanguage, ocrWorker } from './ocr-engine';
import { type ArchiveMeta, identify, report, strip } from './pdf-archive';
import { loadPdf } from './pdf-edit';
import { hiddenText, type Word } from './pdf-hidden-text';
import { pageText } from './pdf-page-text';
import { type Box, bytesMention, type Check, findMatches, mentions, type Query, textUnder } from './pdf-redact';
import { openPdf, renderPage } from './pdf-render';
import { finishFonts, fontsFor } from './pdf-text';

/** Page number (from 1) to the boxes to black out on it, in points from the top left. */
export type Marks = ReadonlyMap<number, readonly Box[]>;

export async function canvasBytes(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.9): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, type, quality));
  if (!blob) throw new Error('The page picture could not be made.');
  return new Uint8Array(await blob.arrayBuffer());
}

export interface OcrWord {
  text: string;
  /** Tesseract's confidence, 0 to 100. */
  readonly confidence: number;
  /** In pixels of the picture that was read. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly line: number;
  readonly paragraph: number;
  /** Set when a person has looked at the word. */
  checked?: boolean;
}

/** The words Tesseract sees in a picture, with their places and how sure it is of each. */
export async function recogniseWords(canvas: HTMLCanvasElement, language: OcrLanguage): Promise<OcrWord[]> {
  const worker = await ocrWorker(language);
  const result = await worker.recognize(canvas, {}, { text: true, blocks: true });
  const words: OcrWord[] = [];
  let line = 0;
  let paragraph = 0;
  for (const block of result.data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const row of para.lines) {
        for (const word of row.words) {
          if (!word.text.trim()) continue;
          words.push({ text: word.text, confidence: word.confidence, x: word.bbox.x0, y: word.bbox.y0, w: word.bbox.x1 - word.bbox.x0, h: word.bbox.y1 - word.bbox.y0, line, paragraph });
        }
        line += 1;
      }
      paragraph += 1;
    }
  }
  return words;
}

/** Words as running text: one line per line, a blank line between paragraphs. */
export function wordsText(words: readonly OcrWord[]): string {
  let out = '';
  let previous: OcrWord | null = null;
  for (const word of words) {
    if (previous) out += word.paragraph !== previous.paragraph ? '\n\n' : word.line !== previous.line ? '\n' : ' ';
    out += word.text;
    previous = word;
  }
  return out;
}

export interface RedactOptions {
  /** Resolution of the page pictures. */
  readonly dpi: number;
  readonly fill: 'black' | 'white';
  /** Turn every page into a picture, not only the pages with marks. */
  readonly flattenAll: boolean;
  /** Read the redacted pictures again so the pages can be searched (the text under marks is gone by then). */
  readonly ocr: OcrLanguage | null;
}

/**
 * Pages with marks become pictures with the marks drawn in, so what was under them is no
 * longer in the file.  Other pages are copied.  The result is a new document: the old one's
 * information, bookmarks, attachments and scripts are not carried over.
 */
export async function redactPdf(bytes: Uint8Array, marks: Marks, options: RedactOptions, onStep: (step: string) => void = () => undefined): Promise<Uint8Array> {
  const source = await loadPdf(bytes);
  const { doc: view, close } = await openPdf(bytes);
  try {
    const out = await PDFDocument.create();
    const scale = options.dpi / 72;
    const pending: { page: ReturnType<PDFDocument['addPage']>; words: Word[] }[] = [];
    for (let number = 1; number <= view.numPages; number++) {
      const boxes = marks.get(number) ?? [];
      if (!boxes.length && !options.flattenAll) {
        const [copied] = await out.copyPages(source, [number - 1]);
        if (copied) out.addPage(copied);
        continue;
      }
      onStep(`page ${number} of ${view.numPages}`);
      const canvas = await renderPage(view, number, scale);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not create a drawing surface.');
      context.fillStyle = options.fill === 'white' ? '#ffffff' : '#000000';
      for (const box of boxes) context.fillRect(Math.floor(box.x * scale), Math.floor(box.y * scale), Math.ceil(box.w * scale) + 1, Math.ceil(box.h * scale) + 1);
      const width = canvas.width / scale;
      const height = canvas.height / scale;
      const page = out.addPage([width, height]);
      page.drawImage(await out.embedJpg(await canvasBytes(canvas)), { x: 0, y: 0, width, height });
      if (options.ocr) {
        const words = await recogniseWords(canvas, options.ocr);
        pending.push({ page, words: words.map((w) => ({ text: w.text, x: w.x / scale, y: w.y / scale, w: w.w / scale, h: w.h / scale })) });
      }
      canvas.width = 0;
    }
    if (pending.some((entry) => entry.words.length)) {
      const fonts = await fontsFor(
        out,
        pending.flatMap((entry) => entry.words.map((w) => w.text)),
      );
      for (const entry of pending) hiddenText(entry.page, fonts.regular, entry.words);
      await finishFonts(out);
    }
    out.setProducer('Benchtop (pdf-lib)');
    out.setCreator('Benchtop');
    return await out.save();
  } finally {
    await close();
  }
}

/** Reads a finished file back, independently of how it was written, and reports what is left. */
export async function verifyRedaction(output: Uint8Array, marks: Marks, queries: readonly Query[], fill: 'black' | 'white'): Promise<Check[]> {
  const { doc, close } = await openPdf(output);
  try {
    let under = 0;
    let marked = 0;
    let badPixels = 0;
    const pagesLeft: number[] = [];
    const loose: string[] = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const text = await pageText(doc, number);
      const boxes = marks.get(number) ?? [];
      if (boxes.length) {
        under += textUnder(text.items, boxes).length;
        const scale = 1.5;
        const canvas = await renderPage(doc, number, scale);
        // One read of the whole page; the marks are then sampled in memory.
        const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
        for (const box of boxes) {
          marked += 1;
          const inset = Math.min(2.5, box.w / 4, box.h / 4);
          let bad = false;
          for (const fx of [0, 0.5, 1]) {
            for (const fy of [0, 0.5, 1]) {
              const px = Math.min(canvas.width - 1, Math.max(0, Math.round((box.x + inset + (box.w - inset * 2) * fx) * scale)));
              const py = Math.min(canvas.height - 1, Math.max(0, Math.round((box.y + inset + (box.h - inset * 2) * fy) * scale)));
              if (!pixels) continue;
              const at = (py * canvas.width + px) * 4;
              const level = Math.max(pixels[at] as number, pixels[at + 1] as number, pixels[at + 2] as number);
              const low = Math.min(pixels[at] as number, pixels[at + 1] as number, pixels[at + 2] as number);
              if (fill === 'black' ? level > 70 : low < 185) bad = true;
            }
          }
          if (bad) badPixels += 1;
        }
        canvas.width = 0;
      }
      if (queries.length && findMatches(text.items, queries).length) pagesLeft.push(number);
      const page = await doc.getPage(number);
      for (const annotation of (await page.getAnnotations()) as Record<string, unknown>[]) {
        const pieces = [annotation.contentsObj, annotation.titleObj].map((o) => (o && typeof o === 'object' && 'str' in o ? String((o as { str: unknown }).str) : ''));
        loose.push(...pieces, String(annotation.url ?? ''), String(annotation.fieldValue ?? ''), String(annotation.alternativeText ?? ''));
      }
    }
    const meta = (await doc.getMetadata()) as { info?: unknown; metadata?: { getRaw?: () => string } | null };
    const information = `${JSON.stringify(meta.info ?? {})} ${meta.metadata?.getRaw?.() ?? ''}`;
    const attachments = (await doc.getAttachments()) as Record<string, unknown> | null;
    const inAnnotations = mentions(loose.join('\n'), queries);
    const inInformation = mentions(information, queries);
    const inBytes = queries.filter((q) => q.kind === 'text' && bytesMention(output, q.text.trim())).map((q) => (q.kind === 'text' ? q.text : ''));
    const checks: Check[] = [
      {
        id: 'under',
        label: 'No text is left under the marks',
        ok: under === 0,
        detail: under ? `${under} pieces of text still lie under marks.` : `${marked} ${marked === 1 ? 'mark' : 'marks'} checked.`,
      },
      { id: 'pixels', label: 'The marks are part of the page pictures', ok: badPixels === 0, detail: badPixels ? `${badPixels} marks are not solid.` : 'Each mark was sampled in the saved file.' },
    ];
    if (queries.length) {
      checks.push(
        {
          id: 'pages',
          label: 'What you looked for is gone from the text of every page',
          ok: pagesLeft.length === 0,
          detail: pagesLeft.length ? `Still found on page ${pagesLeft.slice(0, 12).join(', ')}.` : '',
        },
        { id: 'information', label: 'Not in the document information or metadata', ok: inInformation.length === 0, detail: inInformation.join(', ') },
        { id: 'annotations', label: 'Not in comments, links or form fields', ok: inAnnotations.length === 0, detail: inAnnotations.join(', ') },
        { id: 'bytes', label: 'Not readable in the file’s raw data', ok: inBytes.length === 0, detail: inBytes.join(', ') },
      );
    }
    const count = attachments ? Object.keys(attachments).length : 0;
    checks.push({ id: 'attachments', label: 'No attachments came along', ok: count === 0, detail: count ? `${count} attached files.` : '' });
    return checks;
  } finally {
    await close();
  }
}

export interface ArchiveOptions {
  /** `pictures` rebuilds every page as a picture; `kept` leaves the pages as they are. */
  readonly mode: 'pictures' | 'kept';
  readonly dpi: number;
  /** With `pictures`: keep the text selectable through a hidden layer. */
  readonly hiddenText: boolean;
  readonly meta: ArchiveMeta;
}

/** A PDF/A-2b version of a PDF, and what was checked in it. */
export async function toPdfA(bytes: Uint8Array, options: ArchiveOptions, profile: Uint8Array, onStep: (step: string) => void = () => undefined): Promise<{ bytes: Uint8Array; checks: Check[] }> {
  const id = crypto.getRandomValues(new Uint8Array(16));
  let doc: PDFDocument;
  if (options.mode === 'kept') {
    doc = await loadPdf(bytes);
    strip(doc);
  } else {
    doc = await PDFDocument.create();
    const { doc: view, close } = await openPdf(bytes);
    try {
      const scale = options.dpi / 72;
      const layers: { page: ReturnType<PDFDocument['addPage']>; words: Word[] }[] = [];
      for (let number = 1; number <= view.numPages; number++) {
        onStep(`page ${number} of ${view.numPages}`);
        const canvas = await renderPage(view, number, scale);
        const width = canvas.width / scale;
        const height = canvas.height / scale;
        const page = doc.addPage([width, height]);
        page.drawImage(await doc.embedJpg(await canvasBytes(canvas)), { x: 0, y: 0, width, height });
        canvas.width = 0;
        if (options.hiddenText) layers.push({ page, words: (await pageText(view, number)).items });
      }
      if (layers.some((layer) => layer.words.length)) {
        // The embedded font is used even for plain Latin text: PDF/A wants every font in the file.
        const fonts = await fontsFor(doc, [...layers.flatMap((layer) => layer.words.map((w) => w.text)), 'अ']);
        for (const layer of layers) hiddenText(layer.page, fonts.regular, layer.words);
        await finishFonts(doc);
      }
    } finally {
      await close();
    }
  }
  identify(doc, options.meta, profile, new Date(), id);
  const saved = await doc.save({ useObjectStreams: false });
  return { bytes: saved, checks: report(await PDFDocument.load(saved, { updateMetadata: false }), options.mode) };
}
