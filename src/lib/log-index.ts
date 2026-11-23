/**
 * Large log files without loading them whole: the file is read in chunks to
 * find where each line starts (and its level), and lines are read back only
 * when they are shown or searched.
 */

export type Level = 'error' | 'warn' | 'info' | 'debug' | 'other';
export const LEVELS: readonly Level[] = ['error', 'warn', 'info', 'debug', 'other'];

const LEVEL_PATTERNS: readonly [Level, RegExp][] = [
  ['error', /\b(ERROR|ERR|FATAL|CRIT(ICAL)?|SEVERE|PANIC|EMERG|ALERT|Exception|Traceback)\b|"level"\s*:\s*"(error|fatal|critical)"|\blevel=(error|fatal)\b/i],
  ['warn', /\b(WARN(ING)?|NOTICE)\b|"level"\s*:\s*"warn(ing)?"|\blevel=warn(ing)?\b/i],
  ['info', /\bINFO\b|"level"\s*:\s*"info"|\blevel=info\b/i],
  ['debug', /\b(DEBUG|TRACE|VERBOSE|FINE(R|ST)?)\b|"level"\s*:\s*"(debug|trace)"|\blevel=(debug|trace)\b/i],
];

export function levelOf(line: string): Level {
  // Only the start of a line is looked at: levels come first in nearly every format.
  const head = line.length > 300 ? line.slice(0, 300) : line;
  for (const [level, re] of LEVEL_PATTERNS) if (re.test(head)) return level;
  return 'other';
}

const LEVEL_CODE: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3, other: 4 };

export interface LogIndex {
  readonly source: Blob;
  /** Byte offset where each line starts; one extra entry holds the end. */
  readonly starts: Float64Array;
  readonly levels: Uint8Array;
  readonly lineCount: number;
  readonly counts: Readonly<Record<Level, number>>;
}

const CHUNK = 4 * 1024 * 1024;

/** Indexes a file (or text) in chunks, reporting progress as a fraction. */
export async function indexLog(source: Blob, progress?: (fraction: number) => void, signal?: { cancelled: boolean }): Promise<LogIndex> {
  let starts = new Float64Array(1024);
  let levels = new Uint8Array(1024);
  let count = 0;
  const push = (offset: number) => {
    if (count >= starts.length) {
      const grown = new Float64Array(starts.length * 2);
      grown.set(starts);
      starts = grown;
      const grownLevels = new Uint8Array(levels.length * 2);
      grownLevels.set(levels);
      levels = grownLevels;
    }
    starts[count++] = offset;
  };
  const counts: Record<Level, number> = { error: 0, warn: 0, info: 0, debug: 0, other: 0 };
  const decoder = new TextDecoder();
  push(0);
  // The start of a line that runs on into the next chunk (only its head is needed).
  let carry: Uint8Array = new Uint8Array(0);
  for (let pos = 0; pos < source.size; pos += CHUNK) {
    if (signal?.cancelled) throw new Error('Stopped.');
    const chunk = new Uint8Array(await source.slice(pos, pos + CHUNK).arrayBuffer());
    let lineStart = 0;
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] !== 10) continue;
      // The line that ended here: classify it, then record where the next begins.
      const piece = carry.length ? concat(carry, chunk.subarray(0, i)) : chunk.subarray(lineStart, i);
      const level = levelOf(decoder.decode(piece.length > 600 ? piece.subarray(0, 600) : piece));
      levels[count - 1] = LEVEL_CODE[level];
      counts[level]++;
      carry = new Uint8Array(0);
      lineStart = i + 1;
      push(pos + i + 1);
    }
    if (lineStart < chunk.length && carry.length < 600) carry = concat(carry, chunk.subarray(lineStart, lineStart + 600 - carry.length));
    progress?.(Math.min(1, (pos + CHUNK) / Math.max(1, source.size)));
    await new Promise((r) => setTimeout(r, 0));
  }
  // A last line without a newline.
  let lineCount = count - 1;
  if ((starts[count - 1] as number) < source.size) {
    const level = levelOf(decoder.decode(carry.subarray(0, 600)));
    levels[count - 1] = LEVEL_CODE[level];
    counts[level]++;
    lineCount = count;
    push(source.size);
  } else if (lineCount === 0 && source.size === 0) lineCount = 0;
  return { source, starts: starts.subarray(0, count), levels: levels.subarray(0, count), lineCount, counts };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

export const levelAt = (index: LogIndex, line: number): Level => LEVELS[index.levels[line] ?? 4] as Level;

/** Lines [from, to) as text, without their line endings. */
export async function readLines(index: LogIndex, from: number, to: number): Promise<string[]> {
  const a = Math.max(0, from);
  const b = Math.min(index.lineCount, to);
  if (b <= a) return [];
  const bytes = new Uint8Array(await index.source.slice(index.starts[a] as number, index.starts[b] as number).arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  const lines = text.split('\n');
  if (lines.length > b - a) lines.length = b - a;
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

export interface LogFilter {
  readonly text: string;
  readonly regex: boolean;
  readonly matchCase: boolean;
  readonly exclude: string;
  readonly levels: ReadonlySet<Level>;
}

export function filterProblem(f: Pick<LogFilter, 'text' | 'regex' | 'matchCase'>): string | null {
  if (!f.regex || !f.text) return null;
  try {
    new RegExp(f.text, f.matchCase ? '' : 'i');
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export function matcher(f: Pick<LogFilter, 'text' | 'regex' | 'matchCase'>): ((line: string) => boolean) | null {
  if (!f.text) return null;
  if (f.regex) {
    const re = new RegExp(f.text, f.matchCase ? '' : 'i');
    return (line) => re.test(line);
  }
  const needle = f.matchCase ? f.text : f.text.toLowerCase();
  return f.matchCase ? (line) => line.includes(needle) : (line) => line.toLowerCase().includes(needle);
}

/** Line numbers that pass the filter (null when nothing filters). */
export async function filterLines(index: LogIndex, f: LogFilter, progress?: (fraction: number) => void, signal?: { cancelled: boolean }): Promise<Int32Array | null> {
  const include = matcher(f);
  const exclude = f.exclude ? matcher({ text: f.exclude, regex: false, matchCase: false }) : null;
  const allLevels = f.levels.size === LEVELS.length;
  if (!include && !exclude && allLevels) return null;
  const out = new Int32Array(index.lineCount);
  let n = 0;
  const step = 20_000;
  for (let from = 0; from < index.lineCount; from += step) {
    if (signal?.cancelled) throw new Error('Stopped.');
    const to = Math.min(index.lineCount, from + step);
    const needText = include || exclude;
    const lines = needText ? await readLines(index, from, to) : [];
    for (let i = from; i < to; i++) {
      if (!allLevels && !f.levels.has(levelAt(index, i))) continue;
      const line = needText ? (lines[i - from] ?? '') : '';
      if (include && !include(line)) continue;
      if (exclude?.(line)) continue;
      out[n++] = i;
    }
    progress?.(to / Math.max(1, index.lineCount));
    if (needText) await new Promise((r) => setTimeout(r, 0));
  }
  return out.slice(0, n);
}
