/**
 * Finding what to redact in a PDF page's text, and checking afterwards that
 * nothing is left.  Geometry is in PDF points with the origin at the top left
 * of the page as it is shown (rotation applied).
 */

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface TextItem extends Box {
  readonly text: string;
  /**
   * Where each character begins along the piece, as fractions of its width (one more entry
   * than there are characters).  Without it characters are taken to be equally wide.
   */
  readonly cuts?: readonly number[];
  /** Turned text: a match covers the whole piece, since it cannot be cut along x. */
  readonly whole?: boolean;
}

export interface Pattern {
  readonly id: string;
  readonly label: string;
  readonly regex: RegExp;
  /** A second look at a candidate (a checksum, a digit count). */
  readonly accept?: (match: string) => boolean;
}

const digitsOf = (text: string) => text.replace(/\D/g, '');

/** The Luhn check of payment card numbers. */
export function luhn(number: string): boolean {
  const digits = digitsOf(number);
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** The Verhoeff check used by Aadhaar numbers. */
export function verhoeff(number: string): boolean {
  const digits = digitsOf(number);
  let c = 0;
  for (let i = 0; i < digits.length; i++) {
    const d = Number(digits[digits.length - 1 - i]);
    c = (VERHOEFF_D[c] as number[])[(VERHOEFF_P[i % 8] as number[])[d] as number] as number;
  }
  return digits.length > 0 && c === 0;
}

export const PATTERNS: readonly Pattern[] = [
  { id: 'email', label: 'E-mail addresses', regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  {
    id: 'phone',
    label: 'Phone numbers',
    regex: /(?<!\w)(?<!\d\.)(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,5}\)[\s-]?)?\d{2,5}(?:[\s-]?\d{2,5}){1,3}(?!\w|\.\d)/g,
    // Ten or eleven digits as written in India (with the leading 0 of an STD code), more only after a + and country code.
    accept: (match) => {
      const count = digitsOf(match).length;
      return count >= 10 && count <= (match.trim().startsWith('+') ? 15 : 11);
    },
  },
  { id: 'aadhaar', label: 'Aadhaar numbers', regex: /(?<!\d)[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g, accept: verhoeff },
  { id: 'pan', label: 'PAN (Indian tax numbers)', regex: /(?<![A-Za-z0-9])[A-Z]{5}\d{4}[A-Z](?![A-Za-z0-9])/g },
  { id: 'card', label: 'Payment card numbers', regex: /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g, accept: luhn },
  { id: 'ip', label: 'IP addresses', regex: /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\d.])/g },
];

export type Query =
  | { readonly kind: 'text'; readonly text: string; readonly caseSensitive?: boolean; readonly wholeWord?: boolean }
  | { readonly kind: 'pattern'; readonly id: string }
  | { readonly kind: 'regex'; readonly source: string; readonly caseSensitive?: boolean };

export interface Match {
  /** What was looked for: the typed words, or the pattern's name. */
  readonly label: string;
  readonly text: string;
  readonly boxes: Box[];
}

export interface Joined {
  readonly text: string;
  /** For every character of `text`, the item it came from (or -1 for a gap) and its place in it. */
  readonly item: Int32Array;
  readonly at: Int32Array;
}

