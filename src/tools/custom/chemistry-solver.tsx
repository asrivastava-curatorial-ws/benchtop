/**
 * Chemistry Solver: balancing (redox in acidic or basic solution, half-
 * reactions), stoichiometry with the limiting reagent, empirical and
 * molecular formulas, oxidation states, pH of acids, bases and buffers,
 * equilibrium ICE tables, kinetics, titration curves, galvanic cells, gas
 * laws and solutions — each with worked steps and a check.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { GraphOptions } from '../../lib/calculus';
import type { AmountUnit, Balanced, ChemResult, Medium, Species } from '../../lib/chem-balance';
import type { Analyte, ConcentrationKind, Order, PhKind, PressureUnit, TemperatureUnit, VolumeUnit } from '../../lib/chem-solve';
import { copyText, htmlToPdf, isDesktop, saveFile } from '../../platform';
import { Icon } from '../../ui/icons';
import { printDocument } from '../../ui/print';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';
import { SolverField as Field, makeRender, type Render, ResultTable, SolverGraph, StepsList, solutionHtml, Tex } from './_solver';

type Mode = 'balance' | 'stoichiometry' | 'formula' | 'oxidation' | 'ph' | 'equilibrium' | 'kinetics' | 'titration' | 'cell' | 'gas' | 'solution';

const MODES: readonly { value: Mode; label: string }[] = [
  { value: 'balance', label: 'Balance' },
  { value: 'stoichiometry', label: 'Stoichiometry' },
  { value: 'formula', label: 'Formula' },
  { value: 'oxidation', label: 'Oxidation states' },
  { value: 'ph', label: 'pH' },
  { value: 'equilibrium', label: 'Equilibrium' },
  { value: 'kinetics', label: 'Kinetics' },
  { value: 'titration', label: 'Titration' },
  { value: 'cell', label: 'Cells' },
  { value: 'gas', label: 'Gases' },
  { value: 'solution', label: 'Solutions' },
];

interface ChemState {
  readonly mode: Mode;
  readonly equation: string;
  readonly medium: Medium;
  readonly half: boolean;
  readonly amounts: Readonly<Record<string, string>>;
  readonly actualSpecies: string;
  readonly actualGrams: string;
  readonly formulaMode: 'composition' | 'combustion';
  readonly composition: string;
  readonly molarMass: string;
  readonly sample: string;
  readonly co2: string;
  readonly h2o: string;
  readonly species: string;
  readonly phKind: PhKind;
  readonly c: string;
  readonly k: string;
  readonly kIsP: boolean;
  readonly cBase: string;
  readonly eqEquation: string;
  readonly K: string;
  readonly initial: Readonly<Record<string, string>>;
  readonly kinMode: 'law' | 'data';
  readonly order: Order;
  readonly rateK: string;
  readonly a0: string;
  readonly time: string;
  readonly target: string;
  readonly data: string;
  readonly analyte: Analyte;
  readonly tc: string;
  readonly tv: string;
  readonly tk: string;
  readonly titrant: string;
  readonly cathode: string;
  readonly anode: string;
  readonly celsius: string;
  readonly cellAmounts: Readonly<Record<string, string>>;
  readonly gasMode: 'ideal' | 'real';
  readonly solveFor: 'P' | 'V' | 'n' | 'T';
  readonly P: string;
  readonly Pu: PressureUnit;
  readonly V: string;
  readonly Vu: VolumeUnit;
  readonly n: string;
  readonly T: string;
  readonly Tu: TemperatureUnit;
  readonly gasFormula: string;
  readonly vdw: string;
  readonly vn: string;
  readonly vV: string;
  readonly vT: string;
  readonly solMode: 'prepare' | 'dilute' | 'convert';
  readonly solute: string;
  readonly molarity: string;
  readonly volume: string;
  readonly purity: string;
  readonly c1: string;
  readonly v1: string;
  readonly c2: string;
  readonly v2: string;
  readonly measure: ConcentrationKind;
  readonly measureValue: string;
  readonly density: string;
  readonly solvent: string;
}

const DEFAULTS: ChemState = {
  mode: 'balance',
  equation: 'KMnO4 + HCl -> KCl + MnCl2 + H2O + Cl2',
  medium: 'none',
  half: false,
  amounts: {},
  actualSpecies: '',
  actualGrams: '',
  formulaMode: 'composition',
  composition: 'C 40.0, H 6.71, O 53.3',
  molarMass: '180.16',
  sample: '0.255',
  co2: '0.561',
  h2o: '0.306',
  species: 'K2Cr2O7',
  phKind: 'weak-acid',
  c: '0.1',
  k: '1.75e-5',
  kIsP: false,
  cBase: '0.1',
  eqEquation: 'H2 + I2 <=> HI',
  K: '50.5',
  initial: {},
  kinMode: 'law',
  order: 1,
  rateK: '0.0693',
  a0: '1',
  time: '20',
  target: '',
  data: '0, 1.00\n10, 0.50\n20, 0.25\n30, 0.125\n40, 0.0625',
  analyte: 'weak-acid',
  tc: '0.1',
  tv: '25',
  tk: '1.75e-5',
  titrant: '0.1',
  cathode: 'Cu',
  anode: 'Zn',
  celsius: '25',
  cellAmounts: {},
  gasMode: 'ideal',
  solveFor: 'V',
  P: '1',
  Pu: 'atm',
  V: '22.4',
  Vu: 'L',
  n: '1',
  T: '0',
  Tu: 'C',
  gasFormula: '',
  vdw: 'CO2',
  vn: '1',
  vV: '1',
  vT: '300',
  solMode: 'prepare',
  solute: 'NaCl',
  molarity: '0.1',
  volume: '500',
  purity: '100',
  c1: '1',
  v1: '',
  c2: '0.1',
  v2: '500',
  measure: 'molality',
  measureValue: '1',
  density: '1.04',
  solvent: 'H2O',
};

const EXAMPLES: Partial<Record<Mode, readonly { label: string; set: Partial<ChemState> }[]>> = {
  balance: [
    { label: 'Propane burning', set: { equation: 'C3H8 + O2 -> CO2 + H2O', medium: 'none', half: false } },
    { label: 'Permanganate and hydrochloric acid', set: { equation: 'KMnO4 + HCl -> KCl + MnCl2 + H2O + Cl2', medium: 'none', half: false } },
    { label: 'Copper in nitric acid', set: { equation: 'Cu + HNO3 -> Cu(NO3)2 + NO + H2O', medium: 'none', half: false } },
    { label: 'Permanganate and iron(II), acidic', set: { equation: 'MnO4^- + Fe^2+ -> Mn^2+ + Fe^3+', medium: 'acidic', half: false } },
    { label: 'Permanganate and iodide, basic', set: { equation: 'MnO4^- + I^- -> MnO2 + I2', medium: 'basic', half: false } },
    { label: 'Dichromate half-reaction, acidic', set: { equation: 'Cr2O7^2- -> Cr^3+', medium: 'acidic', half: true } },
    { label: 'Hydrogen peroxide and permanganate', set: { equation: 'H2O2 + KMnO4 + H2SO4 -> K2SO4 + MnSO4 + O2 + H2O', medium: 'none', half: false } },
    { label: 'Ferrocyanide oxidised (a hard one)', set: { equation: 'K4[Fe(CN)6] + KMnO4 + H2SO4 -> KHSO4 + Fe2(SO4)3 + MnSO4 + HNO3 + CO2 + H2O', medium: 'none', half: false } },
  ],
  stoichiometry: [
    { label: 'Ammonia from 28 g N₂ and 10 g H₂', set: { equation: 'N2 + H2 -> NH3', amounts: { N2: '28 g', H2: '10 g' }, actualSpecies: 'NH3', actualGrams: '25.5' } },
    { label: 'Thermite: 100 g Al with 200 g Fe₂O₃', set: { equation: 'Al + Fe2O3 -> Al2O3 + Fe', amounts: { Al: '100 g', Fe2O3: '200 g' }, actualSpecies: '', actualGrams: '' } },
    { label: 'Burning 1 mol of glucose', set: { equation: 'C6H12O6 + O2 -> CO2 + H2O', amounts: { C6H12O6: '1 mol' }, actualSpecies: '', actualGrams: '' } },
  ],
  formula: [
    { label: 'Glucose from percentages', set: { formulaMode: 'composition', composition: 'C 40.0, H 6.71, O 53.3', molarMass: '180.16' } },
    { label: 'Iron oxide (needs doubling)', set: { formulaMode: 'composition', composition: 'Fe 69.94, O 30.06', molarMass: '' } },
    { label: 'Combustion of an alcohol', set: { formulaMode: 'combustion', sample: '0.255', co2: '0.561', h2o: '0.306', molarMass: '60.1' } },
  ],
  oxidation: [
    { label: 'Potassium dichromate', set: { species: 'K2Cr2O7' } },
    { label: 'Hydrogen peroxide', set: { species: 'H2O2' } },
    { label: 'Magnetite (an average)', set: { species: 'Fe3O4' } },
    { label: 'Potassium ferrocyanide', set: { species: 'K4[Fe(CN)6]' } },
    { label: 'Thiocyanate ion', set: { species: 'SCN^-' } },
  ],
  ph: [
    { label: '0.01 M HCl', set: { phKind: 'strong-acid', c: '0.01' } },
    { label: '0.1 M acetic acid', set: { phKind: 'weak-acid', c: '0.1', k: '1.75e-5', kIsP: false } },
    { label: '0.1 M ammonia', set: { phKind: 'weak-base', c: '0.1', k: '1.8e-5', kIsP: false } },
    { label: 'Acetate buffer, 0.1 M each', set: { phKind: 'buffer', c: '0.1', cBase: '0.1', k: '4.76', kIsP: true } },
    { label: 'Very dilute HCl (1e-8 M)', set: { phKind: 'strong-acid', c: '1e-8' } },
  ],
  equilibrium: [
    { label: 'Hydrogen iodide, K = 50.5', set: { eqEquation: 'H2 + I2 <=> HI', K: '50.5', initial: { H2: '1', I2: '1' } } },
    { label: 'N₂O₄ ⇌ NO₂, K = 4.63×10⁻³', set: { eqEquation: 'N2O4 <=> NO2', K: '4.63e-3', initial: { N2O4: '0.1' } } },
    { label: 'Haber process at 500 °C, K = 6.0×10⁻²', set: { eqEquation: 'N2 + H2 <=> NH3', K: '0.06', initial: { N2: '1', H2: '3' } } },
    { label: 'Limestone, K = 0.25', set: { eqEquation: 'CaCO3(s) <=> CaO(s) + CO2(g)', K: '0.25', initial: { 'CaCO3(s)': '1' } } },
  ],
  kinetics: [
    { label: 'First order, half-life 10 s', set: { kinMode: 'law', order: 1, rateK: '0.0693', a0: '1', time: '20', target: '' } },
    { label: 'Second order, time to reach 0.1 M', set: { kinMode: 'law', order: 2, rateK: '0.5', a0: '1', time: '', target: '0.1' } },
    { label: 'Data that halves every 10 s', set: { kinMode: 'data', data: '0, 1.00\n10, 0.50\n20, 0.25\n30, 0.125\n40, 0.0625' } },
    { label: 'Second-order data', set: { kinMode: 'data', data: '0, 0.500\n10, 0.333\n20, 0.250\n30, 0.200\n40, 0.167' } },
  ],
  titration: [
    { label: 'Acetic acid with NaOH', set: { analyte: 'weak-acid', tc: '0.1', tv: '25', tk: '1.75e-5', titrant: '0.1' } },
    { label: 'HCl with NaOH', set: { analyte: 'strong-acid', tc: '0.1', tv: '25', titrant: '0.1' } },
    { label: 'Ammonia with HCl', set: { analyte: 'weak-base', tc: '0.1', tv: '25', tk: '1.8e-5', titrant: '0.1' } },
  ],
  cell: [
    { label: 'Daniell cell (zinc and copper)', set: { cathode: 'Cu', anode: 'Zn', cellAmounts: {} } },
    { label: 'Silver and copper', set: { cathode: 'Ag', anode: 'Cu', cellAmounts: {} } },
    { label: 'Concentration effect: dilute Cu²⁺', set: { cathode: 'Cu', anode: 'Zn', cellAmounts: { 'Cu^2+(aq)': '0.01' } } },
    { label: 'Hydrogen–oxygen fuel cell', set: { cathode: 'O2', anode: 'H2', cellAmounts: {} } },
  ],
  gas: [
    { label: 'Molar volume at 0 °C, 1 atm', set: { gasMode: 'ideal', solveFor: 'V', P: '1', Pu: 'atm', n: '1', T: '0', Tu: 'C', gasFormula: '' } },
    { label: 'Pressure of 64 g O₂ in 10 L at 25 °C', set: { gasMode: 'ideal', solveFor: 'P', V: '10', Vu: 'L', n: '2', T: '25', Tu: 'C', gasFormula: 'O2' } },
    { label: 'CO₂ squeezed into 1 L (real gas)', set: { gasMode: 'real', vdw: 'CO2', vn: '1', vV: '1', vT: '300' } },
  ],
  solution: [
    { label: '500 mL of 0.1 M NaCl', set: { solMode: 'prepare', solute: 'NaCl', molarity: '0.1', volume: '500', purity: '100' } },
    { label: 'Dilute 1 M stock to 500 mL of 0.1 M', set: { solMode: 'dilute', c1: '1', v1: '', c2: '0.1', v2: '500' } },
    { label: '1 mol/kg NaCl in all units', set: { solMode: 'convert', solute: 'NaCl', measure: 'molality', measureValue: '1', density: '1.04', solvent: 'H2O' } },
  ],
};

/* ------------------------------------------------------------- persistence -- */

