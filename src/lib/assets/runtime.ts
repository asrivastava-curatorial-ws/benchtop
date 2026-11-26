/**
 * Runs a library connector: a JavaScript file that knows one library's API.
 *
 * Each connector runs in a worker of its own with the network, storage and
 * other workers taken away (as plugins do).  It asks for data through
 * `ctx.get()` and friends; the page checks each request (https only, only to
 * the hosts the connector declares or its address settings name, a limited
 * number per search) and makes it through the desktop shell, then hands the
 * answer back.  So a connector can be edited, or written from scratch, in the
 * app without being able to reach anything else.
 *
 *   export const source = { id: 'example', name: 'Example', types: ['image'], hosts: ['api.example.org'] };
 *   export async function search(q, ctx) {
 *     const r = await ctx.get('https://api.example.org/search', { query: { q: q.text, page: q.page } });
 *     return { items: r.results.map((x) => ({ id: x.id, title: x.title, licence: x.licence_url, thumb: x.thumb })), more: !!r.next };
 *   }
 *   export async function files(item, ctx) { return [{ label: 'Original', url: item.extra.url, name: 'original.jpg' }]; }
 */
import { gunzipSync, inflateSync } from 'fflate';
import { errorMessage } from '../errors';
import { toScript } from '../plugins';
import { type AssetQuery, type AssetType, isAssetType } from './model';

export interface KeySpec {
  readonly id: string;
  readonly label: string;
  readonly optional: boolean;
  readonly help: string;
}

export interface ConnectorMeta {
  readonly id: string;
  readonly name: string;
  readonly about: string;
  readonly homepage: string;
  readonly terms: string;
  readonly types: readonly AssetType[];
  readonly hosts: readonly string[];
  /** Addresses and other values the user may change without editing code. */
  readonly settings: Readonly<Record<string, string>>;
  readonly keys: readonly KeySpec[];
  /** Where to get a key. */
  readonly signup: string;
  /** Its assets are under a stock-library licence (Pexels, Pixabay, Unsplash): asked only when stock licences are on. */
  readonly stock: boolean;
}

export interface RequestEntry {
  readonly method: string;
  /** With keys and tokens hidden. */
  readonly url: string;
  readonly status: number;
  readonly ms: number;
  readonly bytes: number;
  readonly error?: string;
  readonly cached?: boolean;
}

export interface Transport {
  /** One request through the desktop shell (or a test double); the body comes back as bytes. */
  request(request: { url: string; method: string; headers: [string, string][]; body?: string; timeoutMs: number }): Promise<{
    status: number;
    headers: readonly (readonly [string, string])[];
    body: Uint8Array;
  }>;
}

export interface CallContext {
  readonly keys: Readonly<Record<string, string>>;
  readonly settings: Readonly<Record<string, string>>;
}

export interface SearchReply {
  readonly items: unknown[];
  readonly total?: number;
  readonly more: boolean;
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}

export const MAX_CONNECTOR_SOURCE = 512 * 1024;
const REQUESTS_PER_CALL = 60;
const CALL_TIMEOUT_MS = 90_000;
const REQUEST_TIMEOUT_MS = 30_000;
const PARALLEL_REQUESTS = 6;
const IDLE_MS = 60_000;
/** Answers kept for `cache` seconds, shared by every search. */
const answers = new Map<string, { at: number; status: number; headers: [string, string][]; text: string }>();

const BLOCKED = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'indexedDB', 'caches', 'BroadcastChannel', 'importScripts', 'Worker', 'SharedWorker', 'RTCPeerConnection'];

