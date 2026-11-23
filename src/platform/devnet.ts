/** Servers and network clients on the desktop side: serve.rs, wsclient.rs and grpc.rs. */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isDesktop } from './index';

const need = (what: string) => {
  if (!isDesktop) throw new Error(`${what} needs the desktop app.`);
};

/* ---------------------------------------------------------------- servers -- */

export interface MockRoute {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string;
  readonly delayMs: number;
}

export interface ServeConfig {
  readonly kind: 'mock' | 'files' | 'webhook' | 'speed';
  readonly lan: boolean;
  readonly port: number;
  readonly cors: boolean;
  readonly routes?: readonly MockRoute[];
  readonly folder?: string;
  readonly uploads?: boolean;
  readonly password?: string;
}

export interface ServeStarted {
  readonly port: number;
  readonly urls: readonly string[];
}

export interface ServeRequest {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly ms: number;
  readonly from: string;
  readonly headers?: readonly (readonly [string, string])[];
  readonly body?: string;
  readonly size?: number;
}

export async function startServer(id: string, config: ServeConfig): Promise<ServeStarted> {
  need('Running a server');
  return invoke<ServeStarted>('serve_start', { id, config: { routes: [], folder: '', uploads: false, password: '', ...config } });
}

export async function stopServer(id: string): Promise<void> {
  if (isDesktop) await invoke('serve_stop', { id });
}

export function onServerRequest(handler: (r: ServeRequest) => void): Promise<UnlistenFn> {
  if (!isDesktop) return Promise.resolve(() => undefined);
  return listen<ServeRequest>('serve-request', (event) => handler(event.payload));
}

/* -------------------------------------------------------- WebSocket, SSE -- */

export interface WsConnected {
  readonly status: number;
  readonly protocol: string | null;
  readonly headers: readonly (readonly [string, string])[];
}

export interface WsEvent {
  readonly id: string;
  readonly kind: 'text' | 'binary' | 'ping' | 'pong' | 'close' | 'error' | 'ended' | 'sse';
  readonly data: string;
  readonly size?: number;
  readonly event?: string;
  readonly eventId?: string;
  readonly at: number;
}

export async function wsConnect(id: string, url: string, headers: readonly (readonly [string, string])[], protocols: readonly string[], insecure: boolean): Promise<WsConnected> {
  need('WebSocket connections');
  return invoke<WsConnected>('ws_connect', { id, url, headers, protocols, insecure });
}

export async function wsSend(id: string, message: { text?: string; binary?: string }): Promise<void> {
  need('WebSocket connections');
  await invoke('ws_send', { id, text: message.text ?? null, binary: message.binary ?? null });
}

export async function wsClose(id: string): Promise<void> {
  if (isDesktop) await invoke('ws_close', { id, code: 1000, reason: 'Closed in Benchtop' });
}

export async function sseConnect(id: string, url: string, headers: readonly (readonly [string, string])[]): Promise<number> {
  need('Server-sent events');
  return invoke<number>('sse_connect', { id, url, headers });
}

export async function sseClose(id: string): Promise<void> {
  if (isDesktop) await invoke('sse_close', { id });
}

export function onWsEvent(handler: (e: WsEvent) => void): Promise<UnlistenFn> {
  if (!isDesktop) return Promise.resolve(() => undefined);
  return listen<WsEvent>('ws-event', (event) => handler(event.payload));
}

/* ------------------------------------------------------------------- gRPC -- */

export interface GrpcMethod {
  readonly name: string;
  readonly input: string;
  readonly output: string;
  readonly clientStreaming: boolean;
  readonly serverStreaming: boolean;
  readonly template: string;
}

export interface GrpcService {
  readonly name: string;
  readonly methods: readonly GrpcMethod[];
}

export interface GrpcDescribed {
  readonly pool: string;
  readonly services: readonly GrpcService[];
}

export interface GrpcTarget {
  readonly address: string;
  readonly tls: boolean;
  readonly insecure: boolean;
  readonly metadata: readonly (readonly [string, string])[];
  readonly deadlineMs: number;
}

export interface GrpcResult {
  readonly code: number;
  readonly status: string;
  readonly message: string;
  readonly responses: readonly unknown[];
  readonly headers: readonly (readonly [string, string])[];
  readonly trailers: readonly (readonly [string, string])[];
  readonly ms: number;
}

export async function grpcCompile(files: readonly { name: string; text: string }[]): Promise<GrpcDescribed> {
  need('gRPC');
  return invoke<GrpcDescribed>('grpc_compile', { files });
}

export async function grpcReflect(target: GrpcTarget): Promise<GrpcDescribed> {
  need('gRPC');
  return invoke<GrpcDescribed>('grpc_reflect', { target });
}

export async function grpcCall(pool: string, service: string, method: string, request: string, target: GrpcTarget): Promise<GrpcResult> {
  need('gRPC');
  return invoke<GrpcResult>('grpc_call', { pool, service, method, request, target });
}
