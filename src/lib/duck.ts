/**
 * DuckDB in the browser (duckdb-wasm, MIT): one engine per page, started on
 * first use in its own worker.  Extensions are never fetched (Benchtop works
 * offline), so CSV is read by DuckDB itself and every other format is turned
 * into Arrow columns first (see table-files.ts).
 */
import type { AsyncDuckDB, AsyncDuckDBConnection } from '@duckdb/duckdb-wasm';
import workerUrl from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import wasmUrl from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import type { Column } from './tabular';

export interface Engine {
  readonly db: AsyncDuckDB;
  readonly conn: AsyncDuckDBConnection;
}

let engine: Promise<Engine> | null = null;

export function loadDuck(): Promise<Engine> {
  engine ??= (async () => {
    const duckdb = await import('@duckdb/duckdb-wasm');
    const worker = new Worker(workerUrl);
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await db.instantiate(wasmUrl);
    await db.open({ query: { castDecimalToDouble: true, castTimestampToDate: true } });
    const conn = await db.connect();
    await conn.query('SET autoinstall_known_extensions = false');
    await conn.query('SET autoload_known_extensions = false');
    return { db, conn };
  })();
  engine.catch(() => {
    engine = null;
  });
  return engine;
}

export const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

const SQL_TYPES: Record<Column['type'], string> = { integer: 'BIGINT', number: 'DOUBLE', boolean: 'BOOLEAN', date: 'DATE', timestamp: 'TIMESTAMP', text: 'VARCHAR' };

/** "2026-11-02T10:30:00Z" → "2026-11-02 10:30:00", the form DuckDB's TIMESTAMP reads. */
function timestampText(v: string): string {
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v.replace(' ', 'T') : `${v.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? v : d.toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * Inferred columns inserted as a new table.  They travel as CSV with explicit
 * column types: Arrow's JavaScript builders compile code at run time, which the
 * app's content security policy forbids.
 */
export async function insertColumns(e: Engine, name: string, columns: readonly Column[]): Promise<void> {
  const rows = columns[0]?.values.length ?? 0;
  const field = (c: Column, v: unknown): string => {
    if (v === null || v === undefined) return '';
    let text: string;
    if (c.type === 'timestamp') text = timestampText(String(v));
    else if (c.type === 'boolean') text = v ? 'true' : 'false';
    else text = typeof v === 'bigint' ? v.toString() : String(v);
    // Quoted, so an empty string stays an empty string while an empty field is NULL.
    return c.type === 'text' ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines: string[] = [columns.map((c) => `"${c.name.replace(/"/g, '""')}"`).join(',')];
  for (let r = 0; r < rows; r++) lines.push(columns.map((c) => field(c, c.values[r])).join(','));
  const path = `cols_${Date.now()}_${Math.random().toString(36).slice(2)}.csv`;
  await e.db.registerFileText(path, `${lines.join('\n')}\n`);
  const types = columns.map((c) => `${sqlString(c.name)}: '${SQL_TYPES[c.type]}'`).join(', ');
  try {
    await e.conn.query(
      `CREATE OR REPLACE TABLE ${quoteIdent(name)} AS SELECT * FROM read_csv(${sqlString(path)}, header = true, auto_detect = false, delim = ',', quote = '"', escape = '"', allow_quoted_nulls = false, columns = {${types}})`,
    );
  } finally {
    await e.db.dropFile(path);
  }
}

/** An Arrow IPC file or stream (.arrow, .feather) inserted without decoding it in JavaScript. */
export async function insertArrowIpc(e: Engine, name: string, bytes: Uint8Array): Promise<void> {
  const arrow = await import('apache-arrow');
  const table = arrow.tableFromIPC(bytes);
  await e.conn.query(`DROP TABLE IF EXISTS ${quoteIdent(name)}`);
  await e.conn.insertArrowFromIPCStream(arrow.tableToIPC(table, 'stream'), { name, create: true });
}

/** A CSV or TSV file loaded by DuckDB's own reader, which detects the delimiter, header and types. */
export async function insertCsv(e: Engine, name: string, fileName: string, bytes: Uint8Array): Promise<void> {
  const path = `upload_${Date.now()}_${fileName.replace(/[^\w.-]+/g, '_')}`;
  await e.db.registerFileBuffer(path, bytes);
  await e.conn.query(`CREATE OR REPLACE TABLE ${quoteIdent(name)} AS SELECT * FROM read_csv(${sqlString(path)}, auto_detect = true, sample_size = -1)`);
}

export const sqlString = (text: string) => `'${text.replace(/'/g, "''")}'`;

export interface QueryResult {
  readonly columns: { readonly name: string; readonly type: string }[];
  /** Rows as plain values: numbers, strings, booleans, bigint and Date. */
  readonly rows: unknown[][];
  readonly total: number;
  readonly ms: number;
}

/** Runs SQL and keeps at most `limit` rows for display (the total is still counted). */
export async function runQuery(e: Engine, sql: string, limit = 1000): Promise<QueryResult> {
  const started = performance.now();
  const table = await e.conn.query(sql);
  const fields = table.schema.fields;
  const total = table.numRows;
  const rows: unknown[][] = [];
  const shown = Math.min(total, limit);
  const vectors = fields.map((_, i) => table.getChildAt(i));
  const dates = fields.map(isDateField);
  for (let r = 0; r < shown; r++) rows.push(vectors.map((v, i) => plain(v?.get(r), dates[i])));
  return { columns: fields.map((f) => ({ name: f.name, type: String(f.type) })), rows, total, ms: performance.now() - started };
}

/** Every row of a query, for export. */
export async function allRows(e: Engine, sql: string): Promise<{ header: string[]; rows: unknown[][] }> {
  const table = await e.conn.query(sql);
  const fields = table.schema.fields;
  const vectors = fields.map((_, i) => table.getChildAt(i));
  const dates = fields.map(isDateField);
  const rows: unknown[][] = [];
  for (let r = 0; r < table.numRows; r++) rows.push(vectors.map((v, i) => plain(v?.get(r), dates[i])));
  return { header: fields.map((f) => f.name), rows };
}

/** Arrow's Date (8) and Timestamp (10) types, which arrive as milliseconds since 1970. */
const isDateField = (f: { type: { typeId: number } }) => f.type.typeId === 8 || f.type.typeId === 10;

/** Arrow values (structs, lists, maps) as plain JS for display and export. */
function plain(v: unknown, date = false): unknown {
  if (v === null || v === undefined) return null;
  if (date && (typeof v === 'number' || typeof v === 'bigint')) return new Date(Number(v));
  if (typeof v === 'object') {
    if (v instanceof Date || v instanceof Uint8Array) return v;
    const json = (v as { toJSON?: () => unknown }).toJSON;
    if (typeof json === 'function') return JSON.parse(JSON.stringify(json.call(v), (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));
    if (Symbol.iterator in (v as object)) return [...(v as Iterable<unknown>)].map((x) => plain(x));
  }
  return v;
}

/** How a value is shown in a results grid. */
export function displayValue(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (v instanceof Date) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z')
      ? iso.slice(0, 10)
      : iso
          .replace('T', ' ')
          .replace(/\.000Z$/, '')
          .replace('Z', '');
  }
  if (v instanceof Uint8Array) return `(${v.length} bytes)`;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toPrecision(15));
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
