/**
 * Three-way merge of text (diff3): what two people changed from a common
 * version, put together; where both changed the same place differently, a
 * conflict to decide by hand.
 */
import { diffArrays } from 'diff';

export type Chunk =
  /** Lines nobody changed, or that one side or both sides changed the same way. */
  | { readonly kind: 'plain'; readonly lines: string[]; readonly from: 'base' | 'ours' | 'theirs' | 'both' }
  | { readonly kind: 'conflict'; readonly base: string[]; readonly ours: string[]; readonly theirs: string[] };

interface Change {
  readonly side: 0 | 1;
  /** Lines replaced in the base, and what the side has instead. */
  readonly baseStart: number;
  readonly baseLength: number;
  readonly sideStart: number;
  readonly sideLength: number;
}

function changes(base: readonly string[], side: readonly string[], which: 0 | 1): Change[] {
  const out: Change[] = [];
  let b = 0;
  let s = 0;
  let open: { baseStart: number; sideStart: number } | null = null;
  const close = () => {
    if (open) out.push({ side: which, baseStart: open.baseStart, baseLength: b - open.baseStart, sideStart: open.sideStart, sideLength: s - open.sideStart });
    open = null;
  };
  for (const part of diffArrays(base as string[], side as string[])) {
    const count = part.value.length;
    if (!part.added && !part.removed) {
      close();
      b += count;
      s += count;
      continue;
    }
    open ??= { baseStart: b, sideStart: s };
    if (part.removed) b += count;
    else s += count;
  }
  close();
  return out;
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((line, i) => line === b[i]);

/** Splits text into lines, each keeping its line end, so a missing final newline survives. */
export function linesOf(text: string): string[] {
  return text === '' ? [] : (text.match(/[^\n]*\n|[^\n]+$/g) ?? []);
}

/** The merge of `ours` and `theirs`, which both started from `base`. */
export function merge3(base: readonly string[], ours: readonly string[], theirs: readonly string[]): Chunk[] {
  const all = [...changes(base, ours, 0), ...changes(base, theirs, 1)].sort((a, b) => a.baseStart - b.baseStart || a.side - b.side);
  const chunks: Chunk[] = [];
  const plain = (lines: readonly string[], from: 'base' | 'ours' | 'theirs' | 'both') => {
    if (!lines.length) return;
    const last = chunks[chunks.length - 1];
    if (last?.kind === 'plain' && last.from === from) last.lines.push(...lines);
    else chunks.push({ kind: 'plain', lines: [...lines], from });
  };
  // How far each side has been copied, counted in its own lines; `done` in base lines.
  let done = 0;
  const offset = [0, 0];
  let i = 0;
  while (i < all.length) {
    // A region: every change that touches or overlaps the ones before it.
    const first = all[i] as Change;
    let end = first.baseStart + first.baseLength;
    let j = i + 1;
    while (j < all.length) {
      const next = all[j] as Change;
      // Changes that overlap or touch belong together: git, too, calls changes to neighbouring lines a conflict.
      if (next.baseStart > end) break;
      end = Math.max(end, next.baseStart + next.baseLength);
      j++;
    }
    const group = all.slice(i, j);
    const start = first.baseStart;
    plain(base.slice(done, start), 'base');
    // What each side has for base[start, end).
    const sideLines = (which: 0 | 1, text: readonly string[]) => {
      const mine = group.filter((c) => c.side === which);
      const from = start + (offset[which] as number);
      const grown = mine.reduce((sum, c) => sum + c.sideLength - c.baseLength, 0);
      const to = end + (offset[which] as number) + grown;
      offset[which] = (offset[which] as number) + grown;
      return { lines: text.slice(from, to), touched: mine.length > 0 };
    };
    const a = sideLines(0, ours);
    const b = sideLines(1, theirs);
    if (a.touched && b.touched) {
      if (same(a.lines, b.lines)) plain(a.lines, 'both');
      else chunks.push({ kind: 'conflict', base: base.slice(start, end), ours: a.lines, theirs: b.lines });
    } else if (a.touched) plain(a.lines, 'ours');
    else plain(b.lines, 'theirs');
    done = end;
    i = j;
  }
  plain(base.slice(done), 'base');
  return chunks;
}

export type Choice = 'ours' | 'theirs' | 'ours-theirs' | 'theirs-ours' | 'base' | 'none';

/** The lines a choice gives for a conflict. */
export function resolved(chunk: Extract<Chunk, { kind: 'conflict' }>, choice: Choice): string[] {
  switch (choice) {
    case 'ours':
      return chunk.ours;
    case 'theirs':
      return chunk.theirs;
    case 'ours-theirs':
      return [...chunk.ours, ...chunk.theirs];
    case 'theirs-ours':
      return [...chunk.theirs, ...chunk.ours];
    case 'base':
      return chunk.base;
    default:
      return [];
  }
}

const closed = (lines: readonly string[]): string => {
  const text = lines.join('');
  return text === '' || text.endsWith('\n') ? text : `${text}\n`;
};

/**
 * The merged text.  A conflict without a decision is written with the markers git uses, so
 * the file can still be finished in any editor.
 */
export function mergedText(chunks: readonly Chunk[], decisions: ReadonlyMap<number, string[]>, labels = { ours: 'ours', theirs: 'theirs', base: 'base' }): string {
  let out = '';
  chunks.forEach((chunk, index) => {
    if (chunk.kind === 'plain') out += chunk.lines.join('');
    else {
      const decided = decisions.get(index);
      if (decided) out += decided.join('');
      else out += `<<<<<<< ${labels.ours}\n${closed(chunk.ours)}||||||| ${labels.base}\n${closed(chunk.base)}=======\n${closed(chunk.theirs)}>>>>>>> ${labels.theirs}\n`;
    }
  });
  return out;
}

export const conflictsIn = (chunks: readonly Chunk[]): number => chunks.filter((chunk) => chunk.kind === 'conflict').length;

/* ------------------------------------------------------------ commit graph -- */

export interface GraphCommit {
  readonly hash: string;
  readonly parents: readonly string[];
}

export interface GraphRow {
  /** The lane the commit's dot is in. */
  readonly lane: number;
  /** Lanes with a line coming in from above that ends at this commit. */
  readonly joins: number[];
  /** Lanes that pass by this row. */
  readonly passing: number[];
  /** Lanes the lines to this commit's parents leave through. */
  readonly out: number[];
  /** How many lanes the row is wide. */
  readonly width: number;
}

/** Lays out commits (newest first, as `git log` lists them) in lanes, the way history graphs are drawn. */
export function graphRows(commits: readonly GraphCommit[]): GraphRow[] {
  // For each lane, the commit its line is waiting for.
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];
  const free = () => {
    const index = lanes.indexOf(null);
    if (index >= 0) return index;
    lanes.push(null);
    return lanes.length - 1;
  };
  for (const commit of commits) {
    const joins = lanes.map((hash, index) => (hash === commit.hash ? index : -1)).filter((index) => index >= 0);
    const lane = joins.length ? (joins[0] as number) : free();
    for (const index of joins) lanes[index] = null;
    const passing = lanes.map((hash, index) => (hash !== null ? index : -1)).filter((index) => index >= 0);
    const out: number[] = [];
    commit.parents.forEach((parent, order) => {
      const existing = lanes.indexOf(parent);
      if (existing >= 0) {
        out.push(existing);
        return;
      }
      let to: number;
      if (order === 0) to = lane;
      else to = free();
      lanes[to] = parent;
      out.push(to);
    });
    rows.push({ lane, joins, passing, out, width: Math.max(lanes.length, lane + 1) });
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
  }
  return rows;
}

