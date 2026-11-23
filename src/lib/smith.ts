/**
 * Smith chart maths: reflection coefficient, VSWR and losses for a load,
 * moving along a transmission line, and two-element (L) matching networks.
 */

export interface Complex {
  readonly re: number;
  readonly im: number;
}

const c = (re: number, im = 0): Complex => ({ re, im });
export const cAdd = (a: Complex, b: Complex): Complex => c(a.re + b.re, a.im + b.im);
export const cSub = (a: Complex, b: Complex): Complex => c(a.re - b.re, a.im - b.im);
export const cMul = (a: Complex, b: Complex): Complex => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
export function cDiv(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im;
  return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
}
export const cAbs = (a: Complex): number => Math.hypot(a.re, a.im);
export const cArg = (a: Complex): number => (Math.atan2(a.im, a.re) * 180) / Math.PI;
const ONE = c(1);

/** Γ = (Z − Z0) / (Z + Z0). */
export const gammaOf = (z: Complex, z0: number): Complex => cDiv(cSub(z, c(z0)), cAdd(z, c(z0)));
/** Z = Z0 (1 + Γ) / (1 − Γ). */
export const impedanceOf = (gamma: Complex, z0: number): Complex => {
  const z = cDiv(cAdd(ONE, gamma), cSub(ONE, gamma));
  return c(z.re * z0, z.im * z0);
};

export interface LoadFacts {
  readonly gamma: Complex;
  readonly magnitude: number;
  readonly angle: number;
  readonly vswr: number;
  /** Return loss in dB (positive; Infinity for a perfect match). */
  readonly returnLoss: number;
  /** Power lost to the reflection, dB. */
  readonly mismatchLoss: number;
  /** Fraction of the power reflected. */
  readonly reflected: number;
  readonly admittance: Complex;
}

export function loadFacts(z: Complex, z0: number): LoadFacts {
  const gamma = gammaOf(z, z0);
  const magnitude = cAbs(gamma);
  const reflected = magnitude * magnitude;
  return {
    gamma,
    magnitude,
    angle: cArg(gamma),
    vswr: magnitude >= 1 ? Number.POSITIVE_INFINITY : (1 + magnitude) / (1 - magnitude),
    returnLoss: magnitude === 0 ? Number.POSITIVE_INFINITY : -20 * Math.log10(magnitude),
    mismatchLoss: reflected >= 1 ? Number.POSITIVE_INFINITY : -10 * Math.log10(1 - reflected),
    reflected,
    admittance: cDiv(ONE, z),
  };
}

/** The impedance with VSWR `vswr` at angle `angleDeg` of Γ. */
export function fromVswr(vswr: number, angleDeg: number, z0: number): Complex {
  const m = (vswr - 1) / (vswr + 1);
  const a = (angleDeg * Math.PI) / 180;
  return impedanceOf(c(m * Math.cos(a), m * Math.sin(a)), z0);
}

/** Input impedance of a lossless line of `wavelengths` electrical length ending in `z`. */
export function alongLine(z: Complex, z0: number, wavelengths: number): Complex {
  const t = Math.tan(2 * Math.PI * wavelengths);
  if (!Number.isFinite(t) || Math.abs(t) > 1e12) return cDiv(c(z0 * z0), z);
  return cMul(c(z0), cDiv(cAdd(z, c(0, z0 * t)), cAdd(c(z0), cMul(c(0, t), z))));
}

export interface MatchPart {
  readonly where: 'series' | 'shunt';
  readonly kind: 'L' | 'C';
  /** Henries or farads. */
  readonly value: number;
  /** Reactance (series) or susceptance (shunt). */
  readonly x: number;
}

export interface Match {
  /** Element next to the load first, then the one towards the source. */
  readonly parts: readonly [MatchPart, MatchPart];
  /** "shunt first" when the shunt element sits at the load. */
  readonly layout: 'shunt-at-load' | 'series-at-load';
  /** The impedance seen after the first element. */
  readonly middle: Complex;
}

function seriesPart(x: number, w: number): MatchPart {
  return x >= 0 ? { where: 'series', kind: 'L', value: x / w, x } : { where: 'series', kind: 'C', value: -1 / (w * x), x };
}
function shuntPart(b: number, w: number): MatchPart {
  return b >= 0 ? { where: 'shunt', kind: 'C', value: b / w, x: b } : { where: 'shunt', kind: 'L', value: -1 / (w * b), x: b };
}

/** All lossless L networks that match `z` to `z0` at `frequency` Hz (after Pozar, Microwave Engineering §5.1). */
export function lMatches(z: Complex, z0: number, frequency: number): Match[] {
  const w = 2 * Math.PI * frequency;
  const { re: r, im: x } = z;
  const out: Match[] = [];
  if (!(r > 0)) return out;
  // Shunt element at the load, series towards the source.
  const inner = r * r + x * x - z0 * r;
  if (inner >= 0) {
    for (const sign of [1, -1]) {
      const b = (x + sign * Math.sqrt(r / z0) * Math.sqrt(inner)) / (r * r + x * x);
      const series = 1 / b + (x * z0) / r - z0 / (b * r);
      if (!Number.isFinite(series) || !Number.isFinite(b)) continue;
      const middle = cDiv(ONE, cAdd(cDiv(ONE, z), c(0, b)));
      out.push({ layout: 'shunt-at-load', parts: [shuntPart(b, w), seriesPart(series, w)], middle });
    }
  }
  // Series element at the load, shunt towards the source.
  if (r <= z0) {
    for (const sign of [1, -1]) {
      const series = sign * Math.sqrt(r * (z0 - r)) - x;
      const b = (sign * Math.sqrt((z0 - r) / r)) / z0;
      const middle = cAdd(z, c(0, series));
      out.push({ layout: 'series-at-load', parts: [seriesPart(series, w), shuntPart(b, w)], middle });
    }
  }
  // Keep only networks that really reach z0, without duplicates.
  const seen = new Set<string>();
  return out.filter((m) => {
    const result = matchedImpedance(z, m);
    const key = m.parts.map((p) => `${p.where}${p.kind}${p.value.toPrecision(5)}`).join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return Math.abs(result.re - z0) < 1e-6 * z0 && Math.abs(result.im) < 1e-6 * z0;
  });
}

/** The impedance looking into a match network that ends in `z`. */
export function matchedImpedance(z: Complex, m: Match): Complex {
  let now = z;
  for (const p of m.parts) now = p.where === 'series' ? cAdd(now, c(0, p.x)) : cDiv(ONE, cAdd(cDiv(ONE, now), c(0, p.x)));
  return now;
}

/** Points along the path an element takes on the chart, as Γ values. */
export function elementPath(from: Complex, part: MatchPart, z0: number, steps = 40): Complex[] {
  const out: Complex[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const z = part.where === 'series' ? cAdd(from, c(0, part.x * t)) : cDiv(ONE, cAdd(cDiv(ONE, from), c(0, part.x * t)));
    out.push(gammaOf(z, z0));
  }
  return out;
}

/** Points along a line of `wavelengths` length, as Γ values (rotating towards the generator). */
export function linePath(z: Complex, z0: number, wavelengths: number, steps = 60): Complex[] {
  const g = gammaOf(z, z0);
  const out: Complex[] = [];
  for (let i = 0; i <= steps; i++) {
    const turn = -4 * Math.PI * wavelengths * (i / steps);
    out.push(cMul(g, c(Math.cos(turn), Math.sin(turn))));
  }
  return out;
}

/** Characteristic impedance of a quarter-wave transformer for a resistive load. */
export const quarterWave = (r: number, z0: number): number => Math.sqrt(r * z0);
