/**
 * Files and folders (desktop app): Bulk Rename, Duplicate Finder, Disk Usage
 * and Folder Compare.  Folders are chosen in the system's folder dialog; the
 * work happens in the desktop side, and deleted files go to the trash.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { formatBytes } from '../../lib/bytes';
import { clashes, DEFAULT_RULES, planRenames, type RenameFile, type RenameRules, regexProblem } from '../../lib/rename';
import { squarify } from '../../lib/treemap';
import { isDesktop } from '../../platform';
import {
  type BulkProgress,
  type CompareRow,
  cancelBulk,
  compareFolders,
  copyBetween,
  type DupReport,
  findDuplicates,
  listFiles,
  measureFolder,
  onBulkProgress,
  renameFiles,
  trashFiles,
  type UsageNode,
  type UsageReport,
} from '../../platform/bulk';
import { pickFolder } from '../../platform/convert';
import { scrollRegion } from '../../ui/a11y';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';

type Folder = { token: string; path: string };

const when = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

function DesktopNote() {
  if (isDesktop) return null;
  return <p class="recipe-error">This tool works on folders on this computer, so it needs the desktop app.</p>;
}

function FolderButton({ folder, onPick, label = 'Choose folder…', testId }: { folder: Folder | null; onPick: (f: Folder) => void; label?: string; testId?: string }) {
  return (
    <span class="fl-folder">
      <button
        type="button"
        class="button"
        disabled={!isDesktop}
        onClick={() =>
          attempt(async () => {
            const f = await pickFolder();
            if (f) onPick(f);
          })
        }
        data-testid={testId}
      >
        <Icon name="open" size={14} /> {label}
      </button>
      <span class="tone-muted fl-path" title={folder?.path}>
        {folder?.path ?? 'No folder chosen'}
      </span>
    </span>
  );
}

function useProgress(id: string | null): BulkProgress | null {
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  useEffect(() => {
    const off = onBulkProgress((p) => {
      if (p.id === id) setProgress(p);
    });
    return () => void off.then((stop) => stop());
  }, [id]);
  useEffect(() => {
    if (!id) setProgress(null);
  }, [id]);
  return progress;
}

function ProgressLine({ id, progress }: { id: string | null; progress: BulkProgress | null }) {
  if (!id) return null;
  return (
    <span class="fl-progress" aria-live="polite">
      {progress ? `${progress.stage}: ${progress.done.toLocaleString()}${progress.total ? ` of ${progress.total.toLocaleString()}` : ' files'}` : 'Working…'}
      <button type="button" class="button button-small" onClick={() => void cancelBulk(id)}>
        Stop
      </button>
    </span>
  );
}

/* ----------------------------------------------------------- Bulk Rename -- */

const readRules = (v: Values | undefined): RenameRules => {
  const r = { ...DEFAULT_RULES };
  if (!v) return r;
  return {
    template: typeof v.template === 'string' ? v.template : r.template,
    find: typeof v.find === 'string' ? v.find : r.find,
    replace: typeof v.replace === 'string' ? v.replace : r.replace,
    regex: v.regex === true,
    matchCase: v.matchCase === true,
    caseRule: ['keep', 'lower', 'upper', 'title', 'sentence'].includes(v.caseRule as string) ? (v.caseRule as RenameRules['caseRule']) : r.caseRule,
    spaces: ['keep', 'dash', 'underscore', 'remove'].includes(v.spaces as string) ? (v.spaces as RenameRules['spaces']) : r.spaces,
    ext: ['keep', 'lower', 'upper', 'set', 'remove'].includes(v.ext as string) ? (v.ext as RenameRules['ext']) : r.ext,
    newExt: typeof v.newExt === 'string' ? v.newExt : r.newExt,
    start: typeof v.start === 'number' ? v.start : r.start,
    step: typeof v.step === 'number' && v.step !== 0 ? v.step : r.step,
    sort: ['name', 'modified', 'size', 'list'].includes(v.sort as string) ? (v.sort as RenameRules['sort']) : r.sort,
    tidy: v.tidy !== false,
  };
};
const writeRules = (r: RenameRules): Values => ({ ...r });