/* ------------------------------------------------------------ unified diff -- */

export interface DiffLine {
  readonly kind: 'meta' | 'hunk' | 'same' | 'add' | 'remove';
  readonly text: string;
  /** Line numbers in the old and the new file, where the line exists. */
  readonly old?: number;
  readonly new?: number;
}

/** A unified diff (as `git diff` prints it) as lines with their numbers. */
export function parseUnifiedDiff(text: string): DiffLine[] {
  const out: DiffLine[] = [];
  let oldAt = 0;
  let newAt = 0;
  let inHunk = false;
  for (const line of text.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldAt = Number(hunk[1]);
      newAt = Number(hunk[2]);
      inHunk = true;
      out.push({ kind: 'hunk', text: line });
    } else if (!inHunk || line.startsWith('diff --git') || line.startsWith('\\')) {
      if (line.startsWith('diff --git')) inHunk = false;
      if (line !== '') out.push({ kind: 'meta', text: line });
    } else if (line.startsWith('+')) out.push({ kind: 'add', text: line.slice(1), new: newAt++ });
    else if (line.startsWith('-')) out.push({ kind: 'remove', text: line.slice(1), old: oldAt++ });
    else if (line.startsWith(' ') || line === '') {
      if (line === '' && out[out.length - 1]?.kind === 'meta') continue;
      out.push({ kind: 'same', text: line.slice(1), old: oldAt++, new: newAt++ });
    }
  }
  // A final empty line is the end of the text, not a line of the file.
  const last = out[out.length - 1];
  if (last?.kind === 'same' && last.text === '') out.pop();
  return out;
}
