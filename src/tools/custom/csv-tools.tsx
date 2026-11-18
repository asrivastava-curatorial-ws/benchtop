/** Merge several CSV files into one, or split one into several, in the page. */

import { zipSync } from 'fflate';
import { useMemo, useState } from 'preact/hooks';
import { useIncomingFiles } from '../../app/handoff';
import { mergeTables, splitByColumn, splitByRows, type Table } from '../../lib/csv-merge';
import { pickFiles, readTextFile, saveFile } from '../../platform';
import { cjs } from '../../recipe/core';
import { scrollRegion } from '../../ui/a11y';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';

type Papa = typeof import('papaparse');

async function papa(): Promise<Papa> {
  return cjs(await import('papaparse')) as Papa;
}

async function readTable(file: File): Promise<Table> {
  const text = await readTextFile(file);
  const parsed = (await papa()).parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' });
  const [header = [], ...rows] = parsed.data;
  if (!header.length) throw new Error(`${file.name} has no rows.`);
  return { name: file.name, header: header.map((h, i) => h.trim() || `Column ${i + 1}`), rows };
}

const DELIMITERS = { ',': 'Comma', ';': 'Semicolon', '\t': 'Tab' } as const;
type Delimiter = keyof typeof DELIMITERS;

interface Settings {
  readonly mode: 'merge' | 'split';
  readonly byName: boolean;
  readonly source: boolean;
  readonly dedupe: boolean;
  readonly delimiter: Delimiter;
  readonly splitBy: 'rows' | 'column';
  readonly size: number;
  readonly bom: boolean;
}

const read = (s: Values | undefined): Settings => ({
  mode: s?.mode === 'split' ? 'split' : 'merge',
  byName: s?.byName !== false,
  source: s?.source === true,
  dedupe: s?.dedupe === true,
  delimiter: (Object.keys(DELIMITERS) as Delimiter[]).find((d) => d === s?.delimiter) ?? ',',
  splitBy: s?.splitBy === 'column' ? 'column' : 'rows',
  size: typeof s?.size === 'number' && s.size >= 1 ? Math.floor(s.size) : 1000,
  bom: s?.bom === true,
});

async function toCsv(table: Table, settings: Settings): Promise<string> {
  const csv = (await papa()).unparse([table.header as string[], ...(table.rows as string[][])], { delimiter: settings.delimiter, newline: '\r\n' });
  // A byte order mark helps Excel recognise UTF-8.
  return `${settings.bom ? '\uFEFF' : ''}${csv}\r\n`;
}

