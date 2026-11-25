/**
 * Code Runner: write a program, give it input, run it, read its output —
 * like an online compiler, but offline.  Python, JavaScript, TypeScript, Lua
 * and SQL run inside the app; the desktop app also runs C, C++, Java, C#,
 * Go, Rust, Kotlin, PHP, Ruby, Bash, R, Perl, Swift and Dart with the
 * compilers installed on the computer.
 */
import { StreamLanguage } from '@codemirror/language';
import { type Extension, Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LANGUAGES, type Language, type LanguageId, languageById } from '../../lib/coderun';
import { copyText, isDesktop, pickFile, saveFile } from '../../platform';
import type { NativeRun, Toolchain } from '../../platform/coderun';
import { scrollRegion } from '../../ui/a11y';
import { CodeEditor } from '../../ui/CodeEditor';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import type { Lang } from '../types';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';

type Engine = 'app' | 'desktop';

interface RunnerState {
  readonly language: LanguageId;
  readonly code: Readonly<Partial<Record<LanguageId, string>>>;
  readonly stdin: string;
  readonly args: string;
  readonly engine: Readonly<Partial<Record<LanguageId, Engine>>>;
  readonly timeout: number;
}

const firstExample = (l: Language) => l.examples[0]?.code ?? '';
const read = (v: Values | undefined): RunnerState => {
  const s = (v ?? {}) as Record<string, unknown>;
  const language = languageById(String(s.language))?.id ?? 'python';
  const code: Partial<Record<LanguageId, string>> = {};
  if (s.code && typeof s.code === 'object')
    for (const [k, x] of Object.entries(s.code as Record<string, unknown>)) if (languageById(k) && typeof x === 'string' && x.length < 1_000_000) code[k as LanguageId] = x;
  const engine: Partial<Record<LanguageId, Engine>> = {};
  if (s.engine && typeof s.engine === 'object')
    for (const [k, x] of Object.entries(s.engine as Record<string, unknown>)) if (languageById(k) && (x === 'app' || x === 'desktop')) engine[k as LanguageId] = x;
  return {
    language,
    code,
    stdin: typeof s.stdin === 'string' && s.stdin.length < 1_000_000 ? s.stdin : '',
    args: typeof s.args === 'string' && s.args.length < 2000 ? s.args : '',
    engine,
    timeout: typeof s.timeout === 'number' && [5, 10, 30, 60, 120].includes(s.timeout) ? s.timeout : 10,
  };
};
const write = (s: RunnerState): Values => ({ ...s }) as unknown as Values;

/* ------------------------------------------------------------- editors -- */

const NATIVE_LANG: Partial<Record<LanguageId, Lang>> = { python: 'python', javascript: 'javascript', typescript: 'typescript', c: 'cpp', cpp: 'cpp', sqlite: 'sql', duckdb: 'sql' };

/** Syntax colouring for the languages the editor does not carry itself. */
async function editorLanguage(id: LanguageId): Promise<Extension | null> {
  switch (id) {
    case 'java':
      return (await import('@codemirror/lang-java')).java();
    case 'go':
      return (await import('@codemirror/lang-go')).go();
    case 'rust':
      return (await import('@codemirror/lang-rust')).rust();
    case 'php':
      return (await import('@codemirror/lang-php')).php();
    case 'csharp':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/clike')).csharp);
    case 'kotlin':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/clike')).kotlin);
    case 'dart':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/clike')).dart);
    case 'ruby':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/ruby')).ruby);
    case 'bash':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/shell')).shell);
    case 'r':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/r')).r);
    case 'lua':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/lua')).lua);
    case 'perl':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/perl')).perl);
    case 'swift':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/swift')).swift);
    default:
      return null;
  }
}

/* ------------------------------------------------------------- running -- */

interface Piece {
  readonly stream: 'stdout' | 'stderr' | 'note';
  readonly text: string;
}

interface Status {
  readonly state: 'idle' | 'starting' | 'running' | 'done' | 'failed';
  readonly message: string;
  readonly exitCode?: number | null;
  readonly line?: number;
}

const OUTPUT_LIMIT = 1 << 20;

type WorkerMessage =
  | { type: 'out'; stream: 'stdout' | 'stderr'; text: string }
  | { type: 'error'; text: string; line?: number }
  | { type: 'done'; exitCode: number }
  | { type: 'ready'; version?: string }
  | { type: 'table'; columns: string[]; rows: (string | null)[][] };