const str = (v: unknown, fallback: string, max = 2000) => (typeof v === 'string' && v.length <= max ? v : fallback);
const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);
const record = (v: unknown): Record<string, string> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 40)) if (typeof x === 'string' && k.length < 80 && x.length < 80) out[k] = x;
  return out;
};
const read = (v: Values | undefined): ChemState => {
  const s = (v ?? {}) as Record<string, unknown>;
  const d = DEFAULTS;
  return {
    mode: pick(
      s.mode,
      MODES.map((m) => m.value),
      d.mode,
    ),
    equation: str(s.equation, d.equation),
    medium: pick(s.medium, ['none', 'acidic', 'basic'] as const, d.medium),
    half: s.half === true,
    amounts: record(s.amounts),
    actualSpecies: str(s.actualSpecies, d.actualSpecies, 80),
    actualGrams: str(s.actualGrams, d.actualGrams, 40),
    formulaMode: pick(s.formulaMode, ['composition', 'combustion'] as const, d.formulaMode),
    composition: str(s.composition, d.composition),
    molarMass: str(s.molarMass, d.molarMass, 40),
    sample: str(s.sample, d.sample, 40),
    co2: str(s.co2, d.co2, 40),
    h2o: str(s.h2o, d.h2o, 40),
    species: str(s.species, d.species, 200),
    phKind: pick(s.phKind, ['strong-acid', 'strong-base', 'weak-acid', 'weak-base', 'buffer'] as const, d.phKind),
    c: str(s.c, d.c, 40),
    k: str(s.k, d.k, 40),
    kIsP: s.kIsP === true,
    cBase: str(s.cBase, d.cBase, 40),
    eqEquation: str(s.eqEquation, d.eqEquation),
    K: str(s.K, d.K, 40),
    initial: record(s.initial),
    kinMode: pick(s.kinMode, ['law', 'data'] as const, d.kinMode),
    order: s.order === 0 || s.order === 2 ? s.order : 1,
    rateK: str(s.rateK, d.rateK, 40),
    a0: str(s.a0, d.a0, 40),
    time: str(s.time, d.time, 40),
    target: str(s.target, d.target, 40),
    data: str(s.data, d.data, 20000),
    analyte: pick(s.analyte, ['strong-acid', 'weak-acid', 'strong-base', 'weak-base'] as const, d.analyte),
    tc: str(s.tc, d.tc, 40),
    tv: str(s.tv, d.tv, 40),
    tk: str(s.tk, d.tk, 40),
    titrant: str(s.titrant, d.titrant, 40),
    cathode: str(s.cathode, d.cathode, 20),
    anode: str(s.anode, d.anode, 20),
    celsius: str(s.celsius, d.celsius, 20),
    cellAmounts: record(s.cellAmounts),
    gasMode: pick(s.gasMode, ['ideal', 'real'] as const, d.gasMode),
    solveFor: pick(s.solveFor, ['P', 'V', 'n', 'T'] as const, d.solveFor),
    P: str(s.P, d.P, 40),
    Pu: pick(s.Pu, ['atm', 'kPa', 'bar', 'mmHg', 'Pa', 'psi'] as const, d.Pu),
    V: str(s.V, d.V, 40),
    Vu: pick(s.Vu, ['L', 'mL', 'm3'] as const, d.Vu),
    n: str(s.n, d.n, 40),
    T: str(s.T, d.T, 40),
    Tu: pick(s.Tu, ['K', 'C', 'F'] as const, d.Tu),
    gasFormula: str(s.gasFormula, d.gasFormula, 80),
    vdw: str(s.vdw, d.vdw, 20),
    vn: str(s.vn, d.vn, 40),
    vV: str(s.vV, d.vV, 40),
    vT: str(s.vT, d.vT, 40),
    solMode: pick(s.solMode, ['prepare', 'dilute', 'convert'] as const, d.solMode),
    solute: str(s.solute, d.solute, 80),
    molarity: str(s.molarity, d.molarity, 40),
    volume: str(s.volume, d.volume, 40),
    purity: str(s.purity, d.purity, 40),
    c1: str(s.c1, d.c1, 40),
    v1: str(s.v1, d.v1, 40),
    c2: str(s.c2, d.c2, 40),
    v2: str(s.v2, d.v2, 40),
    measure: pick(s.measure, ['molarity', 'molality', 'mass-percent', 'mole-fraction'] as const, d.measure),
    measureValue: str(s.measureValue, d.measureValue, 40),
    density: str(s.density, d.density, 40),
    solvent: str(s.solvent, d.solvent, 80),
  };
};
const write = (s: ChemState): Values => ({ ...s }) as unknown as Values;

