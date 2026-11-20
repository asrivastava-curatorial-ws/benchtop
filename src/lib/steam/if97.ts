/**
 * Water and steam properties from IAPWS-IF97, the industrial formulation used
 * in steam tables (Revised Release R7-97(2012)), with viscosity (IAPWS R12-08,
 * industrial use), thermal conductivity (IAPWS R15-11, industrial use) and
 * surface tension (IAPWS R1-76(2014)).
 *
 * Units: T in K, p in MPa, v in m³/kg, ρ in kg/m³, h and u in kJ/kg,
 * s, cp and cv in kJ/(kg·K), w in m/s, μ in Pa·s, λ in W/(m·K), σ in N/m.
 *
 * Coefficients are the published IAPWS values.  Region 1 terms are written as
 * n·(π − 7.1)^I·(τ − 1.222)^J, so each n carries the sign (−1)^I of the release's
 * (7.1 − π)^I form.
 */

/** Specific gas constant, kJ/(kg·K). */
export const R = 0.461526;
export const T_CRIT = 647.096;
export const P_CRIT = 22.064;
export const RHO_CRIT = 322;
export const T_MIN = 273.15;
export const T_MAX = 1073.15;
/** Region 5 (high temperature) reaches 2273.15 K at pressures up to 50 MPa. */
export const T_MAX_5 = 2273.15;
export const P_MAX = 100;
export const P_MAX_5 = 50;
/** The lowest temperature of region 3 and the region 2–3 boundary. */
const T_13 = 623.15;
const T_23_MAX = 863.15;

type Term = readonly [I: number, J: number, n: number];
type Ideal = readonly [J: number, n: number];

const REGION_1: readonly Term[] = [
  [0, -2, 0.14632971213167],
  [0, -1, -0.84548187169114],
  [0, 0, -3.756360367204],
  [0, 1, 3.3855169168385],
  [0, 2, -0.95791963387872],
  [0, 3, 0.15772038513228],
  [0, 4, -0.016616417199501],
  [0, 5, 0.00081214629983568],
  [1, -9, -0.00028319080123804],
  [1, -7, 0.00060706301565874],
  [1, -1, 0.018990068218419],
  [1, 0, 0.032529748770505],
  [1, 1, 0.021841717175414],
  [1, 3, 0.00005283835796993],
  [2, -3, -0.00047184321073267],
  [2, 0, -0.00030001780793026],
  [2, 1, 0.000047661393906987],
  [2, 3, -4.4141845330846e-6],
  [2, 17, -7.2694996297594e-16],
  [3, -4, 0.000031679644845054],
  [3, 0, 2.8270797985312e-6],
  [3, 6, 8.5205128120103e-10],
  [4, -5, -0.0000022425281908],
  [4, -2, -6.5171222895601e-7],
  [4, 10, -1.4341729937924e-13],
  [5, -8, 4.0516996860117e-7],
  [8, -11, -1.2734301741641e-9],
  [8, -6, -1.7424871230634e-10],
  [21, -29, 6.8762131295531e-19],
  [23, -31, -1.4478307828521e-20],
  [29, -38, -2.6335781662795e-23],
  [30, -39, -1.1947622640071e-23],
  [31, -40, -1.8228094581404e-24],
  [32, -41, -9.3537087292458e-26],
];

const REGION_2_IDEAL: readonly Ideal[] = [
  [0, -9.6927686500217],
  [1, 10.086655968018],
  [-5, -0.005608791128302],
  [-4, 0.071452738081455],
  [-3, -0.40710498223928],
  [-2, 1.4240819171444],
  [-1, -4.383951131945],
  [2, -0.28408632460772],
  [3, 0.021268463753307],
];

