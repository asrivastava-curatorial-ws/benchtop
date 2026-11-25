/**
 * The page's side of Offline Search: showing marked text, grouping matches by
 * file, and searching the notes (which live in the page's own storage, so they
 * are searched here and never copied into the index on disk).
 */

/** Markers the index puts around each match (control characters never occur in indexed text). */
export const OPEN = '\u0001';
export const CLOSE = '\u0002';

export interface Segment {
  readonly text: string;
  readonly hit: boolean;
}

/** Marked text as plain pieces, so a match is shown with an element and never as HTML. */
export function splitMarked(marked: string): Segment[] {
  const out: Segment[] = [];
  let hit = false;
  let piece = '';
  for (const char of marked) {
    if (char === OPEN || char === CLOSE) {
      if (piece) out.push({ text: piece, hit });
      piece = '';
      hit = char === OPEN;
    } else piece += char;
  }
  if (piece) out.push({ text: piece, hit });
  return out;
}

export const KIND_LABELS: Readonly<Record<string, string>> = {
  text: 'Text',
  code: 'Code',
  document: 'Document',
  spreadsheet: 'Spreadsheet',
  presentation: 'Presentation',
  pdf: 'PDF',
  picture: 'Picture',
  book: 'Book',
  other: 'File',
  note: 'Note',
};

export const KIND_FILTERS: readonly { readonly id: string; readonly label: string }[] = [
  { id: '', label: 'Everything' },
  { id: 'document', label: 'Documents' },
  { id: 'spreadsheet', label: 'Spreadsheets' },
  { id: 'presentation', label: 'Presentations' },
  { id: 'pdf', label: 'PDFs' },
  { id: 'text', label: 'Text' },
  { id: 'code', label: 'Code' },
  { id: 'picture', label: 'Pictures' },
  { id: 'note', label: 'Notes' },
];

export interface Group<T> {
  readonly file: number;
  readonly first: T;
  readonly places: T[];
}

/** Matches grouped by file, files in the order of their best match. */
export function groupHits<T extends { readonly file: number }>(hits: readonly T[]): Group<T>[] {
  const groups = new Map<number, Group<T>>();
  for (const hit of hits) {
    const group = groups.get(hit.file);
    if (group) group.places.push(hit);
    else groups.set(hit.file, { file: hit.file, first: hit, places: [hit] });
  }
  return [...groups.values()];
}

/** Lower case, and Latin letters without their accents; every character stays one character. */
export function fold(text: string): string {
  const lower = text.toLowerCase();
  const base = lower.length === text.length ? lower : text;
  let out = '';
  for (let i = 0; i < base.length; i++) {
    const code = base.charCodeAt(i);
    out += (code >= 0xc0 && code <= 0x24f) || (code >= 0x1e00 && code <= 0x1eff) ? ((base[i] as string).normalize('NFD')[0] ?? base[i]) : base[i];
  }
  return out;
}

export interface Terms {
  /** Each entry is a set of alternatives (joined by OR); one of them must be found. */
  readonly must: string[][];
  readonly not: string[];
  /** The query has a filter that only applies to files (ext:, path:, type:). */
  readonly filesOnly: boolean;
}

/** The same query language as the index, as far as it applies to notes. */
export function parseTerms(query: string): Terms {
  const must: string[][] = [];
  const not: string[] = [];
  let filesOnly = false;
  let either = false;
  for (const match of query.matchAll(/(-?)(?:"([^"]*)"?|(\S+))/g)) {
    const minus = match[1] === '-';
    const quoted = match[2] !== undefined;
    let word = quoted ? (match[2] as string) : (match[3] as string);
    if (!quoted && !minus && word === 'OR') {
      either = must.length > 0;
      continue;
    }
    if (!quoted) {
      const filter = /^(ext|type|kind|path|folder|name|file):(.*)$/i.exec(word);
      if (filter) {
        const key = (filter[1] as string).toLowerCase();
        if (key === 'name' || key === 'file') word = filter[2] as string;
        else {
          filesOnly = true;
          continue;
        }
      }
      word = word.replace(/\*+$/, '');
    }
    const term = fold(word).trim();
    if (!/[\p{L}\p{N}]/u.test(term)) continue;
    if (minus) not.push(term);
    else if (either && must.length) {
      (must[must.length - 1] as string[]).push(term);
      either = false;
    } else must.push([term]);
  }
  return { must, not, filesOnly };
}

const wordChar = /[\p{L}\p{N}\p{M}]/u;

/** Where `term` begins a word in `text` (both folded), or -1. */
export function findWord(text: string, term: string, from = 0): number {
  for (let at = text.indexOf(term, from); at !== -1; at = text.indexOf(term, at + 1)) {
    if (at === 0 || !wordChar.test(text[at - 1] as string)) return at;
  }
  return -1;
}

export interface NoteLike {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly modified: string;
}

export interface NoteHit {
  readonly id: string;
  readonly title: string;
  /** A piece of the note around the first match, with match markers. */
  readonly snippet: string;
  readonly modified: string;
}

/** Notes that hold every word of the query, newest first; titles count too. */
export function searchNotes(notes: readonly NoteLike[], query: string): NoteHit[] {
  const terms = parseTerms(query);
  if (!terms.must.length || terms.filesOnly) return [];
  const hits: NoteHit[] = [];
  for (const note of notes) {
    const body = `${note.title}\n${note.text}`;
    const folded = fold(body);
    if (terms.not.some((term) => findWord(folded, term) !== -1)) continue;
    const found = terms.must.map((choices) => choices.map((term) => ({ term, at: findWord(folded, term) })).find((m) => m.at !== -1));
    if (found.some((m) => !m)) continue;
    // The snippet: the line of the first match outside the title when there is one.
    const all = terms.must.flat();
    const marks: [number, number][] = [];
    for (const term of all) for (let at = findWord(folded, term); at !== -1; at = findWord(folded, term, at + 1)) marks.push([at, at + term.length]);
    marks.sort((a, b) => a[0] - b[0]);
    const inText = marks.find(([at]) => at > note.title.length) ?? marks[0];
    const first = inText ? inText[0] : 0;
    const lineStart = Math.max(folded.lastIndexOf('\n', first - 1) + 1, first - 60);
    const end = Math.min(body.length, first + 160);
    let snippet = lineStart > 0 && folded[lineStart - 1] !== '\n' ? '…' : '';
    let at = lineStart;
    for (const [from, to] of marks) {
      if (from < at || from >= end) continue;
      snippet += `${body.slice(at, from)}${OPEN}${body.slice(from, Math.min(to, end))}${CLOSE}`;
      at = Math.min(to, end);
    }
    snippet += body.slice(at, end);
    if (end < body.length) snippet += '…';
    hits.push({ id: note.id, title: note.title, snippet: snippet.replace(/\s+/g, ' ').trim(), modified: note.modified });
  }
  return hits.sort((a, b) => b.modified.localeCompare(a.modified));
}

/** “3 Nov 2026” for a time in seconds since 1970. */
export function shortDate(seconds: number): string {
  return seconds > 0 ? new Date(seconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

/** Where a match is in its file: “Page 3”, “line 120”, “Slide 2”. */
export function placeLabel(hit: { readonly label: string; readonly line: number }): string {
  if (hit.line > 0) return hit.label ? `${hit.label}, line ${hit.line.toLocaleString()}` : `Line ${hit.line.toLocaleString()}`;
  return hit.label;
}