/* ------------------------------------------------------------------ engine -- */

interface Engine {
  readonly bal: typeof import('../../lib/chem-balance');
  readonly sol: typeof import('../../lib/chem-solve');
  readonly kit: typeof import('../../lib/calculus');
  readonly render: Render;
}

let engine: Promise<Engine> | null = null;
const loadEngine = () => {
  engine ??= Promise.all([import('../../lib/chem-balance'), import('../../lib/chem-solve'), import('../../lib/calculus'), import('../../lib/tex')]).then(([bal, sol, kit, tex]) => ({
    bal,
    sol,
    kit,
    render: makeRender(tex.texToSvg),
  }));
  return engine;
};

/* ---------------------------------------------------------------- solving -- */

/** A number from a text box: blank is null; "1.8e-5", "1.8×10^-5" and "1,5" are understood. */
function num(text: string, what: string, required = true): number | null {
  const t = text
    .trim()
    .replace(/[−–]/g, '-')
    .replace(/\s*[×x*]\s*10\^?\s*/i, 'e')
    .replace(/^(\d+),(\d+)$/, '$1.$2');
  if (!t) {
    if (required) throw new Error(`Give ${what}.`);
    return null;
  }
  const v = Number(t);
  if (!Number.isFinite(v)) throw new Error(`“${text}” is not a number (${what}).`);
  return v;
}

function amountOf(text: string): { value: number; unit: AmountUnit } | null {
  const m = /^\s*([\d.]+(?:e-?\d+)?)\s*(g|mg|kg|mol|mmol)?\s*$/i.exec(text.replace(/[−–]/g, '-'));
  if (!m) return null;
  const value = Number(m[1]);
  if (!(value > 0)) return null;
  return { value, unit: ((m[2] ?? 'g').toLowerCase() === 'mmol' ? 'mmol' : (m[2] ?? 'g').toLowerCase()) as AmountUnit };
}

