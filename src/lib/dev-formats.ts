/**
 * Readers for developer file formats shown by the viewers: OpenAPI / Swagger
 * documents and HAR (HTTP Archive) files, plus the binary data inspector used
 * by the hex viewer.
 */
import { parse as parseYaml } from 'yaml';
import { ToolError } from './errors';

/* ----------------------------------------------------------- OpenAPI -- */

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

export interface ApiParameter {
  readonly name: string;
  readonly in: string;
  readonly required: boolean;
  readonly type: string;
  readonly description: string;
}

export interface ApiOperation {
  readonly method: string;
  readonly path: string;
  readonly summary: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly deprecated: boolean;
  readonly parameters: readonly ApiParameter[];
  readonly body?: { readonly types: readonly string[]; readonly schema: string; readonly required: boolean };
  readonly responses: readonly { readonly code: string; readonly description: string; readonly schema: string }[];
  readonly security: readonly string[];
}

export interface ApiDocument {
  readonly title: string;
  readonly version: string;
  readonly spec: string;
  readonly description: string;
  readonly servers: readonly string[];
  readonly operations: readonly ApiOperation[];
  readonly schemas: readonly { readonly name: string; readonly summary: string; readonly properties: readonly { name: string; type: string; required: boolean; description: string }[] }[];
}

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** Follows a local $ref (#/components/schemas/X or #/definitions/X). */
function resolve(root: Json, value: unknown, depth = 0): unknown {
  if (!isObject(value) || typeof value.$ref !== 'string' || depth > 20) return value;
  const path = value.$ref
    .replace(/^#\//, '')
    .split('/')
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let node: unknown = root;
  for (const key of path) node = isObject(node) ? node[key] : undefined;
  return resolve(root, node, depth + 1);
}

/** A short type description: string(date-time), array of Pet, Pet, one of A | B. */
export function typeOf(root: Json, schema: unknown, depth = 0): string {
  if (!isObject(schema) || depth > 6) return '';
  if (typeof schema.$ref === 'string') return schema.$ref.split('/').pop() ?? 'object';
  for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
    const options = schema[key];
    if (Array.isArray(options)) return `${key === 'allOf' ? 'all of' : 'one of'} ${options.map((o) => typeOf(root, o, depth + 1)).join(key === 'allOf' ? ' & ' : ' | ')}`;
  }
  if (schema.type === 'array') return `array of ${typeOf(root, schema.items, depth + 1) || 'any'}`;
  const type = Array.isArray(schema.type) ? schema.type.join(' | ') : String(schema.type ?? (schema.properties ? 'object' : ''));
  const format = typeof schema.format === 'string' ? `(${schema.format})` : '';
  const choices = Array.isArray(schema.enum) ? ` [${schema.enum.slice(0, 8).join(', ')}${schema.enum.length > 8 ? ', …' : ''}]` : '';
  return `${type}${format}${choices}`;
}

export function parseOpenApi(text: string): ApiDocument {
  let root: unknown;
  try {
    root = text.trim().startsWith('{') ? JSON.parse(text) : parseYaml(text);
  } catch (error) {
    throw new ToolError(`This is not valid JSON or YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isObject(root) || (!root.openapi && !root.swagger)) throw new ToolError('This is not an OpenAPI or Swagger document (no "openapi" or "swagger" field).');
  const doc = root;
  const info = isObject(doc.info) ? doc.info : {};
  const servers = Array.isArray(doc.servers)
    ? doc.servers.map((s) => (isObject(s) ? String(s.url ?? '') : '')).filter(Boolean)
    : doc.host
      ? [`${(Array.isArray(doc.schemes) ? doc.schemes[0] : 'https') ?? 'https'}://${String(doc.host)}${String(doc.basePath ?? '')}`]
      : [];
  const operations: ApiOperation[] = [];
  const paths = isObject(doc.paths) ? doc.paths : {};
  const globalSecurity = Array.isArray(doc.security) ? doc.security : [];
  for (const [path, item] of Object.entries(paths)) {
    if (!isObject(item)) continue;
    const shared = Array.isArray(item.parameters) ? item.parameters : [];
    for (const method of METHODS) {
      const op = item[method];
      if (!isObject(op)) continue;
      const parameters: ApiParameter[] = [];
      let body: ApiOperation['body'];
      for (const raw of [...shared, ...(Array.isArray(op.parameters) ? op.parameters : [])]) {
        const p = resolve(doc, raw);
        if (!isObject(p)) continue;
        if (p.in === 'body') {
          body = { types: Array.isArray(op.consumes) ? (op.consumes as string[]) : ['application/json'], schema: typeOf(doc, p.schema), required: p.required === true };
          continue;
        }
        parameters.push({ name: String(p.name ?? ''), in: String(p.in ?? ''), required: p.required === true, type: typeOf(doc, p.schema ?? p), description: String(p.description ?? '') });
      }
      const requestBody = resolve(doc, op.requestBody);
      if (isObject(requestBody) && isObject(requestBody.content)) {
        const types = Object.keys(requestBody.content);
        const first = requestBody.content[types[0] as string];
        body = { types, schema: isObject(first) ? typeOf(doc, first.schema) : '', required: requestBody.required === true };
      }
      const responses = Object.entries(isObject(op.responses) ? op.responses : {}).map(([code, raw]) => {
        const r = resolve(doc, raw);
        const content = isObject(r) && isObject(r.content) ? Object.values(r.content)[0] : undefined;
        const schema = isObject(content) ? typeOf(doc, content.schema) : isObject(r) ? typeOf(doc, r.schema) : '';
        return { code, description: isObject(r) ? String(r.description ?? '') : '', schema };
      });
      const security = (Array.isArray(op.security) ? op.security : globalSecurity).flatMap((s) => (isObject(s) ? Object.keys(s) : []));
      operations.push({
        method: method.toUpperCase(),
        path,
        summary: String(op.summary ?? ''),
        description: String(op.description ?? ''),
        tags: Array.isArray(op.tags) ? op.tags.map(String) : [],
        deprecated: op.deprecated === true,
        parameters,
        body,
        responses,
        security,
      });
    }
  }
  const schemaRoot = isObject(doc.components) && isObject(doc.components.schemas) ? doc.components.schemas : isObject(doc.definitions) ? doc.definitions : {};
  const schemas = Object.entries(schemaRoot).map(([name, raw]) => {
    const schema = resolve(doc, raw);
    const required = new Set(isObject(schema) && Array.isArray(schema.required) ? schema.required.map(String) : []);
    const properties =
      isObject(schema) && isObject(schema.properties)
        ? Object.entries(schema.properties).map(([prop, value]) => ({
            name: prop,
            type: typeOf(doc, value),
            required: required.has(prop),
            description: isObject(value) ? String(value.description ?? '') : '',
          }))
        : [];
    return { name, summary: typeOf(doc, schema), properties };
  });
  return {
    title: String(info.title ?? 'Untitled API'),
    version: String(info.version ?? ''),
    spec: doc.openapi ? `OpenAPI ${String(doc.openapi)}` : `Swagger ${String(doc.swagger)}`,
    description: String(info.description ?? ''),
    servers,
    operations,
    schemas,
  };
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n+/g, ' ');

/** The API as a Markdown reference document. */
export function apiMarkdown(api: ApiDocument): string {
  const out = [`# ${api.title}${api.version ? ` (${api.version})` : ''}`, '', `_${api.spec}_`, ''];
  if (api.description) out.push(api.description, '');
  if (api.servers.length) out.push('**Servers:** ' + api.servers.map((s) => `\`${s}\``).join(', '), '');
  for (const op of api.operations) {
    out.push(`## ${op.method} \`${op.path}\`${op.deprecated ? ' (deprecated)' : ''}`, '');
    if (op.summary) out.push(op.summary, '');
    if (op.description && op.description !== op.summary) out.push(op.description, '');
    if (op.parameters.length) {
      out.push('| Parameter | In | Type | Required | Description |', '| --- | --- | --- | --- | --- |');
      for (const p of op.parameters) out.push(`| \`${cell(p.name)}\` | ${p.in} | ${cell(p.type)} | ${p.required ? 'yes' : 'no'} | ${cell(p.description)} |`);
      out.push('');
    }
    if (op.body) out.push(`**Body** (${op.body.types.join(', ')}${op.body.required ? ', required' : ''}): ${op.body.schema || 'any'}`, '');
    if (op.responses.length) {
      out.push('| Response | Description | Schema |', '| --- | --- | --- |');
      for (const r of op.responses) out.push(`| ${r.code} | ${cell(r.description)} | ${cell(r.schema)} |`);
      out.push('');
    }
  }
  if (api.schemas.length) {
    out.push('## Schemas', '');
    for (const s of api.schemas) {
      out.push(`### ${s.name}`, '');
      if (s.properties.length) {
        out.push('| Property | Type | Required | Description |', '| --- | --- | --- | --- |');
        for (const p of s.properties) out.push(`| \`${cell(p.name)}\` | ${cell(p.type)} | ${p.required ? 'yes' : 'no'} | ${cell(p.description)} |`);
        out.push('');
      } else out.push(s.summary || 'object', '');
    }
  }
  return out.join('\n');
}

/* --------------------------------------------------------------- HAR -- */

export interface HarEntry {
  readonly index: number;
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly statusText: string;
  readonly mime: string;
  readonly kind: 'document' | 'script' | 'style' | 'image' | 'font' | 'xhr' | 'media' | 'other';
  /** Bytes received (transfer size when known, else body size). */
  readonly size: number;
  /** Milliseconds from the first request to this one's start. */
  readonly start: number;
  readonly time: number;
  readonly timings: Readonly<Record<string, number>>;
  readonly requestHeaders: readonly { name: string; value: string }[];
  readonly responseHeaders: readonly { name: string; value: string }[];
  readonly requestBody: string;
  readonly responseBody: string;
  readonly responseEncoding: string;
}

function kindFor(mime: string, url: string, initiator: string): HarEntry['kind'] {
  const m = mime.toLowerCase();
  if (m.includes('html')) return 'document';
  if (m.includes('javascript') || /\.m?js(\?|$)/.test(url)) return 'script';
  if (m.includes('css')) return 'style';
  if (m.startsWith('image/')) return 'image';
  if (m.includes('font') || /\.(woff2?|ttf|otf)(\?|$)/.test(url)) return 'font';
  if (m.startsWith('video/') || m.startsWith('audio/')) return 'media';
  if (m.includes('json') || m.includes('xml') || initiator === 'xhr' || initiator === 'fetch') return 'xhr';
  return 'other';
}

export function parseHar(text: string): { entries: HarEntry[]; pages: number; creator: string; total: number; bytes: number } {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new ToolError('This is not a HAR file (it is not JSON).');
  }
  const log = isObject(root) && isObject(root.log) ? root.log : null;
  if (!log || !Array.isArray(log.entries)) throw new ToolError('This JSON has no "log.entries", so it is not a HAR file.');
  const raw = log.entries.filter(isObject);
  const starts = raw.map((e) => Date.parse(String(e.startedDateTime ?? '')));
  const first = Math.min(...starts.filter((t) => Number.isFinite(t)));
  const entries = raw.map((e, index): HarEntry => {
    const request = isObject(e.request) ? e.request : {};
    const response = isObject(e.response) ? e.response : {};
    const content = isObject(response.content) ? response.content : {};
    const headers = (list: unknown) => (Array.isArray(list) ? list.filter(isObject).map((h) => ({ name: String(h.name ?? ''), value: String(h.value ?? '') })) : []);
    const mime = String(content.mimeType ?? '').split(';')[0] ?? '';
    const url = String(request.url ?? '');
    const transfer = Number(response._transferSize ?? response.bodySize ?? -1);
    const timings = isObject(e.timings) ? Object.fromEntries(Object.entries(e.timings).filter(([, v]) => typeof v === 'number' && v >= 0)) : {};
    return {
      index,
      method: String(request.method ?? 'GET'),
      url,
      status: Number(response.status ?? 0),
      statusText: String(response.statusText ?? ''),
      mime,
      kind: kindFor(mime, url, String(e._resourceType ?? (isObject(e._initiator) ? e._initiator.type : '') ?? '')),
      size: transfer >= 0 ? transfer : Number(content.size ?? 0),
      start: Number.isFinite(starts[index] as number) ? (starts[index] as number) - first : 0,
      time: Number(e.time ?? 0),
      timings: timings as Record<string, number>,
      requestHeaders: headers(request.headers),
      responseHeaders: headers(response.headers),
      requestBody: isObject(request.postData) ? String(request.postData.text ?? '') : '',
      responseBody: String(content.text ?? ''),
      responseEncoding: String(content.encoding ?? ''),
    };
  });
  const total = entries.reduce((max, e) => Math.max(max, e.start + e.time), 0);
  const creator = isObject(log.creator) ? `${String(log.creator.name ?? '')} ${String(log.creator.version ?? '')}`.trim() : '';
  return { entries, pages: Array.isArray(log.pages) ? log.pages.length : 0, creator, total, bytes: entries.reduce((sum, e) => sum + Math.max(0, e.size), 0) };
}

/* ------------------------------------------------------ hex inspector -- */

export interface Inspection {
  readonly label: string;
  readonly value: string;
}

/** The bytes at `offset` read as common binary types, in the chosen byte order. */
export function inspect(bytes: Uint8Array, offset: number, littleEndian: boolean): Inspection[] {
  const left = bytes.length - offset;
  if (left <= 0) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, Math.min(left, 8));
  const out: Inspection[] = [];
  const add = (size: number, label: string, read: () => string) => {
    if (left >= size) out.push({ label, value: read() });
  };
  add(1, 'Binary', () => (bytes[offset] as number).toString(2).padStart(8, '0'));
  add(1, 'uint8 / int8', () => `${view.getUint8(0)} / ${view.getInt8(0)}`);
  add(1, 'Character', () => {
    const b = bytes[offset] as number;
    return b >= 0x20 && b < 0x7f ? `'${String.fromCharCode(b)}'` : `\\x${b.toString(16).padStart(2, '0')}`;
  });
  add(2, 'uint16 / int16', () => `${view.getUint16(0, littleEndian)} / ${view.getInt16(0, littleEndian)}`);
  add(4, 'uint32 / int32', () => `${view.getUint32(0, littleEndian)} / ${view.getInt32(0, littleEndian)}`);
  add(8, 'uint64 / int64', () => `${view.getBigUint64(0, littleEndian)} / ${view.getBigInt64(0, littleEndian)}`);
  add(4, 'float32', () => String(view.getFloat32(0, littleEndian)));
  add(8, 'float64', () => String(view.getFloat64(0, littleEndian)));
  add(4, 'Unix time (32-bit)', () => {
    const seconds = view.getUint32(0, littleEndian);
    return new Date(seconds * 1000).toISOString().replace('.000Z', 'Z');
  });
  add(8, 'Windows FILETIME', () => {
    const ticks = view.getBigUint64(0, littleEndian);
    const ms = Number(ticks / 10000n) - 11644473600000;
    return Math.abs(ms) < 8.64e15 ? new Date(ms).toISOString() : 'out of range';
  });
  add(1, 'UTF-8', () => {
    const slice = bytes.subarray(offset, offset + 4);
    const text = new TextDecoder('utf-8', { fatal: false }).decode(slice);
    const ch = [...text][0] ?? '';
    return ch === '\uFFFD' ? 'not a UTF-8 start byte' : `${ch} (U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')})`;
  });
  return out;
}

/** Offsets where `needle` occurs, at most `limit` of them. */
export function findAll(haystack: Uint8Array, needle: Uint8Array, limit = 1000): number[] {
  const found: number[] = [];
  if (!needle.length) return found;
  const first = needle[0] as number;
  outer: for (let i = haystack.indexOf(first); i >= 0 && i <= haystack.length - needle.length; i = haystack.indexOf(first, i + 1)) {
    for (let j = 1; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    found.push(i);
    if (found.length >= limit) break;
  }
  return found;
}

/** "de ad be ef", "0xDEADBEEF" or "DEADBEEF" → bytes. */
export function parseHexPattern(text: string): Uint8Array {
  const clean = text.replace(/0x/gi, '').replace(/[\s,:-]/g, '');
  if (!/^[0-9a-f]*$/i.test(clean) || clean.length % 2) throw new ToolError('Enter hex bytes, such as "DE AD BE EF".');
  return Uint8Array.from(clean.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}
