/**
 * The app's one Tesseract worker (English and Hindi tessdata_fast models
 * bundled under public/tesseract), shared by the OCR tool and the Recipe
 * tool's Optical Character Recognition operation.
 */
export type OcrLanguage = 'eng' | 'hin' | 'eng+hin';

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>;

let workerPromise: Promise<{ worker: TesseractWorker; language: OcrLanguage }> | null = null;
let report: (status: string, progress: number) => void = () => undefined;

/** Receives Tesseract's progress messages until replaced; pass a no-op to stop. */
export function onOcrProgress(next: (status: string, progress: number) => void): void {
  report = next;
}

/** The worker, switched to `language` if it was last used with another set. */
export async function ocrWorker(language: OcrLanguage): Promise<TesseractWorker> {
  workerPromise ??= import('tesseract.js').then(async ({ createWorker }) => {
    const base = new URL('tesseract/', document.baseURI).href;
    const worker = await createWorker(language, 1, {
      workerPath: `${base}worker.min.js`,
      corePath: `${base}core`,
      langPath: `${base}lang`,
      gzip: false,
      workerBlobURL: false,
      cacheMethod: 'none',
      logger: (m: { status: string; progress: number }) => report(m.status, m.progress),
    });
    return { worker, language };
  });
  workerPromise.catch(() => {
    workerPromise = null;
  });
  const entry = await workerPromise;
  if (entry.language !== language) {
    await entry.worker.reinitialize(language, 1);
    entry.language = language;
  }
  return entry.worker;
}