interface Solved {
  readonly title: string;
  readonly result: ChemResult;
  readonly graph?: GraphOptions;
  readonly lines?: readonly string[];
}

/** Species of an equation (balanced), for the per-species boxes; null when it does not read yet. */
function speciesOf(e: Engine, equation: string): { list: readonly Species[]; balanced: Balanced } | null {
  try {
    const b = e.bal.balance(equation);
    return { list: [...b.reactants, ...b.products].map((t) => t.species), balanced: b };
  } catch {
    return null;
  }
}

function solveChem(e: Engine, s: ChemState): Solved {
  const { bal, sol } = e;
  switch (s.mode) {
    case 'balance': {
      const b = bal.balance(s.equation, { medium: s.medium, half: s.half });
      return { title: 'Balanced equation', result: b, lines: b.redox };
    }
    case 'stoichiometry': {
      const b = bal.balance(s.equation);
      const terms = [...b.reactants, ...b.products];
      const amounts = terms.map((t) => amountOf(s.amounts[t.species.ce] ?? ''));
      const actualIndex = terms.findIndex((t) => t.species.ce === s.actualSpecies);
      const grams = num(s.actualGrams, 'the actual yield', false);
      const r = bal.stoichiometry(b, amounts, actualIndex >= 0 && grams && grams > 0 ? { index: actualIndex, grams } : undefined);
      return { title: 'Stoichiometry', result: r };
    }
    case 'formula': {
      const M = num(s.molarMass, 'the molar mass', false);
      if (s.formulaMode === 'composition') return { title: 'Empirical formula', result: bal.empiricalFormula(bal.parseComposition(s.composition), M ?? undefined) };
      return {
        title: 'Combustion analysis',
        result: bal.combustionAnalysis(num(s.sample, 'the sample mass') as number, num(s.co2, 'the mass of CO₂') as number, num(s.h2o, 'the mass of H₂O') as number, M ?? undefined),
      };
    }
    case 'oxidation':
      return { title: 'Oxidation states', result: bal.oxidationStates(s.species) };
    case 'ph': {
      const c = num(s.c, 'the concentration') as number;
      const raw = s.phKind === 'strong-acid' || s.phKind === 'strong-base' ? null : (num(s.k, s.kIsP ? 'the pK' : 'the K value') as number);
      const k = raw === null ? undefined : s.kIsP ? 10 ** -raw : raw;
      const cBase = s.phKind === 'buffer' ? (num(s.cBase, 'the concentration of the conjugate base') as number) : undefined;
      const r = sol.solvePh({ kind: s.phKind, c, ...(k !== undefined ? { k } : {}), ...(cBase !== undefined ? { cBase } : {}) });
      let graph: GraphOptions | undefined;
      if ((s.phKind === 'weak-acid' || s.phKind === 'buffer') && k) {
        graph = {
          from: 0,
          to: 14,
          variable: 'pH',
          lines: [
            { label: 'acid, HA', f: (pH) => 10 ** -pH / (10 ** -pH + k) },
            { label: 'conjugate base, A⁻', f: (pH) => k / (10 ** -pH + k), dashed: true },
          ],
          points: [{ x: r.value as number, y: k / (10 ** -(r.value as number) + k), label: `pH ${(r.value as number).toFixed(2)}` }],
        };
      }
      if (s.phKind === 'weak-base' && k) {
        const ka = 1e-14 / k;
        graph = {
          from: 0,
          to: 14,
          variable: 'pH',
          lines: [
            { label: 'conjugate acid, BH⁺', f: (pH) => 10 ** -pH / (10 ** -pH + ka) },
            { label: 'base, B', f: (pH) => ka / (10 ** -pH + ka), dashed: true },
          ],
          points: [{ x: r.value as number, y: ka / (10 ** -(r.value as number) + ka), label: `pH ${(r.value as number).toFixed(2)}` }],
        };
      }
      return { title: 'pH', result: r, ...(graph ? { graph } : {}) };
    }
    case 'equilibrium': {
      const sp = speciesOf(e, s.eqEquation.replace(/<=>|⇌|<->/, '->'));
      const K = num(s.K, 'K') as number;
      const initial = (sp?.list ?? []).map((x) => Math.max(0, num(s.initial[x.ce] ?? '', `the starting amount of ${x.ce}`, false) ?? 0));
      return { title: 'Equilibrium', result: sol.equilibrium(s.eqEquation, K, initial) };
    }
    case 'kinetics': {
      if (s.kinMode === 'law') {
        const k = num(s.rateK, 'k') as number;
        const a0 = num(s.a0, 'the starting concentration') as number;
        const t = num(s.time, 'a time', false);
        const a = num(s.target, 'a target concentration', false);
        const r = sol.rateLaw(s.order, k, a0, t ?? undefined, t === null ? (a ?? undefined) : undefined);
        const half = s.order === 0 ? a0 / (2 * k) : s.order === 1 ? Math.LN2 / k : 1 / (k * a0);
        const end = Math.max(4 * half, (t ?? 0) * 1.2, t === null && a !== null ? (r.value as number) * 1.2 : 0);
        const at = (x: number) => (s.order === 0 ? Math.max(0, a0 - k * x) : s.order === 1 ? a0 * Math.exp(-k * x) : 1 / (1 / a0 + k * x));
        const points = [{ x: half, y: a0 / 2, label: 't½' }, ...(t !== null ? [{ x: t, y: at(t), label: `t = ${t}` }] : a !== null ? [{ x: r.value as number, y: a, label: `[A] = ${a}` }] : [])];
        return { title: 'Rate law', result: r, graph: { from: 0, to: end, variable: 't', lines: [{ label: '[A]', f: at }], points } };
      }
      const rows = s.data
        .split(/\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split(/[\s,;\t]+/).map(Number));
      if (rows.some((r) => r.length < 2 || r.some((x) => !Number.isFinite(x)))) throw new Error('Write each measurement on its own line: time, then concentration.');
      const t = rows.map((r) => r[0] as number);
      const a = rows.map((r) => r[1] as number);
      const r = sol.orderFromData(t, a);
      const f = r.best;
      const label = ['[A]', 'ln[A]', '1/[A]'][f.order] as string;
      const tMax = Math.max(...t);
      return {
        title: 'Reaction order from data',
        result: r,
        graph: {
          from: Math.min(...t),
          to: tMax,
          variable: 't',
          lines: [{ label: `straight-line fit of ${label}`, f: (x) => f.intercept + f.slope * x }],
          points: t.map((x, i) => ({ x, y: f.order === 0 ? (a[i] as number) : f.order === 1 ? Math.log(a[i] as number) : 1 / (a[i] as number), label: '' })),
        },
      };
    }
    case 'titration': {
      const weak = s.analyte === 'weak-acid' || s.analyte === 'weak-base';
      const r = sol.titration({
        analyte: s.analyte,
        c: num(s.tc, 'the analyte concentration') as number,
        volume: num(s.tv, 'the analyte volume') as number,
        titrant: num(s.titrant, 'the titrant concentration') as number,
        ...(weak ? { k: num(s.tk, s.analyte === 'weak-acid' ? 'Ka' : 'Kb') as number } : {}),
      });
      return {
        title: 'Titration curve',
        result: r,
        graph: { from: 0, to: r.maxVolume, variable: 'mL of titrant', lines: [{ label: 'pH', f: r.ph }], points: r.points.map((p) => ({ x: p.v, y: p.ph, label: p.label })) },
      };
    }
    case 'cell': {
      const amounts: Record<string, number> = {};
      for (const [k, v] of Object.entries(s.cellAmounts)) {
        const x = num(v, `the amount of ${k}`, false);
        if (x !== null && x > 0) amounts[k] = x;
      }
      const celsius = num(s.celsius, 'the temperature', false) ?? 25;
      const r = sol.cell(s.cathode, s.anode, amounts, celsius + 273.15);
      return { title: 'Galvanic cell', result: r };
    }
    case 'gas': {
      if (s.gasMode === 'real') {
        const gas = sol.VDW_GASES.find((g) => g.formula === s.vdw) ?? sol.VDW_GASES[0];
        if (!gas) throw new Error('Choose a gas.');
        const n = num(s.vn, 'the amount') as number;
        const V = num(s.vV, 'the volume') as number;
        const T = num(s.vT, 'the temperature') as number;
        const r = sol.vanDerWaals(gas, n, V, T);
        const lo = Math.max(n * gas.b * 1.6, V / 4);
        return {
          title: `${gas.name} as a real gas`,
          result: r,
          graph: {
            from: lo,
            to: V * 3,
            variable: 'V (L)',
            lines: [
              { label: 'van der Waals', f: (v) => (n * sol.R_LBAR * T) / (v - n * gas.b) - (gas.a * n * n) / (v * v) },
              { label: 'ideal gas', f: (v) => (n * sol.R_LBAR * T) / v, dashed: true },
            ],
            points: [{ x: V, y: r.value as number, label: `${(r.value as number).toFixed(2)} bar` }],
          },
        };
      }
      const val = (key: 'P' | 'V' | 'n' | 'T', what: string) => (s.solveFor === key ? null : (num(s[key], what) as number));
      const P = val('P', 'the pressure');
      const V = val('V', 'the volume');
      const n = val('n', 'the amount');
      const T = val('T', 'the temperature');
      const r = sol.idealGas({
        solveFor: s.solveFor,
        ...(P !== null ? { P: [P, s.Pu] as const } : {}),
        ...(V !== null ? { V: [V, s.Vu] as const } : {}),
        ...(n !== null ? { n } : {}),
        ...(T !== null ? { T: [T, s.Tu] as const } : {}),
        ...(s.gasFormula.trim() ? { formula: s.gasFormula.trim() } : {}),
      });
      return { title: 'Ideal gas law', result: r };
    }
    case 'solution': {
      if (s.solMode === 'prepare') {
        const v = num(s.volume, 'the volume') as number;
        return { title: 'Making a solution', result: sol.prepareSolution(s.solute, num(s.molarity, 'the molarity') as number, v / 1000, num(s.purity, 'the purity', false) ?? 100) };
      }
      if (s.solMode === 'dilute') return { title: 'Dilution', result: sol.dilution(num(s.c1, 'C₁', false), num(s.v1, 'V₁', false), num(s.c2, 'C₂', false), num(s.v2, 'V₂', false)) };
      return {
        title: 'Concentration units',
        result: sol.convertConcentration(s.solute, s.measure, num(s.measureValue, 'the concentration') as number, num(s.density, 'the density', false), s.solvent.trim() || 'H2O'),
      };
    }
  }
}

