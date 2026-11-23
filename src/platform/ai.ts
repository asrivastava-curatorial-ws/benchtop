/**
 * The AI engine in the desktop shell: model downloads and jobs (background
 * removal, upscaling, faces, the object eraser and transcription).  Jobs run
 * in a separate worker process on this computer; nothing is uploaded.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isDesktop } from './index';

export type ModelKind = 'runtime' | 'gpuRuntime' | 'background' | 'upscale' | 'faces' | 'eraser' | 'speech' | 'vad' | 'voice';

export interface ModelItem {
  readonly id: string;
  readonly kind: ModelKind;
  readonly name: string;
  readonly description: string;
  readonly licence: string;
  readonly homepage: string;
  readonly default: boolean;
  /** Speech models only: understands languages other than English. */
  readonly multilingual: boolean;
  readonly installed: boolean;
  readonly download: { readonly size: number; readonly file: string; readonly sha256: string; readonly urls: readonly string[] };
}

export interface AiStatus {
  readonly folder: string;
  readonly mirror: string;
  readonly threads: number;
  readonly platform: string;
  readonly arch: string;
  readonly items: readonly ModelItem[];
}

export interface DownloadProgress {
  readonly id: string;
  readonly stage: 'downloading' | 'unpacking' | 'done' | 'error';
  readonly received: number;
  readonly total: number;
  readonly message?: string | null;
}

export interface JobProgress {
  readonly value: number;
  readonly stage: string;
}

export interface PickedFile {
  readonly token: string;
  readonly name: string;
  readonly size: number;
  readonly folder: string;
}

export class DesktopOnly extends Error {
  constructor(what = 'This tool') {
    super(`${what} runs AI models on this computer, which needs the Benchtop desktop app.`);
    this.name = 'DesktopOnly';
  }
}

const need = (what?: string) => {
  if (!isDesktop) throw new DesktopOnly(what);
};

export async function aiStatus(): Promise<AiStatus> {
  need('Managing AI models');
  return invoke<AiStatus>('ai_status');
}

export async function installModel(id: string): Promise<void> {
  need('Downloading models');
  await invoke('ai_install', { id });
}

export async function cancelInstall(id: string): Promise<void> {
  if (isDesktop) await invoke('ai_cancel_install', { id });
}

export async function removeModel(id: string): Promise<void> {
  need('Removing models');
  await invoke('ai_remove', { id });
}

export async function importModels(): Promise<{ imported: string[]; rejected: string[]; cancelled?: boolean }> {
  need('Importing models');
  return invoke('ai_import');
}

export function onDownload(handler: (progress: DownloadProgress) => void): Promise<UnlistenFn> {
  if (!isDesktop) return Promise.resolve(() => undefined);
  return listen<DownloadProgress>('ai-download', (event) => handler(event.payload));
}

export function onJobProgress(handler: (progress: JobProgress) => void): Promise<UnlistenFn> {
  if (!isDesktop) return Promise.resolve(() => undefined);
  return listen<JobProgress>('ai-progress', (event) => handler(event.payload));
}

export async function cancelJob(): Promise<void> {
  if (isDesktop) await invoke('ai_cancel');
}

export interface JobRequest {
  readonly op: 'background' | 'upscale' | 'faces' | 'erase' | 'transcribe' | 'speak' | 'probe';
  readonly model?: string;
  readonly options?: Record<string, unknown>;
  /** File name, so the worker can recognise the audio format. */
  readonly name?: string;
  /** A token from pickPaths() for large files read directly by the shell. */
  readonly file?: string;
  /** Use the GPU when one is available (default true). */
  readonly gpu?: boolean;
}

export interface JobResult<H = Record<string, unknown>> {
  readonly header: H & { readonly device?: string };
  readonly bytes: Uint8Array;
}

/** Runs one job; `input` (and `mask` for the eraser) travel as raw bytes. */
export async function runJob<H = Record<string, unknown>>(request: JobRequest, input?: Uint8Array, mask?: Uint8Array): Promise<JobResult<H>> {
  need();
  const first = input ?? new Uint8Array(0);
  const body = new Uint8Array(8 + first.length + (mask?.length ?? 0));
  new DataView(body.buffer).setBigUint64(0, BigInt(first.length), true);
  body.set(first, 8);
  if (mask) body.set(mask, 8 + first.length);
  const raw = await invoke<ArrayBuffer>('ai_run', body, { headers: { 'x-ai': encodeURIComponent(JSON.stringify(request)) } });
  const bytes = new Uint8Array(raw);
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + length))) as JobResult<H>['header'];
  return { header, bytes: bytes.slice(4 + length) };
}

/** Native file picker that hands back tokens instead of paths (large audio and video stay on disk). */
export async function pickPaths(multiple: boolean, filters: readonly { name: string; extensions: readonly string[] }[] = []): Promise<PickedFile[]> {
  need('Choosing files this way');
  return invoke<PickedFile[]>('pick_paths', { multiple, filters });
}

/** Copies a file dropped on the window to a temporary folder, for the tools that read files from disk. */
export async function stageFile(file: File): Promise<PickedFile> {
  need('Opening a dropped file in this tool');
  if (file.size > 2 * 1024 ** 3) throw new Error(`"${file.name}" is over 2 GB; choose it in the tool instead.`);
  return invoke<PickedFile>('stage_file', new Uint8Array(await file.arrayBuffer()), { headers: { 'x-file-name': encodeURIComponent(file.name) } });
}

export const formatSize = (bytes: number): string => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} kB`);