const REGION_2: readonly Term[] = [
  [1, 0, -0.0017731742473213],
  [1, 1, -0.017834862292358],
  [1, 2, -0.045996013696365],
  [1, 3, -0.057581259083432],
  [1, 6, -0.05032527872793],
  [2, 1, -0.000033032641670203],
  [2, 2, -0.00018948987516315],
  [2, 4, -0.0039392777243355],
  [2, 7, -0.043797295650573],
  [2, 36, -0.000026674547914087],
  [3, 0, 2.0481737692309e-8],
  [3, 1, 4.3870667284435e-7],
  [3, 3, -0.00003227767723857],
  [3, 6, -0.0015033924542148],
  [3, 35, -0.040668253562649],
  [4, 1, -7.8847309559367e-10],
  [4, 2, 1.2790717852285e-8],
  [4, 3, 4.8225372718507e-7],
  [5, 7, 2.2922076337661e-6],
  [6, 3, -1.6714766451061e-11],
  [6, 16, -0.0021171472321355],
  [6, 35, -23.895741934104],
  [7, 0, -5.905956432427e-18],
  [7, 11, -1.2621808899101e-6],
  [7, 25, -0.038946842435739],
  [8, 8, 1.1256211360459e-11],
  [8, 36, -8.2311340897998],
  [9, 13, 1.9809712802088e-8],
  [10, 4, 1.0406965210174e-19],
  [10, 10, -1.0234747095929e-13],
  [10, 14, -1.0018179379511e-9],
  [16, 29, -8.0882908646985e-11],
  [16, 50, 0.10693031879409],
  [18, 57, -0.33662250574171],
  [20, 20, 8.9185845355421e-25],
  [20, 35, 3.0629316876232e-13],
  [20, 48, -4.2002467698208e-6],
  [21, 21, -5.9056029685639e-26],
  [22, 53, 3.7826947613457e-6],
  [23, 39, -1.2768608934681e-15],
  [24, 26, 7.3087610595061e-29],
  [24, 40, 5.5414715350778e-17],
  [24, 58, -9.436970724121e-7],
];

/** The first term is the coefficient of ln δ. */
const REGION_3: readonly Term[] = [
  [0, 0, 1.0658070028513],
  [0, 0, -15.732845290239],
  [0, 1, 20.944396974307],
  [0, 2, -7.6867707878716],
  [0, 7, 2.6185947787954],
  [0, 10, -2.808078114862],
  [0, 12, 1.2053369696517],
  [0, 23, -0.0084566812812502],
  [1, 2, -1.2654315477714],
  [1, 6, -1.1524407806681],
  [1, 15, 0.88521043984318],
  [1, 17, -0.64207765181607],
  [2, 0, 0.38493460186671],
  [2, 2, -0.85214708824206],
  [2, 6, 4.8972281541877],
  [2, 7, -3.0502617256965],
  [2, 22, 0.039420536879154],
  [2, 26, 0.12558408424308],
  [3, 0, -0.2799932969871],
  [3, 2, 1.389979956946],
  [3, 4, -2.018991502357],
  [3, 16, -0.0082147637173963],
  [3, 26, -0.47596035734923],
  [4, 0, 0.0439840744735],
  [4, 2, -0.44476435428739],
  [4, 4, 0.90572070719733],
  [4, 26, 0.70522450087967],
  [5, 1, 0.10770512626332],
  [5, 3, -0.32913623258954],
  [5, 26, -0.50871062041158],
  [6, 0, -0.022175400873096],
  [6, 2, 0.094260751665092],
  [6, 26, 0.16436278447961],
  [7, 2, -0.013503372241348],
  [8, 26, -0.014834345352472],
  [9, 2, 0.00057922953628084],
  [9, 26, 0.0032308904703711],
  [10, 0, 0.000080964802996215],
  [10, 1, -0.00016557679795037],
  [11, 26, -0.000044923899061815],
];

/** Saturation-pressure equation, n1 … n10. */
const REGION_4 = [
  1167.0521452767, -724213.16703206, -17.073846940092, 12020.82470247, -3232555.0322333, 14.91510861353, -4823.2657361591, 405113.40542057, -0.23855557567849, 650.17534844798,
] as const;

const REGION_5_IDEAL: readonly Ideal[] = [
  [0, -13.179983674201],
  [1, 6.8540841634434],
  [-3, -0.024805148933466],
  [-2, 0.36901534980333],
  [-1, -3.1161318213925],
  [2, -0.32961626538917],
];

const REGION_5: readonly Term[] = [
  [1, 1, 0.0015736404855259],
  [1, 2, 0.00090153761673944],
  [1, 3, -0.0050270077677648],
  [2, 3, 2.2440037409485e-6],
  [2, 9, -4.1163275453471e-6],
  [3, 7, 3.7919454822955e-8],
];

/** Boundary between regions 2 and 3. */
const B23 = [348.05185628969, -1.1671859879975, 0.0010192970039326, 572.54459862746, 13.91883977887] as const;

/* ------------------------------------------------------------------ states -- */

