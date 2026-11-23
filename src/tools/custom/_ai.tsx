/** Shared pieces of the AI tools: model status and downloads, the "needs models" gate, and running jobs with progress. */
import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { errorMessage } from '../../lib/errors';
import { isDesktop, pickFiles, saveFile } from '../../platform';
import {
  type AiStatus,
  aiStatus,
  cancelInstall,
  cancelJob,
  type DownloadProgress,
  formatSize,
  importModels,
  installModel,
  type JobProgress,
  type ModelItem,
  type ModelKind,
  onDownload,
  onJobProgress,
  removeModel,
} from '../../platform/ai';
import { type LoadedImage, loadImageFile } from '../../ui/ImageDrop';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';

/** Model status shared by every AI screen, refreshed when a download finishes. */
let cached: AiStatus | null = null;
const listeners = new Set<() => void>();
let progress: Record<string, DownloadProgress> = {};
let subscribed = false;

async function refresh(): Promise<void> {
  cached = await aiStatus();
  for (const fn of listeners) fn();
}

function subscribe(): void {
  if (subscribed || !isDesktop) return;
  subscribed = true;
  void onDownload((p) => {
    progress = { ...progress, [p.id]: p };
    if (p.stage === 'done' || p.stage === 'error') {
      if (p.stage === 'error' && p.message) notify(p.message, 'error');
      void refresh();
    }
    for (const fn of listeners) fn();
  });
}

export function useModels(): { status: AiStatus | null; error: string | null; progress: Record<string, DownloadProgress>; reload: () => void } {
  const [, force] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isDesktop) return;
    subscribe();
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    if (!cached) refresh().catch((e: unknown) => setError(errorMessage(e)));
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return { status: cached, error, progress, reload: () => void refresh().catch((e: unknown) => setError(errorMessage(e))) };
}

export const itemsOf = (status: AiStatus | null, kind: ModelKind): ModelItem[] => status?.items.filter((item) => item.kind === kind) ?? [];

export function startDownload(id: string): void {
  progress = { ...progress, [id]: { id, stage: 'downloading', received: 0, total: cached?.items.find((i) => i.id === id)?.download.size ?? 0 } };
  for (const fn of listeners) fn();
  installModel(id).catch((e: unknown) => {
    const message = errorMessage(e);
    if (!/cancel/i.test(message)) notify(message, 'error');
    progress = { ...progress, [id]: { id, stage: 'error', received: 0, total: 0, message } };
    for (const fn of listeners) fn();
  });
}

function ProgressBar({ p }: { p: DownloadProgress }) {
  const fraction = p.total > 0 ? Math.min(1, p.received / p.total) : 0;
  return (
    <div class="ai-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
      <div class="ai-progress-bar" style={{ width: `${(p.stage === 'unpacking' ? 1 : fraction) * 100}%` }} />
      <span>{p.stage === 'unpacking' ? 'Checking and unpacking…' : `${formatSize(p.received)} of ${formatSize(p.total)}`}</span>
    </div>
  );
}

/** One downloadable item with its action button. */
export function ModelRow({ item, p, onRemove }: { item: ModelItem; p?: DownloadProgress; onRemove?: () => void }) {
  const busy = p && (p.stage === 'downloading' || p.stage === 'unpacking');
  return (
    <li class={`ai-model${item.installed ? ' is-installed' : ''}`} data-model={item.id}>
      <div class="ai-model-text">
        <span class="ai-model-name">
          {item.name}
          {item.default && <span class="pill pill-muted">recommended</span>}
        </span>
        <span class="ai-model-desc">{item.description}</span>
        <span class="ai-model-meta">
          {formatSize(item.download.size)}, {item.licence}
        </span>
        {busy && p && <ProgressBar p={p} />}
      </div>
      {item.installed ? (
        <span class="ai-model-actions">
          <span class="pill pill-ok">Ready</span>
          {onRemove && (
            <button type="button" class="button button-small button-quiet" onClick={onRemove}>
              Remove
            </button>
          )}
        </span>
      ) : busy ? (
        <button type="button" class="button button-small" onClick={() => void cancelInstall(item.id)}>
          Cancel
        </button>
      ) : (
        <button type="button" class="button button-small button-primary" onClick={() => startDownload(item.id)}>
          Download
        </button>
      )}
    </li>
  );
}

