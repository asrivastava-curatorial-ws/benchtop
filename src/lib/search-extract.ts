/**
 * Reads the files the search index cannot read natively: text in PDFs (PDF.js)
 * and text in pictures and scanned pages (Tesseract).  Both are bundled, so
 * this works offline.
 */
import { type OcrLanguage, ocrWorker } from './ocr-engine';
import { openPdf, renderPage } from './pdf-render';

export interface Extracted {
  readonly parts: { label: string; text: string }[];
  readonly status: 'done' | 'partial' | 'failed' | 'name';
  readonly note: string;
}

export class Stopped extends Error {}

/** Scanned pages read per PDF before giving up on the rest (OCR takes seconds per page). */
export const MAX_OCR_PAGES = 150;

async function recognise(canvas: HTMLCanvasElement, language: OcrLanguage): Promise<string> {
  const worker = await ocrWorker(language);
  const result = await worker.recognize(canvas, {}, { text: true });
  return result.data.text.trim();
}

/** One part per page.  Pages without a text layer are read with OCR when `ocr` names a language. */
export async function extractPdf(bytes: Uint8Array, ocr: OcrLanguage | null, signal: { cancelled: boolean }, onStep: (step: string) => void = () => undefined): Promise<Extracted> {
  let opened: Awaited<ReturnType<typeof openPdf>>;
  try {
    opened = await openPdf(bytes);
  } catch (error) {
    return { parts: [], status: 'failed', note: error instanceof Error ? error.message : String(error) };
  }
  const { doc, close } = opened;
  try {
    const parts: { label: string; text: string }[] = [];
    let scanned = 0;
    let read = 0;
    for (let number = 1; number <= doc.numPages; number++) {
      if (signal.cancelled) throw new Stopped();
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str;
        text += item.hasEOL ? '\n' : '';
      }
      page.cleanup();
      text = text.replace(/[ \t]+\n/g, '\n').trim();
      if (text.length < 12) {
        scanned += 1;
        if (ocr && read < MAX_OCR_PAGES) {
          onStep(`reading page ${number} of ${doc.numPages}`);
          const canvas = await renderPage(doc, number, 2);
          text = await recognise(canvas, ocr);
          canvas.width = 0;
          read += 1;
        }
      }
      if (text) parts.push({ label: `Page ${number}`, text });
    }
    const unread = scanned - read;
    if (unread > 0 && !ocr)
      return {
        parts,
        status: 'partial',
        note: `${unread} scanned ${unread === 1 ? 'page has' : 'pages have'} no text; switch on reading text in pictures for this folder to search ${unread === 1 ? 'it' : 'them'}.`,
      };
    if (unread > 0) return { parts, status: 'done', note: `Only the first ${MAX_OCR_PAGES} scanned pages were read.` };
    return { parts, status: 'done', note: '' };
  } finally {
    await close();
  }
}

/** The text in one picture. */
export async function extractPicture(bytes: Uint8Array, language: OcrLanguage): Promise<Extracted> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
  } catch {
    return { parts: [], status: 'name', note: 'This picture format cannot be read here: found by name only.' };
  }
  // Very large pictures are scaled down: OCR gains nothing above about 3000 pixels.
  const scale = Math.min(1, 3000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) return { parts: [], status: 'failed', note: 'Could not create a drawing surface.' };
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const text = await recognise(canvas, language);
  canvas.width = 0;
  return { parts: text ? [{ label: 'Text in the picture', text }] : [], status: 'done', note: text ? '' : 'No text was found in this picture.' };
}