function Preview({ table }: { table: Table }) {
  const shown = table.rows.slice(0, 50);
  return (
    <div class="csv-preview" {...scrollRegion('Table preview')}>
      <table>
        <thead>
          <tr>
            {table.header.map((h, i) => (
              <th key={`${h}-${i}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, r) => (
            <tr key={r}>
              {table.header.map((_, c) => (
                <td key={c}>{row[c] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.rows.length > shown.length && (
        <p class="tone-muted pdf-note">
          First {shown.length} of {table.rows.length.toLocaleString()} rows.
        </p>
      )}
    </div>
  );
}

function CsvTools({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState<Settings>(toolId, read, (s) => ({ ...s }));
  const set = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));
  const [tables, setTables] = useState<Table[]>([]);
  const [column, setColumn] = useState(0);

  const add = (files: File[]) =>
    void attempt(async () => {
      const loaded: Table[] = [];
      for (const file of files) loaded.push(await readTable(file));
      setTables((list) => (settings.mode === 'split' ? loaded.slice(0, 1) : [...list, ...loaded]));
      setColumn(0);
    });
  useIncomingFiles(add);

  const merged = useMemo(() => {
    if (settings.mode !== 'merge' || !tables.length) return null;
    try {
      return mergeTables(tables, settings);
    } catch {
      return null;
    }
  }, [tables, settings]);

  const parts = useMemo(() => {
    const table = tables[0];
    if (settings.mode !== 'split' || !table) return [];
    const base = table.name.replace(/\.[^.]+$/, '');
    try {
      return settings.splitBy === 'rows' ? splitByRows(table, settings.size, base) : splitByColumn(table, column, base);
    } catch {
      return [];
    }
  }, [tables, settings, column]);

  const save = () =>
    void attempt(async () => {
      if (settings.mode === 'merge' && merged) {
        const saved = await saveFile('merged.csv', await toCsv(merged, settings), 'text/csv');
        if (saved.saved) notify(`Saved to ${saved.location}`);
        return;
      }
      if (!parts.length) return;
      const files: Record<string, Uint8Array> = {};
      for (const part of parts) files[part.name] = new TextEncoder().encode(await toCsv(part, settings));
      const base = (tables[0]?.name ?? 'table').replace(/\.[^.]+$/, '');
      const saved = await saveFile(`${base} (split).zip`, zipSync(files, { level: 6 }), 'application/zip');
      if (saved.saved) notify(`Saved ${parts.length} files to ${saved.location}`);
    });

  const choose = () => attempt(async () => add(await pickFiles('.csv,.tsv,.txt,text/csv')));
  return (
    <div data-testid="tool" class="tool ai-tool">
      <div class="ai-controls">
        <Segmented
          label="Task"
          small={false}
          value={settings.mode}
          onChange={(mode) => {
            set({ mode });
            setTables((list) => (mode === 'split' ? list.slice(0, 1) : list));
          }}
          choices={[
            { value: 'merge', label: 'Merge files' },
            { value: 'split', label: 'Split a file' },
          ]}
        />
        <button
          type="button"
          class="dropzone dropzone-compact"
          onClick={choose}
          onDragOver={(e) => {
            if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
          }}
          onDrop={(e) => {
            const files = Array.from(e.dataTransfer?.files ?? []);
            if (files.length) {
              e.preventDefault();
              add(settings.mode === 'split' ? files.slice(0, 1) : files);
            }
          }}
          data-testid="csv-drop"
        >
          <Icon name="file" size={20} />
          <span class="dropzone-title">
            {settings.mode === 'merge' ? (tables.length ? 'Add more CSV files' : 'Choose or drop CSV files') : tables.length ? 'Choose another CSV file' : 'Choose or drop a CSV file'}
          </span>
        </button>
        {tables.length > 0 && (
          <ul class="pdf-sources">
            {tables.map((t, i) => (
              <li key={`${t.name}-${i}`}>
                <span class="pdf-source-mark" data-source={i % 6} aria-hidden="true" />
                <span class="pdf-source-name">{t.name}</span>
                <span class="tone-muted">{t.rows.length.toLocaleString()} rows</span>
                <button type="button" class="icon-button" aria-label={`Remove ${t.name}`} onClick={() => setTables((list) => list.filter((_, j) => j !== i))}>
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {settings.mode === 'merge' ? (
          <>
            <div class="control">
              <span class="control-label">Columns</span>
              <Segmented
                label="Columns"
                small={false}
                value={settings.byName ? 'name' : 'order'}
                onChange={(v) => set({ byName: v === 'name' })}
                choices={[
                  { value: 'name', label: 'Match by name' },
                  { value: 'order', label: 'Keep their order' },
                ]}
              />
            </div>
            <label class="toggle" for="csv-source">
              <input id="csv-source" type="checkbox" role="switch" aria-checked={settings.source} checked={settings.source} onChange={(e) => set({ source: e.currentTarget.checked })} />
              <span class="toggle-track" aria-hidden="true" />
              <span>Add a column with the file name</span>
            </label>
            <label class="toggle" for="csv-dedupe">
              <input id="csv-dedupe" type="checkbox" role="switch" aria-checked={settings.dedupe} checked={settings.dedupe} onChange={(e) => set({ dedupe: e.currentTarget.checked })} />
              <span class="toggle-track" aria-hidden="true" />
              <span>Remove repeated rows</span>
            </label>
          </>
        ) : (
          <>
            <div class="control">
              <span class="control-label">Split</span>
              <Segmented
                label="Split"
                small={false}
                value={settings.splitBy}
                onChange={(splitBy) => set({ splitBy })}
                choices={[
                  { value: 'rows', label: 'Every N rows' },
                  { value: 'column', label: 'By a column’s value' },
                ]}
              />
            </div>
            {settings.splitBy === 'rows' ? (
              <div class="control">
                <label class="control-label" for="csv-size">
                  Rows per file
                </label>
                <input id="csv-size" class="input input-number" type="number" min={1} value={settings.size} onInput={(e) => set({ size: Math.max(1, Number(e.currentTarget.value) || 1) })} />
              </div>
            ) : (
              <div class="control">
                <label class="control-label" for="csv-column">
                  Column
                </label>
                <select id="csv-column" class="input" value={column} onChange={(e) => setColumn(Number(e.currentTarget.value))}>
                  {(tables[0]?.header ?? []).map((h, i) => (
                    <option key={`${h}-${i}`} value={i}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}
        <div class="control">
          <label class="control-label" for="csv-delimiter">
            Separator in the saved file
          </label>
          <select id="csv-delimiter" class="input" value={settings.delimiter} onChange={(e) => set({ delimiter: e.currentTarget.value as Delimiter })}>
            {(Object.keys(DELIMITERS) as Delimiter[]).map((d) => (
              <option key={d} value={d}>
                {DELIMITERS[d]}
              </option>
            ))}
          </select>
        </div>
        <label class="toggle" for="csv-bom">
          <input id="csv-bom" type="checkbox" role="switch" aria-checked={settings.bom} checked={settings.bom} onChange={(e) => set({ bom: e.currentTarget.checked })} />
          <span class="toggle-track" aria-hidden="true" />
          <span>Mark as UTF-8 for Excel</span>
        </label>
        <button type="button" class="button button-primary" disabled={settings.mode === 'merge' ? !merged : !parts.length} onClick={save} data-testid="csv-save">
          {settings.mode === 'merge' ? `Save merged CSV${merged ? ` (${merged.rows.length.toLocaleString()} rows)` : ''}` : parts.length ? `Save ${parts.length} files as a ZIP` : 'Save'}
        </button>
      </div>
      <div class="ai-work">
        {settings.mode === 'merge' && merged && <Preview table={merged} />}
        {settings.mode === 'split' && parts.length > 0 && (
          <ul class="pdf-plan" data-testid="csv-parts">
            {parts.slice(0, 200).map((p) => (
              <li key={p.name}>
                <span>{p.name}</span>
                <span class="tone-muted">{p.rows.length.toLocaleString()} rows</span>
              </li>
            ))}
            {parts.length > 200 && <li class="tone-muted">and {parts.length - 200} more</li>}
          </ul>
        )}
        {!tables.length && <p class="tone-muted">Files are read on this computer. The first row of each file is treated as the column names.</p>}
      </div>
    </div>
  );
}

export default defineCustomTool(CsvTools);
