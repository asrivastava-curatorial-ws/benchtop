/**
 * The unit catalogue's data model.  Every category has a base unit (the first
 * one, with factor 1) and each unit says how to reach it:
 *
 * - linear:     base = value × factor
 * - affine:     base = value × factor + offset     (temperatures, HbA1c)
 * - reciprocal: base = factor / value              (fuel economy, yarn counts)
 * - function:   base = toBase(value)               (decibels, slopes, API gravity)
 */

export interface UnitDef {
  readonly id: string;
  /** Singular, lower case unless it is a proper name: "square foot". */
  readonly name: string;
  readonly symbol: string;
  readonly factor: number;
  readonly offset?: number;
  readonly reciprocal?: boolean;
  readonly toBase?: (value: number) => number;
  readonly fromBase?: (base: number) => number;
  /** Other names people type: plurals that are not just "+s", regional names, old symbols. */
  readonly aliases?: readonly string[];
  /** Shown beside the unit: a definition, a region, or a caution. */
  readonly note?: string;
}

export const GROUPS = [
  { id: 'everyday', name: 'Everyday' },
  { id: 'mechanics', name: 'Mechanics and materials' },
  { id: 'fluids', name: 'Fluids, gases and flow' },
  { id: 'heat', name: 'Heat, fuel and energy use' },
  { id: 'electric', name: 'Electricity and magnetism' },
  { id: 'waves', name: 'Light, sound and radiation' },
  { id: 'chemistry', name: 'Chemistry and water' },
  { id: 'health', name: 'Health (lab results)' },
  { id: 'trade', name: 'Trades and industries' },
] as const;

export type GroupId = (typeof GROUPS)[number]['id'];

export interface UnitCategory {
  readonly id: string;
  readonly name: string;
  readonly group: GroupId;
  /** What the category measures, in plain words, for people who search by purpose. */
  readonly description: string;
  readonly units: readonly UnitDef[];
  /** Applies to the whole category: assumptions and cautions. */
  readonly note?: string;
  /** Extra words that find the category: "drilling", "irrigation", "jeweller". */
  readonly keywords?: readonly string[];
}

interface Extra {
  readonly id?: string;
  readonly aliases?: readonly string[];
  readonly note?: string;
}

const make = (symbol: string, name: string, extra: Extra) => ({ id: extra.id ?? symbol, name, symbol, aliases: extra.aliases, note: extra.note });

/** A unit that is a fixed multiple of the base unit. */
export const lin = (symbol: string, name: string, factor: number, extra: Extra = {}): UnitDef => ({ ...make(symbol, name, extra), factor });

/** base = value × factor + offset. */
export const aff = (symbol: string, name: string, factor: number, offset: number, extra: Extra = {}): UnitDef => ({ ...make(symbol, name, extra), factor, offset });

/** base = factor / value: units that grow as the base shrinks. */
export const rec = (symbol: string, name: string, factor: number, extra: Extra = {}): UnitDef => ({ ...make(symbol, name, extra), factor, reciprocal: true });

/** Any other relation, given both ways. */
export const fn = (symbol: string, name: string, toBase: (value: number) => number, fromBase: (base: number) => number, extra: Extra = {}): UnitDef => ({
  ...make(symbol, name, extra),
  factor: Number.NaN,
  toBase,
  fromBase,
});

export const PREFIXES = {
  E: [1e18, 'exa'],
  P: [1e15, 'peta'],
  T: [1e12, 'tera'],
  G: [1e9, 'giga'],
  M: [1e6, 'mega'],
  k: [1e3, 'kilo'],
  h: [1e2, 'hecto'],
  da: [1e1, 'deca'],
  d: [1e-1, 'deci'],
  c: [1e-2, 'centi'],
  m: [1e-3, 'milli'],
  µ: [1e-6, 'micro'],
  n: [1e-9, 'nano'],
  p: [1e-12, 'pico'],
  f: [1e-15, 'femto'],
} as const;

export type Prefix = keyof typeof PREFIXES;

/**
 * SI-prefixed versions of a unit, in the order given: si('Pa', 'pascal', 1, ['k', 'M'])
 * gives kPa (kilopascal) and MPa (megapascal).
 */
export function si(symbol: string, name: string, factor: number, prefixes: readonly Prefix[]): UnitDef[] {
  return prefixes.map((p) => {
    const [scale, word] = PREFIXES[p];
    const prefixed = `${p}${symbol}`;
    return lin(prefixed, `${word}${name}`, scale * factor, p === 'µ' ? { aliases: [`u${symbol}`, `mc${symbol}`] } : {});
  });
}
