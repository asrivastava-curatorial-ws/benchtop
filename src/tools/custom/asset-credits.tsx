/**
 * Asset Credits: everything saved by Asset Finder (or any asset.json files you
 * add), with its licence checked against how you will use it and against the
 * copyright term in India, and credits made for panels, films and websites.
 * Works offline: it only reads the records kept beside the files.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { checkUse, creditLine, explain, indiaCheck, type Licence, type LicenceCode, parseLicence, shortCredit, USES } from '../../lib/assets/licences';
import { type AssetType, type AssetUse, isAssetType, typeLabel } from '../../lib/assets/model';
import { isDesktop, pickFiles, readTextFile, saveFile } from '../../platform';
import * as shell from '../../platform/assets';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { usePersistentState } from './_shared';

export interface CreditRecord {
  readonly key: string;
  readonly title: string;
  readonly creator: string;
  readonly page: string;
  readonly sourceName: string;
  readonly type: AssetType;
  readonly licence: Licence;
  readonly year?: number;
  readonly deathYear?: number;
  readonly folder: string;
  readonly files: number;
}

const CODES: readonly LicenceCode[] = [
  'cc0',
  'pdm',
  'pd',
  'us-gov',
  'nkr',
  'by',
  'by-sa',
  'by-nc',
  'by-nc-sa',
  'by-nd',
  'by-nc-nd',
  'pexels',
  'pixabay',
  'unsplash',
  'ofl',
  'mit',
  'apache',
  'gpl',
  'gfdl',
  'other-free',
  'restricted',
  'unknown',
];
const text = (v: unknown, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const year = (v: unknown) => (typeof v === 'number' && v > 1000 && v < 3000 ? Math.round(v) : undefined);

/** Reads one asset.json (as Asset Finder writes it); null when it is not one. */
export function readRecord(raw: unknown, fallbackKey: string): CreditRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const title = text(r.title, 300);
  if (!title && !text(r.id)) return null;
  const l = r.licence && typeof r.licence === 'object' ? (r.licence as Record<string, unknown>) : {};
  const licence: Licence = CODES.includes(l.code as LicenceCode)
    ? { code: l.code as LicenceCode, name: text(l.name, 120) || String(l.code), url: text(l.url), version: text(l.version, 10), note: text(l.note) }
    : parseLicence(text(l.name) || text(r.licence), text(l.url));
  const source = r.source && typeof r.source === 'object' ? (r.source as Record<string, unknown>) : {};
  const folder = Array.isArray(r._folder) ? (r._folder as unknown[]).map((s) => text(s, 200)).join(' › ') : '';
  const y = year(r.year);
  const d = year(r.deathYear);
  return {
    key: folder || `${text(source.id)}:${text(r.id)}` || fallbackKey,
    title: title || 'Untitled',
    creator: text(r.creator, 300),
    page: /^https:\/\//.test(text(r.page)) ? text(r.page) : '',
    sourceName: text(source.name, 120) || text(source.id, 60),
    type: isAssetType(r.type) ? r.type : 'image',
    licence,
    ...(y ? { year: y } : {}),
    ...(d ? { deathYear: d } : {}),
    folder,
    files: Array.isArray(r.files) ? r.files.length : 0,
  };
}

const kindOf = (type: AssetType) => (type === 'video' || type === 'video3d' ? 'film' : type === 'audio' ? 'sound' : 'other');
const credit = (r: CreditRecord) => ({ title: r.title, creator: r.creator, page: r.page, sourceName: r.sourceName, licence: r.licence });
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const escapeHtml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export type CreditFormat = 'txt' | 'md' | 'html' | 'csv' | 'film';

