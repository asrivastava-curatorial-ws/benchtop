/**
 * Log Viewer (large files, filters and levels, without loading the whole file)
 * and Patch Viewer (git diff and format-patch files, file by file).
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { formatBytes } from '../../lib/bytes';
import { errorMessage } from '../../lib/errors';
import { filterLines, filterProblem, indexLog, LEVELS, type Level, type LogIndex, levelAt, matcher, readLines } from '../../lib/log-index';
import { type Commit, fileRows, type PatchFile, parsePatch, patchStats } from '../../lib/patch';
import { copyText } from '../../platform';
import { scrollRegion } from '../../ui/a11y';
import { CodeEditor } from '../../ui/CodeEditor';
import { Icon } from '../../ui/icons';
import { PreviewView } from '../../ui/Preview';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { MultiDrop } from './_files';
import { Segmented, usePersistentState } from './_shared';

/* ------------------------------------------------------------ Log Viewer -- */

const SAMPLE_LOG = `2026-11-22 09:30:01.112 INFO  [main] Ticketing service starting on port 8080
2026-11-22 09:30:01.540 INFO  [main] Connected to database tickets@db:5432
2026-11-22 09:30:02.003 DEBUG [pool-1] Warm-up query took 14 ms
2026-11-22 09:41:17.881 INFO  [http-7] POST /api/bookings 201 (38 ms) show=planetarium-1130 seats=4
2026-11-22 09:41:19.204 WARN  [http-3] Slow response: GET /api/shows took 1830 ms
2026-11-22 09:42:05.661 ERROR [http-9] Payment callback failed: timeout after 10000 ms (order 88213)
java.net.SocketTimeoutException: Read timed out
    at java.base/sun.nio.ch.NioSocketImpl.timedRead(NioSocketImpl.java:288)
2026-11-22 09:42:06.002 INFO  [retry-1] Retrying payment callback for order 88213 (attempt 2)
2026-11-22 09:42:06.877 INFO  [retry-1] Payment confirmed for order 88213
{"time":"2026-11-22T09:45:00Z","level":"warn","msg":"Seat map cache is 92% full","cache":"seats"}
{"time":"2026-11-22T09:46:12Z","level":"error","msg":"Kiosk 3 lost connection","kiosk":3}
2026-11-22 10:00:00.000 INFO  [cron] Daily report sent to curator@example.org
`;

const ROW = 20;

interface LogState {
  readonly text: string;
  readonly regex: boolean;
  readonly matchCase: boolean;
  readonly exclude: string;
  readonly levels: readonly Level[];
}

const readLog = (v: Values | undefined): LogState => ({
  text: typeof v?.text === 'string' ? v.text : '',
  regex: v?.regex === true,
  matchCase: v?.matchCase === true,
  exclude: typeof v?.exclude === 'string' ? v.exclude : '',
  levels: Array.isArray(v?.levels) ? (v.levels as string[]).filter((l): l is Level => (LEVELS as readonly string[]).includes(l)) : [...LEVELS],
});
const writeLog = (s: LogState): Values => ({ ...s, levels: [...s.levels] });

const LEVEL_LABEL: Record<Level, string> = { error: 'Errors', warn: 'Warnings', info: 'Info', debug: 'Debug', other: 'Other' };

function highlight(line: string, test: ((s: string) => boolean) | null, state: LogState) {
  if (!test || !state.text) return line;
  let re: RegExp;
  try {
    re = state.regex ? new RegExp(state.text, state.matchCase ? 'g' : 'gi') : new RegExp(state.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), state.matchCase ? 'g' : 'gi');
  } catch {
    return line;
  }
  const parts: (string | preact.JSX.Element)[] = [];
  let last = 0;
  for (const m of line.matchAll(re)) {
    if (!m[0]) break;
    const at = m.index ?? 0;
    parts.push(line.slice(last, at), <mark key={at}>{m[0]}</mark>);
    last = at + m[0].length;
  }
  parts.push(line.slice(last));
  return parts;
}

