/**
 * Requests that recipe operations make of the app itself.
 *
 * Recipes run in a worker, which cannot reach the desktop shell or the OCR
 * engine.  The few operations that need them (HTTP request, DNS over HTTPS,
 * Optical Character Recognition) ask the main thread through this channel;
 * when recipes run inline (no worker), the call goes straight to it.
 */
import type { HttpRequest } from '../platform/net';

/** A response after redirects were followed and the body decompressed, as fetch() would give it. */
export interface FetchResult {
  readonly url: string;
  readonly status: number;
  readonly reason: string;
  /** Header names in lower case, in the order received. */
  readonly headers: readonly (readonly [string, string])[];
  readonly body: Uint8Array;
  /** The shell keeps at most 8 MB of a body. */
  readonly truncated: boolean;
}

export interface OcrRequest {
  readonly image: Uint8Array;
  /** Tesseract language codes joined with "+", such as "eng" or "eng+hin". */
  readonly language: string;
}

export interface OcrResult {
  readonly text: string;
  readonly confidence: number;
}

export interface HostCalls {
  fetch(request: HttpRequest): Promise<FetchResult>;
  ocr(request: OcrRequest): Promise<OcrResult>;
}

export type HostMethod = keyof HostCalls;

export interface HostRequest {
  readonly host: { readonly id: number; readonly method: HostMethod; readonly payload: unknown };
}

export interface HostReply {
  readonly hostReply: { readonly id: number; readonly ok: boolean; readonly value?: unknown; readonly error?: string };
}

type Caller = (method: HostMethod, payload: unknown) => Promise<unknown>;

/** Without a worker the main thread's own implementation answers, loaded on first use. */
let caller: Caller = async (method, payload) => {
  const { handleHostCall } = await import('./host-main');
  return handleHostCall(method, payload);
};

export function setHostCaller(next: Caller): void {
  caller = next;
}

export function callHost<M extends HostMethod>(method: M, payload: Parameters<HostCalls[M]>[0]): ReturnType<HostCalls[M]> {
  return caller(method, payload) as ReturnType<HostCalls[M]>;
}
