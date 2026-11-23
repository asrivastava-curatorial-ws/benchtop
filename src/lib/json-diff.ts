/**
 * Structural JSON comparison: every added, removed and changed value with its
 * JSON Pointer path, as a readable list and as an RFC 6902 JSON Patch that
 * turns the first document into the second.
 */

export type ArrayMode = 'index' | 'lcs' | 'unordered';

export interface DiffOptions {
  /** How array items are paired: by position, by the longest common run (insertions and removals), or ignoring order. */
  readonly arrays: ArrayMode;
  /** Pair objects in arrays by this field (such as "id") when both items have it. */
  readonly matchKey?: string;
  /** Keys left out of the comparison anywhere in the document. */
  readonly ignoreKeys?: readonly string[];
  /** Numbers closer than this count as equal. */
  readonly tolerance?: number;
  readonly ignoreCase?: boolean;
}

export type Change =
  | { readonly op: 'add'; readonly path: string; readonly value: unknown }
  | { readonly op: 'remove'; readonly path: string; readonly old: unknown }
  | { readonly op: 'replace'; readonly path: string; readonly old: unknown; readonly value: unknown };

export const escapePointer = (key: string | number) => String(key).replace(/~/g, '~0').replace(/\//g, '~1');
const join = (path: string, key: string | number) => `${path}/${escapePointer(key)}`;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function deepEqual(a: unknown, b: unknown, o: DiffOptions): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b || Math.abs(a - b) <= (o.tolerance ?? 0);
  if (typeof a === 'string' && typeof b === 'string') return o.ignoreCase ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    if (o.arrays === 'unordered') {
      const used = new Set<number>();
      return a.every((x) => {
        const j = b.findIndex((y, k) => !used.has(k) && deepEqual(x, y, o));
        if (j < 0) return false;
        used.add(j);
        return true;
      });
    }
    return a.every((x, i) => deepEqual(x, b[i], o));
  }
  if (isObject(a) && isObject(b)) {
    const ignore = new Set(o.ignoreKeys ?? []);
    const ka = Object.keys(a).filter((k) => !ignore.has(k));
    const kb = Object.keys(b).filter((k) => !ignore.has(k));
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k], o));
  }
  return a === b;
}

export function diffJson(a: unknown, b: unknown, o: DiffOptions): Change[] {
  const out: Change[] = [];
  walk(a, b, '', o, out);
  return out;
}

function walk(a: unknown, b: unknown, path: string, o: DiffOptions, out: Change[]): void {
  if (deepEqual(a, b, o)) return;
  if (isObject(a) && isObject(b)) {
    const ignore = new Set(o.ignoreKeys ?? []);
    for (const k of Object.keys(a)) {
      if (ignore.has(k)) continue;
      if (!Object.hasOwn(b, k)) out.push({ op: 'remove', path: join(path, k), old: a[k] });
      else walk(a[k], b[k], join(path, k), o, out);
    }
    for (const k of Object.keys(b)) if (!ignore.has(k) && !Object.hasOwn(a, k)) out.push({ op: 'add', path: join(path, k), value: b[k] });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    diffArrays(a, b, path, o, out);
    return;
  }
  out.push({ op: 'replace', path, old: a, value: b });
}

function keyed(a: readonly unknown[], key: string | undefined): boolean {
  return !!key && a.every((x) => isObject(x) && Object.hasOwn(x, key));
}