export type Region = 1 | 2 | 3 | 4 | 5;

export interface State {
  /** 1 compressed liquid, 2 vapour, 3 near-critical, 4 wet steam (two phases), 5 high-temperature steam. */
  readonly region: Region;
  readonly T: number;
  readonly p: number;
  readonly v: number;
  readonly rho: number;
  readonly h: number;
  readonly u: number;
  readonly s: number;
  /** Not defined for wet steam (NaN). */
  readonly cp: number;
  readonly cv: number;
  readonly w: number;
  /** (∂ρ/∂p) at constant T, kg/(m³·MPa); NaN for wet steam. */
  readonly drhodp: number;
  /** Vapour mass fraction, for wet steam and saturated states. */
  readonly x?: number;
}

export class SteamRangeError extends RangeError {}

/** Gibbs free energy regions (1, 2 and 5) share one evaluation. */
interface Gibbs {
  g: number;
  gp: number;
  gpp: number;
  gt: number;
  gtt: number;
  gpt: number;
}

function sumTerms(terms: readonly Term[], a: number, b: number, out: Gibbs): void {
  for (const [I, J, n] of terms) {
    const aI = a ** I;
    const bJ = b ** J;
    out.g += n * aI * bJ;
    if (I !== 0) {
      out.gp += n * I * a ** (I - 1) * bJ;
      out.gpp += n * I * (I - 1) * a ** (I - 2) * bJ;
      if (J !== 0) out.gpt += n * I * J * a ** (I - 1) * b ** (J - 1);
    }
    if (J !== 0) {
      out.gt += n * J * aI * b ** (J - 1);
      out.gtt += n * J * (J - 1) * aI * b ** (J - 2);
    }
  }
}

function fromGibbs(region: Region, p: number, T: number, pi: number, tau: number, total: Gibbs, residual: Gibbs, ideal: boolean): State {
  const { g, gp, gpp, gt, gtt, gpt } = total;
  const v = (R * T * pi * gp) / p / 1000;
  const h = R * T * tau * gt;
  const u = R * T * (tau * gt - pi * gp);
  const s = R * (tau * gt - g);
  const cp = -R * tau * tau * gtt;
  let cv: number;
  let w2: number;
  if (ideal) {
    // Regions 2 and 5: γ = γ° + γʳ with γ°π = 1/π.
    const a = 1 + pi * residual.gp - tau * pi * residual.gpt;
    const b = 1 - pi * pi * residual.gpp;
    cv = cp - (R * a * a) / b;
    w2 = (R * 1000 * T * (1 + 2 * pi * residual.gp + pi * pi * residual.gp * residual.gp)) / (b + (a * a) / (tau * tau * gtt));
  } else {
    const a = gp - tau * gpt;
    cv = R * (-tau * tau * gtt + (a * a) / gpp);
    w2 = (R * 1000 * T * gp * gp) / ((a * a) / (tau * tau * gtt) - gpp);
  }
  // ρ = 1000·p*/(R·T·γπ), so dρ/dp = (dρ/dπ)/p* = −1000·γππ/(R·T·γπ²).
  const drhodp = (-1000 * gpp) / (R * T * gp * gp);
  return { region, T, p, v, rho: 1 / v, h, u, s, cp, cv, w: Math.sqrt(w2), drhodp };
}

const zero = (): Gibbs => ({ g: 0, gp: 0, gpp: 0, gt: 0, gtt: 0, gpt: 0 });

export function region1(p: number, T: number): State {
  const pi = p / 16.53;
  const tau = 1386 / T;
  const total = zero();
  sumTerms(REGION_1, pi - 7.1, tau - 1.222, total);
  return fromGibbs(1, p, T, pi, tau, total, total, false);
}

function idealGas(terms: readonly Ideal[], pi: number, tau: number, out: Gibbs): void {
  out.g += Math.log(pi);
  out.gp += 1 / pi;
  out.gpp += -1 / (pi * pi);
  for (const [J, n] of terms) {
    out.g += n * tau ** J;
    out.gt += n * J * tau ** (J - 1);
    out.gtt += n * J * (J - 1) * tau ** (J - 2);
  }
}

