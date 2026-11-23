/** Files and folders tools on the desktop side (src-tauri/src/bulk.rs). */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { RenameFile } from '../lib/rename';
import { isDesktop } from './index';

const need = () => {
  if (!isDesktop) throw new Error('Working with folders needs the desktop app.');
};

export interface BulkProgress {
  readonly id: string;
  readonly stage: string;
  readonly done: number;
  readonly total: number;
}

export function onBulkProgress(handler: (p: BulkProgress) => void): Promise<UnlistenFn> {
  if (!isDesktop) return Promise.resolve(() => undefined);
  return listen<BulkProgress>('bulk-progress', (event) => handler(event.payload));
}

export async function cancelBulk(id: string): Promise<void> {
  if (isDesktop) await invoke('bulk_cancel', { id });
}

export async function listFiles(token: string, recursive: boolean, includeHidden: boolean): Promise<RenameFile[]> {
  need();
  return invoke<RenameFile[]>('bulk_list', { token, recursive, includeHidden });
}

export interface RenameResult {
  readonly done: readonly (readonly [string, string])[];
  readonly failed: readonly (readonly [string, string])[];
}

export async function renameFiles(token: string, renames: readonly { from: string; to: string }[]): Promise<RenameResult> {
  need();
  return invoke<RenameResult>('bulk_rename', { token, renames });
}

export interface DupFile {
  readonly folder: number;
  readonly path: string;
  readonly modified: number;
}
export interface DupGroup {
  readonly size: number;
  readonly hash: string;
  readonly files: readonly DupFile[];
}
export interface DupReport {
  readonly scanned: number;
  readonly groups: readonly DupGroup[];
  readonly wasted: number;
  readonly cancelled: boolean;
}

export async function findDuplicates(id: string, tokens: readonly string[], minSize: number, includeHidden: boolean): Promise<DupReport> {
  need();
  return invoke<DupReport>('bulk_duplicates', { id, tokens, minSize, includeHidden });
}

/** Moves files (folder token and path inside it) to the system trash; returns the ones that failed. */
export async function trashFiles(items: readonly (readonly [string, string])[]): Promise<(readonly [string, string])[]> {
  need();
  return invoke('bulk_trash', { items });
}

export interface UsageNode {
  readonly name: string;
  readonly size: number;
  readonly files: number;
  readonly children: readonly UsageNode[];
}
export interface UsageReport {
  readonly tree: UsageNode;
  readonly largest: readonly RenameFile[];
  readonly types: readonly (readonly [string, number, number])[];
  readonly cancelled: boolean;
}

export async function measureFolder(id: string, token: string): Promise<UsageReport> {
  need();
  return invoke<UsageReport>('bulk_usage', { id, token });
}

export interface CompareRow {
  readonly path: string;
  readonly state: 'same' | 'different' | 'left' | 'right';
  readonly leftSize: number | null;
  readonly rightSize: number | null;
  readonly leftModified: number | null;
  readonly rightModified: number | null;
}

export async function compareFolders(id: string, left: string, right: string, checksums: boolean, includeHidden: boolean): Promise<CompareRow[]> {
  need();
  return invoke<CompareRow[]>('bulk_compare', { id, left, right, checksums, includeHidden });
}

export async function copyBetween(from: string, to: string, paths: readonly string[]): Promise<(readonly [string, string])[]> {
  need();
  return invoke('bulk_copy', { from, to, paths });
}
