/**
 * Asset Finder's side of the desktop shell (assets.rs): the library folder,
 * the libraries' keys (kept in a file only this user can read), resumable
 * downloads with checksums, and the records written beside each asset.
 */
import { Channel, invoke } from '@tauri-apps/api/core';
import { isDesktop } from './index';

export interface DownloadRequest {
  readonly id: string;
  readonly url: string;
  /** Folders inside the library, outermost first. */
  readonly dir: readonly string[];
  readonly name: string;
  readonly headers?: readonly (readonly [string, string])[];
  readonly size?: number;
  readonly md5?: string;
  readonly sha1?: string;
  readonly sha256?: string;
  readonly unzip?: boolean;
}

export interface DownloadProgress {
  readonly received: number;
  readonly total: number | null;
  readonly phase: 'downloading' | 'checking' | 'unpacking';
}

export interface DownloadResult {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly resumed: boolean;
  /** The checksum that was confirmed ("sha256", "sha1", "md5"), or null when the library gave none. */
  readonly verified: string | null;
  readonly unpacked: readonly string[];
}

const desktopOnly = () => {
  if (!isDesktop) throw new Error('Saving into an asset library needs the Benchtop desktop app.');
};

/** The library folder, or null before one is chosen. */
export async function libraryFolder(): Promise<string | null> {
  if (!isDesktop) return null;
  return invoke<string | null>('asset_library');
}

export async function chooseLibraryFolder(): Promise<string | null> {
  desktopOnly();
  return invoke<string | null>('asset_pick_library');
}

/** Every library's keys: { source: { keyName: value } }. */
export async function loadKeys(): Promise<Record<string, Record<string, string>>> {
  if (!isDesktop) return {};
  const raw = await invoke<unknown>('asset_keys');
  const out: Record<string, Record<string, string>> = {};
  if (raw && typeof raw === 'object')
    for (const [source, keys] of Object.entries(raw as Record<string, unknown>)) {
      if (!keys || typeof keys !== 'object') continue;
      out[source] = Object.fromEntries(Object.entries(keys as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'));
    }
  return out;
}

/** Saves one key (an empty value removes it). */
export async function saveKey(source: string, name: string, value: string): Promise<void> {
  desktopOnly();
  await invoke('asset_set_key', { source, name, value });
}

export async function download(request: DownloadRequest, onProgress: (progress: DownloadProgress) => void): Promise<DownloadResult> {
  desktopOnly();
  const channel = new Channel<DownloadProgress>();
  channel.onmessage = onProgress;
  return invoke<DownloadResult>('asset_download', { request, onProgress: channel });
}

export async function cancelDownload(id: string): Promise<void> {
  if (isDesktop) await invoke('asset_cancel', { id });
}

/** Writes a small file into an asset's folder; returns its path. */
export async function writeAssetFile(dir: readonly string[], name: string, content: { text: string } | { bytes: Uint8Array }): Promise<string> {
  desktopOnly();
  if ('text' in content) return invoke<string>('asset_write', { dir, name, text: content.text });
  let binary = '';
  for (let i = 0; i < content.bytes.length; i += 0x8000) binary += String.fromCharCode(...content.bytes.subarray(i, i + 0x8000));
  return invoke<string>('asset_write', { dir, name, base64: btoa(binary) });
}

export async function readAssetFile(dir: readonly string[], name: string): Promise<string | null> {
  if (!isDesktop) return null;
  return invoke<string | null>('asset_read', { dir, name });
}

/** Opens an asset's folder (or, with no folders, the library) in the file manager. */
export async function revealAsset(dir: readonly string[]): Promise<void> {
  desktopOnly();
  await invoke('asset_reveal', { dir });
}

/** Every record (asset.json) in the library, newest first, each with `_folder` and `_saved`. */
export async function libraryRecords(): Promise<Record<string, unknown>[]> {
  desktopOnly();
  return invoke<Record<string, unknown>[]>('asset_records');
}
