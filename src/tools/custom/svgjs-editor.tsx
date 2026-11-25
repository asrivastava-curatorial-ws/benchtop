/**
 * SVG.js Editor: write SVG.js code and see the drawing beside it.  The code
 * runs in a sandboxed frame that holds the library and nothing else: it can
 * draw, animate and answer clicks, but cannot reach the app, its storage or
 * the network.  Save the result as SVG, PNG or a page that runs on its own.
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { EXAMPLES, readFrameMessage, standalonePage, svgSize, tidySvg } from '../../lib/svgjs';
import { copyText, saveFile } from '../../platform';
import { scrollRegion } from '../../ui/a11y';
import { CodeEditor } from '../../ui/CodeEditor';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { clamp, usePersistentState } from './_shared';

interface EditorState {
  readonly code: string;
  readonly width: number;
  readonly height: number;
  readonly auto: boolean;
  readonly backdrop: 'checks' | 'light' | 'dark';
}

const FIRST = EXAMPLES[0]?.code ?? '';
const side = (value: unknown, fallback: number) => (typeof value === 'number' && value >= 16 && value <= 4096 ? Math.round(value) : fallback);
const read = (v: Values | undefined): EditorState => ({
  code: typeof v?.code === 'string' && v.code.trim() ? v.code : FIRST,
  width: side(v?.width, 800),
  height: side(v?.height, 500),
  auto: v?.auto === true,
  backdrop: v?.backdrop === 'light' || v?.backdrop === 'dark' ? v.backdrop : 'checks',
});
const write = (s: EditorState): Values => ({ code: s.code.length > 200_000 ? '' : s.code, width: s.width, height: s.height, auto: s.auto, backdrop: s.backdrop });

interface Line {
  readonly level: 'log' | 'info' | 'warn' | 'error';
  readonly text: string;
}

type Status = 'idle' | 'running' | 'done' | 'error';

function SvgjsEditor({ toolId }: { toolId: string }) {
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

  /** Starts the drawing afresh: a new frame, so nothing is left of the last run. */
  const start = useCallback(() => {
    setLines([]);
    setErrorLine(undefined);
    setStatus('running');
    setRun((n) => n + 1);
  }, []);

  // The frame says when it is ready, what the code logs, and how the run ended.
  useEffect(() => {
    const hear = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const message = readFrameMessage(event.data);
      if (!message) return;
      if (message.type === 'ready') {
        const now = latest.current;
        frame.current.contentWindow?.postMessage({ type: 'run', code: now.code, width: now.width, height: now.height }, '*');
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

  // The first drawing, and every later one when "Run as I type" is on.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      start();
      return;
    }
    if (!state.auto) return;
    const timer = setTimeout(start, 700);
    return () => clearTimeout(timer);
  }, [state.code, state.width, state.height, state.auto, start]);

  /** The drawing as it stands in the frame (part-way through an animation, if one is running). */
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
        const [library, licence] = await Promise.all([
          import('../../../node_modules/@svgdotjs/svg.js/dist/svg.min.js?raw').then((m) => m.default.replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n')),
          import('../../../node_modules/@svgdotjs/svg.js/LICENSE.txt?raw').then((m) => m.default),
        ]);
        const page = standalonePage(state.code, library, { title: 'SVG.js drawing', width: state.width, height: state.height, background: state.backdrop === 'dark' ? '#0d1117' : '#ffffff', licence });
        const outcome = await saveFile('drawing.html', page, 'text/html');
        if (outcome.saved) notify(`Saved to ${outcome.location}`);
        return;
      }
      const svg = await snapshot();
      if (format === 'copy') {
        await copyText(svg);
        notify('SVG copied');
      } else if (format === 'svg') {
        const outcome = await saveFile('drawing.svg', svg, 'image/svg+xml');
        if (outcome.saved) notify(`Saved to ${outcome.location}`);
      } else {
        const size = svgSize(svg) ?? { width: state.width, height: state.height };
        const image = new Image();
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('The drawing could not be made into a picture.'));
          image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        });
        // Twice the size, for sharp pictures on dense screens, within what a canvas holds.
        const scale = Math.min(2, 8192 / Math.max(size.width, size.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(size.width * scale));
        canvas.height = Math.max(1, Math.round(size.height * scale));
        canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('The drawing could not be made into a picture.');
        const outcome = await saveFile('drawing.png', blob, 'image/png');
        if (outcome.saved) notify(`Saved to ${outcome.location}`);
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
        <button type="button" class="button button-small button-primary" onClick={start} title="Run (Ctrl+Enter)" data-testid="sj-run">
          <Icon name="play" size={14} /> Run
        </button>
        <label class="check">
          <input type="checkbox" checked={state.auto} onChange={(e) => setState((s) => ({ ...s, auto: e.currentTarget.checked }))} data-testid="sj-auto" /> Run as I type
        </label>
        <label class="sj-field">
          <span class="control-label">Example</span>
          <select
            class="select select-small"
            value=""
            data-testid="sj-example"
            onChange={(e) => {
              const example = EXAMPLES.find((x) => x.name === e.currentTarget.value);
              e.currentTarget.value = '';
              if (!example) return;
              setState((s) => ({ ...s, code: example.code }));
              latest.current = { ...latest.current, code: example.code };
              start();
            }}
          >
            <option value="">Load an example…</option>
            {EXAMPLES.map((example) => (
              <option key={example.name} value={example.name}>
                {example.name}
              </option>
            ))}
          </select>
        </label>
        <label class="sj-field">
          <span class="control-label">Width</span>
          <input type="number" class="input input-number" min={16} max={4096} value={state.width} onChange={(e) => setSide('width', e.currentTarget.value)} data-testid="sj-width" />
        </label>
        <label class="sj-field">
          <span class="control-label">Height</span>
          <input type="number" class="input input-number" min={16} max={4096} value={state.height} onChange={(e) => setSide('height', e.currentTarget.value)} data-testid="sj-height" />
        </label>
        <label class="sj-field">
          <span class="control-label">Behind the drawing</span>
          <select class="select select-small" value={state.backdrop} onChange={(e) => setState((s) => ({ ...s, backdrop: e.currentTarget.value as EditorState['backdrop'] }))}>
            <option value="checks">Checks (see-through)</option>
            <option value="light">White</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <span class="sj-save" role="group" aria-label="Save">
          <span class="control-label">Save as</span>
          <button type="button" class="button button-small" onClick={() => save('svg')} data-testid="sj-save-svg">
            SVG
          </button>
          <button type="button" class="button button-small" onClick={() => save('png')} data-testid="sj-save-png">
            PNG
          </button>
          <button
            type="button"
            class="button button-small"
            onClick={() => save('html')}
            title="A page with SVG.js and your code inside it: animation and clicks keep working"
            data-testid="sj-save-html"
          >
            Web page
          </button>
          <button type="button" class="button button-small button-quiet" onClick={() => save('copy')} data-testid="sj-copy">
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
            label="SVG.js code"
            errorLine={errorLine}
            testId="sj-editor"
          />
        </div>
        <div class="sj-side">
          <div class={`sj-stage sj-${state.backdrop}`}>
            <iframe
              key={run}
              ref={frame}
              class="sj-frame"
              src="./svgjs/frame.html"
              sandbox="allow-scripts"
              referrerpolicy="no-referrer"
              title="Drawing"
              style={{ aspectRatio: `${state.width} / ${state.height}` }}
              data-testid="sj-frame"
            />
          </div>
          <p class={`sj-status${status === 'error' ? ' tone-error' : ' tone-muted'}`} role="status" data-testid="sj-status">
            {status === 'running' ? 'Running…' : status === 'done' ? `Drawn at ${state.width} × ${state.height}.` : status === 'error' ? 'The code stopped with an error.' : 'Not run yet.'}
          </p>
          <div class="sj-console" {...scrollRegion('Console')} data-testid="sj-console">
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
        </div>
      </div>
      <p class="control-help">
        “draw” is an SVG.js drawing of the size above, and “width” and “height” are its size; “SVG” is the library itself. The code runs in a frame of its own that cannot reach your files, the app or
        the network, so pictures must be given as data URLs. An endless loop freezes the page, as in any browser: leave “Run as I type” off while writing loops.
      </p>
    </section>
  );
}

export default defineCustomTool(SvgjsEditor);
