/**
 * Plane geometry for the Geometry Lab: triangle centres, polygons, angles,
 * transformation matrices, conics from focus and directrix, and exact values
 * of the trigonometric ratios.  Points are [x, y] with y pointing up.
 */

export type Pt = readonly [number, number];

export const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** The angle APB at P, degrees (0–180). */
export function angleAt(p: Pt, a: Pt, b: Pt): number {
  const u = [a[0] - p[0], a[1] - p[1]];
  const v = [b[0] - p[0], b[1] - p[1]];
  const c = ((u[0] ?? 0) * (v[0] ?? 0) + (u[1] ?? 0) * (v[1] ?? 0)) / (Math.hypot(u[0] ?? 0, u[1] ?? 0) * Math.hypot(v[0] ?? 0, v[1] ?? 0));
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

/** Signed area (positive when the points run anticlockwise), by the shoelace formula. */
export function signedArea(points: readonly Pt[]): number {
  let s = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length] ?? p;
    s += p[0] * q[1] - q[0] * p[1];
  });
  return s / 2;
}

/** The foot of the perpendicular from p onto the line through a and b. */
export function foot(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1);
  return [a[0] + t * dx, a[1] + t * dy];
}

/* -------------------------------------------------------------- triangle -- */

export interface Triangle {
  /** Side lengths a = BC, b = CA, c = AB and the angles at A, B, C (degrees). */
  readonly sides: readonly [number, number, number];
  readonly angles: readonly [number, number, number];
  readonly area: number;
  readonly perimeter: number;
  /** Centroid, circumcentre, incentre, orthocentre and nine-point centre. */
  readonly G: Pt;
  readonly O: Pt;
  readonly I: Pt;
  readonly H: Pt;
  readonly N: Pt;
  readonly R: number;
  readonly r: number;
  readonly kind: string;
}

export function triangle(A: Pt, B: Pt, C: Pt): Triangle | null {
  const a = dist(B, C);
  const b = dist(C, A);
  const c = dist(A, B);
  const area = Math.abs(signedArea([A, B, C]));
  if (area < 1e-9 * Math.max(1, a * b)) return null;
  const G: Pt = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3];
  const d = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]));
  const sq = (p: Pt) => p[0] * p[0] + p[1] * p[1];
  const O: Pt = [(sq(A) * (B[1] - C[1]) + sq(B) * (C[1] - A[1]) + sq(C) * (A[1] - B[1])) / d, (sq(A) * (C[0] - B[0]) + sq(B) * (A[0] - C[0]) + sq(C) * (B[0] - A[0])) / d];
  const p = a + b + c;
  const I: Pt = [(a * A[0] + b * B[0] + c * C[0]) / p, (a * A[1] + b * B[1] + c * C[1]) / p];
  // Euler: H = A + B + C − 2O.
  const H: Pt = [A[0] + B[0] + C[0] - 2 * O[0], A[1] + B[1] + C[1] - 2 * O[1]];
  const N = mid(O, H);
  const angles: [number, number, number] = [angleAt(A, B, C), angleAt(B, C, A), angleAt(C, A, B)];
  const big = Math.max(...angles);
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-6 * Math.max(x, y);
  const equalPairs = [near(a, b), near(b, c), near(c, a)].filter(Boolean).length;
  const shape = equalPairs === 3 ? 'equilateral' : equalPairs >= 1 ? 'isosceles' : 'scalene';
  const corner = Math.abs(big - 90) < 1e-6 ? 'right-angled' : big > 90 ? 'obtuse' : 'acute';
  return { sides: [a, b, c], angles, area, perimeter: p, G, O, I, H, N, R: (a * b * c) / (4 * area), r: (2 * area) / p, kind: `${shape}, ${corner}` };
}

/* --------------------------------------------------------------- polygons -- */

export function regularPolygon(n: number, centre: Pt, radius: number, turn = Math.PI / 2): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const a = turn + (2 * Math.PI * i) / n;
    return [centre[0] + radius * Math.cos(a), centre[1] + radius * Math.sin(a)] as const;
  });
}

/** Interior angle at each vertex (degrees), right for either winding, reflex where the polygon bends in. */
export function interiorAngles(points: readonly Pt[]): number[] {
  const n = points.length;
  const orient = Math.sign(signedArea(points)) || 1;
  return points.map((p, i) => {
    const prev = points[(i - 1 + n) % n] ?? p;
    const next = points[(i + 1) % n] ?? p;
    const a1 = Math.atan2(prev[1] - p[1], prev[0] - p[0]);
    const a2 = Math.atan2(next[1] - p[1], next[0] - p[0]);
    let d = ((a1 - a2) * 180) / Math.PI;
    d = ((d % 360) + 360) % 360;
    return orient > 0 ? d : 360 - d;
  });
}

export const isConvex = (points: readonly Pt[]) => interiorAngles(points).every((a) => a < 180 + 1e-9);

