/**
 * Statistics for the Statistics tool: descriptive measures, correlation,
 * least-squares regression, t-tests and one-way ANOVA, with p-values from the
 * t and F distributions (regularised incomplete beta function).
 */

export interface Description {
  readonly n: number;
  readonly missing: number;
  readonly sum: number;
  readonly mean: number;
  readonly median: number;
  readonly modes: number[];
  readonly sd: number;
  readonly variance: number;
  readonly se: number;
  readonly min: number;
  readonly q1: number;
  readonly q3: number;
  readonly max: number;
  readonly iqr: number;
  readonly skewness: number;
  readonly kurtosis: number;
  readonly cv: number;
}

/** Quantile by linear interpolation between order statistics (type 7, as in Excel and R). */
export function quantile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return Number.NaN;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return (sorted[lo] as number) + (h - lo) * ((sorted[hi] as number) - (sorted[lo] as number));
}

export const mean = (v: readonly number[]) => v.reduce((s, x) => s + x, 0) / v.length;

export function describe(raw: readonly (number | null)[]): Description {
  const v = raw.filter((x): x is number => x !== null && Number.isFinite(x));
  const n = v.length;
  const sorted = [...v].sort((a, b) => a - b);
  const m = n ? mean(v) : Number.NaN;
  const ss = v.reduce((s, x) => s + (x - m) ** 2, 0);
  const variance = n > 1 ? ss / (n - 1) : Number.NaN;
  const sd = Math.sqrt(variance);
  const m2 = ss / n;
  const m3 = v.reduce((s, x) => s + (x - m) ** 3, 0) / n;
  const m4 = v.reduce((s, x) => s + (x - m) ** 4, 0) / n;
  // Adjusted Fisher–Pearson skewness and excess kurtosis, as spreadsheets report them.
  const skewness = n > 2 ? (Math.sqrt(n * (n - 1)) / (n - 2)) * (m3 / m2 ** 1.5) : Number.NaN;
  const kurtosis = n > 3 ? ((n - 1) / ((n - 2) * (n - 3))) * ((n + 1) * (m4 / (m2 * m2) - 3) + 6) : Number.NaN;
  const counts = new Map<number, number>();
  for (const x of v) counts.set(x, (counts.get(x) ?? 0) + 1);
  const top = Math.max(0, ...counts.values());
  const modes =
    top > 1
      ? [...counts]
          .filter(([, c]) => c === top)
          .map(([x]) => x)
          .sort((a, b) => a - b)
      : [];
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  return {
    n,
    missing: raw.length - n,
    sum: v.reduce((s, x) => s + x, 0),
    mean: m,
    median: quantile(sorted, 0.5),
    modes,
    sd,
    variance,
    se: sd / Math.sqrt(n),
    min: sorted[0] ?? Number.NaN,
    q1,
    q3,
    max: sorted[n - 1] ?? Number.NaN,
    iqr: q3 - q1,
    skewness,
    kurtosis,
    cv: sd / Math.abs(m),
  };
}

/* ------------------------------------------------------------- functions -- */

function logGamma(x: number): number {
  // Lanczos approximation (g = 7, n = 9), accurate to about 15 digits.
  const c = [0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406, 12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
  const z = x - 1;
  let a = c[0] as number;
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += (c[i] as number) / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the incomplete beta function (Numerical Recipes betacf). */
function betaFraction(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a - 1 + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return h;
}

/** Regularised incomplete beta I_x(a, b). */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaFraction(a, b, x)) / a : 1 - (front * betaFraction(b, a, 1 - x)) / b;
}

/** Two-sided p-value of a t statistic with `df` degrees of freedom. */
export const tTwoSided = (t: number, df: number) => (Number.isFinite(t) ? incompleteBeta(df / (df + t * t), df / 2, 0.5) : 0);

/** Upper-tail p-value of an F statistic. */
export const fUpper = (f: number, d1: number, d2: number) => (f > 0 ? incompleteBeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2) : 1);

/** Critical t value for a two-sided confidence level, by bisection. */
export function tCritical(confidence: number, df: number): number {
  const alpha = 1 - confidence;
  let lo = 0;
  let hi = 1000;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tTwoSided(mid, df) > alpha) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/* ------------------------------------------------------------ relations -- */

function pairs(x: readonly (number | null)[], y: readonly (number | null)[]): [number[], number[]] {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const a = x[i];
    const b = y[i];
    if (a !== null && b !== null && a !== undefined && b !== undefined && Number.isFinite(a) && Number.isFinite(b)) {
      xs.push(a);
      ys.push(b);
    }
  }
  return [xs, ys];
}

export function pearson(x: readonly (number | null)[], y: readonly (number | null)[]): { r: number; n: number; p: number } {
  const [xs, ys] = pairs(x, y);
  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += ((xs[i] as number) - mx) * ((ys[i] as number) - my);
    sxx += ((xs[i] as number) - mx) ** 2;
    syy += ((ys[i] as number) - my) ** 2;
  }
  const r = sxy / Math.sqrt(sxx * syy);
  const t = (r * Math.sqrt(n - 2)) / Math.sqrt(Math.max(1e-300, 1 - r * r));
  return { r, n, p: n > 2 ? tTwoSided(t, n - 2) : Number.NaN };
}

