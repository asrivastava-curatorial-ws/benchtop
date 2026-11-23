/**
 * Tables in memory: rows from JSON, spreadsheets and Parquet turned into typed
 * columns (numbers, whole numbers, true/false, dates or text), and tables
 * written back out as CSV, JSON, Markdown or TSV.
 */
import { ToolError } from './errors';

export type ColumnType = 'integer' | 'number' | 'boolean' | 'date' | 'timestamp' | 'text';
export type Value = string | number | boolean | bigint | null;

export interface Column {
  readonly name: string;
  readonly type: ColumnType;
  readonly values: Value[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** A plain JS value for a cell: nested objects and arrays become JSON text. */
export function cellValue(v: unknown): Value {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return v;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (v instanceof Uint8Array) return [...v].map((b) => b.toString(16).padStart(2, '0')).join('');
  return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
}

/** The narrowest type that holds every non-empty value. */
export function inferType(values: readonly Value[]): ColumnType {
  let type: ColumnType | null = null;
  const widen = (t: ColumnType) => {
    if (type === null || type === t) type = t;
    else if ((type === 'integer' && t === 'number') || (type === 'number' && t === 'integer')) type = 'number';
    else if ((type === 'date' && t === 'timestamp') || (type === 'timestamp' && t === 'date')) type = 'timestamp';
    else type = 'text';
  };
  for (const v of values) {
    if (v === null || v === '') continue;
    if (typeof v === 'bigint') widen('integer');
    else if (typeof v === 'number') widen(Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER ? 'integer' : 'number');
    else if (typeof v === 'boolean') widen('boolean');
    else if (DATE.test(v)) widen('date');
    else if (TIMESTAMP.test(v)) widen('timestamp');
    else widen('text');
    if (type === 'text') break;
  }
  return type ?? 'text';
}

/** Unique, non-empty column names: blanks become column_2, repeats get _2, _3... */
export function uniqueNames(names: readonly unknown[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw, i) => {
    const base = String(raw ?? '').trim() || `column_${i + 1}`;
    const count = seen.get(base.toLowerCase()) ?? 0;
    seen.set(base.toLowerCase(), count + 1);
    return count ? `${base}_${count + 1}` : base;
  });
}

/** Columns from objects: every key that appears in any row, in first-seen order. */
export function columnsFromObjects(rows: readonly Record<string, unknown>[]): Column[] {
  const keys: string[] = [];
  const known = new Set<string>();
  for (const row of rows)
    for (const k of Object.keys(row))
      if (!known.has(k)) {
        known.add(k);
        keys.push(k);
      }
  const names = uniqueNames(keys);
  return keys.map((k, i) => {
    const values = rows.map((r) => cellValue(r[k]));
    return { name: names[i] as string, type: inferType(values), values };
  });
}

/** Columns from rows of cells; the first row is the header when `header` is true. */
export function columnsFromRows(rows: readonly (readonly unknown[])[], header: boolean): Column[] {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const head = header ? (rows[0] ?? []) : [];
  const body = header ? rows.slice(1) : rows;
  const names = uniqueNames(Array.from({ length: width }, (_, i) => (header ? head[i] : `column_${i + 1}`)));
  return names.map((name, i) => {
    const values = body.map((r) => cellValue(r[i]));
    return { name, type: inferType(values), values };
  });
}

/** Rows that are entirely empty at the end of a sheet are dropped. */
export function trimRows<T>(rows: readonly (readonly T[])[]): T[][] {
  const out = rows.map((r) => [...r]);
  while (out.length && out[out.length - 1]?.every((c) => c === null || c === undefined || c === '')) out.pop();
  return out;
}

/** JSON text as rows: an array of objects, newline-delimited objects, or an object holding such an array. */
export function jsonRows(text: string): Record<string, unknown>[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    // Newline-delimited JSON.
    const rows: unknown[] = [];
    trimmed.split(/\r?\n/).forEach((line, i) => {
      if (!line.trim()) return;
      try {
        rows.push(JSON.parse(line));
      } catch {
        throw new ToolError(`Line ${i + 1} is not valid JSON.`);
      }
    });
    data = rows;
  }
  if (!Array.isArray(data) && data && typeof data === 'object') {
    const inner = Object.values(data as Record<string, unknown>).find((v) => Array.isArray(v) && v.length && v.every((x) => x && typeof x === 'object'));
    data = inner ?? [data];
  }
  if (!Array.isArray(data)) throw new ToolError('Expected an array of objects, or one object per line.');
  return data.map((row) => (row && typeof row === 'object' && !Array.isArray(row) ? (row as Record<string, unknown>) : { value: row }));
}

/** A string usable as an SQL table name: letters, digits and underscores, not starting with a digit. */
export function tableName(fileName: string, taken: ReadonlySet<string> = new Set()): string {
  let base = fileName
    .replace(/\.[^.]+$/, '')
    .normalize('NFKD')
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  if (!base) base = 'data';
  if (/^\d/.test(base)) base = `t_${base}`;
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
  return name;
}

const text = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'bigint' ? v.toString() : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** RFC 4180 CSV (or TSV): fields quoted when they hold the delimiter, quotes or line breaks. */
export function toDelimited(header: readonly string[], rows: readonly (readonly unknown[])[], delimiter = ','): string {
  const quote = (v: unknown) => {
    const s = text(v);
    return s.includes(delimiter) || /["\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `${[header, ...rows].map((r) => r.map(quote).join(delimiter)).join('\r\n')}\r\n`;
}

/** An array of objects as JSON, with large whole numbers kept exact as strings only when they would lose precision. */
export function toJson(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const objects = rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? null])));
  return `${JSON.stringify(objects, (_k, v) => (typeof v === 'bigint' ? (v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString()) : v), 2)}\n`;
}

/** A GitHub-flavoured Markdown table; pipes and line breaks inside cells are escaped. */
export function toMarkdown(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const cell = (v: unknown) => text(v).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  return [`| ${header.map(cell).join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${header.map((_, i) => cell(r[i])).join(' | ')} |`)].join('\n');
}
