/** Tray icon, quick-launch shortcut and clipboard history (desk.rs).  Desktop app only. */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isDesktop } from './index';

export interface DeskInfo {
  readonly tray_supported: boolean;
  readonly tray: boolean;
  readonly shortcut: string | null;
  readonly watching: boolean;
}

export interface ClipEntry {
  readonly text: string;
  /** Milliseconds since 1970. */
  readonly at: number;
}

export const DEFAULT_QUICK_KEY = 'CommandOrControl+Alt+Space';

const desktopOnly = () => new Error('This needs the desktop app.');

export async function deskInfo(): Promise<DeskInfo> {
  if (!isDesktop) return { tray_supported: false, tray: false, shortcut: null, watching: false };
  return invoke<DeskInfo>('desk_info');
}

export async function setTray(enabled: boolean): Promise<void> {
  if (!isDesktop) throw desktopOnly();
  await invoke('desk_tray', { enabled });
}

/** Registers the quick-launch shortcut; an empty string removes it. */
export async function setQuickKey(accelerator: string): Promise<void> {
  if (!isDesktop) throw desktopOnly();
  await invoke('desk_shortcut', { accelerator });
}

export async function watchClipboard(enabled: boolean): Promise<void> {
  if (!isDesktop) throw desktopOnly();
  await invoke('clip_watch', { enabled });
}

export const clipboardHistory = (): Promise<ClipEntry[]> => (isDesktop ? invoke<ClipEntry[]>('clip_list') : Promise.resolve([]));
export const forgetClip = (entry: ClipEntry): Promise<void> => invoke('clip_remove', { at: entry.at, text: entry.text });
export const clearClipboardHistory = (): Promise<void> => invoke('clip_clear');

/** Calls `handler` whenever the clipboard history gains an entry. */
export function onClipboard(handler: () => void): Promise<UnlistenFn> {
  return isDesktop ? listen('benchtop://clipboard', handler) : Promise.resolve(() => undefined);
}

/** The shortcut or the tray menu asks for the quick launcher, or for a tool. */
export function onDeskRequests(onLaunch: () => void, onTool: (id: string) => void): Promise<UnlistenFn> {
  if (!isDesktop) return Promise.resolve(() => undefined);
  return Promise.all([listen('benchtop://quick-launch', onLaunch), listen<string>('benchtop://open-tool', (event) => onTool(event.payload))]).then((stops) => () => {
    for (const stop of stops) stop();
  });
}
