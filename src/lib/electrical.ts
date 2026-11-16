/**
 * Electrical reference data and formulas for the screening calculators.
 * Metric sizes follow IEC 60228 and IEC 60364-5-52 (BS 7671 tables 4D1A and
 * 4E2A, clipped direct); AWG sizes follow NEC 2023 tables 310.16 and Chapter 9.
 * These give first estimates; final designs must follow the local code.
 */

export const SQRT3 = Math.sqrt(3);

export type Phase = '1' | '3' | 'dc';

/** Line current for a load of `watts` (real power). */
export function currentFor(watts: number, volts: number, phase: Phase, pf = 1, efficiency = 1): number {
  const input = watts / efficiency;
  if (phase === 'dc') return input / volts;
  return phase === '3' ? input / (SQRT3 * volts * pf) : input / (volts * pf);
}

/** Real power in watts drawn by `amps`. */
export function powerFor(amps: number, volts: number, phase: Phase, pf = 1): number {
  if (phase === 'dc') return amps * volts;
  return phase === '3' ? SQRT3 * volts * amps * pf : volts * amps * pf;
}

/* ------------------------------------------------------------ conductors -- */

export interface Conductor {
  readonly size: string;
  /** Cross-section in mm². */
  readonly area: number;
  /** DC resistance in ohms per km at 20 °C (IEC) or 75 °C (NEC Chapter 9 Table 8). */
  readonly rCu: number;
  readonly rAl?: number;
}

/** IEC 60228 class 2 conductors: maximum DC resistance at 20 °C, Ω/km. */
export const IEC_SIZES: readonly Conductor[] = [
  { size: '1.5', area: 1.5, rCu: 12.1 },
  { size: '2.5', area: 2.5, rCu: 7.41 },
  { size: '4', area: 4, rCu: 4.61 },
  { size: '6', area: 6, rCu: 3.08 },
  { size: '10', area: 10, rCu: 1.83, rAl: 3.08 },
  { size: '16', area: 16, rCu: 1.15, rAl: 1.91 },
  { size: '25', area: 25, rCu: 0.727, rAl: 1.2 },
  { size: '35', area: 35, rCu: 0.524, rAl: 0.868 },
  { size: '50', area: 50, rCu: 0.387, rAl: 0.641 },
  { size: '70', area: 70, rCu: 0.268, rAl: 0.443 },
  { size: '95', area: 95, rCu: 0.193, rAl: 0.32 },
  { size: '120', area: 120, rCu: 0.153, rAl: 0.253 },
  { size: '150', area: 150, rCu: 0.124, rAl: 0.206 },
  { size: '185', area: 185, rCu: 0.0991, rAl: 0.164 },
  { size: '240', area: 240, rCu: 0.0754, rAl: 0.125 },
  { size: '300', area: 300, rCu: 0.0601, rAl: 0.1 },
];

/** Multicore cable clipped direct (reference method C), copper, amperes: [2 loaded, 3 loaded] conductors. */
export const IEC_AMPACITY: Record<'pvc' | 'xlpe', Record<string, readonly [number, number]>> = {
  pvc: {
    '1.5': [19.5, 17.5],
    '2.5': [27, 24],
    '4': [36, 32],
    '6': [46, 41],
    '10': [63, 57],
    '16': [85, 76],
    '25': [112, 96],
    '35': [138, 119],
    '50': [168, 144],
    '70': [213, 184],
    '95': [258, 223],
    '120': [299, 259],
    '150': [344, 299],
    '185': [392, 341],
    '240': [461, 403],
    '300': [530, 464],
  },
  xlpe: {
    '1.5': [24, 22],
    '2.5': [33, 30],
    '4': [45, 40],
    '6': [58, 52],
    '10': [80, 71],
    '16': [107, 96],
    '25': [138, 119],
    '35': [171, 147],
    '50': [209, 179],
    '70': [269, 229],
    '95': [328, 278],
    '120': [382, 322],
    '150': [441, 371],
    '185': [506, 424],
    '240': [599, 500],
    '300': [693, 576],
  },
};

