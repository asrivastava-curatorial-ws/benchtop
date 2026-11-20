/**
 * The unit catalogue: about a hundred quantities used across trades and
 * sciences, conversion between any two units of one quantity, search, and a
 * parser for questions such as "5 bigha (UP) in acres" or "98.6 F to C".
 */
import { COMMON } from './catalog-common';
import { SCIENCE } from './catalog-science';
import { TRADE } from './catalog-trade';
import { GROUPS, type UnitCategory, type UnitDef } from './types';

export type { GroupId, UnitCategory, UnitDef } from './types';
export { GROUPS };

/** Every category, in group order. */
export const UNIT_CATEGORIES: readonly UnitCategory[] = GROUPS.flatMap((group) => [...COMMON, ...SCIENCE, ...TRADE].filter((category) => category.group === group.id));

const CATEGORY_BY_ID = new Map(UNIT_CATEGORIES.map((category) => [category.id, category]));

export const findCategory = (id: string): UnitCategory | undefined => CATEGORY_BY_ID.get(id);
export const findUnit = (category: UnitCategory, id: string): UnitDef | undefined => category.units.find((unit) => unit.id === id);

export function toBase(unit: UnitDef, value: number): number {
  if (unit.toBase) return unit.toBase(value);
  if (unit.reciprocal) return unit.factor / value;
  return value * unit.factor + (unit.offset ?? 0);
}

export function fromBase(unit: UnitDef, base: number): number {
  if (unit.fromBase) return unit.fromBase(base);
  if (unit.reciprocal) return unit.factor / base;
  return (base - (unit.offset ?? 0)) / unit.factor;
}

export function convertValue(value: number, from: UnitDef, to: UnitDef): number {
  return from === to ? value : fromBase(to, toBase(from, value));
}

/* ----------------------------------------------------------------- matching -- */

/** Same characters as typed, but with ² as 2, µ as u and no spaces or middle dots. */
const exactKey = (text: string) =>
  text
    .normalize('NFKC')
    .replace(/[μµ]/g, 'u')
    .replace(/[\s·⋅]/g, '');
/** Case-insensitive, also without degree signs and full stops ("sq. ft."). */
const looseKey = (text: string) => {
  const key = exactKey(text).toLowerCase();
  return key.replace(/[°.]/g, '') || key;
};

function plural(word: string): string {
  if (word === 'foot') return 'feet';
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}

/**
 * "metre per second" → metre per second, metres per second; "pound (avoirdupois)" → also pound, pounds;
 * "degree Celsius" → also degrees Celsius; "kilowatt-hour" → also kilowatt hours.
 */
function nameForms(name: string): string[] {
  const forms = new Set<string>();
  const lower = name.toLowerCase();
  const bare = lower.replace(/\s*\([^)]*\)/g, '').trim();
  // American spellings: meter, liter.
  const american = (text: string) => text.replace(/metre/g, 'meter').replace(/litre/g, 'liter');
  for (const form of new Set([lower, bare, bare.replace(/-/g, ' '), american(lower), american(bare), american(bare.replace(/-/g, ' '))])) {
    if (!form) continue;
    forms.add(form);
    const [head, ...rest] = form.split(' per ');
    if (!head) continue;
    const words = head.split(' ');
    const last = [...words];
    last[last.length - 1] = plural(last[last.length - 1] ?? '');
    forms.add([last.join(' '), ...rest].join(' per '));
    if (words.length > 1) {
      const first = [...words];
      first[0] = plural(first[0] ?? '');
      forms.add([first.join(' '), ...rest].join(' per '));
    }
  }
  return [...forms].map(looseKey);
}

/** Plurals of word-like symbols and aliases: "cups", "tolas", "gallons", "liters". */
const wordPlurals = (labels: readonly string[]) => labels.filter((label) => /^[a-z]{3,}$/i.test(label)).map((label) => looseKey(plural(label.toLowerCase())));