/** The worker's script before the connector's own code. */
const PREAMBLE = `const __post = self.postMessage.bind(self);
const __strip = (target, name) => { try { for (let o = target; o; o = Object.getPrototypeOf(o)) if (Object.prototype.hasOwnProperty.call(o, name)) delete o[name]; } catch {} };
for (const name of ${JSON.stringify(BLOCKED)}) __strip(self, name);
if (self.navigator) __strip(self.navigator, 'storage');
let __keys = {}, __settings = {}, __call = 0, __rid = 0;
const __waiting = new Map();
const __entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', copy: '©' };
const __decodeEntities = (s) => String(s).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (__entities[e.toLowerCase()] ?? m));
const __withQuery = (url, query) => {
  if (!query) return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    for (const one of Array.isArray(v) ? v : [v]) u.searchParams.append(k, String(one));
  }
  return u.toString();
};
const __fetch = (url, o = {}) => new Promise((resolve, reject) => {
  const headers = Object.entries(o.headers || {}).map(([k, v]) => [k, String(v)]);
  let body;
  if (o.form) { body = new URLSearchParams(Object.entries(o.form).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString(); headers.push(['Content-Type', 'application/x-www-form-urlencoded']); }
  else if (o.json !== undefined) { body = JSON.stringify(o.json); headers.push(['Content-Type', 'application/json']); }
  else if (typeof o.body === 'string') body = o.body;
  const rid = ++__rid;
  __waiting.set(rid, { resolve, reject });
  __post({ kind: 'request', call: __call, rid, url: __withQuery(String(url), o.query), method: (o.method || 'GET').toUpperCase(), headers, body, cache: Number(o.cache) || 0 });
});
const __read = (r, as, url) => {
  const host = (() => { try { return new URL(url).host; } catch { return 'The library'; } })();
  if (r.status >= 400) throw new Error(host + ' answered ' + r.status + (r.text ? ': ' + __decodeEntities(r.text.replace(/<[^>]*>/g, ' ')).replace(/\\s+/g, ' ').trim().slice(0, 160) : ''));
  if (as === 'raw') return r;
  if (as === 'text') return r.text;
  try { return JSON.parse(r.text); } catch { throw new Error(host + ' did not answer with JSON (it began: ' + r.text.slice(0, 60).replace(/\\s+/g, ' ') + ')'); }
};
const ctx = Object.freeze({
  get: (url, o = {}) => __fetch(url, { ...o, method: 'GET' }).then((r) => __read(r, o.as || 'json', url)),
  post: (url, o = {}) => __fetch(url, { ...o, method: 'POST' }).then((r) => __read(r, o.as || 'json', url)),
  request: (url, o = {}) => __fetch(url, o),
  key: (name) => String(__keys[name] || ''),
  setting: (name) => String(__settings[name] ?? ''),
  text: (html, max) => { const t = __decodeEntities(String(html ?? '').replace(/<(br|\\/p|\\/div|\\/li)[^>]*>/gi, '\\n').replace(/<[^>]*>/g, '')).replace(/[ \\t]+/g, ' ').replace(/\\n\\s*\\n+/g, '\\n').trim(); return max ? t.slice(0, max) : t; },
  clip: (s, n) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; },
  https: (u) => { const s = String(u ?? '').trim(); return s.startsWith('//') ? 'https:' + s : s.replace(/^http:\\/\\//, 'https://'); },
  year: (s) => { const m = /\\b(1[0-9]{3}|20[0-9]{2})\\b/.exec(String(s ?? '')); return m ? Number(m[1]) : undefined; },
  log: (...parts) => __post({ kind: 'log', call: __call, text: parts.map((p) => typeof p === 'string' ? p : JSON.stringify(p)).join(' ').slice(0, 2000) }),
  mapLimit: async (items, limit, fn) => { const out = new Array(items.length); let next = 0; await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => { while (next < items.length) { const i = next++; try { out[i] = await fn(items[i], i); } catch (e) { out[i] = undefined; ctx.log('Skipped one: ' + (e && e.message ? e.message : e)); } } })); return out; },
});
`;

const PREAMBLE_LINES = PREAMBLE.split('\n').length - 1;