function gasRegion(region: 2 | 5, p: number, T: number): State {
  const pi = p;
  const tau = (region === 2 ? 540 : 1000) / T;
  const residual = zero();
  sumTerms(region === 2 ? REGION_2 : REGION_5, pi, region === 2 ? tau - 0.5 : tau, residual);
  const total = { ...residual };
  idealGas(region === 2 ? REGION_2_IDEAL : REGION_5_IDEAL, pi, tau, total);
  return fromGibbs(region, p, T, pi, tau, total, residual, true);
}

export const region2 = (p: number, T: number): State => gasRegion(2, p, T);
export const region5 = (p: number, T: number): State => gasRegion(5, p, T);

/** Region 3 from density and temperature (the release's own variables). */
export function region3(rho: number, T: number): State {
  const delta = rho / RHO_CRIT;
  const tau = T_CRIT / T;
  const [first, ...rest] = REGION_3;
  const n1 = (first as Term)[2];
  let f = n1 * Math.log(delta);
  let fd = n1 / delta;
  let fdd = -n1 / (delta * delta);
  let ft = 0;
  let ftt = 0;
  let fdt = 0;
  for (const [I, J, n] of rest) {
    const dI = delta ** I;
    const tJ = tau ** J;
    f += n * dI * tJ;
    if (I !== 0) {
      fd += n * I * delta ** (I - 1) * tJ;
      fdd += n * I * (I - 1) * delta ** (I - 2) * tJ;
      if (J !== 0) fdt += n * I * J * delta ** (I - 1) * tau ** (J - 1);
    }
    if (J !== 0) {
      ft += n * J * dI * tau ** (J - 1);
      ftt += n * J * (J - 1) * dI * tau ** (J - 2);
    }
  }
  const p = (rho * R * T * delta * fd) / 1000;
  const a = delta * fd - delta * tau * fdt;
  const b = 2 * delta * fd + delta * delta * fdd;
  return {
    region: 3,
    T,
    p,
    v: 1 / rho,
    rho,
    h: R * T * (tau * ft + delta * fd),
    u: R * T * tau * ft,
    s: R * (tau * ft - f),
    cp: R * (-tau * tau * ftt + (a * a) / b),
    cv: -R * tau * tau * ftt,
    w: Math.sqrt(R * 1000 * T * (b - (a * a) / (tau * tau * ftt))),
    drhodp: 1000 / (R * T * b),
  };
}

/** Pressure along the region 2–3 boundary, MPa. */
export const b23Pressure = (T: number): number => B23[0] + B23[1] * T + B23[2] * T * T;
/** Temperature along the region 2–3 boundary, K. */
export const b23Temperature = (p: number): number => B23[3] + Math.sqrt((p - B23[4]) / B23[2]);

/** Saturation pressure, MPa, for 273.15 K ≤ T ≤ 647.096 K. */
export function saturationPressure(T: number): number {
  if (!(T >= T_MIN && T <= T_CRIT)) throw new SteamRangeError(`Saturation needs 273.15 K ≤ T ≤ 647.096 K (0 °C to 373.946 °C).`);
  const n = REGION_4;
  const theta = T + n[8] / (T - n[9]);
  const A = theta * theta + n[0] * theta + n[1];
  const B = n[2] * theta * theta + n[3] * theta + n[4];
  const C = n[5] * theta * theta + n[6] * theta + n[7];
  return ((2 * C) / (-B + Math.sqrt(B * B - 4 * A * C))) ** 4;
}

/** Saturation temperature, K, for 611.213 Pa ≤ p ≤ 22.064 MPa. */
export function saturationTemperature(p: number): number {
  if (!(p >= 0.000611212677 && p <= P_CRIT)) throw new SteamRangeError('Saturation needs 611.2 Pa ≤ p ≤ 22.064 MPa.');
  const n = REGION_4;
  const beta = p ** 0.25;
  const E = beta * beta + n[2] * beta + n[5];
  const F = n[0] * beta * beta + n[3] * beta + n[6];
  const G = n[1] * beta * beta + n[4] * beta + n[7];
  const D = (2 * G) / (-F - Math.sqrt(F * F - 4 * E * G));
  return (n[9] + D - Math.sqrt((n[9] + D) ** 2 - 4 * (n[8] + n[9] * D))) / 2;
}

/* ------------------------------------------------- region 3 from p and T -- */

type Phase = 'liquid' | 'vapour';

