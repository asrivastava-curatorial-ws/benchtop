/**
 * Asset Finder's connector list as the user has shaped it: which libraries are
 * on, their address settings, edited code and connectors of their own.  Kept
 * in browser storage (keys are not: the desktop shell keeps those in a file
 * only this user can read).
 */
import { BUILTIN_CONNECTORS, builtinCode } from './builtin';
import { MAX_CONNECTOR_SOURCE } from './runtime';

const STORAGE_KEY = 'benchtop.assets.v1';

export interface ConnectorRecord {
  readonly id: string;
  /** Edited or custom code; null for a built-in connector as shipped. */
  readonly code: string | null;
  readonly enabled: boolean;
  /** Address and other settings that differ from the connector's own. */
  readonly settings: Readonly<Record<string, string>>;
  /** Made or imported by the user (removable; nothing to reset to). */
  readonly custom: boolean;
}

export const codeOf = (record: ConnectorRecord): string => record.code ?? builtinCode(record.id) ?? '';
export const isEdited = (record: ConnectorRecord): boolean => !record.custom && record.code !== null && record.code !== builtinCode(record.id);

const cleanSettings = (raw: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw as object)) if (/^[A-Za-z][\w-]{0,40}$/.test(k) && typeof v === 'string') out[k] = v.slice(0, 500);
  return out;
};

/** The stored list, with built-in connectors added in their place (new ones in a later version appear too). */
export function loadConnectors(): ConnectorRecord[] {
  let stored: unknown[] = [];
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { connectors?: unknown };
    if (Array.isArray(raw.connectors)) stored = raw.connectors;
  } catch {}
  const out: ConnectorRecord[] = [];
  for (const entry of stored) {
    if (!entry || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id : '';
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id) || out.some((c) => c.id === id)) continue;
    const builtin = builtinCode(id) !== undefined;
    const code = typeof r.code === 'string' && r.code.length <= MAX_CONNECTOR_SOURCE ? r.code : null;
    if (!builtin && code === null) continue;
    out.push({ id, code: builtin && code === builtinCode(id) ? null : code, enabled: r.enabled !== false, settings: cleanSettings(r.settings), custom: !builtin });
  }
  BUILTIN_CONNECTORS.forEach((c, index) => {
    if (out.some((r) => r.id === c.id)) return;
    // Put a newly shipped connector after the built-in one before it.
    const before = BUILTIN_CONNECTORS.slice(0, index)
      .map((b) => out.findIndex((r) => r.id === b.id))
      .filter((i) => i >= 0);
    out.splice(before.length ? Math.max(...before) + 1 : 0, 0, { id: c.id, code: null, enabled: true, settings: {}, custom: false });
  });
  return out;
}

export function saveConnectors(records: readonly ConnectorRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, connectors: records }));
  } catch {
    throw new Error('The connectors could not be saved: browser storage is full or turned off.');
  }
}

/** A file with connectors and their settings, to keep or share (never keys). */
export function exportConnectors(records: readonly ConnectorRecord[]): string {
  return `${JSON.stringify({ benchtopConnectors: 1, connectors: records.map((r) => ({ id: r.id, code: codeOf(r), enabled: r.enabled, settings: r.settings })) }, null, 2)}\n`;
}

/** Reads an exported file, or a single connector's JavaScript, into code and settings to add. */
export function parseImport(text: string): { code: string; settings: Record<string, string>; enabled: boolean }[] {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      throw new Error('That file is not valid JSON.');
    }
    const list = (data as { connectors?: unknown }).connectors;
    if (!Array.isArray(list)) throw new Error('That JSON file has no "connectors" list.');
    return list
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object' && typeof (c as Record<string, unknown>).code === 'string')
      .map((c) => ({ code: String(c.code).slice(0, MAX_CONNECTOR_SOURCE), settings: cleanSettings(c.settings), enabled: c.enabled !== false }));
  }
  if (!/export\s+const\s+source\b/.test(trimmed)) throw new Error('That file is not a connector: it has no "export const source".');
  if (trimmed.length > MAX_CONNECTOR_SOURCE) throw new Error('A connector can be at most 512 KB.');
  return [{ code: trimmed, settings: {}, enabled: true }];
}

/** A connector to start from: it works offline at once, and shows how to ask a library's API. */
export function connectorTemplate(id: string): string {
  return `/**
 * My library: a connector you can change.  It runs in a worker of its own, without network
 * access: ask for data with ctx.get(url, { query, headers }) and the app makes the request,
 * but only to the hosts listed in source.hosts (and the hosts of URL settings).
 * Every field and call: docs/ASSET-CONNECTORS.md in Benchtop's source.
 */
export const source = {
  id: '${id}',
  name: 'My library',
  about: 'What this library has, in a sentence.',
  homepage: 'https://example.org',
  terms: 'https://example.org/terms',
  types: ['image'], // image, video, video3d, audio, text, model, texture, icon, font
  hosts: [], // for example 'api.example.org'
  settings: {}, // for example { api: 'https://api.example.org/v1' }
  keys: [], // for example [{ id: 'key', label: 'API key', optional: false, help: 'Where to get it.' }]
  signup: '',
};

const LIST = [
  { id: 'demo-1', title: 'A public-domain picture', creator: 'Unknown', licence: 'CC0', thumb: '', page: 'https://example.org/demo-1' },
];

export async function search(q, ctx) {
  // With an API instead of a list:
  //   const r = await ctx.get(ctx.setting('api') + '/search', { query: { q: q.text, page: q.page }, headers: { Authorization: ctx.key('key') } });
  //   return { items: r.results.map((x) => ({ id: x.id, title: x.title, licenceUrl: x.license_url, thumb: x.thumbnail })), more: !!r.next };
  const words = q.text.toLowerCase().split(/\\s+/).filter(Boolean);
  const items = LIST.filter((x) => words.every((w) => x.title.toLowerCase().includes(w))).map((x) => ({ ...x, type: 'image', extra: {} }));
  return { items, total: items.length, more: false };
}

export async function files(item, ctx) {
  // Each file: { label, url, name, size?, md5?, sha256?, original?, unzip?, headers? }, or { label, text, name } for text made here.
  return [{ label: 'About this item', text: item.title + '\\n' + item.page + '\\n', name: 'about.txt' }];
}
`;
}
