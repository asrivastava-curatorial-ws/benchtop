/**
 * The few things that differ between the desktop shell and a plain browser:
 * the clipboard and saving files.  Everything else in the app is ordinary web
 * code, which is what keeps it testable without the shell.
 */
import { invoke } from '@tauri-apps/api/core';
import { utf8Encode } from '../lib/bytes';

export const isDesktop: boolean = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

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

/** Saves through a native "Save as" dialog on the desktop, or as a download in a browser. */
export async function saveFile(name: string, data: string | Uint8Array | Blob, mime = 'application/octet-stream'): Promise<SaveOutcome> {
  const bytes = typeof data === 'string' ? utf8Encode(data) : data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
  if (isDesktop) {
    // The bytes travel as a raw IPC body (no Base64 or JSON overhead); the name goes in a header.
    const path = await invoke<string | null>('save_file', bytes, { headers: { 'X-File-Name': encodeURIComponent(name) } });
    return path === null ? { saved: false } : { saved: true, location: path };
  }
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
export function pickFiles(accept = ''): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (accept !== '') input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(Array.from(input.files ?? []));
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
export function pickFile(accept = ''): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept !== '') input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(input.files?.[0] ?? null);
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