/** p₃(ρ) along one isotherm, MPa: δ·φδ is a polynomial in δ once τ is fixed, so each call is a dozen multiplications. */
function isotherm3(T: number): (rho: number) => number {
  const tau = T_CRIT / T;
  const c = new Array<number>(12).fill(0);
  const [first, ...rest] = REGION_3;
  for (const [I, J, n] of rest) c[I] = (c[I] as number) + n * tau ** J;
  const n1 = (first as Term)[2];
  return (rho) => {
    const delta = rho / RHO_CRIT;
    let sum = n1;
    let power = 1;
    for (let I = 1; I < 12; I++) {
      power *= delta;
      sum += I * (c[I] as number) * power;
    }
    return (rho * R * T * sum) / 1000;
  };
}

/** Finds ρ with p₃(ρ, T) = p: the largest root for liquid, the smallest for vapour and supercritical fluid. */
function region3Density(p: number, T: number, phase: Phase): number {
  const pressure = isotherm3(T);
  const f = (rho: number) => pressure(rho) - p;
  let lo: number;
  let hi: number;
  if (phase === 'liquid') {
    // Region 3 liquid is never denser than about 762 kg/m³; far above that the equation is no longer physical.
    hi = 800;
    lo = hi;
    while (f(lo) > 0) {
      hi = lo;
      lo -= 1;
      if (lo <= 1) throw new SteamRangeError('No liquid density found in region 3.');
    }
  } else {
    lo = 0.5;
    hi = lo;
    while (f(hi) < 0) {
      lo = hi;
      hi += 1;
      if (hi > 800) throw new SteamRangeError('No vapour density found in region 3.');
    }
  }
  for (let i = 0; i < 80 && hi - lo > 1e-13 * hi; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

function checkRange(p: number, T: number): void {
  if (!(p > 0)) throw new SteamRangeError('Pressure must be above zero.');
  if (!(T >= T_MIN)) throw new SteamRangeError('IAPWS-IF97 starts at 273.15 K (0 °C).');
  if (T <= T_MAX) {
    if (p > P_MAX) throw new SteamRangeError('IAPWS-IF97 covers pressures up to 100 MPa.');
  } else if (T <= T_MAX_5) {
    if (p > P_MAX_5) throw new SteamRangeError('Above 800 °C, IAPWS-IF97 covers pressures up to 50 MPa.');
  } else {
    throw new SteamRangeError('IAPWS-IF97 ends at 2273.15 K (2000 °C).');
  }
}

/** Single-phase state at p and T; `phase` picks the side of the saturation line when p is exactly the saturation pressure. */
function single(p: number, T: number, phase?: Phase): State {
  if (T > T_MAX) return region5(p, T);
  if (T <= T_13) {
    const ps = saturationPressure(T);
    const liquid = phase ? phase === 'liquid' : p >= ps;
    return liquid ? region1(p, T) : region2(p, T);
  }
  if (T > T_23_MAX || p <= b23Pressure(T)) return region2(p, T);
  const side: Phase = phase ?? (T < T_CRIT && p >= saturationPressure(T) ? 'liquid' : 'vapour');
  return region3(region3Density(p, T, T >= T_CRIT ? 'vapour' : side), T);
}

/** The state at pressure (MPa) and temperature (K). */
export function stateTP(p: number, T: number): State {
  checkRange(p, T);
  return single(p, T);
}

export interface Saturation {
  readonly T: number;
  readonly p: number;
  readonly liquid: State;
  readonly vapour: State;
}

function saturated(T: number, p: number): Saturation {
  if (T <= T_13) return { T, p, liquid: { ...region1(p, T), x: 0 }, vapour: { ...region2(p, T), x: 1 } };
  if (T >= T_CRIT - 1e-9) {
    const critical = region3(RHO_CRIT, T_CRIT);
    return { T, p, liquid: { ...critical, x: 0 }, vapour: { ...critical, x: 1 } };
  }
  return { T, p, liquid: { ...region3(region3Density(p, T, 'liquid'), T), x: 0 }, vapour: { ...region3(region3Density(p, T, 'vapour'), T), x: 1 } };
}

export const saturationAtT = (T: number): Saturation => saturated(T, saturationPressure(T));
export const saturationAtP = (p: number): Saturation => saturated(saturationTemperature(p), p);

/** Wet steam: a mixture of saturated liquid and vapour with vapour fraction x. */
export function mixture(sat: Saturation, x: number): State {
  if (!(x >= 0 && x <= 1)) throw new SteamRangeError('Quality (dryness fraction) must be between 0 and 1.');
  const mix = (key: 'v' | 'h' | 'u' | 's') => sat.liquid[key] + x * (sat.vapour[key] - sat.liquid[key]);
  const v = mix('v');
  if (x === 0) return sat.liquid;
  if (x === 1) return sat.vapour;
  return { region: 4, T: sat.T, p: sat.p, v, rho: 1 / v, h: mix('h'), u: mix('u'), s: mix('s'), cp: Number.NaN, cv: Number.NaN, w: Number.NaN, drhodp: Number.NaN, x };
}

/** Finds T in [lo, hi] where `value(state)` reaches `target`; the property must rise with temperature. */
function solveT(target: number, lo: number, hi: number, at: (T: number) => State, value: (state: State) => number): State {
  let a = lo;
  let b = hi;
  if (value(at(a)) > target || value(at(b)) < target) throw new SteamRangeError('That value is outside the range of IAPWS-IF97 at this pressure.');
  for (let i = 0; i < 100 && b - a > 1e-11; i++) {
    const mid = (a + b) / 2;
    if (value(at(mid)) > target) b = mid;
    else a = mid;
  }
  return at((a + b) / 2);
}

function inverse(p: number, target: number, key: 'h' | 's'): State {
  if (!(p > 0 && p <= P_MAX)) throw new SteamRangeError('Pressure must be above zero and at most 100 MPa.');
  const top = p <= P_MAX_5 ? T_MAX_5 : T_MAX;
  const value = (state: State) => state[key];
  if (p < saturationPressure(T_MIN)) return solveT(target, T_MIN, top, (T) => single(p, T, 'vapour'), value);
  if (p < P_CRIT) {
    const sat = saturationAtP(p);
    if (target < sat.liquid[key]) return solveT(target, T_MIN, sat.T, (T) => single(p, T, 'liquid'), value);
    if (target > sat.vapour[key]) return solveT(target, sat.T, top, (T) => single(p, T, 'vapour'), value);
    return mixture(sat, (target - sat.liquid[key]) / (sat.vapour[key] - sat.liquid[key]));
  }
  return solveT(target, T_MIN, top, (T) => single(p, T), value);
}

/** The state at pressure (MPa) and specific enthalpy (kJ/kg); wet steam gets its quality. */
export const statePH = (p: number, h: number): State => inverse(p, h, 'h');
/** The state at pressure (MPa) and specific entropy (kJ/(kg·K)). */
export const statePS = (p: number, s: number): State => inverse(p, s, 's');

/* --------------------------------------------------- transport properties -- */

const VISCOSITY_0 = [1.67752, 2.20462, 0.6366564, -0.241605] as const;
const VISCOSITY_1: readonly Term[] = [
  [0, 0, 0.520094],
  [1, 0, 0.0850895],
  [2, 0, -1.08374],
  [3, 0, -0.289555],
  [0, 1, 0.222531],
  [1, 1, 0.999115],
  [2, 1, 1.88797],
  [3, 1, 1.26613],
  [5, 1, 0.120573],
  [0, 2, -0.281378],
  [1, 2, -0.906851],
  [2, 2, -0.772479],
  [3, 2, -0.489837],
  [4, 2, -0.25704],
  [0, 3, 0.161913],
  [1, 3, 0.257399],
  [0, 4, -0.0325372],
  [3, 4, 0.0698452],
  [4, 5, 0.00872102],
  [3, 6, -0.00435673],
  [5, 6, -0.000593264],
];

/** Dynamic viscosity, Pa·s (IAPWS 2008, industrial form without the critical enhancement). */
export function viscosity(rho: number, T: number): number {
  const t = T / T_CRIT;
  const d = rho / RHO_CRIT;
  const mu0 = (100 * Math.sqrt(t)) / VISCOSITY_0.reduce((sum, h, i) => sum + h / t ** i, 0);
  let sum = 0;
  for (const [i, j, h] of VISCOSITY_1) sum += h * (1 / t - 1) ** i * (d - 1) ** j;
  return mu0 * Math.exp(d * sum) * 1e-6;
}

const CONDUCTIVITY_0 = [2.443221e-3, 1.323095e-2, 6.770357e-3, -3.454586e-3, 4.096266e-4] as const;
/** L_ij, i for (1/T̄ − 1), j for (ρ̄ − 1). */
const CONDUCTIVITY_1: readonly Term[] = [
  [0, 0, 1.60397357],
  [1, 0, 2.33771842],
  [2, 0, 2.19650529],
  [3, 0, -1.21051378],
  [4, 0, -2.720337],
  [0, 1, -0.646013523],
  [1, 1, -2.78843778],
  [2, 1, -4.54580785],
  [3, 1, 1.60812989],
  [4, 1, 4.57586331],
  [0, 2, 0.111443906],
  [1, 2, 1.53616167],
  [2, 2, 3.55777244],
  [3, 2, -0.621178141],
  [4, 2, -3.18369245],
  [0, 3, 0.102997357],
  [1, 3, -0.463045512],
  [2, 3, -1.40944978],
  [3, 3, 0.0716373224],
  [4, 3, 1.1168348],
  [0, 4, -0.0504123634],
  [1, 4, 0.0832827019],
  [2, 4, 0.275418278],
  [4, 4, -0.19268305],
  [0, 5, 0.00609859258],
  [1, 5, -0.00719201245],
  [2, 5, -0.0205938816],
  [4, 5, 0.012913842],
];
/** Table 6 of IAPWS R15-11: 1/ζ at the reference temperature 1.5 Tc, by density band (columns). */
const ZETA_REFERENCE = [
  [6.53786807199516, 6.52717759281799, 5.35500529896124, 1.55225959906681, 1.11999926419994],
  [-5.61149954923348, -6.30816983387575, -3.96415689925446, 0.464621290821181, 0.595748562571649],
  [3.39624167361325, 8.08379285492595, 8.91990208918795, 8.93237374861479, 9.8895256507892],
  [-2.27492629730878, -9.82240510197603, -12.033872950579, -11.0321960061126, -10.325505114704],
  [10.2631854662709, 12.1358413791395, 9.19494865194302, 6.1678099993336, 4.66861294457414],
  [1.97815050331519, -5.54349664571295, -2.16866274479712, -0.965458722086812, -0.503243546373828],
] as const;

/** Thermal conductivity, W/(m·K) (IAPWS 2011, industrial form, with the critical enhancement). */
export function conductivity(state: State): number {
  if (state.region === 4) return Number.NaN;
  const { T, rho } = state;
  const t = T / T_CRIT;
  const d = rho / RHO_CRIT;
  const lambda0 = Math.sqrt(t) / CONDUCTIVITY_0.reduce((sum, l, k) => sum + l / t ** k, 0);
  let sum = 0;
  for (const [i, j, l] of CONDUCTIVITY_1) sum += l * (1 / t - 1) ** i * (d - 1) ** j;
  const lambda1 = Math.exp(d * sum);
  // Critical enhancement λ̄2 (vanishes away from the critical point).
  let lambda2 = 0;
  if (state.region !== 5) {
    const column = d <= 0.310559006 ? 0 : d <= 0.776397516 ? 1 : d <= 1.242236025 ? 2 : d <= 1.863354037 ? 3 : 4;
    const zetaReference = 1 / ZETA_REFERENCE.reduce((acc, row, i) => acc + (row[column] as number) * d ** i, 0);
    const zeta = (P_CRIT / RHO_CRIT) * state.drhodp;
    const deltaChi = d * (zeta - (zetaReference * 1.5) / t);
    const y = deltaChi > 0 ? (0.13 / 0.4) * (deltaChi / 0.06) ** (0.63 / 1.239) : 0;
    if (y >= 1.2e-7) {
      let cpBar = state.cp / 0.46151805;
      if (cpBar < 0 || cpBar > 1e13) cpBar = 1e13;
      const kappa = state.cp / state.cv;
      const muBar = viscosity(rho, T) / 1e-6;
      const Z = (2 / (Math.PI * y)) * ((1 - 1 / kappa) * Math.atan(y) + y / kappa - (1 - Math.exp(-1 / (1 / y + (y * y) / (3 * d * d)))));
      lambda2 = (177.8514 * d * cpBar * t * Z) / muBar;
    }
  }
  return (lambda0 * lambda1 + lambda2) * 1e-3;
}

/** Surface tension of water against its vapour, N/m (IAPWS 2014), for 273.15 K ≤ T ≤ 647.096 K. */
export function surfaceTension(T: number): number {
  if (!(T >= T_MIN && T <= T_CRIT)) return Number.NaN;
  const tau = 1 - T / T_CRIT;
  return 0.2358 * tau ** 1.256 * (1 - 0.625 * tau);
}