/**
 * Shows the tool only when the AI engine and a model of each kind it needs are
 * on this computer; otherwise explains what to download and offers it.
 */
export function ModelGate({ kinds, what, children }: { kinds: readonly ModelKind[]; what: string; children: ComponentChildren }) {
  const { status, error, progress: p } = useModels();
  if (!isDesktop) {
    return (
      <div data-testid="tool" class="tool">
        <div class="ai-gate" data-testid="ai-gate">
          <Icon name="info" size={22} />
          <h2>{what} needs the desktop app</h2>
          <p>It runs an AI model on this computer, which a web page cannot do. Install Benchtop for Windows, macOS or Linux; the models download once and then work offline.</p>
        </div>
      </div>
    );
  }
  if (error) return <p class="recipe-error tool">{error}</p>;
  if (!status) {
    return (
      <p class="tool-loading">
        <span class="spinner" aria-hidden="true" /> Checking the AI models…
      </p>
    );
  }
  const needed = ['runtime', ...kinds] as ModelKind[];
  const missing = needed.filter((kind) => !itemsOf(status, kind).some((item) => item.installed));
  if (missing.length === 0) return <>{children}</>;
  const offers = missing.map((kind) => itemsOf(status, kind).find((item) => item.default) ?? itemsOf(status, kind)[0]).filter((item): item is ModelItem => item !== undefined);
  const total = offers.reduce((sum, item) => sum + item.download.size, 0);
  return (
    <div data-testid="tool" class="tool">
      <div class="ai-gate" data-testid="ai-gate">
        <Icon name="file" size={22} />
        <h2>
          Download what {what} needs ({formatSize(total)})
        </h2>
        <p>
          Everything runs on this computer. The files come from GitHub, are checked against fixed SHA-256 fingerprints, and are kept for next time. You can also copy them from another computer with
          Import.
        </p>
        <ul class="ai-model-list">
          {offers.map((item) => (
            <ModelRow key={item.id} item={item} p={p[item.id]} />
          ))}
        </ul>
        <div class="button-row">
          <button
            type="button"
            class="button button-primary"
            onClick={() => {
              for (const item of offers) if (!p[item.id] || p[item.id]?.stage === 'error') startDownload(item.id);
            }}
          >
            Download all
          </button>
          <button
            type="button"
            class="button"
            onClick={() =>
              void importModels().then(
                (r) => {
                  if (!r.cancelled) notify(r.imported.length ? `Imported ${r.imported.length} file${r.imported.length === 1 ? '' : 's'}.` : 'No matching model files were found in that folder.');
                  void refresh();
                },
                (e: unknown) => notify(errorMessage(e), 'error'),
              )
            }
          >
            Import from a folder
          </button>
        </div>
      </div>
    </div>
  );
}

