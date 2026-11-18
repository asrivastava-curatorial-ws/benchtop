/**
 * Electronic component markings: resistor colour bands, SMD resistor codes
 * (3-digit, 4-digit and EIA-96), capacitor codes, and E-series preferred values.
 */
import { ToolError } from './errors';

export const COLOURS = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'white', 'gold', 'silver'] as const;
export type Colour = (typeof COLOURS)[number];

export const COLOUR_HEX: Record<Colour, string> = {
  black: '#1c1c1c',
  brown: '#7b4a26',
  red: '#d32f2f',
  orange: '#f57c00',
  yellow: '#f9d71c',
  green: '#2e7d32',
  blue: '#1565c0',
  violet: '#7b1fa2',
  grey: '#8a8a8a',
  white: '#f5f5f5',
  gold: '#c9a227',
  silver: '#c0c0c0',
};

const DIGIT: Partial<Record<Colour, number>> = { black: 0, brown: 1, red: 2, orange: 3, yellow: 4, green: 5, blue: 6, violet: 7, grey: 8, white: 9 };
const MULTIPLIER: Partial<Record<Colour, number>> = { black: 1, brown: 10, red: 100, orange: 1e3, yellow: 1e4, green: 1e5, blue: 1e6, violet: 1e7, grey: 1e8, white: 1e9, gold: 0.1, silver: 0.01 };
const TOLERANCE: Partial<Record<Colour, number>> = { brown: 1, red: 2, green: 0.5, blue: 0.25, violet: 0.1, grey: 0.05, gold: 5, silver: 10, orange: 0.05, yellow: 0.02 };
const TEMPCO: Partial<Record<Colour, number>> = { black: 250, brown: 100, red: 50, orange: 15, yellow: 25, green: 20, blue: 10, violet: 5, grey: 1 };

export const digitColours = Object.keys(DIGIT) as Colour[];
export const multiplierColours = Object.keys(MULTIPLIER) as Colour[];
export const toleranceColours = Object.keys(TOLERANCE) as Colour[];
export const tempcoColours = Object.keys(TEMPCO) as Colour[];

export interface Resistor {
  readonly ohms: number;
  readonly tolerance?: number;
  readonly tempco?: number;
}

/** Value of a 4, 5 or 6 band resistor (bands from the end nearest a band group). */
export function readBands(bands: readonly Colour[]): Resistor {
  if (bands.length < 3 || bands.length > 6) throw new ToolError('A resistor has 3 to 6 bands.');
  const digits = bands.length >= 5 ? 3 : 2;
  let value = 0;
  for (const band of bands.slice(0, digits)) {
    const d = DIGIT[band];
    if (d === undefined) throw new ToolError(`${band} cannot be a digit band.`);
    value = value * 10 + d;
  }
  const multiplier = MULTIPLIER[bands[digits] as Colour];
  if (multiplier === undefined) throw new ToolError(`${bands[digits]} cannot be a multiplier band.`);
  return {
    ohms: round(value * multiplier),
    tolerance: bands.length > digits + 1 ? TOLERANCE[bands[digits + 1] as Colour] : 20,
    tempco: bands.length === 6 ? TEMPCO[bands[5] as Colour] : undefined,
  };
}

const round = (n: number) => Number(n.toPrecision(12));

/** Bands for a value: 2 or 3 significant digits and a multiplier (null when the value cannot be shown). */
export function bandsFor(ohms: number, digits: 2 | 3): Colour[] | null {
  if (!(ohms > 0)) return null;
  for (let exponent = -2; exponent <= 9; exponent++) {
    const significant = ohms / 10 ** exponent;
    if (Number.isInteger(round(significant)) && round(significant) < 10 ** digits && round(significant) >= (digits === 3 ? 0 : 0)) {
      const text = String(round(significant)).padStart(digits, '0');
      if (text.length !== digits) continue;
      const multiplier = (Object.entries(MULTIPLIER) as [Colour, number][]).find(([, m]) => Math.abs(m - 10 ** exponent) < 1e-12)?.[0];
      if (!multiplier) return null;
      return [...[...text].map((d) => digitColours[Number(d)] as Colour), multiplier];
    }
  }
  return null;
}

