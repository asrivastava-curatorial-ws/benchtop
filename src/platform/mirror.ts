/** The website copier on the desktop side (src-tauri/src/mirror.rs). */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isDesktop } from './index';

export type MirrorScope = 'host' | 'domain' | 'folder';

export interface MirrorOptions {
  readonly url: string;
  /** Folder token from pickFolder(). */
  readonly folder: string;
  readonly depth: number;
  readonly scope: MirrorScope;
  readonly maxPages: number;
  readonly maxMegabytes: number;
  readonly outsideAssets: boolean;
  readonly robots: boolean;
  readonly delayMs: number;
  readonly exclude: readonly string[];
}

export interface MirrorProgress {
  readonly id: string;
  readonly pages: number;
  readonly files: number;
  readonly bytes: number;
  readonly queued: number;
  readonly failed: number;
  readonly current: string;
}

export interface MirrorSummary {
  readonly pages: number;
  readonly files: number;
  readonly bytes: number;
  readonly skipped: number;
  readonly failed: readonly (readonly [string, string])[];
  /** The start page's path inside the folder. */
  readonly start: string;
  /** Token for revealing the copy in the file manager. */
  readonly token: string;
  readonly stopped: string | null;
}

export async function copyWebsite(id: string, options: MirrorOptions): Promise<MirrorSummary> {
  if (!isDesktop) throw new Error('Copying websites needs the desktop app.');
  return invoke<MirrorSummary>('mirror_run', { id, options });
}

export async function stopCopy(id: string): Promise<void> {
  if (isDesktop) await invoke('mirror_cancel', { id });
}

export function onCopyProgress(handler: (progress: MirrorProgress) => void): Promise<UnlistenFn> {
  if (!isDesktop) return Promise.resolve(() => undefined);
  return listen<MirrorProgress>('mirror-progress', (event) => handler(event.payload));
}