interface Entry {
  readonly category: UnitCategory;
  readonly unit: UnitDef;
  readonly exact: ReadonlySet<string>;
  readonly loose: ReadonlySet<string>;
  readonly names: ReadonlySet<string>;
  readonly order: number;
}

let index: Entry[] | null = null;

function entries(): Entry[] {
  if (index) return index;
  index = UNIT_CATEGORIES.flatMap((category, order) =>
    category.units.map((unit) => {
      const labels = [unit.symbol, ...(unit.aliases ?? [])];
      return {
        category,
        unit,
        exact: new Set(labels.map(exactKey)),
        loose: new Set(labels.map(looseKey)),
        names: new Set([...nameForms(unit.name), ...wordPlurals(labels)]),
        order,
      };
    }),
  );
  return index;
}

export interface UnitMatch {
  readonly category: UnitCategory;
  readonly unit: UnitDef;
  /** 3: symbol as typed, 2: symbol in any case, 1: name. */
  readonly score: number;
  readonly order: number;
}

/** Units whose symbol, alias or name is exactly this text. */
export function matchUnit(text: string): UnitMatch[] {
  const exact = exactKey(text);
  const loose = looseKey(text);
  if (!loose) return [];
  const found: UnitMatch[] = [];
  for (const entry of entries()) {
    const score = entry.exact.has(exact) ? 3 : entry.loose.has(loose) ? 2 : entry.names.has(loose) ? 1 : 0;
    if (score > 0) found.push({ category: entry.category, unit: entry.unit, score, order: entry.order });
  }
  return found.sort((a, b) => b.score - a.score || a.order - b.order);
}

export interface SearchHit {
  readonly category: UnitCategory;
  /** Absent when the category itself matched (by name, description or keyword). */
  readonly unit?: UnitDef;
}

/** Units and quantities for a search box: exact matches first, then names that start or contain the text. */
export function searchUnits(text: string, limit = 40): SearchHit[] {
  const query = looseKey(text);
  if (!query) return [];
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const scored: { hit: SearchHit; score: number; order: number }[] = [];
  for (const entry of entries()) {
    const name = entry.unit.name.toLowerCase();
    const labels = [...entry.loose];
    let score = 0;
    if (entry.exact.has(exactKey(text))) score = 100;
    else if (entry.loose.has(query) || entry.names.has(query)) score = 90;
    else if (name.startsWith(text.toLowerCase().trim()) || labels.some((label) => label.startsWith(query))) score = 60;
    else if (words.every((word) => name.includes(word) || labels.some((label) => label.includes(looseKey(word))))) score = 40;
    if (score > 0) scored.push({ hit: { category: entry.category, unit: entry.unit }, score, order: entry.order });
  }
  UNIT_CATEGORIES.forEach((category, order) => {
    const haystack = [category.name, category.description, ...(category.keywords ?? [])].join(' ').toLowerCase();
    if (words.every((word) => haystack.includes(word))) {
      const named = category.name.toLowerCase().includes(text.toLowerCase().trim());
      scored.push({ hit: { category }, score: named ? 95 : 50, order });
    }
  });
  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((s) => s.hit);
}

/* ------------------------------------------------------------------ parsing -- */

export interface ParsedQuery {
  readonly value: number;
  readonly category: UnitCategory;
  readonly from: UnitDef;
  /** Missing when the question names only one unit ("12 psi"). */
  readonly to?: UnitDef;
}

