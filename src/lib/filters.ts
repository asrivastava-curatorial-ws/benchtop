/**
 * Filter design: Butterworth, Chebyshev (type I) and Bessel responses as
 * low-pass, high-pass, band-pass or band-stop filters, realised as op-amp
 * stages (Sallen-Key, multiple feedback), passive LC ladders, digital IIR
 * biquads (bilinear transform) or windowed-sinc FIR filters.
 */
import { type E_SERIES, nearest } from './components';

export type FilterKind = 'lowpass' | 'highpass' | 'bandpass' | 'bandstop';
export type Family = 'butterworth' | 'chebyshev' | 'bessel';

/* --------------------------------------------------------- complex maths -- */

export interface Complex {
  readonly re: number;
  readonly im: number;
}

const c = (re: number, im = 0): Complex => ({ re, im });
const add = (a: Complex, b: Complex) => c(a.re + b.re, a.im + b.im);
const sub = (a: Complex, b: Complex) => c(a.re - b.re, a.im - b.im);
const mul = (a: Complex, b: Complex) => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const scale = (a: Complex, k: number) => c(a.re * k, a.im * k);
function div(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im;
  return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
}
const abs = (a: Complex) => Math.hypot(a.re, a.im);
function csqrt(a: Complex): Complex {
  const r = abs(a);
  const re = Math.sqrt(Math.max(0, (r + a.re) / 2));
  const im = Math.sqrt(Math.max(0, (r - a.re) / 2));
  return c(re, a.im < 0 ? -im : im);
}

/* ------------------------------------------------------ analog prototypes -- */

export interface Prototype {
  /** Poles of the low-pass prototype with its edge at 1 rad/s (−3 dB, or the ripple edge for Chebyshev). */
  readonly poles: readonly Complex[];
  /** Passband gain at DC: 1, or 1/√(1+ε²) for even-order Chebyshev filters. */
  readonly dcGain: number;
}

