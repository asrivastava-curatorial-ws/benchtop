/** Local network tools on the desktop side (lan.rs): device scan, port check, Wake-on-LAN and speed test. */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isDesktop } from './index';

const need = (what: string) => {
  if (!isDesktop) throw new Error(`${what} needs the desktop app.`);
};

export interface LanInfo {
  readonly address: string | null;
  readonly cidr: string | null;
}

export interface LanHost {
  readonly ip: string;
  readonly mac: string | null;
  readonly name: string | null;
  readonly open: readonly number[];
  readonly rtt: number | null;
  readonly thisComputer: boolean;
}

export interface PortState {
  readonly port: number;
  readonly state: 'open' | 'closed' | 'filtered';
}

export interface SpeedResult {
  readonly latencyMs: number;
  readonly downloadMbps: number;
  readonly uploadMbps: number;
  readonly megabytes: number;
}

export async function lanInfo(): Promise<LanInfo> {
  if (!isDesktop) return { address: null, cidr: null };
  return invoke<LanInfo>('lan_info');
}

export async function scanLan(id: string, range: string, ports: readonly number[] = []): Promise<LanHost[]> {
  need('Scanning the network');
  return invoke<LanHost[]>('lan_scan', { id, range, ports });
}

export async function cancelScan(id: string): Promise<void> {
  if (isDesktop) await invoke('lan_cancel', { id });
}

export function onLanHost(handler: (id: string, host: LanHost) => void): Promise<UnlistenFn> {
  if (!isDesktop) return Promise.resolve(() => undefined);
  return listen<{ id: string; host: LanHost }>('lan-host', (event) => handler(event.payload.id, event.payload.host));
}

export function onLanProgress(handler: (id: string, done: number, total: number) => void): Promise<UnlistenFn> {
  if (!isDesktop) return Promise.resolve(() => undefined);
  return listen<{ id: string; done: number; total: number }>('lan-progress', (event) => handler(event.payload.id, event.payload.done, event.payload.total));
}

export async function checkPorts(host: string, ports: readonly number[], timeoutMs = 800): Promise<PortState[]> {
  need('Checking ports');
  return invoke<PortState[]>('lan_ports', { host, ports, timeoutMs });
}

export async function wakeOnLan(mac: string, broadcast?: string, port?: number): Promise<void> {
  need('Wake-on-LAN');
  await invoke('lan_wake', { mac, broadcast: broadcast || null, port: port ?? null });
}

export async function speedTest(address: string, seconds = 6): Promise<SpeedResult> {
  need('The speed test');
  return invoke<SpeedResult>('lan_speed', { address, seconds });
}
