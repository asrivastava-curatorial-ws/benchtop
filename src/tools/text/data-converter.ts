import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { decode as iniDecode, encode as iniEncode } from 'ini';
import Papa from 'papaparse';
import { parse as tomlParse, stringify as tomlStringify } from 'smol-toml';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { parseDotenv, stringifyDotenv } from '../../lib/devops';
import { ToolError } from '../../lib/errors';
import { parseJson } from '../../lib/json';
import { defineTextTool, type Lang } from '../types';

const FORMATS = [
  { value: 'json', label: 'JSON' },
  { value: 'yaml', label: 'YAML' },
  { value: 'toml', label: 'TOML' },
  { value: 'xml', label: 'XML' },
  { value: 'ini', label: 'INI' },
  { value: 'env', label: '.env' },
  { value: 'query', label: 'Query string' },
  { value: 'csv', label: 'CSV' },
] as const;

type Format = (typeof FORMATS)[number]['value'];

const LANGUAGE: Record<Format, Lang> = { json: 'json', yaml: 'yaml', toml: 'text', xml: 'xml', ini: 'text', env: 'text', query: 'text', csv: 'text' };

/** Best guess at the format of `text`. */
export function detectFormat(text: string): Format {
  const trimmed = text.trim();
  if (/^[[{]/.test(trimmed)) return 'json';
  if (trimmed.startsWith('<')) return 'xml';
  if (/^[\w.%[\]-]+=[^\n]*(&[\w.%[\]-]+=[^\n]*)+$/.test(trimmed) || /^\?/.test(trimmed)) return 'query';
  if (/^\[[^\]\n]+\]\s*$/m.test(trimmed) && /^[\w.-]+\s*=\s*"/m.test(trimmed)) return 'toml';
  if (/^\[[^\]\n]+\]\s*$/m.test(trimmed)) return 'ini';
  if (/^(export\s+)?[A-Z_][A-Z0-9_]*=/m.test(trimmed) && !/^\s*[\w-]+:\s/m.test(trimmed)) return 'env';
  if (/^[\w.-]+\s*=\s*/m.test(trimmed)) return 'toml';
  if (/^[^,\n]+(,[^,\n]+)+\n/.test(trimmed) && !/:\s/.test(trimmed.split('\n')[0] ?? '')) return 'csv';
  return 'yaml';
}

/** a[b][0]=1&c=2 → { a: { b: ['1'] }, c: '2' } */
export function parseQuery(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const params = new URLSearchParams(text.trim().replace(/^.*\?/, ''));
  for (const [rawKey, value] of params) {
    const path = rawKey.replace(/\]/g, '').split('[');
    let node: Record<string, unknown> | unknown[] = root;
    path.forEach((segment, index) => {
      const last = index === path.length - 1;
      const key = segment === '' && Array.isArray(node) ? node.length : segment;
      const container = node as Record<string | number, unknown>;
      if (last) {
        if (Array.isArray(node) || container[key] === undefined) container[key] = value;
        else container[key] = Array.isArray(container[key]) ? [...(container[key] as unknown[]), value] : [container[key], value];
      } else {
        const nextIsArray = path[index + 1] === '' || /^\d+$/.test(path[index + 1] as string);
        if (container[key] === undefined || typeof container[key] !== 'object') container[key] = nextIsArray ? [] : {};
        node = container[key] as Record<string, unknown> | unknown[];
      }
    });
  }
  return root;
}

export function stringifyQuery(value: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown, prefix: string) => {
    if (node !== null && typeof node === 'object') {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) walk(child, prefix === '' ? key : `${prefix}[${Array.isArray(node) ? '' : key}]`);
    } else parts.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(node === null || node === undefined ? '' : String(node))}`);
  };
  walk(value, '');
  return parts.join('&').replace(/%5B/g, '[').replace(/%5D/g, ']');
}

function read(text: string, format: Format): unknown {
  try {
    switch (format) {
      case 'json':
        return parseJson(text);
      case 'yaml':
        return yamlParse(text);
      case 'toml':
        return tomlParse(text);
      case 'xml':
        return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: true, trimValues: true }).parse(text, true);
      case 'ini':
        return iniDecode(text);
      case 'env':
        return parseDotenv(text).values;
      case 'query':
        return parseQuery(text);
      case 'csv': {
        const parsed = Papa.parse<Record<string, unknown>>(text.trim(), { header: true, dynamicTyping: true, skipEmptyLines: true });
        if (parsed.errors.length > 0) throw new Error(parsed.errors[0]?.message);
        return parsed.data;
      }
    }
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError(`This is not valid ${format.toUpperCase()}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function write(value: unknown, format: Format, indent: number): string {
  const object = () => {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
      throw new ToolError(`${format.toUpperCase()} needs an object at the top level (key = value pairs), not ${Array.isArray(value) ? 'a list' : 'a single value'}.`);
    return value as Record<string, unknown>;
  };
  switch (format) {
    case 'json':
      return `${JSON.stringify(value, null, indent)}\n`;
    case 'yaml':
      return yamlStringify(value, { indent });
    case 'toml':
      return `${tomlStringify(object())}\n`;
    case 'xml': {
      const data = value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 ? value : { root: value };
      return `${new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@', format: true, indentBy: ' '.repeat(indent), suppressEmptyNode: true }).build(data)}`;
    }
    case 'ini':
      return iniEncode(object(), { whitespace: true });
    case 'env':
      return stringifyDotenv(object());
    case 'query':
      return `${stringifyQuery(value)}\n`;
    case 'csv': {
      const rows = Array.isArray(value) ? value : [value];
      return `${Papa.unparse(rows.map((row) => (row !== null && typeof row === 'object' ? Object.fromEntries(Object.entries(row).map(([key, cell]) => [key, cell !== null && typeof cell === 'object' ? JSON.stringify(cell) : cell])) : { value: row })))}\n`;
    }
  }
}

export default defineTextTool({
  input: { label: 'Input', sample: 'name: Benchtop\nversion: 2.0.0\nfeatures:\n  - offline\n  - open source\nauthor:\n  name: VITM\n  city: Bengaluru\n' },
  output: { label: 'Output' },
  options: [
    { key: 'from', label: 'From', type: 'select', choices: [{ value: 'auto', label: 'Detect' }, ...FORMATS], default: 'auto' },
    { key: 'to', label: 'To', type: 'select', choices: FORMATS, default: 'json' },
    { key: 'indent', label: 'Indent', type: 'select', choices: ['2', '4'], default: '2' },
  ],
  swap: (v) => ({ from: v.to, to: v.from === 'auto' ? 'yaml' : v.from }),
  run(input, o) {
    if (input.trim() === '') return '';
    const from = o.from === 'auto' ? detectFormat(input) : (o.from as Format);
    const to = o.to as Format;
    const value = read(input, from);
    return {
      output: write(value, to, Number(o.indent)),
      language: LANGUAGE[to],
      info: `${from.toUpperCase()} → ${to.toUpperCase()}`,
      filename: `converted.${to === 'yaml' ? 'yaml' : to === 'query' ? 'txt' : to}`,
    };
  },
});
