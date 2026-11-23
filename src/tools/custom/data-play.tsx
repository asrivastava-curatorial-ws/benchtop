/**
 * Data Playground (SQL with DuckDB over CSV, JSON, Parquet, Excel, Avro,
 * Arrow and SQLite files, with charts) and Parquet and Avro Viewer (schema,
 * metadata and rows of one file).
 */
import { useMemo, useRef, useState } from 'preact/hooks';
import { sendToTool, useIncomingFiles } from '../../app/handoff';
import { formatBytes } from '../../lib/bytes';
import { allRows, displayValue, type Engine, insertArrowIpc, insertColumns, insertCsv, loadDuck, type QueryResult, quoteIdent, runQuery } from '../../lib/duck';
import { errorMessage } from '../../lib/errors';
import { type ChartKind, chartSvg } from '../../lib/svg-chart';
import { readTableFile, TABLE_ACCEPT } from '../../lib/table-files';
import { tableName, toDelimited, toJson, toMarkdown } from '../../lib/tabular';
import { copyText, saveFile } from '../../platform';
import { scrollRegion } from '../../ui/a11y';
import { CodeEditor } from '../../ui/CodeEditor';
import { Icon } from '../../ui/icons';
import { PreviewView } from '../../ui/Preview';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { MultiDrop } from './_files';
import { Segmented, usePersistentState } from './_shared';

const SAMPLE_VISITS = `date,gallery,visitors,school_groups
2026-11-02,Engine Hall,412,6
2026-11-02,Electrotechnic,288,4
2026-11-02,Space Gallery,530,9
2026-11-09,Engine Hall,455,7
2026-11-09,Electrotechnic,301,3
2026-11-09,Space Gallery,611,11
2026-11-16,Engine Hall,398,5
2026-11-16,Electrotechnic,342,6
2026-11-16,Space Gallery,575,8
`;

const SAMPLE_EXHIBITS = JSON.stringify(
  [
    { gallery: 'Engine Hall', exhibits: 24, floor: 'Ground', opened: '1962-07-14' },
    { gallery: 'Electrotechnic', exhibits: 31, floor: 'First', opened: '1965-01-26' },
    { gallery: 'Space Gallery', exhibits: 18, floor: 'Second', opened: '2008-11-14' },
  ],
  null,
  2,
);

const EXAMPLES: readonly { label: string; sql: (t: string) => string }[] = [
  { label: 'First 100 rows', sql: (t) => `SELECT * FROM ${t} LIMIT 100;` },
  { label: 'Count rows', sql: (t) => `SELECT count(*) AS rows FROM ${t};` },
  { label: 'Summarise every column', sql: (t) => `SUMMARIZE ${t};` },
  { label: 'Describe columns', sql: (t) => `DESCRIBE ${t};` },
];

interface TableInfo {
  readonly name: string;
  readonly rows: number;
  readonly columns: { readonly name: string; readonly type: string }[];
}

type Tab = 'results' | 'chart' | 'schema';

