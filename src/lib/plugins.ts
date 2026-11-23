/**
 * Plugin tools: a JavaScript file that registers a text tool, run in a worker
 * of its own with the network, storage and other workers taken away.  A plugin
 * may embed WebAssembly (as Base64) and instantiate it inside run().
 *
 *   benchtop.register({
 *     name: 'Reverse lines',
 *     description: 'Last line first.',
 *     options: [{ key: 'trim', label: 'Trim spaces', type: 'toggle', default: true }],
 *     run(input, options) { return input.split('\n').reverse().join('\n'); },
 *   });
 *
 * `export default { … }` works too.
 */
import type { Lang, OptionDef } from '../tools/types';

export interface PluginRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly source: string;
  readonly added: number;
}

export interface PluginInfo {
  readonly name: string;
  readonly description: string;
  readonly options: OptionDef[];
  readonly sample: string;
  readonly language: Lang;
}

export interface PluginResult {
  readonly output: string;
  readonly info?: string;
  readonly language?: Lang;
}

export const MAX_PLUGIN_SOURCE = 2 * 1024 * 1024;
const STORAGE_KEY = 'benchtop.plugins.v1';
const LANGS: readonly Lang[] = ['text', 'json', 'javascript', 'typescript', 'jsx', 'html', 'css', 'xml', 'markdown', 'yaml', 'sql', 'cpp', 'python'];
const OPTION_TYPES = new Set(['select', 'segmented', 'toggle', 'number', 'range', 'text', 'color', 'heading']);

/** Globals a plugin must not reach: the network, the app's storage and other contexts. */
const BLOCKED = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'indexedDB', 'caches', 'BroadcastChannel', 'importScripts', 'Worker', 'SharedWorker', 'RTCPeerConnection'];