/** Python stays loaded between runs (it takes a few seconds to start). */
let python: { worker: Worker; url: string; ready: Promise<string> } | null = null;

function startPython(base: string, script: string): NonNullable<typeof python> {
  const url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
  const worker = new Worker(url, { name: 'benchtop-python' });
  const ready = new Promise<string>((resolve, reject) => {
    const first = (event: MessageEvent<WorkerMessage>) => {
      if (event.data.type === 'ready') {
        worker.removeEventListener('message', first);
        resolve(event.data.version ?? '');
      } else if (event.data.type === 'error') {
        worker.removeEventListener('message', first);
        reject(new Error(event.data.text));
      }
    };
    worker.addEventListener('message', first);
    worker.addEventListener('error', (e) => reject(new Error(e.message || 'Python could not start.')), { once: true });
  });
  void base;
  python = { worker, url, ready };
  ready.catch(() => {
    stopPython();
  });
  return python;
}

function stopPython() {
  if (!python) return;
  python.worker.terminate();
  URL.revokeObjectURL(python.url);
  python = null;
}

/** The line an error points at, from a traceback or compiler message. */
function errorLine(text: string, file: string): number | undefined {
  const stem = file.replace(/\.[^.]+$/, '');
  const patterns = [new RegExp(`File "${file.replace('.', '\\.')}", line (\\d+)`, 'g'), new RegExp(`${stem}\\.\\w+:(\\d+)`, 'g'), /main\.\w+:(\d+)/g];
  for (const re of patterns) {
    const all = [...text.matchAll(re)];
    const last = re.source.startsWith('File') ? all.at(-1) : all[0];
    if (last) return Number(last[1]);
  }
  return undefined;
}

/* ---------------------------------------------------------------- tool -- */

