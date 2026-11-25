/**
 * The few things that differ between the desktop shell and a plain browser:
 * the clipboard and saving files.  Everything else in the app is ordinary web
 * code, which is what keeps it testable without the shell.
 */
import { invoke } from '@tauri-apps/api/core';
import { utf8Encode } from '../lib/bytes';

export const isDesktop: boolean = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Opens the project's releases page, or one release's page, in the system's web browser (desktop app). */
export async function openReleasePage(tag?: string): Promise<void> {
  if (!isDesktop) throw new Error('Open the releases page from the desktop app.');
  await invoke('open_release_page', { tag: tag ?? null });
}

export async function copyText(text: string): Promise<void> {
  if (isDesktop) {
    try {
      const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
      await writeText(text);
      return;
    } catch {
      // fall through to the web APIs
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // fall through to the legacy command
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('The clipboard is not available. Select the text and press Ctrl+C instead.');
}

export async function readClipboardText(): Promise<string> {
  if (isDesktop) {
    try {
      const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
      return await readText();
    } catch {
      // fall through to the web API
    }
  }
  try {
    return await navigator.clipboard.readText();
  } catch {
    throw new Error('Clipboard access was not allowed. Click in the editor and press Ctrl+V instead.');
  }
}

export type SaveOutcome = { readonly saved: true; readonly location: string } | { readonly saved: false };

/** Told about every file a tool saves and every file opened through the pickers, so an open project can keep copies. */
export interface FileHooks {
  saved?(file: { readonly name: string; readonly bytes: Uint8Array; readonly mime: string }): void;
  picked?(files: readonly File[]): void;
}
let hooks: FileHooks = {};
export function setFileHooks(next: FileHooks): void {
  hooks = next;
}
/** Pass `{ record: false }` for files that are not part of the user's work (settings, bundles). */
export interface FileOptions {
  readonly record?: boolean;
}

/** Saves through a native "Save as" dialog on the desktop, or as a download in a browser. */
export async function saveFile(name: string, data: string | Uint8Array | Blob, mime = 'application/octet-stream', options: FileOptions = {}): Promise<SaveOutcome> {
  const bytes = typeof data === 'string' ? utf8Encode(data) : data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
  const record = () => {
    if (options.record !== false) hooks.saved?.({ name, bytes, mime });
  };
  if (isDesktop) {
    // The bytes travel as a raw IPC body (no Base64 or JSON overhead); the name goes in a header.
    const path = await invoke<string | null>('save_file', bytes, { headers: { 'X-File-Name': encodeURIComponent(name) } });
    if (path !== null) record();
    return path === null ? { saved: false } : { saved: true, location: path };
  }
  record();
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return { saved: true, location: 'your downloads folder' };
}

/** Opens the system file picker for several files.  Resolves with an empty list when dismissed. */
export function pickFiles(accept = '', options: FileOptions = {}): Promise<File[]> {
  return new Promise<File[]>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (accept !== '') input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []);
      if (options.record !== false && files.length) hooks.picked?.(files);
      resolve(files);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve([]);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

/** Opens the system file picker.  Resolves with `null` when the dialog is dismissed. */
export function pickFile(accept = '', options: FileOptions = {}): Promise<File | null> {
  return new Promise<File | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept !== '') input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null;
      if (options.record !== false && file) hooks.picked?.([file]);
      resolve(file);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve(null);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

export const MAX_TEXT_FILE = 20 * 1024 * 1024;
export const MAX_BINARY_FILE = 256 * 1024 * 1024;

export async function readTextFile(file: File): Promise<string> {
  if (file.size > MAX_TEXT_FILE) throw new Error(`"${file.name}" is too large to open as text (the limit is 20 MB).`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`"${file.name}" is not UTF-8 text.`);
  }
  return text.replace(/^\uFEFF/, '');
}

export async function readBinaryFile(file: File): Promise<{ name: string; mime: string; bytes: Uint8Array }> {
  if (file.size > MAX_BINARY_FILE) throw new Error(`"${file.name}" is too large (the limit is 256 MB).`);
  return { name: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) };
}

export interface PdfOptions {
  /** A4, A3, A5, Letter or Legal. */
  readonly paper?: string;
  readonly landscape?: boolean;
  /** Print background colours and pictures. */
  readonly background?: boolean;
}

/**
 * Renders a complete HTML document (scripts are not run) to PDF with the
 * computer's own browser engine: Chrome, Chromium, Edge or Brave when one is
 * installed, otherwise the system web view.  Desktop app only.
 */
export async function htmlToPdf(html: string, options: PdfOptions = {}): Promise<Uint8Array> {
  if (!isDesktop) throw new Error('Saving PDFs directly needs the desktop app. In a browser, print the page and choose "Save as PDF".');
  const bytes = await invoke<ArrayBuffer>('html_to_pdf', { html, paper: options.paper ?? 'A4', landscape: options.landscape ?? false, background: options.background ?? true });
  return new Uint8Array(bytes);
}

export interface PdfEngine {
  /** "chromium" (an installed Chrome, Edge, Chromium or Brave), "webview" (Linux system web view) or "none". */
  readonly kind: 'chromium' | 'webview' | 'none';
  readonly name: string;
  readonly path: string | null;
}

/** The browser engine that turns pages into PDFs on this computer. */
export async function pdfEngine(): Promise<PdfEngine> {
  if (!isDesktop) return { kind: 'none', name: '', path: null };
  return invoke<PdfEngine>('pdf_engine');
}

export interface WebPdf {
  readonly title: string;
  readonly url: string;
  readonly pdf: Uint8Array;
}

/** Opens a web page in the installed browser (headless, with a fresh profile) and saves it as PDF.  Desktop app only. */
export async function urlToPdf(url: string, options: PdfOptions & { readonly waitMs?: number } = {}): Promise<WebPdf> {
  if (!isDesktop) throw new Error('Saving web pages as PDF needs the desktop app: it uses the browser installed on the computer.');
  const result = await invoke<{ title: string; url: string; pdf: string }>('url_to_pdf', {
    url,
    options: { paper: options.paper ?? 'A4', landscape: options.landscape ?? false, background: options.background ?? true, waitMs: options.waitMs ?? 0 },
  });
  return { title: result.title, url: result.url, pdf: Uint8Array.from(atob(result.pdf), (c) => c.charCodeAt(0)) };
}

/** Opens a web or e-mail link in the system's browser or mail program. */
export async function openLink(url: string): Promise<void> {
  if (!/^(https?:|mailto:)/i.test(url.trim())) throw new Error('Only web (http, https) and e-mail links can be opened.');
  if (!isDesktop) {
    window.open(url.trim(), '_blank', 'noopener,noreferrer');
    return;
  }
  await invoke('open_link', { url: url.trim() });
}

/** Reads a file on this computer by its path (files pasted from a file manager).  Desktop app only. */
export async function readLocalFile(path: string): Promise<{ name: string; bytes: Uint8Array }> {
  if (!isDesktop) throw new Error('Reading files by their path needs the desktop app.');
  const bytes = await invoke<ArrayBuffer>('read_local_file', { path });
  return { name: path.replace(/^.*[\\/]/, '') || 'file', bytes: new Uint8Array(bytes) };
}