/** Aluminium carries about 78% of the current of copper of the same size (IEC tables, method C). */
export const ALUMINIUM_FACTOR = 0.78;

/** Ambient air temperature correction, IEC 60364-5-52 Table B.52.14. */
export const TEMPERATURE_FACTOR: Record<'pvc' | 'xlpe', Record<number, number>> = {
  pvc: { 10: 1.22, 15: 1.17, 20: 1.12, 25: 1.06, 30: 1, 35: 0.94, 40: 0.87, 45: 0.79, 50: 0.71, 55: 0.61, 60: 0.5 },
  xlpe: { 10: 1.15, 15: 1.12, 20: 1.08, 25: 1.04, 30: 1, 35: 0.96, 40: 0.91, 45: 0.87, 50: 0.82, 55: 0.76, 60: 0.71, 65: 0.65, 70: 0.58 },
};

/** Circuits bunched in air or on a surface, IEC 60364-5-52 Table B.52.17 item 1. */
export const GROUPING_FACTOR: Record<number, number> = { 1: 1, 2: 0.8, 3: 0.7, 4: 0.65, 5: 0.6, 6: 0.57, 7: 0.54, 8: 0.52, 9: 0.5, 12: 0.45, 16: 0.41, 20: 0.38 };

export function lookupFactor(table: Record<number, number>, key: number): number {
  const keys = Object.keys(table)
    .map(Number)
    .sort((a, b) => a - b);
  const at = keys.find((candidate) => candidate >= key) ?? (keys[keys.length - 1] as number);
  return table[at] as number;
}

/** NEC conductors with area (mm²) and Chapter 9 Table 8 resistance converted to Ω/km at 75 °C. */
export const AWG_SIZES: readonly Conductor[] = [
  { size: '14 AWG', area: 2.08, rCu: 3.14 * 3.2808 },
  { size: '12 AWG', area: 3.31, rCu: 1.98 * 3.2808, rAl: 3.25 * 3.2808 },
  { size: '10 AWG', area: 5.26, rCu: 1.24 * 3.2808, rAl: 2.04 * 3.2808 },
  { size: '8 AWG', area: 8.37, rCu: 0.778 * 3.2808, rAl: 1.28 * 3.2808 },
  { size: '6 AWG', area: 13.3, rCu: 0.491 * 3.2808, rAl: 0.808 * 3.2808 },
  { size: '4 AWG', area: 21.2, rCu: 0.308 * 3.2808, rAl: 0.508 * 3.2808 },
  { size: '3 AWG', area: 26.7, rCu: 0.245 * 3.2808, rAl: 0.403 * 3.2808 },
  { size: '2 AWG', area: 33.6, rCu: 0.194 * 3.2808, rAl: 0.319 * 3.2808 },
  { size: '1 AWG', area: 42.4, rCu: 0.154 * 3.2808, rAl: 0.253 * 3.2808 },
  { size: '1/0 AWG', area: 53.5, rCu: 0.122 * 3.2808, rAl: 0.201 * 3.2808 },
  { size: '2/0 AWG', area: 67.4, rCu: 0.0967 * 3.2808, rAl: 0.159 * 3.2808 },
  { size: '3/0 AWG', area: 85, rCu: 0.0766 * 3.2808, rAl: 0.126 * 3.2808 },
  { size: '4/0 AWG', area: 107, rCu: 0.0608 * 3.2808, rAl: 0.1 * 3.2808 },
  { size: '250 kcmil', area: 127, rCu: 0.0515 * 3.2808, rAl: 0.0847 * 3.2808 },
  { size: '300 kcmil', area: 152, rCu: 0.0429 * 3.2808, rAl: 0.0707 * 3.2808 },
  { size: '350 kcmil', area: 177, rCu: 0.0367 * 3.2808, rAl: 0.0605 * 3.2808 },
  { size: '400 kcmil', area: 203, rCu: 0.0321 * 3.2808, rAl: 0.0529 * 3.2808 },
  { size: '500 kcmil', area: 253, rCu: 0.0258 * 3.2808, rAl: 0.0424 * 3.2808 },
  { size: '600 kcmil', area: 304, rCu: 0.0214 * 3.2808, rAl: 0.0353 * 3.2808 },
  { size: '750 kcmil', area: 380, rCu: 0.0171 * 3.2808, rAl: 0.0282 * 3.2808 },
];

