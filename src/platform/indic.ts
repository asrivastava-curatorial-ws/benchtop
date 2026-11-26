/** IndicTrans2 on this computer: one-click setup and the background server (indic.rs).  Desktop app only. */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isDesktop } from './index';

export interface IndicInstalled {
  readonly version: number;
  readonly python: string;
  readonly torch: string;
  readonly gpu: boolean;
  /** "en-indic" and/or "indic-en". */
  readonly models: readonly string[];
}

export interface IndicStatus {
  readonly supported: boolean;
  readonly gpuChoice: boolean;
  readonly installed: IndicInstalled | null;
  readonly outdated: boolean;
  readonly busy: boolean;
  readonly running: boolean;
  readonly ready: boolean;
  readonly port: number | null;
  readonly missing: readonly string[];
  readonly message: string | null;
  readonly folder: string;
}

export interface IndicSetupEvent {
  readonly kind: 'step' | 'log' | 'progress' | 'done' | 'error' | 'cancelled';
  readonly step: string | null;
  readonly message: string | null;
  readonly done: number;
  readonly total: number;
}

export interface IndicServerEvent {
  readonly ready: boolean;
  readonly port?: number | null;
  readonly missing?: readonly string[];
  readonly message?: string | null;
}

const WEB: IndicStatus = {
  supported: false,
  gpuChoice: false,
  installed: null,
  outdated: false,
  busy: false,
  running: false,
  ready: false,
  port: null,
  missing: [],
  message: null,
  folder: '',
};

export const indicStatus = (): Promise<IndicStatus> => (isDesktop ? invoke<IndicStatus>('indic_status') : Promise.resolve(WEB));
export const indicSize = (): Promise<number> => (isDesktop ? invoke<number>('indic_size') : Promise.resolve(0));
/** Sets everything up, or with `modelsOnly` fetches the models again (after adding a token). */
/** Sets up Python, PyTorch and models (IndicTrans2's when `models` is empty), or with `modelsOnly` fetches more models into an existing setup. */
export const setUpIndic = (options: { token?: string; gpu: boolean; modelsOnly?: boolean; models?: string[] }): Promise<void> => invoke('indic_setup', { options });
export const cancelIndicSetup = (): Promise<void> => invoke('indic_cancel');
export const startIndic = (): Promise<void> => invoke('indic_start');
export const stopIndic = (): Promise<void> => invoke('indic_stop');
export const removeIndic = (): Promise<void> => invoke('indic_remove');

/** The chat address of a server listening on `port`. */
export const indicAddress = (port: number): string => `http://127.0.0.1:${port}/v1/chat/completions`;

export function onIndicSetup(handler: (event: IndicSetupEvent) => void): Promise<UnlistenFn> {
  return isDesktop ? listen<IndicSetupEvent>('benchtop://indic-setup', (event) => handler(event.payload)) : Promise.resolve(() => undefined);
}

export function onIndicServer(handler: (event: IndicServerEvent) => void): Promise<UnlistenFn> {
  return isDesktop ? listen<IndicServerEvent>('benchtop://indic-server', (event) => handler(event.payload)) : Promise.resolve(() => undefined);
}
