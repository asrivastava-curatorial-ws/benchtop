/**
 * Pitman's shorthand (New Era theory) drawn as SVG from English sounds.
 *
 * Consonants are strokes, light or heavy for voiceless and voiced pairs:
 * straight lines for the plosives, quarter circles for the continuants,
 * horizontal curves for the nasals.  Vowels are light or heavy dots and dashes
 * in three places beside the strokes, diphthongs small angles and an arch.
 * The outline sits above, on or through the line according to its first
 * vowel.  Short forms, phrasing and most hooks are not used: this writes
 * outlines the way they are first taught.
 */
import { isVowel } from './cmudict';

export type Consonant = 'P' | 'B' | 'T' | 'D' | 'CH' | 'J' | 'K' | 'G' | 'F' | 'V' | 'TH' | 'DH' | 'S' | 'Z' | 'SH' | 'ZH' | 'M' | 'N' | 'NG' | 'L' | 'R' | 'W' | 'Y' | 'H';
export type VowelName = 'a' | 'ah' | 'e' | 'ay' | 'i' | 'ee' | 'o' | 'aw' | 'u' | 'oh' | 'uu' | 'oo' | 'I' | 'OI' | 'OW' | 'EW';
export type Place = 1 | 2 | 3;

export interface VowelSign {
  readonly name: VowelName;
  readonly shape: 'dot' | 'dash' | 'I' | 'OI' | 'OW' | 'EW';
  readonly heavy: boolean;
  readonly place: Place;
}

/** Dots: a ah (1st), e ay (2nd), i ee (3rd). Dashes: o aw (1st), u oh (2nd), oo (3rd). Long vowels heavy. */
export const VOWEL_SIGNS: Record<VowelName, VowelSign> = {
  a: { name: 'a', shape: 'dot', heavy: false, place: 1 },
  ah: { name: 'ah', shape: 'dot', heavy: true, place: 1 },
  e: { name: 'e', shape: 'dot', heavy: false, place: 2 },
  ay: { name: 'ay', shape: 'dot', heavy: true, place: 2 },
  i: { name: 'i', shape: 'dot', heavy: false, place: 3 },
  ee: { name: 'ee', shape: 'dot', heavy: true, place: 3 },
  o: { name: 'o', shape: 'dash', heavy: false, place: 1 },
  aw: { name: 'aw', shape: 'dash', heavy: true, place: 1 },
  u: { name: 'u', shape: 'dash', heavy: false, place: 2 },
  oh: { name: 'oh', shape: 'dash', heavy: true, place: 2 },
  uu: { name: 'uu', shape: 'dash', heavy: false, place: 3 },
  oo: { name: 'oo', shape: 'dash', heavy: true, place: 3 },
  I: { name: 'I', shape: 'I', heavy: false, place: 1 },
  OI: { name: 'OI', shape: 'OI', heavy: false, place: 1 },
  OW: { name: 'OW', shape: 'OW', heavy: false, place: 3 },
  EW: { name: 'EW', shape: 'EW', heavy: false, place: 3 },
};

export const VOWEL_EXAMPLES: Record<VowelName, string> = {
  a: 'at',
  ah: 'father',
  e: 'pen',
  ay: 'day',
  i: 'it',
  ee: 'see',
  o: 'not',
  aw: 'law',
  u: 'cup',
  oh: 'go',
  uu: 'book',
  oo: 'too',
  I: 'my',
  OI: 'boy',
  OW: 'now',
  EW: 'few',
};

const HEAVY = new Set<Consonant>(['B', 'D', 'J', 'G', 'V', 'DH', 'Z', 'ZH', 'NG']);

export type Unit = { readonly kind: 'C'; readonly c: Consonant } | { readonly kind: 'V'; readonly v: VowelName };

const CONSONANTS: Record<string, Consonant> = {
  P: 'P',
  B: 'B',
  T: 'T',
  D: 'D',
  CH: 'CH',
  JH: 'J',
  K: 'K',
  G: 'G',
  F: 'F',
  V: 'V',
  TH: 'TH',
  DH: 'DH',
  S: 'S',
  Z: 'Z',
  SH: 'SH',
  ZH: 'ZH',
  M: 'M',
  N: 'N',
  NG: 'NG',
  L: 'L',
  R: 'R',
  W: 'W',
  Y: 'Y',
  HH: 'H',
};