function LogViewer({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readLog, writeLog);
  const [name, setName] = useState('');
  const [index, setIndex] = useState<LogIndex | null>(null);
  const [filtered, setFiltered] = useState<Int32Array | null>(null);
  const [busy, setBusy] = useState<{ what: string; fraction: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(560);
  const [lines, setLines] = useState<Map<number, string>>(new Map());
  const [selected, setSelected] = useState<number | null>(null);
  const [goTo, setGoTo] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const job = useRef<{ cancelled: boolean } | null>(null);

  const open = async (blob: Blob, label: string) => {
    if (job.current) job.current.cancelled = true;
    const signal = { cancelled: false };
    job.current = signal;
    setError(null);
    setBusy({ what: 'Reading', fraction: 0 });
    try {
      const made = await indexLog(blob, (fraction) => setBusy({ what: 'Reading', fraction }), signal);
      setIndex(made);
      setName(label);
      setLines(new Map());
      setSelected(null);
      if (box.current) box.current.scrollTop = 0;
    } catch (e) {
      if (!signal.cancelled) setError(errorMessage(e));
    } finally {
      if (job.current === signal) setBusy(null);
    }
  };

  // Filtering runs again when the rules change, after a short pause.
  const problem = filterProblem(state);
  useEffect(() => {
    if (!index || problem) return;
    const signal = { cancelled: false };
    const timer = setTimeout(async () => {
      setBusy({ what: 'Filtering', fraction: 0 });
      try {
        const result = await filterLines(index, { ...state, levels: new Set(state.levels) }, (fraction) => !signal.cancelled && setBusy({ what: 'Filtering', fraction }), signal);
        if (!signal.cancelled) {
          setFiltered(result);
          if (box.current) box.current.scrollTop = 0;
        }
      } catch (e) {
        if (!signal.cancelled) setError(errorMessage(e));
      } finally {
        if (!signal.cancelled) setBusy(null);
      }
    }, 250);
    return () => {
      signal.cancelled = true;
      clearTimeout(timer);
    };
  }, [index, state.text, state.regex, state.matchCase, state.exclude, state.levels.join()]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const total = filtered ? filtered.length : (index?.lineCount ?? 0);
  const first = Math.max(0, Math.floor(scroll / ROW) - 20);
  const last = Math.min(total, Math.ceil((scroll + height) / ROW) + 20);
  const lineAt = (row: number) => (filtered ? (filtered[row] as number) : row);

  // Read the lines on screen (and a margin) from the file.
  useEffect(() => {
    if (!index || last <= first) return;
    let live = true;
    void (async () => {
      const wanted: number[] = [];
      for (let r = first; r < last; r++) if (!lines.has(lineAt(r))) wanted.push(lineAt(r));
      if (!wanted.length) return;
      const next = new Map(lines.size > 20_000 ? [] : lines);
      // Read runs of consecutive lines together.
      let runStart = wanted[0] as number;
      let prev = runStart;
      const flush = async (a: number, b: number) => {
        const text = await readLines(index, a, b + 1);
        for (const [k, t] of text.entries()) next.set(a + k, t);
      };
      for (const n of wanted.slice(1)) {
        if (n !== prev + 1) {
          await flush(runStart, prev);
          runStart = n;
        }
        prev = n;
      }
      await flush(runStart, prev);
      if (live) setLines(next);
    })();
    return () => {
      live = false;
    };
  }, [index, filtered, first, last]);

  const test = useMemo(() => (problem ? null : matcher(state)), [state.text, state.regex, state.matchCase, problem]);
  const set = <K extends keyof LogState>(k: K, v: LogState[K]) => setState((s) => ({ ...s, [k]: v }));
  const toggleLevel = (level: Level) => set('levels', state.levels.includes(level) ? state.levels.filter((l) => l !== level) : [...state.levels, level]);
  const selectedText = selected !== null ? lines.get(selected) : undefined;
  const json = useMemo(() => {
    if (!selectedText?.trim().startsWith('{')) return null;
    try {
      return JSON.stringify(JSON.parse(selectedText), null, 2);
    } catch {
      return null;
    }
  }, [selectedText]);

  const jump = () => {
    const n = Number(goTo) - 1;
    if (!index || !Number.isFinite(n)) return;
    const row = filtered ? filtered.findIndex((l) => l >= n) : Math.min(n, index.lineCount - 1);
    if (row >= 0 && box.current) {
      box.current.scrollTop = row * ROW;
      setSelected(lineAt(row));
    }
  };

  return (
    <section class="tool lv-tool" data-testid="tool" data-state={index ? 'done' : busy ? 'busy' : 'idle'}>
      <div class="button-row">
        <MultiDrop icon="file" compact accept=".log,.txt,.out,.err,.json,.jsonl,.ndjson,.csv,text/plain" title="Open a log file" onFiles={(f) => f[0] && void open(f[0], f[0].name)} testId="lv-open" />
        <button type="button" class="button button-quiet" onClick={() => void open(new Blob([SAMPLE_LOG]), 'sample.log')} data-testid="lv-sample">
          <Icon name="sample" size={14} /> Sample
        </button>
        <button
          type="button"
          class="button button-quiet"
          onClick={() =>
            attempt(async () => {
              const text = await navigator.clipboard.readText();
              if (text) await open(new Blob([text]), 'pasted text');
            })
          }
        >
          <Icon name="paste" size={14} /> Paste
        </button>
        {index && (
          <span class="tone-muted" data-testid="lv-info">
            {name} · {formatBytes(index.source.size)} · {index.lineCount.toLocaleString()} lines
            {filtered ? ` · ${filtered.length.toLocaleString()} shown` : ''}
          </span>
        )}
        {busy && (
          <span class="tone-muted" aria-live="polite">
            {busy.what}… {Math.round(busy.fraction * 100)}%
          </span>
        )}
      </div>
      <div class="lv-filters">
        <input
          class="input lv-search"
          type="search"
          placeholder={state.regex ? 'Regular expression' : 'Show lines containing…'}
          aria-label="Show lines containing"
          value={state.text}
          onInput={(e) => set('text', e.currentTarget.value)}
          data-testid="lv-filter"
        />
        <input
          class="input lv-search"
          type="search"
          placeholder="Hide lines containing…"
          aria-label="Hide lines containing"
          value={state.exclude}
          onInput={(e) => set('exclude', e.currentTarget.value)}
        />
        <label class="check">
          <input type="checkbox" checked={state.regex} onChange={(e) => set('regex', e.currentTarget.checked)} /> Regular expression
        </label>
        <label class="check">
          <input type="checkbox" checked={state.matchCase} onChange={(e) => set('matchCase', e.currentTarget.checked)} /> Match case
        </label>
        <span class="lv-levels" role="group" aria-label="Levels">
          {LEVELS.map((level) => (
            <button key={level} type="button" class={`lv-level lv-${level}`} aria-pressed={state.levels.includes(level)} onClick={() => toggleLevel(level)} data-testid={`lv-level-${level}`}>
              {LEVEL_LABEL[level]}
              {index && <span class="lv-count">{index.counts[level].toLocaleString()}</span>}
            </button>
          ))}
        </span>
        <span class="lv-goto">
          <input
            class="input input-narrow"
            type="number"
            min={1}
            placeholder="Line"
            aria-label="Go to line"
            value={goTo}
            onInput={(e) => setGoTo(e.currentTarget.value)}
            onKeyDown={(e) => e.key === 'Enter' && jump()}
          />
          <button type="button" class="button button-small" onClick={jump}>
            Go
          </button>
        </span>
      </div>
      {problem && <p class="recipe-error">The regular expression is not valid: {problem}</p>}
      {error && <p class="recipe-error">{error}</p>}
      <div class="lv-body">
        <div ref={box} class="lv-lines" onScroll={(e) => setScroll(e.currentTarget.scrollTop)} {...scrollRegion('Log lines')} data-testid="lv-lines">
          {!index && <p class="lv-empty tone-muted">Open a log file (any size: it is read in pieces), paste text, or try the sample.</p>}
          <div style={{ height: `${total * ROW}px`, position: 'relative' }}>
            {Array.from({ length: Math.max(0, last - first) }, (_, k) => {
              const row = first + k;
              const n = lineAt(row);
              const text = lines.get(n);
              const level = index ? levelAt(index, n) : 'other';
              return (
                <div key={n} class={`lv-line lv-${level}${selected === n ? ' is-selected' : ''}`} style={{ top: `${row * ROW}px` }} onClick={() => setSelected(n)}>
                  <span class="lv-number">{n + 1}</span>
                  <span class="lv-text">{text === undefined ? '' : highlight(text, test, state)}</span>
                </div>
              );
            })}
          </div>
        </div>
        {selected !== null && selectedText !== undefined && (
          <aside class="lv-detail" data-testid="lv-detail">
            <div class="button-row">
              <strong>Line {selected + 1}</strong>
              <button
                type="button"
                class="button button-small"
                onClick={() =>
                  attempt(async () => {
                    await copyText(selectedText);
                    notify('Line copied');
                  })
                }
              >
                <Icon name="copy" size={13} /> Copy
              </button>
              <button type="button" class="icon-button" aria-label="Close" onClick={() => setSelected(null)}>
                <Icon name="close" size={14} />
              </button>
            </div>
            <pre>{json ?? selectedText}</pre>
          </aside>
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- Patch Viewer -- */

const SAMPLE_PATCH = `From 3f9c2a1b7e4d5c6f8a9b0c1d2e3f4a5b6c7d8e9f Mon Sep 17 00:00:00 2001
From: Abhisht Srivastava <curator@example.org>
Date: Sun, 22 Nov 2026 10:15:00 +0530
Subject: [PATCH] Show the planetarium queue on the kiosk

Visitors asked how long the wait is; the kiosk now shows the next
free show and seats left.
---
 kiosk/queue.py   | 10 ++++++++--
 kiosk/README.md  |  3 +++
 2 files changed, 11 insertions(+), 2 deletions(-)

diff --git a/kiosk/queue.py b/kiosk/queue.py
index 4b1c2d3..9e8f7a6 100644
--- a/kiosk/queue.py
+++ b/kiosk/queue.py
@@ -1,9 +1,15 @@
 from datetime import datetime
+from shows import next_show


 def status(now: datetime) -> str:
-    return "Open"
+    show = next_show(now)
+    if show is None:
+        return "No more shows today"
+    left = show.capacity - show.booked
+    return f"Next show {show.time:%H:%M}: {left} seats left"


 def closing_time() -> str:
-    return "17:30"
+    return "17:45"
diff --git a/kiosk/README.md b/kiosk/README.md
index 1a2b3c4..5d6e7f8 100644
--- a/kiosk/README.md
+++ b/kiosk/README.md
@@ -3,3 +3,6 @@ Kiosk software for the Engine Hall.
 Run with python -m kiosk.

 Requires Python 3.11.
+
+The queue screen reads shows from the ticketing
+service every 30 seconds.
--
2.47.1
`;

function PatchViewer({ toolId }: { toolId: string }) {
  const [text, setText] = usePersistentState(
    toolId,
    (v) => (typeof v?.patch === 'string' ? v.patch : SAMPLE_PATCH),
    (patch) => ({ patch: patch.length > 300_000 ? '' : patch }),
  );
  const [layout, setLayout] = useState<'split' | 'unified'>('split');
  const [current, setCurrent] = useState(0);
  const commits = useMemo<Commit[]>(() => {
    try {
      return parsePatch(text);
    } catch {
      return [];
    }
  }, [text]);
  const files: (PatchFile & { commit: number })[] = commits.flatMap((c, ci) => c.files.map((f) => Object.assign(f, { commit: ci })));
  const stats = patchStats(commits);
  const file = files[Math.min(current, Math.max(0, files.length - 1))];
  const STATUS: Record<PatchFile['status'], string> = { modified: 'changed', added: 'new', deleted: 'deleted', renamed: 'renamed', copied: 'copied', binary: 'binary', mode: 'mode change' };

  return (
    <section class="tool pv-tool" data-testid="tool" data-state={files.length ? 'done' : 'idle'}>
      <div class="button-row">
        <MultiDrop
          icon="file"
          compact
          accept=".patch,.diff,.txt,text/x-diff,text/x-patch"
          title="Open a patch"
          onFiles={(f) => f[0] && void attempt(async () => setText(await (f[0] as File).text()))}
          testId="pv-open"
        />
        <Segmented
          label="Layout"
          value={layout}
          onChange={setLayout}
          choices={[
            { value: 'split', label: 'Side by side' },
            { value: 'unified', label: 'One column' },
          ]}
        />
        <span class="tone-muted" data-testid="pv-stats">
          {stats.files} {stats.files === 1 ? 'file' : 'files'} · <span class="pv-add">+{stats.additions}</span> <span class="pv-del">−{stats.deletions}</span>
          {commits.length > 1 && ` · ${commits.length} commits`}
        </span>
      </div>
      <details class="pv-source">
        <summary>Patch text (paste a git diff, a .patch file or diff -u output)</summary>
        <div class="pane">
          <div class="pane-body">
            <CodeEditor value={text} onChange={setText} label="Patch" testId="pv-text" />
          </div>
        </div>
      </details>
      {commits.map(
        (c) =>
          c.subject && (
            <div key={c.hash || c.subject} class="pv-commit">
              <strong>{c.subject}</strong>
              <span class="tone-muted">
                {c.author}
                {c.date && ` · ${c.date}`}
                {c.hash && ` · ${c.hash.slice(0, 10)}`}
              </span>
              {c.message.trim() && <p>{c.message.trim()}</p>}
            </div>
          ),
      )}
      {files.length === 0 ? (
        <p class="tone-muted">No changes found. Paste the output of git diff, git format-patch or diff -u.</p>
      ) : (
        <div class="pv-layout">
          <ul class="pv-files" data-testid="pv-files">
            {files.map((f, i) => (
              <li key={`${f.commit}-${f.newPath}-${i}`}>
                <button type="button" class={`pv-file${i === current ? ' is-active' : ''}`} aria-current={i === current ? 'true' : undefined} onClick={() => setCurrent(i)}>
                  <span class="pv-path">{f.status === 'renamed' ? `${f.oldPath} → ${f.newPath}` : f.newPath}</span>
                  <span class="pv-meta">
                    <span class={`pv-status pv-${f.status}`}>{STATUS[f.status]}</span> <span class="pv-add">+{f.additions}</span> <span class="pv-del">−{f.deletions}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div class="pv-diff" data-testid="pv-diff">
            {file && (
              <>
                <div class="button-row">
                  <strong>{file.newPath}</strong>
                  <button type="button" class="icon-button" aria-label="Previous file" disabled={current <= 0} onClick={() => setCurrent(current - 1)}>
                    <Icon name="up" size={14} />
                  </button>
                  <button type="button" class="icon-button" aria-label="Next file" disabled={current >= files.length - 1} onClick={() => setCurrent(current + 1)}>
                    <Icon name="down" size={14} />
                  </button>
                </div>
                {file.notes.map((n) => (
                  <p key={n} class="tone-muted">
                    {n}
                  </p>
                ))}
                {file.hunks.length > 0 && <PreviewView preview={{ kind: 'diff', rows: fileRows(file), layout, titles: [file.oldPath, file.newPath] }} name={file.newPath} />}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function LogPatch({ toolId }: { toolId: string }) {
  if (toolId === 'patch-viewer') return <PatchViewer toolId={toolId} />;
  return <LogViewer toolId={toolId} />;
}

export default defineCustomTool(LogPatch);