/** Whether segments p1p2 and p3p4 cross (touching at ends does not count). */
function crosses(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const o = (a: Pt, b: Pt, c: Pt) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  return o(p1, p2, p3) * o(p1, p2, p4) < 0 && o(p3, p4, p1) * o(p3, p4, p2) < 0;
}

/** Whether any two non-neighbouring sides cross. */
export function selfCrossing(points: readonly Pt[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const a = points[i];
      const b = points[(i + 1) % n];
      const c = points[j];
      const d = points[(j + 1) % n];
      if (a && b && c && d && crosses(a, b, c, d)) return true;
    }
  return false;
}

/* -------------------------------------------------------- transformations -- */

/** A 2×2 matrix [a, b, c, d] acting as (x, y) → (ax + by, cx + dy), plus a shift. */
export interface Affine {
  readonly m: readonly [number, number, number, number];
  readonly t: Pt;
}

export const applyAffine = (f: Affine, p: Pt): Pt => [f.m[0] * p[0] + f.m[1] * p[1] + f.t[0], f.m[2] * p[0] + f.m[3] * p[1] + f.t[1]];

/** A linear map about a centre: p → c + M(p − c). */
const about = (m: Affine['m'], c: Pt): Affine => ({ m, t: [c[0] - m[0] * c[0] - m[1] * c[1], c[1] - m[2] * c[0] - m[3] * c[1]] });

export const translation = (dx: number, dy: number): Affine => ({ m: [1, 0, 0, 1], t: [dx, dy] });
/** cos and sin of an angle in degrees, exact at multiples of 90° (no 6 × 10⁻¹⁷ for cos 90°). */
function cosSin(degrees: number): [number, number] {
  const a = (degrees * Math.PI) / 180;
  const clean = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);
  return [clean(Math.cos(a)), clean(Math.sin(a))];
}
export function rotation(degrees: number, centre: Pt): Affine {
  const [c, s] = cosSin(degrees);
  return about([c, -s, s, c], centre);
}
/** Reflection in the line through `point` at `degrees` to the x-axis. */
export function reflection(degrees: number, point: Pt): Affine {
  const [c, s] = cosSin(2 * degrees);
  return about([c, s, s, -c], point);
}
export const enlargement = (k: number, centre: Pt): Affine => about([k, 0, 0, k], centre);
export const shear = (kx: number, ky: number, centre: Pt): Affine => about([1, kx, ky, 1], centre);
export const determinant = (f: Affine) => f.m[0] * f.m[3] - f.m[1] * f.m[2];

/* ----------------------------------------------------------------- conics -- */

/**
 * A conic with a focus at the origin and its directrix the line x = p (p > 0)
 * on the right: r = e·p / (1 + e cos θ).  Returns the named lengths and the
 * points for drawing (each branch separately for a hyperbola).
 */
export function conic(e: number, p: number) {
  const kind = e < 1e-9 ? 'circle' : e < 1 - 1e-9 ? 'ellipse' : e <= 1 + 1e-9 ? 'parabola' : 'hyperbola';
  const l = e * p; // semi-latus rectum
  const a = Math.abs(e - 1) < 1e-9 ? Number.POSITIVE_INFINITY : l / Math.abs(1 - e * e);
  const b = kind === 'ellipse' ? a * Math.sqrt(1 - e * e) : kind === 'hyperbola' ? a * Math.sqrt(e * e - 1) : Number.NaN;
  return { kind, l, a, b, c: a * e };
}

/** The point at polar angle θ from the focus, or null where that direction never meets the curve. */
export function conicPoint(e: number, p: number, theta: number): Pt | null {
  const den = 1 + e * Math.cos(theta);
  if (den <= 1e-6) return null;
  const r = (e * p) / den;
  return [r * Math.cos(theta), r * Math.sin(theta)];
}

/* ------------------------------------------------------------- unit circle -- */

const EXACT: Readonly<Record<number, readonly [string, string, string]>> = {
  0: ['0', '1', '0'],
  30: ['1/2', '√3/2', '√3/3'],
  45: ['√2/2', '√2/2', '1'],
  60: ['√3/2', '1/2', '√3'],
  90: ['1', '0', 'undefined'],
};

/** Exact sin, cos and tan for multiples of 30° and 45°, or null. */
export function exactTrig(degrees: number): { sin: string; cos: string; tan: string } | null {
  const d = ((Math.round(degrees) % 360) + 360) % 360;
  if (Math.abs(degrees - Math.round(degrees)) > 1e-9) return null;
  const ref = d % 180 > 90 ? 180 - (d % 180) : d % 180;
  const base = EXACT[ref];
  if (!base) return null;
  const s = Math.sin((d * Math.PI) / 180);
  const c = Math.cos((d * Math.PI) / 180);
  const sign = (v: number, text: string) => (text === '0' || text === 'undefined' || v >= -1e-12 ? text : `−${text}`);
  return { sin: sign(s, base[0]), cos: sign(c, base[1]), tan: base[2] === 'undefined' ? 'undefined' : sign(s * c, base[2]) };
}