/**
 * ARPAbet (American) to Pitman's sounds (British teaching).  "father" and
 * "lot" share AA in the dictionary; AA before R or at the end of a word is
 * taken as ah, otherwise as short o.  Y before UW becomes the diphthong ew.
 */
export function unitsFromPhones(phones: readonly string[]): Unit[] {
  const out: Unit[] = [];
  for (let k = 0; k < phones.length; k++) {
    const raw = phones[k] as string;
    const base = raw.replace(/\d$/, '');
    const stress = raw.endsWith('0') ? 0 : 1;
    const next = phones[k + 1]?.replace(/\d$/, '');
    if (base === 'Y' && next === 'UW') {
      out.push({ kind: 'V', v: 'EW' });
      k++;
      continue;
    }
    if (!isVowel(raw)) {
      const c = CONSONANTS[base];
      if (c) out.push({ kind: 'C', c });
      continue;
    }
    switch (base) {
      case 'AA':
        out.push({ kind: 'V', v: next === 'R' || next === undefined ? 'ah' : 'o' });
        break;
      case 'AE':
        out.push({ kind: 'V', v: 'a' });
        break;
      case 'AH':
        out.push({ kind: 'V', v: stress ? 'u' : 'e' });
        break;
      case 'AO':
        out.push({ kind: 'V', v: 'aw' });
        break;
      case 'AW':
        out.push({ kind: 'V', v: 'OW' });
        break;
      case 'AY':
        out.push({ kind: 'V', v: 'I' });
        break;
      case 'EH':
        out.push({ kind: 'V', v: 'e' });
        break;
      case 'ER':
        out.push({ kind: 'V', v: stress ? 'u' : 'e' }, { kind: 'C', c: 'R' });
        break;
      case 'EY':
        out.push({ kind: 'V', v: 'ay' });
        break;
      case 'IH':
        out.push({ kind: 'V', v: 'i' });
        break;
      case 'IY':
        out.push({ kind: 'V', v: 'ee' });
        break;
      case 'OW':
        out.push({ kind: 'V', v: 'oh' });
        break;
      case 'OY':
        out.push({ kind: 'V', v: 'OI' });
        break;
      case 'UH':
        out.push({ kind: 'V', v: 'uu' });
        break;
      case 'UW':
        out.push({ kind: 'V', v: 'oo' });
        break;
    }
  }
  return out;
}

/* --------------------------------------------------------------- geometry -- */

type Pt = { x: number; y: number };
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const norm = (a: Pt): Pt => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};
const R30 = Math.sin(Math.PI / 6);
const C30 = Math.cos(Math.PI / 6);
const D45 = Math.SQRT1_2;

/** A stroke's form: a straight line along `chord`, or a quarter circle bulging towards `bulge`. Unit length. */
interface Form {
  readonly chord: Pt;
  readonly bulge: Pt | null;
  /** Small mark at the start: the hook of Way and Yay, the circle of Hay. */
  readonly lead?: 'hook-left' | 'hook-right' | 'circle';
}

/**
 * Directions on the page (y grows downwards).  Straight: P \ , T | , CH / ,
 * K — , Ray / upwards.  Curves: F and V bulge down-left, Ar up-right, Ith (
 * Ess ) , Ish up-left, El down-right, Em down, En and Ing up.
 */
function formOf(c: Consonant, variant: { up?: boolean }): Form {
  switch (c) {
    case 'P':
    case 'B':
      return { chord: { x: R30, y: C30 }, bulge: null };
    case 'T':
    case 'D':
      return { chord: { x: 0, y: 1 }, bulge: null };
    case 'CH':
    case 'J':
      return { chord: { x: -R30, y: C30 }, bulge: null };
    case 'K':
    case 'G':
      return { chord: { x: 1, y: 0 }, bulge: null };
    case 'F':
    case 'V':
      return { chord: { x: D45, y: D45 }, bulge: { x: -D45, y: D45 } };
    case 'TH':
    case 'DH':
      return { chord: { x: 0, y: 1 }, bulge: { x: -1, y: 0 } };
    case 'S':
    case 'Z':
      return { chord: { x: 0, y: 1 }, bulge: { x: 1, y: 0 } };
    case 'SH':
    case 'ZH':
      return { chord: { x: -D45, y: D45 }, bulge: { x: -D45, y: -D45 } };
    case 'M':
      return { chord: { x: 1, y: 0 }, bulge: { x: 0, y: 1 } };
    case 'N':
    case 'NG':
      return { chord: { x: 1, y: 0 }, bulge: { x: 0, y: -1 } };
    case 'L':
      // Upward Lay is the usual form; downward El continues a preceding En or Ing.
      return variant.up === false ? { chord: { x: -D45, y: D45 }, bulge: { x: D45, y: D45 } } : { chord: { x: D45, y: -D45 }, bulge: { x: D45, y: D45 } };
    case 'R':
      // Ray: straight upstroke at 30° from the horizontal; Ar: the top right quarter of a circle, written down.
      return variant.up === false ? { chord: { x: D45, y: D45 }, bulge: { x: D45, y: -D45 } } : { chord: { x: C30, y: -R30 }, bulge: null };
    case 'W':
      return { chord: { x: C30, y: -R30 }, bulge: null, lead: 'hook-left' };
    case 'Y':
      return { chord: { x: C30, y: -R30 }, bulge: null, lead: 'hook-right' };
    case 'H':
      return { chord: { x: C30, y: -R30 }, bulge: null, lead: 'circle' };
  }
}

