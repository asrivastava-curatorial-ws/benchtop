/** The main thread's side of recipe host requests (see host.ts). */
import { bodyBytes, followRedirects } from '../lib/net/http';
import { type OcrLanguage, ocrWorker } from '../lib/ocr-engine';
import { type HttpRequest, net } from '../platform/net';
import type { FetchResult, HostMethod, OcrRequest, OcrResult } from './host';

const LANGUAGES: readonly OcrLanguage[] = ['eng', 'hin', 'eng+hin'];

async function recognise({ image, language }: OcrRequest): Promise<OcrResult> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([image as BlobPart]));
  } catch {
    throw new Error('The input is not a picture this app can read (PNG, JPEG, GIF, BMP, WebP or AVIF).');
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  bitmap.close();
  const worker = await ocrWorker(LANGUAGES.find((l) => l === language) ?? 'eng');
  // The OCR tool may have changed these; recipes use Tesseract's defaults.
  await worker.setParameters({ tessedit_pageseg_mode: '3' as never, preserve_interword_spaces: '0' });
  const { data } = await worker.recognize(canvas);
  return { text: data.text, confidence: data.confidence };
}

async function fetchLike(request: HttpRequest): Promise<FetchResult> {
  const { final, problem } = await followRedirects(net(), request);
  if (problem) throw new Error(problem);
  return { url: final.url, status: final.status, reason: final.reason, headers: final.headers, body: bodyBytes(final), truncated: final.truncated };
}

export function handleHostCall(method: HostMethod, payload: unknown): Promise<unknown> {
  switch (method) {
    case 'fetch':
      return fetchLike(payload as HttpRequest);
    case 'ocr':
      return recognise(payload as OcrRequest);
    default:
      return Promise.reject(new Error(`Unknown request "${String(method)}".`));
  }
}