const FOOTER = `
;const __api = { source: typeof source === 'object' && source ? source : null, search: typeof search === 'function' ? search : null, files: typeof files === 'function' ? files : null, prepare: typeof prepare === 'function' ? prepare : null };
self.onmessage = async (event) => {
  const m = event.data || {};
  if (m.kind === 'response') {
    const w = __waiting.get(m.rid);
    if (!w) return;
    __waiting.delete(m.rid);
    if (m.ok) w.resolve({ status: m.status, headers: Object.fromEntries(m.headers), text: m.text }); else w.reject(new Error(m.error));
    return;
  }
  __call = m.call; __keys = m.keys || {}; __settings = m.settings || {};
  const line = (e) => { const s = e && e.stack ? String(e.stack) : ''; const found = /:(\\d+):\\d+\\)?\\s*$/m.exec(s.split('\\n').find((l) => /blob:|<anonymous>/.test(l)) || ''); return found ? Number(found[1]) : undefined; };
  try {
    if (!__api.source) throw new Error('The connector does not export "source" (export const source = { id, name, types, hosts }).');
    let value;
    if (m.kind === 'describe') value = JSON.parse(JSON.stringify(__api.source));
    else if (m.kind === 'search') {
      if (!__api.search) throw new Error('The connector has no search(query, ctx) function.');
      value = await __api.search(m.query, ctx);
      value = JSON.parse(JSON.stringify(value === undefined ? { items: [] } : value));
    } else if (m.kind === 'files') {
      value = __api.files ? await __api.files(m.item, ctx) : (m.item && m.item.files) || [];
      value = JSON.parse(JSON.stringify(value || []));
    } else if (m.kind === 'prepare') {
      value = __api.prepare ? await __api.prepare(m.item, m.file, ctx) : m.file;
      value = JSON.parse(JSON.stringify(value || m.file));
    }
    __post({ kind: 'result', call: m.call, ok: true, value });
  } catch (e) {
    __post({ kind: 'result', call: m.call, ok: false, error: e && e.message ? String(e.message) : String(e), line: line(e) });
  }
};
`;

/** The worker's whole script, and the line the connector's own first line lands on. */
export function harness(code: string): { script: string; firstLine: number } {
  if (code.length > MAX_CONNECTOR_SOURCE) throw new ConnectorError('A connector can be at most 512 KB.');
  return { script: `${PREAMBLE}${toScript(code)}${FOOTER}`, firstLine: PREAMBLE_LINES + 1 };
}

const SECRET_PARAM = /key|token|secret|client_id|wskey|apikey|password|auth/i;

/** The address with keys and tokens hidden (by parameter name, and any of `secrets` wherever it appears), for the request log. */
export function redact(url: string, secrets: readonly string[] = []): string {
  let out = url;
  try {
    const u = new URL(url);
    for (const name of [...u.searchParams.keys()]) if (SECRET_PARAM.test(name)) u.searchParams.set(name, '•••');
    out = decodeURI(u.toString());
  } catch {}
  for (const secret of secrets) if (secret.length >= 4) out = out.split(secret).join('•••').split(encodeURIComponent(secret)).join('•••');
  return out;
}

/** The hosts a connector may ask: the ones it lists ("*.example.org" for every sub-domain) and those in its address settings. */
export function allowedHosts(meta: Pick<ConnectorMeta, 'hosts' | 'settings'>, settings: Readonly<Record<string, string>> = {}): string[] {
  const out = new Set(meta.hosts.map((h) => h.toLowerCase()));
  for (const value of Object.values({ ...meta.settings, ...settings })) {
    try {
      if (/^https?:\/\//.test(value)) out.add(new URL(value).hostname.toLowerCase());
    } catch {}
  }
  return [...out];
}

export function hostAllowed(url: string, hosts: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const local = host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) return false;
  return hosts.some((h) => (h.startsWith('*.') ? host === h.slice(2) || host.endsWith(h.slice(1)) : host === h));
}