/** Centreline points of a form, from `start`, `length` long. */
function centreline(form: Form, start: Pt, length: number, samples = 18): Pt[] {
  const end = add(start, scale(form.chord, length));
  if (!form.bulge) return [start, end];
  // A quarter circle on the chord: radius chord/√2, centre on the far side from the bulge.
  const r = length / Math.SQRT2;
  const mid = scale(add(start, end), 0.5);
  const centre = add(mid, scale(form.bulge, -length / 2));
  const a0 = Math.atan2(start.y - centre.y, start.x - centre.x);
  let a1 = Math.atan2(end.y - centre.y, end.x - centre.x);
  // Go the short way round (90°), which passes the bulge.
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  a1 = a0 + delta;
  return Array.from({ length: samples + 1 }, (_, k) => {
    const a = a0 + ((a1 - a0) * k) / samples;
    return { x: centre.x + r * Math.cos(a), y: centre.y + r * Math.sin(a) };
  });
}

/** A filled outline of a centreline with a width that may taper (thick curves). */
function ribbon(points: readonly Pt[], width: (t: number) => number): string {
  if (points.length < 2) return '';
  const left: Pt[] = [];
  const right: Pt[] = [];
  const n = points.length;
  for (let k = 0; k < n; k++) {
    const p = points[k] as Pt;
    const prev = points[Math.max(0, k - 1)] as Pt;
    const next = points[Math.min(n - 1, k + 1)] as Pt;
    const d = norm({ x: next.x - prev.x, y: next.y - prev.y });
    const w = width(k / (n - 1)) / 2;
    left.push({ x: p.x - d.y * w, y: p.y + d.x * w });
    right.push({ x: p.x + d.y * w, y: p.y - d.x * w });
  }
  const pts = [...left, ...right.reverse()];
  return `M${pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('L')}Z`;
}

const pathOf = (points: readonly Pt[]) => `M${points.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('L')}`;

/* ---------------------------------------------------------------- outline -- */

export interface OutlineOptions {
  /** Pixels per stroke (about 5 mm on paper). */
  readonly unit: number;
  readonly vowels: boolean;
  readonly circleS: boolean;
  readonly ingDot: boolean;
}

export interface Outline {
  /** SVG elements, drawn from an origin where y = 0 is the ruled line. */
  readonly svg: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly position: Place;
  /** Stroke names in order, for the reading aid. */
  readonly spelling: string;
}

const STROKE_NAMES: Record<Consonant, string> = {
  P: 'Pee',
  B: 'Bee',
  T: 'Tee',
  D: 'Dee',
  CH: 'Chay',
  J: 'Jay',
  K: 'Kay',
  G: 'Gay',
  F: 'Eff',
  V: 'Vee',
  TH: 'Ith',
  DH: 'Thee',
  S: 'Ess',
  Z: 'Zee',
  SH: 'Ish',
  ZH: 'Zhee',
  M: 'Em',
  N: 'En',
  NG: 'Ing',
  L: 'Lay',
  R: 'Ray',
  W: 'Way',
  Y: 'Yay',
  H: 'Hay',
};

interface Placed {
  readonly c: Consonant;
  readonly form: Form;
  readonly points: Pt[];
  readonly start: Pt;
  readonly end: Pt;
  readonly name: string;
}

