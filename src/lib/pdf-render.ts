/** Renders PDF pages to canvases with PDF.js (bundled, offline), for OCR and PDF-to-image conversion. */
import { ToolError } from './errors';

type PdfModule = typeof import('pdfjs-dist/legacy/build/pdf.min.mjs');
export type PdfDocument = Awaited<ReturnType<PdfModule['getDocument']>['promise']>;

export async function openPdf(bytes: Uint8Array): Promise<{ doc: PdfDocument; close: () => Promise<void> }> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.min.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]);
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: bytes.slice(), stopAtErrors: false });
  try {
    const doc = await task.promise;
    return { doc, close: () => task.destroy() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ToolError(/password/i.test(message) ? 'This PDF is password-protected. Remove the password first (PDF tools → Unlock).' : `The PDF could not be read: ${message}`);
  }
}

/** Draws one page (1-based) at `scale` × 72 dpi on a white background. */
export async function renderPage(doc: PdfDocument, number: number, scale: number): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(number);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d');
  if (!context) throw new ToolError('Could not create a drawing surface.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  page.cleanup();
  return canvas;
}
