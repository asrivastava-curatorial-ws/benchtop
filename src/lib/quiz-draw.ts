/**
 * Geometry for the Live Quiz's big screen: where the words of a word cloud
 * go, the segments of a ring or a pie, and how far the spinner wheel turns.
 * Plain arithmetic, so that it can be checked without a page.
 */

export interface CloudWord {
  readonly text: string;
  readonly count: number;
}

export interface PlacedWord extends CloudWord {
  /** The middle of the word. */
  readonly x: number;
  readonly y: number;
  /** Font size. */
  readonly size: number;
  readonly width: number;
  readonly height: number;
}

export interface CloudOptions {
  /** Font sizes of the rarest and the commonest word. */
  readonly min: number;
  readonly max: number;
  /** Words placed at most. */
  readonly limit: number;
  /** Clear space kept around every word. */
  readonly gap: number;
}

const CLOUD: CloudOptions = { min: 15, max: 60, limit: 60, gap: 5 };

/**
 * Places words on a sheet, the commonest first and nearest the middle, each as close to the
 * middle as it goes without touching another.  `measure` gives a word's width at font size 1
 * (the page measures real text; a fixed share per letter does for tests).  A word that fits
 * nowhere is tried smaller, and left out when it still does not fit.
 */
export function layoutCloud(words: readonly CloudWord[], width: number, height: number, measure: (text: string) => number, options: Partial<CloudOptions> = {}): PlacedWord[] {
  const { min, max, limit, gap } = { ...CLOUD, ...options };
  const ranked = [...words]
    .filter((w) => w.text && w.count > 0)
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
    .slice(0, limit);
  const most = ranked[0]?.count ?? 1;
  const least = ranked[ranked.length - 1]?.count ?? 1;
  const placed: PlacedWord[] = [];
  const free = (x: number, y: number, w: number, h: number) =>
    x - w / 2 >= 0 &&
    x + w / 2 <= width &&
    y - h / 2 >= 0 &&
    y + h / 2 <= height &&
    placed.every((p) => Math.abs(p.x - x) * 2 >= p.width + w + gap * 2 || Math.abs(p.y - y) * 2 >= p.height + h + gap * 2);
  for (const word of ranked) {
    // The square root keeps a word said four times from dwarfing one said twice.
    const weight = most === least ? (ranked.length === 1 ? 1 : 0.5) : Math.sqrt((word.count - least) / (most - least));
    const unit = measure(word.text);
    let size = min + (max - min) * weight;
    // A long word is brought down to what the sheet can hold at all.
    if (unit > 0) size = Math.min(size, (width * 0.9) / unit);
    for (let attempt = 0; attempt < 6 && size >= min * 0.6; attempt++, size *= 0.82) {
      const w = unit * size;
      const h = size * 1.15;
      let spot: { x: number; y: number } | null = null;
      // Outwards along a spiral, wider than it is tall like the sheet.
      for (let t = 0; t < 1400 && !spot; t++) {
        const angle = t * 0.35;
        const reach = 2.2 * angle;
        const x = width / 2 + reach * Math.cos(angle) * (width / Math.max(height, 1));
        const y = height / 2 + reach * Math.sin(angle);
        if (reach > Math.max(width, height)) break;
        if (free(x, y, w, h)) spot = { x, y };
      }
      if (spot) {
        placed.push({ ...word, ...spot, size, width: w, height: h });
        break;
      }
    }
  }
  return placed;
}

/** The box that holds every word of a cloud, with a margin: the sheet is cut to it, so that a few words fill the screen. */
export function cloudBox(placed: readonly PlacedWord[], margin = 12): { x: number; y: number; width: number; height: number } | null {
  if (placed.length === 0) return null;
  const left = Math.min(...placed.map((w) => w.x - w.width / 2));
  const right = Math.max(...placed.map((w) => w.x + w.width / 2));
  const top = Math.min(...placed.map((w) => w.y - w.height / 2));
  const bottom = Math.max(...placed.map((w) => w.y + w.height / 2));
  return { x: left - margin, y: top - margin, width: right - left + margin * 2, height: bottom - top + margin * 2 };
}

/** A point on a circle; `turn` runs clockwise from twelve o'clock, 1 for the whole way round. */
const onCircle = (cx: number, cy: number, r: number, turn: number): [number, number] => [cx + r * Math.sin(turn * 2 * Math.PI), cy - r * Math.cos(turn * 2 * Math.PI)];
const n = (value: number) => String(Math.round(value * 100) / 100);

/**
 * The outline of a segment of a ring (or of a pie, with `inner` 0), from one turn to another.
 * A segment that goes all the way round is drawn as two halves, since an arc cannot end where it starts.
 */
export function arcPath(cx: number, cy: number, outer: number, inner: number, from: number, to: number): string {
  const sweep = Math.min(Math.max(to - from, 0), 1);
  if (sweep <= 0) return '';
  if (sweep >= 0.9999) return `${arcPath(cx, cy, outer, inner, from, from + 0.5)} ${arcPath(cx, cy, outer, inner, from + 0.5, from + 0.9999)}`;
  const large = sweep > 0.5 ? 1 : 0;
  const [x1, y1] = onCircle(cx, cy, outer, from);
  const [x2, y2] = onCircle(cx, cy, outer, from + sweep);
  if (inner <= 0) return `M${n(cx)} ${n(cy)} L${n(x1)} ${n(y1)} A${n(outer)} ${n(outer)} 0 ${large} 1 ${n(x2)} ${n(y2)} Z`;
  const [x3, y3] = onCircle(cx, cy, inner, from + sweep);
  const [x4, y4] = onCircle(cx, cy, inner, from);
  return `M${n(x1)} ${n(y1)} A${n(outer)} ${n(outer)} 0 ${large} 1 ${n(x2)} ${n(y2)} L${n(x3)} ${n(y3)} A${n(inner)} ${n(inner)} 0 ${large} 0 ${n(x4)} ${n(y4)} Z`;
}

export interface Share {
  readonly index: number;
  readonly count: number;
  /** 0 to 1 of the whole. */
  readonly share: number;
  readonly from: number;
  readonly to: number;
}

/** Counts as parts of a whole, in the order given: each with its share and where it starts and ends on the way round. */
export function sharesOf(counts: readonly number[]): Share[] {
  const total = counts.reduce((sum, c) => sum + Math.max(0, c), 0);
  let at = 0;
  return counts.map((raw, index) => {
    const count = Math.max(0, raw);
    const share = total > 0 ? count / total : 0;
    const part = { index, count, share, from: at, to: at + share };
    at += share;
    return part;
  });
}

/**
 * Each count as a whole number of per cent of the total.  Each is rounded on its own, so that
 * equal counts always read the same; the figures may then add up to 99 or 101.
 */
export function percents(counts: readonly number[]): number[] {
  const total = counts.reduce((sum, c) => sum + Math.max(0, c), 0);
  return counts.map((c) => (total > 0 ? Math.round((Math.max(0, c) / total) * 100) : 0));
}

/**
 * How far the spinner wheel has turned, in degrees, when it rests with entry `index` of `count`
 * under the pointer at the top after its `spins`-th spin: five whole turns for every spin, then
 * back by as much as brings the middle of that entry to the top.
 */
export function wheelTurn(index: number, count: number, spins: number): number {
  if (count <= 0 || spins <= 0) return 0;
  const middle = ((index + 0.5) / count) * 360;
  return spins * 5 * 360 - middle;
}