interface Attached {
  readonly v: VowelSign;
  readonly stroke: number;
  readonly side: 'before' | 'after';
  /** Index among vowels on the same stroke and side, to keep them apart. */
  readonly order: number;
}

/** The side of a stroke on which preceding vowels go: left of down and upstrokes, above horizontals. */
function beforeNormal(chord: Pt): Pt {
  const a = { x: -chord.y, y: chord.x };
  const b = { x: chord.y, y: -chord.x };
  if (Math.abs(a.x) < 0.2) return a.y < 0 ? a : b;
  return a.x < 0 ? a : b;
}

/** Point and tangent at fraction t along a polyline. */
function along(points: readonly Pt[], t: number): { p: Pt; d: Pt } {
  if (points.length === 2) {
    const [a, b] = points as [Pt, Pt];
    return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, d: norm({ x: b.x - a.x, y: b.y - a.y }) };
  }
  const k = Math.min(points.length - 2, Math.floor(t * (points.length - 1)));
  const f = t * (points.length - 1) - k;
  const a = points[k] as Pt;
  const b = points[k + 1] as Pt;
  return { p: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, d: norm({ x: b.x - a.x, y: b.y - a.y }) };
}

export function buildOutline(units: readonly Unit[], o: OutlineOptions): Outline {
  const u = o.unit;
  const light = Math.max(1, u * 0.065);
  const heavy = Math.max(2.2, u * 0.17);
  let items = [...units];

  // -ing at the end of a longer word is a light dot after the outline.
  let ing = false;
  const last2 = items.slice(-2);
  if (o.ingDot && last2.length === 2 && last2[0]?.kind === 'V' && last2[0].v === 'i' && last2[1]?.kind === 'C' && last2[1].c === 'NG' && items.filter((x) => x.kind === 'C').length > 1) {
    items = items.slice(0, -2);
    ing = true;
  }

  // Circle S: a small circle instead of the stroke at the start or end of a word, when no vowel is next to it.
  let circleStart = false;
  let circleEnd = false;
  const consonantCount = () => items.filter((x) => x.kind === 'C').length;
  if (o.circleS && consonantCount() > 1) {
    // The stroke is kept when a vowel comes before an initial S or after a final S.
    const first = items[0];
    if (first?.kind === 'C' && (first.c === 'S' || first.c === 'Z')) {
      items = items.slice(1);
      circleStart = true;
    }
    const last = items[items.length - 1];
    if (last?.kind === 'C' && (last.c === 'S' || last.c === 'Z') && consonantCount() > 1) {
      items = items.slice(0, -1);
      circleEnd = true;
    }
  }

  const consonants = items.flatMap((x, i) => (x.kind === 'C' ? [{ c: x.c, i }] : []));
  // Choose upward or downward forms of R and L.
  const placed: Placed[] = [];
  let pen: Pt = { x: 0, y: 0 };
  consonants.forEach(({ c, i }, k) => {
    const vowelBefore = items[i - 1]?.kind === 'V';
    const vowelAfter = items[i + 1]?.kind === 'V';
    let up: boolean | undefined;
    let name = STROKE_NAMES[c];
    if (c === 'R') {
      const firstStroke = k === 0;
      const lastStroke = k === consonants.length - 1;
      // Ar when a vowel comes before an initial R, or when R ends the word; Ray otherwise.
      up = !((firstStroke && vowelBefore) || (lastStroke && !vowelAfter) || consonants[k + 1]?.c === 'M');
      name = up ? 'Ray' : 'Ar';
    }
    if (c === 'L') {
      const prev = consonants[k - 1]?.c;
      up = !(prev === 'N' || prev === 'NG');
      name = up ? 'Lay' : 'El';
    }
    const form = formOf(c, { up });
    const points = centreline(form, pen, u);
    const end = points[points.length - 1] as Pt;
    placed.push({ c, form, points, start: pen, end, name });
    pen = end;
  });

  // Attach vowels: before the first stroke, after the last, and between strokes after the
  // first one for first and second place vowels, before the second for third place.
  const attached: Attached[] = [];
  const count = new Map<string, number>();
  const attach = (v: VowelSign, stroke: number, side: 'before' | 'after') => {
    const key = `${stroke}-${side}-${v.place}`;
    const order = count.get(key) ?? 0;
    count.set(key, order + 1);
    attached.push({ v, stroke, side, order });
  };
  let consonantIndex = -1;
  for (const item of items) {
    if (item.kind === 'C') {
      consonantIndex++;
      continue;
    }
    const v = VOWEL_SIGNS[item.v];
    if (!placed.length) continue;
    if (consonantIndex < 0) attach(v, 0, 'before');
    else if (consonantIndex >= placed.length - 1) attach(v, placed.length - 1, 'after');
    else if (v.place === 3) attach(v, consonantIndex + 1, 'before');
    else attach(v, consonantIndex, 'after');
  }

  // Position on the line from the first vowel heard.
  const firstVowel = units.find((x): x is Extract<Unit, { kind: 'V' }> => x.kind === 'V');
  const position: Place = firstVowel ? VOWEL_SIGNS[firstVowel.v].place : 2;

  // Find the first stroke that is not horizontal; it rests on, sits above or cuts through the line.
  const vertical = placed.find((p) => Math.abs(p.form.chord.y) > 0.3);
  let dy: number;
  if (vertical) {
    const bottom = Math.max(...vertical.points.map((p) => p.y));
    const top = Math.min(...vertical.points.map((p) => p.y));
    const height = bottom - top;
    dy = -bottom + (position === 1 ? -0.5 * height : position === 3 ? 0.5 * height : 0);
  } else {
    const lowest = placed.length ? Math.max(...placed.flatMap((p) => p.points.map((q) => q.y))) : 0;
    dy = -lowest - u * 0.08 + (position === 1 ? -0.5 * u : 0);
  }
  const shift = (p: Pt): Pt => ({ x: p.x, y: p.y + dy });

  const parts: string[] = [];
  const all: Pt[] = [];
  for (const s of placed) {
    const pts = s.points.map(shift);
    all.push(...pts);
    const isHeavy = HEAVY.has(s.c);
    const curved = !!s.form.bulge;
    const width = (t: number) => (isHeavy ? (curved ? light + (heavy - light) * Math.sin(Math.PI * t) : heavy) : light);
    parts.push(`<path d="${ribbon(pts.length === 2 ? interpolate(pts[0] as Pt, pts[1] as Pt) : pts, width)}" stroke="none"/>`);
    if (s.form.lead) {
      const start = pts[0] as Pt;
      const d = s.form.chord;
      const n = beforeNormal(d);
      const r = u * 0.11;
      if (s.form.lead === 'circle') {
        const c = add(start, scale(n, -r));
        parts.push(`<circle cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${r.toFixed(2)}" fill="none" stroke-width="${light.toFixed(2)}"/>`);
        all.push(add(c, { x: -r, y: -r }), add(c, { x: r, y: r }));
      } else {
        const side = s.form.lead === 'hook-left' ? n : scale(n, -1);
        const tip = add(start, scale(side, r * 2));
        const ctrl = add(add(start, scale(side, r * 2.2)), scale(d, -r * 1.6));
        parts.push(
          `<path d="M${tip.x.toFixed(2)} ${tip.y.toFixed(2)}Q${ctrl.x.toFixed(2)} ${ctrl.y.toFixed(2)} ${start.x.toFixed(2)} ${start.y.toFixed(2)}" fill="none" stroke-width="${light.toFixed(2)}" stroke-linecap="round"/>`,
        );
        all.push(tip, ctrl);
      }
    }
  }

  // Circle S: inside a curve, on the right of straight downstrokes, below horizontals.
  const circle = (s: Placed, atStart: boolean) => {
    const pts = s.points.map(shift);
    const anchor = (atStart ? pts[0] : pts[pts.length - 1]) as Pt;
    const r = u * 0.12;
    const inward = s.form.bulge ? scale(s.form.bulge, -1) : scale(beforeNormal(s.form.chord), -1);
    const c = add(anchor, scale(inward, r));
    parts.push(`<circle cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${r.toFixed(2)}" fill="none" stroke-width="${light.toFixed(2)}"/>`);
    all.push(add(c, { x: -r, y: -r }), add(c, { x: r, y: r }));
  };
  if (circleStart && placed[0]) circle(placed[0], true);
  if (circleEnd && placed[placed.length - 1]) circle(placed[placed.length - 1] as Placed, false);

  if (o.vowels) {
    for (const a of attached) {
      const s = placed[a.stroke] as Placed;
      const pts = s.points.map(shift);
      const t = a.v.place === 1 ? 0.12 : a.v.place === 2 ? 0.5 : 0.88;
      const { p, d } = along(pts, t);
      const before = beforeNormal(s.form.chord);
      const side = a.side === 'before' ? before : scale(before, -1);
      const gap = u * (0.26 + a.order * 0.22);
      const at = add(p, scale(side, gap));
      parts.push(vowelMark(a.v, at, d, u, light, heavy));
      all.push(add(at, { x: -u * 0.15, y: -u * 0.15 }), add(at, { x: u * 0.15, y: u * 0.15 }));
    }
  }

  if (!placed.length) {
    // A word of vowels only: the signs on their own, in position.
    const vowels = units.filter((x): x is Extract<Unit, { kind: 'V' }> => x.kind === 'V');
    vowels.forEach((x, k) => {
      const v = VOWEL_SIGNS[x.v];
      const at = { x: k * u * 0.35, y: v.place === 1 ? -u * 0.9 : v.place === 2 ? -u * 0.5 : -u * 0.1 };
      parts.push(vowelMark(v, at, { x: 0, y: 1 }, u, light, heavy));
      all.push(add(at, { x: -u * 0.15, y: -u * 0.15 }), add(at, { x: u * 0.15, y: u * 0.15 }));
    });
  }

  if (ing && placed.length) {
    const last = placed[placed.length - 1] as Placed;
    const end = shift(last.end);
    const at = add(end, scale(norm(last.form.chord), u * 0.28));
    parts.push(`<circle cx="${at.x.toFixed(2)}" cy="${at.y.toFixed(2)}" r="${(light * 1.1).toFixed(2)}" stroke="none"/>`);
    all.push(at);
  }

  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const spelling = [circleStart ? 'circle S' : '', ...placed.map((s) => s.name), circleEnd ? 'circle S' : '', ing ? 'ing dot' : ''].filter(Boolean).join(' · ');
  return {
    svg: parts.join(''),
    minX: xs.length ? Math.min(...xs) : 0,
    maxX: xs.length ? Math.max(...xs) : u * 0.3,
    minY: ys.length ? Math.min(...ys) : -u,
    maxY: ys.length ? Math.max(...ys) : 0,
    position,
    spelling,
  };
}

