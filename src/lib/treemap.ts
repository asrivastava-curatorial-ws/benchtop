/**
 * Squarified treemap layout (Bruls, Huizing and van Wijk, 2000): rectangles
 * with areas in proportion to values, kept as close to square as possible.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Placed<T> extends Rect {
  readonly item: T;
}

/** Lays out `items` (largest first works best) in the rectangle, by `value`. */
export function squarify<T>(items: readonly T[], value: (item: T) => number, rect: Rect): Placed<T>[] {
  const list = items.map((item) => ({ item, v: Math.max(0, value(item)) })).filter((e) => e.v > 0);
  const total = list.reduce((s, e) => s + e.v, 0);
  if (!total || rect.w <= 0 || rect.h <= 0) return [];
  const scale = (rect.w * rect.h) / total;
  const areas = list.map((e) => ({ item: e.item, a: e.v * scale }));
  const out: Placed<T>[] = [];
  let { x, y, w, h } = rect;
  let row: typeof areas = [];
  const worst = (r: typeof areas, side: number) => {
    const sum = r.reduce((s, e) => s + e.a, 0);
    const max = Math.max(...r.map((e) => e.a));
    const min = Math.min(...r.map((e) => e.a));
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };
  const layRow = (r: typeof areas) => {
    const sum = r.reduce((s, e) => s + e.a, 0);
    if (w >= h) {
      // A column on the left.
      const cw = sum / h;
      let cy = y;
      for (const e of r) {
        const ch = e.a / cw;
        out.push({ item: e.item, x, y: cy, w: cw, h: ch });
        cy += ch;
      }
      x += cw;
      w -= cw;
    } else {
      // A row along the top.
      const rh = sum / w;
      let cx = x;
      for (const e of r) {
        const cw = e.a / rh;
        out.push({ item: e.item, x: cx, y, w: cw, h: rh });
        cx += cw;
      }
      y += rh;
      h -= rh;
    }
  };
  for (const e of areas) {
    const side = Math.min(w, h);
    if (!row.length || worst([...row, e], side) <= worst(row, side)) row.push(e);
    else {
      layRow(row);
      row = [e];
    }
  }
  if (row.length) layRow(row);
  return out;
}
