/**
 * A code editor beside a sealed frame that runs the code with a drawing
 * library (D3.js, anime.js): examples, data files, a console, and saving the
 * result as SVG, PNG or a web page that runs on its own.  The frame holds the
 * library and nothing else, so the code cannot reach the app, its storage or
 * the network.
 */
import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { checkDataFile, DATA_LIMIT, type DataFile, type Example, type FrameKind, standaloneCodePage } from '../../lib/code-frames';
import { readFrameMessage, svgSize, tidySvg } from '../../lib/svgjs';
import { copyText, pickFiles, saveFile } from '../../platform';
import { scrollRegion } from '../../ui/a11y';
import { CodeEditor } from '../../ui/CodeEditor';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import type { Values } from '../types';
import { clamp, usePersistentState } from './_shared';

export interface CodeFrameConfig {
  readonly kind: FrameKind;
  readonly frameSrc: string;
  readonly codeLabel: string;
  readonly examples: readonly Example[];
  /** Data files the editor starts with; leave out for libraries that take none. */
  readonly files?: readonly DataFile[];
  /** The library and its licence, for the page that runs on its own. */
  readonly library: () => Promise<{ code: string; licence: string }>;
  readonly fileBase: string;
  readonly width: number;
  readonly height: number;
  readonly help: ComponentChildren;
  /** Said when there is no SVG to save (an animation of HTML elements, say). */
  readonly noSvg: string;
}

interface EditorState {
  readonly code: string;
  readonly width: number;
  readonly height: number;
  readonly auto: boolean;
  readonly backdrop: 'checks' | 'light' | 'dark';
  readonly files: readonly DataFile[];
}

interface Line {
  readonly level: 'log' | 'info' | 'warn' | 'error';
  readonly text: string;
}

type Status = 'idle' | 'running' | 'done' | 'error';

const side = (value: unknown, fallback: number) => (typeof value === 'number' && value >= 16 && value <= 4096 ? Math.round(value) : fallback);

