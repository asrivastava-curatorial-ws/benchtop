/**
 * Nesting: fitting rectangles of different sizes onto sheets (or along a
 * roll) with as little waste as it finds.  Used for ganging jobs on a press
 * sheet and for laying out cuts on board and vinyl.  The method is the
 * "maximal rectangles" one: the free space is kept as a list of the largest
 * empty rectangles, and each piece goes where it leaves the tightest fit.
 * Several orders and rules of fit are tried, and the best result is kept.
 */

export interface Piece {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly quantity: number;
  /** May be turned a quarter turn (no grain or direction to keep). */
  readonly rotate: boolean;
}

export interface Placement {
  readonly id: string;
  /** Which of the piece's copies this is, from 0. */
  readonly copy: number;
  readonly sheet: number;
  /** From the sheet's top left corner, margins included. */
  readonly x: number;
  readonly y: number;
  /** As placed: swapped when the piece was turned. */
  readonly width: number;
  readonly height: number;
  readonly rotated: boolean;
  /** Turned a further half turn: the back of a sheet needs it, so that heads meet heads when the sheet is turned over. */
  readonly flip?: boolean;
}

export interface NestOptions {
  readonly sheetWidth: number;
  /** 0 for a roll: as long as it takes. */
  readonly sheetHeight: number;
  /** Space kept clear at every edge of the sheet. */
  readonly margin: number;
  /** Space between neighbouring pieces. */
  readonly gap: number;
}

export interface NestResult {
  readonly placements: Placement[];
  readonly sheets: number;
  /** Pieces that fit on no sheet at all, with how many copies were left out. */
  readonly leftOut: { id: string; copies: number }[];
  /** The length used: of the last sheet, or of the roll. */
  readonly usedHeight: number;
  /** The share of the sheets (or of the roll's used length) that the pieces cover, 0 to 1. */
  readonly coverage: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Rule = 'short-side' | 'area' | 'bottom-left';

/** One sheet's free space, as its largest empty rectangles. */
class Bin {
  free: Rect[];
  used: Rect[] = [];
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.free = [{ x: 0, y: 0, w, h }];
  }

  /** The best place for a piece, or null: lower `score` is better. */
  find(w: number, h: number, rotate: boolean, rule: Rule): { x: number; y: number; w: number; h: number; rotated: boolean; score: number; tie: number } | null {
    let best: { x: number; y: number; w: number; h: number; rotated: boolean; score: number; tie: number } | null = null;
    const consider = (pw: number, ph: number, rotated: boolean) => {
      for (const f of this.free) {
        if (pw > f.w + 1e-9 || ph > f.h + 1e-9) continue;
        const leftW = f.w - pw;
        const leftH = f.h - ph;
        const score = rule === 'short-side' ? Math.min(leftW, leftH) : rule === 'area' ? f.w * f.h - pw * ph : f.y + ph;
        const tie = rule === 'short-side' ? Math.max(leftW, leftH) : rule === 'area' ? Math.min(leftW, leftH) : f.x;
        if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) <= 1e-9 && tie < best.tie - 1e-9)) best = { x: f.x, y: f.y, w: pw, h: ph, rotated, score, tie };
      }
    };
    consider(w, h, false);
    if (rotate && Math.abs(w - h) > 1e-9) consider(h, w, true);
    return best;
  }

  place(r: Rect): void {
    const next: Rect[] = [];
    for (const f of this.free) {
      if (r.x >= f.x + f.w - 1e-9 || r.x + r.w <= f.x + 1e-9 || r.y >= f.y + f.h - 1e-9 || r.y + r.h <= f.y + 1e-9) {
        next.push(f);
        continue;
      }
      // What is left of this empty rectangle on each side of the piece.
      if (r.x > f.x + 1e-9) next.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
      if (r.x + r.w < f.x + f.w - 1e-9) next.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - (r.x + r.w), h: f.h });
      if (r.y > f.y + 1e-9) next.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
      if (r.y + r.h < f.y + f.h - 1e-9) next.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - (r.y + r.h) });
    }
    // An empty rectangle inside another says nothing new.
    this.free = next.filter(
      (a, i) => !next.some((b, j) => i !== j && a.x >= b.x - 1e-9 && a.y >= b.y - 1e-9 && a.x + a.w <= b.x + b.w + 1e-9 && a.y + a.h <= b.y + b.h + 1e-9 && (j < i || a.w * a.h < b.w * b.h - 1e-9)),
    );
    this.used.push(r);
  }
}

interface Unit {
  id: string;
  copy: number;
  w: number;
  h: number;
  rotate: boolean;
}

