/**
 * Offline Search in the desktop shell (search.rs): an index of the folders the
 * user chose, kept in the app's data folder.  The page never passes a path:
 * folders come from the system's folder dialog, files are named by their id in
 * the index.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isDesktop } from './index';

export interface SearchRoot {
  readonly id: number;
  readonly path: string;
  readonly ocr: boolean;
  readonly hidden: boolean;
  /** Seconds since 1970 of the last complete update; 0 when never. */
  readonly scanned: number;
  readonly files: number;
  readonly pending: number;
  readonly failed: number;
  readonly missing: boolean;
}

export interface SearchStatus {
  readonly roots: readonly SearchRoot[];
  readonly files: number;
  readonly pending: number;
  readonly bytes: number;
  readonly scanning: boolean;
}

export interface ScanSummary {
  readonly indexed: number;
  readonly pending: number;
  readonly byName: number;
  readonly unchanged: number;
  readonly removed: number;
  readonly failed: number;
  readonly cancelled: boolean;
}

export interface ScanProgress {
  readonly root: number;
  readonly done: number;
  readonly total: number;
  readonly file: string;
}

export interface PendingFile {
  readonly id: number;
  readonly name: string;
  readonly kind: string;
  readonly size: number;
  readonly ocr: boolean;
}

export interface SearchHit {
  readonly row: number;
  readonly file: number;
  readonly root: number;
  readonly folder: string;
  readonly rel: string;
  readonly kind: string;
  readonly status: string;
  readonly note: string;
  readonly size: number;
  readonly mtime: number;
  readonly label: string;
  readonly line: number;
  /** The path inside the folder, with match markers. */
  readonly name: string;
  readonly snippet: string;
}

export interface SearchAnswer {
  readonly hits: readonly SearchHit[];
  readonly places: number;
  readonly files: number;
  readonly searched: boolean;
}

export interface SearchPreview {
  readonly label: string;
  readonly line: number;
  readonly text: string;
  readonly parts: number;
  readonly part: number;
}

export interface TextPart {
  readonly label: string;
  readonly text: string;
}

export interface QueryOptions {
  readonly kinds?: readonly string[];
  readonly root?: number | null;
  readonly limit?: number;
  readonly wholeWords?: boolean;
}

export const searchStatus = (): Promise<SearchStatus> => invoke<SearchStatus>('search_status');
export const addSearchRoot = (token: string, ocr: boolean): Promise<number> => invoke<number>('search_add_root', { token, ocr });
export const updateSearchRoot = (id: number, ocr: boolean, hidden: boolean): Promise<void> => invoke<void>('search_update_root', { id, ocr, hidden });
export const removeSearchRoot = (id: number): Promise<void> => invoke<void>('search_remove_root', { id });
export const scanFolders = (root: number | null): Promise<ScanSummary> => invoke<ScanSummary>('search_scan', { root });
export const cancelScan = (): Promise<void> => invoke<void>('search_cancel');
export const pendingFiles = (limit: number): Promise<PendingFile[]> => invoke<PendingFile[]>('search_pending', { limit });
export const storeText = (id: number, parts: readonly TextPart[], status: 'done' | 'partial' | 'failed' | 'name', note: string): Promise<void> =>
  invoke<void>('search_store', { id, parts, status, note });
export const searchFiles = (text: string, options: QueryOptions): Promise<SearchAnswer> => invoke<SearchAnswer>('search_query', { text, options });
export const previewPart = (row: number, text: string, wholeWords: boolean): Promise<SearchPreview> => invoke<SearchPreview>('search_preview', { row, text, wholeWords });
export const revealIndexedFile = (id: number): Promise<void> => invoke<void>('search_reveal', { id });
export const clearSearchIndex = (): Promise<void> => invoke<void>('search_clear');

export async function readIndexedFile(id: number): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>('search_read', { id }));
}

export function onScanProgress(handler: (progress: ScanProgress) => void): Promise<UnlistenFn> {
  if (!isDesktop) return Promise.resolve(() => undefined);
  return listen<ScanProgress>('search-progress', (event) => handler(event.payload));
}