const NUMBER = /^\s*([+-]?(?:\d[\d,_]*(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(?:\s+(\d+)\s*\/\s*(\d+))?(?:\s*\/\s*(\d+))?/i;
const SEPARATORS = [' to ', ' into ', ' in ', ' as ', ' = ', '=', ' -> ', '->', '→', ' ⇒ '];
const SCALES: Readonly<Record<string, number>> = { hundred: 1e2, thousand: 1e3, lakh: 1e5, lac: 1e5, crore: 1e7, million: 1e6, billion: 1e9, trillion: 1e12 };
const SCALE_WORD = /^(hundreds?|thousands?|lakhs?|lacs?|crores?|millions?|billions?|trillions?)\s+(.+)$/i;

/** Reads "5 bigha (UP) in acres", "1,00,000 sq ft to ha", "3 1/2 cups in mL" or "98.6 F". */
export function parseQuery(text: string): ParsedQuery | { readonly error: string } {
  const match = NUMBER.exec(text);
  if (!match) return { error: 'Start with a number, for example “5 bigha (UP) in acres”.' };
  let value = Number((match[1] ?? '').replace(/[,_]/g, ''));
  if (match[2] && match[3]) value += Number(match[2]) / Number(match[3]);
  if (match[4]) value /= Number(match[4]);
  if (!Number.isFinite(value)) return { error: 'That number is not valid.' };
  const rest = text.slice(match[0].length).trim();
  if (!rest) return { error: 'Add a unit after the number.' };
  const lower = ` ${rest.toLowerCase()} `;
  let fromText = rest;
  let toText = '';
  for (const separator of SEPARATORS) {
    const at = lower.indexOf(separator, 1);
    if (at > 0) {
      fromText = rest.slice(0, at - 1).trim();
      toText = rest.slice(at - 1 + separator.length).trim();
      break;
    }
  }
  // "2 lakh sq ft", "3 million gallons": a counting word scales the number when a unit follows it.
  const scaled = SCALE_WORD.exec(fromText);
  if (scaled?.[1] && scaled[2] && matchUnit(scaled[2]).length > 0) {
    value *= SCALES[scaled[1].toLowerCase().replace(/s$/, '')] ?? 1;
    fromText = scaled[2];
  }
  // "5.4 mmol/L glucose in mg/dL", "110 mg/dL to mmol/L for cholesterol": a quantity named after a unit picks among units that share a symbol.
  const source = splitHint(fromText);
  const target = splitHint(toText);
  const hinted = new Set([...source.quantities, ...target.quantities]);
  const bonus = (category: UnitCategory) => (hinted.has(category) ? 100_000 : 0);
  const sources = matchUnit(source.text);
  if (sources.length === 0) return { error: `“${source.text}” is not a unit this converter knows.` };
  if (!toText) {
    const best = [...sources].sort((a, b) => bonus(b.category) - bonus(a.category))[0] as UnitMatch;
    return { value, category: best.category, from: best.unit };
  }
  const targets = matchUnit(target.text);
  if (targets.length === 0) return { error: `“${target.text}” is not a unit this converter knows.` };
  let best: { from: UnitMatch; to: UnitMatch; score: number } | null = null;
  for (const from of sources) {
    for (const to of targets) {
      if (from.category !== to.category) continue;
      const score = bonus(from.category) + (from.score + to.score) * 1000 - from.order;
      if (!best || score > best.score) best = { from, to, score };
    }
  }
  if (!best) return { error: `“${source.text}” and “${target.text}” measure different things (${sources[0]?.category.name.toLowerCase()} and ${targets[0]?.category.name.toLowerCase()}).` };
  return { value, category: best.from.category, from: best.from.unit, to: best.to.unit };
}

/** Quantities called this: "glucose", "blood glucose", "land area", "hba1c". */
function quantitiesNamed(text: string): UnitCategory[] {
  const key = ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
  if (key.trim().length < 3) return [];
  return UNIT_CATEGORIES.filter((category) => {
    const words = ` ${[category.id, category.name, ...(category.keywords ?? [])]
      .join(' | ')
      .toLowerCase()
      .replace(/[^a-z0-9|]+/g, ' ')} `;
    return words.split('|').some((phrase) => ` ${phrase.trim()} `.includes(key));
  });
}

/** "mmol/L of glucose" → the unit "mmol/L" and the quantities called "glucose". */
function splitHint(text: string): { readonly text: string; readonly quantities: readonly UnitCategory[] } {
  if (!text || matchUnit(text).length > 0) return { text, quantities: [] };
  const words = text.split(/\s+/);
  for (let i = words.length - 1; i >= 1; i--) {
    const unit = words.slice(0, i).join(' ');
    const quantities = quantitiesNamed(
      words
        .slice(i)
        .join(' ')
        .replace(/^(of|for)\s+/i, ''),
    );
    if (quantities.length > 0 && matchUnit(unit).length > 0) return { text: unit, quantities };
  }
  return { text, quantities: [] };
}

/* --------------------------------------------------------------- formatting -- */

export type Grouping = 'international' | 'indian' | 'none';

/** A value rounded to `digits` significant figures, grouped for reading. */
export function formatValue(value: number, digits: number, grouping: Grouping = 'international'): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e15 || magnitude < 1e-6)
    return value
      .toExponential(Math.max(0, digits - 1))
      .replace(/\.?0+e/, 'e')
      .replace('e+', 'e');
  const rounded = Number(value.toPrecision(digits));
  return rounded.toLocaleString(grouping === 'indian' ? 'en-IN' : 'en-US', { maximumFractionDigits: 15, useGrouping: grouping !== 'none' });
}

/** The same value without grouping, for copying into other programs. */
export const plainValue = (value: number, digits: number): string => formatValue(value, digits, 'none');

/* ------------------------------------------------------------ the converter -- */

/** A number as people type it: "1,00,000", "2_500", "3 1/2", "1/3", "-40", "6.02e23". */
export function readNumber(text: string): number | null {
  const match = NUMBER.exec(text);
  if (!match || match[0].trim().length !== text.trim().length) return null;
  let value = Number((match[1] ?? '').replace(/[,_]/g, ''));
  if (match[2] && match[3]) value += Number(match[2]) / Number(match[3]);
  if (match[4]) value /= Number(match[4]);
  return Number.isFinite(value) ? value : null;
}

/** The pair each quantity opens with: the conversion people most often want there. */
const PAIRS: Readonly<Record<string, readonly [string, string]>> = {
  length: ['m', 'ft'],
  area: ['m2', 'ft2'],
  volume: ['L', 'gal'],
  mass: ['kg', 'lb'],
  time: ['h', 'min'],
  temperature: ['C', 'F'],
  speed: ['km/h', 'mph'],
  pace: ['min/km', 'min/mi'],
  fuel: ['L/100km', 'mpg'],
  data: ['GB', 'GiB'],
  datarate: ['Mbit/s', 'MB/s'],
  count: ['lakh', 'million'],
  force: ['N', 'kgf'],
  pressure: ['bar', 'psi'],
  energy: ['kWh', 'MJ'],
  power: ['kW', 'hp'],
  torque: ['Nm', 'lbfft'],
  acceleration: ['m/s2', 'g0'],
  angle: ['deg', 'rad'],
  slope: ['%', 'deg'],
  frequency: ['Hz', 'rpm'],
  angularvelocity: ['rpm', 'rad/s'],
  areamoment: ['mm4', 'in4'],
  sectionmodulus: ['mm3', 'in3'],
  stiffness: ['N/mm', 'lbf/in'],
  density: ['kg/m3', 'lb/ft3'],
  gravityscales: ['SG', 'API'],
  specificweight: ['kN/m3', 'lbf/ft3'],
  linedensity: ['kg/m', 'lb/ft'],
  areadensity: ['g/m2', 'oz/yd2'],
  flow: ['m3/h', 'gal/min'],
  massflow: ['kg/h', 'lb/h'],
  gasvolume: ['Nm3', 'scf'],
  gasflow: ['Nm3/h', 'scfm'],
  viscosity: ['Pas', 'cP'],
  surfacetension: ['mN/m', 'dyn/cm'],
  rainfall: ['mm/h', 'in/h'],
  tempdiff: ['C', 'F'],
  heatflux: ['W/m2', 'BTU/hft2'],
  htc: ['W/m2K', 'BTU/hft2F'],
  conductivity: ['W/mK', 'BTU/hftF'],
  rvalue: ['m2K/W', 'Rus'],
  specificheat: ['kJ/kgK', 'BTU/lbF'],
  specificenergy: ['MJ/kg', 'kWh/kg'],
  energydensity: ['MJ/L', 'kWh/L'],
  cooling: ['kW/TR', 'COP'],
  bsfc: ['g/kWh', 'lb/hph'],
  evconsumption: ['kWh/100km', 'mi/kWh'],
  current: ['A', 'mA'],
  voltage: ['kV', 'V'],
  resistance: ['kohm', 'ohm'],
  capacitance: ['µF', 'nF'],
  inductance: ['mH', 'µH'],
  charge: ['mAh', 'C'],
  elconductivity: ['MS/m', '%IACS'],
  efield: ['kV/mm', 'V/mil'],
  fluxdensity: ['T', 'G'],
  hfield: ['A/m', 'Oe'],
  spectrum: ['wnm', 'THz'],
  illuminance: ['lx', 'fc'],
  luminance: ['cd/m2', 'fL'],
  soundpressure: ['Pa', 'dBSPL'],
  soundintensity: ['W/m2', 'dBSIL'],
  soundpower: ['W', 'dBSWL'],
  radioactivity: ['MBq', 'mCi'],
  absorbeddose: ['Gy', 'rad'],
  equivalentdose: ['mSv', 'mrem'],
  doserate: ['uSv/h', 'mSv/yr'],
  fluxdensityastro: ['Jy', 'W/m2Hz'],
  molarity: ['mol/L', 'mmol/L'],
  fraction: ['%', 'ppm'],
  hardness: ['ppmCaCO3', 'dH'],
  catalytic: ['U', 'µkat'],
  molarenergy: ['kJ/mol', 'kcal/mol'],
  glucose: ['mmol/L', 'mg/dL'],
  hba1c: ['pct', 'ifcc'],
  cholesterol: ['mmol/L', 'mg/dL'],
  triglycerides: ['mmol/L', 'mg/dL'],
  creatinine: ['umol/L', 'mg/dL'],
  uricacid: ['umol/L', 'mg/dL'],
  bilirubin: ['umol/L', 'mg/dL'],
  calcium: ['mmol/L', 'mg/dL'],
  haemoglobin: ['g/L', 'g/dL'],
  landindia: ['acre', 'guntha'],
  cropyield: ['q/ha', 'kg/acre'],
  grain: ['t', 'buWheat'],
  application: ['L/ha', 'mL/acre'],
  spreading: ['m2/L', 'ft2/gal'],
  yarn: ['Ne', 'tex'],
  paper: ['gsm', 'bond'],
  jewellery: ['g', 'tola'],
  purity: ['K', 'fineness'],
  oregrade: ['g/t', 'oz/ton'],
  typography: ['pt', 'mm'],
  pixeldensity: ['ppi', 'ppcm'],
};

/** Ids of curated pairs, for the catalogue tests. */
export const PAIR_IDS: Readonly<Record<string, readonly [string, string]>> = PAIRS;

/** The two units a quantity opens with. */
export function defaultPair(category: UnitCategory): readonly [UnitDef, UnitDef] {
  const [from, to] = PAIRS[category.id] ?? [];
  const first = (from && findUnit(category, from)) || (category.units[0] as UnitDef);
  const second = (to && findUnit(category, to)) || (category.units.find((unit) => unit !== first) ?? first);
  return [first, second];
}

/** True when 1 unit is always the same amount of another: no offset, no reciprocal, no scale such as decibels. */
export const isProportional = (unit: UnitDef): boolean => !unit.toBase && !unit.reciprocal && !unit.offset;

/** How many `to` make one `from`, when both are proportional. */
export function unitRatio(from: UnitDef, to: UnitDef): number | null {
  return isProportional(from) && isProportional(to) ? from.factor / to.factor : null;
}