const ORDERS: ((a: Unit, b: Unit) => number)[] = [
  (a, b) => b.w * b.h - a.w * a.h,
  (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h,
  (a, b) => b.h - a.h || b.w - a.w,
  (a, b) => b.w - a.w || b.h - a.h,
  (a, b) => b.w + b.h - (a.w + a.h),
];
const RULES: Rule[] = ['short-side', 'area', 'bottom-left'];

/** How far down the pieces of one sheet reach. */
const reach = (placements: readonly Placement[], sheet: number) => placements.filter((p) => p.sheet === sheet).reduce((most, p) => Math.max(most, p.y + p.height), 0);

export function nest(pieces: readonly Piece[], options: NestOptions): NestResult {
  const { sheetWidth, margin, gap } = options;
  const roll = !(options.sheetHeight > 0);
  // Each piece is treated as larger by the gap, on a sheet larger by the gap: neighbours then stand a gap apart, and pieces reach the margins.
  const areaW = sheetWidth - 2 * margin + gap;
  const units: Unit[] = [];
  const leftOut = new Map<string, number>();
  let wanted = 0;
  for (const piece of pieces) {
    const count = Math.max(0, Math.floor(piece.quantity));
    if (!(piece.width > 0 && piece.height > 0) || count === 0) continue;
    wanted += count * piece.width * piece.height;
    for (let copy = 0; copy < count; copy++) units.push({ id: piece.id, copy, w: piece.width + gap, h: piece.height + gap, rotate: piece.rotate });
  }
  // A roll is a sheet as long as all the pieces end to end, which is always enough.
  const areaH = roll ? units.reduce((sum, u) => sum + Math.max(u.w, u.h), 0) + gap : options.sheetHeight - 2 * margin + gap;
  const fits = (u: Unit) => (u.w <= areaW + 1e-9 && u.h <= areaH + 1e-9) || (u.rotate && u.h <= areaW + 1e-9 && u.w <= areaH + 1e-9);
  const usable = units.filter((u) => {
    if (fits(u)) return true;
    leftOut.set(u.id, (leftOut.get(u.id) ?? 0) + 1);
    return false;
  });

  let best: { placements: Placement[]; sheets: number; last: number } | null = null;
  for (const order of ORDERS) {
    for (const rule of RULES) {
      const queue = [...usable].sort(order);
      const bins: Bin[] = [];
      const placements: Placement[] = [];
      for (const unit of queue) {
        let done = false;
        for (let b = 0; b <= bins.length && !done; b++) {
          if (b === bins.length) bins.push(new Bin(areaW, areaH));
          const bin = bins[b] as Bin;
          const spot = bin.find(unit.w, unit.h, unit.rotate, rule);
          if (!spot) continue;
          bin.place({ x: spot.x, y: spot.y, w: spot.w, h: spot.h });
          placements.push({ id: unit.id, copy: unit.copy, sheet: b, x: margin + spot.x, y: margin + spot.y, width: spot.w - gap, height: spot.h - gap, rotated: spot.rotated });
          done = true;
        }
      }
      const sheets = bins.length;
      const last = reach(placements, sheets - 1);
      // Fewer sheets wins; then the shorter last sheet (which is the roll's length).
      if (!best || sheets < best.sheets || (sheets === best.sheets && last < best.last - 1e-9)) best = { placements, sheets, last };
    }
  }
  const placements = (best?.placements ?? []).sort((a, b) => a.sheet - b.sheet || a.y - b.y || a.x - b.x);
  const sheets = best?.sheets ?? 0;
  const usedHeight = sheets ? Math.min(roll ? Number.POSITIVE_INFINITY : options.sheetHeight, (best?.last ?? 0) + margin) : 0;
  const placedArea = wanted - [...leftOut.entries()].reduce((sum, [id, copies]) => sum + copies * ((pieces.find((p) => p.id === id)?.width ?? 0) * (pieces.find((p) => p.id === id)?.height ?? 0)), 0);
  const sheetArea = roll ? sheetWidth * usedHeight : sheets * sheetWidth * options.sheetHeight;
  return { placements, sheets, leftOut: [...leftOut.entries()].map(([id, copies]) => ({ id, copies })), usedHeight, coverage: sheetArea > 0 ? placedArea / sheetArea : 0 };
}

/** The placements as a cutting list: a table that a spreadsheet opens. */
export function cutList(placements: readonly Placement[], names: Readonly<Record<string, string>> = {}): string {
  const cell = (value: string | number) => {
    const text = String(value);
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const number = (value: number) => Math.round(value * 100) / 100;
  const rows = placements.map((p) => [p.sheet + 1, names[p.id] ?? p.id, p.copy + 1, number(p.x), number(p.y), number(p.width), number(p.height), p.rotated ? 'yes' : 'no']);
  return `${[['Sheet', 'Piece', 'Copy', 'X (mm)', 'Y (mm)', 'Width (mm)', 'Height (mm)', 'Turned'], ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}