function interpolate(a: Pt, b: Pt): Pt[] {
  return Array.from({ length: 6 }, (_, k) => ({ x: a.x + ((b.x - a.x) * k) / 5, y: a.y + ((b.y - a.y) * k) / 5 }));
}

function vowelMark(v: VowelSign, at: Pt, along: Pt, u: number, light: number, heavy: number): string {
  const f = (n: number) => n.toFixed(2);
  if (v.shape === 'dot') return `<circle cx="${f(at.x)}" cy="${f(at.y)}" r="${f(v.heavy ? heavy * 0.62 : light * 0.95)}" stroke="none"/>`;
  if (v.shape === 'dash') {
    // Dashes are written at right angles to the stroke.
    const n = { x: -along.y, y: along.x };
    const half = u * 0.13;
    const a = add(at, scale(n, -half));
    const b = add(at, scale(n, half));
    return `<path d="M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}" fill="none" stroke-width="${f(v.heavy ? heavy * 0.8 : light)}" stroke-linecap="round"/>`;
  }
  const s = u * 0.13;
  const line = (pts: Pt[]) => `<path d="${pathOf(pts)}" fill="none" stroke-width="${f(light)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  switch (v.shape) {
    case 'I':
      return line([
        { x: at.x - s, y: at.y - s },
        { x: at.x, y: at.y + s * 0.6 },
        { x: at.x + s, y: at.y - s },
      ]);
    case 'OI':
      return line([
        { x: at.x - s, y: at.y - s },
        { x: at.x + s * 0.6, y: at.y },
        { x: at.x - s, y: at.y + s },
      ]);
    case 'OW':
      return line([
        { x: at.x - s, y: at.y + s },
        { x: at.x, y: at.y - s * 0.6 },
        { x: at.x + s, y: at.y + s },
      ]);
    default:
      return `<path d="M${f(at.x - s)} ${f(at.y + s * 0.5)}A${f(s)} ${f(s)} 0 0 1 ${f(at.x + s)} ${f(at.y + s * 0.5)}" fill="none" stroke-width="${f(light)}" stroke-linecap="round"/>`;
  }
}

/* -------------------------------------------------------------------- page -- */

export interface WordInput {
  readonly text: string;
  /** Null for numbers and punctuation, written in longhand. */
  readonly units: readonly Unit[] | null;
  readonly guessed: boolean;
}

export interface PageOptions extends OutlineOptions {
  readonly width: number;
  readonly lines: boolean;
  readonly labels: boolean;
  readonly ink: string;
  readonly paper: string;
}

/** Lays words out on ruled lines and returns a complete SVG document. */
export function renderPage(
  words: readonly WordInput[],
  o: PageOptions,
): { svg: string; width: number; height: number; outlines: { text: string; spelling: string; position: Place; guessed: boolean }[] } {
  const u = o.unit;
  const margin = u * 0.8;
  const gap = u * 0.75;
  interface Item {
    readonly svg: string;
    /** Where the drawing's origin goes. */
    readonly x: number;
    /** Left edge of the space the word takes, and its width. */
    readonly start: number;
    readonly w: number;
    readonly top: number;
    readonly bottom: number;
    readonly label: string;
  }
  const rows: Item[][] = [[]];
  const outlines: { text: string; spelling: string; position: Place; guessed: boolean }[] = [];
  let x = margin;
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const stroke = Math.max(1, u * 0.065).toFixed(2);
  for (const w of words) {
    let svg: string;
    let width: number;
    let left: number;
    let top: number;
    let bottom: number;
    if (w.units === null) {
      // Longhand for figures and punctuation; Pitman's full stop is a small cross.
      if (w.text === '.') {
        const c = u * 0.12;
        svg = `<path d="M${-c} ${-c * 2}L${c} 0M${c} ${-c * 2}L${-c} 0" fill="none" stroke-width="${stroke}"/>`;
        width = c * 2;
        left = -c;
        top = -c * 2;
        bottom = 0;
      } else {
        const fs = u * 0.6;
        width = w.text.length * fs * 0.6;
        left = 0;
        top = -fs;
        bottom = 0;
        svg = `<text y="${(-u * 0.1).toFixed(1)}" font-size="${fs.toFixed(1)}" font-family="Georgia, serif" stroke="none">${esc(w.text)}</text>`;
      }
    } else {
      const outline = buildOutline(w.units, o);
      svg = outline.svg;
      width = outline.maxX - outline.minX;
      left = outline.minX;
      top = outline.minY;
      bottom = outline.maxY;
      outlines.push({ text: w.text, spelling: outline.spelling, position: outline.position, guessed: w.guessed });
    }
    const label = w.units ? w.text : '';
    const labelWidth = o.labels ? label.length * u * 0.2 : 0;
    const span = Math.max(width, labelWidth);
    const row = rows[rows.length - 1] as Item[];
    if (x + span > o.width - margin && row.length > 0) {
      rows.push([]);
      x = margin;
    }
    (rows[rows.length - 1] as Item[]).push({ svg, x: x - left + (span - width) / 2, start: x, w: span, top, bottom, label });
    x += span + gap;
  }
  const body: string[] = [];
  let y = margin;
  const labelSize = u * 0.36;
  for (const row of rows) {
    // Room above for outlines written above the line, below for those through it, then the words.
    const ascent = Math.max(u * 1.6, ...row.map((i) => -i.top));
    const descent = Math.max(u * 0.4, ...row.map((i) => i.bottom));
    const baseline = y + ascent;
    if (o.lines) body.push(`<line x1="0" y1="${baseline.toFixed(1)}" x2="${o.width}" y2="${baseline.toFixed(1)}" stroke="#9fb3c8" stroke-width="0.8"/>`);
    for (const item of row) body.push(`<g transform="translate(${item.x.toFixed(2)} ${baseline.toFixed(2)})">${item.svg}</g>`);
    y = baseline + descent + (o.labels ? labelSize * 1.6 : 0) + u * 0.5;
    if (o.labels) {
      const labelY = baseline + descent + labelSize * 1.2;
      for (const item of row)
        if (item.label)
          body.push(
            `<text x="${(item.start + item.w / 2).toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-size="${labelSize.toFixed(1)}" font-family="system-ui, sans-serif" fill="#6b7785" stroke="none">${esc(item.label)}</text>`,
          );
    }
  }
  const height = Math.ceil(y + margin * 0.4);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${o.width}" height="${height}" viewBox="0 0 ${o.width} ${height}"><rect width="100%" height="100%" fill="${o.paper}"/><g fill="${o.ink}" stroke="${o.ink}">${body.join('')}</g></svg>`;
  return { svg, width: o.width, height, outlines };
}
