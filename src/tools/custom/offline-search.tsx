/**
 * Offline Search: finds words inside the files of the folders you chose
 * (documents, spreadsheets, presentations, PDFs, code, text in pictures) and
 * in your notes.  The index lives in the app's data folder; nothing leaves
 * this computer.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { sendToTool } from '../../app/handoff';
import { navigate, toolHref } from '../../app/router';
import { type Suggestion, suggestTools } from '../../app/suggest';
import { formatBytes } from '../../lib/bytes';
import { groupHits, KIND_FILTERS, KIND_LABELS, type NoteHit, type NoteLike, placeLabel, searchNotes, shortDate, splitMarked } from '../../lib/local-search';
import { noteText, noteTitle } from '../../lib/notes-format';
import { listNotes, wantNote } from '../../lib/notes-store';
import type { OcrLanguage } from '../../lib/ocr-engine';
import { copyText, isDesktop } from '../../platform';
import { pickFolder } from '../../platform/convert';
import {
  addSearchRoot,
  cancelScan,
  clearSearchIndex,
  onScanProgress,
  pendingFiles,
  previewPart,
  readIndexedFile,
  removeSearchRoot,
  revealIndexedFile,
  type ScanProgress,
  type SearchAnswer,
  type SearchHit,
  type SearchPreview,
  type SearchStatus,
  scanFolders,
  searchFiles,
  searchStatus,
  storeText,
  updateSearchRoot,
} from '../../platform/search';
import { scrollRegion } from '../../ui/a11y';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool } from '../types';
import { usePersistentState } from './_shared';

interface Options {
  readonly kind: string;
  readonly wholeWords: boolean;
  readonly language: OcrLanguage;
}

const LANGUAGES: readonly { id: OcrLanguage; label: string }[] = [
  { id: 'eng', label: 'English' },
  { id: 'hin', label: 'Hindi' },
  { id: 'eng+hin', label: 'English and Hindi' },
];

function Marked({ text }: { text: string }) {
  return <>{splitMarked(text).map((piece, index) => (piece.hit ? <mark key={index}>{piece.text}</mark> : piece.text))}</>;
}

type Selection = { readonly row: number; readonly hit: SearchHit } | { readonly note: NoteHit } | null;

function Component({ toolId }: { toolId: string }) {
  const [options, setOptions] = usePersistentState<Options>(
    toolId,
    (stored) => ({
      kind: KIND_FILTERS.some((k) => k.id === stored?.kind) ? String(stored?.kind) : '',
      wholeWords: stored?.wholeWords === true,
      language: LANGUAGES.some((l) => l.id === stored?.language) ? (stored?.language as OcrLanguage) : 'eng',
    }),
    (value) => ({ ...value }),
  );
  const [query, setQuery] = useState('');
  const [root, setRoot] = useState<number | null>(null);
  const [status, setStatus] = useState<SearchStatus | null>(null);
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  const [notes, setNotes] = useState<NoteLike[]>([]);
  const [selected, setSelected] = useState<Selection>(null);
  const [shown, setShown] = useState<SearchPreview | null>(null);
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<{ done: number; total: number; name: string; step: string } | null>(null);
  const [tools, setTools] = useState<Suggestion[] | null>(null);
  const [sure, setSure] = useState(false);
  const [version, setVersion] = useState(0);
  const stop = useRef({ cancelled: false });
  const isReading = useRef(false);
  const asked = useRef(0);
  const language = useRef(options.language);
  language.current = options.language;

  const refresh = async () => {
    if (isDesktop) setStatus(await searchStatus());
  };

  // The notes are searched here; they are not copied into the index.
  useEffect(() => {
    void listNotes()
      .then((list) => setNotes(list.map((n) => ({ id: n.id, title: noteTitle(n), text: noteText(n), modified: n.modified }))))
      .catch(() => undefined);
    if (!isDesktop) return;
    void attempt(refresh);
    const off = onScanProgress(setScan);
    return () => {
      stop.current.cancelled = true;
      void off.then((un) => un());
    };
  }, []);

  /** Reads the PDFs and pictures the index is waiting for, one after another. */
  const readWaiting = async () => {
    if (isReading.current) return;
    isReading.current = true;
    const signal = { cancelled: false };
    stop.current = signal;
    const tried = new Set<number>();
    let done = 0;
    try {
      const { extractPdf, extractPicture, Stopped } = await import('../../lib/search-extract');
      for (;;) {
        const batch = (await pendingFiles(25)).filter((file) => !tried.has(file.id));
        if (!batch.length || signal.cancelled) break;
        const total = done + (await searchStatus()).pending;
        for (const file of batch) {
          if (signal.cancelled) break;
          tried.add(file.id);
          const name = file.name.split('/').pop() ?? file.name;
          setReading({ done, total, name, step: '' });
          try {
            const bytes = await readIndexedFile(file.id);
            const result =
              file.kind === 'pdf'
                ? await extractPdf(bytes, file.ocr ? language.current : null, signal, (step) => setReading({ done, total, name, step }))
                : await extractPicture(bytes, language.current);
            if (signal.cancelled) break;
            await storeText(file.id, result.parts, result.status, result.note);
          } catch (error) {
            if (error instanceof Stopped) break;
            await storeText(file.id, [], 'failed', error instanceof Error ? error.message : String(error)).catch(() => undefined);
          }
          done += 1;
          if (done % 10 === 0) setVersion((v) => v + 1);
        }
      }
    } finally {
      isReading.current = false;
      setReading(null);
      setVersion((v) => v + 1);
      await refresh().catch(() => undefined);
    }
  };

  const update = (id: number | null) =>
    attempt(async () => {
      setBusy(true);
      try {
        const summary = await scanFolders(id);
        await refresh();
        setVersion((v) => v + 1);
        const changed = summary.indexed + summary.byName + summary.failed;
        notify(
          summary.cancelled
            ? 'Stopped: what was read so far is searchable'
            : `Index up to date: ${changed.toLocaleString()} new or changed, ${summary.removed.toLocaleString()} removed${summary.pending ? `, ${summary.pending.toLocaleString()} PDFs and pictures to read` : ''}`,
        );
        if (summary.pending && !summary.cancelled) void readWaiting();
      } finally {
        setBusy(false);
        setScan(null);
      }
    });

  const setRootOptions = (id: number, ocr: boolean, hidden: boolean) =>
    attempt(async () => {
      await updateSearchRoot(id, ocr, hidden);
      await refresh();
    });

  const addFolder = () =>
    attempt(async () => {
      const folder = await pickFolder();
      if (!folder) return;
      const id = await addSearchRoot(folder.token, false);
      await refresh();
      await update(id);
    });

  // Search as you type.
  useEffect(() => {
    const mine = ++asked.current;
    const text = query.trim();
    if (!text || !isDesktop || options.kind === 'note') {
      setAnswer(null);
      return;
    }
    const timer = setTimeout(() => {
      searchFiles(query, { kinds: options.kind ? [options.kind] : [], root, limit: 200, wholeWords: options.wholeWords })
        .then((next) => {
          if (mine === asked.current) setAnswer(next);
        })
        .catch((error) => {
          if (mine === asked.current) {
            setAnswer(null);
            notify(error instanceof Error ? error.message : String(error), 'error');
          }
        });
    }, 140);
    return () => clearTimeout(timer);
  }, [query, options.kind, options.wholeWords, root, version]);

  const noteHits = useMemo(() => (options.kind === '' || options.kind === 'note' ? (root === null ? searchNotes(notes, query) : []) : []), [notes, query, options.kind, root]);
  const groups = useMemo(() => groupHits(answer?.hits ?? []), [answer]);

  // The preview of the selected match.
  const row = selected && 'row' in selected ? selected.row : null;
  useEffect(() => {
    setTools(null);
    if (row === null) {
      setShown(null);
      return;
    }
    let live = true;
    previewPart(row, query, options.wholeWords)
      .then((next) => {
        if (live) setShown(next);
      })
      .catch(() => {
        if (live) setShown(null);
      });
    return () => {
      live = false;
    };
  }, [row]);

  // The first match is marked in the preview once it is drawn.
  const preview = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const mark = preview.current?.querySelector('mark');
    if (mark && preview.current) preview.current.scrollTop = Math.max(0, (mark as HTMLElement).offsetTop - preview.current.offsetTop - 60);
    else if (preview.current) preview.current.scrollTop = 0;
  }, [shown]);

  const hit = selected && 'row' in selected ? selected.hit : null;
  const asFile = async (h: SearchHit) => new File([(await readIndexedFile(h.file)) as BlobPart], h.rel.split('/').pop() ?? h.rel);
  const total = (answer?.files ?? 0) + noteHits.length;
  const searching = query.trim() !== '';
  const roots = status?.roots ?? [];
  const working = busy || status?.scanning === true;

  return (
    <section class="tool os" data-testid="tool" data-state={searching ? (total ? 'done' : 'empty') : 'idle'}>
      <div class="os-bar">
        <label class="os-query">
          <Icon name="search" size={18} />
          <span class="visually-hidden">Words to look for</span>
          <input
            class="input"
            type="search"
            value={query}
            placeholder={isDesktop ? 'Words to look for in your files and notes' : 'Words to look for in your notes'}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setSelected(null);
            }}
            spellcheck={false}
            autocomplete="off"
            data-testid="os-query"
          />
        </label>
        <label class="os-field">
          <span class="control-label">Look in</span>
          <select class="input" value={options.kind} onChange={(e) => setOptions({ ...options, kind: e.currentTarget.value })} data-testid="os-kind">
            {KIND_FILTERS.map((kind) => (
              <option key={kind.id} value={kind.id}>
                {kind.label}
              </option>
            ))}
          </select>
        </label>
        {roots.length > 1 && (
          <label class="os-field">
            <span class="control-label">Folder</span>
            <select class="input" value={root === null ? '' : String(root)} onChange={(e) => setRoot(e.currentTarget.value ? Number(e.currentTarget.value) : null)}>
              <option value="">All folders</option>
              {roots.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.path}
                </option>
              ))}
            </select>
          </label>
        )}
        <label class="os-check">
          <input type="checkbox" checked={options.wholeWords} onChange={(e) => setOptions({ ...options, wholeWords: e.currentTarget.checked })} />
          <span>Whole words only</span>
        </label>
      </div>
      <p class="os-tips tone-muted">
        All words must be found. <code>"exact words"</code> <code>-without</code> <code>this OR that</code> <code>begin*</code> <code>ext:pdf</code> <code>type:code</code> <code>name:report</code>{' '}
        <code>path:2024</code>
      </p>

      {!isDesktop && (
        <p class="os-gate" data-testid="os-gate">
          <Icon name="info" size={15} /> Searching folders on this computer needs the Benchtop desktop app. Here in the browser, your notes are searched.
        </p>
      )}

      <div class="os-main">
        <div class="os-results" data-testid="os-results">
          {searching && (
            <p class="os-count" data-testid="os-count" role="status">
              {total
                ? `${answer ? `${answer.places.toLocaleString()} ${answer.places === 1 ? 'place' : 'places'} in ${answer.files.toLocaleString()} ${answer.files === 1 ? 'file' : 'files'}` : ''}${
                    answer && noteHits.length ? ', ' : ''
                  }${noteHits.length ? `${noteHits.length.toLocaleString()} ${noteHits.length === 1 ? 'note' : 'notes'}` : ''}`
                : 'Nothing found'}
              {answer && answer.hits.length < answer.places ? ` (the best ${answer.hits.length.toLocaleString()} are shown)` : ''}
            </p>
          )}
          {!searching && isDesktop && roots.length === 0 && (
            <div class="os-empty">
              <strong>Choose the folders to search</strong>
              <p>Benchtop reads the files in them once and keeps an index on this computer, so later searches are instant.</p>
              <button type="button" class="button button-primary" onClick={() => void addFolder()} data-testid="os-add-first">
                <Icon name="plus" size={14} /> Add a folder
              </button>
            </div>
          )}
          {!searching && (roots.length > 0 || !isDesktop) && (
            <p class="tone-muted os-hint">
              {isDesktop
                ? `${(status?.files ?? 0).toLocaleString()} files in ${roots.length} ${roots.length === 1 ? 'folder' : 'folders'} and ${notes.length.toLocaleString()} notes are ready to search.`
                : `${notes.length.toLocaleString()} notes are ready to search.`}
            </p>
          )}
          <ul class="os-list">
            {noteHits.map((note) => (
              <li key={`note-${note.id}`}>
                <button
                  type="button"
                  class={`os-hit${selected && 'note' in selected && selected.note.id === note.id ? ' is-selected' : ''}`}
                  onClick={() => setSelected({ note })}
                  onDblClick={() => {
                    wantNote(note.id);
                    navigate(toolHref('notes'));
                  }}
                  data-testid="os-note"
                >
                  <span class="os-name">{note.title || 'Untitled note'}</span>
                  <span class="os-meta">Note, {new Date(note.modified).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  <span class="os-snippet">
                    <Marked text={note.snippet} />
                  </span>
                </button>
              </li>
            ))}
            {groups.map((group) => (
              <li key={group.file}>
                <div class="os-file">
                  <span class="os-name">
                    <Marked text={group.first.name} />
                  </span>
                  <span class="os-meta">
                    {KIND_LABELS[group.first.kind] ?? 'File'}, {formatBytes(group.first.size)}, {shortDate(group.first.mtime)}
                    {roots.length > 1 ? `, in ${group.first.folder}` : ''}
                  </span>
                </div>
                {group.places.slice(0, 4).map((place) => (
                  <button type="button" key={place.row} class={`os-hit${row === place.row ? ' is-selected' : ''}`} onClick={() => setSelected({ row: place.row, hit: place })} data-testid="os-hit">
                    {placeLabel(place) && <span class="os-place">{placeLabel(place)}</span>}
                    <span class="os-snippet">{place.snippet ? <Marked text={place.snippet} /> : place.note || (place.status === 'pending' ? 'Waiting to be read' : 'Found by its name')}</span>
                  </button>
                ))}
                {group.places.length > 4 && <span class="os-more tone-muted">and {(group.places.length - 4).toLocaleString()} more places in this file</span>}
              </li>
            ))}
          </ul>
        </div>

        <aside class="os-side" aria-label="The selected match">
          {hit ? (
            <div class="os-preview" data-testid="os-preview">
              <strong class="os-path">{hit.rel}</strong>
              <span class="tone-muted">{hit.folder}</span>
              <div class="os-actions">
                <label>
                  <span class="visually-hidden">Open {hit.rel} in a tool</span>
                  <select
                    class="input"
                    value=""
                    onFocus={() => {
                      if (!tools) void attempt(async () => setTools(await suggestTools([await asFile(hit)])));
                    }}
                    onChange={(e) => {
                      const id = e.currentTarget.value;
                      e.currentTarget.value = '';
                      if (id) void attempt(async () => sendToTool(id, { files: [await asFile(hit)] }));
                    }}
                    data-testid="os-open"
                  >
                    <option value="">Open in…</option>
                    {(tools ?? []).map((s) => (
                      <option key={s.tool.id} value={s.tool.id}>
                        {s.tool.name}: {s.does}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" class="button button-small" onClick={() => attempt(() => revealIndexedFile(hit.file))}>
                  <Icon name="open" size={13} /> Show in folder
                </button>
                <button
                  type="button"
                  class="button button-small"
                  onClick={() =>
                    attempt(async () => {
                      await copyText(`${hit.folder}${hit.folder.includes('\\') ? '\\' : '/'}${hit.folder.includes('\\') ? hit.rel.replaceAll('/', '\\') : hit.rel}`);
                      notify('Path copied');
                    })
                  }
                >
                  <Icon name="copy" size={13} /> Copy path
                </button>
              </div>
              {hit.note && <p class="tone-muted">{hit.note}</p>}
              {shown && (
                <>
                  <div class="os-part">
                    <button
                      type="button"
                      class="icon-button"
                      disabled={shown.part <= 0}
                      aria-label="Previous part of this file"
                      onClick={() => setSelected({ row: hit.file * 65536 + shown.part - 1, hit })}
                    >
                      <Icon name="left" size={14} />
                    </button>
                    <span>
                      {placeLabel({ label: shown.label, line: shown.line }) || 'Text'}
                      {shown.parts > 1 ? ` (part ${shown.part + 1} of ${shown.parts})` : ''}
                    </span>
                    <button
                      type="button"
                      class="icon-button"
                      disabled={shown.part >= shown.parts - 1}
                      aria-label="Next part of this file"
                      onClick={() => setSelected({ row: hit.file * 65536 + shown.part + 1, hit })}
                    >
                      <Icon name="right" size={14} />
                    </button>
                  </div>
                  <pre class="os-text" ref={preview} {...scrollRegion('The text around the match')} data-testid="os-text">
                    {shown.text ? <Marked text={shown.text} /> : 'This file has no readable text; it was found by its name.'}
                  </pre>
                </>
              )}
            </div>
          ) : selected && 'note' in selected ? (
            <div class="os-preview" data-testid="os-preview">
              <strong class="os-path">{selected.note.title || 'Untitled note'}</strong>
              <span class="tone-muted">A note in Benchtop</span>
              <div class="os-actions">
                <button
                  type="button"
                  class="button button-small"
                  onClick={() => {
                    wantNote(selected.note.id);
                    navigate(toolHref('notes'));
                  }}
                  data-testid="os-open-note"
                >
                  <Icon name="open" size={13} /> Open the note
                </button>
              </div>
              <pre class="os-text" {...scrollRegion('The text around the match')}>
                <Marked text={selected.note.snippet} />
              </pre>
            </div>
          ) : (
            <p class="tone-muted os-hint">Select a match to read the text around it.</p>
          )}
        </aside>
      </div>

      {isDesktop && (
        <details class="os-folders" open={roots.length === 0 || working || reading !== null} data-testid="os-folders">
          <summary>
            Folders and index{' '}
            <span class="tone-muted">
              {roots.length} {roots.length === 1 ? 'folder' : 'folders'}, {(status?.files ?? 0).toLocaleString()} files, index {formatBytes(status?.bytes ?? 0)}
            </span>
          </summary>
          {(working || reading) && (
            <div class="os-progress" role="status" data-testid="os-progress">
              {working && (
                <>
                  <progress max={Math.max(1, scan?.total ?? 1)} value={scan?.done ?? 0} aria-label="Updating the index" />
                  <span>
                    Updating the index{scan?.total ? `: ${scan.done.toLocaleString()} of ${scan.total.toLocaleString()}` : '…'} <span class="tone-muted">{scan?.file}</span>
                  </span>
                  <button type="button" class="button button-small" onClick={() => void cancelScan()}>
                    Stop
                  </button>
                </>
              )}
              {reading && (
                <>
                  <progress max={Math.max(1, reading.total)} value={reading.done} aria-label="Reading PDFs and pictures" />
                  <span>
                    Reading PDFs and pictures: {(reading.done + 1).toLocaleString()} of {Math.max(reading.total, reading.done + 1).toLocaleString()}{' '}
                    <span class="tone-muted">
                      {reading.name}
                      {reading.step ? `, ${reading.step}` : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    class="button button-small"
                    onClick={() => {
                      stop.current.cancelled = true;
                    }}
                  >
                    Stop
                  </button>
                </>
              )}
            </div>
          )}
          <ul class="os-roots">
            {roots.map((r) => (
              <li key={r.id} data-testid="os-root">
                <div class="os-root-head">
                  <strong>{r.path}</strong>
                  <span class="tone-muted">
                    {r.missing
                      ? 'Not found (is its drive connected?)'
                      : `${r.files.toLocaleString()} files${r.pending ? `, ${r.pending.toLocaleString()} waiting to be read` : ''}${r.failed ? `, ${r.failed.toLocaleString()} could not be read` : ''}, ${
                          r.scanned ? `updated ${new Date(r.scanned * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : 'not read yet'
                        }`}
                  </span>
                </div>
                <div class="os-root-controls">
                  <label class="os-check">
                    <input type="checkbox" checked={r.ocr} disabled={working} onChange={(e) => void setRootOptions(r.id, e.currentTarget.checked, r.hidden)} />
                    <span>Read text in pictures and scanned PDFs (slow)</span>
                  </label>
                  <label class="os-check">
                    <input type="checkbox" checked={r.hidden} disabled={working} onChange={(e) => void setRootOptions(r.id, r.ocr, e.currentTarget.checked)} />
                    <span>Include hidden files and dependency folders</span>
                  </label>
                  <button type="button" class="button button-small" disabled={working || r.missing} onClick={() => void update(r.id)}>
                    <Icon name="refresh" size={13} /> Update
                  </button>
                  <button
                    type="button"
                    class="button button-small"
                    disabled={working}
                    onClick={() =>
                      attempt(async () => {
                        await removeSearchRoot(r.id);
                        await refresh();
                        setVersion((v) => v + 1);
                        notify('Folder forgotten; its files are untouched');
                      })
                    }
                  >
                    <Icon name="trash" size={13} /> Forget
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div class="os-index">
            <button type="button" class="button" disabled={working} onClick={() => void addFolder()} data-testid="os-add-folder">
              <Icon name="plus" size={14} /> Add a folder
            </button>
            <button type="button" class="button" disabled={working || roots.length === 0} onClick={() => void update(null)} data-testid="os-update">
              <Icon name="refresh" size={14} /> Update all
            </button>
            {(status?.pending ?? 0) > 0 && !reading && (
              <button type="button" class="button" onClick={() => void readWaiting()} data-testid="os-read">
                <Icon name="play" size={14} /> Read {status?.pending.toLocaleString()} waiting PDFs and pictures
              </button>
            )}
            <label class="os-field">
              <span class="control-label">Language of text in pictures</span>
              <select class="input" value={options.language} onChange={(e) => setOptions({ ...options, language: e.currentTarget.value as OcrLanguage })}>
                {LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              class="button button-quiet"
              disabled={working || roots.length === 0}
              onClick={() => {
                if (!sure) {
                  setSure(true);
                  return;
                }
                setSure(false);
                void attempt(async () => {
                  await clearSearchIndex();
                  await refresh();
                  setVersion((v) => v + 1);
                  setSelected(null);
                  notify('Index deleted; your files are untouched');
                });
              }}
            >
              <Icon name="trash" size={14} /> {sure ? 'Click again to delete the index' : 'Delete the index'}
            </button>
          </div>
          <p class="tone-muted">
            The index is kept in Benchtop’s data folder on this computer and holds the text of your files. Files change? Press Update: only new and changed files are read again. PDFs and pictures are
            read while this page is open.
          </p>
        </details>
      )}
    </section>
  );
}

export default defineCustomTool(Component);
