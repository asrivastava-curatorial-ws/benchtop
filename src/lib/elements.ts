/**
 * The periodic table: element facts, positions in the 18-column layout,
 * electron shells, states of matter at a temperature, and molar masses of
 * chemical formulas.
 */
import { ELEMENT_ROWS } from './elements-data';

export type Category = 'Alkali metal' | 'Alkaline earth metal' | 'Transition metal' | 'Post-transition metal' | 'Metalloid' | 'Nonmetal' | 'Halogen' | 'Noble gas' | 'Lanthanide' | 'Actinide';

export const CATEGORIES: readonly Category[] = [
  'Alkali metal',
  'Alkaline earth metal',
  'Transition metal',
  'Post-transition metal',
  'Metalloid',
  'Nonmetal',
  'Halogen',
  'Noble gas',
  'Lanthanide',
  'Actinide',
];

export interface Element {
  readonly number: number;
  readonly symbol: string;
  readonly name: string;
  readonly mass: number;
  readonly cpk: string;
  readonly configuration: string;
  readonly electronegativity: number | null;
  /** Picometres. */
  readonly radius: number | null;
  /** First ionisation energy, eV. */
  readonly ionisation: number | null;
  /** eV. */
  readonly affinity: number | null;
  readonly oxidation: string;
  /** "s", "l" or "g"; "s?" and "g?" when only predicted. */
  readonly state: string;
  /** Kelvin. */
  readonly melting: number | null;
  readonly boiling: number | null;
  /** g/cm³ (g/L for gases in some sources; PubChem gives g/cm³). */
  readonly density: number | null;
  readonly category: Category;
  readonly discovered: string;
  readonly isotopes: readonly (readonly [number, number])[];
  readonly period: number;
  /** 1–18, or null for the lanthanides and actinides shown below the table. */
  readonly group: number | null;
  /** Grid position: row 1–7 for the main table, 9 and 10 for the f-block rows. */
  readonly row: number;
  readonly column: number;
  readonly block: 's' | 'p' | 'd' | 'f';
}

const PERIOD_ENDS = [2, 10, 18, 36, 54, 86, 118];

function place(z: number): { period: number; group: number | null; row: number; column: number; block: Element['block'] } {
  const period = PERIOD_ENDS.findIndex((end) => z <= end) + 1;
  const start = period === 1 ? 1 : (PERIOD_ENDS[period - 2] as number) + 1;
  const offset = z - start + 1;
  if (period === 1) return { period, group: z === 1 ? 1 : 18, row: 1, column: z === 1 ? 1 : 18, block: 's' };
  if (period <= 3) {
    const group = offset <= 2 ? offset : offset + 10;
    return { period, group, row: period, column: group, block: offset <= 2 ? 's' : 'p' };
  }
  if (period <= 5) return { period, group: offset, row: period, column: offset, block: offset <= 2 ? 's' : offset <= 12 ? 'd' : 'p' };
  if (offset <= 2) return { period, group: offset, row: period, column: offset, block: 's' };
  if (offset <= 17) return { period, group: null, row: period + 3, column: offset, block: offset === 17 ? 'd' : 'f' };
  const group = offset - 14;
  return { period, group, row: period, column: group, block: group <= 12 ? 'd' : 'p' };
}

export const ELEMENTS: readonly Element[] = ELEMENT_ROWS.map((r) => ({
  number: r[0],
  symbol: r[1],
  name: r[2],
  mass: r[3],
  cpk: r[4],
  configuration: r[5],
  electronegativity: r[6],
  radius: r[7],
  ionisation: r[8],
  affinity: r[9],
  oxidation: r[10],
  state: r[11],
  melting: r[12],
  boiling: r[13],
  density: r[14],
  category: r[15] as Category,
  discovered: r[16],
  isotopes: r[17],
  ...place(r[0]),
}));

const BY_SYMBOL = new Map(ELEMENTS.map((e) => [e.symbol, e]));

export const elementBySymbol = (symbol: string): Element | undefined => BY_SYMBOL.get(symbol);

/** Subshell occupations, with noble-gas cores expanded: "[Ne]3s2 3p4" → [[1,'s',2],[2,'s',2],[2,'p',6],[3,'s',2],[3,'p',4]]. */
export function subshells(configuration: string, depth = 0): [number, string, number][] {
  const out: [number, string, number][] = [];
  const core = /\[([A-Z][a-z]?)\]/.exec(configuration);
  if (core && depth < 8) {
    const element = BY_SYMBOL.get(core[1] as string);
    if (element) out.push(...subshells(element.configuration, depth + 1));
  }
  for (const m of configuration.replace(/\[[A-Za-z]+\]/, '').matchAll(/(\d)([spdfg])(\d+)/g)) out.push([Number(m[1]), m[2] as string, Number(m[3])]);
  return out;
}

/** Electrons in each shell (K, L, M, …). */
export function shells(element: Element): number[] {
  const counts: number[] = [];
  for (const [n, , electrons] of subshells(element.configuration)) counts[n - 1] = (counts[n - 1] ?? 0) + electrons;
  return Array.from(counts, (c) => c ?? 0);
}