/* ------------------------------------------------------------------- tool -- */

function ChemistrySolver({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, read, write);
  const [e, setEngine] = useState<Engine | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [out, setOut] = useState<{ solved: Solved | null; error: string | null }>({ solved: null, error: null });
  const [busy, setBusy] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    void loadEngine().then(
      (loaded) => setEngine(() => loaded),
      (error: unknown) => setFailed(error instanceof Error ? error.message : String(error)),
    );
  }, []);

  useEffect(() => {
    if (!e) return;
    setBusy(true);
    const timer = setTimeout(
      () => {
        try {
          setOut({ solved: solveChem(e, state), error: null });
        } catch (error) {
          setOut({ solved: null, error: error instanceof Error ? error.message : String(error) });
        }
        setBusy(false);
      },
      first.current ? 0 : 350,
    );
    first.current = false;
    return () => clearTimeout(timer);
  }, [e, state]);

  const set = <K extends keyof ChemState>(key: K, value: ChemState[K]) => setState((s) => ({ ...s, [key]: value }));
  const stoichSpecies = useMemo(() => (e && state.mode === 'stoichiometry' ? speciesOf(e, state.equation) : null), [e, state.mode, state.equation]);
  const eqSpecies = useMemo(() => (e && state.mode === 'equilibrium' ? speciesOf(e, state.eqEquation.replace(/<=>|⇌|<->/, '->')) : null), [e, state.mode, state.eqEquation]);
  const cellVariables = out.solved && state.mode === 'cell' ? ((out.solved.result as { variables?: readonly Species[] }).variables ?? []) : [];
  const solved = out.solved;
  const r = solved?.result ?? null;

  const save = (kind: 'html' | 'pdf') =>
    attempt(async () => {
      if (!e || !solved) throw new Error('There is no answer to save yet.');
      const html = solutionHtml({
        title: solved.title,
        answerTex: solved.result.tex,
        notes: [solved.result.note ?? '', solved.result.check, ...(solved.lines ?? [])],
        steps: solved.result.steps,
        table: solved.result.table,
        graph: solved.graph ? e.kit.graphSvg(solved.graph) : undefined,
        render: e.render,
        tool: 'Chemistry Solver',
      });
      const name = solved.title.replace(/[^\w ]+/g, '').trim() || 'Chemistry';
      if (kind === 'html') {
        const outcome = await saveFile(`${name}.html`, html, 'text/html');
        if (outcome.saved) notify(`Saved to ${outcome.location}`);
      } else if (!isDesktop) printDocument(html);
      else {
        const outcome = await saveFile(`${name}.pdf`, await htmlToPdf(html), 'application/pdf');
        if (outcome.saved) notify(`Saved to ${outcome.location}`);
      }
    });

  const examples = EXAMPLES[state.mode] ?? [];
  const sol = e?.sol;
  return (
    <section class="tool cx-tool ch-tool" data-testid="tool" data-state={busy ? 'busy' : solved ? 'done' : 'idle'}>
      <div class="button-row cx-bar">
        <Segmented label="What to work out" value={state.mode} onChange={(mode) => set('mode', mode)} choices={MODES} />
      </div>

      <div class="cx-inputs" data-testid="ch-inputs">
        {(state.mode === 'balance' || state.mode === 'stoichiometry') && (
          <Field label="Reaction" value={state.equation} onInput={(v) => set('equation', v)} test="ch-equation" wide hint="KMnO4 + HCl -> KCl + MnCl2 + H2O + Cl2" />
        )}
        {state.mode === 'balance' && (
          <>
            <Segmented
              label="Medium"
              value={state.medium}
              onChange={(m) => set('medium', m)}
              choices={[
                { value: 'none', label: 'As written' },
                { value: 'acidic', label: 'Acidic solution' },
                { value: 'basic', label: 'Basic solution' },
              ]}
            />
            <label class="cx-check-label">
              <input type="checkbox" checked={state.half} onChange={(ev) => set('half', ev.currentTarget.checked)} data-testid="ch-half" /> Half-reaction (add electrons)
            </label>
          </>
        )}
        {state.mode === 'stoichiometry' &&
          stoichSpecies?.list.map((sp) => (
            <Field
              key={sp.ce}
              label={e?.bal.speciesText(sp) ?? sp.ce}
              value={state.amounts[sp.ce] ?? ''}
              onInput={(v) => set('amounts', { ...state.amounts, [sp.ce]: v })}
              test={`ch-amount-${sp.formula}`}
              hint="g or mol"
            />
          ))}
        {state.mode === 'stoichiometry' && stoichSpecies && (
          <>
            <label class="cx-field">
              <span class="control-label">Actual yield of</span>
              <select class="select" value={state.actualSpecies} onChange={(ev) => set('actualSpecies', ev.currentTarget.value)} data-testid="ch-actual-species">
                <option value="">(none)</option>
                {stoichSpecies.balanced.products.map((t) => (
                  <option key={t.species.ce} value={t.species.ce}>
                    {e?.bal.speciesText(t.species)}
                  </option>
                ))}
              </select>
            </label>
            {state.actualSpecies && <Field label="Grams obtained" value={state.actualGrams} onInput={(v) => set('actualGrams', v)} test="ch-actual-grams" />}
          </>
        )}
        {state.mode === 'formula' && (
          <>
            <Segmented
              label="From"
              value={state.formulaMode}
              onChange={(m) => set('formulaMode', m)}
              choices={[
                { value: 'composition', label: 'Percentages or masses' },
                { value: 'combustion', label: 'Combustion analysis' },
              ]}
            />
            {state.formulaMode === 'composition' ? (
              <Field label="Composition" value={state.composition} onInput={(v) => set('composition', v)} test="ch-composition" wide hint="C 40.0, H 6.71, O 53.3" />
            ) : (
              <>
                <Field label="Sample (g)" value={state.sample} onInput={(v) => set('sample', v)} test="ch-sample" />
                <Field label="CO₂ formed (g)" value={state.co2} onInput={(v) => set('co2', v)} test="ch-co2" />
                <Field label="H₂O formed (g)" value={state.h2o} onInput={(v) => set('h2o', v)} test="ch-h2o" />
              </>
            )}
            <Field label="Molar mass (g/mol, optional)" value={state.molarMass} onInput={(v) => set('molarMass', v)} test="ch-molar-mass" />
          </>
        )}
        {state.mode === 'oxidation' && <Field label="Formula or ion" value={state.species} onInput={(v) => set('species', v)} test="ch-species" wide hint="K2Cr2O7, SO4^2-, [Cu(NH3)4]SO4" />}
        {state.mode === 'ph' && (
          <>
            <Segmented
              label="Solution"
              value={state.phKind}
              onChange={(k) => set('phKind', k)}
              choices={[
                { value: 'strong-acid', label: 'Strong acid' },
                { value: 'strong-base', label: 'Strong base' },
                { value: 'weak-acid', label: 'Weak acid' },
                { value: 'weak-base', label: 'Weak base' },
                { value: 'buffer', label: 'Buffer' },
              ]}
            />
            <Field label={state.phKind === 'buffer' ? 'Acid (mol/L)' : 'Concentration (mol/L)'} value={state.c} onInput={(v) => set('c', v)} test="ch-c" />
            {state.phKind === 'buffer' && <Field label="Conjugate base (mol/L)" value={state.cBase} onInput={(v) => set('cBase', v)} test="ch-cbase" />}
            {state.phKind !== 'strong-acid' && state.phKind !== 'strong-base' && (
              <>
                <Field label={`${state.kIsP ? 'p' : ''}K${state.phKind === 'weak-base' ? 'b' : 'a'}`} value={state.k} onInput={(v) => set('k', v)} test="ch-k" />
                <Segmented
                  label="Constant as"
                  value={state.kIsP ? 'p' : 'k'}
                  onChange={(v) => set('kIsP', v === 'p')}
                  choices={[
                    { value: 'k', label: 'K' },
                    { value: 'p', label: 'pK' },
                  ]}
                />
                {sol && (
                  <label class="cx-field">
                    <span class="control-label">Common {state.phKind === 'weak-base' ? 'bases' : 'acids'}</span>
                    <select
                      class="select"
                      value=""
                      onChange={(ev) => {
                        const list = state.phKind === 'weak-base' ? sol.BASES : sol.ACIDS;
                        const found = list.find((a) => a.name === ev.currentTarget.value);
                        if (found) setState((s) => ({ ...s, k: String(found.k), kIsP: false }));
                        ev.currentTarget.value = '';
                      }}
                      data-testid="ch-common"
                    >
                      <option value="">Choose…</option>
                      {(state.phKind === 'weak-base' ? sol.BASES : sol.ACIDS).map((a) => (
                        <option key={a.name} value={a.name}>
                          {a.name} ({a.k.toExponential(1)})
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
          </>
        )}
        {state.mode === 'equilibrium' && (
          <>
            <Field label="Reaction" value={state.eqEquation} onInput={(v) => set('eqEquation', v)} test="ch-eq-equation" wide hint="N2 + H2 <=> NH3" />
            <Field label="K" value={state.K} onInput={(v) => set('K', v)} test="ch-K" />
            {eqSpecies?.list.map((sp) => (
              <Field
                key={sp.ce}
                label={`[${e?.bal.speciesText(sp) ?? sp.ce}]₀`}
                value={state.initial[sp.ce] ?? ''}
                onInput={(v) => set('initial', { ...state.initial, [sp.ce]: v })}
                test={`ch-initial-${sp.formula}`}
                hint="mol/L"
              />
            ))}
          </>
        )}
        {state.mode === 'kinetics' && (
          <>
            <Segmented
              label="From"
              value={state.kinMode}
              onChange={(m) => set('kinMode', m)}
              choices={[
                { value: 'law', label: 'Rate law' },
                { value: 'data', label: 'Order from data' },
              ]}
            />
            {state.kinMode === 'law' ? (
              <>
                <Segmented
                  label="Order"
                  value={String(state.order) as '0' | '1' | '2'}
                  onChange={(o) => set('order', Number(o) as Order)}
                  choices={[
                    { value: '0', label: 'Zero order' },
                    { value: '1', label: 'First order' },
                    { value: '2', label: 'Second order' },
                  ]}
                />
                <Field label="k" value={state.rateK} onInput={(v) => set('rateK', v)} test="ch-rate-k" />
                <Field label="[A]₀ (mol/L)" value={state.a0} onInput={(v) => set('a0', v)} test="ch-a0" />
                <Field label="After time t" value={state.time} onInput={(v) => set('time', v)} test="ch-time" />
                <Field label="Or time to reach [A]" value={state.target} onInput={(v) => set('target', v)} test="ch-target" />
              </>
            ) : (
              <label class="cx-field cx-wide">
                <span class="control-label">Time, concentration (one pair per line)</span>
                <textarea class="input cx-input ch-data" rows={6} value={state.data} onInput={(ev) => set('data', ev.currentTarget.value)} data-testid="ch-data" spellcheck={false} />
              </label>
            )}
          </>
        )}
        {state.mode === 'titration' && (
          <>
            <Segmented
              label="Analyte"
              value={state.analyte}
              onChange={(a) => set('analyte', a)}
              choices={[
                { value: 'strong-acid', label: 'Strong acid' },
                { value: 'weak-acid', label: 'Weak acid' },
                { value: 'strong-base', label: 'Strong base' },
                { value: 'weak-base', label: 'Weak base' },
              ]}
            />
            <Field label="Analyte (mol/L)" value={state.tc} onInput={(v) => set('tc', v)} test="ch-tc" />
            <Field label="Analyte volume (mL)" value={state.tv} onInput={(v) => set('tv', v)} test="ch-tv" />
            {(state.analyte === 'weak-acid' || state.analyte === 'weak-base') && (
              <Field label={state.analyte === 'weak-acid' ? 'Ka' : 'Kb'} value={state.tk} onInput={(v) => set('tk', v)} test="ch-tk" />
            )}
            <Field label={`${state.analyte.endsWith('acid') ? 'NaOH' : 'HCl'} titrant (mol/L)`} value={state.titrant} onInput={(v) => set('titrant', v)} test="ch-titrant" />
          </>
        )}
        {state.mode === 'cell' && sol && (
          <>
            {(['cathode', 'anode'] as const).map((which) => (
              <label key={which} class="cx-field cx-wide">
                <span class="control-label">{which === 'cathode' ? 'One electrode' : 'The other electrode'}</span>
                <select class="select" value={state[which]} onChange={(ev) => setState((s) => ({ ...s, [which]: ev.currentTarget.value, cellAmounts: {} }))} data-testid={`ch-${which}`}>
                  {sol.HALF_REACTIONS.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.equation.replace(/->/, '→').replace(/\^/g, '')} ({h.e0 >= 0 ? '+' : ''}
                      {h.e0} V)
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <Field label="Temperature (°C)" value={state.celsius} onInput={(v) => set('celsius', v)} test="ch-celsius" />
            {cellVariables.map((sp) => (
              <Field
                key={sp.ce}
                label={`${e?.bal.speciesText(sp)} (${sp.state === 'g' ? 'atm' : 'mol/L'})`}
                value={state.cellAmounts[sp.ce] ?? ''}
                onInput={(v) => set('cellAmounts', { ...state.cellAmounts, [sp.ce]: v })}
                test={`ch-cell-${sp.formula}`}
                hint="1"
              />
            ))}
          </>
        )}
        {state.mode === 'gas' && sol && (
          <>
            <Segmented
              label="Gas model"
              value={state.gasMode}
              onChange={(m) => set('gasMode', m)}
              choices={[
                { value: 'ideal', label: 'Ideal gas' },
                { value: 'real', label: 'Real gas (van der Waals)' },
              ]}
            />
            {state.gasMode === 'ideal' ? (
              <>
                <label class="cx-field">
                  <span class="control-label">Find</span>
                  <select class="select" value={state.solveFor} onChange={(ev) => set('solveFor', ev.currentTarget.value as ChemState['solveFor'])} data-testid="ch-solve-for">
                    <option value="P">Pressure</option>
                    <option value="V">Volume</option>
                    <option value="n">Amount</option>
                    <option value="T">Temperature</option>
                  </select>
                </label>
                {state.solveFor !== 'P' && (
                  <span class="ch-unit-field">
                    <Field label="P" value={state.P} onInput={(v) => set('P', v)} test="ch-P" />
                    <select class="select select-small" aria-label="Pressure unit" value={state.Pu} onChange={(ev) => set('Pu', ev.currentTarget.value as PressureUnit)}>
                      {(['atm', 'kPa', 'bar', 'mmHg', 'Pa', 'psi'] as const).map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </span>
                )}
                {state.solveFor !== 'V' && (
                  <span class="ch-unit-field">
                    <Field label="V" value={state.V} onInput={(v) => set('V', v)} test="ch-V" />
                    <select class="select select-small" aria-label="Volume unit" value={state.Vu} onChange={(ev) => set('Vu', ev.currentTarget.value as VolumeUnit)}>
                      <option value="L">L</option>
                      <option value="mL">mL</option>
                      <option value="m3">m³</option>
                    </select>
                  </span>
                )}
                {state.solveFor !== 'n' && <Field label="n (mol)" value={state.n} onInput={(v) => set('n', v)} test="ch-n" />}
                {state.solveFor !== 'T' && (
                  <span class="ch-unit-field">
                    <Field label="T" value={state.T} onInput={(v) => set('T', v)} test="ch-T" />
                    <select class="select select-small" aria-label="Temperature unit" value={state.Tu} onChange={(ev) => set('Tu', ev.currentTarget.value as TemperatureUnit)}>
                      <option value="K">K</option>
                      <option value="C">°C</option>
                      <option value="F">°F</option>
                    </select>
                  </span>
                )}
                <Field label="Gas formula (optional)" value={state.gasFormula} onInput={(v) => set('gasFormula', v)} test="ch-gas-formula" hint="O2" />
              </>
            ) : (
              <>
                <label class="cx-field">
                  <span class="control-label">Gas</span>
                  <select class="select" value={state.vdw} onChange={(ev) => set('vdw', ev.currentTarget.value)} data-testid="ch-vdw">
                    {sol.VDW_GASES.map((g) => (
                      <option key={g.formula} value={g.formula}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Field label="n (mol)" value={state.vn} onInput={(v) => set('vn', v)} test="ch-vn" />
                <Field label="V (L)" value={state.vV} onInput={(v) => set('vV', v)} test="ch-vV" />
                <Field label="T (K)" value={state.vT} onInput={(v) => set('vT', v)} test="ch-vT" />
              </>
            )}
          </>
        )}
        {state.mode === 'solution' && (
          <>
            <Segmented
              label="Task"
              value={state.solMode}
              onChange={(m) => set('solMode', m)}
              choices={[
                { value: 'prepare', label: 'Make a solution' },
                { value: 'dilute', label: 'Dilution' },
                { value: 'convert', label: 'Convert units' },
              ]}
            />
            {state.solMode === 'prepare' && (
              <>
                <Field label="Solute" value={state.solute} onInput={(v) => set('solute', v)} test="ch-solute" />
                <Field label="Molarity (mol/L)" value={state.molarity} onInput={(v) => set('molarity', v)} test="ch-molarity" />
                <Field label="Volume (mL)" value={state.volume} onInput={(v) => set('volume', v)} test="ch-volume" />
                <Field label="Purity (%)" value={state.purity} onInput={(v) => set('purity', v)} test="ch-purity" />
              </>
            )}
            {state.solMode === 'dilute' && (
              <>
                <Field label="C₁ (stock)" value={state.c1} onInput={(v) => set('c1', v)} test="ch-c1" hint="leave one blank" />
                <Field label="V₁ (stock)" value={state.v1} onInput={(v) => set('v1', v)} test="ch-v1" hint="leave one blank" />
                <Field label="C₂ (final)" value={state.c2} onInput={(v) => set('c2', v)} test="ch-c2" hint="leave one blank" />
                <Field label="V₂ (final)" value={state.v2} onInput={(v) => set('v2', v)} test="ch-v2" hint="leave one blank" />
              </>
            )}
            {state.solMode === 'convert' && (
              <>
                <Field label="Solute" value={state.solute} onInput={(v) => set('solute', v)} test="ch-solute" />
                <label class="cx-field">
                  <span class="control-label">Given as</span>
                  <select class="select" value={state.measure} onChange={(ev) => set('measure', ev.currentTarget.value as ConcentrationKind)} data-testid="ch-measure">
                    <option value="molarity">Molarity (mol/L)</option>
                    <option value="molality">Molality (mol/kg)</option>
                    <option value="mass-percent">Mass percent</option>
                    <option value="mole-fraction">Mole fraction</option>
                  </select>
                </label>
                <Field label="Value" value={state.measureValue} onInput={(v) => set('measureValue', v)} test="ch-measure-value" />
                <Field label="Density (g/mL)" value={state.density} onInput={(v) => set('density', v)} test="ch-density" />
                <Field label="Solvent" value={state.solvent} onInput={(v) => set('solvent', v)} test="ch-solvent" />
              </>
            )}
          </>
        )}
        {examples.length > 0 && (
          <label class="cx-field">
            <span class="control-label">Examples</span>
            <select
              class="select"
              value=""
              data-testid="ch-example"
              onChange={(ev) => {
                const chosen = examples[Number(ev.currentTarget.value)];
                if (chosen) setState((s) => ({ ...s, ...chosen.set }));
                ev.currentTarget.value = '';
              }}
            >
              <option value="">Choose an example…</option>
              {examples.map((x, i) => (
                <option key={x.label} value={i}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {failed && <p class="tone-bad">The solver could not load: {failed}</p>}
      {!e && !failed && <p class="tone-muted">Loading the solver…</p>}
      {out.error && (
        <p class="cx-error" role="alert" data-testid="cx-error">
          <Icon name="alert" /> {out.error}
        </p>
      )}

      {e && solved && r && (
        <div class={`cx-out${solved.graph ? '' : ' cx-no-graph'}`}>
          <div class="cx-result" data-testid="cx-result">
            <h2 class="cx-title">{solved.title}</h2>
            <div class="cx-answer" data-testid="cx-answer" data-ok={r.ok ? 'yes' : 'no'}>
              <Tex render={e.render} latex={r.tex} display />
            </div>
            {r.note && <p class="cx-note">{r.note}</p>}
            <p class="cx-check" data-testid="cx-check">
              ✓ {r.check}
            </p>
            {solved.lines && solved.lines.length > 0 && (
              <ul class="ch-lines" data-testid="ch-redox">
                {solved.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            <div class="button-row cx-actions">
              <button type="button" class="button button-small" onClick={() => attempt(async () => copyText(r.text).then(() => notify('Answer copied')))} data-testid="ch-copy">
                <Icon name="copy" /> Copy answer
              </button>
              <button type="button" class="button button-small" onClick={() => attempt(async () => copyText(r.tex).then(() => notify('LaTeX copied')))}>
                <Icon name="copy" /> Copy LaTeX
              </button>
              <button type="button" class="button button-small" onClick={() => save('html')} data-testid="cx-save-html">
                Save as web page
              </button>
              <button type="button" class="button button-small" onClick={() => save('pdf')}>
                {isDesktop ? 'Save as PDF' : 'Print or PDF'}
              </button>
            </div>
            {r.table && <ResultTable table={r.table} label={solved.title} />}
          </div>
          {solved.graph && <SolverGraph kit={e.kit} options={solved.graph} />}
          <StepsList render={e.render} steps={r.steps} />
        </div>
      )}
      <details class="cx-help">
        <summary>How to write formulas</summary>
        <p>
          Element symbols start with a capital letter (<code>Co</code> is cobalt, <code>CO</code> carbon monoxide). Charges go after <code>^</code>: <code>Fe^3+</code>, <code>SO4^2-</code>; a single
          charge can be written <code>NH4+</code> or <code>Cl-</code>. States go in brackets (<code>H2O(l)</code>, <code>CO2(g)</code>), hydrates with a dot (<code>CuSO4·5H2O</code> or{' '}
          <code>CuSO4.5H2O</code>), electrons as <code>e-</code>. Use <code>-&gt;</code> or <code>=</code> for a reaction and <code>&lt;=&gt;</code> for an equilibrium.
        </p>
      </details>
    </section>
  );
}

export default defineCustomTool(ChemistrySolver);