/** Turns what a connector declared into metadata the app can rely on. */
export function cleanMeta(raw: unknown): ConnectorMeta {
  if (!raw || typeof raw !== 'object') throw new ConnectorError('"source" must be an object.');
  const s = raw as Record<string, unknown>;
  const text = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const id = text(s.id, 41);
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) throw new ConnectorError('"source.id" must be 2–41 lower-case letters, digits or dashes.');
  const types = Array.isArray(s.types) ? s.types.filter(isAssetType) : [];
  if (types.length === 0) throw new ConnectorError('"source.types" must list at least one kind: image, video, video3d, audio, text, model, texture, icon or font.');
  const hosts = Array.isArray(s.hosts) ? s.hosts.map((h) => text(h, 120).toLowerCase()).filter((h) => /^(\*\.)?[a-z0-9.-]+$/.test(h)) : [];
  const settings: Record<string, string> = {};
  if (s.settings && typeof s.settings === 'object')
    for (const [k, v] of Object.entries(s.settings as object)) if (/^[A-Za-z][\w-]{0,40}$/.test(k) && typeof v === 'string') settings[k] = v.slice(0, 500);
  const keys = (Array.isArray(s.keys) ? s.keys : [])
    .filter((k): k is Record<string, unknown> => !!k && typeof k === 'object' && /^[A-Za-z][\w-]{0,40}$/.test(String((k as Record<string, unknown>).id)))
    .map((k) => ({ id: String(k.id), label: text(k.label, 80) || String(k.id), optional: k.optional === true, help: text(k.help, 400) }));
  return {
    id,
    name: text(s.name, 60) || id,
    about: text(s.about, 400),
    homepage: text(s.homepage),
    terms: text(s.terms),
    types,
    hosts,
    settings,
    keys,
    signup: text(s.signup),
    stock: s.stock === true,
  };
}

const decoder = new TextDecoder();

function bodyText(body: Uint8Array, headers: readonly (readonly [string, string])[]): string {
  const encoding = headers.find(([k]) => k.toLowerCase() === 'content-encoding')?.[1]?.toLowerCase() ?? '';
  let bytes = body;
  try {
    if (encoding.includes('gzip') || (bytes[0] === 0x1f && bytes[1] === 0x8b)) bytes = gunzipSync(bytes);
    else if (encoding.includes('deflate')) bytes = inflateSync(bytes);
  } catch {}
  return decoder.decode(bytes);
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; requests: number; context: CallContext };

/** One connector's worker, kept while the connector is in use. */
export class ConnectorRunner {
  private worker: Worker | null = null;
  private url = '';
  private readonly pending = new Map<number, Pending>();
  private call = 0;
  private active = 0;
  private readonly queue: (() => void)[] = [];
  private meta: ConnectorMeta | null = null;
  private failure: ConnectorError | null = null;
  private readonly firstLine: number;
  private readonly codeLines: number;
  private readonly script: string;
  private idle: ReturnType<typeof setTimeout> | undefined;
  log: (entry: RequestEntry) => void = () => {};
  note: (text: string) => void = () => {};

  constructor(
    code: string,
    private readonly transport: () => Transport,
  ) {
    const built = harness(code);
    this.script = built.script;
    this.firstLine = built.firstLine;
    this.codeLines = code.split('\n').length;
  }