/** "4k7", "4.7k", "4700", "2M2", "0R47" → ohms. */
export function parseOhms(text: string): number {
  const t = text.trim().replace(/\s|Ω|ohms?/gi, '');
  const rkm = /^(\d*)([RKMG])(\d*)$/i.exec(t);
  if (rkm && (rkm[1] || rkm[3])) {
    const scale = { r: 1, k: 1e3, m: 1e6, g: 1e9 }[(rkm[2] as string).toLowerCase()] as number;
    return round(Number(`${rkm[1] || '0'}.${rkm[3] || '0'}`) * scale);
  }
  const m = /^([\d.]+)([kKmMgG]?)$/.exec(t);
  if (!m) throw new ToolError(`"${text}" is not a resistance; try 4.7k, 4k7 or 220.`);
  return round(Number(m[1]) * ({ '': 1, k: 1e3, K: 1e3, m: 1e6, M: 1e6, g: 1e9, G: 1e9 }[m[2] as string] as number));
}

export function formatOhms(ohms: number): string {
  if (ohms >= 1e9) return `${round(ohms / 1e9)} GΩ`;
  if (ohms >= 1e6) return `${round(ohms / 1e6)} MΩ`;
  if (ohms >= 1e3) return `${round(ohms / 1e3)} kΩ`;
  return `${round(ohms)} Ω`;
}

/* ------------------------------------------------------- SMD codes -- */

const EIA96 = [
  100, 102, 105, 107, 110, 113, 115, 118, 121, 124, 127, 130, 133, 137, 140, 143, 147, 150, 154, 158, 162, 165, 169, 174, 178, 182, 187, 191, 196, 200, 205, 210, 215, 221, 226, 232, 237, 243, 249,
  255, 261, 267, 274, 280, 287, 294, 301, 309, 316, 324, 332, 340, 348, 357, 365, 374, 383, 392, 402, 412, 422, 432, 442, 453, 464, 475, 487, 499, 511, 523, 536, 549, 562, 576, 590, 604, 619, 634,
  649, 665, 681, 698, 715, 732, 750, 768, 787, 806, 825, 845, 866, 887, 909, 931, 953, 976,
];
const EIA96_MULTIPLIER: Record<string, number> = { Z: 0.001, Y: 0.01, R: 0.01, X: 0.1, S: 0.1, A: 1, B: 10, H: 10, C: 100, D: 1e3, E: 1e4, F: 1e5 };

/** SMD resistor marking: "103", "4702", "4R7", "R10", "01C" (EIA-96). */
export function readSmd(code: string): { ohms: number; system: string } {
  const c = code.trim().toUpperCase();
  let m = /^(\d{2})([ZYRXSABHCDEF])$/.exec(c);
  if (m) {
    const base = EIA96[Number(m[1]) - 1];
    if (base === undefined) throw new ToolError('EIA-96 codes run from 01 to 96.');
    return { ohms: round(base * (EIA96_MULTIPLIER[m[2] as string] as number)), system: 'EIA-96 (1%)' };
  }
  if (/^\d*R\d*$/.test(c) && c !== 'R') return { ohms: round(Number(c.replace('R', '.'))), system: 'R marks the decimal point' };
  m = /^(\d{2,3})(\d)$/.exec(c);
  if (m) return { ohms: round(Number(m[1]) * 10 ** Number(m[2])), system: c.length === 4 ? '4-digit (1%)' : '3-digit (5%)' };
  if (/^0+$/.test(c)) return { ohms: 0, system: 'Zero-ohm link' };
  throw new ToolError(`"${code}" is not an SMD resistor code; try 103, 4702, 4R7 or 01C.`);
}

