/** Numbers with SI prefixes: "4.7k", "4k7", "10 nF", "2.2µ", "100 MHz". */

const PREFIX: Readonly<Record<string, number>> = {
  f: 1e-15,
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  µ: 1e-6,
  μ: 1e-6,
  m: 1e-3,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
};

/**
 * Reads a value such as "4.7k", "4k7", "4R7", "10 nF", "1e-9" or "100 MHz".
 * `unit` (such as "Hz", "F", "H", "Ω") may follow the prefix and is ignored.
 * Returns null when the text is not a number.
 */
export function parseSi(text: string, unit = ''): number | null {
  let t = text.trim().replace(/\s+/g, '').replace(',', '.');
  if (t === '') return null;
  const units = unit === 'Ω' ? ['Ω', 'ohms', 'ohm', 'R'] : unit ? [unit] : [];
  for (const u of units) {
    if (t.length > u.length && t.toLowerCase().endsWith(u.toLowerCase())) {
      // "4R7" uses R as the decimal point; only strip a trailing R.
      t = t.slice(0, -u.length);
      break;
    }
  }
  // "4k7" and "4R7": the letter is the decimal point.
  const infix = /^(\d+)([fpnuµμmkKMGTR])(\d+)$/.exec(t);
  if (infix) {
    const scale = infix[2] === 'R' ? 1 : (PREFIX[infix[2] as string] ?? 1);
    return Number(`${infix[1]}.${infix[3]}`) * scale;
  }
  const match = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)([fpnuµμmkKMGT]?)$/i.exec(t);
  if (!match) return null;
  const prefix = match[2] ?? '';
  // "e" exponents are matched above; a lone "m" is milli and "M" mega.
  const scale = prefix === '' ? 1 : (PREFIX[prefix] ?? PREFIX[prefix.toLowerCase()] ?? 1);
  const value = Number(match[1]) * scale;
  return Number.isFinite(value) ? value : null;
}

const STEPS: readonly (readonly [number, string])[] = [
  [1e12, 'T'],
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
  [1e-15, 'f'],
];

/** 4700 → "4.7 k" + unit, with `digits` significant figures and no trailing zeros. */
export function formatSi(value: number, unit = '', digits = 3): string {
  if (!Number.isFinite(value)) return '–';
  if (value === 0) return `0 ${unit}`.trim();
  // The largest prefix whose rounded mantissa is at least 1 (so 999.96 with 3 digits is "1 k").
  for (const [scale, prefix] of STEPS) {
    const mantissa = Number((value / scale).toPrecision(digits));
    if (Math.abs(mantissa) >= 1) return `${minus(mantissa)} ${prefix}${unit}`.trim();
  }
  const [scale, prefix] = STEPS[STEPS.length - 1] as readonly [number, string];
  return `${minus(Number((value / scale).toPrecision(digits)))} ${prefix}${unit}`.trim();
}

/** A number with a real minus sign (−) rather than a hyphen. */
export const minus = (n: number | string): string => String(n).replace(/^-/, '−');