  private start(): Worker {
    if (this.worker) return this.worker;
    this.url = URL.createObjectURL(new Blob([this.script], { type: 'text/javascript' }));
    const worker = new Worker(this.url, { name: 'benchtop-connector' });
    worker.onmessage = (event) => void this.receive(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      const line = event.lineno ? event.lineno - this.firstLine + 1 : undefined;
      this.failure = new ConnectorError(`${event.message || 'The connector failed to load.'}${line && line > 0 ? ` (line ${line})` : ''}`, line);
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(this.failure);
      }
      this.pending.clear();
      this.stop();
    };
    this.worker = worker;
    return worker;
  }

  /** Stops the worker (a new one starts with the next call). */
  stop(): void {
    clearTimeout(this.idle);
    this.worker?.terminate();
    this.worker = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = '';
  }

  private run<T>(message: Record<string, unknown>, context: CallContext): Promise<T> {
    clearTimeout(this.idle);
    const worker = this.start();
    const call = ++this.call;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(call);
        reject(new ConnectorError('The library took more than 90 seconds; the search was stopped.'));
        this.stop();
      }, CALL_TIMEOUT_MS);
      this.pending.set(call, { resolve: resolve as (v: unknown) => void, reject, timer, requests: 0, context });
      worker.postMessage({ ...message, call, keys: context.keys, settings: context.settings });
    });
  }

  async describe(): Promise<ConnectorMeta> {
    if (this.meta) return this.meta;
    this.meta = cleanMeta(await this.run<unknown>({ kind: 'describe' }, { keys: {}, settings: {} }));
    return this.meta;
  }

  async search(query: AssetQuery, context: CallContext): Promise<SearchReply> {
    const value = await this.run<Record<string, unknown> | unknown[]>({ kind: 'search', query }, context);
    if (Array.isArray(value)) return { items: value, more: false };
    const items = Array.isArray(value?.items) ? value.items : [];
    const total = typeof value?.total === 'number' && Number.isFinite(value.total) ? value.total : undefined;
    return { items, ...(total !== undefined ? { total } : {}), more: value?.more === true };
  }

  async files(item: unknown, context: CallContext): Promise<unknown[]> {
    const value = await this.run<unknown>({ kind: 'files', item }, context);
    return Array.isArray(value) ? value : [];
  }

  /** The connector's last word on a file just before it is downloaded (a fresh link, a reported download). */
  async prepare(item: unknown, file: unknown, context: CallContext): Promise<unknown> {
    return this.run<unknown>({ kind: 'prepare', item, file }, context);
  }

  private async slot(): Promise<void> {
    if (this.active < PARALLEL_REQUESTS) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
  }

  private release(): void {
    this.active--;
    this.queue.shift()?.();
  }

  /**
   * Makes a request and follows up to five redirects, each only to an https address on one of the
   * connector's hosts.  Leaving the first host drops Authorization and any header carrying a key.
   */
  private async follow(first: { url: string; method: string; headers: [string, string][]; body?: string }, hosts: readonly string[], keys: readonly string[]) {
    let request = first;
    for (let hop = 0; ; hop++) {
      const response = await this.transport().request({ ...request, timeoutMs: REQUEST_TIMEOUT_MS });
      const location = response.headers.find(([k]) => k.toLowerCase() === 'location')?.[1];
      if (response.status < 300 || response.status >= 400 || response.status === 304 || !location) return response;
      if (hop >= 5) throw new Error(`More than five redirects, starting at ${redact(first.url, keys)}.`);
      const next = new URL(location, request.url).toString();
      if (!hostAllowed(next, hosts)) throw new Error(`Redirected to ${redact(next, keys)}, which is not https or not one of the connector's hosts (add its host to "hosts" if it should be allowed).`);
      const sameHost = new URL(next).host === new URL(request.url).host;
      const secret = (value: string) => keys.some((k) => k.length >= 6 && value.includes(k));
      const keep = sameHost ? request.headers : request.headers.filter(([k, v]) => k.toLowerCase() !== 'authorization' && k.toLowerCase() !== 'cookie' && !secret(v));
      const asGet = response.status === 303 || ((response.status === 301 || response.status === 302) && request.method === 'POST');
      request = asGet ? { url: next, method: 'GET', headers: keep.filter(([k]) => k.toLowerCase() !== 'content-type') } : { ...request, url: next, headers: keep };
    }
  }

  private async receive(m: Record<string, unknown>): Promise<void> {
    const call = Number(m.call);
    const pending = this.pending.get(call);
    if (m.kind === 'log') {
      this.note(redact(String(m.text ?? ''), pending ? Object.values(pending.context.keys) : []));
      return;
    }
    if (m.kind === 'result') {
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(call);
      // A worker with nothing to do for a minute is stopped (the next call starts another).
      if (this.pending.size === 0) {
        clearTimeout(this.idle);
        this.idle = setTimeout(() => this.pending.size === 0 && this.stop(), IDLE_MS);
      }
      if (m.ok) pending.resolve(m.value);
      else {
        const raw = typeof m.line === 'number' ? m.line - this.firstLine + 1 : undefined;
        const line = raw && raw > 0 && raw <= this.codeLines ? raw : undefined;
        pending.reject(new ConnectorError(`${redact(String(m.error ?? 'The connector failed.'), Object.values(pending.context.keys))}${line ? ` (line ${line})` : ''}`, line));
      }
      return;
    }
    if (m.kind !== 'request') return;
    const rid = Number(m.rid);
    const reply = (value: Record<string, unknown>) => this.worker?.postMessage({ kind: 'response', rid, ...value });
    const url = String(m.url ?? '');
    const method = String(m.method ?? 'GET');
    if (!pending) return reply({ ok: false, error: 'The search had already ended.' });
    const secrets = Object.values(pending.context.keys);
    const shown = redact(url, secrets);
    if (++pending.requests > REQUESTS_PER_CALL) return reply({ ok: false, error: `A connector may make at most ${REQUESTS_PER_CALL} requests per search.` });
    const meta = this.meta ?? (await this.describe().catch(() => null));
    const hosts = meta ? allowedHosts(meta, pending.context.settings) : [];
    if (!hostAllowed(url, hosts)) {
      const error = `Not asked: ${shown} is not https or not one of the connector's hosts (${hosts.join(', ') || 'none'}).`;
      this.log({ method, url: shown, status: 0, ms: 0, bytes: 0, error });
      return reply({ ok: false, error });
    }
    const cacheFor = Number(m.cache) || 0;
    const key = `${meta?.id ?? ''} ${method} ${url} ${String(m.body ?? '')}`;
    const kept = answers.get(key);
    if (cacheFor > 0 && method === 'GET' && kept && Date.now() - kept.at < cacheFor * 1000) {
      this.log({ method, url: shown, status: kept.status, ms: 0, bytes: kept.text.length, cached: true });
      return reply({ ok: true, status: kept.status, headers: kept.headers, text: kept.text });
    }
    await this.slot();
    const started = performance.now();
    try {
      const sent = Array.isArray(m.headers) ? (m.headers as [string, string][]).filter((h) => Array.isArray(h) && h.length === 2).map(([a, b]) => [String(a), String(b)] as [string, string]) : [];
      const response = await this.follow({ url, method, headers: sent, ...(typeof m.body === 'string' ? { body: m.body } : {}) }, hosts, Object.values(pending.context.keys));
      const text = bodyText(response.body, response.headers);
      const headers = response.headers.map(([k, v]) => [k.toLowerCase(), v] as [string, string]);
      this.log({ method, url: shown, status: response.status, ms: Math.round(performance.now() - started), bytes: response.body.length });
      if (cacheFor > 0 && method === 'GET' && response.status < 400) answers.set(key, { at: Date.now(), status: response.status, headers, text });
      reply({ ok: true, status: response.status, headers, text });
    } catch (error) {
      const message = redact(errorMessage(error), secrets);
      this.log({ method, url: shown, status: 0, ms: Math.round(performance.now() - started), bytes: 0, error: message });
      reply({ ok: false, error: message });
    } finally {
      this.release();
    }
  }
}

/** Forgets every kept answer (the Sources tab's "Clear cache"). */
export const clearAnswers = () => answers.clear();

/**
 * Whether a link a connector handed back (a thumbnail or a file) would carry one of its keys to a
 * host it does not list: a connector may use its keys only with its own library.
 */
export function leaksKey(url: string, keys: Readonly<Record<string, string>>, hosts: readonly string[]): boolean {
  if (hostAllowed(url, hosts)) return false;
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {}
  return Object.values(keys).some((k) => k.length >= 6 && (url.includes(k) || decoded.includes(k)));
}