function diffArrays(a: readonly unknown[], b: readonly unknown[], path: string, o: DiffOptions, out: Change[]): void {
  if (o.matchKey && keyed(a, o.matchKey) && keyed(b, o.matchKey)) {
    // Pair items by key; report changes at the item's position in the first array.
    const k = o.matchKey;
    const indexB = new Map(b.map((x, i) => [JSON.stringify((x as Record<string, unknown>)[k]), i]));
    const seen = new Set<number>();
    const removed: number[] = [];
    a.forEach((x, i) => {
      const j = indexB.get(JSON.stringify((x as Record<string, unknown>)[k]));
      if (j === undefined) removed.push(i);
      else {
        seen.add(j);
        walk(x, b[j], join(path, i), o, out);
      }
    });
    for (const i of removed.reverse()) out.push({ op: 'remove', path: join(path, i), old: a[i] });
    const kept = a.length - removed.length;
    let at = kept;
    b.forEach((y, j) => {
      if (!seen.has(j)) out.push({ op: 'add', path: join(path, at++), value: y });
    });
    return;
  }
  if (o.arrays === 'unordered') {
    const usedB = new Set<number>();
    const removed: number[] = [];
    a.forEach((x, i) => {
      const j = b.findIndex((y, k) => !usedB.has(k) && deepEqual(x, y, o));
      if (j < 0) removed.push(i);
      else usedB.add(j);
    });
    for (const i of removed.reverse()) out.push({ op: 'remove', path: join(path, i), old: a[i] });
    let at = a.length - removed.length;
    b.forEach((y, j) => {
      if (!usedB.has(j)) out.push({ op: 'add', path: join(path, at++), value: y });
    });
    return;
  }
  if (o.arrays === 'index') {
    const common = Math.min(a.length, b.length);
    for (let i = 0; i < common; i++) walk(a[i], b[i], join(path, i), o, out);
    for (let i = a.length - 1; i >= common; i--) out.push({ op: 'remove', path: join(path, i), old: a[i] });
    for (let i = common; i < b.length; i++) out.push({ op: 'add', path: join(path, i), value: b[i] });
    return;
  }
  // Longest common subsequence of equal items; everything else is removed or added,
  // and a removal followed by an addition at the same place is compared in depth.
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) {
    diffArrays(a, b, path, { ...o, arrays: 'index' }, out);
    return;
  }
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      (lcs[i] as number[])[j] = deepEqual(a[i], b[j], o) ? ((lcs[i + 1] as number[])[j + 1] as number) + 1 : Math.max((lcs[i + 1] as number[])[j] as number, (lcs[i] as number[])[j + 1] as number);
  type Step = { kind: 'keep' } | { kind: 'remove'; item: unknown } | { kind: 'add'; item: unknown };
  const steps: Step[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && deepEqual(a[i], b[j], o)) {
      steps.push({ kind: 'keep' });
      i++;
      j++;
    } else if (j < m && (i === n || ((lcs[i] as number[])[j + 1] as number) >= ((lcs[i + 1] as number[])[j] as number))) {
      steps.push({ kind: 'add', item: b[j++] });
    } else {
      steps.push({ kind: 'remove', item: a[i++] });
    }
  }
  // Walk the edit script against the array as it changes, so indices are valid in order.
  let at = 0;
  for (let s = 0; s < steps.length; s++) {
    const step = steps[s] as Step;
    const next = steps[s + 1];
    if (step.kind === 'keep') at++;
    else if (
      step.kind === 'remove' &&
      next?.kind === 'add' &&
      (isObject(step.item) || Array.isArray(step.item)) &&
      typeof next.item === typeof step.item &&
      Array.isArray(next.item) === Array.isArray(step.item)
    ) {
      walk(step.item, next.item, join(path, at), o, out);
      at++;
      s++;
    } else if (step.kind === 'remove') out.push({ op: 'remove', path: join(path, at), old: step.item });
    else {
      out.push({ op: 'add', path: join(path, at), value: step.item });
      at++;
    }
  }
}

/** RFC 6902 operations; applying them in order to the first document gives the second. */
export function toJsonPatch(changes: readonly Change[]): object[] {
  return changes.map((c) => (c.op === 'remove' ? { op: 'remove', path: c.path } : { op: c.op, path: c.path, value: c.value }));
}

/** Applies an RFC 6902 patch (add, remove, replace) to a copy of a document. */
export function applyPatch(doc: unknown, patch: readonly { op: string; path: string; value?: unknown }[]): unknown {
  let root = structuredClone(doc);
  for (const p of patch) {
    const keys = p.path
      .split('/')
      .slice(1)
      .map((k) => k.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (!keys.length) {
      root = p.op === 'remove' ? undefined : structuredClone(p.value);
      continue;
    }
    let parent = root as Record<string, unknown> | unknown[];
    for (const k of keys.slice(0, -1)) parent = (Array.isArray(parent) ? parent[Number(k)] : parent[k]) as Record<string, unknown> | unknown[];
    const last = keys[keys.length - 1] as string;
    if (Array.isArray(parent)) {
      const index = last === '-' ? parent.length : Number(last);
      if (p.op === 'add') parent.splice(index, 0, structuredClone(p.value));
      else if (p.op === 'remove') parent.splice(index, 1);
      else parent[index] = structuredClone(p.value);
    } else if (p.op === 'remove') delete parent[last];
    else parent[last] = structuredClone(p.value);
  }
  return root;
}

const short = (v: unknown) => {
  const s = JSON.stringify(v);
  return s === undefined ? 'undefined' : s.length > 80 ? `${s.slice(0, 77)}…` : s;
};

/** One line per change: "+ /path: value", "- /path: old", "~ /path: old → new". */
export function describeChanges(changes: readonly Change[]): string {
  return changes
    .map((c) => (c.op === 'add' ? `+ ${c.path || '/'}: ${short(c.value)}` : c.op === 'remove' ? `- ${c.path || '/'}: ${short(c.old)}` : `~ ${c.path || '/'}: ${short(c.old)} → ${short(c.value)}`))
    .join('\n');
}
