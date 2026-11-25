/**
 * Comparing two PDFs: which words changed (a diff of the text line by line,
 * then word by word inside the lines that changed, with the place of every
 * word on its page) and which pixels changed (page pictures).
 */
import { type Box, joinItems, rangeBoxes, type TextItem } from './pdf-redact';

export type Op = 'same' | 'removed' | 'added';

/** A stretch of the edit: `a` and `b` index ranges, [start, end). */
export interface Hunk {
  readonly op: Op;
  readonly aStart: number;
  readonly aEnd: number;
  readonly bStart: number;
  readonly bEnd: number;
}

/** The shortest edit between a[sa..ea) and b[sb..eb) (Myers), or null when it needs more than `limit` steps. */
function myers(a: readonly number[], sa: number, ea: number, b: readonly number[], sb: number, eb: number, limit: number): Hunk[] | null {
  const n = ea - sa;
  const m = eb - sb;
  const max = n + m;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  outer: for (let d = 0; d <= max; d++) {
    if (d > limit) return null;
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (v[off + k - 1] as number) < (v[off + k + 1] as number)) ? (v[off + k + 1] as number) : (v[off + k - 1] as number) + 1;
      let y = x - k;
      while (x < n && y < m && a[sa + x] === b[sb + y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break outer;
      }
    }
    trace.push(v.slice(off - d, off + d + 1));
  }
  // Walk back from the end, one step at a time.
  const steps: { op: Op; x: number; y: number }[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d - 1] as Int32Array;
    const at = (k: number) => prev[k + d - 1] as number;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const pk = down ? k + 1 : k - 1;
    const px = at(pk);
    const py = px - pk;
    const mx = down ? px : px + 1;
    const my = down ? py + 1 : py;
    while (x > mx && y > my) {
      steps.push({ op: 'same', x: x - 1, y: y - 1 });
      x--;
      y--;
    }
    steps.push(down ? { op: 'added', x: px, y: py } : { op: 'removed', x: px, y: py });
    x = px;
    y = py;
  }
  while (x > 0 && y > 0) {
    steps.push({ op: 'same', x: x - 1, y: y - 1 });
    x--;
    y--;
  }
  steps.reverse();
  return steps.map((s) => ({
    op: s.op,
    aStart: sa + s.x,
    aEnd: sa + s.x + (s.op === 'added' ? 0 : 1),
    bStart: sb + s.y,
    bEnd: sb + s.y + (s.op === 'removed' ? 0 : 1),
  }));
}

/**
 * How `b` differs from `a`, as hunks that cover both in order.  Sequences that differ in
 * more than `limit` places in between their common start and end are taken as replaced.
 */
export function diff(a: readonly number[], b: readonly number[], limit = 2500): Hunk[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const hunks: Hunk[] = [];
  const push = (h: Hunk) => {
    if (h.aEnd - h.aStart + h.bEnd - h.bStart <= 0) return;
    const last = hunks[hunks.length - 1];
    if (last && last.op === h.op && last.aEnd === h.aStart && last.bEnd === h.bStart) hunks[hunks.length - 1] = { ...last, aEnd: h.aEnd, bEnd: h.bEnd };
    else hunks.push(h);
  };
  push({ op: 'same', aStart: 0, aEnd: start, bStart: 0, bEnd: start });
  const middle = myers(a, start, endA, b, start, endB, limit);
  if (middle) for (const h of middle) push(h);
  else {
    push({ op: 'removed', aStart: start, aEnd: endA, bStart: start, bEnd: start });
    push({ op: 'added', aStart: endA, aEnd: endA, bStart: start, bEnd: endB });
  }
  push({ op: 'same', aStart: endA, aEnd: a.length, bStart: endB, bEnd: b.length });
  return hunks;
}

export interface Word {
  readonly text: string;
  /** Page, from 1. */
  readonly page: number;
  readonly box: Box;
}

const unionOf = (boxes: readonly Box[]): Box => {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  return { x: x0, y: y0, w: Math.max(...boxes.map((b) => b.x + b.w)) - x0, h: Math.max(...boxes.map((b) => b.y + b.h)) - y0 };
};

