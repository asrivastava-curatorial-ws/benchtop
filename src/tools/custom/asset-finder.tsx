/**
 * Asset Finder: searches open media libraries (museums, archives, NASA, sound,
 * books, 3D, CAD, textures, icons, fonts and stock photos) at once, filters by
 * licence, explains what each licence allows for the use you have in mind, and
 * downloads into a library folder with a record and licence note per asset.
 *
 * Each library is reached by a connector: a JavaScript file that runs in its
 * own sandboxed worker and can be read, changed, tested, reset, exported or
 * written from scratch on the Sources tab, so a library that changes its API
 * can be fixed without waiting for a new version of the app.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { navigate, toolHref } from '../../app/router';
import { type DownloadJob, DownloadManager } from '../../lib/assets/downloads';
import { AssetEngine, AssetSearch, fileSummary, type SearchSource } from '../../lib/assets/engine';
import { checkUse, creditLine, explain, indiaCheck, isPublicDomain, isStock, LICENCE_LEVELS, type Licence, noDerivatives, nonCommercial, shareAlike, USES } from '../../lib/assets/licences';
import { ASSET_TYPES, type AssetFile, type AssetItem, type AssetType, type AssetUse, humanDuration, humanSize, isAssetType, type LicenceLevel, STEREO_LABELS, typeLabel } from '../../lib/assets/model';
import { type ConnectorMeta, clearAnswers, type RequestEntry } from '../../lib/assets/runtime';
import { type ConnectorRecord, codeOf, connectorTemplate, exportConnectors, isEdited, loadConnectors, parseImport, saveConnectors } from '../../lib/assets/store';
import { assetTransport, fetchMedia, ThumbnailCache } from '../../lib/assets/transport';
import { copyText, isDesktop, openLink, pickFile, readTextFile, saveFile } from '../../platform';
import * as shell from '../../platform/assets';
import { networkStatus } from '../../platform/net';
import { CodeEditor } from '../../ui/CodeEditor';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { usePersistentState } from './_shared';

/* ------------------------------------------------------------ shared state -- */
// Kept for the whole session, so downloads go on while you use other tools.

let keyStore: Record<string, Record<string, string>> = {};
let keysLoaded = false;
/** The library folder (desktop), once known. */
let libraryPath: string | null = null;
let records: ConnectorRecord[] = [];
const metas = new Map<string, ConnectorMeta>();
const metaErrors = new Map<string, string>();
const logs = new Map<string, RequestEntry[]>();
const notes = new Map<string, string[]>();
const keep = <T,>(map: Map<string, T[]>, id: string, value: T, max = 60) => map.set(id, [...(map.get(id) ?? []), value].slice(-max));

const engine = new AssetEngine(assetTransport, (id) => keyStore[id] ?? {});
engine.log = (id, entry) => keep(logs, id, entry);
engine.note = (id, text) => keep(notes, id, text);
const sourceOf = (id: string): SearchSource | undefined => {
  const r = records.find((x) => x.id === id);
  return r ? { id: r.id, code: codeOf(r), settings: r.settings } : undefined;
};
const downloads = new DownloadManager(() => engine, sourceOf);
const thumbs = new ThumbnailCache();
const keyOf = (item: AssetItem) => `${item.source}:${item.id}`;

async function describe(record: ConnectorRecord): Promise<void> {
  const source = { id: record.id, code: codeOf(record) };
  try {
    metas.set(record.id, await engine.describe(source));
    metaErrors.delete(record.id);
  } catch (error) {
    metas.delete(record.id);
    metaErrors.set(record.id, error instanceof Error ? error.message : String(error));
  }
  engine.runner(source.id, source.code).stop();
}

/* -------------------------------------------------------------- settings -- */

type Tab = 'search' | 'downloads' | 'sources' | 'library';

interface Prefs {
  readonly text: string;
  readonly types: readonly AssetType[];
  readonly licence: LicenceLevel;
  readonly stock: boolean;
  readonly use: AssetUse;
}

const readPrefs = (stored: Values | undefined): Prefs => {
  const types = Array.isArray(stored?.types) ? (stored.types as unknown[]).filter(isAssetType) : [];
  return {
    text: typeof stored?.text === 'string' ? stored.text : '',
    types: types.length ? types : ['image'],
    licence: LICENCE_LEVELS.some((l) => l.id === stored?.licence) ? (stored?.licence as LicenceLevel) : 'by',
    stock: stored?.stock === true,
    use: USES.some((u) => u.id === stored?.use) ? (stored?.use as AssetUse) : 'free',
  };
};
const writePrefs = (p: Prefs): Values => ({ ...p, types: [...p.types] });

function licenceFamily(l: Licence): string {
  if (isPublicDomain(l)) return 'pd';
  if (isStock(l)) return 'stock';
  if (l.code === 'restricted' || l.code === 'unknown') return 'unknown';
  if (nonCommercial(l) || noDerivatives(l)) return 'nc';
  if (shareAlike(l)) return 'sa';
  return 'by';
}

