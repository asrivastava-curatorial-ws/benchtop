/** Opens ZIP, TAR and GZip archives (including ZipCrypto passwords) and makes ZIP files, in the page. */

import { gunzipSync, zipSync } from 'fflate';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useIncomingFiles } from '../../app/handoff';
import { formatBytes } from '../../lib/bytes';
import { pickFiles, saveFile } from '../../platform';
import { untar, unzip } from '../../recipe/ops/compression';
import { scrollRegion } from '../../ui/a11y';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';

interface Entry {
  readonly name: string;
  readonly bytes: Uint8Array;
}

const MAX_ARCHIVE = 500 * 1024 * 1024;

export async function openArchive(name: string, bytes: Uint8Array, password: string): Promise<Entry[]> {
  const lower = name.toLowerCase();
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return unzip(bytes, password);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const inner = gunzipSync(bytes);
    // A .tar.gz has the "ustar" magic at offset 257 once unpacked.
    if (/\.(tgz|tar\.gz)$/.test(lower) || new TextDecoder().decode(inner.subarray(257, 262)) === 'ustar') return untar(inner);
    return [{ name: name.replace(/\.gz$/i, '') || 'file', bytes: inner }];
  }
  if (new TextDecoder().decode(bytes.subarray(257, 262)) === 'ustar' || lower.endsWith('.tar')) return untar(bytes);
  throw new Error('This is not a ZIP, TAR or GZip file.');
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const TEXT = /\.(txt|md|csv|tsv|json|xml|html?|css|js|ts|tsx|jsx|ya?ml|toml|ini|cfg|conf|log|py|rs|go|java|c|h|cpp|sh|bat|ps1|sql|svg|env)$/i;