function DataPlayground({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState<{ sql: string; kind: ChartKind; x: string; ys: string[] }>(
    toolId,
    (s: Values | undefined) => ({
      sql: typeof s?.sql === 'string' ? s.sql : '',
      kind: (['bar', 'line', 'scatter', 'pie'] as const).find((k) => k === s?.kind) ?? 'bar',
      x: typeof s?.x === 'string' ? s.x : '',
      ys: Array.isArray(s?.ys) ? (s.ys as unknown[]).filter((y): y is string => typeof y === 'string') : [],
    }),
    (s) => ({ ...s }),
  );
  const engine = useRef<Engine | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('results');

  const getEngine = async () => {
    engine.current ??= await loadDuck();
    return engine.current;
  };

  const refresh = async () => {
    const e = await getEngine();
    const names = (await runQuery(e, "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name", 10_000)).rows.map((r) => String(r[0]));
    const infos: TableInfo[] = [];
    for (const name of names) {
      const count = await runQuery(e, `SELECT count(*) FROM ${quoteIdent(name)}`);
      const cols = await runQuery(e, `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${name.replace(/'/g, "''")}' ORDER BY ordinal_position`, 10_000);
      infos.push({ name, rows: Number(count.rows[0]?.[0] ?? 0), columns: cols.rows.map((r) => ({ name: String(r[0]), type: String(r[1]) })) });
    }
    setTables(infos);
    return infos;
  };

  const run = async (sql = state.sql) => {
    if (!sql.trim()) return;
    setBusy(true);
    try {
      const e = await getEngine();
      const r = await runQuery(e, sql);
      setResult(r);
      setError('');
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const openFiles = async (files: readonly File[], runFirst = true): Promise<string[]> => {
    if (!files.length) return [];
    setBusy(true);
    try {
      const e = await getEngine();
      const taken = new Set(tables.map((t) => t.name));
      const made: string[] = [];
      for (const file of files) {
        const sources = await readTableFile(file.name, new Uint8Array(await file.arrayBuffer()));
        for (const source of sources) {
          const name = tableName(source.name, taken);
          taken.add(name);
          if (source.kind === 'csv') await insertCsv(e, name, file.name, source.bytes);
          else if (source.kind === 'columns') await insertColumns(e, name, source.columns);
          else await insertArrowIpc(e, name, source.bytes);
          made.push(name);
        }
      }
      await refresh();
      const first = made[0];
      if (first && runFirst) {
        const sql = `SELECT * FROM ${quoteIdent(first)} LIMIT 100;`;
        setState((s) => ({ ...s, sql }));
        await run(sql);
      }
      notify(`Loaded ${made.length === 1 ? 'table' : 'tables'} ${made.join(', ')}.`);
      return made;
    } catch (err) {
      setError(errorMessage(err));
      return [];
    } finally {
      setBusy(false);
    }
  };

  useIncomingFiles((files) => void openFiles(files));

  const loadSample = async () => {
    const made = await openFiles([new File([SAMPLE_VISITS], 'visits.csv', { type: 'text/csv' }), new File([SAMPLE_EXHIBITS], 'galleries.json', { type: 'application/json' })], false);
    if (made.length < 2) return;
    const [visits, galleries] = made.map(quoteIdent) as [string, string];
    const sql = `SELECT v.gallery, sum(v.visitors) AS visitors, g.exhibits\nFROM ${visits} v JOIN ${galleries} g USING (gallery)\nGROUP BY v.gallery, g.exhibits\nORDER BY visitors DESC;`;
    setState((s) => ({ ...s, sql, x: 'gallery', ys: ['visitors'] }));
    await run(sql);
  };

  const exportAll = (format: 'csv' | 'json' | 'parquet' | 'markdown' | 'tsv') =>
    attempt(async () => {
      const e = await getEngine();
      const { header, rows } = await allRows(e, state.sql);
      if (format === 'csv') await saveFile('query.csv', toDelimited(header, rows), 'text/csv');
      else if (format === 'json') await saveFile('query.json', toJson(header, rows), 'application/json');
      else if (format === 'markdown') {
        await copyText(toMarkdown(header, rows));
        notify(`Copied ${rows.length} rows as a Markdown table.`);
      } else if (format === 'tsv') {
        await copyText(toDelimited(header, rows, '\t'));
        notify(`Copied ${rows.length} rows; paste them into a spreadsheet.`);
      } else {
        const { parquetWriteBuffer } = await import('hyparquet-writer');
        const columnData = header.map((name, i) => {
          const values = rows.map((r) => r[i] ?? null);
          const sample = values.find((v) => v !== null);
          if (typeof sample === 'bigint') return { name, data: values, type: 'INT64' as const };
          if (typeof sample === 'number') return { name, data: values.map((v) => (v === null ? null : Number(v))), type: 'DOUBLE' as const };
          if (typeof sample === 'boolean') return { name, data: values, type: 'BOOLEAN' as const };
          if (sample instanceof Date) return { name, data: values, type: 'TIMESTAMP' as const };
          return { name, data: values.map((v) => (v === null ? null : typeof v === 'string' ? v : displayValue(v))), type: 'STRING' as const };
        });
        await saveFile('query.parquet', new Uint8Array(parquetWriteBuffer({ columnData })), 'application/vnd.apache.parquet');
      }
    });

  const numericColumns = (result?.columns ?? []).filter((_c, i) => result?.rows.some((r) => typeof r[i] === 'number' || typeof r[i] === 'bigint')).map((c) => c.name);
  const chart = useMemo(() => {
    if (!result?.columns.length) return null;
    const names = result.columns.map((c) => c.name);
    const x = names.includes(state.x) ? state.x : (names[0] as string);
    const ys = state.ys.filter((y) => numericColumns.includes(y));
    const chosen = ys.length ? ys : numericColumns.filter((n) => n !== x).slice(0, state.kind === 'pie' ? 1 : 3);
    if (!chosen.length) return null;
    const xi = names.indexOf(x);
    const labels = result.rows.map((r) => displayValue(r[xi]));
    const series = (state.kind === 'pie' ? chosen.slice(0, 1) : chosen).map((name) => {
      const i = names.indexOf(name);
      return { name, values: result.rows.map((r) => (r[i] === null ? null : Number(r[i]))) };
    });
    return chartSvg(labels, series, { kind: state.kind, xLabel: state.kind === 'pie' ? undefined : x, yLabel: series.length === 1 ? series[0]?.name : undefined });
  }, [result, state.kind, state.x, state.ys.join('|')]);

  const loaded = tables.length > 0;
  return (
    <section class="tool dp-tool" data-testid="tool" data-state={busy ? 'busy' : result ? 'done' : 'idle'}>
      <div class="button-row">
        <MultiDrop icon="file" compact onFiles={(f) => void openFiles(f)} accept={TABLE_ACCEPT} title="Open data files" testId="dp-open" />
        <button type="button" class="button" onClick={() => void loadSample()} data-testid="dp-sample">
          <Icon name="sample" size={15} /> Sample data
        </button>
        <span class="control-help">CSV, TSV, JSON, NDJSON, Parquet, Excel, Avro, Arrow and SQLite. Each file becomes a table; nothing leaves this computer.</span>
      </div>
      <div class="sqlite-layout">
        <aside class="sqlite-tables" data-testid="dp-tables">
          <h3>Tables</h3>
          {!loaded && <p class="tone-muted">Open files or load the sample.</p>}
          <ul class="dp-table-list">
            {tables.map((t) => (
              <li key={t.name}>
                <details>
                  <summary>
                    <button
                      type="button"
                      class="link-button"
                      onClick={(e) => {
                        e.preventDefault();
                        const sql = `SELECT * FROM ${quoteIdent(t.name)} LIMIT 100;`;
                        setState((s) => ({ ...s, sql }));
                        void run(sql);
                      }}
                    >
                      {t.name}
                    </button>{' '}
                    <span class="tone-muted">{t.rows.toLocaleString()} rows</span>
                  </summary>
                  <ul class="dp-columns">
                    {t.columns.map((c) => (
                      <li key={c.name}>
                        <code>{c.name}</code> <span class="tone-muted">{c.type.toLowerCase()}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </aside>
        <div class="sqlite-main">
          <div
            class="pane sqlite-editor"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void run();
              }
            }}
          >
            <div class="pane-body">
              <CodeEditor value={state.sql} onChange={(sql) => setState((s) => ({ ...s, sql }))} language="sql" label="SQL" testId="dp-sql" placeholder="SELECT * FROM visits WHERE visitors > 400;" />
            </div>
            <div class="pane-footer button-row">
              <button type="button" class="button button-primary" onClick={() => void run()} disabled={busy} data-testid="dp-run">
                <Icon name="play" size={14} /> Run
              </button>
              <span class="control-help">Ctrl+Enter runs the query.</span>
              {loaded && (
                <select
                  class="select dp-examples"
                  aria-label="Example queries"
                  value=""
                  onChange={(e) => {
                    const ex = EXAMPLES[Number(e.currentTarget.value)];
                    const first = tables[0];
                    if (ex && first) {
                      const sql = ex.sql(quoteIdent(first.name));
                      setState((s) => ({ ...s, sql }));
                      void run(sql);
                    }
                  }}
                >
                  <option value="">Examples…</option>
                  {EXAMPLES.map((ex, i) => (
                    <option key={ex.label} value={i}>
                      {ex.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          {busy && !result && <p class="tone-muted">Starting DuckDB…</p>}
          {error && (
            <p class="recipe-error" role="alert" data-testid="dp-error">
              {error}
            </p>
          )}
          {result && (
            <>
              <div class="button-row dp-result-bar">
                <Segmented
                  label="Show"
                  value={tab}
                  onChange={setTab}
                  choices={[
                    { value: 'results', label: 'Results' },
                    { value: 'chart', label: 'Chart' },
                    { value: 'schema', label: 'Tables' },
                  ]}
                />
                <span class="tone-muted" data-testid="dp-summary">
                  {result.total.toLocaleString()} {result.total === 1 ? 'row' : 'rows'} in {result.ms < 1 ? '<1' : result.ms.toFixed(0)} ms
                  {result.total > result.rows.length ? ` (first ${result.rows.length.toLocaleString()} shown)` : ''}
                </span>
                {result.columns.length > 0 && (
                  <span class="dp-export">
                    <button type="button" class="button button-small" onClick={() => exportAll('csv')}>
                      CSV
                    </button>
                    <button type="button" class="button button-small" onClick={() => exportAll('json')}>
                      JSON
                    </button>
                    <button type="button" class="button button-small" onClick={() => exportAll('parquet')} data-testid="dp-parquet">
                      Parquet
                    </button>
                    <button type="button" class="button button-small button-quiet" onClick={() => exportAll('tsv')}>
                      Copy for a spreadsheet
                    </button>
                    <button type="button" class="button button-small button-quiet" onClick={() => exportAll('markdown')}>
                      Copy Markdown
                    </button>
                  </span>
                )}
              </div>
              {tab === 'results' && result.columns.length > 0 && (
                <div class="sqlite-results" {...scrollRegion('Query results')}>
                  <table class="data-table" data-testid="dp-results">
                    <thead>
                      <tr>
                        {result.columns.map((c) => (
                          <th key={c.name} title={c.type}>
                            {c.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, i) => (
                        <tr key={i}>
                          {row.map((v, j) => (
                            <td key={j} class={v === null ? 'is-null' : typeof v === 'number' || typeof v === 'bigint' ? 'is-number' : ''}>
                              {displayValue(v)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {tab === 'chart' && (
                <div class="dp-chart" data-testid="dp-chart">
                  <div class="button-row">
                    <Segmented
                      label="Chart type"
                      value={state.kind}
                      onChange={(kind) => setState((s) => ({ ...s, kind }))}
                      choices={[
                        { value: 'bar', label: 'Bar' },
                        { value: 'line', label: 'Line' },
                        { value: 'scatter', label: 'Scatter' },
                        { value: 'pie', label: 'Pie' },
                      ]}
                    />
                    <label class="control control-inline">
                      <span class="control-label">{state.kind === 'scatter' ? 'X (numbers)' : 'Labels'}</span>
                      <select class="select" value={state.x} onChange={(e) => setState((s) => ({ ...s, x: e.currentTarget.value }))}>
                        {result.columns.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <fieldset class="dp-series">
                      <legend>Values</legend>
                      {numericColumns.map((n) => (
                        <label key={n} class="check">
                          <input
                            type="checkbox"
                            checked={state.ys.includes(n)}
                            onChange={(e) => {
                              const on = e.currentTarget.checked;
                              setState((s) => ({ ...s, ys: on ? [...s.ys, n] : s.ys.filter((y) => y !== n) }));
                            }}
                          />{' '}
                          {n}
                        </label>
                      ))}
                    </fieldset>
                  </div>
                  {chart ? <PreviewView preview={{ kind: 'svg', svg: chart }} name="chart" /> : <p class="tone-muted">The result has no number columns to chart.</p>}
                </div>
              )}
              {tab === 'schema' && (
                <div class="dp-schema">
                  {tables.map((t) => (
                    <table key={t.name} class="data-table">
                      <caption>
                        {t.name} · {t.rows.toLocaleString()} rows
                      </caption>
                      <thead>
                        <tr>
                          <th>Column</th>
                          <th>Type</th>
                        </tr>
                      </thead>
                      <tbody>
                        {t.columns.map((c) => (
                          <tr key={c.name}>
                            <td>
                              <code>{c.name}</code>
                            </td>
                            <td>{c.type}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------- Parquet and Avro viewer -- */

interface FileReport {
  readonly name: string;
  readonly format: 'Parquet' | 'Avro';
  readonly size: number;
  readonly facts: { label: string; value: string }[];
  readonly schema: { name: string; type: string; detail: string }[];
  readonly metadata: { key: string; value: string }[];
  readonly header: string[];
  readonly rows: unknown[][];
  readonly total: number;
  readonly file: File;
}

const short = (text: string, n = 300) => (text.length > n ? `${text.slice(0, n)}…` : text);

async function inspect(file: File): Promise<FileReport> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (/\.avro$/i.test(file.name) || (bytes[0] === 0x4f && bytes[1] === 0x62 && bytes[2] === 0x6a && bytes[3] === 1)) {
    const { readAvroContainer, readAvroMeta } = await import('../../recipe/ops/avro');
    const meta = readAvroMeta(bytes);
    const records = readAvroContainer(bytes);
    const schema = meta.schema as { type?: string; name?: string; fields?: { name: string; type: unknown; doc?: string }[] };
    const fields = schema?.fields ?? [];
    const header = fields.length ? fields.map((f) => f.name) : ['value'];
    return {
      name: file.name,
      format: 'Avro',
      size: bytes.length,
      file,
      facts: [
        { label: 'Records', value: records.length.toLocaleString() },
        { label: 'Record type', value: `${schema?.name ?? schema?.type ?? '?'}` },
        { label: 'Compression', value: meta.codec },
      ],
      schema: fields.map((f) => ({ name: f.name, type: typeof f.type === 'string' ? f.type : JSON.stringify(f.type), detail: f.doc ?? '' })),
      metadata: Object.entries(meta.meta)
        .filter(([k]) => k !== 'avro.schema')
        .map(([key, value]) => ({ key, value: short(value) })),
      header,
      rows: records.slice(0, 500).map((r) => (fields.length ? header.map((h) => (r as Record<string, unknown>)[h] ?? null) : [r])),
      total: records.length,
    };
  }
  const { parquetMetadata, parquetReadObjects } = await import('hyparquet');
  const { compressors } = await import('hyparquet-compressors');
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const meta = parquetMetadata(buffer);
  const rows = (await parquetReadObjects({ file: buffer, compressors, rowEnd: 500 })) as Record<string, unknown>[];
  const leaves = meta.schema.slice(1);
  const codecs = new Set<string>();
  let compressed = 0;
  let uncompressed = 0;
  for (const g of meta.row_groups)
    for (const c of g.columns) {
      if (c.meta_data) {
        codecs.add(String(c.meta_data.codec));
        compressed += Number(c.meta_data.total_compressed_size);
        uncompressed += Number(c.meta_data.total_uncompressed_size);
      }
    }
  const header = rows.length ? Object.keys(rows[0] as object) : leaves.filter((s) => !s.num_children).map((s) => s.name);
  return {
    name: file.name,
    format: 'Parquet',
    size: bytes.length,
    file,
    facts: [
      { label: 'Rows', value: Number(meta.num_rows).toLocaleString() },
      { label: 'Row groups', value: String(meta.row_groups.length) },
      { label: 'Compression', value: [...codecs].join(', ') || 'none' },
      { label: 'Data', value: `${formatBytes(compressed)} compressed, ${formatBytes(uncompressed)} uncompressed` },
      { label: 'Written by', value: meta.created_by ?? 'not recorded' },
    ],
    schema: leaves.map((s) => ({
      name: s.name,
      type: s.num_children ? `group (${s.num_children})` : String(s.type ?? ''),
      detail: [s.logical_type ? JSON.stringify(s.logical_type) : s.converted_type, s.repetition_type].filter(Boolean).join(' · '),
    })),
    metadata: (meta.key_value_metadata ?? []).map((kv) => ({ key: kv.key, value: short(kv.value ?? '') })),
    header,
    rows: rows.map((r) => header.map((h) => r[h] ?? null)),
    total: Number(meta.num_rows),
  };
}

const cell = (v: unknown) =>
  v === null || v === undefined ? 'NULL' : typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)) : displayValue(v);

function ColumnarViewer() {
  const [report, setReport] = useState<FileReport | null>(null);
  const [error, setError] = useState('');
  const open = async (file: File | null | undefined) => {
    if (!file) return;
    try {
      setReport(await inspect(file));
      setError('');
    } catch (e) {
      setError(`${file.name}: ${errorMessage(e)}`);
    }
  };
  useIncomingFiles((files) => void open(files[0]));
  return (
    <section class="tool dp-tool" data-testid="tool" data-state={report ? 'done' : 'idle'}>
      <MultiDrop
        icon="file"
        onFiles={(f) => void open(f[0])}
        accept=".parquet,.avro"
        title="Open a Parquet or Avro file"
        hint="See its schema, metadata and rows. Nothing leaves this computer."
        testId="cv-open"
      />
      {error && (
        <p class="recipe-error" role="alert">
          {error}
        </p>
      )}
      {report && (
        <>
          <div class="cv-head">
            <h2>{report.name}</h2>
            <span class="tone-muted">
              {report.format} · {formatBytes(report.size)}
            </span>
            <span class="button-row">
              <button
                type="button"
                class="button button-small"
                onClick={() =>
                  attempt(
                    async () =>
                      void (await saveFile(
                        report.name.replace(/\.[^.]+$/, '.csv'),
                        toDelimited(
                          report.header,
                          report.rows.map((r) => r.map(cell)),
                        ),
                        'text/csv',
                      )),
                  )
                }
              >
                Save rows as CSV
              </button>
              <button
                type="button"
                class="button button-small"
                onClick={() => attempt(async () => void (await saveFile(report.name.replace(/\.[^.]+$/, '.json'), toJson(report.header, report.rows), 'application/json')))}
              >
                Save rows as JSON
              </button>
              <button type="button" class="button button-small button-primary" onClick={() => sendToTool('data-playground', { files: [report.file] })} data-testid="cv-query">
                Query with SQL
              </button>
            </span>
          </div>
          <dl class="cv-facts" data-testid="cv-facts">
            {report.facts.map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
          <details open>
            <summary>Schema ({report.schema.length} fields)</summary>
            <table class="data-table" data-testid="cv-schema">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Type</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {report.schema.map((s, i) => (
                  <tr key={`${s.name}-${i}`}>
                    <td>
                      <code>{s.name}</code>
                    </td>
                    <td>{s.type}</td>
                    <td class="tone-muted">{s.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
          {report.metadata.length > 0 && (
            <details>
              <summary>File metadata ({report.metadata.length})</summary>
              <dl class="cv-meta">
                {report.metadata.map((m) => (
                  <div key={m.key}>
                    <dt>{m.key}</dt>
                    <dd>
                      <code>{m.value}</code>
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          <p class="tone-muted">
            {report.total > report.rows.length ? `First ${report.rows.length} of ${report.total.toLocaleString()} rows; save or query to get all of them.` : `${report.rows.length} rows.`}
          </p>
          <div class="sqlite-results" {...scrollRegion('Rows')}>
            <table class="data-table" data-testid="cv-rows">
              <thead>
                <tr>
                  {report.header.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((v, j) => (
                      <td key={j} class={v === null ? 'is-null' : ''}>
                        {cell(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function DataPlay({ toolId }: { toolId: string }) {
  if (toolId === 'parquet-avro-viewer') return <ColumnarViewer />;
  return <DataPlayground toolId={toolId} />;
}

export default defineCustomTool(DataPlay);
