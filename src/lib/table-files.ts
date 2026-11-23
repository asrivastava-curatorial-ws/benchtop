/**
 * Data files opened as tables: CSV and TSV (left to DuckDB's own reader),
 * JSON and NDJSON, Parquet (hyparquet), Excel workbooks, Avro, Arrow IPC and
 * SQLite databases.  Each file can hold several tables (sheets, SQLite tables).
 */
import { ToolError } from './errors';
import { type Column, columnsFromObjects, columnsFromRows, jsonRows, trimRows } from './tabular';

export type TableSource =
  | { readonly kind: 'csv'; readonly name: string; readonly bytes: Uint8Array }
  | { readonly kind: 'columns'; readonly name: string; readonly columns: Column[] }
  | { readonly kind: 'arrow'; readonly name: string; readonly bytes: Uint8Array };

export const TABLE_ACCEPT = '.csv,.tsv,.txt,.json,.ndjson,.jsonl,.parquet,.xlsx,.xlsm,.avro,.arrow,.feather,.ipc,.sqlite,.sqlite3,.db,.db3';

const ext = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
const stem = (name: string) => name.replace(/\.[^.]+$/, '');

/** Whether the first row looks like a header: all text, none empty, and the rows below are not all text. */
export function looksLikeHeader(rows: readonly (readonly unknown[])[]): boolean {
  const first = rows[0];
  if (!first?.length) return false;
  if (!first.every((c) => typeof c === 'string' && c.trim() !== '')) return false;
  const rest = rows.slice(1, 50);
  if (!rest.length) return true;
  return rest.some((r) => r.some((c) => typeof c === 'number' || typeof c === 'boolean')) || new Set(first.map(String)).size === first.length;
}

export async function readTableFile(name: string, bytes: Uint8Array): Promise<TableSource[]> {
  switch (ext(name)) {
    case 'csv':
    case 'tsv':
    case 'txt':
      return [{ kind: 'csv', name: stem(name), bytes }];
    case 'json':
    case 'ndjson':
    case 'jsonl': {
      const rows = jsonRows(new TextDecoder().decode(bytes));
      if (!rows.length) throw new ToolError(`${name} has no rows.`);
      return [{ kind: 'columns', name: stem(name), columns: columnsFromObjects(rows) }];
    }
    case 'parquet': {
      const { parquetReadObjects } = await import('hyparquet');
      const { compressors } = await import('hyparquet-compressors');
      const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const rows = (await parquetReadObjects({ file, compressors })) as Record<string, unknown>[];
      return [{ kind: 'columns', name: stem(name), columns: columnsFromObjects(rows) }];
    }
    case 'xlsx':
    case 'xlsm': {
      const { readXlsx } = await import('./xlsx-read');
      return readXlsx(bytes)
        .map((sheet) => ({ sheet, rows: trimRows(sheet.rows) }))
        .filter(({ rows }) => rows.length > 0)
        .map(({ sheet, rows }) => ({ kind: 'columns' as const, name: `${stem(name)}_${sheet.name}`, columns: columnsFromRows(rows, looksLikeHeader(rows)) }));
    }
    case 'avro': {
      const { readAvroContainer } = await import('../recipe/ops/avro');
      const records = readAvroContainer(bytes);
      const rows = records.map((r) => (r && typeof r === 'object' && !Array.isArray(r) ? (r as Record<string, unknown>) : { value: r }));
      return [{ kind: 'columns', name: stem(name), columns: columnsFromObjects(rows) }];
    }
    case 'arrow':
    case 'feather':
    case 'ipc':
      return [{ kind: 'arrow', name: stem(name), bytes }];
    case 'sqlite':
    case 'sqlite3':
    case 'db':
    case 'db3': {
      const initSqlJs = (await import('sql.js')).default as unknown as (config: object) => Promise<import('sql.js').SqlJsStatic>;
      const wasmUrl = (await import('sql.js/dist/sql-wasm-browser.wasm?url')).default;
      const SQL = await initSqlJs({ locateFile: () => wasmUrl });
      const db = new SQL.Database(bytes);
      try {
        const names = (db.exec("SELECT name FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")[0]?.values ?? []).map((r) => String(r[0]));
        return names.map((table) => {
          const result = db.exec(`SELECT * FROM "${table.replace(/"/g, '""')}"`)[0];
          const header = result?.columns ?? [];
          const rows = (result?.values ?? []) as unknown[][];
          return { kind: 'columns' as const, name: table, columns: columnsFromRows([header, ...rows], true) };
        });
      } finally {
        db.close();
      }
    }
    default:
      throw new ToolError(`${name}: open CSV, TSV, JSON, NDJSON, Parquet, Excel, Avro, Arrow or SQLite files.`);
  }
}
