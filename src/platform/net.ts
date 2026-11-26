/**
 * The network, for the tools in the "Online checks" category only.
 *
 * The web view cannot open connections itself (its content security policy
 * allows no remote origin).  These calls ask the desktop shell to make one
 * request each: an HTTP request, a TLS handshake, a DNS query, a WHOIS query or
 * a TCP connection test.  Everything else (following redirects, parsing,
 * judging the results) happens in TypeScript so it can be unit-tested with a
 * fake transport.
 */
import { invoke } from '@tauri-apps/api/core';
import { getSettings } from '../app/store';
import { errorMessage, ToolError } from '../lib/errors';
import { isDesktop } from './index';

export interface HttpRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: readonly (readonly [string, string])[];
  readonly body?: string;
  /** A binary body, Base64 (sent instead of `body`). */
  readonly bodyBase64?: string;
  readonly timeoutMs?: number;
  /** Largest body to return, in bytes (the shell caps it at 8 MB). */
  readonly maxBody?: number;
  /** Finish the request even when the certificate is not trusted. */
  readonly insecure?: boolean;
}

export interface HttpResponse {
  readonly url: string;
  readonly status: number;
  readonly reason: string;
  readonly version: string;
  /** Header names are lower case, in the order received. */
  readonly headers: readonly (readonly [string, string])[];
  /** The body as received (not decompressed), Base64. */
  readonly body: string;
  readonly bodySize: number;
  readonly truncated: boolean;
  readonly remoteAddr: string | null;
  readonly headersMs: number;
  readonly elapsedMs: number;
  /** The leaf certificate (DER, Base64) for HTTPS. */
  readonly peerCertificate: string | null;
}

export interface TlsRequest {
  readonly host: string;
  readonly port?: number;
  readonly serverName?: string;
  /** Allow only TLS 1.2 or only TLS 1.3. */
  readonly version?: '1.2' | '1.3';
  readonly timeoutMs?: number;
}

export interface TlsResponse {
  readonly address: string;
  readonly proxy: string | null;
  readonly protocol: string;
  readonly cipher: string;
  readonly alpn: string | null;
  /** Certificates as sent by the server, leaf first (DER, Base64). */
  readonly chain: readonly string[];
  readonly trusted: boolean;
  readonly trustError: string | null;
  readonly ocspStapled: boolean;
  readonly elapsedMs: number;
}

export interface DnsRequest {
  readonly name: string;
  readonly recordType: string;
  /** "system", an IP address (optionally with a port) or an https:// DNS-over-HTTPS URL. */
  readonly server: string;
  readonly transport?: 'udp' | 'tcp';
  readonly dnssec?: boolean;
  readonly recursion?: boolean;
  readonly timeoutMs?: number;
}

export interface DnsRecord {
  readonly name: string;
  readonly recordType: string;
  readonly class: string;
  readonly ttl: number;
  readonly data: string;
}

export interface DnsResponse {
  readonly server: string;
  readonly transport: string;
  readonly rcode: number;
  readonly rcodeText: string;
  readonly flags: { readonly aa: boolean; readonly tc: boolean; readonly rd: boolean; readonly ra: boolean; readonly ad: boolean; readonly cd: boolean };
  readonly answers: readonly DnsRecord[];
  readonly authority: readonly DnsRecord[];
  readonly additional: readonly DnsRecord[];
  readonly size: number;
  readonly elapsedMs: number;
}

export interface WhoisRequest {
  readonly server: string;
  readonly query: string;
  readonly port?: number;
  readonly timeoutMs?: number;
}

export interface WhoisResponse {
  readonly server: string;
  readonly text: string;
  readonly truncated: boolean;
  readonly elapsedMs: number;
}

export interface ProbeRequest {
  readonly host: string;
  readonly ports: readonly number[];
  readonly timeoutMs?: number;
}

export interface ProbeResult {
  readonly port: number;
  readonly state: 'open' | 'closed' | 'filtered' | 'error';
  readonly elapsedMs: number;
  readonly message: string | null;
}