/** The words of a page's text, each with the box around it. */
export function wordsOf(items: readonly TextItem[], page: number): Word[] {
  const joined = joinItems(items);
  const words: Word[] = [];
  for (const m of joined.text.matchAll(/\S+/gu)) {
    const boxes = rangeBoxes(items, joined, m.index, m.index + m[0].length, 0);
    if (boxes.length) words.push({ text: m[0], page, box: unionOf(boxes) });
  }
  return words;
}

export interface Line {
  readonly key: string;
  readonly words: readonly Word[];
}

/** Words grouped into the lines they sit on. */
export function linesOf(words: readonly Word[]): Line[] {
  const lines: Word[][] = [];
  let line: Word[] = [];
  let centre = 0;
  let height = 0;
  for (const word of words) {
    const middle = word.box.y + word.box.h / 2;
    const first = line[0];
    if (first && (first.page !== word.page || Math.abs(middle - centre) > Math.max(height, word.box.h) * 0.6)) {
      lines.push(line);
      line = [];
    }
    if (!line.length) {
      centre = middle;
      height = word.box.h;
    }
    line.push(word);
  }
  if (line.length) lines.push(line);
  return lines.map((ws) => ({ key: ws.map((w) => w.text).join(' '), words: ws }));
}

export interface Segment {
  readonly op: Op;
  /** Words of the first document (for 'same' and 'removed'). */
  readonly a: readonly Word[];
  /** Words of the second document (for 'same' and 'added'). */
  readonly b: readonly Word[];
}

/** The words of two documents, as runs that are the same, removed or added. */
export function compareText(aWords: readonly Word[], bWords: readonly Word[], limit = 2500): Segment[] {
  const ids = new Map<string, number>();
  const id = (s: string) => {
    let n = ids.get(s);
    if (n === undefined) {
      n = ids.size;
      ids.set(s, n);
    }
    return n;
  };
  const aLines = linesOf(aWords);
  const bLines = linesOf(bWords);
  const hunks = diff(
    aLines.map((l) => id(l.key)),
    bLines.map((l) => id(l.key)),
    limit,
  );
  const segments: Segment[] = [];
  const push = (s: Segment) => {
    if (!s.a.length && !s.b.length) return;
    const last = segments[segments.length - 1];
    if (last && last.op === s.op) segments[segments.length - 1] = { op: s.op, a: [...last.a, ...s.a], b: [...last.b, ...s.b] };
    else segments.push(s);
  };
  for (let i = 0; i < hunks.length; i++) {
    const h = hunks[i] as Hunk;
    if (h.op === 'same') {
      push({ op: 'same', a: aLines.slice(h.aStart, h.aEnd).flatMap((l) => l.words), b: bLines.slice(h.bStart, h.bEnd).flatMap((l) => l.words) });
      continue;
    }
    // Lines that changed: compare their words.
    let aStart = h.aStart;
    let aEnd = h.aEnd;
    let bStart = h.bStart;
    let bEnd = h.bEnd;
    let j = i + 1;
    while (j < hunks.length && (hunks[j] as Hunk).op !== 'same') {
      const next = hunks[j] as Hunk;
      aStart = Math.min(aStart, next.aStart);
      aEnd = Math.max(aEnd, next.aEnd);
      bStart = Math.min(bStart, next.bStart);
      bEnd = Math.max(bEnd, next.bEnd);
      j++;
    }
    const aw = aLines.slice(aStart, aEnd).flatMap((l) => l.words);
    const bw = bLines.slice(bStart, bEnd).flatMap((l) => l.words);
    for (const w of diff(
      aw.map((x) => id(x.text)),
      bw.map((x) => id(x.text)),
      limit,
    ))
      push({ op: w.op, a: w.op === 'added' ? [] : aw.slice(w.aStart, w.aEnd), b: w.op === 'removed' ? [] : bw.slice(w.bStart, w.bEnd) });
    i = j - 1;
  }
  return segments;
}

export interface Change {
  readonly removed: readonly Word[];
  readonly added: readonly Word[];
  /** A few words before and after, for finding the place. */
  readonly before: string;
  readonly after: string;
  /** Where it is in each document (the page of the words around it when nothing is there). */
  readonly pageA: number;
  readonly pageB: number;
}