/** NEC Table 310.16 ampacities [60 °C, 75 °C, 90 °C] for copper, and [75 °C] for aluminium. */
export const NEC_AMPACITY: Record<string, { cu: readonly [number, number, number]; al?: number }> = {
  '14 AWG': { cu: [15, 20, 25] },
  '12 AWG': { cu: [20, 25, 30], al: 20 },
  '10 AWG': { cu: [30, 35, 40], al: 30 },
  '8 AWG': { cu: [40, 50, 55], al: 40 },
  '6 AWG': { cu: [55, 65, 75], al: 50 },
  '4 AWG': { cu: [70, 85, 95], al: 65 },
  '3 AWG': { cu: [85, 100, 115], al: 75 },
  '2 AWG': { cu: [95, 115, 130], al: 90 },
  '1 AWG': { cu: [110, 130, 145], al: 100 },
  '1/0 AWG': { cu: [125, 150, 170], al: 120 },
  '2/0 AWG': { cu: [145, 175, 195], al: 135 },
  '3/0 AWG': { cu: [165, 200, 225], al: 155 },
  '4/0 AWG': { cu: [195, 230, 260], al: 180 },
  '250 kcmil': { cu: [215, 255, 290], al: 205 },
  '300 kcmil': { cu: [240, 285, 320], al: 230 },
  '350 kcmil': { cu: [260, 310, 350], al: 250 },
  '400 kcmil': { cu: [280, 335, 380], al: 270 },
  '500 kcmil': { cu: [320, 380, 430], al: 310 },
  '600 kcmil': { cu: [350, 420, 475], al: 340 },
  '750 kcmil': { cu: [400, 475, 535], al: 385 },
};

/** NEC 240.4(D): small conductors' overcurrent protection limits (copper). */
export const SMALL_CONDUCTOR_LIMIT: Record<string, number> = { '14 AWG': 15, '12 AWG': 20, '10 AWG': 30 };

/** Resistance at the conductor's operating temperature from a 20 °C value. */
export const resistanceAt = (r20: number, celsius: number, aluminium = false): number => r20 * (1 + (aluminium ? 0.00403 : 0.00393) * (celsius - 20));

/** Voltage drop in volts: 2·I·L·(R cosφ + X sinφ) single-phase or DC, √3·I·L·(…) three-phase. R and X in Ω/km, L in metres. */
export function voltageDrop(amps: number, metres: number, rPerKm: number, phase: Phase, pf = 1, xPerKm = 0.08): number {
  const sin = Math.sqrt(Math.max(0, 1 - pf * pf));
  const z = (phase === 'dc' ? rPerKm : rPerKm * pf + xPerKm * sin) / 1000;
  return (phase === '3' ? SQRT3 : 2) * amps * metres * z;
}

/* -------------------------------------------------------------- breakers -- */

export const IEC_BREAKERS = [6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6300] as const;
/** NEC 240.6(A) standard ampere ratings. */
export const NEC_BREAKERS = [
  15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500, 600, 700, 800, 1000, 1200, 1600, 2000, 2500, 3000, 4000, 5000, 6000,
] as const;

export const nextSize = (sizes: readonly number[], at: number): number | undefined => sizes.find((size) => size >= at - 1e-9);

/* ----------------------------------------------------------------- motors -- */

