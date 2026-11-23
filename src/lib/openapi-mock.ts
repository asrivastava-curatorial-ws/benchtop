/**
 * Mock routes from an OpenAPI 3 (or Swagger 2) document: one route per path
 * and method, answering with the first success response's example, or with
 * an example built from its schema.
 */
import { parse as parseYaml } from 'yaml';

export interface Route {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string;
  readonly delayMs: number;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);

function resolve(doc: Obj, value: unknown, depth = 0): unknown {
  const o = obj(value);
  if (!o || depth > 20) return value;
  const ref = o.$ref;
  if (typeof ref === 'string' && ref.startsWith('#/')) {
    const target = ref
      .slice(2)
      .split('/')
      .reduce<unknown>((v, key) => obj(v)?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], doc);
    return resolve(doc, target, depth + 1);
  }
  return o;
}

/** A sample value for a JSON Schema: examples first, then defaults, then a plausible value. */
export function sampleFor(doc: Obj, schemaIn: unknown, depth = 0, name = ''): unknown {
  const schema = obj(resolve(doc, schemaIn));
  if (!schema || depth > 8) return null;
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;
  for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
    const list = schema[key];
    if (Array.isArray(list) && list.length) {
      if (key === 'allOf') return Object.assign({}, ...list.map((s) => sampleFor(doc, s, depth + 1, name)).filter((v) => obj(v)));
      return sampleFor(doc, list[0], depth + 1, name);
    }
  }
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  if (type === 'object' || schema.properties) {
    const out: Obj = {};
    for (const [key, prop] of Object.entries(obj(schema.properties) ?? {})) out[key] = sampleFor(doc, prop, depth + 1, key);
    return out;
  }
  if (type === 'array') return [sampleFor(doc, schema.items, depth + 1, name)];
  if (type === 'integer' || type === 'number') return /id$/i.test(name) ? 1 : typeof schema.minimum === 'number' ? schema.minimum : 0;
  if (type === 'boolean') return true;
  if (type === 'string') {
    const format = String(schema.format ?? '');
    if (format === 'date-time') return '2026-11-22T10:00:00Z';
    if (format === 'date') return '2026-11-22';
    if (format === 'email') return 'visitor@example.org';
    if (format === 'uuid') return '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    if (format === 'uri' || format === 'url') return 'https://example.org/';
    return name ? `${name} text` : 'text';
  }
  return null;
}

export function routesFromOpenApi(text: string): Route[] {
  let doc: Obj | null;
  try {
    doc = obj(text.trim().startsWith('{') ? JSON.parse(text) : parseYaml(text));
  } catch (e) {
    throw new Error(`The OpenAPI document could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!doc || !obj(doc.paths)) throw new Error('This is not an OpenAPI document: it has no "paths".');
  const routes: Route[] = [];
  for (const [path, item] of Object.entries(obj(doc.paths) ?? {})) {
    for (const [method, op] of Object.entries(obj(item) ?? {})) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method)) continue;
      const responses = obj(obj(op)?.responses) ?? {};
      const code = Object.keys(responses).find((c) => /^2\d\d$/.test(c)) ?? Object.keys(responses).find((c) => c === 'default') ?? '200';
      const response = obj(resolve(doc, responses[code])) ?? {};
      let body: unknown = null;
      const content = obj(response.content);
      if (content) {
        const media = obj(content['application/json']) ?? obj(Object.values(content)[0]);
        if (media?.example !== undefined) body = media.example;
        else if (obj(media?.examples)) body = obj(resolve(doc, Object.values(obj(media?.examples) ?? {})[0]))?.value ?? null;
        else if (media?.schema) body = sampleFor(doc, media.schema);
      } else if (response.schema) body = sampleFor(doc, response.schema);
      else if (obj(response.examples)?.['application/json'] !== undefined) body = obj(response.examples)?.['application/json'];
      routes.push({
        method: method.toUpperCase(),
        // OpenAPI's {id} becomes the mock server's :id.
        path: path.replace(/\{([^}]+)\}/g, ':$1'),
        status: code === 'default' ? 200 : Number(code),
        headers: [],
        body: body === null || body === undefined ? '' : JSON.stringify(body, null, 2),
        delayMs: 0,
      });
    }
  }
  return routes;
}
