/**
 * Models for the Biology Lab: population growth (exponential, logistic,
 * harvested), predator and prey, epidemics (SIR and SEIR with vaccination),
 * enzyme kinetics with inhibitors, the Hodgkin–Huxley neuron, diffusion
 * between compartments and osmotic pressure.
 */

type Derivative = (t: number, y: readonly number[]) => number[];

function rk4(f: Derivative, t: number, y: readonly number[], h: number): number[] {
  const add = (a: readonly number[], k: readonly number[], s: number) => a.map((v, i) => v + s * (k[i] ?? 0));
  const k1 = f(t, y);
  const k2 = f(t + h / 2, add(y, k1, h / 2));
  const k3 = f(t + h / 2, add(y, k2, h / 2));
  const k4 = f(t + h, add(y, k3, h));
  return y.map((v, i) => v + (h / 6) * ((k1[i] ?? 0) + 2 * (k2[i] ?? 0) + 2 * (k3[i] ?? 0) + (k4[i] ?? 0)));
}

/** Integrates from t = 0 to tEnd, keeping about `samples` evenly spaced results. */
export function integrate(f: Derivative, y0: readonly number[], tEnd: number, h: number, samples = 400): { t: number[]; y: number[][] } {
  const steps = Math.max(1, Math.ceil(tEnd / h));
  const dt = tEnd / steps;
  const every = Math.max(1, Math.floor(steps / samples));
  const t: number[] = [0];
  const y: number[][] = [[...y0]];
  let cur = [...y0];
  for (let i = 1; i <= steps; i++) {
    cur = rk4(f, (i - 1) * dt, cur, dt);
    if (i % every === 0 || i === steps) {
      t.push(i * dt);
      y.push(cur);
    }
  }
  return { t, y };
}

/* ---------------------------------------------------- population growth -- */

export const exponential = (n0: number, r: number, t: number) => n0 * Math.exp(r * t);

/**
 * Logistic growth with proportional harvesting h (fraction taken per unit
 * time): the same curve with r − h and a lower ceiling K(1 − h/r).
 */
export function logistic(n0: number, r: number, k: number, t: number, harvest = 0): number {
  const rr = r - harvest;
  if (Math.abs(rr) < 1e-12) return n0 / (1 + (r / k) * n0 * t);
  const kk = (rr * k) / r;
  const e = Math.exp(rr * t);
  return (kk * n0 * e) / (kk + n0 * (e - 1));
}

/* -------------------------------------------------------- predator, prey -- */

export interface PredatorPrey {
  /** Prey birth rate, rate predators eat prey, predator gain per prey eaten, predator death rate. */
  readonly alpha: number;
  readonly beta: number;
  readonly delta: number;
  readonly gamma: number;
  /** Carrying capacity for the prey (Infinity: none). */
  readonly k: number;
}

export const lotkaVolterra =
  (p: PredatorPrey): Derivative =>
  (_t, [x = 0, y = 0]) => [p.alpha * x * (1 - x / p.k) - p.beta * x * y, p.delta * x * y - p.gamma * y];

/** The quantity that stays constant round each cycle when the prey have no ceiling. */
export const lvInvariant = (p: PredatorPrey, x: number, y: number) => p.delta * x - p.gamma * Math.log(x) + p.beta * y - p.alpha * Math.log(y);

/* ------------------------------------------------------------- epidemics -- */

export interface Epidemic {
  readonly population: number;
  /** Basic reproduction number, days infectious, days incubating (0 for SIR). */
  readonly r0: number;
  readonly infectious: number;
  readonly latent: number;
  /** Fraction immune by vaccination at the start, and the number infected at the start. */
  readonly vaccinated: number;
  readonly seed: number;
  readonly days: number;
}

export interface EpidemicRun {
  readonly t: number[];
  readonly s: number[];
  readonly e: number[];
  readonly i: number[];
  readonly r: number[];
  readonly peak: number;
  readonly peakDay: number;
  /** Everyone ever infected (not counting the vaccinated). */
  readonly total: number;
}

export function epidemic(p: Epidemic): EpidemicRun {
  const n = p.population;
  const gamma = 1 / p.infectious;
  const beta = p.r0 * gamma;
  const sigma = p.latent > 0 ? 1 / p.latent : 0;
  const vacc = p.vaccinated * n;
  const f: Derivative = (_t, [s = 0, e = 0, i = 0]) => {
    const infect = (beta * s * i) / n;
    return sigma > 0 ? [-infect, infect - sigma * e, sigma * e - gamma * i, gamma * i] : [-infect, 0, infect - gamma * i, gamma * i];
  };
  const run = integrate(f, [n - vacc - p.seed, 0, p.seed, vacc], p.days, 0.05, 600);
  const col = (k: number) => run.y.map((v) => v[k] ?? 0);
  const i = col(2);
  let peak = 0;
  let peakDay = 0;
  i.forEach((v, k) => {
    if (v > peak) {
      peak = v;
      peakDay = run.t[k] ?? 0;
    }
  });
  const s = col(0);
  return { t: run.t, s, e: col(1), i, r: col(3), peak, peakDay, total: n - vacc - (s[s.length - 1] ?? 0) };
}

/** The fraction a simple epidemic eventually infects: z = 1 − e^(−R₀z). */
export function finalSize(r0: number): number {
  if (r0 <= 1) return 0;
  let z = 0.5;
  for (let k = 0; k < 200; k++) z = 1 - Math.exp(-r0 * z);
  return z;
}