/** NEC Table 430.250: full-load current of three-phase induction motors at 460 V (A), by horsepower. */
export const NEC_MOTOR_3PH_460: Record<number, number> = {
  0.5: 1.1,
  0.75: 1.6,
  1: 2.1,
  1.5: 3,
  2: 3.4,
  3: 4.8,
  5: 7.6,
  7.5: 11,
  10: 14,
  15: 21,
  20: 27,
  25: 34,
  30: 40,
  40: 52,
  50: 65,
  60: 77,
  75: 96,
  100: 124,
  125: 156,
  150: 180,
  200: 240,
  250: 302,
  300: 361,
  350: 414,
  400: 477,
  450: 515,
  500: 590,
};

/** NEC Table 430.248: single-phase motors at 115 V and 230 V (A). */
export const NEC_MOTOR_1PH: Record<number, readonly [number, number]> = {
  0.1667: [4.4, 2.2],
  0.25: [5.8, 2.9],
  0.3333: [7.2, 3.6],
  0.5: [9.8, 4.9],
  0.75: [13.8, 6.9],
  1: [16, 8],
  1.5: [20, 10],
  2: [24, 12],
  3: [34, 17],
  5: [56, 28],
  7.5: [80, 40],
  10: [100, 50],
};

/** Typical efficiency and power factor of IE2/IE3 four-pole motors by rated kW, for estimates. */
export function typicalMotor(kw: number): { efficiency: number; pf: number } {
  if (kw <= 1.5) return { efficiency: 0.8, pf: 0.79 };
  if (kw <= 7.5) return { efficiency: 0.87, pf: 0.83 };
  if (kw <= 37) return { efficiency: 0.92, pf: 0.86 };
  if (kw <= 110) return { efficiency: 0.945, pf: 0.87 };
  return { efficiency: 0.955, pf: 0.88 };
}

/** Starting current as a multiple of full-load current, by starting method. */
export const STARTING_MULTIPLIER: Record<string, number> = { dol: 6.5, star: 2.2, soft: 3, vfd: 1.2 };

export const HP_TO_KW = 0.745699872;

/* ------------------------------------------------------------ transformer -- */

export const IEC_TRANSFORMERS = [25, 63, 100, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000] as const;
export const US_TRANSFORMERS = [15, 30, 45, 75, 112.5, 150, 225, 300, 500, 750, 1000, 1500, 2000, 2500, 3750, 5000] as const;
export const GENSET_SIZES = [7.5, 10, 15, 20, 25, 30, 40, 50, 62.5, 82.5, 100, 125, 160, 200, 250, 320, 380, 400, 500, 625, 750, 1010, 1250, 1500, 2000, 2500] as const;
export const UPS_SIZES = [1, 2, 3, 6, 10, 15, 20, 30, 40, 60, 80, 100, 120, 160, 200, 250, 300, 400, 500, 600, 800] as const;

/* ---------------------------------------------------------------- earthing -- */

/** NEC Table 250.122: minimum copper equipment grounding conductor by overcurrent device rating (A). */
export const NEC_EGC: readonly (readonly [number, string])[] = [
  [15, '14 AWG'],
  [20, '12 AWG'],
  [60, '10 AWG'],
  [100, '8 AWG'],
  [200, '6 AWG'],
  [300, '4 AWG'],
  [400, '3 AWG'],
  [500, '2 AWG'],
  [600, '1 AWG'],
  [800, '1/0 AWG'],
  [1000, '2/0 AWG'],
  [1200, '3/0 AWG'],
  [1600, '4/0 AWG'],
  [2000, '250 kcmil'],
  [2500, '350 kcmil'],
  [3000, '400 kcmil'],
  [4000, '500 kcmil'],
  [5000, '700 kcmil'],
  [6000, '800 kcmil'],
];

/** IEC 60364-5-54 Table 54.2: protective conductor of the same material as the line conductor (mm²). */
export const iecProtectiveConductor = (line: number): number => (line <= 16 ? line : line <= 35 ? 16 : line / 2);

