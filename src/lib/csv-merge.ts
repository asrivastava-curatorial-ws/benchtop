/** Merging and splitting CSV tables (parsed with Papa Parse). */
import { ToolError } from './errors';

export interface Table {
  readonly name: string;
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface MergeOptions {
  /** Match columns by header name (a union of all columns), or append rows as they are. */
  readonly byName: boolean;
  /** Add a first column naming the file each row came from. */
  readonly source: boolean;
  readonly dedupe: boolean;
}

export function mergeTables(tables: readonly Table[], options: MergeOptions): Table {
  if (!tables.length) throw new ToolError('Add at least one CSV file.');
  let header: string[];
  let rows: string[][];
  if (options.byName) {
    header = [];
    const seen = new Set<string>();
    for (const t of tables)
      for (const h of t.header)
        if (!seen.has(h)) {
          seen.add(h);
          header.push(h);
        }
    rows = tables.flatMap((t) => {
      const index = header.map((h) => t.header.indexOf(h));
      return t.rows.map((r) => index.map((i) => (i >= 0 ? (r[i] ?? '') : '')));
    });
  } else {
    header = [...tables[0].header];
    const width = Math.max(header.length, ...tables.flatMap((t) => t.rows.map((r) => r.length)));
    while (header.length < width) header.push(`Column ${header.length + 1}`);
    rows = tables.flatMap((t) => t.rows.map((r) => [...r, ...Array(Math.max(0, width - r.length)).fill('')]));
  }
  if (options.source) {
    header = ['Source file', ...header];
    let offset = 0;
    const named: string[][] = [];
    for (const t of tables) {
      for (let i = 0; i < t.rows.length; i++) named.push([t.name, ...rows[offset + i]]);
      offset += t.rows.length;
    }
    rows = named;
  }
  if (options.dedupe) {
    const seen = new Set<string>();
    // Ignore the source column when looking for repeats.
    const skip = options.source ? 1 : 0;
    rows = rows.filter((r) => {
      const key = JSON.stringify(r.slice(skip));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return { name: 'merged.csv', header, rows };
}

const safeName = (value: string) =>
  value
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are not allowed in file names
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .trim()
    .slice(0, 80) || 'empty';

export function splitByRows(table: Table, size: number, base: string): Table[] {
  const n = Math.max(1, Math.floor(size));
  const parts: Table[] = [];
  const width = String(Math.ceil(table.rows.length / n)).length;
  for (let i = 0; i < table.rows.length; i += n) {
    parts.push({ name: `${base} part ${String(parts.length + 1).padStart(width, '0')}.csv`, header: table.header, rows: table.rows.slice(i, i + n) });
  }
  return parts;
}

export function splitByColumn(table: Table, column: number, base: string): Table[] {
  if (column < 0 || column >= table.header.length) throw new ToolError('Choose the column to split by.');
  const groups = new Map<string, string[][]>();
  for (const row of table.rows) {
    const value = row[column] ?? '';
    groups.set(value, [...(groups.get(value) ?? []), [...row]]);
  }
  const used = new Set<string>();
  return [...groups].map(([value, rows]) => {
    let name = `${base} ${safeName(value)}`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} ${safeName(value)} (${n})`;
    used.add(name.toLowerCase());
    return { name: `${name}.csv`, header: table.header, rows };
  });
}