function factorial(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

/** Roots of a monic polynomial (coefficients from the constant term up), by the Durand–Kerner method. */
function polyRoots(coefficients: readonly number[]): Complex[] {
  const n = coefficients.length - 1;
  const value = (z: Complex) => {
    let acc = c(1);
    for (let k = n - 1; k >= 0; k--) acc = add(mul(acc, z), c(coefficients[k] ?? 0));
    return acc;
  };
  let roots = Array.from({ length: n }, (_, i) => {
    const seed = c(0.4, 0.9);
    let z = c(1);
    for (let k = 0; k <= i; k++) z = mul(z, seed);
    return z;
  });
  for (let iteration = 0; iteration < 800; iteration++) {
    let moved = 0;
    roots = roots.map((z, i) => {
      let denominator = c(1);
      roots.forEach((w, j) => {
        if (j !== i) denominator = mul(denominator, sub(z, w));
      });
      const step = div(value(z), denominator);
      moved = Math.max(moved, abs(step));
      return sub(z, step);
    });
    if (moved < 1e-14) break;
  }
  return roots;
}

const besselCache = new Map<number, Complex[]>();

/** Bessel poles normalised for −3 dB at 1 rad/s. */
function besselPoles(n: number): Complex[] {
  const cached = besselCache.get(n);
  if (cached) return cached;
  // Reverse Bessel polynomial: a_k = (2n−k)! / (2^(n−k) k! (n−k)!), monic.
  const a = Array.from({ length: n + 1 }, (_, k) => factorial(2 * n - k) / (2 ** (n - k) * factorial(k) * factorial(n - k)));
  const roots = polyRoots(a);
  const magnitude = (w: number) => {
    let h = c(1);
    for (const p of roots) h = mul(h, div(scale(p, -1), sub(c(0, w), p)));
    return abs(h);
  };
  let lo = 0.01;
  let hi = 100;
  for (let i = 0; i < 200; i++) {
    const mid = Math.sqrt(lo * hi);
    if (magnitude(mid) > Math.SQRT1_2) lo = mid;
    else hi = mid;
  }
  const w3 = Math.sqrt(lo * hi);
  const poles = roots.map((p) => scale(c(p.re, Math.abs(p.im) < 1e-12 ? 0 : p.im), 1 / w3));
  besselCache.set(n, poles);
  return poles;
}

export function prototype(family: Family, order: number, rippleDb = 1): Prototype {
  const n = Math.max(1, Math.min(12, Math.round(order)));
  if (family === 'bessel') return { poles: besselPoles(n), dcGain: 1 };
  if (family === 'chebyshev') {
    const ripple = Math.max(0.01, rippleDb);
    const eps = Math.sqrt(10 ** (ripple / 10) - 1);
    const mu = Math.asinh(1 / eps) / n;
    const poles = Array.from({ length: n }, (_, k) => {
      const theta = ((2 * k + 1) * Math.PI) / (2 * n);
      return c(-Math.sinh(mu) * Math.sin(theta), Math.cosh(mu) * Math.cos(theta));
    });
    return { poles, dcGain: n % 2 === 0 ? 1 / Math.sqrt(1 + eps * eps) : 1 };
  }
  const poles = Array.from({ length: n }, (_, k) => {
    const theta = ((2 * k + 1) * Math.PI) / (2 * n) + Math.PI / 2;
    return c(Math.cos(theta), Math.sin(theta));
  });
  return { poles, dcGain: 1 };
}

/* ------------------------------------------------------ the analog filter -- */

export interface FilterSpec {
  readonly kind: FilterKind;
  readonly family: Family;
  readonly order: number;
  /** Chebyshev passband ripple in dB. */
  readonly rippleDb: number;
  /** Cutoff in Hz (low-pass and high-pass), or the lower edge (band filters). */
  readonly f1: number;
  /** Upper edge in Hz (band filters). */
  readonly f2: number;
}

export interface Zpk {
  readonly zeros: readonly Complex[];
  readonly poles: readonly Complex[];
  readonly gain: number;
}

/** Evaluates k·Π(s−z)/Π(s−p). */
export function evaluate(zpk: Zpk, s: Complex): Complex {
  let h = c(zpk.gain);
  for (const z of zpk.zeros) h = mul(h, sub(s, z));
  for (const p of zpk.poles) h = div(h, sub(s, p));
  return h;
}

/** Transforms the prototype to the requested kind and edges (in rad/s). */
export function analogZpk(spec: FilterSpec, w1: number, w2: number): Zpk {
  const proto = prototype(spec.family, spec.order, spec.rippleDb);
  const n = proto.poles.length;
  let zeros: Complex[] = [];
  let poles: Complex[] = [];
  let reference: Complex;
  if (spec.kind === 'lowpass') {
    poles = proto.poles.map((p) => scale(p, w1));
    reference = c(0);
  } else if (spec.kind === 'highpass') {
    poles = proto.poles.map((p) => div(c(w1), p));
    zeros = Array.from({ length: n }, () => c(0));
    reference = c(0, w1 * 1e6);
  } else {
    const w0 = Math.sqrt(w1 * w2);
    const bandwidth = w2 - w1;
    for (const p of proto.poles) {
      const b = spec.kind === 'bandpass' ? scale(p, bandwidth) : div(c(bandwidth), p);
      const root = csqrt(sub(mul(b, b), c(4 * w0 * w0)));
      poles.push(scale(add(b, root), 0.5), scale(sub(b, root), 0.5));
    }
    zeros = spec.kind === 'bandpass' ? Array.from({ length: n }, () => c(0)) : Array.from({ length: n }, () => [c(0, w0), c(0, -w0)]).flat();
    reference = spec.kind === 'bandpass' ? c(0, w0) : c(0);
  }
  const unscaled = abs(evaluate({ zeros, poles, gain: 1 }, reference));
  return { zeros, poles, gain: proto.dcGain / unscaled };
}

const TAU = 2 * Math.PI;

export function analogFilter(spec: FilterSpec): Zpk {
  return analogZpk(spec, TAU * spec.f1, TAU * spec.f2);
}

/* ---------------------------------------------------------- sections -- */

export interface Section {
  /** "lowpass", "highpass", "bandpass" or "notch" stage. */
  readonly type: 'lowpass' | 'highpass' | 'bandpass' | 'notch';
  /** 1 or 2. */
  readonly order: 1 | 2;
  /** Natural frequency in Hz. */
  readonly f0: number;
  /** Quality factor (second-order stages). */
  readonly q: number;
  /** For notch stages: the frequency of the zeros in Hz. */
  readonly fz?: number;
}

/** Splits poles into conjugate pairs (one representative with im > 0) and real poles. */
function groupPoles(poles: readonly Complex[]): { pairs: Complex[]; reals: Complex[] } {
  const tolerance = 1e-9 * Math.max(1, ...poles.map(abs));
  const pairs = poles.filter((p) => p.im > tolerance);
  const reals = poles.filter((p) => Math.abs(p.im) <= tolerance).map((p) => c(p.re));
  return { pairs: pairs.sort((a, b) => quality(a) - quality(b)), reals: reals.sort((a, b) => b.re - a.re) };
}

const quality = (p: Complex) => abs(p) / (-2 * p.re);

/** The stages of an analog design, lowest Q first. */
export function sections(spec: FilterSpec): Section[] {
  const zpk = analogFilter(spec);
  const { pairs, reals } = groupPoles(zpk.poles);
  const type = spec.kind === 'bandstop' ? 'notch' : spec.kind;
  const out: Section[] = pairs.map((p) => ({ type, order: 2, f0: abs(p) / TAU, q: quality(p), ...(spec.kind === 'bandstop' ? { fz: Math.sqrt(spec.f1 * spec.f2) } : {}) }));
  // Real poles: two at a time make a second-order stage with Q below 0.5, one is left over for odd orders.
  for (let i = 0; i + 1 < reals.length; i += 2) {
    const a = -(reals[i] as Complex).re;
    const b = -(reals[i + 1] as Complex).re;
    out.push({ type, order: 2, f0: Math.sqrt(a * b) / TAU, q: Math.sqrt(a * b) / (a + b), ...(spec.kind === 'bandstop' ? { fz: Math.sqrt(spec.f1 * spec.f2) } : {}) });
  }
  if (reals.length % 2 === 1) out.push({ type: spec.kind === 'highpass' ? 'highpass' : 'lowpass', order: 1, f0: -(reals[reals.length - 1] as Complex).re / TAU, q: 0 });
  return out.sort((a, b) => (a.order === b.order ? a.q - b.q : a.order - b.order));
}

/* --------------------------------------------------- response and order -- */

export interface ResponsePoint {
  readonly f: number;
  readonly db: number;
  readonly phase: number;
}

const unwrap = (phases: number[]) => {
  for (let i = 1; i < phases.length; i++) {
    let d = (phases[i] as number) - (phases[i - 1] as number);
    while (d > 180) {
      (phases[i] as number) -= 360;
      d -= 360;
    }
    while (d < -180) {
      (phases[i] as number) += 360;
      d += 360;
    }
  }
  return phases;
};

/** Logarithmically spaced frequencies. */
export function logSpace(from: number, to: number, count: number): number[] {
  const a = Math.log10(from);
  const b = Math.log10(to);
  return Array.from({ length: count }, (_, i) => 10 ** (a + ((b - a) * i) / (count - 1)));
}

function points(frequencies: readonly number[], h: (f: number) => Complex): ResponsePoint[] {
  const values = frequencies.map(h);
  const phases = unwrap(values.map((v) => (Math.atan2(v.im, v.re) * 180) / Math.PI));
  return values.map((v, i) => ({ f: frequencies[i] as number, db: 20 * Math.log10(Math.max(abs(v), 1e-15)), phase: phases[i] as number }));
}

export function analogResponse(zpk: Zpk, frequencies: readonly number[]): ResponsePoint[] {
  return points(frequencies, (f) => evaluate(zpk, c(0, TAU * f)));
}

/** Attenuation in dB of the prototype at a normalised frequency. */
function prototypeLoss(family: Family, order: number, rippleDb: number, omega: number): number {
  const proto = prototype(family, order, rippleDb);
  const zpk: Zpk = { zeros: [], poles: proto.poles, gain: 1 };
  const dc = abs(evaluate(zpk, c(0))) / proto.dcGain;
  return -20 * Math.log10(abs(evaluate(zpk, c(0, omega))) / dc);
}

/**
 * The normalised stopband frequency of a design: how far, in prototype terms,
 * `stopHz` lies from the passband.
 */
export function stopbandRatio(spec: Pick<FilterSpec, 'kind' | 'f1' | 'f2'>, stopHz: number): number {
  const f0sq = spec.f1 * spec.f2;
  const bw = spec.f2 - spec.f1;
  switch (spec.kind) {
    case 'lowpass':
      return stopHz / spec.f1;
    case 'highpass':
      return spec.f1 / stopHz;
    case 'bandpass':
      return Math.abs(stopHz * stopHz - f0sq) / (stopHz * bw);
    default:
      return (stopHz * bw) / Math.abs(f0sq - stopHz * stopHz);
  }
}

/** The lowest order (1–12) that attenuates `stopHz` by at least `attenuationDb`, or null. */
export function minimumOrder(spec: Omit<FilterSpec, 'order'>, stopHz: number, attenuationDb: number): number | null {
  const omega = stopbandRatio(spec, stopHz);
  if (!(omega > 1)) return null;
  for (let n = 1; n <= 12; n++) if (prototypeLoss(spec.family, n, spec.rippleDb, omega) >= attenuationDb) return n;
  return null;
}

/* ----------------------------------------------------------- op-amp stages -- */

export type Series = 'E12' | 'E24' | 'E96' | 'exact';

const pick = (value: number, series: Series) => (series === 'exact' ? value : nearest(value, series as keyof typeof E_SERIES).closest);

export interface Stage {
  readonly section: Section;
  /** "Sallen-Key", "Multiple feedback" or "RC". */
  readonly circuit: string;
  /** Component name → value (ohms or farads). */
  readonly parts: Readonly<Record<string, number>>;
  /** Natural frequency and Q with the rounded parts. */
  readonly actualF0: number;
  readonly actualQ: number;
  /** Passband gain of the stage. */
  readonly gain: number;
}

/**
 * Unity-gain op-amp stages for each section, built around the capacitor value
 * `baseC` (farads) and rounded to a preferred series.  Notch stages are not
 * built (use a twin-T or Fliege stage at the listed f0 and Q).
 */
export function opAmpStages(list: readonly Section[], baseC: number, series: Series): Stage[] {
  const out: Stage[] = [];
  for (const s of list) {
    const w = TAU * s.f0;
    if (s.order === 1) {
      const C = pick(baseC, series);
      const R = pick(1 / (w * C), series);
      out.push({ section: s, circuit: 'RC + buffer', parts: { R1: R, C1: C }, actualF0: 1 / (TAU * R * C), actualQ: 0, gain: 1 });
    } else if (s.type === 'lowpass') {
      // Sallen-Key, equal resistors: C1 (feedback) = 4Q²·C2, R = 1 / (ω0 · 2Q · C2).
      const C2 = pick(baseC, series);
      const C1 = pick(4 * s.q * s.q * C2, series);
      const R = pick(1 / (w * Math.sqrt(C1 * C2)), series);
      out.push({ section: s, circuit: 'Sallen-Key', parts: { R1: R, R2: R, C1, C2 }, actualF0: 1 / (TAU * R * Math.sqrt(C1 * C2)), actualQ: 0.5 * Math.sqrt(C1 / C2), gain: 1 });
    } else if (s.type === 'highpass') {
      // Sallen-Key, equal capacitors: R1 (feedback) = 1 / (2Q ω0 C), R2 = 2Q / (ω0 C).
      const C = pick(baseC, series);
      const R1 = pick(1 / (2 * s.q * w * C), series);
      const R2 = pick((2 * s.q) / (w * C), series);
      out.push({ section: s, circuit: 'Sallen-Key', parts: { R1, R2, C1: C, C2: C }, actualF0: 1 / (TAU * C * Math.sqrt(R1 * R2)), actualQ: 0.5 * Math.sqrt(R2 / R1), gain: 1 });
    } else if (s.type === 'bandpass') {
      // Multiple feedback with equal capacitors; the gain is cut below 1 for low-Q stages so the circuit stays buildable.
      const C = pick(baseC, series);
      const gain = Math.min(1, s.q * s.q);
      const R2 = pick((2 * s.q) / (w * C), series);
      const R1 = pick(R2 / (2 * gain), series);
      const R3 = pick((gain * R1) / (2 * s.q * s.q - gain), series);
      const parallel = (R1 * R3) / (R1 + R3);
      out.push({
        section: s,
        circuit: 'Multiple feedback',
        parts: { R1, R2, R3, C1: C, C2: C },
        actualF0: 1 / (TAU * C * Math.sqrt(R2 * parallel)),
        actualQ: 0.5 * Math.sqrt(R2 / parallel),
        gain: R2 / (2 * R1),
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------ LC ladders -- */

/** Normalised element values g1…gn and the load gn+1 (Butterworth and Chebyshev). */
export function ladderValues(family: Family, order: number, rippleDb: number): number[] | null {
  const n = Math.max(1, Math.min(12, Math.round(order)));
  if (family === 'butterworth') return [...Array.from({ length: n }, (_, k) => 2 * Math.sin(((2 * k + 1) * Math.PI) / (2 * n))), 1];
  if (family !== 'chebyshev') return null;
  const beta = Math.log(1 / Math.tanh(Math.max(0.01, rippleDb) / 17.37));
  const gamma = Math.sinh(beta / (2 * n));
  const a = (k: number) => Math.sin(((2 * k - 1) * Math.PI) / (2 * n));
  const b = (k: number) => gamma * gamma + Math.sin((k * Math.PI) / n) ** 2;
  const g = [(2 * a(1)) / gamma];
  for (let k = 2; k <= n; k++) g.push((4 * a(k - 1) * a(k)) / (b(k - 1) * (g[k - 2] as number)));
  g.push(n % 2 === 1 ? 1 : 1 / Math.tanh(beta / 4) ** 2);
  return g;
}

export interface LadderPart {
  readonly name: string;
  readonly role: 'series' | 'shunt';
  readonly kind: 'L' | 'C';
  readonly value: number;
}

/**
 * A doubly terminated LC ladder for a low-pass or high-pass design with source
 * resistance `r0`.  `start` chooses a shunt capacitor (Π) or series inductor
 * (T) as the first element of the low-pass form.
 */
export function ladder(spec: FilterSpec, r0: number, start: 'shunt' | 'series'): { parts: LadderPart[]; load: number } | null {
  if (spec.kind !== 'lowpass' && spec.kind !== 'highpass') return null;
  const g = ladderValues(spec.family, spec.order, spec.rippleDb);
  if (!g) return null;
  const w = TAU * spec.f1;
  const n = g.length - 1;
  const parts: LadderPart[] = [];
  let counts = { L: 0, C: 0 };
  for (let k = 0; k < n; k++) {
    const role: 'series' | 'shunt' = (k % 2 === 0) === (start === 'shunt') ? 'shunt' : 'series';
    const gk = g[k] as number;
    let kind: 'L' | 'C';
    let value: number;
    if (spec.kind === 'lowpass') {
      kind = role === 'shunt' ? 'C' : 'L';
      value = kind === 'C' ? gk / (r0 * w) : (gk * r0) / w;
    } else {
      kind = role === 'shunt' ? 'L' : 'C';
      value = kind === 'L' ? r0 / (gk * w) : 1 / (gk * r0 * w);
    }
    counts = { ...counts, [kind]: counts[kind] + 1 };
    parts.push({ name: `${kind}${counts[kind]}`, role, kind, value });
  }
  const last = g[n] as number;
  // g(n+1) is the load resistance after a shunt element, and the load conductance after a series one.
  const lastRole = parts[parts.length - 1]?.role;
  return { parts, load: lastRole === 'shunt' ? r0 * last : r0 / last };
}

/* ------------------------------------------------------------ digital IIR -- */

export interface Biquad {
  readonly b: readonly [number, number, number];
  readonly a: readonly [number, number, number];
}

/** Digital biquads by the bilinear transform with the edges pre-warped. */
export function iirSections(spec: FilterSpec, sampleRate: number): Biquad[] {
  const nyquist = sampleRate / 2;
  if (!(spec.f1 > 0 && spec.f1 < nyquist) || ((spec.kind === 'bandpass' || spec.kind === 'bandstop') && !(spec.f2 > spec.f1 && spec.f2 < nyquist))) {
    throw new Error(`The frequencies must lie between 0 and half the sample rate (${nyquist} Hz).`);
  }
  const warp = (f: number) => 2 * sampleRate * Math.tan((Math.PI * f) / sampleRate);
  const analog = analogZpk(spec, warp(spec.f1), warp(spec.f2));
  const k2 = 2 * sampleRate;
  const map = (s: Complex) => div(add(c(k2), s), sub(c(k2), s));
  const poles = analog.poles.map(map);
  const zeros = analog.zeros.map(map);
  // Zeros at infinity land on z = −1.
  while (zeros.length < poles.length) zeros.push(c(-1));
  const { pairs, reals } = groupPoles(poles.map((p) => c(p.re, p.im)));
  const zeroGroups = groupZeros(zeros);
  const biquads: Biquad[] = [];
  // Band-pass stages get one zero at z = 1 and one at z = −1 each.
  const positive = zeroGroups.reals.filter((z) => z.re > 0);
  const negative = zeroGroups.reals.filter((z) => z.re <= 0);
  const takeReal = (prefer: 'positive' | 'negative'): Complex => (prefer === 'positive' ? (positive.shift() ?? negative.shift()) : (negative.shift() ?? positive.shift())) ?? c(-1);
  const takeZeros = (count: 1 | 2): Complex[] => {
    if (count === 2) {
      const pair = zeroGroups.pairs.shift();
      if (pair) return [pair, c(pair.re, -pair.im)];
      return [takeReal('positive'), takeReal('negative')];
    }
    return [takeReal(spec.kind === 'highpass' ? 'positive' : 'negative')];
  };
  const quad = (z: Complex[], p: Complex[]): Biquad => {
    const [z1 = c(0), z2] = z;
    const [p1 = c(0), p2] = p;
    const b: [number, number, number] = z2 ? [1, -(z1.re + z2.re), mul(z1, z2).re] : [1, -z1.re, 0];
    const a: [number, number, number] = p2 ? [1, -(p1.re + p2.re), mul(p1, p2).re] : [1, -p1.re, 0];
    return { b, a };
  };
  for (const p of pairs) biquads.push(quad(takeZeros(2), [p, c(p.re, -p.im)]));
  for (let i = 0; i + 1 < reals.length; i += 2) biquads.push(quad(takeZeros(2), [reals[i] as Complex, reals[i + 1] as Complex]));
  if (reals.length % 2 === 1) biquads.push(quad(takeZeros(1), [reals[reals.length - 1] as Complex]));
  // Scale for the passband gain at the reference frequency, spread evenly over the stages.
  const w0 = 2 * Math.atan(Math.sqrt(warp(spec.f1) * warp(spec.f2)) / k2);
  const reference = spec.kind === 'highpass' ? Math.PI : spec.kind === 'bandpass' ? w0 : 0;
  const proto = prototype(spec.family, spec.order, spec.rippleDb);
  const now = abs(biquadResponseAt(biquads, reference));
  const each = (proto.dcGain / now) ** (1 / biquads.length);
  return biquads.map((q) => ({ b: [q.b[0] * each, q.b[1] * each, q.b[2] * each], a: q.a }));
}

function groupZeros(zeros: readonly Complex[]): { pairs: Complex[]; reals: Complex[] } {
  const pairs = zeros.filter((z) => z.im > 1e-9);
  const reals = zeros.filter((z) => Math.abs(z.im) <= 1e-9).map((z) => c(z.re));
  return { pairs, reals };
}

/** H(e^jω) of a cascade of biquads. */
export function biquadResponseAt(biquads: readonly Biquad[], omega: number): Complex {
  const z1 = c(Math.cos(-omega), Math.sin(-omega));
  const z2 = mul(z1, z1);
  let h = c(1);
  for (const q of biquads) {
    const num = add(add(c(q.b[0]), scale(z1, q.b[1])), scale(z2, q.b[2]));
    const den = add(add(c(q.a[0]), scale(z1, q.a[1])), scale(z2, q.a[2]));
    h = mul(h, div(num, den));
  }
  return h;
}

export function iirResponse(biquads: readonly Biquad[], sampleRate: number, frequencies: readonly number[]): ResponsePoint[] {
  return points(frequencies, (f) => biquadResponseAt(biquads, (TAU * f) / sampleRate));
}

/** Runs a signal through the cascade (direct form II transposed). */
export function runBiquads(biquads: readonly Biquad[], input: readonly number[]): number[] {
  let signal = [...input];
  for (const q of biquads) {
    let s1 = 0;
    let s2 = 0;
    signal = signal.map((x) => {
      const y = q.b[0] * x + s1;
      s1 = q.b[1] * x - q.a[1] * y + s2;
      s2 = q.b[2] * x - q.a[2] * y;
      return y;
    });
  }
  return signal;
}

/**
 * The step response of an analog design, simulated digitally at a high rate.
 * Returns times in seconds and output values.
 */
export function analogStep(spec: FilterSpec, points = 400): { t: number[]; y: number[] } {
  const top = spec.kind === 'lowpass' || spec.kind === 'highpass' ? spec.f1 : spec.f2;
  const sampleRate = top * 200;
  const duration = (spec.kind === 'bandpass' || spec.kind === 'bandstop' ? 20 : 8) / Math.max(spec.f1, 1e-12);
  const count = Math.min(200_000, Math.ceil(duration * sampleRate));
  const biquads = iirSections(spec, sampleRate);
  const y = runBiquads(
    biquads,
    Array.from({ length: count }, () => 1),
  );
  const stride = Math.max(1, Math.floor(count / points));
  const t: number[] = [];
  const out: number[] = [];
  for (let i = 0; i < count; i += stride) {
    t.push(i / sampleRate);
    out.push(y[i] as number);
  }
  return { t, y: out };
}

/* ------------------------------------------------------------ digital FIR -- */

export type FirWindow = 'hamming' | 'hann' | 'blackman' | 'kaiser';

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 60; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

/** Kaiser β for a stopband attenuation in dB. */
export function kaiserBeta(attenuationDb: number): number {
  const a = attenuationDb;
  if (a > 50) return 0.1102 * (a - 8.7);
  if (a >= 21) return 0.5842 * (a - 21) ** 0.4 + 0.07886 * (a - 21);
  return 0;
}

/** Taps needed for a Kaiser window: (A − 8) / (2.285 · Δω) + 1, made odd. */
export function kaiserTaps(attenuationDb: number, transitionHz: number, sampleRate: number): number {
  const n = Math.ceil((attenuationDb - 8) / (2.285 * ((TAU * transitionHz) / sampleRate)) + 1);
  return Math.max(3, n % 2 === 0 ? n + 1 : n);
}

function windowValue(kind: FirWindow, i: number, n: number, beta: number): number {
  const m = n - 1;
  if (m === 0) return 1;
  const x = (TAU * i) / m;
  switch (kind) {
    case 'hann':
      return 0.5 - 0.5 * Math.cos(x);
    case 'blackman':
      return 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
    case 'kaiser': {
      const r = (2 * i) / m - 1;
      return besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / besselI0(beta);
    }
    default:
      return 0.54 - 0.46 * Math.cos(x);
  }
}

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

/** Windowed-sinc taps (an odd count, so high-pass and band-stop work). */
export function firTaps(kind: FilterKind, f1: number, f2: number, sampleRate: number, count: number, window: FirWindow, kaiserAttenuation = 60): number[] {
  const n = Math.max(3, Math.round(count) % 2 === 0 ? Math.round(count) + 1 : Math.round(count));
  const middle = (n - 1) / 2;
  const beta = kaiserBeta(kaiserAttenuation);
  const lowpass = (fc: number) => Array.from({ length: n }, (_, i) => ((2 * fc) / sampleRate) * sinc(((2 * fc) / sampleRate) * (i - middle)) * windowValue(window, i, n, beta));
  const sum = (h: number[]) => h.reduce((a, b) => a + b, 0);
  const normalised = (h: number[]) => {
    const total = sum(h);
    return h.map((v) => v / total);
  };
  const delta = (i: number) => (i === middle ? 1 : 0);
  if (kind === 'lowpass') return normalised(lowpass(f1));
  if (kind === 'highpass') {
    const lp = normalised(lowpass(f1));
    return lp.map((v, i) => delta(i) - v);
  }
  const low = normalised(lowpass(f1));
  const high = normalised(lowpass(f2));
  if (kind === 'bandpass') {
    const bp = high.map((v, i) => v - (low[i] as number));
    const centre = (TAU * Math.sqrt(f1 * f2)) / sampleRate;
    const gain = abs(firResponseAt(bp, centre));
    return bp.map((v) => v / gain);
  }
  return low.map((v, i) => v + delta(i) - (high[i] as number));
}

export function firResponseAt(taps: readonly number[], omega: number): Complex {
  let re = 0;
  let im = 0;
  taps.forEach((h, n) => {
    re += h * Math.cos(omega * n);
    im -= h * Math.sin(omega * n);
  });
  return c(re, im);
}

export function firResponse(taps: readonly number[], sampleRate: number, frequencies: readonly number[]): ResponsePoint[] {
  return points(frequencies, (f) => firResponseAt(taps, (TAU * f) / sampleRate));
}

/* ------------------------------------------------------------- code export -- */

const num = (v: number) => (Object.is(v, -0) ? '0' : Number(v.toPrecision(10)).toString());

export function iirCode(biquads: readonly Biquad[], language: 'c' | 'python', sampleRate: number, title: string): string {
  if (language === 'python') {
    return `# ${title}, sample rate ${sampleRate} Hz
# Second-order sections for scipy.signal.sosfilt: [b0, b1, b2, 1, a1, a2]
import numpy as np
from scipy.signal import sosfilt

sos = np.array([
${biquads.map((q) => `    [${[q.b[0], q.b[1], q.b[2], 1, q.a[1], q.a[2]].map(num).join(', ')}],`).join('\n')}
])

# filtered = sosfilt(sos, signal)
`;
  }
  return `// ${title}, sample rate ${sampleRate} Hz
// Cascade of ${biquads.length} biquad${biquads.length === 1 ? '' : 's'} (direct form II transposed). Works on Arduino, ESP32 and desktop C.
#define SECTIONS ${biquads.length}

static const float B[SECTIONS][3] = {
${biquads.map((q) => `  { ${q.b.map((v) => `${num(v)}f`).join(', ')} },`).join('\n')}
};
static const float A[SECTIONS][2] = {
${biquads.map((q) => `  { ${num(q.a[1])}f, ${num(q.a[2])}f },`).join('\n')}
};
static float state[SECTIONS][2];

float filter_sample(float x) {
  for (int i = 0; i < SECTIONS; i++) {
    float y = B[i][0] * x + state[i][0];
    state[i][0] = B[i][1] * x - A[i][0] * y + state[i][1];
    state[i][1] = B[i][2] * x - A[i][1] * y;
    x = y;
  }
  return x;
}
`;
}

export function firCode(taps: readonly number[], language: 'c' | 'python', sampleRate: number, title: string): string {
  if (language === 'python') {
    return `# ${title}, sample rate ${sampleRate} Hz, ${taps.length} taps
import numpy as np
from scipy.signal import lfilter

taps = np.array([
${chunk(taps.map(num), 6)
  .map((row) => `    ${row.join(', ')},`)
  .join('\n')}
])

# filtered = lfilter(taps, 1.0, signal)
`;
  }
  return `// ${title}, sample rate ${sampleRate} Hz, ${taps.length} taps
#define TAPS ${taps.length}

static const float H[TAPS] = {
${chunk(
  taps.map((v) => `${num(v)}f`),
  6,
)
  .map((row) => `  ${row.join(', ')},`)
  .join('\n')}
};
static float history[TAPS];
static int head = 0;

float filter_sample(float x) {
  history[head] = x;
  float y = 0;
  int k = head;
  for (int i = 0; i < TAPS; i++) {
    y += H[i] * history[k];
    k = (k == 0) ? TAPS - 1 : k - 1;
  }
  head = (head + 1) % TAPS;
  return y;
}
`;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** −3 dB frequency (or frequencies) read from a response, by interpolation. */
export function crossings(points: readonly ResponsePoint[], level: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as ResponsePoint;
    const b = points[i] as ResponsePoint;
    if ((a.db - level) * (b.db - level) < 0) {
      const t = (level - a.db) / (b.db - a.db);
      out.push(10 ** (Math.log10(a.f) + t * (Math.log10(b.f) - Math.log10(a.f))));
    }
  }
  return out;
}