/** Adiabatic equation S = √(I²t)/k (IEC 60364-5-54 clause 543.1.2). */
export const adiabaticArea = (amps: number, seconds: number, k: number): number => Math.sqrt(amps * amps * seconds) / k;

/* --------------------------------------------------------------- conduits -- */

/** NEC Chapter 9 Table 4: internal area (in²) of trade sizes. */
export const CONDUIT_AREAS: Record<string, Record<string, number>> = {
  EMT: { '1/2': 0.304, '3/4': 0.533, '1': 0.864, '1-1/4': 1.496, '1-1/2': 2.036, '2': 3.356, '2-1/2': 5.858, '3': 8.846, '3-1/2': 11.545, '4': 14.753 },
  'PVC Schedule 40': { '1/2': 0.285, '3/4': 0.508, '1': 0.832, '1-1/4': 1.453, '1-1/2': 1.986, '2': 3.291, '2-1/2': 4.695, '3': 7.268, '3-1/2': 9.737, '4': 12.554 },
};

/** NEC Chapter 9 Table 5: THHN/THWN-2 conductor area (in²). */
export const THHN_AREAS: Record<string, number> = {
  '14 AWG': 0.0097,
  '12 AWG': 0.0133,
  '10 AWG': 0.0211,
  '8 AWG': 0.0366,
  '6 AWG': 0.0507,
  '4 AWG': 0.0824,
  '3 AWG': 0.0973,
  '2 AWG': 0.1158,
  '1 AWG': 0.1562,
  '1/0 AWG': 0.1855,
  '2/0 AWG': 0.2223,
  '3/0 AWG': 0.2679,
  '4/0 AWG': 0.3237,
  '250 kcmil': 0.397,
  '300 kcmil': 0.4608,
  '350 kcmil': 0.5242,
  '400 kcmil': 0.5863,
  '500 kcmil': 0.7073,
};

/** NEC Chapter 9 Table 1: allowed fill for 1, 2 and more than 2 conductors. */
export const fillLimit = (count: number): number => (count === 1 ? 0.53 : count === 2 ? 0.31 : 0.4);

/* -------------------------------------------------------------------- RTD -- */

export const CVD = { A: 3.9083e-3, B: -5.775e-7, C: -4.183e-12 } as const;

/** Callendar–Van Dusen (IEC 60751): resistance of a platinum RTD at `t` °C. */
export function rtdResistance(t: number, r0: number): number {
  const { A, B, C } = CVD;
  return r0 * (1 + A * t + B * t * t + (t < 0 ? C * (t - 100) * t ** 3 : 0));
}

/** Temperature for a measured resistance (exact above 0 °C, Newton's method below). */
export function rtdTemperature(r: number, r0: number): number {
  const { A, B } = CVD;
  const ratio = r / r0;
  let t = (-A + Math.sqrt(A * A - 4 * B * (1 - ratio))) / (2 * B);
  if (ratio < 1) {
    for (let i = 0; i < 30; i++) {
      const f = rtdResistance(t, r0) - r;
      const slope = (rtdResistance(t + 0.001, r0) - rtdResistance(t - 0.001, r0)) / 0.002;
      t -= f / slope;
    }
  }
  return t;
}

/** IEC 60751 tolerance classes: ± °C at temperature t. */
export const RTD_TOLERANCE: Record<string, (t: number) => number> = {
  AA: (t) => 0.1 + 0.0017 * Math.abs(t),
  A: (t) => 0.15 + 0.002 * Math.abs(t),
  B: (t) => 0.3 + 0.005 * Math.abs(t),
  C: (t) => 0.6 + 0.01 * Math.abs(t),
};

/* --------------------------------------------------------- number format -- */

export const fmt = (value: number, digits = 2): string => (Number.isFinite(value) ? Number(value.toFixed(digits)).toLocaleString('en-IN', { maximumFractionDigits: digits }) : '—');