/** Each run of removed and added words, with the words around it. */
export function changesOf(segments: readonly Segment[], context = 6): Change[] {
  const changes: Change[] = [];
  for (let i = 0; i < segments.length; i++) {
    if ((segments[i] as Segment).op === 'same') continue;
    const removed: Word[] = [];
    const added: Word[] = [];
    let j = i;
    while (j < segments.length && (segments[j] as Segment).op !== 'same') {
      removed.push(...(segments[j] as Segment).a);
      added.push(...(segments[j] as Segment).b);
      j++;
    }
    const before = i > 0 ? (segments[i - 1] as Segment) : null;
    const after = j < segments.length ? (segments[j] as Segment) : null;
    const lastA = before?.a[before.a.length - 1];
    const lastB = before?.b[before.b.length - 1];
    changes.push({
      removed,
      added,
      before: (before?.b ?? [])
        .slice(-context)
        .map((w) => w.text)
        .join(' '),
      after: (after?.b ?? [])
        .slice(0, context)
        .map((w) => w.text)
        .join(' '),
      pageA: removed[0]?.page ?? lastA?.page ?? after?.a[0]?.page ?? 1,
      pageB: added[0]?.page ?? lastB?.page ?? after?.b[0]?.page ?? 1,
    });
    i = j - 1;
  }
  return changes;
}

export interface Picture {
  readonly width: number;
  readonly height: number;
  /** RGBA */
  readonly data: Uint8ClampedArray;
}

export interface PixelDiff extends Picture {
  /** Pixels that differ. */
  readonly changed: number;
}

/** Colours of the difference picture (Okabe–Ito: told apart with any colour vision). */
export const DIFF_COLOURS = {
  removed: [213, 94, 0],
  added: [0, 114, 178],
  recoloured: [204, 121, 167],
} as const;

/**
 * The difference of two page pictures, the same size or not: unchanged pixels pale grey,
 * ink only in the first vermilion, ink only in the second blue, a change of colour pink.
 */
export function pixelDiff(a: Picture, b: Picture, tolerance = 48): PixelDiff {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const data = new Uint8ClampedArray(width * height * 4);
  let changed = 0;
  const pixel = (p: Picture, x: number, y: number, out: number[]) => {
    if (x >= p.width || y >= p.height) {
      out[0] = 255;
      out[1] = 255;
      out[2] = 255;
      return;
    }
    const i = (y * p.width + x) * 4;
    const alpha = (p.data[i + 3] ?? 255) / 255;
    // Transparent pixels count as white paper.
    out[0] = 255 - alpha * (255 - (p.data[i] ?? 255));
    out[1] = 255 - alpha * (255 - (p.data[i + 1] ?? 255));
    out[2] = 255 - alpha * (255 - (p.data[i + 2] ?? 255));
  };
  const pa = [0, 0, 0];
  const pb = [0, 0, 0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      pixel(a, x, y, pa);
      pixel(b, x, y, pb);
      const o = (y * width + x) * 4;
      const la = 0.2126 * (pa[0] as number) + 0.7152 * (pa[1] as number) + 0.0722 * (pa[2] as number);
      const lb = 0.2126 * (pb[0] as number) + 0.7152 * (pb[1] as number) + 0.0722 * (pb[2] as number);
      const d = Math.max(Math.abs((pa[0] as number) - (pb[0] as number)), Math.abs((pa[1] as number) - (pb[1] as number)), Math.abs((pa[2] as number) - (pb[2] as number)));
      data[o + 3] = 255;
      if (d <= tolerance) {
        const v = 255 - (255 - lb) * 0.25;
        data[o] = v;
        data[o + 1] = v;
        data[o + 2] = v;
        continue;
      }
      changed++;
      const colour = Math.abs(la - lb) <= tolerance / 2 ? DIFF_COLOURS.recoloured : la < lb ? DIFF_COLOURS.removed : DIFF_COLOURS.added;
      data[o] = colour[0];
      data[o + 1] = colour[1];
      data[o + 2] = colour[2];
    }
  }
  return { width, height, data, changed };
}
