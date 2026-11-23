/** Roots of a real polynomial of any degree (Durand–Kerner), as complex numbers. */
export interface Complex {
  readonly re: number;
  readonly im: number;
}

const mul = (a: Complex, b: Complex): Complex => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const sub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im });
const div = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};

/** Coefficients from the constant term upwards: [c0, c1, …, cn]. */
export function polynomialRoots(coefficients: readonly number[]): Complex[] {
  const c = [...coefficients];
  while (c.length > 1 && Math.abs(c[c.length - 1] as number) < 1e-14) c.pop();
  const n = c.length - 1;
  if (n < 1) return [];
  const lead = c[n] as number;
  const monic = c.map((v) => v / lead);
  // Zero roots are exact; factor them out first.
  let zeros = 0;
  while (zeros < n && Math.abs(monic[zeros] as number) < 1e-14) zeros++;
  const reduced = monic.slice(zeros);
  const m = reduced.length - 1;
  const roots: Complex[] = Array.from({ length: zeros }, () => ({ re: 0, im: 0 }));
  if (m < 1) return roots;
  const evaluate = (z: Complex) => {
    let acc: Complex = { re: reduced[m] as number, im: 0 };
    for (let k = m - 1; k >= 0; k--) acc = { re: mul(acc, z).re + (reduced[k] as number), im: mul(acc, z).im };
    return acc;
  };
  // Starting points on a circle, rotated off the real axis.
  const radius = 1 + Math.max(...reduced.slice(0, m).map(Math.abs));
  let z: Complex[] = Array.from({ length: m }, (_, k) => ({ re: radius * Math.cos((2 * Math.PI * k) / m + 0.4), im: radius * Math.sin((2 * Math.PI * k) / m + 0.4) }));
  for (let iter = 0; iter < 500; iter++) {
    let moved = 0;
    z = z.map((zi, i) => {
      let denom: Complex = { re: 1, im: 0 };
      z.forEach((zj, j) => {
        if (i !== j) denom = mul(denom, sub(zi, zj));
      });
      const next = sub(zi, div(evaluate(zi), denom));
      moved = Math.max(moved, Math.hypot(next.re - zi.re, next.im - zi.im));
      return next;
    });
    if (moved < 1e-14) break;
  }
  // Durand–Kerner finds a k-fold root only to about the k-th root of the rounding error, so
  // gather nearby approximations, test whether they are one repeated root, and polish.
  const polished = groups(z, 1e-2).flatMap((g) => refine(reduced, g, 1e-2));
  // Tidy values that are real or integers within rounding.
  const tidy = (v: number) => (Math.abs(v - Math.round(v)) < 1e-9 ? Math.round(v) : Math.abs(v) < 1e-12 ? 0 : v);
  return [...roots, ...polished.map((r) => ({ re: tidy(r.re), im: Math.abs(r.im) < 1e-9 * Math.max(1, Math.abs(r.re)) ? 0 : tidy(r.im) }))].sort((a, b) => a.re - b.re || a.im - b.im);
}

const size = (z: Complex) => Math.hypot(z.re, z.im);
const distance = (a: Complex, b: Complex) => Math.hypot(a.re - b.re, a.im - b.im);

/** p(z) for real coefficients from the constant term up. */
function evaluateAt(coefficients: readonly number[], z: Complex): Complex {
  let acc: Complex = { re: coefficients[coefficients.length - 1] ?? 0, im: 0 };
  for (let k = coefficients.length - 2; k >= 0; k--) {
    const m = mul(acc, z);
    acc = { re: m.re + (coefficients[k] as number), im: m.im };
  }
  return acc;
}

const derivative = (coefficients: readonly number[]) => coefficients.slice(1).map((c, i) => c * (i + 1));

/** Sum of |a_i| |z|^i: the size rounding errors in p(z) are measured against. */
function magnitude(coefficients: readonly number[], z: Complex): number {
  const r = size(z);
  let sum = 0;
  for (let k = coefficients.length - 1; k >= 0; k--) sum = sum * r + Math.abs(coefficients[k] as number);
  return sum;
}

function newton(coefficients: readonly number[], start: Complex): Complex | null {
  const d = derivative(coefficients);
  let x = start;
  for (let k = 0; k < 60; k++) {
    const f = evaluateAt(coefficients, x);
    const g = evaluateAt(d, x);
    if (g.re === 0 && g.im === 0) return f.re === 0 && f.im === 0 ? x : null;
    const step = div(f, g);
    x = sub(x, step);
    if (size(step) <= 1e-17 * Math.max(1, size(x))) break;
  }
  return Number.isFinite(x.re) && Number.isFinite(x.im) ? x : null;
}

/** Single-linkage groups of points closer than `tolerance` (relative above 1). */
function groups(points: readonly Complex[], tolerance: number): Complex[][] {
  const parent = points.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root] as number;
    return root;
  };
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i] as Complex;
      const b = points[j] as Complex;
      if (distance(a, b) <= tolerance * Math.max(1, size(a), size(b))) parent[find(i)] = find(j);
    }
  const out = new Map<number, Complex[]>();
  points.forEach((p, i) => {
    const key = find(i);
    out.set(key, [...(out.get(key) ?? []), p]);
  });
  return [...out.values()];
}

/** One root repeated k times if the group passes the test, otherwise smaller groups, down to single roots. */
function refine(p: readonly number[], group: readonly Complex[], tolerance: number): Complex[] {
  const single = (z: Complex) => {
    const better = newton(p, z);
    return better && distance(better, z) <= 1e-6 * Math.max(1, size(z)) ? better : z;
  };
  if (group.length === 1) return [single(group[0] as Complex)];
  const k = group.length;
  const centre = { re: group.reduce((s, z) => s + z.re, 0) / k, im: group.reduce((s, z) => s + z.im, 0) / k };
  // A k-fold root of p is a simple root of its (k-1)th derivative, where Newton's method is fast.
  let q = [...p];
  for (let j = 0; j < k - 1; j++) q = derivative(q);
  const c = newton(q, centre);
  if (c && distance(c, centre) <= 2 * tolerance * Math.max(1, size(centre))) {
    let ok = true;
    let r = [...p];
    for (let j = 0; j < k - 1 && ok; j++) {
      ok = size(evaluateAt(r, c)) <= 1e-12 * magnitude(r, c);
      r = derivative(r);
    }
    if (ok) return Array.from({ length: k }, () => c);
  }
  if (tolerance <= 1e-7) return group.map(single);
  return groups(group, tolerance / 10).flatMap((g) => refine(p, g, tolerance / 10));
}

export const formatComplex = (z: Complex, digits = 10): string => {
  const f = (v: number) => String(Number(v.toPrecision(digits)) || 0);
  const imaginary = (v: number) => (Math.abs(v) === 1 ? 'i' : `${f(Math.abs(v))}i`);
  if (z.im === 0) return f(z.re);
  if (z.re === 0) return `${z.im < 0 ? '-' : ''}${imaginary(z.im)}`;
  return `${f(z.re)} ${z.im < 0 ? '-' : '+'} ${imaginary(z.im)}`;
};