/** The credits in one of the export formats. */
export function exportCredits(list: readonly CreditRecord[], format: CreditFormat, use: AssetUse, willChange = false): string {
  switch (format) {
    case 'csv': {
      const head = ['Title', 'Creator', 'Library', 'Kind', 'Source page', 'Licence', 'Licence link', 'Credit line', 'For this use', 'In India', 'Folder'];
      const rows = list.map((r) => {
        const worst = checkUse(r.licence, use, willChange)[0];
        return [
          r.title,
          r.creator,
          r.sourceName,
          typeLabel(r.type),
          r.page,
          r.licence.name,
          r.licence.url,
          creditLine(credit(r)),
          worst ? `${worst.level}: ${worst.text}` : '',
          indiaCheck(r.licence, kindOf(r.type), r.deathYear, r.year).text,
          r.folder,
        ];
      });
      return `${[head, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
    }
    case 'md':
      return `# Credits\n\n${list.map((r) => `- ${r.page ? `[${r.title}](${r.page})` : r.title}${r.creator ? ` by ${r.creator}` : ''}, ${r.sourceName}. ${r.licence.url ? `[${r.licence.name}](${r.licence.url})` : r.licence.name}.`).join('\n')}\n`;
    case 'html':
      return `<section class="credits">\n<h2>Credits</h2>\n<ul>\n${list
        .map((r) => {
          const title = r.page ? `<a href="${escapeHtml(r.page)}">${escapeHtml(r.title)}</a>` : escapeHtml(r.title);
          const licence = r.licence.url ? `<a href="${escapeHtml(r.licence.url)}" rel="license">${escapeHtml(r.licence.name)}</a>` : escapeHtml(r.licence.name);
          return `  <li>${title}${r.creator ? ` by ${escapeHtml(r.creator)}` : ''}, ${escapeHtml(r.sourceName)}. ${licence}.</li>`;
        })
        .join('\n')}\n</ul>\n</section>\n`;
    case 'film': {
      const groups = new Map<string, CreditRecord[]>();
      for (const r of list) groups.set(typeLabel(r.type), [...(groups.get(typeLabel(r.type)) ?? []), r]);
      return [...groups].map(([kind, rows]) => `${kind.toUpperCase()}\n\n${rows.map((r) => shortCredit(credit(r))).join('\n')}`).join('\n\n\n') + '\n';
    }
    default:
      return `${list.map((r) => creditLine(credit(r))).join('\n')}\n`;
  }
}

interface Prefs {
  readonly use: AssetUse;
  readonly willChange: boolean;
  readonly problemsOnly: boolean;
}
const readPrefs = (s: Values | undefined): Prefs => ({
  use: USES.some((u) => u.id === s?.use) ? (s?.use as AssetUse) : 'free',
  willChange: s?.willChange === true,
  problemsOnly: s?.problemsOnly === true,
});
const writePrefs = (p: Prefs): Values => ({ ...p });

const FORMATS: readonly { id: CreditFormat; label: string; ext: string; mime: string }[] = [
  { id: 'txt', label: 'Credit lines (text)', ext: 'txt', mime: 'text/plain' },
  { id: 'film', label: 'End credits for a film', ext: 'txt', mime: 'text/plain' },
  { id: 'md', label: 'Markdown', ext: 'md', mime: 'text/markdown' },
  { id: 'html', label: 'HTML for a website', ext: 'html', mime: 'text/html' },
  { id: 'csv', label: 'Spreadsheet (CSV)', ext: 'csv', mime: 'text/csv' },
];

function AssetCredits({ toolId }: { toolId: string }) {
  const [prefs, setPrefs] = usePersistentState(toolId, readPrefs, writePrefs);
  const [list, setList] = useState<CreditRecord[]>([]);
  const [filter, setFilter] = useState('');
  const [format, setFormat] = useState<CreditFormat>('txt');
  const [probe, setProbe] = useState('');
  const [loaded, setLoaded] = useState('');

  const fromLibrary = () =>
    attempt(async () => {
      const raw = await shell.libraryRecords();
      const read = raw.map((r, i) => readRecord(r, `library-${i}`)).filter((r): r is CreditRecord => r !== null);
      setList(read);
      setLoaded(`${read.length} assets from the library.`);
    });

  useEffect(() => {
    if (!isDesktop) return;
    void shell.libraryFolder().then((folder) => {
      if (folder) void fromLibrary();
    });
  }, []);

  const addFiles = () =>
    attempt(async () => {
      const files = await pickFiles('.json,application/json');
      const added: CreditRecord[] = [];
      for (const file of files) {
        try {
          const record = readRecord(JSON.parse(await readTextFile(file)), file.name);
          if (record) added.push(record);
        } catch {}
      }
      if (!added.length) throw new Error('None of those files is an asset record (asset.json).');
      setList((old) => [...old.filter((o) => !added.some((a) => a.key === o.key)), ...added]);
      notify(`${added.length} record${added.length === 1 ? '' : 's'} added.`);
    });

  const shown = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    return list.filter((r) => {
      if (words.length && !words.every((w) => `${r.title} ${r.creator} ${r.sourceName} ${r.licence.name} ${r.folder}`.toLowerCase().includes(w))) return false;
      if (!prefs.problemsOnly) return true;
      const worst = checkUse(r.licence, prefs.use, prefs.willChange)[0];
      return worst?.level === 'stop' || worst?.level === 'warn' || indiaCheck(r.licence, kindOf(r.type), r.deathYear, r.year).status === 'check';
    });
  }, [list, filter, prefs]);

  const probed = probe.trim() ? parseLicence(/^https?:/.test(probe.trim()) ? '' : probe.trim(), /^https?:/.test(probe.trim()) ? probe.trim() : '') : null;
  const fmt = FORMATS.find((f) => f.id === format) ?? FORMATS[0];

  return (
    <section class="tool ac" data-testid="tool" data-state={list.length ? 'done' : 'idle'}>
      <div class="ac-bar">
        {isDesktop && (
          <button type="button" class="button button-primary" onClick={() => void fromLibrary()}>
            <Icon name="refresh" size={14} /> Read the library
          </button>
        )}
        <button type="button" class="button" onClick={() => void addFiles()} data-testid="ac-add">
          <Icon name="file" size={14} /> Add asset.json files…
        </button>
        {list.length > 0 && (
          <button
            type="button"
            class="button button-quiet"
            onClick={() => {
              setList([]);
              setLoaded('');
            }}
          >
            Clear
          </button>
        )}
        <span class="ac-status" role="status">
          {loaded || (list.length ? `${list.length} assets` : '')}
        </span>
      </div>
      <div class="ac-bar">
        <label class="af-field">
          <span class="control-label">Used for</span>
          <select class="input" value={prefs.use} onChange={(e) => setPrefs({ ...prefs, use: e.currentTarget.value as AssetUse })} data-testid="ac-use">
            {USES.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
        <label class="check">
          <input type="checkbox" checked={prefs.willChange} onChange={(e) => setPrefs({ ...prefs, willChange: e.currentTarget.checked })} />
          Changed (cropped, edited, dubbed)
        </label>
        <label class="check">
          <input type="checkbox" checked={prefs.problemsOnly} onChange={(e) => setPrefs({ ...prefs, problemsOnly: e.currentTarget.checked })} />
          Only those to check
        </label>
        <label class="af-field ac-filter">
          <span class="control-label">Find</span>
          <input class="input" type="search" value={filter} onInput={(e) => setFilter(e.currentTarget.value)} />
        </label>
      </div>

      {list.length === 0 ? (
        <p class="empty-state">
          {isDesktop
            ? 'Nothing yet: download assets with Asset Finder (each comes with an asset.json record), choose its library folder, or add asset.json files.'
            : 'Add the asset.json records that Asset Finder keeps beside each download to check their licences and make credits.'}
        </p>
      ) : (
        <div class="ac-table-wrap">
          <table class="ac-table" data-testid="ac-table">
            <thead>
              <tr>
                <th scope="col">Asset</th>
                <th scope="col">Licence</th>
                <th scope="col">For this use</th>
                <th scope="col">In India</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const checks = checkUse(r.licence, prefs.use, prefs.willChange);
                const india = indiaCheck(r.licence, kindOf(r.type), r.deathYear, r.year);
                return (
                  <tr key={r.key}>
                    <td>
                      <strong>{r.title}</strong>
                      <span class="ac-sub">{[r.creator, r.sourceName, typeLabel(r.type)].filter(Boolean).join(' · ')}</span>
                      {r.folder && <span class="ac-sub">{r.folder}</span>}
                    </td>
                    <td title={explain(r.licence)}>{r.licence.name}</td>
                    <td>
                      <ul class="af-checks">
                        {checks.map((c) => (
                          <li key={c.text} class={`af-check-${c.level}`}>
                            {c.text}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td class={`af-india-${india.status}`}>{india.text}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {list.length > 0 && (
        <div class="ac-export">
          <label class="af-field">
            <span class="control-label">Credits as</span>
            <select class="input" value={format} onChange={(e) => setFormat(e.currentTarget.value as CreditFormat)} data-testid="ac-format">
              {FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <textarea class="input ac-output" readOnly rows={8} value={exportCredits(shown, format, prefs.use, prefs.willChange)} aria-label="Credits" data-testid="ac-output" />
          <button
            type="button"
            class="button"
            onClick={() => void attempt(() => saveFile(`credits.${fmt?.ext ?? 'txt'}`, exportCredits(shown, format, prefs.use, prefs.willChange), fmt?.mime ?? 'text/plain').then(() => undefined))}
          >
            <Icon name="save" size={14} /> Save
          </button>
        </div>
      )}

      <section class="ac-probe" aria-label="Check a licence">
        <label class="af-field">
          <span class="control-label">Check a licence: paste its name or link</span>
          <input
            class="input"
            type="text"
            value={probe}
            placeholder="https://creativecommons.org/licenses/by-nc/4.0/  or  CC BY-SA 3.0"
            onInput={(e) => setProbe(e.currentTarget.value)}
            data-testid="ac-probe"
          />
        </label>
        {probed && (
          <div class="ac-probe-result" data-testid="ac-probe-result">
            <p>
              <strong>{probed.name}</strong>: {explain(probed)}
            </p>
            <ul class="af-checks">
              {checkUse(probed, prefs.use, prefs.willChange).map((c) => (
                <li key={c.text} class={`af-check-${c.level}`}>
                  {c.text}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </section>
  );
}

export default defineCustomTool(AssetCredits);