function LicenceBadge({ licence }: { licence: Licence }) {
  return <span class={`af-licence af-licence-${licenceFamily(licence)}`}>{licence.name.replace(' (no rights reserved)', '')}</span>;
}

/** A picture fetched through the desktop shell and shown from a blob. */
function Thumb({ url, alt, type, large = false }: { url: string; alt: string; type: AssetType; large?: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setSrc(null);
    setFailed(false);
    if (!url) return;
    let live = true;
    void thumbs.get(url).then((blob) => {
      if (!live) return;
      if (blob) setSrc(blob);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [url]);
  if (src) return <img class={large ? 'af-preview-img' : 'af-thumb-img'} src={src} alt={alt} loading="lazy" />;
  return (
    <span class="af-thumb-none" aria-hidden="true">
      {url && !failed ? '…' : typeLabel(type).split(' ')[0]}
    </span>
  );
}

/* ---------------------------------------------------------------- search -- */

function SearchPane({
  prefs,
  setPrefs,
  list,
  ready,
  online,
  reason,
}: {
  prefs: Prefs;
  setPrefs: (p: Prefs) => void;
  list: readonly ConnectorRecord[];
  ready: boolean;
  online: boolean;
  reason: string;
}) {
  const [search, setSearch] = useState<AssetSearch | null>(null);
  const [, setTick] = useState(0);
  const [selected, setSelected] = useState<AssetItem | null>(null);
  const refresh = () => setTick((t) => t + 1);

  const run = async () => {
    search?.stop();
    setSelected(null);
    const sources = list
      .filter((r) => r.enabled)
      .map((r) => ({ record: r, meta: metas.get(r.id) }))
      .filter(({ meta }) => meta?.types.some((t) => prefs.types.includes(t)) && (!meta.stock || prefs.stock))
      .map(({ record }) => ({ id: record.id, code: codeOf(record), settings: record.settings }));
    if (!sources.length) {
      notify('No library on the list has these kinds of asset; turn more on under Sources.', 'error');
      return;
    }
    const next = new AssetSearch(engine, { text: prefs.text.trim(), types: prefs.types, page: 1, pageSize: 24, licence: prefs.licence, stock: prefs.stock, use: prefs.use }, sources, metas);
    setSearch(next);
    await next.next(refresh);
    refresh();
  };

  const more = async () => {
    if (!search) return;
    await search.next(refresh);
    refresh();
  };

  const items = search?.merged() ?? [];
  const toggleType = (type: AssetType) => {
    const has = prefs.types.includes(type);
    const types = has ? prefs.types.filter((t) => t !== type) : [...prefs.types, type];
    if (types.length) setPrefs({ ...prefs, types });
  };

  return (
    <div class="af-search-pane">
      {!online && (
        <p class="notice af-gate" data-testid="af-gate">
          {reason}
        </p>
      )}
      <form
        class="af-search"
        onSubmit={(e) => {
          e.preventDefault();
          void attempt(run);
        }}
      >
        <label class="af-query">
          <span class="visually-hidden">Search for</span>
          <input
            class="input"
            type="search"
            value={prefs.text}
            placeholder="What are you looking for? (moon, steam engine, rain, Sherlock Holmes…)"
            onInput={(e) => setPrefs({ ...prefs, text: e.currentTarget.value })}
            data-testid="af-query"
          />
        </label>
        <button type="submit" class="button button-primary" disabled={!online || !ready || search?.busy} data-testid="af-search">
          <Icon name="search" size={14} /> Search
        </button>
      </form>
      <fieldset class="af-kinds">
        <legend class="control-label">Kinds</legend>
        {ASSET_TYPES.map((t) => (
          <label key={t.id} class={`af-kind${prefs.types.includes(t.id) ? ' is-on' : ''}`} title={t.hint}>
            <input type="checkbox" checked={prefs.types.includes(t.id)} onChange={() => toggleType(t.id)} />
            {t.label}
          </label>
        ))}
      </fieldset>
      <div class="af-filters">
        <label class="af-field">
          <span class="control-label">Licences</span>
          <select class="input" value={prefs.licence} onChange={(e) => setPrefs({ ...prefs, licence: e.currentTarget.value as LicenceLevel })} data-testid="af-licence">
            {LICENCE_LEVELS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label class="af-field">
          <span class="control-label">For</span>
          <select class="input" value={prefs.use} onChange={(e) => setPrefs({ ...prefs, use: e.currentTarget.value as AssetUse })} data-testid="af-use">
            {USES.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
        <label class="check af-stock">
          <input type="checkbox" checked={prefs.stock} onChange={(e) => setPrefs({ ...prefs, stock: e.currentTarget.checked })} data-testid="af-stock" />
          Stock libraries too (Pexels, Pixabay, Unsplash)
        </label>
      </div>

      {search && (
        <ul class="af-sources" aria-label="Libraries asked" data-testid="af-sources">
          {search.results.map((r) => (
            <li key={r.id} class={`af-source af-source-${r.state}`} title={r.message || undefined}>
              <span class="af-source-name">{r.name}</span>{' '}
              <span class="af-source-state">
                {r.state === 'running' || r.state === 'waiting'
                  ? 'asking…'
                  : r.state === 'done'
                    ? `${r.items.length}${r.total !== undefined && r.total > r.items.length ? ` of ${r.total.toLocaleString()}` : ''}${r.dropped ? ` (${r.dropped} left out by the filters)` : ''}`
                    : r.state === 'skipped'
                      ? r.message
                      : `failed: ${r.message}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div class={`af-results${selected ? ' has-details' : ''}`}>
        <div>
          {search && !search.busy && items.length === 0 && <p class="empty-state">Nothing found. Try other words, more kinds, a wider licence filter, or more libraries under Sources.</p>}
          <ul class="af-grid" aria-label="Results" data-testid="af-results">
            {items.map((item) => (
              <li key={keyOf(item)}>
                <ResultCard item={item} use={prefs.use} active={selected !== null && keyOf(selected) === keyOf(item)} onOpen={() => setSelected(item)} />
              </li>
            ))}
          </ul>
          {search?.hasMore && (
            <button type="button" class="button af-more" disabled={search.busy} onClick={() => void attempt(more)} data-testid="af-more">
              More results
            </button>
          )}
        </div>
        {selected && <Details item={selected} use={prefs.use} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}

function ResultCard({ item, use, active, onOpen }: { item: AssetItem; use: AssetUse; active: boolean; onOpen: () => void }) {
  const worst = checkUse(item.licence, use)[0];
  const source = metas.get(item.source)?.name ?? item.source;
  return (
    <button type="button" class={`af-card${active ? ' is-active' : ''}`} onClick={onOpen} aria-pressed={active}>
      <span class="af-thumb">
        <Thumb url={item.thumb} alt="" type={item.type} />
        {item.stereo && <span class="af-stereo">{STEREO_LABELS[item.stereo]}</span>}
      </span>
      <span class="af-card-title">{item.title}</span>
      <span class="af-card-meta">
        {[item.creator, source].filter(Boolean).join(' · ')}
        {item.duration ? ` · ${humanDuration(item.duration)}` : ''}
      </span>
      <span class="af-card-tags">
        <LicenceBadge licence={item.licence} />
        {worst && (worst.level === 'stop' || worst.level === 'warn') && <span class={`af-use af-use-${worst.level}`}>{worst.level === 'stop' ? 'Not for this use' : 'Check the terms'}</span>}
      </span>
    </button>
  );
}

function Details({ item, use, onClose }: { item: AssetItem; use: AssetUse; onClose: () => void }) {
  const [files, setFiles] = useState<AssetFile[] | null>(null);
  const [fileNotes, setFileNotes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [willChange, setWillChange] = useState(false);
  const [media, setMedia] = useState<{ url: string; kind: 'audio' | 'video' } | null>(null);
  const meta = metas.get(item.source);
  const sourceName = meta?.name ?? item.source;

  useEffect(() => {
    setFiles(null);
    setFileNotes([]);
    setError('');
    setMedia(null);
    const source = sourceOf(item.source);
    if (!source) return;
    let live = true;
    engine
      .files(source, item)
      .then((r) => {
        if (!live) return;
        setFiles(r.files);
        setFileNotes(r.notes);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [item]);

  useEffect(() => () => media && URL.revokeObjectURL(media.url), [media]);

  const playPreview = () =>
    attempt(async () => {
      const kind = item.type === 'audio' ? 'audio' : 'video';
      const { bytes, type } = await fetchMedia(item.preview, { maxBytes: 8 * 1024 * 1024, accept: `${kind}/*`, timeoutMs: 60_000 });
      setMedia({ url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: type || `${kind}/mpeg` })), kind });
    });

  const credit = creditLine({ title: item.title, creator: item.creator, page: item.page, sourceName, licence: item.licence });
  const checks = checkUse(item.licence, use, willChange);
  const india = indiaCheck(item.licence, item.type === 'video' || item.type === 'video3d' ? 'film' : item.type === 'audio' ? 'sound' : 'other', item.deathYear, item.year);
  const get = (file: AssetFile) =>
    attempt(async () => {
      if (isDesktop && !libraryPath) {
        notify('First choose the folder that keeps your assets.');
        libraryPath = await shell.chooseLibraryFolder();
        if (!libraryPath) return;
      }
      downloads.add(item, file, { id: item.source, name: sourceName, homepage: meta?.homepage ?? '' });
      notify(`Downloading ${file.name}. Follow it on the Downloads tab.`);
    });

  return (
    <aside class="af-details" aria-label={`About ${item.title}`} data-testid="af-details">
      <div class="af-details-head">
        <h3>{item.title}</h3>
        <button type="button" class="button button-quiet button-small" onClick={onClose} aria-label="Close the details">
          <Icon name="close" size={14} />
        </button>
      </div>
      {(item.thumb || ((item.type === 'image' || item.type === 'texture') && item.preview)) && (
        <div class="af-preview">
          <Thumb url={item.type === 'image' || item.type === 'texture' ? item.preview || item.thumb : item.thumb} alt={item.title} type={item.type} large />
        </div>
      )}
      {item.preview && (item.type === 'audio' || item.type === 'video' || item.type === 'video3d') && (
        <div class="af-play">
          {media ? (
            media.kind === 'audio' ? (
              // biome-ignore lint/a11y/useMediaCaption: previews from the library come without captions
              <audio controls src={media.url} autoplay />
            ) : (
              // biome-ignore lint/a11y/useMediaCaption: previews from the library come without captions
              <video controls src={media.url} autoplay class="af-preview-img" />
            )
          ) : (
            <button type="button" class="button button-small" onClick={() => void playPreview()}>
              <Icon name="play" size={14} /> Play the preview
            </button>
          )}
        </div>
      )}
      <p class="af-byline">
        {item.creator ? <>by {item.creatorUrl ? <LinkButton href={item.creatorUrl}>{item.creator}</LinkButton> : item.creator} · </> : null}
        {sourceName}
        {item.provider && item.provider !== sourceName ? ` (${item.provider})` : ''}
        {item.date ? ` · ${item.date}` : ''}
      </p>
      <p class="af-facts">
        {[
          typeLabel(item.type),
          item.stereo ? STEREO_LABELS[item.stereo] : '',
          item.width && item.height ? `${item.width}×${item.height}` : '',
          item.duration ? humanDuration(item.duration) : '',
          humanSize(item.size),
          item.formats.join(', ').toUpperCase(),
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {item.description && <p class="af-description">{item.description}</p>}
      <div class="button-row">
        {item.page && (
          <button type="button" class="button button-small" onClick={() => void attempt(() => openLink(item.page))}>
            <Icon name="open" size={14} /> Source page
          </button>
        )}
        <button
          type="button"
          class="button button-small"
          onClick={() =>
            void attempt(async () => {
              await copyText(credit);
              notify('Credit line copied.');
            })
          }
        >
          <Icon name="copy" size={14} /> Copy the credit line
        </button>
      </div>

      <section class="af-section" aria-label="Licence">
        <h4>
          Licence: <LicenceBadge licence={item.licence} />
        </h4>
        <p>{explain(item.licence)}</p>
        {item.licence.note && <p class="af-note">The library says: {item.licence.note}</p>}
        <label class="check">
          <input type="checkbox" checked={willChange} onChange={(e) => setWillChange(e.currentTarget.checked)} />I will crop, edit, dub or remix it
        </label>
        <ul class="af-checks" aria-label="For this use">
          {checks.map((c) => (
            <li key={c.text} class={`af-check-${c.level}`}>
              {c.text}
            </li>
          ))}
        </ul>
        <p class={`af-india af-india-${india.status}`}>
          <strong>In India:</strong> {india.text}
        </p>
        <p class="af-credit">{credit}</p>
      </section>

      <section class="af-section" aria-label="Files">
        <h4>Files</h4>
        {error && <p class="af-error">{error}</p>}
        {!error && files === null && <p class="af-note">Listing the files…</p>}
        {files?.length === 0 && !error && <p class="af-note">The library lists no files to download; the source page may have them.</p>}
        {fileNotes.map((n) => (
          <p key={n} class="af-note">
            {n}
          </p>
        ))}
        <ul class="af-files" data-testid="af-files">
          {files?.map((f) => (
            <li key={`${f.label}|${f.name}`}>
              <span class="af-file-label">
                {fileSummary(f)}
                {f.original ? <span class="af-original"> original</span> : null}
                {f.note ? <span class="af-file-note">{f.note}</span> : null}
              </span>
              <button type="button" class="button button-small" onClick={() => void get(f)}>
                <Icon name="save" size={14} /> Download
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

function LinkButton({ href, children }: { href: string; children: ComponentChildren }) {
  return (
    <button type="button" class="af-link" onClick={() => void attempt(() => openLink(href))}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------- downloads -- */

function DownloadsPane({ library, chooseLibrary }: { library: string | null; chooseLibrary: () => void }) {
  const [, setTick] = useState(0);
  useEffect(() => downloads.subscribe(() => setTick((t) => t + 1)), []);
  const jobs = downloads.jobs;
  return (
    <div class="af-downloads" data-testid="af-downloads">
      <LibraryLine library={library} chooseLibrary={chooseLibrary} />
      {jobs.length === 0 && <p class="empty-state">No downloads yet. Pick a result on the Search tab and download one of its files.</p>}
      <ul class="af-jobs">
        {jobs.map((job) => {
          const fraction = job.total ? Math.min(1, job.received / job.total) : 0;
          return (
            <li key={job.id} class={`af-job af-job-${job.state}`}>
              <div class="af-job-head">
                <strong>{job.item.title}</strong>
                <span class="af-job-file">
                  {job.file.name} · {job.source.name}
                </span>
              </div>
              <progress max={1} value={job.state === 'done' ? 1 : fraction} aria-label={`${job.file.name} downloaded`} />
              <div class="af-job-foot">
                <span class="af-job-state" role="status">
                  {jobText(job)}
                </span>
                <span class="button-row">
                  {(job.state === 'queued' || job.state === 'preparing' || job.state === 'downloading') && (
                    <button type="button" class="button button-small" onClick={() => downloads.stop(job.id)}>
                      Stop
                    </button>
                  )}
                  {(job.state === 'error' || job.state === 'stopped') && (
                    <button type="button" class="button button-small" onClick={() => downloads.retry(job.id)}>
                      <Icon name="refresh" size={14} /> Carry on
                    </button>
                  )}
                  {job.state === 'done' && isDesktop && (
                    <button type="button" class="button button-small" onClick={() => void attempt(() => shell.revealAsset(job.dir))}>
                      <Icon name="open" size={14} /> Show
                    </button>
                  )}
                  <button type="button" class="button button-small button-quiet" onClick={() => downloads.remove(job.id)} aria-label={`Remove ${job.file.name} from the list`}>
                    <Icon name="close" size={14} />
                  </button>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {jobs.some((j) => j.state === 'done' || j.state === 'error' || j.state === 'stopped') && (
        <button type="button" class="button button-small" onClick={() => downloads.clearFinished()}>
          Clear finished
        </button>
      )}
    </div>
  );
}

function jobText(job: DownloadJob): string {
  const sizes = job.total ? `${humanSize(job.received)} of ${humanSize(job.total)}` : humanSize(job.received);
  const part = job.parts > 1 ? ` (file ${job.part + 1} of ${job.parts})` : '';
  switch (job.state) {
    case 'queued':
      return 'Waiting for a free slot';
    case 'preparing':
      return 'Asking the library for the file';
    case 'downloading':
      return `Downloading ${sizes}${part}`;
    case 'checking':
      return 'Checking the checksum';
    case 'unpacking':
      return 'Unpacking the ZIP';
    case 'saving':
      return 'Writing the record and licence note';
    case 'done':
      return `Saved${job.verified ? `, ${job.verified.toUpperCase()} checksum confirmed` : ''}${isDesktop ? ` in ${job.dir.join(' › ')}` : ''}`;
    case 'stopped':
      return job.message || 'Stopped';
    default:
      return job.message || 'Failed';
  }
}

function LibraryLine({ library, chooseLibrary }: { library: string | null; chooseLibrary: () => void }) {
  if (!isDesktop)
    return (
      <p class="notice">
        In a browser each file is saved as an ordinary download (up to 8 MB). The desktop app saves into a library folder, with a record and licence note per asset, and resumes broken downloads.
      </p>
    );
  return (
    <div class="af-library-line">
      <span>
        Library folder: <strong data-testid="af-library">{library ?? 'not chosen yet'}</strong>
      </span>
      <button type="button" class="button button-small" onClick={chooseLibrary}>
        {library ? 'Change…' : 'Choose…'}
      </button>
      {library && (
        <button type="button" class="button button-small" onClick={() => void attempt(() => shell.revealAsset([]))}>
          <Icon name="open" size={14} /> Open
        </button>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- sources -- */

function SourcesPane({ list, setList, refreshMetas }: { list: readonly ConnectorRecord[]; setList: (next: ConnectorRecord[]) => void; refreshMetas: (r: ConnectorRecord) => Promise<void> }) {
  const [current, setCurrent] = useState(list[0]?.id ?? '');
  const record = list.find((r) => r.id === current) ?? list[0];

  const update = (id: string, change: Partial<ConnectorRecord>) => setList(list.map((r) => (r.id === id ? { ...r, ...change } : r)));

  const addCustom = (code: string, settings: Record<string, string> = {}, enabled = true) => {
    const id = /export\s+const\s+source\s*=\s*\{[^}]*?\bid\s*:\s*['"]([a-z0-9][a-z0-9-]{1,40})['"]/.exec(code)?.[1] ?? '';
    if (!id) throw new Error('The connector needs source.id: 2–41 lower-case letters, digits or dashes.');
    const existing = list.find((r) => r.id === id);
    const next: ConnectorRecord = existing ? { ...existing, code, settings: { ...existing.settings, ...settings }, enabled } : { id, code, enabled, settings, custom: true };
    const all = existing ? list.map((r) => (r.id === id ? next : r)) : [...list, next];
    setList(all);
    setCurrent(id);
    void refreshMetas(next);
    return id;
  };

  const fresh = () => {
    let n = 1;
    while (list.some((r) => r.id === `my-library-${n}`)) n++;
    addCustom(connectorTemplate(`my-library-${n}`));
  };

  const importFile = () =>
    attempt(async () => {
      const file = await pickFile('.js,.json,application/json,text/javascript');
      if (!file) return;
      const found = parseImport(await readTextFile(file));
      for (const c of found) addCustom(c.code, c.settings, c.enabled);
      notify(`${found.length} connector${found.length === 1 ? '' : 's'} added.`);
    });

  return (
    <div class="af-sources-pane" data-testid="af-sources-pane">
      <div class="af-source-list">
        <div class="button-row">
          <button type="button" class="button button-small" onClick={fresh} data-testid="af-new-connector">
            <Icon name="plus" size={14} /> New
          </button>
          <button type="button" class="button button-small" onClick={() => void importFile()}>
            Import…
          </button>
          <button type="button" class="button button-small" onClick={() => void attempt(() => saveFile('benchtop-connectors.json', exportConnectors(list), 'application/json').then(() => undefined))}>
            Export all
          </button>
        </div>
        <ul aria-label="Libraries">
          {list.map((r) => {
            const meta = metas.get(r.id);
            const missing = meta ? engine.missingKeys(meta) : [];
            return (
              <li key={r.id} class={r.id === record?.id ? 'is-active' : ''}>
                <input type="checkbox" checked={r.enabled} onChange={(e) => update(r.id, { enabled: e.currentTarget.checked })} aria-label={`Ask ${meta?.name ?? r.id}`} />
                <button type="button" class="af-source-pick" onClick={() => setCurrent(r.id)} aria-pressed={r.id === record?.id}>
                  <span>{meta?.name ?? r.id}</span>
                  <span class="af-source-flags">{metaErrors.has(r.id) ? 'does not load' : missing.length ? 'needs a key' : r.custom ? 'yours' : isEdited(r) ? 'changed' : ''}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {record && (
        <ConnectorView
          key={record.id}
          record={record}
          update={(change) => update(record.id, change)}
          remove={() => {
            setList(list.filter((r) => r.id !== record.id));
            setCurrent(list[0]?.id ?? '');
          }}
          refreshMetas={refreshMetas}
        />
      )}
    </div>
  );
}

function ConnectorView({
  record,
  update,
  remove,
  refreshMetas,
}: {
  record: ConnectorRecord;
  update: (change: Partial<ConnectorRecord>) => void;
  remove: () => void;
  refreshMetas: (r: ConnectorRecord) => Promise<void>;
}) {
  const meta = metas.get(record.id);
  const [code, setCode] = useState(codeOf(record));
  const [testText, setTestText] = useState('moon');
  const [test, setTest] = useState<{ running: boolean; summary: string; titles: string[]; error: string }>({ running: false, summary: '', titles: [], error: '' });
  const [keys, setKeys] = useState<Record<string, string>>(() => ({ ...(keyStore[record.id] ?? {}) }));
  const [, setTick] = useState(0);
  const dirty = code !== codeOf(record);
  const error = metaErrors.get(record.id);
  const errorLine = /\(line (\d+)\)/.exec(test.error || error || '')?.[1];

  const save = async () => {
    const next: ConnectorRecord = { ...record, code };
    await refreshMetas(next);
    const described = metas.get(record.id);
    if (described && described.id !== record.id) {
      await refreshMetas(record);
      throw new Error(`Keep source.id as '${record.id}': it names this connector's keys and settings.`);
    }
    if (!described) notify(`Saved, but it does not load: ${metaErrors.get(record.id) ?? 'see the error above'}`, 'error');
    update({ code });
  };

  const runTest = () =>
    attempt(async () => {
      const source = { id: record.id, code, settings: record.settings };
      setTest({ running: true, summary: '', titles: [], error: '' });
      logs.delete(record.id);
      notes.delete(record.id);
      try {
        const described = await engine.describe(source);
        const reply = await engine.searchSource(source, { text: testText, types: described.types, page: 1, pageSize: 10, licence: 'any', stock: true, use: 'free' });
        setTest({
          running: false,
          summary: `${reply.items.length} results${reply.total !== undefined ? ` of ${reply.total.toLocaleString()}` : ''}${reply.more ? ', more available' : ''}.`,
          titles: reply.items.slice(0, 8).map((i) => `${i.title} (${i.licence.name})`),
          error: '',
        });
      } catch (e) {
        setTest({ running: false, summary: '', titles: [], error: e instanceof Error ? e.message : String(e) });
      }
    });

  const saveKey = (id: string) =>
    attempt(async () => {
      const value = (keys[id] ?? '').trim();
      if (isDesktop) await shell.saveKey(record.id, id, value);
      keyStore = { ...keyStore, [record.id]: { ...(keyStore[record.id] ?? {}), [id]: value } };
      if (!value) delete keyStore[record.id]?.[id];
      setTick((t) => t + 1);
      notify(value ? 'Key saved.' : 'Key removed.');
    });

  return (
    <div class="af-connector" data-testid="af-connector">
      <h3>{meta?.name ?? record.id}</h3>
      {meta && <p>{meta.about}</p>}
      {error && <p class="af-error">This connector does not load: {error}</p>}
      {meta && (
        <p class="af-links">
          {meta.homepage && <LinkButton href={meta.homepage}>Library</LinkButton>}
          {meta.terms && <LinkButton href={meta.terms}>Terms of use</LinkButton>}
          {meta.signup && <LinkButton href={meta.signup}>Get a key</LinkButton>}
          <span class="af-note">
            Kinds: {meta.types.map(typeLabel).join(', ')} · may ask: {meta.hosts.join(', ') || 'no host (works offline)'}
          </span>
        </p>
      )}
      {meta && meta.keys.length > 0 && (
        <fieldset class="af-keys">
          <legend class="control-label">Keys {isDesktop ? '(kept in a file only you can read, never exported)' : '(kept until the page is closed)'}</legend>
          {meta.keys.map((k) => (
            <div key={k.id} class="af-key">
              <label class="af-field">
                <span class="control-label">
                  {k.label}
                  {k.optional ? ' (optional)' : ''}
                </span>
                <input class="input" type="password" autocomplete="off" spellcheck={false} value={keys[k.id] ?? ''} onInput={(e) => setKeys({ ...keys, [k.id]: e.currentTarget.value })} />
              </label>
              <button type="button" class="button button-small" onClick={() => void saveKey(k.id)}>
                Save
              </button>
              <span class="af-note">{k.help}</span>
            </div>
          ))}
        </fieldset>
      )}
      {meta && Object.keys(meta.settings).length > 0 && (
        <fieldset class="af-settings">
          <legend class="control-label">Settings</legend>
          {Object.entries(meta.settings).map(([name, value]) => (
            <label key={name} class="af-field">
              <span class="control-label">{name}</span>
              <input
                class="input"
                type="text"
                spellcheck={false}
                value={record.settings[name] ?? value}
                onChange={(e) => {
                  const text = e.currentTarget.value.trim();
                  const { [name]: _, ...rest } = record.settings;
                  update({ settings: text && text !== value ? { ...rest, [name]: text } : rest });
                }}
              />
            </label>
          ))}
        </fieldset>
      )}
      <div class="af-code">
        <CodeEditor
          value={code}
          onChange={setCode}
          language="javascript"
          label={`Code of the ${meta?.name ?? record.id} connector`}
          testId="af-code"
          {...(errorLine ? { errorLine: Number(errorLine) } : {})}
        />
      </div>
      <div class="button-row">
        <button type="button" class="button button-primary button-small" disabled={!dirty} onClick={() => void attempt(save)} data-testid="af-save-connector">
          <Icon name="save" size={14} /> Save
        </button>
        <label class="af-field af-test-text">
          <span class="visually-hidden">Words to test with</span>
          <input class="input" type="text" value={testText} onInput={(e) => setTestText(e.currentTarget.value)} />
        </label>
        <button type="button" class="button button-small" disabled={test.running || !networkStatus().ok} onClick={() => void runTest()} data-testid="af-test-connector">
          <Icon name="play" size={14} /> Test
        </button>
        {!record.custom && record.code !== null && (
          <button
            type="button"
            class="button button-small"
            onClick={() => {
              update({ code: null });
              setCode(codeOf({ ...record, code: null }));
              void refreshMetas({ ...record, code: null });
            }}
          >
            Reset to the built-in code
          </button>
        )}
        <button type="button" class="button button-small" onClick={() => void attempt(() => saveFile(`${record.id}.js`, code, 'text/javascript').then(() => undefined))}>
          Export
        </button>
        {record.custom && (
          <button type="button" class="button button-small button-danger" onClick={remove}>
            <Icon name="trash" size={14} /> Remove
          </button>
        )}
      </div>
      {(test.summary || test.error) && (
        <div class="af-test" role="status" data-testid="af-test-result">
          {test.error ? <p class="af-error">{test.error}</p> : <p>{test.summary}</p>}
          {test.titles.length > 0 && (
            <ul>
              {test.titles.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <RequestLog id={record.id} />
    </div>
  );
}

function RequestLog({ id }: { id: string }) {
  const entries = logs.get(id) ?? [];
  const said = notes.get(id) ?? [];
  if (!entries.length && !said.length) return null;
  return (
    <details class="af-log" open>
      <summary>Requests ({entries.length})</summary>
      <ul>
        {entries.map((e, i) => (
          <li key={i} class={e.error || e.status >= 400 ? 'af-log-bad' : ''}>
            <code>
              {e.method} {e.url}
            </code>{' '}
            {e.error ? e.error : `${e.status} · ${e.cached ? 'kept answer' : `${e.ms} ms`} · ${humanSize(e.bytes)}`}
          </li>
        ))}
        {said.map((t, i) => (
          <li key={`n${i}`} class="af-log-note">
            {t}
          </li>
        ))}
      </ul>
    </details>
  );
}

/* --------------------------------------------------------------- library -- */

function LibraryPane({ library, chooseLibrary }: { library: string | null; chooseLibrary: () => void }) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!isDesktop || !library) return;
    void shell
      .libraryRecords()
      .then((r) => setCount(r.length))
      .catch(() => setCount(null));
  }, [library]);
  return (
    <div class="af-library" data-testid="af-library-pane">
      <LibraryLine library={library} chooseLibrary={chooseLibrary} />
      <p>
        Every asset gets a folder of its own, by kind and library: <code>Pictures › Wikimedia Commons › Title [id]</code>. Beside the files are <code>asset.json</code> (where it came from, its licence
        and credit line) and <code>LICENCE.txt</code> (what the licence allows, by use, and the copyright term in India).
      </p>
      {count !== null && <p>{count.toLocaleString()} assets saved so far.</p>}
      <div class="button-row">
        <button type="button" class="button" onClick={() => navigate(toolHref('asset-credits'))}>
          Open Asset Credits
        </button>
        <button
          type="button"
          class="button"
          onClick={() => {
            clearAnswers();
            thumbs.clear();
            notify('Kept answers and thumbnails cleared.');
          }}
        >
          <Icon name="refresh" size={14} /> Clear kept answers
        </button>
      </div>
      <p class="af-note">Asset Credits lists everything in the library with its licence, checks it against a use and the term in India, and makes credits for panels, films and websites, offline.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ tool -- */

function AssetFinder({ toolId }: { toolId: string }) {
  const [prefs, setPrefs] = usePersistentState(toolId, readPrefs, writePrefs);
  const [tab, setTab] = useState<Tab>('search');
  const [list, setListState] = useState<ConnectorRecord[]>(() => {
    if (!records.length) records = loadConnectors();
    return records;
  });
  const [ready, setReady] = useState(metas.size + metaErrors.size >= list.length);
  const [, setTick] = useState(0);
  const status = networkStatus();
  const online = status.ok;
  const reason = status.ok
    ? ''
    : isDesktop
      ? 'Searching the libraries uses the network: turn on “Allow online checks” in Settings first.'
      : 'Searching the libraries needs the Benchtop desktop app: in a browser nothing here can contact other hosts. The Sources tab still shows and edits the connectors.';
  const busy = useRef(false);

  useEffect(() => downloads.subscribe(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    if (busy.current) return;
    busy.current = true;
    void (async () => {
      for (const r of records) if (!metas.has(r.id) && !metaErrors.has(r.id)) await describe(r);
      setReady(true);
      if (!keysLoaded && isDesktop) {
        keyStore = await shell.loadKeys().catch(() => ({}));
        keysLoaded = true;
      }
      libraryPath = await shell.libraryFolder().catch(() => null);
      setTick((t) => t + 1);
    })();
  }, []);

  const setList = (next: ConnectorRecord[]) => {
    records = next;
    setListState(next);
    void attempt(() => saveConnectors(next));
  };
  const refreshMetas = async (r: ConnectorRecord) => {
    await describe(r);
    setTick((t) => t + 1);
  };
  const chooseLibrary = () =>
    void attempt(async () => {
      const chosen = await shell.chooseLibraryFolder();
      if (chosen) {
        libraryPath = chosen;
        setTick((t) => t + 1);
      }
    });

  const active = downloads.active;
  const tabs: readonly { id: Tab; label: string }[] = useMemo(
    () => [
      { id: 'search', label: 'Search' },
      { id: 'downloads', label: active ? `Downloads (${active})` : 'Downloads' },
      { id: 'sources', label: 'Sources' },
      { id: 'library', label: 'Library' },
    ],
    [active],
  );

  return (
    <section class="tool af" data-testid="tool" data-state={ready ? 'done' : 'busy'}>
      <div class="af-tabs" role="tablist" aria-label="Asset Finder">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`af-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={tab === t.id ? `af-panel-${t.id}` : undefined}
            class={`af-tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
            data-testid={`af-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`af-panel-${tab}`} aria-labelledby={`af-tab-${tab}`}>
        {tab === 'search' && <SearchPane prefs={prefs} setPrefs={setPrefs} list={list} ready={ready} online={online} reason={reason} />}
        {tab === 'downloads' && <DownloadsPane library={libraryPath} chooseLibrary={chooseLibrary} />}
        {tab === 'sources' && <SourcesPane list={list} setList={setList} refreshMetas={refreshMetas} />}
        {tab === 'library' && <LibraryPane library={libraryPath} chooseLibrary={chooseLibrary} />}
      </div>
    </section>
  );
}

export default defineCustomTool(AssetFinder);