export type Phase = 'solid' | 'liquid' | 'gas' | 'unknown';

/** The state of matter at a temperature in kelvin, at standard pressure. */
export function phaseAt(element: Element, kelvin: number): Phase {
  const { melting, boiling } = element;
  if (melting === null && boiling === null) return 'unknown';
  if (boiling !== null && kelvin >= boiling) return 'gas';
  if (melting !== null && kelvin >= melting) return boiling === null ? 'unknown' : 'liquid';
  if (melting === null) return 'unknown';
  return 'solid';
}

/* ------------------------------------------------------------- molar mass -- */

export interface Composition {
  readonly symbol: string;
  readonly name: string;
  readonly count: number;
  readonly mass: number;
  readonly percent: number;
}

export interface FormulaMass {
  readonly mass: number;
  readonly composition: readonly Composition[];
  /** The formula written with subscripts, such as "CuSO₄·5H₂O". */
  readonly pretty: string;
}

const SUB = '₀₁₂₃₄₅₆₇₈₉';

/**
 * Molar mass of a formula: "H2SO4", "Ca(OH)2", "K4[Fe(CN)6]", "CuSO4·5H2O"
 * (also "CuSO4.5H2O" or "CuSO4*5H2O").  Throws on unknown elements.
 */
/**
 * Atoms in a formula, in order of first appearance: "Ca(OH)2" gives Ca 1,
 * O 2, H 2; hydrates ("CuSO4·5H2O") add up their parts.  Charges written at
 * the end ("SO4^2-") are ignored here.  Symbols are not checked.
 */
export function formulaCounts(formula: string): Map<string, number> {
  const text = formula.replace(/\s+/g, '').replace(/[₀-₉]/g, (d) => String(SUB.indexOf(d)));
  if (!text) throw new Error('Enter a formula, such as H2SO4 or CuSO4·5H2O.');
  const counts = new Map<string, number>();
  const parts = text.split(/[·.*•]/).filter(Boolean);
  for (const part of parts) {
    const lead = /^(\d+(?:\.\d+)?)/.exec(part);
    const factor = lead ? Number(lead[1]) : 1;
    const group = parseGroup(lead ? part.slice((lead[1] as string).length) : part);
    for (const [symbol, n] of group) counts.set(symbol, (counts.get(symbol) ?? 0) + n * factor);
  }
  return counts;
}

export function molarMass(formula: string): FormulaMass {
  const text = formula.replace(/\s+/g, '').replace(/[₀-₉]/g, (d) => String(SUB.indexOf(d)));
  const counts = formulaCounts(formula);
  const parts = text.split(/[·.*•]/).filter(Boolean);
  let mass = 0;
  const rows: { symbol: string; name: string; count: number; mass: number }[] = [];
  for (const [symbol, count] of counts) {
    const element = BY_SYMBOL.get(symbol);
    if (!element) throw new Error(`“${symbol}” is not an element symbol. Symbols start with a capital letter: Co is cobalt, CO is carbon monoxide.`);
    const m = element.mass * count;
    mass += m;
    rows.push({ symbol, name: element.name, count, mass: m });
  }
  const pretty = parts.map((p) => p.replace(/(\d+)/g, (d, _g, i: number) => (i === 0 ? d : [...d].map((c) => SUB[Number(c)]).join('')))).join('·');
  return { mass, composition: rows.map((r) => ({ ...r, percent: (r.mass / mass) * 100 })), pretty };
}

function parseGroup(text: string): Map<string, number> {
  let i = 0;
  const read = (close: string | null): Map<string, number> => {
    const counts = new Map<string, number>();
    const add = (symbol: string, n: number) => counts.set(symbol, (counts.get(symbol) ?? 0) + n);
    while (i < text.length) {
      const ch = text[i] as string;
      if (ch === '(' || ch === '[' || ch === '{') {
        i++;
        const inner = read(ch === '(' ? ')' : ch === '[' ? ']' : '}');
        const n = number();
        for (const [s, c] of inner) add(s, c * n);
        continue;
      }
      if (ch === ')' || ch === ']' || ch === '}') {
        if (ch !== close) throw new Error(`The brackets in “${text}” do not match.`);
        i++;
        return counts;
      }
      const m = /^[A-Z][a-z]?/.exec(text.slice(i));
      if (!m) {
        // Charges such as "SO4^2-" or "NH4+" end the formula.
        if (/^[\^+-]/.test(text.slice(i))) break;
        throw new Error(`“${text.slice(i)}” could not be read: write element symbols with a capital letter, such as NaCl.`);
      }
      i += m[0].length;
      add(m[0], number());
    }
    if (close) throw new Error(`A bracket in “${text}” is never closed.`);
    return counts;
  };
  const number = (): number => {
    const m = /^\d+(?:\.\d+)?/.exec(text.slice(i));
    if (!m) return 1;
    i += m[0].length;
    return Number(m[0]);
  };
  return read(null);
}