/** Choose among the models of one kind; ones not yet downloaded say so. */
export function ModelPicker({
  kind,
  value,
  onChange,
  label = 'Model',
  only,
}: {
  kind: ModelKind;
  value: string;
  onChange: (id: string) => void;
  label?: string;
  /** Lists only the models this accepts. */
  only?: (item: ModelItem) => boolean;
}) {
  const { status } = useModels();
  const items = itemsOf(status, kind).filter((item) => !only || only(item));
  if (items.length < 2) return null;
  return (
    <div class="control">
      <label class="control-label" for={`model-${kind}`}>
        {label}
      </label>
      <select id={`model-${kind}`} class="input" value={value} onChange={(e) => onChange(e.currentTarget.value)}>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
            {item.installed ? '' : ` (download ${formatSize(item.download.size)})`}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The model to use for `kind`: the user's choice, else the installed default, else any installed one. */
export function chosenModel(status: AiStatus | null, kind: ModelKind, choice: string, only?: (item: ModelItem) => boolean): string {
  const items = itemsOf(status, kind).filter((item) => !only || only(item));
  if (items.some((item) => item.id === choice)) return choice;
  return (items.find((item) => item.default && item.installed) ?? items.find((item) => item.installed) ?? items.find((item) => item.default) ?? items[0])?.id ?? '';
}

export interface JobState {
  readonly running: boolean;
  readonly progress: JobProgress | null;
  readonly started: number;
}

/** Runs one AI job at a time with progress events and a Stop button. */
export function useJob(): [JobState, <T>(fn: () => Promise<T>) => Promise<T | null>, () => void] {
  const [state, setState] = useState<JobState>({ running: false, progress: null, started: 0 });
  const active = useRef(false);
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void onJobProgress((p) => {
      if (active.current) setState((s) => ({ ...s, progress: p }));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    active.current = true;
    setState({ running: true, progress: null, started: Date.now() });
    try {
      return await fn();
    } catch (error) {
      notify(errorMessage(error), 'error');
      return null;
    } finally {
      active.current = false;
      setState({ running: false, progress: null, started: 0 });
    }
  }, []);
  return [state, run, () => void cancelJob()];
}

export function JobStatus({ job, onStop, idle }: { job: JobState; onStop: () => void; idle?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!job.running) return;
    const timer = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, [job.running]);
  if (!job.running) return idle ? <span class="ai-status tone-muted">{idle}</span> : null;
  const seconds = Math.round((Date.now() - job.started) / 1000);
  return (
    <span class="ai-status" aria-live="polite">
      <span class="spinner" aria-hidden="true" /> {job.progress?.stage ?? 'Starting the AI engine'}
      {job.progress ? ` ${Math.round(job.progress.value * 100)}%` : ''}, {seconds} s
      <button type="button" class="button button-small" onClick={onStop}>
        Stop
      </button>
    </span>
  );
}

/** "file.png" → "file (2).png" until the name is free. */
function freeName(name: string, taken: Record<string, unknown>): string {
  if (!(name in taken)) return name;
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let n = 2; ; n++) if (!(`${stem} (${n})${ext}` in taken)) return `${stem} (${n})${ext}`;
}

/**
 * Runs the tool's current settings on many pictures, one after another, and
 * saves the results together in one ZIP file.
 */
export function BatchButton({
  label,
  disabled,
  run,
  process,
  rename,
  zipName,
}: {
  label: string;
  disabled?: boolean;
  /** The tool's useJob runner, so progress and Stop work as for one picture. */
  run: <T>(fn: () => Promise<T>) => Promise<T | null>;
  process: (image: LoadedImage) => Promise<Uint8Array>;
  rename: (name: string) => string;
  zipName: string;
}) {
  const [note, setNote] = useState('');
  const go = () =>
    attempt(async () => {
      const files = await pickFiles('image/*');
      if (!files.length) return;
      await run(async () => {
        const results: Record<string, Uint8Array> = {};
        const failed: string[] = [];
        try {
          for (const [i, file] of files.entries()) {
            setNote(`Picture ${i + 1} of ${files.length}: ${file.name}`);
            let image: LoadedImage;
            try {
              image = await loadImageFile(file);
            } catch {
              failed.push(file.name);
              continue;
            }
            results[freeName(rename(file.name), results)] = await process(image);
          }
        } finally {
          setNote('');
        }
        const count = Object.keys(results).length;
        if (count === 0) throw new Error('None of the chosen files could be read as a picture.');
        const { zipSync } = await import('fflate');
        // PNG and JPEG are already compressed; storing them is faster and as small.
        const saved = await saveFile(zipName, zipSync(results, { level: 0 }), 'application/zip');
        if (saved.saved) notify(`Saved ${count} picture${count === 1 ? '' : 's'} to ${saved.location}${failed.length ? `. Not pictures: ${failed.join(', ')}` : ''}`);
      });
    });
  return (
    <>
      <button type="button" class="button" disabled={disabled} onClick={go} data-testid="ai-batch">
        {label}
      </button>
      {note && (
        <span class="ai-status tone-muted" aria-live="polite">
          {note}
        </span>
      )}
    </>
  );
}