function CodeRunner({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, read, write);
  const [output, setOutput] = useState<readonly Piece[]>([]);
  const [status, setStatus] = useState<Status>({ state: 'idle', message: '' });
  const [chains, setChains] = useState<readonly Toolchain[] | null>(null);
  const [versions, setVersions] = useState<Readonly<Record<string, string>>>({});
  const [extension, setExtension] = useState<{ id: LanguageId; ext: Extension | null } | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const runRef = useRef<() => void>(() => undefined);

  const language = languageById(state.language) ?? (LANGUAGES[0] as Language);
  const code = state.code[language.id] ?? firstExample(language);
  const chain = chains?.find((c) => c.id === language.id);
  const installed = Boolean(chain?.program) && !chain?.missingRunner;
  const engine: Engine = !language.builtIn ? 'desktop' : isDesktop && installed && state.engine[language.id] === 'desktop' ? 'desktop' : 'app';
  const canRun = engine === 'app' ? Boolean(language.builtIn) : isDesktop && installed;
  const running = status.state === 'running' || status.state === 'starting';

  const refreshChains = () =>
    attempt(async () => {
      const { toolchains } = await import('../../platform/coderun');
      setChains(await toolchains());
    });
  useEffect(() => {
    if (isDesktop) void refreshChains();
  }, []);

  useEffect(() => {
    let live = true;
    void editorLanguage(language.id).then((ext) => {
      if (live) setExtension({ id: language.id, ext });
    });
    return () => {
      live = false;
    };
  }, [language.id]);

  // The installed program's version, once per language.
  useEffect(() => {
    if (!isDesktop || !installed || versions[language.id] !== undefined) return;
    void import('../../platform/coderun').then(({ toolchainVersion }) =>
      toolchainVersion(language.id).then(
        (v) => setVersions((all) => ({ ...all, [language.id]: v })),
        () => setVersions((all) => ({ ...all, [language.id]: '' })),
      ),
    );
  }, [language.id, installed]);

  const set = <K extends keyof RunnerState>(key: K, value: RunnerState[K]) => setState((s) => ({ ...s, [key]: value }));
  const setCode = (value: string) => setState((s) => ({ ...s, code: { ...s.code, [s.language]: value } }));

  /** Runs in a worker; the promise settles when the program ends, fails or is stopped. */
  const runInApp = async (append: (p: Piece) => void): Promise<{ exitCode: number | null; line?: number; stopped?: string }> => {
    const lib = await import('../../lib/coderun');
    const base = lib.runtimeBase();
    const timeoutMs = state.timeout * 1000;
    if (language.builtIn === 'duckdb') {
      const { loadDuck } = await import('../../lib/duck');
      const duck = await loadDuck();
      const conn = await duck.db.connect();
      const statements = lib.splitSql(code);
      let exitCode = 0;
      try {
        await conn.query('BEGIN TRANSACTION');
        for (const sql of statements) {
          const table = await Promise.race([conn.query(sql), new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Stopped after ${state.timeout} s (the time limit).`)), timeoutMs))]);
          if (table.numCols > 0 && !/^\s*(create|insert|update|delete|drop|alter|set|pragma|begin|commit|rollback|copy|attach|detach|use|install|load)\b/i.test(sql)) {
            const columns = table.schema.fields.map((f) => f.name);
            const rows = table.toArray().map((row) =>
              columns.map((c) => {
                const v = (row as Record<string, unknown>)[c];
                return v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? Number(x) : x)) : String(v);
              }),
            );
            append({ stream: 'stdout', text: lib.textTable(columns, rows) });
          }
        }
        if (!statements.length) append({ stream: 'note', text: 'There is no SQL to run.\n' });
      } catch (e) {
        append({ stream: 'stderr', text: `${e instanceof Error ? e.message : String(e)}\n` });
        exitCode = 1;
      } finally {
        await conn.query('ROLLBACK').catch(() => undefined);
        await conn.close();
      }
      return { exitCode };
    }
    // Every other built-in runtime runs in a worker.
    let worker: Worker;
    let url = '';
    let persistent = false;
    if (language.builtIn === 'python') {
      if (!python) {
        setStatus({ state: 'starting', message: 'Starting Python (the first run loads it)…' });
        startPython(base, lib.pythonWorker(base));
      }
      const p = python as NonNullable<typeof python>;
      const version = await p.ready;
      setStatus({ state: 'running', message: `Running with Python ${version}…` });
      worker = p.worker;
      persistent = true;
    } else {
      let script: string;
      if (language.builtIn === 'javascript' || language.builtIn === 'typescript') {
        const source = language.builtIn === 'typescript' ? await lib.stripTypes(code) : code;
        script = lib.jsWorker(source, state.stdin, state.args.split(/\s+/).filter(Boolean)).script;
      } else if (language.builtIn === 'lua') script = lib.luaWorker(base, code, state.stdin);
      else script = lib.sqliteWorker(base, code);
      url = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
      worker = new Worker(url, { name: `benchtop-${language.id}` });
    }
    return new Promise((resolve) => {
      let size = 0;
      let line: number | undefined;
      let errors = '';
      const finish = (result: { exitCode: number | null; line?: number; stopped?: string }, kill: boolean) => {
        clearTimeout(timer);
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        if (kill) {
          if (persistent) stopPython();
          else worker.terminate();
        } else if (!persistent) worker.terminate();
        if (url) URL.revokeObjectURL(url);
        stopRef.current = null;
        resolve(result);
      };
      const timer = setTimeout(
        () => finish({ exitCode: null, stopped: `Stopped after ${state.timeout} s (the time limit).${persistent ? ' Python will restart on the next run.' : ''}` }, true),
        timeoutMs,
      );
      stopRef.current = () => finish({ exitCode: null, stopped: 'Stopped.' }, true);
      const onMessage = (event: MessageEvent<WorkerMessage>) => {
        const m = event.data;
        if (m.type === 'out' || m.type === 'table') {
          const text = m.type === 'table' ? lib.textTable(m.columns, m.rows) : m.text;
          size += text.length;
          if (size > OUTPUT_LIMIT) {
            finish({ exitCode: null, stopped: 'The output passed 1 MB, so the program was stopped.' }, true);
            return;
          }
          if (m.type === 'out' && m.stream === 'stderr' && errors.length < 100_000) errors += text;
          append({ stream: m.type === 'table' ? 'stdout' : m.stream, text });
        } else if (m.type === 'error') {
          if (m.line) line = m.line;
          append({ stream: 'stderr', text: `${m.text}\n` });
        } else if (m.type === 'done') {
          // A traceback names the line: the last frame in the program's own file.
          if (!line && m.exitCode !== 0 && errors) line = errorLine(errors, language.file);
          finish({ exitCode: m.exitCode, ...(line ? { line } : {}) }, false);
        }
      };
      const onError = (event: ErrorEvent) => {
        event.preventDefault();
        // A syntax error stops the script before it starts: its line is in the event.
        const offset = language.builtIn === 'javascript' || language.builtIn === 'typescript' ? lib.jsWorker('', '').offset : 0;
        const at = event.lineno && offset ? Math.max(1, event.lineno - offset) : undefined;
        append({ stream: 'stderr', text: `${event.message || 'The program could not start.'}${at ? ` (line ${at})` : ''}\n` });
        finish({ exitCode: 1, ...(at ? { line: at } : {}) }, true);
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      if (persistent) worker.postMessage({ type: 'run', code, stdin: state.stdin, args: state.args.split(/\s+/).filter(Boolean) });
    });
  };

  const runNativeCode = async (append: (p: Piece) => void): Promise<{ exitCode: number | null; line?: number; stopped?: string }> => {
    const { runNative } = await import('../../platform/coderun');
    setStatus({ state: 'running', message: `Running with ${chain?.program ?? language.name}…` });
    const r: NativeRun = await runNative(language.id, code, state.stdin, state.args.split(/\s+/).filter(Boolean), state.timeout * 1000);
    if (r.compileOutput.trim()) append({ stream: r.compiled ? 'note' : 'stderr', text: r.compileOutput.endsWith('\n') ? r.compileOutput : `${r.compileOutput}\n` });
    if (!r.compiled)
      return {
        exitCode: r.exitCode ?? 1,
        ...(errorLine(r.compileOutput, language.file) ? { line: errorLine(r.compileOutput, language.file) } : {}),
        stopped: `Did not compile${r.compileMs ? ` (${r.compileMs} ms)` : ''}.`,
      };
    if (r.stdout) append({ stream: 'stdout', text: r.stdout });
    if (r.stderr) append({ stream: 'stderr', text: r.stderr });
    const line = r.exitCode !== 0 ? errorLine(r.stderr, language.file) : undefined;
    const timing = `${r.compileMs ? `compiled in ${r.compileMs} ms, ` : ''}ran in ${r.runMs} ms`;
    if (r.timedOut) return { exitCode: null, stopped: `Stopped after ${state.timeout} s (the time limit); ${timing}.` };
    if (r.truncated) return { exitCode: r.exitCode, stopped: `The output was cut off at 1 MB; ${timing}.` };
    return { exitCode: r.exitCode, ...(line ? { line } : {}), stopped: timing };
  };

  const run = async () => {
    if (running || !canRun) return;
    setOutput([]);
    const pieces: Piece[] = [];
    let pending = false;
    const flush = () => {
      pending = false;
      setOutput([...pieces]);
    };
    const append = (p: Piece) => {
      const last = pieces.at(-1);
      if (last && last.stream === p.stream) pieces[pieces.length - 1] = { stream: p.stream, text: last.text + p.text };
      else pieces.push(p);
      if (!pending) {
        pending = true;
        requestAnimationFrame(flush);
      }
    };
    const started = performance.now();
    setStatus({ state: 'running', message: 'Running…' });
    try {
      const r = engine === 'desktop' ? await runNativeCode(append) : await runInApp(append);
      flush();
      const ms = Math.round(performance.now() - started);
      const ended = r.exitCode === null ? (r.stopped ?? 'Stopped.') : `Exited with code ${r.exitCode}${engine === 'desktop' && r.stopped ? `; ${r.stopped}` : ` after ${ms} ms`}.`;
      setStatus({
        state: r.exitCode === 0 ? 'done' : 'failed',
        message: r.exitCode !== null && engine === 'desktop' && /compile/.test(r.stopped ?? '') ? (r.stopped as string) : ended,
        exitCode: r.exitCode,
        ...(r.line ? { line: r.line } : {}),
      });
    } catch (e) {
      flush();
      setStatus({ state: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  };
  runRef.current = () => void run();

  // Ahead of the editor's own Mod-Enter (a blank line below).
  const runKeys = useMemo(
    () =>
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              runRef.current();
              return true;
            },
          },
        ]),
      ),
    [],
  );
  const extensions = useMemo(() => (extension?.id === language.id && extension.ext ? [runKeys, extension.ext] : [runKeys]), [extension, language.id, runKeys]);

  const open = () =>
    attempt(async () => {
      const file = await pickFile(LANGUAGES.map((l) => `.${l.file.split('.').pop()}`).join(','));
      if (!file) return;
      if (file.size > 2_000_000) throw new Error('That file is too large to edit here.');
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const match = LANGUAGES.find((l) => l.file.split('.').pop()?.toLowerCase() === ext && (l.id !== 'duckdb' || state.language === 'duckdb')) ?? language;
      const text = await file.text();
      setState((s) => ({ ...s, language: match.id, code: { ...s.code, [match.id]: text } }));
    });
  const save = () =>
    attempt(async () => {
      const outcome = await saveFile(language.file, code.endsWith('\n') ? code : `${code}\n`, 'text/plain');
      if (outcome.saved) notify(`Saved to ${outcome.location}`);
    });
  const builtIns = LANGUAGES.filter((l) => l.builtIn);
  const installedOnly = LANGUAGES.filter((l) => !l.builtIn);
  const os = /Mac/.test(navigator.userAgent) ? 'mac' : /Win/.test(navigator.userAgent) ? 'windows' : 'linux';
  const hint = language.install?.[os];
  const outputText = output.map((p) => p.text).join('');

  return (
    <section class="tool cr-tool" data-testid="tool" data-state={running ? 'running' : status.state}>
      <div class="button-row cr-bar">
        <label class="cr-field">
          <span class="control-label">Language</span>
          <select class="select" value={language.id} onChange={(e) => set('language', e.currentTarget.value as LanguageId)} data-testid="cr-language">
            <optgroup label="Runs in the app">
              {builtIns.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </optgroup>
            <optgroup label={isDesktop ? 'With a compiler on this computer' : 'Needs the desktop app'}>
              {installedOnly.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {isDesktop && chains && !chains.find((c) => c.id === l.id)?.program ? ' (not installed)' : ''}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        {language.builtIn && language.desktop && isDesktop && (
          <Segmented
            label="Run with"
            value={engine}
            onChange={(v) => setState((s) => ({ ...s, engine: { ...s.engine, [language.id]: v } }))}
            choices={[
              { value: 'app', label: 'Built in' },
              { value: 'desktop', label: installed ? `Installed${versions[language.id] ? ` (${versions[language.id]?.slice(0, 28)})` : ''}` : 'Installed (not found)' },
            ]}
          />
        )}
        <button type="button" class="button button-primary" onClick={() => void run()} disabled={!canRun || running} data-testid="cr-run" title="Run (Ctrl+Enter)">
          <Icon name="play" /> Run
        </button>
        <button type="button" class="button" onClick={() => stopRef.current?.()} disabled={!running || engine === 'desktop'} data-testid="cr-stop">
          <Icon name="close" /> Stop
        </button>
        <label class="cr-field">
          <span class="control-label">Time limit</span>
          <select class="select select-small" value={String(state.timeout)} onChange={(e) => set('timeout', Number(e.currentTarget.value))} data-testid="cr-timeout">
            {[5, 10, 30, 60, 120].map((s) => (
              <option key={s} value={s}>
                {s} s
              </option>
            ))}
          </select>
        </label>
        <label class="cr-field">
          <span class="control-label">Examples</span>
          <select
            class="select select-small"
            value=""
            data-testid="cr-example"
            onChange={(e) => {
              const example = language.examples[Number(e.currentTarget.value)];
              if (example) setState((s) => ({ ...s, code: { ...s.code, [language.id]: example.code }, stdin: example.stdin ?? '' }));
              e.currentTarget.value = '';
            }}
          >
            <option value="">Choose…</option>
            {language.examples.map((x, i) => (
              <option key={x.name} value={i}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" class="button" onClick={open} data-testid="cr-open">
          <Icon name="open" /> Open
        </button>
        <button type="button" class="button" onClick={save} data-testid="cr-save">
          <Icon name="save" /> Save
        </button>
      </div>

      {!canRun && (
        <p class="cr-hint" data-testid="cr-hint">
          <Icon name="info" />{' '}
          {isDesktop
            ? chain?.missingRunner
              ? `${language.name} also needs ${chain.missingRunner}, which was not found. ${hint ?? ''}`
              : `No ${language.name} toolchain was found on this computer. ${hint ? `To install it: ${hint}` : ''}`
            : `${language.name} runs with a compiler installed on your computer, so it needs the Benchtop desktop app. Python, JavaScript, TypeScript, Lua and SQL run right here.`}
          {isDesktop && (
            <button type="button" class="button button-small cr-recheck" onClick={() => void refreshChains()}>
              <Icon name="refresh" /> Check again
            </button>
          )}
        </p>
      )}

      <div class="cr-main">
        <div class="pane cr-editor">
          <div class="pane-header">
            <span class="pane-title">{language.file}</span>
            <span class="tone-muted cr-engine-note">{engine === 'desktop' ? (chain?.program ?? '') : (language.builtInName ?? '')}</span>
          </div>
          <div class="pane-body">
            <CodeEditor
              key={`${language.id}-${extension?.id === language.id ? 'ready' : 'plain'}`}
              value={code}
              onChange={setCode}
              label={`${language.name} code`}
              language={NATIVE_LANG[language.id] ?? 'text'}
              extensions={extensions}
              errorLine={status.state === 'failed' ? status.line : undefined}
              testId="cr-editor"
            />
          </div>
        </div>
        <div class={`cr-side${engine === 'desktop' || language.builtIn === 'javascript' || language.builtIn === 'typescript' || language.builtIn === 'python' ? '' : ' cr-no-args'}`}>
          <div class="pane cr-stdin">
            <div class="pane-header">
              <span class="pane-title">Input (stdin)</span>
            </div>
            <textarea
              class="cr-textarea"
              value={state.stdin}
              onInput={(e) => set('stdin', e.currentTarget.value)}
              spellcheck={false}
              aria-label="Standard input"
              data-testid="cr-stdin"
              placeholder="What the program reads, one line per input"
            />
          </div>
          {(engine === 'desktop' || language.builtIn === 'javascript' || language.builtIn === 'typescript' || language.builtIn === 'python') && (
            <label class="cr-field cr-args">
              <span class="control-label">Arguments</span>
              <input class="input cr-mono" value={state.args} onInput={(e) => set('args', e.currentTarget.value)} spellcheck={false} data-testid="cr-args" placeholder="Separated by spaces" />
            </label>
          )}
          <div class="pane cr-output">
            <div class="pane-header">
              <span class="pane-title">Output</span>
              <div class="pane-actions">
                <button type="button" class="button button-small" onClick={() => attempt(async () => copyText(outputText).then(() => notify('Output copied')))} disabled={!outputText}>
                  <Icon name="copy" /> Copy
                </button>
                <button type="button" class="button button-small" onClick={() => setOutput([])} disabled={!outputText}>
                  <Icon name="clear" /> Clear
                </button>
              </div>
            </div>
            <pre class="cr-pre" data-testid="cr-output" aria-live="polite" {...scrollRegion('Output')}>
              {output.map((p, i) => (
                <span key={i} class={`cr-${p.stream}`}>
                  {p.text}
                </span>
              ))}
            </pre>
            <div class={`cr-status cr-status-${status.state}`} data-testid="cr-status" role="status">
              {status.message || (canRun ? 'Press Run, or Ctrl+Enter in the editor.' : '')}
            </div>
          </div>
        </div>
      </div>

      <details class="cr-details" data-testid="cr-toolchains">
        <summary>{isDesktop ? 'Compilers and interpreters on this computer' : 'What runs where'}</summary>
        <table class="data-table cr-table">
          <thead>
            <tr>
              <th scope="col">Language</th>
              <th scope="col">In the app</th>
              <th scope="col">{isDesktop ? 'On this computer' : 'Desktop app'}</th>
            </tr>
          </thead>
          <tbody>
            {LANGUAGES.map((l) => {
              const c = chains?.find((x) => x.id === l.id);
              return (
                <tr key={l.id}>
                  <th scope="row">{l.name}</th>
                  <td>{l.builtIn ? (l.builtInName ?? 'Yes') : '—'}</td>
                  <td>
                    {!l.desktop ? (
                      '—'
                    ) : !isDesktop ? (
                      'With an installed toolchain'
                    ) : c?.program ? (
                      c.missingRunner ? (
                        `Needs ${c.missingRunner}`
                      ) : (
                        c.program
                      )
                    ) : (
                      <span class="tone-muted">Not found. {l.install?.[os]}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p class="tone-muted">
          Programs run on this computer. Built-in runs have no network or file access and stop at the time limit; programs run with an installed toolchain have your account’s permissions, like any
          program you start, in a fresh temporary folder that is removed afterwards.
        </p>
      </details>
    </section>
  );
}

export default defineCustomTool(CodeRunner);