/** Ranks with ties given their average rank. */
export function ranks(v: readonly number[]): number[] {
  const order = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(v.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && (order[j + 1] as readonly [number, number])[0] === (order[i] as readonly [number, number])[0]) j++;
    for (let k = i; k <= j; k++) out[(order[k] as readonly [number, number])[1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

export function spearman(x: readonly (number | null)[], y: readonly (number | null)[]): { rho: number; n: number; p: number } {
  const [xs, ys] = pairs(x, y);
  const { r, n, p } = pearson(ranks(xs), ranks(ys));
  return { rho: r, n, p };
}

export interface Regression {
  readonly n: number;
  readonly slope: number;
  readonly intercept: number;
  readonly r2: number;
  readonly slopeSe: number;
  readonly interceptSe: number;
  readonly t: number;
  readonly p: number;
  readonly residualSe: number;
}

/** Ordinary least squares y = intercept + slope·x. */
export function linearRegression(x: readonly (number | null)[], y: readonly (number | null)[]): Regression {
  const [xs, ys] = pairs(x, y);
  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += ((xs[i] as number) - mx) * ((ys[i] as number) - my);
    sxx += ((xs[i] as number) - mx) ** 2;
    syy += ((ys[i] as number) - my) ** 2;
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const sse = syy - slope * sxy;
  const residualSe = Math.sqrt(Math.max(0, sse) / (n - 2));
  const slopeSe = residualSe / Math.sqrt(sxx);
  const interceptSe = residualSe * Math.sqrt(1 / n + (mx * mx) / sxx);
  const t = slope / slopeSe;
  return { n, slope, intercept, r2: syy ? 1 - sse / syy : 1, slopeSe, interceptSe, t, p: n > 2 ? tTwoSided(t, n - 2) : Number.NaN, residualSe };
}

export interface TTest {
  readonly t: number;
  readonly df: number;
  readonly p: number;
  readonly difference: number;
  readonly low: number;
  readonly high: number;
}

/** Welch's t-test for two independent samples (unequal variances); 95% interval for the difference. */
export function welchTTest(a: readonly (number | null)[], b: readonly (number | null)[]): TTest {
  const da = describe(a);
  const db = describe(b);
  const va = da.variance / da.n;
  const vb = db.variance / db.n;
  const t = (da.mean - db.mean) / Math.sqrt(va + vb);
  const df = (va + vb) ** 2 / (va ** 2 / (da.n - 1) + vb ** 2 / (db.n - 1));
  const half = tCritical(0.95, df) * Math.sqrt(va + vb);
  const difference = da.mean - db.mean;
  return { t, df, p: tTwoSided(t, df), difference, low: difference - half, high: difference + half };
}

/** Paired t-test on the differences a − b. */
export function pairedTTest(a: readonly (number | null)[], b: readonly (number | null)[]): TTest {
  const [xs, ys] = pairs(a, b);
  const d = describe(xs.map((x, i) => x - (ys[i] as number)));
  const t = d.mean / d.se;
  const df = d.n - 1;
  const half = tCritical(0.95, df) * d.se;
  return { t, df, p: tTwoSided(t, df), difference: d.mean, low: d.mean - half, high: d.mean + half };
}

/** One-sample t-test against a hypothesised mean. */
export function oneSampleTTest(a: readonly (number | null)[], mu: number): TTest {
  const d = describe(a);
  const t = (d.mean - mu) / d.se;
  const df = d.n - 1;
  const half = tCritical(0.95, df) * d.se;
  return { t, df, p: tTwoSided(t, df), difference: d.mean - mu, low: d.mean - mu - half, high: d.mean - mu + half };
}

export interface Anova {
  readonly groups: { name: string; n: number; mean: number; sd: number }[];
  readonly f: number;
  readonly dfBetween: number;
  readonly dfWithin: number;
  readonly p: number;
  readonly etaSquared: number;
}

/** One-way analysis of variance across named groups. */
export function oneWayAnova(groups: ReadonlyMap<string, readonly number[]>): Anova {
  const all = [...groups.values()].flat();
  const grand = mean(all);
  let ssb = 0;
  let ssw = 0;
  const out: Anova['groups'] = [];
  for (const [name, values] of groups) {
    const d = describe(values);
    ssb += d.n * (d.mean - grand) ** 2;
    ssw += values.reduce((s, x) => s + (x - d.mean) ** 2, 0);
    out.push({ name, n: d.n, mean: d.mean, sd: d.sd });
  }
  const dfBetween = groups.size - 1;
  const dfWithin = all.length - groups.size;
  const f = ssb / dfBetween / (ssw / dfWithin);
  return { groups: out, f, dfBetween, dfWithin, p: fUpper(f, dfBetween, dfWithin), etaSquared: ssb / (ssb + ssw) };
}

/** A p-value in words for the 5% level. */
export const significance = (p: number) =>
  !Number.isFinite(p)
    ? 'not enough data'
    : p < 0.001
      ? 'p < 0.001: very strong evidence'
      : p < 0.01
        ? `p = ${p.toFixed(3)}: strong evidence`
        : p < 0.05
          ? `p = ${p.toFixed(3)}: significant at 5%`
          : `p = ${p.toFixed(3)}: not significant at 5%`;