/* ------------------------------------------------------------- enzymes -- */

export type Inhibition = 'none' | 'competitive' | 'noncompetitive' | 'uncompetitive';

/** Michaelis–Menten with an inhibitor at concentration i (inhibition constant ki): apparent Vmax and Km, and the rate at s. */
export function enzyme(s: number, vmax: number, km: number, mode: Inhibition, i: number, ki: number) {
  const a = 1 + i / ki;
  const v = mode === 'competitive' ? vmax : mode === 'noncompetitive' ? vmax / a : mode === 'uncompetitive' ? vmax / a : vmax;
  const k = mode === 'competitive' ? km * a : mode === 'uncompetitive' ? km / a : km;
  return { vmax: v, km: k, rate: (v * s) / (k + s) };
}

/** Km and Vmax from measured rates, by a straight line through 1/v against 1/[S] (Lineweaver–Burk). */
export function lineweaverBurk(points: readonly (readonly [number, number])[]) {
  const pts = points.filter(([s, v]) => s > 0 && v > 0).map(([s, v]) => [1 / s, 1 / v] as const);
  const n = pts.length;
  if (n < 2) return null;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n;
  const my = pts.reduce((a, p) => a + p[1], 0) / n;
  const sxx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  const sxy = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0);
  const syy = pts.reduce((a, p) => a + (p[1] - my) ** 2, 0);
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  return { slope, intercept, vmax: 1 / intercept, km: slope / intercept, r2: syy > 0 ? (sxy * sxy) / (sxx * syy) : 1 };
}

/* ------------------------------------------------------- Hodgkin–Huxley -- */

/** Standard squid-axon constants (mS/cm², mV, µF/cm²), with rest at −65 mV. */
export const HH = { gNa: 120, gK: 36, gL: 0.3, eNa: 50, eK: -77, eL: -54.387, c: 1 } as const;

const rates = (v: number) => {
  const am = Math.abs(v + 40) < 1e-7 ? 1 : (0.1 * (v + 40)) / (1 - Math.exp(-(v + 40) / 10));
  const bm = 4 * Math.exp(-(v + 65) / 18);
  const ah = 0.07 * Math.exp(-(v + 65) / 20);
  const bh = 1 / (1 + Math.exp(-(v + 35) / 10));
  const an = Math.abs(v + 55) < 1e-7 ? 0.1 : (0.01 * (v + 55)) / (1 - Math.exp(-(v + 55) / 10));
  const bn = 0.125 * Math.exp(-(v + 65) / 80);
  return { am, bm, ah, bh, an, bn };
};

export interface Stimulus {
  /** Current (µA/cm²), when it starts and how long each pulse lasts (ms), and the gap between pulses (0: one pulse). */
  readonly current: number;
  readonly start: number;
  readonly width: number;
  readonly every: number;
}

export const stimulusAt = (s: Stimulus, t: number) => {
  if (t < s.start) return 0;
  const into = s.every > 0 ? (t - s.start) % s.every : t - s.start;
  return into < s.width ? s.current : 0;
};

export function neuron(stim: Stimulus, tEnd: number, dt = 0.01) {
  const v0 = -65;
  const r0 = rates(v0);
  const y0 = [v0, r0.am / (r0.am + r0.bm), r0.ah / (r0.ah + r0.bh), r0.an / (r0.an + r0.bn)];
  const f: Derivative = (t, [v = 0, m = 0, h = 0, n = 0]) => {
    const r = rates(v);
    const iNa = HH.gNa * m ** 3 * h * (v - HH.eNa);
    const iK = HH.gK * n ** 4 * (v - HH.eK);
    const iL = HH.gL * (v - HH.eL);
    return [(stimulusAt(stim, t) - iNa - iK - iL) / HH.c, r.am * (1 - m) - r.bm * m, r.ah * (1 - h) - r.bh * h, r.an * (1 - n) - r.bn * n];
  };
  const run = integrate(f, y0, tEnd, dt, 2000);
  const v = run.y.map((x) => x[0] ?? 0);
  // A spike is an upward crossing of 0 mV.
  const spikes: number[] = [];
  for (let k = 1; k < v.length; k++) if ((v[k - 1] ?? 0) < 0 && (v[k] ?? 0) >= 0) spikes.push(run.t[k] ?? 0);
  return { t: run.t, v, m: run.y.map((x) => x[1] ?? 0), h: run.y.map((x) => x[2] ?? 0), n: run.y.map((x) => x[3] ?? 0), spikes };
}

/* ------------------------------------------------- diffusion and osmosis -- */

/**
 * Two equal compartments joined by a membrane: the difference in amount
 * decays as e^(−2kt), where k is the fraction crossing per unit time.
 */
export const twoCompartments = (left0: number, right0: number, k: number, t: number) => {
  const mean = (left0 + right0) / 2;
  const diff = ((left0 - right0) / 2) * Math.exp(-2 * k * t);
  return [mean + diff, mean - diff] as const;
};

export const GAS_CONSTANT = 8.314462618;

/** Van ’t Hoff: osmotic pressure (Pa) of a solution of molarity M (mol/L) with i particles per formula unit at T kelvin. */
export const osmoticPressure = (molarity: number, i: number, kelvin: number) => i * molarity * 1000 * GAS_CONSTANT * kelvin;