const TEMPLATES: readonly [string, string][] = [
  ['{name}', 'Keep the name'],
  ['{n:3} {name}', 'Number first'],
  ['{date:YYYY-MM-DD} {name}', 'Date first'],
  ['{folder} {n:3}', 'Folder and number'],
  ['{date:YYYYMMDD}_{time:hhmmss}', 'Date and time'],
];

function BulkRename({ toolId }: { toolId: string }) {
  const [rules, setRules] = usePersistentState(toolId, readRules, writeRules);
  const [folder, setFolder] = useState<Folder | null>(null);
  const [recursive, setRecursive] = useState(false);
  const [files, setFiles] = useState<RenameFile[]>([]);
  const [filter, setFilter] = useState('');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [undo, setUndo] = useState<{ from: string; to: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof RenameRules>(k: K, v: RenameRules[K]) => setRules((r) => ({ ...r, [k]: v }));

  const load = (f: Folder | null = folder, deep = recursive) =>
    attempt(async () => {
      if (!f) return;
      setFiles(await listFiles(f.token, deep, false));
      setExcluded(new Set());
    });

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return files;
    // "*.jpg" style patterns, or plain text anywhere in the path.
    if (q.includes('*') || q.includes('?')) {
      const re = new RegExp(
        `^${q
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.')}$`,
        'i',
      );
      return files.filter((f) => re.test(f.path.split('/').pop() ?? ''));
    }
    return files.filter((f) => f.path.toLowerCase().includes(q));
  }, [files, filter]);
  const chosen = useMemo(() => shown.filter((f) => !excluded.has(f.path)), [shown, excluded]);
  const plan = useMemo(
    () =>
      clashes(
        planRenames(chosen, rules),
        files.map((f) => f.path),
      ),
    [chosen, rules, files],
  );
  const changing = plan.filter((p) => p.from !== p.to);
  const problems = plan.filter((p) => p.problem);
  const regexError = regexProblem(rules);

  const run = () =>
    attempt(async () => {
      if (!folder) return;
      setBusy(true);
      try {
        const result = await renameFiles(
          folder.token,
          changing.map(({ from, to }) => ({ from, to })),
        );
        setUndo(result.done.map(([from, to]) => ({ from: to, to: from })));
        notify(
          `Renamed ${result.done.length} ${result.done.length === 1 ? 'file' : 'files'}${result.failed.length ? `; ${result.failed.length} could not be renamed (${result.failed[0]?.[1]})` : ''}`,
          result.failed.length ? 'error' : 'info',
        );
        await load();
      } finally {
        setBusy(false);
      }
    });

  const undoLast = () =>
    attempt(async () => {
      if (!folder || !undo) return;
      const result = await renameFiles(folder.token, undo);
      notify(`Put back ${result.done.length} names`);
      setUndo(null);
      await load();
    });

  return (
    <section class="tool fl-tool" data-testid="tool" data-state={files.length ? 'done' : 'idle'}>
      <DesktopNote />
      <div class="button-row">
        <FolderButton
          folder={folder}
          onPick={(f) => {
            setFolder(f);
            void load(f);
          }}
          testId="rn-folder"
        />
        <label class="check">
          <input
            type="checkbox"
            checked={recursive}
            onChange={(e) => {
              setRecursive(e.currentTarget.checked);
              void load(folder, e.currentTarget.checked);
            }}
          />{' '}
          Include subfolders
        </label>
        <input class="input fl-filter" type="search" placeholder="Only names like *.jpg" aria-label="Filter files" value={filter} onInput={(e) => setFilter(e.currentTarget.value)} />
      </div>
      <div class="rn-rules">
        <label class="control rn-template">
          <span class="control-label">New name</span>
          <input class="input" value={rules.template} onInput={(e) => set('template', e.currentTarget.value)} spellcheck={false} data-testid="rn-template" />
          <span class="control-help">
            Fields: <code>{'{name}'}</code> <code>{'{ext}'}</code> <code>{'{n}'}</code> or <code>{'{n:3}'}</code> (number, padded) <code>{'{date:YYYY-MM-DD}'}</code> <code>{'{time:hh-mm}'}</code>{' '}
            <code>{'{folder}'}</code> <code>{'{size}'}</code>
          </span>
        </label>
        <label class="control">
          <span class="control-label">Starting points</span>
          <select class="select" value="" onChange={(e) => e.currentTarget.value && set('template', e.currentTarget.value)}>
            <option value="">Templates…</option>
            {TEMPLATES.map(([t, label]) => (
              <option key={t} value={t}>
                {label}: {t}
              </option>
            ))}
          </select>
        </label>
        <label class="control">
          <span class="control-label">Find</span>
          <input class="input" value={rules.find} onInput={(e) => set('find', e.currentTarget.value)} spellcheck={false} />
        </label>
        <label class="control">
          <span class="control-label">Replace with</span>
          <input class="input" value={rules.replace} onInput={(e) => set('replace', e.currentTarget.value)} spellcheck={false} />
        </label>
        <div class="control rn-checks">
          <label class="check">
            <input type="checkbox" checked={rules.regex} onChange={(e) => set('regex', e.currentTarget.checked)} /> Regular expression ($1 for groups)
          </label>
          <label class="check">
            <input type="checkbox" checked={rules.matchCase} onChange={(e) => set('matchCase', e.currentTarget.checked)} /> Match case
          </label>
          <label class="check">
            <input type="checkbox" checked={rules.tidy} onChange={(e) => set('tidy', e.currentTarget.checked)} /> Tidy spaces and dashes
          </label>
        </div>
        <label class="control">
          <span class="control-label">Letters</span>
          <select class="select" value={rules.caseRule} onChange={(e) => set('caseRule', e.currentTarget.value as RenameRules['caseRule'])}>
            <option value="keep">As they are</option>
            <option value="lower">lower case</option>
            <option value="upper">UPPER CASE</option>
            <option value="title">Title Case</option>
            <option value="sentence">Sentence case</option>
          </select>
        </label>
        <label class="control">
          <span class="control-label">Spaces</span>
          <select class="select" value={rules.spaces} onChange={(e) => set('spaces', e.currentTarget.value as RenameRules['spaces'])}>
            <option value="keep">Keep</option>
            <option value="dash">Change to -</option>
            <option value="underscore">Change to _</option>
            <option value="remove">Remove</option>
          </select>
        </label>
        <label class="control">
          <span class="control-label">Extension</span>
          <select class="select" value={rules.ext} onChange={(e) => set('ext', e.currentTarget.value as RenameRules['ext'])}>
            <option value="keep">Keep</option>
            <option value="lower">lower case</option>
            <option value="upper">UPPER CASE</option>
            <option value="set">Change to…</option>
            <option value="remove">Remove</option>
          </select>
          {rules.ext === 'set' && <input class="input" value={rules.newExt} placeholder="jpg" aria-label="New extension" onInput={(e) => set('newExt', e.currentTarget.value)} />}
        </label>
        <label class="control">
          <span class="control-label">Numbers</span>
          <span class="rn-numbers">
            <input class="input" type="number" value={rules.start} aria-label="Start at" title="Start at" onInput={(e) => set('start', Number(e.currentTarget.value) || 0)} />
            <input class="input" type="number" value={rules.step} aria-label="Step" title="Step" onInput={(e) => set('step', Number(e.currentTarget.value) || 1)} />
          </span>
        </label>
        <label class="control">
          <span class="control-label">Number in order of</span>
          <select class="select" value={rules.sort} onChange={(e) => set('sort', e.currentTarget.value as RenameRules['sort'])}>
            <option value="list">The list below</option>
            <option value="name">Name</option>
            <option value="modified">Date changed</option>
            <option value="size">Size</option>
          </select>
        </label>
      </div>
      {regexError && <p class="recipe-error">The regular expression is not valid: {regexError}</p>}
      <div class="button-row">
        <button type="button" class="button button-primary" disabled={!isDesktop || busy || !changing.length || problems.length > 0 || !!regexError} onClick={run} data-testid="rn-run">
          Rename {changing.length} {changing.length === 1 ? 'file' : 'files'}
        </button>
        {undo && undo.length > 0 && (
          <button type="button" class="button" onClick={undoLast}>
            Undo the last renaming
          </button>
        )}
        <span class="tone-muted">
          {files.length ? `${chosen.length} of ${files.length} files chosen` : 'Choose a folder to see its files.'}
          {problems.length > 0 && <span class="fl-bad"> · {problems.length} names need fixing</span>}
        </span>
      </div>
      {plan.length > 0 && (
        <div class="fl-table-wrap" {...scrollRegion('Renaming preview')}>
          <table class="data-table fl-table" data-testid="rn-preview">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" aria-label="Choose all" checked={excluded.size === 0} onChange={(e) => setExcluded(e.currentTarget.checked ? new Set() : new Set(shown.map((f) => f.path)))} />
                </th>
                <th>Now</th>
                <th>After</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 2000).map((f) => {
                const p = plan.find((x) => x.from === f.path);
                const off = excluded.has(f.path);
                return (
                  <tr key={f.path} class={off ? 'is-off' : p?.problem ? 'is-bad' : p && p.to !== p.from ? 'is-changed' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Rename ${f.path}`}
                        checked={!off}
                        onChange={(e) => {
                          const on = e.currentTarget.checked;
                          setExcluded((x) => {
                            const next = new Set(x);
                            if (on) next.delete(f.path);
                            else next.add(f.path);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td>{f.path}</td>
                    <td>
                      {off ? <span class="tone-muted">unchanged</span> : p?.to}
                      {p?.problem && !off && <span class="fl-bad"> — {p.problem}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------ Duplicate Finder -- */

function DuplicateFinder() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [minKb, setMinKb] = useState(1);
  const [hidden, setHidden] = useState(false);
  const [job, setJob] = useState<string | null>(null);
  const [report, setReport] = useState<DupReport | null>(null);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const progress = useProgress(job);
  const keyOf = (folder: number, path: string) => `${folder}\u0000${path}`;

  const scan = () =>
    attempt(async () => {
      const id = `dup-${Date.now()}`;
      setJob(id);
      setReport(null);
      setMarked(new Set());
      try {
        const r = await findDuplicates(
          id,
          folders.map((f) => f.token),
          minKb * 1024,
          hidden,
        );
        setReport(r);
      } finally {
        setJob(null);
      }
    });

  const keepOne = (which: 'newest' | 'oldest' | 'first') => {
    if (!report) return;
    const next = new Set<string>();
    for (const g of report.groups) {
      const sorted = [...g.files].sort((a, b) => (which === 'first' ? 0 : which === 'newest' ? b.modified - a.modified : a.modified - b.modified));
      for (const f of sorted.slice(1)) next.add(keyOf(f.folder, f.path));
    }
    setMarked(next);
  };

  const markedSize = report ? report.groups.reduce((sum, g) => sum + g.files.filter((f) => marked.has(keyOf(f.folder, f.path))).length * g.size, 0) : 0;
  const everyCopyMarked = report?.groups.some((g) => g.files.every((f) => marked.has(keyOf(f.folder, f.path)))) ?? false;

  const remove = () =>
    attempt(async () => {
      if (!report) return;
      const items: [string, string][] = [];
      for (const g of report.groups) for (const f of g.files) if (marked.has(keyOf(f.folder, f.path))) items.push([(folders[f.folder] as Folder).token, f.path]);
      const failed = await trashFiles(items);
      setConfirm(false);
      notify(`Moved ${items.length - failed.length} files to the trash${failed.length ? `; ${failed.length} could not be moved` : ''}`);
      setReport({
        ...report,
        groups: report.groups.map((g) => ({ ...g, files: g.files.filter((f) => !marked.has(keyOf(f.folder, f.path)) || failed.some(([p]) => p === f.path)) })).filter((g) => g.files.length > 1),
      });
      setMarked(new Set());
    });

  return (
    <section class="tool fl-tool" data-testid="tool" data-state={report ? 'done' : job ? 'busy' : 'idle'}>
      <DesktopNote />
      <div class="button-row">
        <FolderButton folder={null} label="Add a folder…" onPick={(f) => setFolders((list) => (list.some((x) => x.path === f.path) ? list : [...list, f]))} testId="dup-add" />
        {folders.map((f) => (
          <span key={f.token} class="chip">
            {f.path}
            <button type="button" class="icon-button" aria-label={`Remove ${f.path}`} onClick={() => setFolders((list) => list.filter((x) => x !== f))}>
              <Icon name="close" size={12} />
            </button>
          </span>
        ))}
      </div>
      <div class="button-row">
        <label class="control control-inline">
          <span class="control-label">Ignore files under</span>
          <input class="input input-narrow" type="number" min={0} value={minKb} onInput={(e) => setMinKb(Math.max(0, Number(e.currentTarget.value) || 0))} />
          <span class="tone-muted">KB</span>
        </label>
        <label class="check">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.currentTarget.checked)} /> Include hidden files
        </label>
        <button type="button" class="button button-primary" disabled={!folders.length || !!job} onClick={scan} data-testid="dup-scan">
          Find duplicates
        </button>
        <ProgressLine id={job} progress={progress} />
      </div>
      {report && (
        <>
          <p data-testid="dup-summary">
            {report.groups.length ? (
              <>
                <strong>{report.groups.length}</strong> sets of identical files among {report.scanned.toLocaleString()} files; keeping one of each would free{' '}
                <strong>{formatBytes(report.wasted)}</strong>.
              </>
            ) : (
              `No duplicates among ${report.scanned.toLocaleString()} files.`
            )}{' '}
            Files are compared by their contents (BLAKE3 checksums), not by name.
          </p>
          {report.groups.length > 0 && (
            <div class="button-row">
              <span class="control-label">Mark all but one in every set:</span>
              <button type="button" class="button button-small" onClick={() => keepOne('newest')}>
                Keep the newest
              </button>
              <button type="button" class="button button-small" onClick={() => keepOne('oldest')}>
                Keep the oldest
              </button>
              <button type="button" class="button button-small" onClick={() => keepOne('first')}>
                Keep the first listed
              </button>
              <button type="button" class="button button-small button-quiet" onClick={() => setMarked(new Set())}>
                Clear marks
              </button>
              {confirm ? (
                <span class="nt-confirm">
                  Move {marked.size} files ({formatBytes(markedSize)}) to the trash?
                  <button type="button" class="button button-small button-danger" onClick={remove}>
                    Move to trash
                  </button>
                  <button type="button" class="button button-small" onClick={() => setConfirm(false)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button type="button" class="button button-danger" disabled={!marked.size} onClick={() => setConfirm(true)}>
                  <Icon name="trash" size={14} /> Move {marked.size} marked to trash
                </button>
              )}
            </div>
          )}
          {everyCopyMarked && <p class="mm-warn">Every copy in at least one set is marked; nothing of that file would be left.</p>}
          <div class="dup-groups" {...scrollRegion('Duplicate files')}>
            {report.groups.slice(0, 500).map((g) => (
              <div key={g.hash} class="dup-group">
                <div class="dup-head">
                  {g.files.length} copies · {formatBytes(g.size)} each
                </div>
                {g.files.map((f) => {
                  const k = keyOf(f.folder, f.path);
                  return (
                    <label key={k} class={`dup-file${marked.has(k) ? ' is-marked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={marked.has(k)}
                        onChange={(e) => {
                          const on = e.currentTarget.checked;
                          setMarked((m) => {
                            const next = new Set(m);
                            if (on) next.add(k);
                            else next.delete(k);
                            return next;
                          });
                        }}
                      />
                      <span class="dup-path">
                        {folders.length > 1 && <span class="tone-muted">{folders[f.folder]?.path}/</span>}
                        {f.path}
                      </span>
                      <span class="tone-muted">{when(f.modified)}</span>
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ Disk Usage -- */

const TREE_COLOURS = ['#3f8f6b', '#4f7cac', '#b07d3a', '#8c5fa8', '#b0546b', '#4c9aa0', '#7a8a3a', '#a8684f'];

function DiskUsage() {
  const [folder, setFolder] = useState<Folder | null>(null);
  const [job, setJob] = useState<string | null>(null);
  const [report, setReport] = useState<UsageReport | null>(null);
  const [trail, setTrail] = useState<UsageNode[]>([]);
  const progress = useProgress(job);

  const measure = (f: Folder | null = folder) =>
    attempt(async () => {
      if (!f) return;
      const id = `du-${Date.now()}`;
      setJob(id);
      try {
        const r = await measureFolder(id, f.token);
        setReport(r);
        setTrail([r.tree]);
      } finally {
        setJob(null);
      }
    });

  const node = trail[trail.length - 1];
  const W = 900;
  const H = 420;
  const boxes = node ? squarify(node.children, (c) => c.size, { x: 0, y: 0, w: W, h: H }) : [];

  return (
    <section class="tool fl-tool" data-testid="tool" data-state={report ? 'done' : job ? 'busy' : 'idle'}>
      <DesktopNote />
      <div class="button-row">
        <FolderButton
          folder={folder}
          onPick={(f) => {
            setFolder(f);
            void measure(f);
          }}
          testId="du-folder"
        />
        {folder && !job && (
          <button type="button" class="button" onClick={() => measure()}>
            <Icon name="refresh" size={14} /> Measure again
          </button>
        )}
        <ProgressLine id={job} progress={progress} />
      </div>
      {report && node && (
        <>
          <nav class="du-trail" aria-label="Folder">
            {trail.map((n, i) => (
              <span key={`${n.name}-${i}`}>
                {i > 0 && ' / '}
                <button type="button" class="link-button" disabled={i === trail.length - 1} onClick={() => setTrail(trail.slice(0, i + 1))}>
                  {n.name}
                </button>
              </span>
            ))}
            <span class="tone-muted">
              {' '}
              · {formatBytes(node.size)} in {node.files.toLocaleString()} files
            </span>
          </nav>
          <svg class="du-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Space used in ${node.name}`} data-testid="du-map">
            {boxes.map((b, i) => {
              const canOpen = b.item.children.length > 0;
              const label = `${b.item.name} ${formatBytes(b.item.size)}`;
              return (
                <g key={b.item.name} class={canOpen ? 'du-open' : ''} onClick={() => canOpen && setTrail([...trail, b.item])}>
                  <title>{`${b.item.name}: ${formatBytes(b.item.size)} (${((b.item.size / Math.max(1, node.size)) * 100).toFixed(1)} %)`}</title>
                  <rect
                    x={b.x + 1}
                    y={b.y + 1}
                    width={Math.max(0, b.w - 2)}
                    height={Math.max(0, b.h - 2)}
                    rx={3}
                    fill={b.item.name === '(other files)' ? '#8a949c' : TREE_COLOURS[i % TREE_COLOURS.length]}
                  />
                  {b.w > 70 && b.h > 28 && (
                    <text x={b.x + 7} y={b.y + 18} class="du-label">
                      {label.length * 6.5 > b.w - 12 ? `${label.slice(0, Math.max(3, Math.floor((b.w - 12) / 6.5) - 1))}…` : label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <div class="du-columns">
            <div>
              <h3>Folders here</h3>
              <ul class="du-list">
                {node.children.map((c) => (
                  <li key={c.name}>
                    {c.children.length ? (
                      <button type="button" class="link-button" onClick={() => setTrail([...trail, c])}>
                        {c.name}
                      </button>
                    ) : (
                      <span>{c.name}</span>
                    )}
                    <span class="du-bar" style={{ width: `${(c.size / Math.max(1, node.size)) * 100}%` }} />
                    <span class="tone-muted">{formatBytes(c.size)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Largest files</h3>
              <ol class="du-list" data-testid="du-largest">
                {report.largest.slice(0, 25).map((f) => (
                  <li key={f.path}>
                    <span class="du-name" title={f.path}>
                      {f.path}
                    </span>
                    <span class="tone-muted">{formatBytes(f.size)}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h3>By type</h3>
              <ul class="du-list">
                {report.types.slice(0, 20).map(([ext, size, count]) => (
                  <li key={ext}>
                    <span>.{ext}</span>
                    <span class="tone-muted">
                      {formatBytes(size)} · {count.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

/* -------------------------------------------------------- Folder Compare -- */

type Show = 'changes' | 'all' | 'left' | 'right' | 'different' | 'same';

function FolderCompare() {
  const [left, setLeft] = useState<Folder | null>(null);
  const [right, setRight] = useState<Folder | null>(null);
  const [checksums, setChecksums] = useState(true);
  const [job, setJob] = useState<string | null>(null);
  const [rows, setRows] = useState<CompareRow[] | null>(null);
  const [show, setShow] = useState<Show>('changes');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const progress = useProgress(job);

  const compare = () =>
    attempt(async () => {
      if (!left || !right) return;
      const id = `cmp-${Date.now()}`;
      setJob(id);
      try {
        setRows(await compareFolders(id, left.token, right.token, checksums, false));
        setPicked(new Set());
      } finally {
        setJob(null);
      }
    });

  const counts = useMemo(() => {
    const c = { same: 0, different: 0, left: 0, right: 0 };
    for (const r of rows ?? []) c[r.state]++;
    return c;
  }, [rows]);
  const visible = (rows ?? []).filter((r) => (show === 'all' ? true : show === 'changes' ? r.state !== 'same' : r.state === show));

  const copy = (to: 'left' | 'right') =>
    attempt(async () => {
      if (!left || !right) return;
      const paths = visible.filter((r) => picked.has(r.path) && (to === 'right' ? r.state !== 'right' : r.state !== 'left')).map((r) => r.path);
      const failed = await copyBetween(to === 'right' ? left.token : right.token, to === 'right' ? right.token : left.token, paths);
      notify(`Copied ${paths.length - failed.length} files to the ${to}${failed.length ? `; ${failed.length} failed` : ''}`);
      await compare();
    });

  return (
    <section class="tool fl-tool" data-testid="tool" data-state={rows ? 'done' : job ? 'busy' : 'idle'}>
      <DesktopNote />
      <div class="fc-pick">
        <FolderButton folder={left} label="Left folder…" onPick={setLeft} testId="fc-left" />
        <FolderButton folder={right} label="Right folder…" onPick={setRight} testId="fc-right" />
      </div>
      <div class="button-row">
        <label class="check">
          <input type="checkbox" checked={checksums} onChange={(e) => setChecksums(e.currentTarget.checked)} /> Compare contents (checksums), not only sizes
        </label>
        <button type="button" class="button button-primary" disabled={!left || !right || !!job} onClick={compare} data-testid="fc-run">
          Compare
        </button>
        <ProgressLine id={job} progress={progress} />
      </div>
      {rows && (
        <>
          <div class="button-row">
            <Segmented
              label="Show"
              value={show}
              onChange={setShow}
              choices={[
                { value: 'changes', label: `Changes (${counts.different + counts.left + counts.right})` },
                { value: 'different', label: `Different (${counts.different})` },
                { value: 'left', label: `Only left (${counts.left})` },
                { value: 'right', label: `Only right (${counts.right})` },
                { value: 'same', label: `Same (${counts.same})` },
                { value: 'all', label: 'All' },
              ]}
            />
            <button type="button" class="button button-small" disabled={!picked.size} onClick={() => copy('right')}>
              Copy chosen to the right →
            </button>
            <button type="button" class="button button-small" disabled={!picked.size} onClick={() => copy('left')}>
              ← Copy chosen to the left
            </button>
          </div>
          <div class="fl-table-wrap" {...scrollRegion('Comparison')}>
            <table class="data-table fl-table" data-testid="fc-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Choose all shown"
                      checked={visible.length > 0 && visible.every((r) => picked.has(r.path))}
                      onChange={(e) => setPicked(e.currentTarget.checked ? new Set(visible.map((r) => r.path)) : new Set())}
                    />
                  </th>
                  <th>File</th>
                  <th>State</th>
                  <th>Left</th>
                  <th>Right</th>
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, 3000).map((r) => (
                  <tr key={r.path} class={`fc-${r.state}`}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Choose ${r.path}`}
                        checked={picked.has(r.path)}
                        onChange={(e) => {
                          const on = e.currentTarget.checked;
                          setPicked((p) => {
                            const next = new Set(p);
                            if (on) next.add(r.path);
                            else next.delete(r.path);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td>{r.path}</td>
                    <td>{{ same: 'Same', different: 'Different', left: 'Only left', right: 'Only right' }[r.state]}</td>
                    <td class="tone-muted">{r.leftSize === null ? '—' : `${formatBytes(r.leftSize)} · ${when(r.leftModified)}`}</td>
                    <td class="tone-muted">{r.rightSize === null ? '—' : `${formatBytes(r.rightSize)} · ${when(r.rightModified)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visible.length === 0 && <p class="tone-muted">Nothing to show here.</p>}
        </>
      )}
    </section>
  );
}

function FileTools({ toolId }: { toolId: string }) {
  if (toolId === 'duplicate-finder') return <DuplicateFinder />;
  if (toolId === 'disk-usage') return <DiskUsage />;
  if (toolId === 'folder-compare') return <FolderCompare />;
  return <BulkRename toolId={toolId} />;
}

export default defineCustomTool(FileTools);
