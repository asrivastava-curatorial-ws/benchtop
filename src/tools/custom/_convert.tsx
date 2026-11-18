/** Shared pieces of the converter tools: program checks, install hints, the file queue and where results go. */
import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { copyText, isDesktop } from '../../platform';
import { formatSize, type PickedFile, pickPaths } from '../../platform/ai';
import {
  type ConvertResult,
  type Destination,
  findPrograms,
  onConvertProgress,
  PROGRAMS,
  type ProgramId,
  type Programs,
  pickFolder,
  revealResult,
  runConversion,
  stopConversion,
} from '../../platform/convert';
import { scrollRegion } from '../../ui/a11y';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { Segmented } from './_shared';

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function usePrograms(): { programs: Programs | null; error: string | null; recheck: () => void } {
  const [programs, setPrograms] = useState<Programs | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback((fresh: boolean) => {
    if (!isDesktop) return;
    findPrograms(fresh).then(setPrograms, (e) => setError(errorMessage(e)));
  }, []);
  useEffect(() => load(false), [load]);
  return { programs, error, recheck: () => load(true) };
}

export const has = (programs: Programs | null, id: ProgramId) => Boolean(programs?.programs[id]);

/** Install commands for one program, for the operating system in use. */
export function InstallHint({ id, os }: { id: Exclude<ProgramId, 'ffprobe'>; os: string }) {
  const info = PROGRAMS[id];
  const lines: [string, string][] =
    os === 'windows'
      ? [['Windows', info.install.windows]]
      : os === 'macos'
        ? [['macOS (Homebrew)', info.install.macos]]
        : [
            ['Debian, Ubuntu', info.install.debian],
            ['Fedora', info.install.fedora],
            ['Arch', info.install.arch],
          ];
  return (
    <div class="conv-install">
      <p>
        <strong>{info.name}</strong> handles {info.use}. Free and open source ({info.licence}), from <span class="mono">{info.homepage}</span>.
      </p>
      {lines.map(([label, command]) => (
        <div key={label} class="conv-command">
          <span class="conv-command-os">{label}</span>
          <code class="mono" {...scrollRegion(`${label} command`)}>
            {command}
          </code>
          <button
            type="button"
            class="button button-small button-quiet"
            onClick={() =>
              attempt(async () => {
                await copyText(command);
                notify('Copied');
              })
            }
          >
            Copy
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Shows the tool once the programs it needs are installed (any one of
 * `anyOf`, when given), and install hints otherwise.  On the web it explains
 * that the desktop app is needed.
 */
export function ProgramGate({
  needs,
  anyOf,
  what,
  children,
}: {
  needs?: readonly Exclude<ProgramId, 'ffprobe'>[];
  anyOf?: readonly Exclude<ProgramId, 'ffprobe'>[];
  what: string;
  children: ComponentChildren;
}) {
  const { programs, error, recheck } = usePrograms();
  if (!isDesktop) {
    return (
      <div data-testid="tool" class="tool">
        <div class="ai-gate" data-testid="convert-gate">
          <h2>{what} needs the desktop app</h2>
          <p>It runs programs installed on your computer, such as FFmpeg and LibreOffice, which a web page cannot start. Files never leave your computer.</p>
        </div>
      </div>
    );
  }
  if (error) return <p class="recipe-error">{error}</p>;
  if (!programs) return <p class="tool-loading">Looking for converters…</p>;
  const missing = (needs ?? []).filter((id) => !has(programs, id));
  const noneOf = anyOf && !anyOf.some((id) => has(programs, id)) ? anyOf : [];
  if (missing.length === 0 && noneOf.length === 0) return <>{children}</>;
  return (
    <div data-testid="tool" class="tool">
      <div class="ai-gate" data-testid="convert-gate">
        <h2>
          {what} needs {[...missing, ...noneOf].map((id) => PROGRAMS[id].name).join(noneOf.length > 1 ? ' or ' : ' and ')}
        </h2>
        <p>Benchtop uses the copy installed on this computer, so it stays up to date with your system. Install it, then check again.</p>
        {[...missing, ...noneOf].map((id) => (
          <InstallHint key={id} id={id} os={programs.os} />
        ))}
        <div class="button-row">
          <button type="button" class="button button-primary" onClick={recheck}>
            Check again
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- queue -- */

export interface QueueItem {
  readonly key: string;
  readonly file: PickedFile;
  readonly state: 'waiting' | 'running' | 'done' | 'failed' | 'stopped';
  readonly fraction?: number;
  readonly result?: ConvertResult;
  readonly error?: string;
}

let counter = 0;
const nextKey = () => `job-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export const extensionOf = (name: string) => (name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '');

/** Files waiting to be converted, with progress per file. */
export function useQueue() {
  const [items, setItems] = useState<readonly QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const current = useRef<string | null>(null);
  const stopped = useRef(false);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void onConvertProgress((p) => {
      setItems((list) => list.map((item) => (item.key === p.id && item.state === 'running' ? { ...item, fraction: p.fraction } : item)));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  const add = (files: readonly PickedFile[], replace = false) =>
    setItems((list) => [...(replace ? [] : list.filter((i) => i.state !== 'done')), ...files.map((file) => ({ key: nextKey(), file, state: 'waiting' as const }))]);

  const remove = (key: string) => setItems((list) => list.filter((i) => i.key !== key));
  /** Back to waiting, for another task on the same files. */
  const reset = () => setItems((list) => list.map((i) => ({ key: i.key, file: i.file, state: 'waiting' as const })));
  const clear = () => setItems([]);
  const update = (key: string, patch: Partial<QueueItem>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const move = (key: string, delta: number) =>
    setItems((list) => {
      const from = list.findIndex((i) => i.key === key);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= list.length) return list;
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });

  /** Asks for the folder when needed; returns false when the user cancelled. */
  const prepare = async (target: DestinationValue): Promise<{ ok: boolean; folder?: string }> => {
    if (target.destination !== 'folder' || target.folder) return { ok: true, folder: target.folder };
    const chosen = await pickFolder();
    if (!chosen) return { ok: false };
    target.onFolder?.(chosen);
    return { ok: true, folder: chosen.token };
  };

  /**
   * Runs `plan(item)` for every file not yet converted, one at a time.  `plan`
   * returns the recipe and options (and a second input, such as subtitles);
   * returning null skips the file.
   */
  const runAll = async (plan: (item: QueueItem) => JobPlan | null, target: DestinationValue, again = false): Promise<void> => {
    if (running) return;
    const { ok, folder } = await prepare(target);
    if (!ok) return;
    setRunning(true);
    stopped.current = false;
    const todo = items.filter((i) => again || i.state !== 'done');
    let done = 0;
    for (const item of todo) {
      if (stopped.current) break;
      const job = plan(item);
      if (!job) continue;
      current.current = item.key;
      update(item.key, { state: 'running', fraction: undefined, error: undefined });
      try {
        const inputs = job.inputs ?? (job.extra ? [item.file.token, job.extra] : [item.file.token]);
        const result = await runConversion({ id: item.key, recipe: job.recipe, inputs, options: job.options, destination: target.destination, folder });
        if (result) {
          done += 1;
          update(item.key, { state: 'done', result, fraction: 1 });
        } else {
          update(item.key, { state: 'waiting', fraction: undefined });
          if (target.destination === 'ask') break;
        }
      } catch (error) {
        const message = errorMessage(error);
        update(item.key, stopped.current || message === 'Stopped.' ? { state: 'stopped', fraction: undefined } : { state: 'failed', error: message });
      }
    }
    current.current = null;
    setRunning(false);
    if (done > 1) notify(`Done: ${done} files`);
  };

  /** One job that takes every file in the list, in order (joining). */
  const runCombined = async (job: JobPlan & { inputs: readonly string[] }, target: DestinationValue): Promise<void> => {
    if (running || !items.length) return;
    const { ok, folder } = await prepare(target);
    if (!ok) return;
    const lead = items[0].key;
    setRunning(true);
    stopped.current = false;
    current.current = lead;
    setItems((list) => list.map((i) => ({ ...i, state: 'running', fraction: undefined, error: undefined, result: undefined })));
    try {
      const result = await runConversion({ id: lead, recipe: job.recipe, inputs: job.inputs, options: job.options, destination: target.destination, folder });
      setItems((list) => list.map((i) => (result ? { ...i, state: 'done', fraction: 1, result: i.key === lead ? result : undefined } : { ...i, state: 'waiting', fraction: undefined })));
    } catch (error) {
      const message = errorMessage(error);
      setItems((list) => list.map((i) => (stopped.current || message === 'Stopped.' ? { ...i, state: 'stopped' } : { ...i, state: 'failed', error: i.key === lead ? message : undefined })));
    } finally {
      current.current = null;
      setRunning(false);
    }
  };

  const stop = () => {
    stopped.current = true;
    if (current.current) void stopConversion(current.current);
  };

  return { items, running, add, remove, reset, clear, move, runAll, runCombined, stop, update };
}

export interface JobPlan {
  readonly recipe: string;
  /** Every input, when not just the file itself (plus `extra`). */
  readonly inputs?: readonly string[];
  readonly options?: Record<string, unknown>;
  /** A second input used with each file, such as subtitles or a logo. */
  readonly extra?: string;
}

export interface DestinationValue {
  readonly destination: Destination;
  readonly folder?: string;
  readonly onFolder?: (folder: { token: string; path: string }) => void;
}

/** Where results are saved. */
export function DestinationControl({ value, folderPath, onChange }: { value: Destination; folderPath: string; onChange: (value: Destination, folder?: { token: string; path: string }) => void }) {
  return (
    <div class="control">
      <span class="control-label">Save results</span>
      <Segmented
        label="Save results"
        small={false}
        value={value}
        onChange={(next) => {
          if (next === 'folder')
            void attempt(async () => {
              const folder = await pickFolder();
              if (folder) onChange('folder', folder);
            });
          else onChange(next);
        }}
        choices={[
          { value: 'beside', label: 'Next to originals' },
          { value: 'folder', label: 'In a folder' },
          { value: 'ask', label: 'Ask each time' },
        ]}
      />
      {value === 'folder' && folderPath && <span class="conv-folder mono">{folderPath}</span>}
    </div>
  );
}

/** Remembers the destination for the session (folder tokens do not survive restarts). */
export function useDestination(): [DestinationValue & { folderPath: string }, (value: Destination, folder?: { token: string; path: string }) => void] {
  const [state, setState] = useState<{ destination: Destination; folder?: string; folderPath: string }>(() => ({ destination: 'beside', folderPath: '' }));
  const set = (destination: Destination, folder?: { token: string; path: string }) =>
    setState((s) => ({ destination, folder: folder?.token ?? (destination === 'folder' ? s.folder : undefined), folderPath: folder?.path ?? (destination === 'folder' ? s.folderPath : '') }));
  return [{ ...state, onFolder: (folder) => set('folder', folder) }, set];
}

export async function chooseFiles(multiple: boolean, name: string, extensions: readonly string[]): Promise<PickedFile[]> {
  return pickPaths(multiple, extensions.length ? [{ name, extensions }] : []);
}

/** The list of files with their state, result and actions. */
export function QueueList({
  items,
  onRemove,
  onMove,
  running,
  describe,
}: {
  items: readonly QueueItem[];
  onRemove: (key: string) => void;
  /** Shown when the order matters (joining files). */
  onMove?: (key: string, delta: number) => void;
  running: boolean;
  describe?: (item: QueueItem) => string | null;
}) {
  if (!items.length) return null;
  return (
    <ul class="conv-queue" data-testid="convert-queue">
      {items.map((item, index) => {
        const note = describe?.(item);
        return (
          <li key={item.key} class={`conv-item is-${item.state}`}>
            <Icon name="file" size={15} />
            <div class="conv-item-main">
              <span class="conv-item-name">{item.file.name}</span>
              <span class="conv-item-meta">
                {formatSize(item.file.size)}
                {note ? `, ${note}` : ''}
              </span>
              {item.state === 'running' && (
                <span class="conv-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={item.fraction === undefined ? undefined : Math.round(item.fraction * 100)}>
                  <span class={item.fraction === undefined ? 'is-indeterminate' : ''} style={item.fraction === undefined ? undefined : { width: `${Math.round(item.fraction * 100)}%` }} />
                </span>
              )}
              {item.state === 'failed' && (
                <pre class="conv-error" {...scrollRegion('Error details')}>
                  {item.error}
                </pre>
              )}
              {item.state === 'done' && item.result && (
                <span class="conv-result">
                  <Icon name="check" size={14} /> {item.result.name} ({formatSize(item.result.size)})
                </span>
              )}
            </div>
            <span class="conv-item-actions">
              {item.state === 'done' && item.result && (
                <button type="button" class="button button-small" onClick={() => attempt(() => revealResult((item.result as ConvertResult).token))}>
                  Show in folder
                </button>
              )}
              {item.state === 'stopped' && <span class="tone-muted">Stopped</span>}
              {onMove && !running && (
                <>
                  <button type="button" class="icon-button" aria-label={`Move ${item.file.name} up`} disabled={index === 0} onClick={() => onMove(item.key, -1)}>
                    <Icon name="up" size={14} />
                  </button>
                  <button type="button" class="icon-button" aria-label={`Move ${item.file.name} down`} disabled={index === items.length - 1} onClick={() => onMove(item.key, 1)}>
                    <Icon name="down" size={14} />
                  </button>
                </>
              )}
              {item.state !== 'running' && !running && (
                <button type="button" class="icon-button" aria-label={`Remove ${item.file.name}`} onClick={() => onRemove(item.key)}>
                  <Icon name="close" size={14} />
                </button>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Time in seconds as h:mm:ss.s for display. */
export function clock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '?';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const ss = s.toFixed(s % 1 ? 1 : 0).padStart(s < 10 ? (s % 1 ? 4 : 2) : 2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