function EntryPreview({ entry }: { entry: Entry }) {
  const url = useMemo(() => (IMAGE.test(entry.name) ? URL.createObjectURL(new Blob([entry.bytes as BlobPart], { type: entry.name.endsWith('.svg') ? 'image/svg+xml' : '' })) : null), [entry]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  if (url) return <img class="zip-preview-image" src={url} alt={entry.name} />;
  if (TEXT.test(entry.name) || entry.bytes.subarray(0, 4096).every((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b !== 127)))
    return <pre class="zip-preview-text">{new TextDecoder().decode(entry.bytes.subarray(0, 100_000))}</pre>;
  return <p class="tone-muted">No preview for this kind of file.</p>;
}

interface Settings {
  readonly mode: 'open' | 'make';
  readonly level: number;
}

const read = (s: Values | undefined): Settings => ({ mode: s?.mode === 'make' ? 'make' : 'open', level: typeof s?.level === 'number' ? Math.min(9, Math.max(0, s.level)) : 6 });

function ArchiveTool({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState<Settings>(toolId, read, (s) => ({ ...s }));
  const [archive, setArchive] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Entry | null>(null);
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [zipName, setZipName] = useState('archive.zip');

  const open = (name: string, bytes: Uint8Array, pass: string) =>
    void attempt(async () => {
      try {
        const list = await openArchive(name, bytes, pass);
        setEntries(list);
        setSelected(new Set());
        setPreview(null);
        setNeedsPassword(false);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/password/i.test(message)) {
          setNeedsPassword(true);
          setEntries([]);
          if (pass) throw error;
          return;
        }
        throw error;
      }
    });

  const take = (list: File[]) =>
    void attempt(async () => {
      const file = list[0];
      if (!file) return;
      if (file.size > MAX_ARCHIVE) throw new Error('Archives larger than 500 MB are not supported here.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      setArchive({ name: file.name, bytes });
      setPassword('');
      open(file.name, bytes, '');
    });
  useIncomingFiles(take);

  const total = entries.reduce((s, e) => s + e.bytes.length, 0);
  const saveEntry = (entry: Entry) =>
    void attempt(async () => {
      const saved = await saveFile(entry.name.split('/').pop() || 'file', entry.bytes);
      if (saved.saved) notify(`Saved to ${saved.location}`);
    });
  const saveSelected = () =>
    void attempt(async () => {
      const chosen = entries.filter((e) => selected.has(e.name));
      const out: Record<string, Uint8Array> = {};
      for (const e of chosen.length ? chosen : entries) out[e.name] = e.bytes;
      const base = (archive?.name ?? 'archive').replace(/\.(zip|tar|tgz|tar\.gz|gz)$/i, '');
      const saved = await saveFile(`${base} (${chosen.length ? `${chosen.length} files` : 'all'}).zip`, zipSync(out, { level: 6 }), 'application/zip');
      if (saved.saved) notify(`Saved to ${saved.location}`);
    });
  const make = () =>
    void attempt(async () => {
      const out: Record<string, Uint8Array> = {};
      const used = new Set<string>();
      for (const file of files) {
        let name = file.webkitRelativePath || file.name;
        for (let n = 2; used.has(name); n++) name = file.name.replace(/(\.[^.]*)?$/, ` (${n})$1`);
        used.add(name);
        out[name] = new Uint8Array(await file.arrayBuffer());
      }
      const name = zipName.trim().replace(/\.zip$/i, '') || 'archive';
      const saved = await saveFile(`${name}.zip`, zipSync(out, { level: settings.level as 0 | 1 | 6 | 9 }), 'application/zip');
      if (saved.saved) notify(`Saved to ${saved.location}`);
    });

  return (
    <div data-testid="tool" class="tool ai-tool">
      <div class="ai-controls">
        <Segmented
          label="Task"
          small={false}
          value={settings.mode}
          onChange={(mode) => setSettings((s) => ({ ...s, mode }))}
          choices={[
            { value: 'open', label: 'Open an archive' },
            { value: 'make', label: 'Make a ZIP' },
          ]}
        />
        {settings.mode === 'open' ? (
          <>
            <button
              type="button"
              class="dropzone dropzone-compact"
              onClick={() => attempt(async () => take(await pickFiles('.zip,.tar,.tgz,.gz,application/zip,application/gzip')))}
              onDragOver={(e) => {
                if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
              }}
              onDrop={(e) => {
                const list = Array.from(e.dataTransfer?.files ?? []);
                if (list.length) {
                  e.preventDefault();
                  take(list);
                }
              }}
              data-testid="zip-drop"
            >
              <Icon name="file" size={20} />
              <span class="dropzone-title">{archive ? archive.name : 'Choose or drop a ZIP, TAR or .gz file'}</span>
            </button>
            {needsPassword && archive && (
              <form
                class="control"
                onSubmit={(e) => {
                  e.preventDefault();
                  open(archive.name, archive.bytes, password);
                }}
              >
                <label class="control-label" for="zip-password">
                  This archive is protected with a password
                </label>
                <input id="zip-password" class="input" type="password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} autocomplete="off" />
                <button type="submit" class="button">
                  Open
                </button>
                <span class="control-hint tone-muted">Traditional ZIP passwords (ZipCrypto) are supported; AES-encrypted ZIPs are not.</span>
              </form>
            )}
            {entries.length > 0 && (
              <>
                <p class="tone-muted pdf-note" data-testid="zip-summary">
                  {entries.length} files, {formatBytes(total)} unpacked.
                </p>
                <button type="button" class="button button-primary" onClick={saveSelected}>
                  {selected.size ? `Save ${selected.size} selected as ZIP` : 'Save all as ZIP'}
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              class="dropzone dropzone-compact"
              onClick={() =>
                attempt(async () => {
                  const list = await pickFiles('');
                  setFiles((current) => [...current, ...list]);
                })
              }
              onDragOver={(e) => {
                if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
              }}
              onDrop={(e) => {
                const list = Array.from(e.dataTransfer?.files ?? []);
                if (list.length) {
                  e.preventDefault();
                  setFiles((current) => [...current, ...list]);
                }
              }}
              data-testid="zip-add"
            >
              <Icon name="file" size={20} />
              <span class="dropzone-title">{files.length ? 'Add more files' : 'Choose or drop files'}</span>
            </button>
            <div class="control">
              <label class="control-label" for="zip-level">
                Compression
              </label>
              <select id="zip-level" class="input" value={settings.level} onChange={(e) => setSettings((s) => ({ ...s, level: Number(e.currentTarget.value) }))}>
                <option value={0}>None (fastest; for photos and videos)</option>
                <option value={1}>Fast</option>
                <option value={6}>Normal</option>
                <option value={9}>Smallest</option>
              </select>
            </div>
            <div class="control">
              <label class="control-label" for="zip-name">
                Name
              </label>
              <input id="zip-name" class="input" value={zipName} onInput={(e) => setZipName(e.currentTarget.value)} />
            </div>
            <button type="button" class="button button-primary" disabled={!files.length} onClick={make} data-testid="zip-make">
              Save ZIP of {files.length} file{files.length === 1 ? '' : 's'}
            </button>
          </>
        )}
      </div>
      <div class="ai-work">
        {settings.mode === 'open' && entries.length > 0 && (
          <div class="zip-layout">
            <ul class="zip-list" data-testid="zip-list">
              {entries.map((entry) => {
                const slash = entry.name.lastIndexOf('/');
                return (
                  <li key={entry.name} class={preview?.name === entry.name ? 'is-current' : ''}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${entry.name}`}
                      checked={selected.has(entry.name)}
                      onChange={(e) => {
                        const checked = e.currentTarget.checked;
                        setSelected((s) => {
                          const next = new Set(s);
                          if (checked) next.add(entry.name);
                          else next.delete(entry.name);
                          return next;
                        });
                      }}
                    />
                    <button type="button" class="zip-name" onClick={() => setPreview(entry)}>
                      {slash >= 0 && <span class="tone-muted">{entry.name.slice(0, slash + 1)}</span>}
                      {entry.name.slice(slash + 1)}
                    </button>
                    <span class="tone-muted">{formatBytes(entry.bytes.length)}</span>
                    <button type="button" class="button button-small" onClick={() => saveEntry(entry)}>
                      Save
                    </button>
                  </li>
                );
              })}
            </ul>
            {preview && (
              <figure class="ai-figure zip-preview">
                <figcaption>{preview.name}</figcaption>
                <div class="zip-preview-body" {...scrollRegion(`Preview of ${preview.name}`)}>
                  <EntryPreview entry={preview} />
                </div>
              </figure>
            )}
          </div>
        )}
        {settings.mode === 'make' && files.length > 0 && (
          <ul class="pdf-plan">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <span>{f.name}</span>
                <span class="tone-muted">
                  {formatBytes(f.size)}{' '}
                  <button type="button" class="icon-button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}>
                    <Icon name="close" size={13} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default defineCustomTool(ArchiveTool);