export interface ProbeResponse {
  readonly address: string;
  readonly results: readonly ProbeResult[];
}

export interface NetTransport {
  http(request: HttpRequest): Promise<HttpResponse>;
  tls(request: TlsRequest): Promise<TlsResponse>;
  dns(request: DnsRequest): Promise<DnsResponse>;
  whois(request: WhoisRequest): Promise<WhoisResponse>;
  probe(request: ProbeRequest): Promise<ProbeResponse>;
}

/** A failed request.  `kind` is one of: invalid, dns, connect, refused, timeout, tls, proxy, http, offline. */
export class NetError extends ToolError {
  readonly kind: string;

  constructor(kind: string, message: string) {
    super(message);
    this.name = 'NetError';
    this.kind = kind;
  }
}

const isShellError = (value: unknown): value is { kind: string; message: string } =>
  value !== null && typeof value === 'object' && typeof (value as { kind?: unknown }).kind === 'string' && typeof (value as { message?: unknown }).message === 'string';

async function call<T>(command: string, request: object): Promise<T> {
  try {
    return await invoke<T>(command, { request });
  } catch (error) {
    if (isShellError(error)) throw new NetError(error.kind, error.message);
    throw new NetError('offline', errorMessage(error));
  }
}

const desktopTransport: NetTransport = {
  http: (request) => call('net_http', request),
  tls: (request) => call('net_tls', request),
  dns: (request) => call('net_dns', request),
  whois: (request) => call('net_whois', request),
  probe: (request) => call('net_tcp_probe', request),
};

let override: NetTransport | null = null;

/** A stand-in network the end-to-end tests may set in a browser (never consulted in the desktop app). */
const testTransport = (): NetTransport | null => (isDesktop ? null : ((globalThis as { __benchtopNetTransport?: NetTransport }).__benchtopNetTransport ?? null));

/** Replaces the transport (unit tests).  Pass `null` to restore the desktop one. */
export function setNetTransport(transport: NetTransport | null): void {
  override = transport;
}

/** Whether the online checks can run here, and why not. */
export function networkStatus(): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (override !== null || testTransport() !== null) return { ok: true };
  if (!isDesktop) return { ok: false, reason: 'Online checks need the Benchtop desktop app. In a browser every tool works offline and nothing here can contact other hosts.' };
  if (!getSettings().allowNetwork) return { ok: false, reason: 'Online checks are turned off. Turn on "Allow online checks" in Settings to use this tool.' };
  return { ok: true };
}

/** Whether an address points at this computer (127.0.0.0/8, ::1 or localhost). */
export function isLoopback(address: string): boolean {
  try {
    const host = new URL(address).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(\.\d{1,3}){3}$/.test(host);
  } catch {
    return false;
  }
}

/**
 * The transport for a request to `address`.  A program on this computer (such as the
 * IndicTrans2 or Ollama server for Video Dubbing) is not an online check, so it is
 * allowed even with "Allow online checks" off; anything else goes through net().
 */
export function netFor(address: string): NetTransport {
  if (override !== null) return override;
  const stand = testTransport();
  if (stand !== null) return stand;
  if (isLoopback(address)) {
    if (!isDesktop) throw new ToolError('Talking to a program on this computer needs the Benchtop desktop app.');
    return desktopTransport;
  }
  return net();
}

/** The transport to use, or a ToolError explaining why the network is not available. */
export function net(): NetTransport {
  const status = networkStatus();
  if (!status.ok) throw new ToolError(status.reason);
  return override ?? testTransport() ?? desktopTransport;
}

/** Runs `work` over `items` with at most `limit` running at once, keeping the input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Settles a promise into a value or the error's message, for tables where one failure must not stop the rest. */
export async function settle<T>(promise: Promise<T>): Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string; readonly kind: string }> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error: errorMessage(error), kind: error instanceof NetError ? error.kind : 'error' };
  }
}