/* ---------------------------------------------------- capacitor codes -- */

const CAP_TOLERANCE: Record<string, string> = { B: '±0.1 pF', C: '±0.25 pF', D: '±0.5 pF', F: '±1%', G: '±2%', J: '±5%', K: '±10%', M: '±20%', Z: '+80/−20%' };
const CAP_VOLTAGE: Record<string, number> = { '0G': 4, '0J': 6.3, '1A': 10, '1C': 16, '1E': 25, '1V': 35, '1H': 50, '1J': 63, '2A': 100, '2D': 200, '2E': 250, '2G': 400, '2J': 630, '3A': 1000 };

export function formatFarads(pf: number): string {
  if (pf >= 1e6) return `${round(pf / 1e6)} µF`;
  if (pf >= 1e3) return `${round(pf / 1e3)} nF`;
  return `${round(pf)} pF`;
}

/** Ceramic and film capacitor codes: "104", "104K", "2A104J", "4n7", "0.1", "47p". */
export function readCapacitor(code: string): { picofarads: number; tolerance?: string; volts?: number } {
  let c = code.trim().toUpperCase().replace(/\s/g, '');
  let volts: number | undefined;
  const v = /^(\d[A-Z])(.*)$/.exec(c);
  if (v && CAP_VOLTAGE[v[1] as string] !== undefined && v[2]) {
    volts = CAP_VOLTAGE[v[1] as string];
    c = v[2] as string;
  }
  let tolerance: string | undefined;
  const t = /^(.*\d)([BCDFGJKMZ])$/.exec(c);
  if (t && !/[PNU]/.test(c.slice(-2, -1))) {
    tolerance = CAP_TOLERANCE[t[2] as string];
    c = t[1] as string;
  }
  let m = /^(\d)(\d)(\d)$/.exec(c);
  if (m) return { picofarads: round(Number(`${m[1]}${m[2]}`) * 10 ** (m[3] === '9' ? -1 : m[3] === '8' ? -2 : Number(m[3]))), tolerance, volts };
  m = /^(\d*)([PNU])(\d*)$/.exec(c);
  if (m && (m[1] || m[3])) return { picofarads: round(Number(`${m[1] || '0'}.${m[3] || '0'}`) * ({ P: 1, N: 1e3, U: 1e6 }[m[2] as 'P'] as number)), tolerance, volts };
  m = /^(\d+(?:\.\d+)?)$/.exec(c);
  if (m) {
    const n = Number(m[1]);
    // Plain numbers: below 1 they are microfarads (0.1 = 100 nF), otherwise picofarads (47 = 47 pF).
    return { picofarads: n < 1 ? round(n * 1e6) : n, tolerance, volts };
  }
  throw new ToolError(`"${code}" is not a capacitor code; try 104, 2A104J, 4n7 or 0.1.`);
}

/* ------------------------------------------------------------ E-series -- */

export const E_SERIES: Record<string, readonly number[]> = {
  E6: [1.0, 1.5, 2.2, 3.3, 4.7, 6.8],
  E12: [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2],
  E24: [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1],
  E96: EIA96.map((v) => v / 100),
};

/** The nearest preferred values below and above `value` in a series. */
export function nearest(value: number, series: keyof typeof E_SERIES): { below: number; above: number; closest: number } {
  if (!(value > 0)) throw new ToolError('Enter a positive value.');
  const decade = 10 ** Math.floor(Math.log10(value));
  const candidates = [-1, 0, 1].flatMap((k) => (E_SERIES[series] as number[]).map((v) => round(v * decade * 10 ** k)));
  const below = Math.max(...candidates.filter((v) => v <= value * (1 + 1e-9)));
  const above = Math.min(...candidates.filter((v) => v >= value * (1 - 1e-9)));
  return { below, above, closest: value / below <= above / value ? below : above };
}