/** Settings → AI models: everything that can be downloaded, with sizes, licences and removal. */
export function AiModelsPanel() {
  const { status, error, progress: p, reload } = useModels();
  if (!isDesktop) return <p class="tone-muted">AI models are managed in the desktop app.</p>;
  if (error) return <p class="recipe-error">{error}</p>;
  if (!status) return <p class="tool-loading">Loading…</p>;
  const groups: [ModelKind, string][] = [
    ['runtime', 'AI engine (ONNX Runtime 1.22, MIT licence)'],
    ['gpuRuntime', status.platform === 'windows' ? 'GPU pack (optional, any DirectX 12 graphics card)' : 'NVIDIA GPU pack (optional, Linux with CUDA 12)'],
    ['background', 'Background removal'],
    ['upscale', 'Upscaling'],
    ['faces', 'Face detection'],
    ['eraser', 'Object eraser'],
    ['speech', 'Speech recognition'],
    ['vad', 'Speech detection'],
    ['voice', 'Voices for text to speech (Piper; each voice has its own licence, shown on its card)'],
  ];
  const used = status.items.filter((i) => i.installed).reduce((s, i) => s + i.download.size, 0);
  return (
    <div class="ai-panel" data-testid="ai-models">
      <p class="tone-muted">
        Stored in <span class="mono">{status.folder}</span>, using about {formatSize(used)}. Downloads come from each publisher (GitHub or Hugging Face), with this project’s GitHub mirror as a
        fallback, and are checked against fixed SHA-256 fingerprints. Jobs use {status.threads} processor threads, and the GPU when one is available.
      </p>
      <div class="button-row">
        <button
          type="button"
          class="button"
          onClick={() =>
            void importModels().then(
              (r) => {
                if (!r.cancelled) notify(r.imported.length ? `Imported ${r.imported.join(', ')}.` : 'No matching model files were found in that folder.');
                reload();
              },
              (e: unknown) => notify(errorMessage(e), 'error'),
            )
          }
        >
          Import from a folder
        </button>
      </div>
      {groups.map(([kind, title]) => {
        const items = itemsOf(status, kind);
        if (items.length === 0) return null;
        return (
          <section key={kind} class="ai-group">
            <h3>{title}</h3>
            <ul class="ai-model-list">
              {items.map((item) => (
                <ModelRow
                  key={item.id}
                  item={item}
                  p={p[item.id]}
                  onRemove={() =>
                    void removeModel(item.id).then(
                      () => reload(),
                      (e: unknown) => notify(errorMessage(e), 'error'),
                    )
                  }
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

const AI_FORMATS = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/tiff', 'image/gif'];

/** The original file when the AI engine can read it, otherwise a PNG of the decoded picture (HEIC, AVIF, SVG…). */
export async function imageBytes(image: { readonly canvas: HTMLCanvasElement; readonly type: string; readonly file: Blob }): Promise<Uint8Array> {
  if (AI_FORMATS.includes(image.type)) return new Uint8Array(await image.file.arrayBuffer());
  const blob = await new Promise<Blob | null>((resolve) => image.canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The picture could not be converted for the AI engine.');
  return new Uint8Array(await blob.arrayBuffer());
}

export function useBlobUrl(bytes: Uint8Array | null, mime = 'image/png'): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!bytes) {
      setUrl(null);
      return;
    }
    const made = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [bytes, mime]);
  return url;
}

export function BeforeAfter({
  before,
  after,
  afterLabel = 'Result',
  checker = false,
  children,
}: {
  before: string | null;
  after: string | null;
  afterLabel?: string;
  checker?: boolean;
  children?: ComponentChildren;
}) {
  return (
    <div class="ai-compare">
      <figure class="ai-figure">
        <figcaption>Original</figcaption>
        <div class="ai-stage">{before && <img src={before} alt="Original" />}</div>
      </figure>
      <figure class="ai-figure">
        <figcaption>{afterLabel}</figcaption>
        <div class={`ai-stage${checker ? ' checker' : ''}`} data-testid="ai-result">
          {after ? <img src={after} alt={afterLabel} /> : <span class="tone-muted">{children ?? 'The result appears here.'}</span>}
        </div>
      </figure>
    </div>
  );
}

/** A displayable URL for a dropped picture: the file itself for web formats, else a PNG of the decoded canvas. */
export function useOriginalUrl(image: { readonly canvas: HTMLCanvasElement; readonly type: string; readonly file: Blob } | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!image) {
      setUrl(null);
      return;
    }
    let made: string | null = null;
    let cancelled = false;
    if (['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'].includes(image.type)) {
      made = URL.createObjectURL(image.file);
      setUrl(made);
    } else {
      image.canvas.toBlob((blob) => {
        if (cancelled || !blob) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      }, 'image/png');
    }
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [image]);
  return url;
}