export function CodeFrameEditor({ toolId, config }: { toolId: string; config: CodeFrameConfig }) {
  const first = config.examples[0]?.code ?? '';
  const read = (v: Values | undefined): EditorState => {
    const files = Array.isArray(v?.files)
      ? (v.files as unknown[]).filter((f): f is DataFile => typeof f === 'object' && f !== null && typeof (f as DataFile).name === 'string' && typeof (f as DataFile).text === 'string').slice(0, 20)
      : (config.files ?? []);
    return {
      code: typeof v?.code === 'string' && v.code.trim() ? v.code : first,
      width: side(v?.width, config.width),
      height: side(v?.height, config.height),
      auto: v?.auto === true,
      backdrop: v?.backdrop === 'checks' || v?.backdrop === 'dark' ? v.backdrop : 'light',
      files,
    };
  };
  const write = (s: EditorState): Values => ({
    code: s.code.length > 200_000 ? '' : s.code,
    width: s.width,
    height: s.height,
    auto: s.auto,
    backdrop: s.backdrop,
    files: s.files.reduce((sum, f) => sum + f.text.length, 0) > DATA_LIMIT * 2 ? [] : s.files.map((f) => ({ ...f })),
  });
  const [state, setState] = usePersistentState(toolId, read, write);
  const [run, setRun] = useState(0);
  const [status, setStatus] = useState<Status>('idle');
  const [lines, setLines] = useState<Line[]>([]);
  const [errorLine, setErrorLine] = useState<number | undefined>(undefined);
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef(state);
  latest.current = state;
  const waiting = useRef(new Map<number, (svg: string) => void>());
  const asked = useRef(0);
  const prefix = config.kind;

  const start = useCallback(() => {
    setLines([]);
    setErrorLine(undefined);
    setStatus('running');
    setRun((n) => n + 1);
  }, []);

  useEffect(() => {
    const hear = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const message = readFrameMessage(event.data);
      if (!message) return;
      if (message.type === 'ready') {
        const now = latest.current;
        frame.current.contentWindow?.postMessage({ type: 'run', code: now.code, width: now.width, height: now.height, files: now.files }, '*');
      } else if (message.type === 'done') setStatus((s) => (s === 'error' ? s : 'done'));
      else if (message.type === 'log') setLines((all) => [...all.slice(-199), { level: message.level, text: message.text }]);
      else if (message.type === 'error') {
        setStatus('error');
        setErrorLine((line) => line ?? (message.line > 0 ? message.line : undefined));
        setLines((all) => [...all.slice(-199), { level: 'error', text: message.line > 0 ? `${message.text} (line ${message.line})` : message.text }]);
      } else {
        waiting.current.get(message.id)?.(message.svg);
        waiting.current.delete(message.id);
      }
    };
    addEventListener('message', hear);
    return () => removeEventListener('message', hear);
  }, []);

  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      start();
      return;
    }
    if (!state.auto) return;
    const timer = setTimeout(start, 700);
    return () => clearTimeout(timer);
  }, [state.code, state.width, state.height, state.auto, state.files, start]);

  const snapshot = () =>
    new Promise<string>((resolve, reject) => {
      const target = frame.current?.contentWindow;
      if (!target || status === 'idle') {
        reject(new Error('Run the code first.'));
        return;
      }
      asked.current += 1;
      const id = asked.current;
      const timer = setTimeout(() => {
        waiting.current.delete(id);
        reject(new Error('The drawing did not answer; run the code again.'));
      }, 4000);
      waiting.current.set(id, (svg) => {
        clearTimeout(timer);
        if (!svg.trim()) {
          reject(new Error(config.noSvg));
          return;
        }
        try {
          resolve(tidySvg(svg));
        } catch (error) {
          reject(error);
        }
      });
      target.postMessage({ type: 'snapshot', id }, '*');
    });

  const save = (format: 'svg' | 'png' | 'html' | 'copy') =>
    attempt(async () => {
      if (format === 'html') {
        const { code: library, licence } = await config.library();
        const page = standaloneCodePage(config.kind, state.code, library, {
          title: config.fileBase,
          width: state.width,
          height: state.height,
          background: state.backdrop === 'dark' ? '#0d1117' : '#ffffff',
          files: state.files,
          licence,
        });
        const outcome = await saveFile(`${config.fileBase}.html`, page, 'text/html');
        if (outcome.saved) notify(`Saved to ${outcome.location}`);
        return;
      }
      const svg = await snapshot();
      if (format === 'copy') {
        await copyText(svg);
        notify('SVG copied');
      } else if (format === 'svg') {
        const outcome = await saveFile(`${config.fileBase}.svg`, svg, 'image/svg+xml');
        if (outcome.saved) notify(`Saved to ${outcome.location}`);
      } else {
        const size = svgSize(svg) ?? { width: state.width, height: state.height };
        const image = new Image();
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('The drawing could not be made into a picture.'));
          image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        });
        const scale = Math.min(2, 8192 / Math.max(size.width, size.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(size.width * scale));
        canvas.height = Math.max(1, Math.round(size.height * scale));
        const ctx = canvas.getContext('2d');
        if (ctx && state.backdrop !== 'checks') {
          ctx.fillStyle = state.backdrop === 'dark' ? '#0d1117' : '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx?.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('The drawing could not be made into a picture.');
        const outcome = await saveFile(`${config.fileBase}.png`, blob, 'image/png');
        if (outcome.saved) notify(`Saved to ${outcome.location}`);
      }
    });

  const addFiles = () =>
    attempt(async () => {
      const picked = await pickFiles('.csv,.tsv,.json,.geojson,.topojson,.txt,text/csv,application/json,text/plain');
      const added: DataFile[] = [];
      for (const file of picked) {
        const text = await file.text();
        const problem = checkDataFile(file.name, text);
        if (problem) throw new Error(problem);
        added.push({ name: file.name, text });
      }
      if (added.length) {
        setState((s) => ({ ...s, files: [...s.files.filter((f) => !added.some((a) => a.name === f.name)), ...added] }));
        notify(`Added ${added.map((f) => f.name).join(', ')}`);
      }
    });

  const setSide = (key: 'width' | 'height', value: string) => {
    const n = Math.round(Number(value));
    if (Number.isFinite(n) && n >= 16) setState((s) => ({ ...s, [key]: clamp(n, 16, 4096) }));
  };

  return (
    <section
      class="tool sj-tool"
      data-testid="tool"
      data-state={status === 'done' ? 'done' : 'idle'}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          start();
        }
      }}
    >
      <div class="button-row sj-bar">
        <button type="button" class="button button-small button-primary" onClick={start} title="Run (Ctrl+Enter)" data-testid={`${prefix}-run`}>
          <Icon name="play" size={14} /> Run
        </button>
        <label class="check">
          <input type="checkbox" checked={state.auto} onChange={(e) => setState((s) => ({ ...s, auto: e.currentTarget.checked }))} /> Run as I type
        </label>
        <label class="sj-field">
          <span class="control-label">Example</span>
          <select
            class="select select-small"
            value=""
            data-testid={`${prefix}-example`}
            onChange={(e) => {
              const example = config.examples.find((x) => x.name === e.currentTarget.value);
              e.currentTarget.value = '';
              if (!example) return;
              setState((s) => ({ ...s, code: example.code }));
              latest.current = { ...latest.current, code: example.code };
              start();
            }}
          >
            <option value="">Load an example…</option>
            {config.examples.map((example) => (
              <option key={example.name} value={example.name}>
                {example.name}
              </option>
            ))}
          </select>
        </label>
        <label class="sj-field">
          <span class="control-label">Width</span>
          <input type="number" class="input input-number" min={16} max={4096} value={state.width} onChange={(e) => setSide('width', e.currentTarget.value)} />
        </label>
        <label class="sj-field">
          <span class="control-label">Height</span>
          <input type="number" class="input input-number" min={16} max={4096} value={state.height} onChange={(e) => setSide('height', e.currentTarget.value)} />
        </label>
        <label class="sj-field">
          <span class="control-label">Behind the drawing</span>
          <select class="select select-small" value={state.backdrop} onChange={(e) => setState((s) => ({ ...s, backdrop: e.currentTarget.value as EditorState['backdrop'] }))}>
            <option value="light">White</option>
            <option value="dark">Dark</option>
            <option value="checks">Checks (see-through)</option>
          </select>
        </label>
        <span class="sj-save" role="group" aria-label="Save">
          <span class="control-label">Save as</span>
          <button type="button" class="button button-small" onClick={() => save('svg')} data-testid={`${prefix}-save-svg`}>
            SVG
          </button>
          <button type="button" class="button button-small" onClick={() => save('png')} data-testid={`${prefix}-save-png`}>
            PNG
          </button>
          <button
            type="button"
            class="button button-small"
            onClick={() => save('html')}
            title="A page with the library and your code inside it: it keeps moving and answering clicks"
            data-testid={`${prefix}-save-html`}
          >
            Web page
          </button>
          <button type="button" class="button button-small button-quiet" onClick={() => save('copy')}>
            <Icon name="copy" size={13} /> Copy SVG
          </button>
        </span>
      </div>

      <div class="sj-main">
        <div class="sj-code">
          <CodeEditor
            value={state.code}
            onChange={(code) => {
              setState((s) => ({ ...s, code }));
              setErrorLine(undefined);
            }}
            language="javascript"
            label={config.codeLabel}
            errorLine={errorLine}
            testId={`${prefix}-editor`}
          />
        </div>
        <div class="sj-side">
          <div class={`sj-stage sj-${state.backdrop === 'light' ? 'light' : state.backdrop}`}>
            <iframe
              key={run}
              ref={frame}
              class="sj-frame"
              src={config.frameSrc}
              sandbox="allow-scripts"
              referrerpolicy="no-referrer"
              title="Drawing"
              style={{ aspectRatio: `${state.width} / ${state.height}` }}
              data-testid={`${prefix}-frame`}
            />
          </div>
          <p class={`sj-status${status === 'error' ? ' tone-error' : ' tone-muted'}`} role="status" data-testid={`${prefix}-status`}>
            {status === 'running' ? 'Running…' : status === 'done' ? `Drawn at ${state.width} × ${state.height}.` : status === 'error' ? 'The code stopped with an error.' : 'Not run yet.'}
          </p>
          <div class="sj-console" {...scrollRegion('Console')} data-testid={`${prefix}-console`}>
            {lines.length === 0 ? (
              <p class="tone-muted">What the code writes with console.log appears here.</p>
            ) : (
              <ol>
                {lines.map((line, index) => (
                  <li key={`${index}:${line.text}`} class={`sj-line sj-${line.level}`}>
                    {line.text}
                  </li>
                ))}
              </ol>
            )}
          </div>
          {config.files && (
            <div class="cf-files" data-testid={`${prefix}-files`}>
              <div class="cf-files-head">
                <span class="control-label">Data files</span>
                <button type="button" class="button button-small" onClick={addFiles} data-testid={`${prefix}-add-file`}>
                  Add files…
                </button>
                <button type="button" class="button button-small button-quiet" onClick={() => setState((s) => ({ ...s, files: config.files ?? [] }))}>
                  Samples
                </button>
              </div>
              {state.files.length === 0 ? (
                <p class="tone-muted">No data files. Add CSV, TSV or JSON files to read them with data, files[name] or d3.csv(name).</p>
              ) : (
                <ul>
                  {state.files.map((f, i) => (
                    <li key={f.name}>
                      <code>{f.name}</code>
                      <span class="tone-muted">
                        {i === 0 ? 'read as data, ' : ''}
                        {f.text.length < 1024 ? `${f.text.length} B` : `${(f.text.length / 1024).toFixed(1)} KB`}
                      </span>
                      <button
                        type="button"
                        class="button button-small button-quiet"
                        aria-label={`Remove ${f.name}`}
                        onClick={() => setState((s) => ({ ...s, files: s.files.filter((x) => x.name !== f.name) }))}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
      <p class="control-help">{config.help}</p>
    </section>
  );
}
