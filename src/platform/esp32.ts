/** ESP32 boards and Arduino sketches for the Circuit Simulator (esp32.rs, arduino.rs). */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isDesktop } from './index';

export interface Esp32Info {
  readonly available: boolean;
  readonly helper: string | null;
  readonly detail: string;
}

const WEB: Esp32Info = { available: false, helper: null, detail: 'ESP32 boards run in the desktop app, which starts an ESP32 emulator beside it.' };

let info: Promise<Esp32Info> | null = null;

/** Whether ESP32 firmware can run here (asked once). */
export function esp32Info(): Promise<Esp32Info> {
  if (!isDesktop) return Promise.resolve(WEB);
  info ??= invoke<Esp32Info>('esp32_info').catch((e) => ({ available: false, helper: null, detail: String(e) }));
  return info;
}

/** Prepares a flash image: `offset` is 0 for a merged image or 0x1000 for a bootloader-style image.  Returns a token. */
export async function esp32Firmware(image: Uint8Array, offset: number): Promise<string> {
  if (!isDesktop) throw new Error(WEB.detail);
  return invoke<string>('esp32_firmware', image, { headers: { 'X-Offset': String(offset) } });
}

export async function esp32Start(id: string, token: string): Promise<void> {
  if (!isDesktop) throw new Error(WEB.detail);
  await invoke('esp32_start', { id, token });
}

export async function esp32Send(id: string, lines: readonly string[]): Promise<void> {
  if (isDesktop && lines.length) await invoke('esp32_send', { id, lines });
}

export async function esp32Stop(id: string): Promise<void> {
  if (isDesktop) await invoke('esp32_stop', { id });
}

export function onEsp32Lines(handler: (id: string, lines: readonly string[]) => void): Promise<UnlistenFn> {
  if (!isDesktop) return Promise.resolve(() => undefined);
  return listen<{ id: string; lines: string[] }>('esp32-lines', (event) => handler(event.payload.id, event.payload.lines));
}

export interface ArduinoInfo {
  readonly path: string | null;
  readonly version: string;
  readonly cores: readonly { readonly id: string; readonly version: string }[];
}

export async function arduinoInfo(): Promise<ArduinoInfo> {
  if (!isDesktop) return { path: null, version: '', cores: [] };
  return invoke<ArduinoInfo>('arduino_info');
}

export interface CompileResult {
  readonly ok: boolean;
  readonly log: string;
  /** Intel HEX, for the Uno. */
  readonly hex?: string;
  /** A prepared ESP32 flash image, for esp32Start. */
  readonly token?: string;
  readonly size?: number;
}

export async function arduinoCompile(board: 'uno' | 'esp32', sketch: string): Promise<CompileResult> {
  if (!isDesktop) throw new Error('Compiling sketches needs the desktop app and arduino-cli (or Arduino IDE 2).');
  return invoke<CompileResult>('arduino_compile', { board, sketch });
}