/** Turns ES module syntax a plugin may use into plain script, which is what a classic worker runs. */
export function toScript(source: string): string {
  if (/^\s*import\s[\s\S]*?from\s|^\s*import\s*['"]/m.test(source)) throw new Error('Plugins cannot import other files: put everything in one file.');
  return source.replace(/^(\s*)export\s+default\s+/m, '$1globalThis.__benchtopPlugin = ').replace(/^(\s*)export\s+(?=(async\s+)?function\b|const\b|let\b|var\b|class\b)/gm, '$1');
}

/** The script line the plugin's own first line lands on inside the harness. */
const PLUGIN_FIRST_LINE = 11;

/** The worker's whole script: the sandbox, the plugin, then the message handler. */
export function harness(source: string): string {
  return `const __post = self.postMessage.bind(self);
let __spec = null;
const __strip = (target, name) => {
  try {
    for (let o = target; o; o = Object.getPrototypeOf(o)) if (Object.prototype.hasOwnProperty.call(o, name)) delete o[name];
  } catch {}
};
for (const name of ${JSON.stringify(BLOCKED)}) __strip(self, name);
if (self.navigator) __strip(self.navigator, 'storage');
globalThis.benchtop = Object.freeze({ register(spec) { __spec = spec; } });
${toScript(source)}
;if (!__spec && globalThis.__benchtopPlugin) __spec = globalThis.__benchtopPlugin;
self.onmessage = async (event) => {
  const message = event.data || {};
  try {
    const spec = __spec;
    if (!spec || typeof spec.run !== 'function') throw new Error('The plugin registers no tool: call benchtop.register({ name, run }) or export default { name, run }.');
    if (message.kind === 'describe') {
      const options = JSON.parse(JSON.stringify(Array.isArray(spec.options) ? spec.options : []));
      __post({ ok: true, info: { name: String(spec.name || 'Plugin'), description: String(spec.description || ''), options, sample: typeof spec.sample === 'string' ? spec.sample : '', language: String(spec.language || 'text') } });
      return;
    }
    const result = await spec.run(String(message.input ?? ''), message.values || {});
    if (typeof result === 'string') __post({ ok: true, result: { output: result } });
    else if (result && typeof result === 'object') __post({ ok: true, result: { output: String(result.output ?? ''), info: result.info === undefined ? undefined : String(result.info), language: result.language === undefined ? undefined : String(result.language) } });
    else __post({ ok: true, result: { output: result === undefined || result === null ? '' : String(result) } });
  } catch (error) {
    __post({ ok: false, error: error && error.message ? String(error.message) : String(error) });
  }
};
`;
}

/** Keeps only option definitions the form can show, with defaults of the right type. */
export function cleanOptions(raw: unknown): OptionDef[] {
  if (!Array.isArray(raw)) return [];
  const out: OptionDef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const key = typeof o.key === 'string' ? o.key.trim() : '';
    const type = String(o.type);
    if (!key || !/^[A-Za-z_][\w-]*$/.test(key) || seen.has(key) || !OPTION_TYPES.has(type)) continue;
    seen.add(key);
    const label = typeof o.label === 'string' && o.label.trim() ? o.label : key;
    const help = typeof o.help === 'string' ? { help: o.help } : {};
    if (type === 'heading') out.push({ type: 'heading', key, label });
    else if (type === 'toggle') out.push({ type: 'toggle', key, label, default: o.default === true, ...help });
    else if (type === 'number' || type === 'range') {
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
      out.push({
        type,
        key,
        label,
        default: num(o.default) ?? 0,
        ...(num(o.min) !== undefined ? { min: num(o.min) } : {}),
        ...(num(o.max) !== undefined ? { max: num(o.max) } : {}),
        ...(num(o.step) !== undefined ? { step: num(o.step) } : {}),
        ...help,
      });
    } else if (type === 'select' || type === 'segmented') {
      const choices = (Array.isArray(o.choices) ? o.choices : [])
        .map((c) =>
          typeof c === 'string'
            ? { value: c, label: c }
            : c && typeof c === 'object'
              ? { value: String((c as Record<string, unknown>).value ?? ''), label: String((c as Record<string, unknown>).label ?? (c as Record<string, unknown>).value ?? '') }
              : null,
        )
        .filter((c): c is { value: string; label: string } => c !== null && c.value !== '');
      if (choices.length === 0) continue;
      const fallback = choices[0]?.value ?? '';
      const chosen = typeof o.default === 'string' && choices.some((c) => c.value === o.default) ? o.default : fallback;
      out.push({ type, key, label, choices, default: chosen, ...help });
    } else if (type === 'color') out.push({ type: 'color', key, label, default: typeof o.default === 'string' ? o.default : '#000000', ...help });
    else out.push({ type: 'text', key, label, default: typeof o.default === 'string' ? o.default : '', multiline: o.multiline === true, mono: o.mono === true, ...help });
  }
  return out;
}

type Reply = { ok: true; info?: unknown; result?: PluginResult } | { ok: false; error: string };

/** Runs one message through a fresh worker, which is thrown away afterwards (or when it runs too long). */
function call(source: string, message: Record<string, unknown>, timeoutMs: number): Promise<Reply> {
  return new Promise((resolve, reject) => {
    let script: string;
    try {
      script = harness(source);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
    let worker: Worker;
    try {
      worker = new Worker(url, { name: 'benchtop-plugin' });
    } catch (error) {
      URL.revokeObjectURL(url);
      reject(new Error(`Plugins cannot run here: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error(`The plugin did not finish within ${Math.round(timeoutMs / 1000)} s and was stopped.`));
    }, timeoutMs);
    worker.onmessage = (event: MessageEvent<Reply>) => {
      finish();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish();
      reject(new Error(`The plugin has an error: ${event.message || 'it could not be loaded'}${event.lineno ? ` (line ${Math.max(1, event.lineno - PLUGIN_FIRST_LINE + 1)})` : ''}`));
    };
    worker.postMessage(message);
  });
}

export async function describePlugin(source: string): Promise<PluginInfo> {
  if (source.length > MAX_PLUGIN_SOURCE) throw new Error('The plugin is larger than 2 MB.');
  const reply = await call(source, { kind: 'describe' }, 10_000);
  if (!reply.ok) throw new Error(reply.error);
  const info = (reply.info ?? {}) as Record<string, unknown>;
  const language = LANGS.includes(info.language as Lang) ? (info.language as Lang) : 'text';
  return {
    name: String(info.name || 'Plugin').slice(0, 80),
    description: String(info.description || '').slice(0, 400),
    options: cleanOptions(info.options),
    sample: typeof info.sample === 'string' ? info.sample : '',
    language,
  };
}

export async function runPlugin(source: string, input: string, values: Record<string, unknown>, timeoutMs = 30_000): Promise<PluginResult> {
  const reply = await call(source, { kind: 'run', input, values }, timeoutMs);
  if (!reply.ok) throw new Error(reply.error);
  const result = reply.result ?? { output: '' };
  return { output: result.output, ...(result.info ? { info: result.info } : {}), ...(result.language && LANGS.includes(result.language) ? { language: result.language } : {}) };
}

/* ---------------------------------------------------------------- store -- */

export function loadPlugins(): PluginRecord[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p): p is PluginRecord => !!p && typeof p === 'object' && typeof (p as PluginRecord).id === 'string' && typeof (p as PluginRecord).source === 'string')
      .map((p) => ({ id: p.id, name: String(p.name || 'Plugin'), description: String(p.description || ''), source: p.source, added: Number(p.added) || 0 }));
  } catch {
    return [];
  }
}

export function savePlugins(plugins: readonly PluginRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plugins));
  } catch {
    throw new Error('The plugins could not be saved: browser storage is full or turned off.');
  }
}

export const EXAMPLE_PLUGIN = `// A Benchtop plugin: one JavaScript file that registers a text tool.
// It runs in its own worker, without network or storage access.
benchtop.register({
  name: 'Accession numbers',
  description: 'Pad museum accession numbers such as VITM/2024/7 to VITM/2024/0007 and sort them.',
  options: [
    { key: 'digits', label: 'Digits', type: 'number', default: 4, min: 1, max: 8 },
    { key: 'sort', label: 'Sort', type: 'toggle', default: true },
  ],
  sample: 'VITM/2024/12\\nVITM/2023/7\\nVITM/2024/3',
  run(input, options) {
    const lines = input
      .split('\\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/(\\d+)$/, (n) => n.padStart(options.digits, '0')));
    if (options.sort) lines.sort();
    return { output: lines.join('\\n'), info: lines.length + ' numbers' };
  },
});
`;