/** A page's items as one string, with a space where two items are apart or on different lines. */
export function joinItems(items: readonly TextItem[]): Joined {
  let text = '';
  const item: number[] = [];
  const at: number[] = [];
  let previous: TextItem | null = null;
  items.forEach((current, index) => {
    if (!current.text) return;
    if (previous) {
      const sameLine = Math.abs(current.y + current.h / 2 - (previous.y + previous.h / 2)) < Math.max(previous.h, current.h) * 0.5;
      const gap = current.x - (previous.x + previous.w);
      const apart = !sameLine || gap > Math.max(previous.h, current.h) * 0.25 || gap < -Math.max(previous.h, current.h);
      if (apart && !text.endsWith(' ') && !current.text.startsWith(' ')) {
        text += ' ';
        item.push(-1);
        at.push(0);
      }
    }
    for (let i = 0; i < current.text.length; i++) {
      item.push(index);
      at.push(i);
    }
    text += current.text;
    previous = current;
  });
  return { text, item: Int32Array.from(item), at: Int32Array.from(at) };
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The regular expression of one query, or null when there is nothing to find. */
export function queryRegex(query: Query): { regex: RegExp; label: string; accept?: (match: string) => boolean } | null {
  if (query.kind === 'pattern') {
    const pattern = PATTERNS.find((p) => p.id === query.id);
    return pattern ? { regex: new RegExp(pattern.regex.source, 'g'), label: pattern.label, accept: pattern.accept } : null;
  }
  if (query.kind === 'regex') {
    if (!query.source) return null;
    try {
      return { regex: new RegExp(query.source, query.caseSensitive ? 'gu' : 'giu'), label: `/${query.source}/` };
    } catch {
      return null;
    }
  }
  const words = query.text.trim();
  if (!words) return null;
  // Any run of white space matches any other: PDFs break lines and spaces freely.
  let source = words.split(/\s+/).map(escapeRegex).join('\\s+');
  if (query.wholeWord) source = `(?<![\\p{L}\\p{N}])${source}(?![\\p{L}\\p{N}])`;
  return { regex: new RegExp(source, query.caseSensitive ? 'gu' : 'giu'), label: words };
}

/** The boxes covering characters `start` to `end` of a page's joined text: one box per item the range runs through. */
export function rangeBoxes(items: readonly TextItem[], joined: Joined, start: number, end: number, pad = 1.5): Box[] {
  const spans = new Map<number, [number, number]>();
  for (let i = start; i < end; i++) {
    const index = joined.item[i] as number;
    if (index < 0) continue;
    const place = joined.at[i] as number;
    const span = spans.get(index);
    if (span) span[1] = place + 1;
    else spans.set(index, [place, place + 1]);
  }
  const boxes: Box[] = [];
  for (const [index, [from, to]] of spans) {
    const source = items[index] as TextItem;
    const length = Math.max(1, source.text.length);
    const cut = (place: number) => (source.whole ? (place === from ? 0 : 1) : (source.cuts?.[place] ?? place / length));
    // Sideways a little more than up and down: character widths are measured, not exact.
    const side = pad > 0 ? pad + source.h * 0.12 : 0;
    boxes.push({ x: source.x + source.w * cut(from) - side, y: source.y - pad, w: source.w * (cut(to) - cut(from)) + side * 2, h: source.h + pad * 2 });
  }
  return boxes;
}

/** Everything on a page that the queries match, with the boxes that cover each match. */
export function findMatches(items: readonly TextItem[], queries: readonly Query[], pad = 1.5): Match[] {
  const joined = joinItems(items);
  const matches: Match[] = [];
  for (const query of queries) {
    const built = queryRegex(query);
    if (!built) continue;
    for (const found of joined.text.matchAll(built.regex)) {
      const text = found[0];
      if (!text.trim() || (built.accept && !built.accept(text))) continue;
      const boxes = rangeBoxes(items, joined, found.index, found.index + text.length, pad);
      if (boxes.length) matches.push({ label: built.label, text, boxes });
    }
  }
  return matches;
}

export const intersects = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** How much of `inner` lies inside `outer`, from 0 to 1. */
export function overlap(inner: Box, outer: Box): number {
  const w = Math.min(inner.x + inner.w, outer.x + outer.w) - Math.max(inner.x, outer.x);
  const h = Math.min(inner.y + inner.h, outer.y + outer.h) - Math.max(inner.y, outer.y);
  const area = inner.w * inner.h;
  return w > 0 && h > 0 && area > 0 ? (w * h) / area : 0;
}

/** Text that still lies under redaction boxes (there should be none after redacting). */
export function textUnder(items: readonly TextItem[], boxes: readonly Box[]): TextItem[] {
  return items.filter((item) => item.text.trim() !== '' && boxes.some((box) => overlap(item, box) > 0.35));
}

/** A box given by two corners, in any order, kept inside the page. */
export function boxFrom(ax: number, ay: number, bx: number, by: number, width: number, height: number): Box {
  const x = Math.max(0, Math.min(ax, bx));
  const y = Math.max(0, Math.min(ay, by));
  return { x, y, w: Math.min(width, Math.max(ax, bx)) - x, h: Math.min(height, Math.max(ay, by)) - y };
}

export interface Check {
  readonly id: string;
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
}

/** Whether any of the typed words occur in loose text (metadata, comments), ignoring case. */
export function mentions(text: string, queries: readonly Query[]): string[] {
  const found: string[] = [];
  for (const query of queries) {
    const built = queryRegex(query);
    if (!built) continue;
    for (const match of text.matchAll(built.regex)) {
      if (match[0].trim() && (!built.accept || built.accept(match[0]))) {
        found.push(built.label);
        break;
      }
    }
  }
  return found;
}

/** Looks for a typed word in a file's raw bytes, as plain and as UTF-16 text (uncompressed strings). */
export function bytesMention(bytes: Uint8Array, word: string): boolean {
  if (word.length < 4) return false;
  const lower = word.toLowerCase();
  const upper = word.toUpperCase();
  const scan = (wide: boolean) => {
    const step = wide ? 2 : 1;
    const limit = bytes.length - word.length * step;
    outer: for (let i = 0; i <= limit; i++) {
      for (let j = 0; j < word.length; j++) {
        const at = i + j * step;
        if (wide && bytes[at] !== 0) continue outer;
        const byte = bytes[wide ? at + 1 : at];
        if (byte !== lower.charCodeAt(j) && byte !== upper.charCodeAt(j)) continue outer;
      }
      return true;
    }
    return false;
  };
  return /^[\x20-\x7e]+$/.test(word) && (scan(false) || scan(true));
}
