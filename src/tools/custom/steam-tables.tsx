/**
 * Steam tables from IAPWS-IF97: the state at any two known values, saturation
 * tables by temperature or pressure, and a table along one pressure.
 */
import { useMemo } from 'preact/hooks';
import {
  conductivity,
  mixture,
  P_CRIT,
  type Saturation,
  type State,
  saturationAtP,
  saturationAtT,
  saturationTemperature,
  statePH,
  statePS,
  stateTP,
  surfaceTension,
  T_CRIT,
  viscosity,
} from '../../lib/steam/if97';
import { copyText, saveFile } from '../../platform';
import { scrollRegion } from '../../ui/a11y';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { type SegmentChoice, Segmented, usePersistentState } from './_shared';

type Mode = 'state' | 'saturation' | 'isobar';
type Known = 'pT' | 'satT' | 'satP' | 'ph' | 'ps' | 'px' | 'Tx';
type System = 'si' | 'mpa' | 'us';

interface InputUnit {
  readonly id: string;
  readonly label: string;
  /** To the library's units (MPa, K, kJ/kg, kJ/(kg·K)); `atm` is the air pressure in MPa for gauge readings. */
  readonly toSI: (value: number, atm: number) => number;
  readonly gauge?: boolean;
}

const PSI = 0.006894757293168;
const KGF_CM2 = 0.0980665;

const PRESSURE_IN: readonly InputUnit[] = [
  { id: 'bar', label: 'bar (absolute)', toSI: (v) => v / 10 },
  { id: 'barg', label: 'bar (gauge)', toSI: (v, atm) => v / 10 + atm, gauge: true },
  { id: 'MPa', label: 'MPa', toSI: (v) => v },
  { id: 'kPa', label: 'kPa', toSI: (v) => v / 1000 },
  { id: 'kgcm2g', label: 'kgf/cm² (gauge)', toSI: (v, atm) => v * KGF_CM2 + atm, gauge: true },
  { id: 'kgcm2', label: 'kgf/cm² (absolute)', toSI: (v) => v * KGF_CM2 },
  { id: 'psia', label: 'psia', toSI: (v) => v * PSI },
  { id: 'psig', label: 'psig', toSI: (v, atm) => v * PSI + atm, gauge: true },
];
const TEMPERATURE_IN: readonly InputUnit[] = [
  { id: 'C', label: '°C', toSI: (v) => v + 273.15 },
  { id: 'K', label: 'K', toSI: (v) => v },
  { id: 'F', label: '°F', toSI: (v) => ((v + 459.67) * 5) / 9 },
];
const ENTHALPY_IN: readonly InputUnit[] = [
  { id: 'kJ/kg', label: 'kJ/kg', toSI: (v) => v },
  { id: 'Btu/lb', label: 'Btu/lb', toSI: (v) => v * 2.326 },
  { id: 'kcal/kg', label: 'kcal/kg', toSI: (v) => v * 4.1868 },
];
const ENTROPY_IN: readonly InputUnit[] = [
  { id: 'kJ/kgK', label: 'kJ/(kg·K)', toSI: (v) => v },
  { id: 'Btu/lbF', label: 'Btu/(lb·°F)', toSI: (v) => v * 4.1868 },
  { id: 'kcal/kgK', label: 'kcal/(kg·K)', toSI: (v) => v * 4.1868 },
];
const QUALITY_IN: readonly InputUnit[] = [
  { id: 'pct', label: '% dry', toSI: (v) => v / 100 },
  { id: 'fraction', label: 'fraction', toSI: (v) => v },
];

const KNOWN: readonly { readonly value: Known; readonly label: string; readonly fields: readonly Field[] }[] = [
  { value: 'pT', label: 'Pressure and temperature', fields: ['p', 'T'] },
  { value: 'satP', label: 'Saturation at a pressure', fields: ['p'] },
  { value: 'satT', label: 'Saturation at a temperature', fields: ['T'] },
  { value: 'ph', label: 'Pressure and enthalpy', fields: ['p', 'h'] },
  { value: 'ps', label: 'Pressure and entropy', fields: ['p', 's'] },
  { value: 'px', label: 'Pressure and dryness fraction', fields: ['p', 'x'] },
  { value: 'Tx', label: 'Temperature and dryness fraction', fields: ['T', 'x'] },
];

type Field = 'p' | 'T' | 'h' | 's' | 'x';

const FIELD_UNITS: Readonly<Record<Field, readonly InputUnit[]>> = { p: PRESSURE_IN, T: TEMPERATURE_IN, h: ENTHALPY_IN, s: ENTROPY_IN, x: QUALITY_IN };
const FIELD_LABELS: Readonly<Record<Field, string>> = { p: 'Pressure', T: 'Temperature', h: 'Specific enthalpy', s: 'Specific entropy', x: 'Dryness fraction (quality)' };

/* --------------------------------------------------------- output units -- */

type Quantity = 'T' | 'dT' | 'p' | 'v' | 'rho' | 'h' | 's' | 'w' | 'mu' | 'nu' | 'k' | 'sigma' | 'none';

interface OutUnit {
  readonly label: string;
  readonly from: (si: number) => number;
}

const SAME = (x: number) => x;
const SYSTEMS: Readonly<Record<System, { readonly label: string; readonly units: Readonly<Record<Quantity, OutUnit>> }>> = {
  si: {
    label: '°C, bar, kJ/kg',
    units: {
      T: { label: '°C', from: (K) => K - 273.15 },
      dT: { label: 'K', from: SAME },
      p: { label: 'bar', from: (MPa) => MPa * 10 },
      v: { label: 'm³/kg', from: SAME },
      rho: { label: 'kg/m³', from: SAME },
      h: { label: 'kJ/kg', from: SAME },
      s: { label: 'kJ/(kg·K)', from: SAME },
      w: { label: 'm/s', from: SAME },
      mu: { label: 'µPa·s', from: (x) => x * 1e6 },
      nu: { label: 'mm²/s', from: (x) => x * 1e6 },
      k: { label: 'W/(m·K)', from: SAME },
      sigma: { label: 'mN/m', from: (x) => x * 1000 },
      none: { label: '', from: SAME },
    },
  },
  mpa: {
    label: 'K, MPa, kJ/kg',
    units: {
      T: { label: 'K', from: SAME },
      dT: { label: 'K', from: SAME },
      p: { label: 'MPa', from: SAME },
      v: { label: 'm³/kg', from: SAME },
      rho: { label: 'kg/m³', from: SAME },
      h: { label: 'kJ/kg', from: SAME },
      s: { label: 'kJ/(kg·K)', from: SAME },
      w: { label: 'm/s', from: SAME },
      mu: { label: 'Pa·s', from: SAME },
      nu: { label: 'm²/s', from: SAME },
      k: { label: 'W/(m·K)', from: SAME },
      sigma: { label: 'N/m', from: SAME },
      none: { label: '', from: SAME },
    },
  },
  us: {
    label: '°F, psia, Btu/lb',
    units: {
      T: { label: '°F', from: (K) => (K * 9) / 5 - 459.67 },
      dT: { label: '°F', from: (K) => (K * 9) / 5 },
      p: { label: 'psia', from: (MPa) => MPa / PSI },
      v: { label: 'ft³/lb', from: (x) => x * 16.01846337396 },
      rho: { label: 'lb/ft³', from: (x) => x / 16.01846337396 },
      h: { label: 'Btu/lb', from: (x) => x / 2.326 },
      s: { label: 'Btu/(lb·°F)', from: (x) => x / 4.1868 },
      w: { label: 'ft/s', from: (x) => x / 0.3048 },
      mu: { label: 'cP', from: (x) => x * 1000 },
      nu: { label: 'cSt', from: (x) => x * 1e6 },
      k: { label: 'Btu/(h·ft·°F)', from: (x) => x / 1.730734666 },
      sigma: { label: 'dyn/cm', from: (x) => x * 1000 },
      none: { label: '', from: SAME },
    },
  },
};

const SYSTEM_CHOICES: readonly SegmentChoice<System>[] = (Object.keys(SYSTEMS) as System[]).map((value) => ({ value, label: SYSTEMS[value].label }));

const MODES: readonly SegmentChoice<Mode>[] = [
  { value: 'state', label: 'One state' },
  { value: 'saturation', label: 'Saturation table' },
  { value: 'isobar', label: 'Table at one pressure' },
];

/** Six significant figures, without exponents for everyday magnitudes. */
function sig(value: number, digits = 6): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e9 || magnitude < 1e-5) return value.toExponential(digits - 1).replace(/\.?0+e/, 'e');
  return String(Number(value.toPrecision(digits)));
}

/* ------------------------------------------------------------ properties -- */

interface Row {
  readonly label: string;
  readonly quantity: Quantity;
  readonly get: (state: State) => number;
  /** Shown in the change-on-evaporation column of saturation results. */
  readonly evaporation?: boolean;
}

const transportOk = (state: State) => state.region !== 4 && state.T <= 1173.15;
const isVapour = (state: State) => state.region === 2 || state.region === 5 || state.x === 1 || (state.region === 3 && state.rho < 322);

const ROWS: readonly Row[] = [
  { label: 'Temperature', quantity: 'T', get: (s) => s.T },
  { label: 'Pressure', quantity: 'p', get: (s) => s.p },
  { label: 'Density', quantity: 'rho', get: (s) => s.rho },
  { label: 'Specific volume', quantity: 'v', get: (s) => s.v, evaporation: true },
  { label: 'Specific enthalpy', quantity: 'h', get: (s) => s.h, evaporation: true },
  { label: 'Specific internal energy', quantity: 'h', get: (s) => s.u, evaporation: true },
  { label: 'Specific entropy', quantity: 's', get: (s) => s.s, evaporation: true },
  { label: 'Isobaric heat capacity (cp)', quantity: 's', get: (s) => s.cp },
  { label: 'Isochoric heat capacity (cv)', quantity: 's', get: (s) => s.cv },
  // w²ρ/p: the exponent for nozzle and expansion work, which only means something for steam and gas.
  { label: 'Isentropic exponent', quantity: 'none', get: (s) => (isVapour(s) ? (s.w * s.w * s.rho) / (s.p * 1e6) : Number.NaN) },
  { label: 'Speed of sound', quantity: 'w', get: (s) => s.w },
  { label: 'Dynamic viscosity', quantity: 'mu', get: (s) => (transportOk(s) ? viscosity(s.rho, s.T) : Number.NaN) },
  { label: 'Kinematic viscosity', quantity: 'nu', get: (s) => (transportOk(s) ? viscosity(s.rho, s.T) / s.rho : Number.NaN) },
  { label: 'Thermal conductivity', quantity: 'k', get: (s) => (transportOk(s) ? conductivity(s) : Number.NaN) },
  { label: 'Prandtl number', quantity: 'none', get: (s) => (transportOk(s) ? (viscosity(s.rho, s.T) * s.cp * 1000) / conductivity(s) : Number.NaN) },
];

function phaseName(state: State): string {
  if (state.region === 4) return `Wet steam, ${sig((state.x ?? 0) * 100, 4)}% dry`;
  if (state.x === 0) return 'Saturated liquid';
  if (state.x === 1) return 'Saturated vapour';
  if (state.p >= P_CRIT) return state.T >= T_CRIT ? 'Supercritical fluid' : 'Compressed liquid';
  if (state.T >= T_CRIT) return 'Superheated steam';
  return state.T < saturationTemperature(state.p) ? 'Compressed (subcooled) liquid' : 'Superheated steam';
}

interface Column {
  readonly title: string;
  readonly state: State;
}

interface Result {
  readonly columns: readonly Column[];
  readonly saturation?: Saturation;
  readonly summary: string;
}

function readValue(text: string): number | null {
  const value = Number(text.replace(/[,_\s]/g, ''));
  return text.trim() === '' || !Number.isFinite(value) ? null : value;
}

/* ----------------------------------------------------------------- state -- */

interface Inputs {
  readonly text: Readonly<Record<Field, string>>;
  readonly unit: Readonly<Record<Field, string>>;
}

interface TableRange {
  readonly by: 'T' | 'p';
  readonly from: string;
  readonly to: string;
  readonly step: string;
}

interface IsobarRange {
  readonly p: string;
  readonly from: string;
  readonly to: string;
  readonly step: string;
}

interface Saved {
  readonly mode: Mode;
  readonly known: Known;
  readonly inputs: Inputs;
  readonly system: System;
  /** Air pressure for gauge readings, kPa. */
  readonly atm: string;
  readonly table: TableRange;
  readonly isobar: IsobarRange;
}

const INITIAL: Saved = {
  mode: 'state',
  known: 'pT',
  inputs: { text: { p: '10', T: '250', h: '2800', s: '6.5', x: '90' }, unit: { p: 'bar', T: 'C', h: 'kJ/kg', s: 'kJ/kgK', x: 'pct' } },
  system: 'si',
  atm: '101.325',
  table: { by: 'T', from: '0', to: '370', step: '10' },
  isobar: { p: '10', from: '50', to: '500', step: '25' },
};

function readSaved(stored: Values | undefined): Saved {
  if (!stored) return INITIAL;
  const text = (key: string, fallback: string) => (typeof stored[key] === 'string' ? (stored[key] as string).slice(0, 40) : fallback);
  const record = (value: unknown, fallback: Readonly<Record<Field, string>>, valid: (field: Field, v: string) => boolean): Record<Field, string> => {
    const out = { ...fallback };
    if (value && typeof value === 'object') {
      for (const field of Object.keys(fallback) as Field[]) {
        const v = (value as Record<string, unknown>)[field];
        if (typeof v === 'string' && valid(field, v)) out[field] = v.slice(0, 40);
      }
    }
    return out;
  };
  const inputs = stored.inputs as { text?: unknown; unit?: unknown } | undefined;
  const range = <T extends object>(value: unknown, fallback: T): T => {
    if (!value || typeof value !== 'object') return fallback;
    const out: Record<string, string> = { ...(fallback as Record<string, string>) };
    for (const key of Object.keys(fallback)) {
      const v = (value as Record<string, unknown>)[key];
      if (typeof v === 'string') out[key] = v.slice(0, 40);
    }
    return out as T;
  };
  const table = range(stored.table, INITIAL.table);
  return {
    mode: MODES.some((m) => m.value === stored.mode) ? (stored.mode as Mode) : INITIAL.mode,
    known: KNOWN.some((k) => k.value === stored.known) ? (stored.known as Known) : INITIAL.known,
    inputs: {
      text: record(inputs?.text, INITIAL.inputs.text, () => true),
      unit: record(inputs?.unit, INITIAL.inputs.unit, (field, v) => FIELD_UNITS[field].some((u) => u.id === v)),
    },
    system: stored.system === 'mpa' || stored.system === 'us' ? stored.system : 'si',
    atm: text('atm', INITIAL.atm),
    table: { ...table, by: table.by === 'p' ? 'p' : 'T' },
    isobar: range(stored.isobar, INITIAL.isobar),
  };
}

const writeSaved = (saved: Saved): Values => ({ ...saved });

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function solve(saved: Saved): Result | { readonly error: string } {
  const spec = KNOWN.find((k) => k.value === saved.known) ?? (KNOWN[0] as (typeof KNOWN)[number]);
  const atm = (readValue(saved.atm) ?? 101.325) / 1000;
  const values: Partial<Record<Field, number>> = {};
  for (const field of spec.fields) {
    const raw = readValue(saved.inputs.text[field]);
    if (raw === null) return { error: `Type a number for ${FIELD_LABELS[field].toLowerCase()}.` };
    const unit = FIELD_UNITS[field].find((u) => u.id === saved.inputs.unit[field]) ?? (FIELD_UNITS[field][0] as InputUnit);
    values[field] = unit.toSI(raw, atm);
  }
  const { p = 0, T = 0, h = 0, s = 0, x = 0 } = values;
  try {
    switch (saved.known) {
      case 'pT': {
        const state = stateTP(p, T);
        return { columns: [{ title: phaseName(state), state }], summary: phaseName(state) };
      }
      case 'satP':
      case 'satT': {
        const sat = saved.known === 'satP' ? saturationAtP(p) : saturationAtT(T);
        return {
          columns: [
            { title: 'Saturated liquid', state: sat.liquid },
            { title: 'Saturated vapour', state: sat.vapour },
          ],
          saturation: sat,
          summary: 'Saturation',
        };
      }
      case 'ph':
      case 'ps': {
        const state = saved.known === 'ph' ? statePH(p, h) : statePS(p, s);
        if (state.region !== 4) return { columns: [{ title: phaseName(state), state }], summary: phaseName(state) };
        const sat = saturationAtP(p);
        return { columns: wetColumns(state, sat), saturation: sat, summary: phaseName(state) };
      }
      case 'px':
      case 'Tx': {
        const sat = saved.known === 'px' ? saturationAtP(p) : saturationAtT(T);
        const state = mixture(sat, x);
        return { columns: state.region === 4 ? wetColumns(state, sat) : [{ title: phaseName(state), state }], saturation: sat, summary: phaseName(state) };
      }
    }
  } catch (error) {
    return { error: errorText(error) };
  }
}

const wetColumns = (state: State, sat: Saturation): Column[] => [
  { title: phaseName(state), state },
  { title: 'Saturated liquid', state: sat.liquid },
  { title: 'Saturated vapour', state: sat.vapour },
];

/* ---------------------------------------------------------------- tables -- */

interface Table {
  readonly head: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly skipped: number;
}

const MAX_ROWS = 400;

function steps(from: number, to: number, step: number): number[] | string {
  if (!(step > 0)) return 'The step must be above zero.';
  if (to < from) return 'The table must run from a lower to a higher value.';
  const count = Math.floor((to - from) / step + 1e-9) + 1;
  if (count > MAX_ROWS) return `That is ${count} rows; ${MAX_ROWS} is the most one table shows. Use a bigger step.`;
  return Array.from({ length: count }, (_, i) => Number((from + i * step).toPrecision(12)));
}

function saturationTable(range: TableRange, system: System): Table | { readonly error: string } {
  const u = SYSTEMS[system].units;
  const [from, to, step] = [range.from, range.to, range.step].map(readValue);
  if (from === null || to === null || step === null) return { error: 'Type numbers for from, to and step.' };
  const points = steps(from, to, step);
  if (typeof points === 'string') return { error: points };
  const head = [
    `T (${u.T.label})`,
    `p (${u.p.label})`,
    `v liquid (${u.v.label})`,
    `v vapour (${u.v.label})`,
    `h liquid (${u.h.label})`,
    `h evaporation (${u.h.label})`,
    `h vapour (${u.h.label})`,
    `s liquid (${u.s.label})`,
    `s evaporation (${u.s.label})`,
    `s vapour (${u.s.label})`,
  ];
  const rows: string[][] = [];
  let skipped = 0;
  // Values typed in the output units: back to K or MPa.
  const toK = (value: number) => (system === 'si' ? value + 273.15 : system === 'us' ? ((value + 459.67) * 5) / 9 : value);
  const toMPa = (value: number) => (system === 'si' ? value / 10 : system === 'us' ? value * PSI : value);
  for (const point of points) {
    try {
      const sat = range.by === 'T' ? saturationAtT(Math.max(toK(point), 273.15)) : saturationAtP(toMPa(point));
      const { liquid, vapour } = sat;
      rows.push([
        sig(u.T.from(sat.T)),
        sig(u.p.from(sat.p)),
        sig(u.v.from(liquid.v)),
        sig(u.v.from(vapour.v)),
        sig(u.h.from(liquid.h)),
        sig(u.h.from(vapour.h - liquid.h)),
        sig(u.h.from(vapour.h)),
        sig(u.s.from(liquid.s)),
        sig(u.s.from(vapour.s - liquid.s)),
        sig(u.s.from(vapour.s)),
      ]);
    } catch {
      skipped++;
    }
  }
  return { head, rows, skipped };
}

function isobarTable(range: IsobarRange, system: System): Table | { readonly error: string } {
  const u = SYSTEMS[system].units;
  const [pressure, from, to, step] = [range.p, range.from, range.to, range.step].map(readValue);
  if (pressure === null || from === null || to === null || step === null) return { error: 'Type numbers for the pressure and for from, to and step.' };
  const points = steps(from, to, step);
  if (typeof points === 'string') return { error: points };
  const p = system === 'si' ? pressure / 10 : system === 'us' ? pressure * PSI : pressure;
  const toK = (value: number) => (system === 'si' ? value + 273.15 : system === 'us' ? ((value + 459.67) * 5) / 9 : value);
  const head = [`T (${u.T.label})`, 'Phase', `ρ (${u.rho.label})`, `v (${u.v.label})`, `h (${u.h.label})`, `u (${u.h.label})`, `s (${u.s.label})`, `cp (${u.s.label})`];
  const rows: string[][] = [];
  let skipped = 0;
  for (const point of points) {
    try {
      const state = stateTP(p, toK(point));
      rows.push([
        sig(u.T.from(state.T)),
        phaseName(state),
        sig(u.rho.from(state.rho)),
        sig(u.v.from(state.v)),
        sig(u.h.from(state.h)),
        sig(u.h.from(state.u)),
        sig(u.s.from(state.s)),
        sig(u.s.from(state.cp)),
      ]);
    } catch {
      skipped++;
    }
  }
  return { head, rows, skipped };
}

const tsv = (table: Table) => [table.head, ...table.rows].map((row) => row.join('\t')).join('\n');
const csv = (table: Table) => [table.head, ...table.rows].map((row) => row.map((cell) => (/[",]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(',')).join('\n');

/* -------------------------------------------------------------------- UI -- */

function SteamTables({ toolId }: { toolId: string }) {
  const [saved, setSaved] = usePersistentState(toolId, readSaved, writeSaved);
  const system = SYSTEMS[saved.system];
  const spec = KNOWN.find((k) => k.value === saved.known) ?? (KNOWN[0] as (typeof KNOWN)[number]);

  const result = useMemo(() => (saved.mode === 'state' ? solve(saved) : null), [saved]);
  const table = useMemo(() => (saved.mode === 'saturation' ? saturationTable(saved.table, saved.system) : saved.mode === 'isobar' ? isobarTable(saved.isobar, saved.system) : null), [saved]);
  const gauge = spec.fields.some((field) => FIELD_UNITS[field].find((u) => u.id === saved.inputs.unit[field])?.gauge);

  const setInput = (field: Field, text: string) => setSaved((s) => ({ ...s, inputs: { ...s.inputs, text: { ...s.inputs.text, [field]: text } } }));
  const setUnit = (field: Field, unit: string) => setSaved((s) => ({ ...s, inputs: { ...s.inputs, unit: { ...s.inputs.unit, [field]: unit } } }));

  const copy = (text: string, what: string) =>
    attempt(async () => {
      await copyText(text);
      notify(`Copied ${what}`);
    });

  const stateRows = result && !('error' in result) ? stateTableRows(result, saved.system) : null;

  return (
    <section class="tool st-tool" data-testid="tool" data-state={(result && 'error' in result) || (table && 'error' in table) ? 'idle' : 'done'}>
      <div class="st-bar">
        <div class="control">
          <span class="control-label">Show</span>
          <Segmented label="Show" value={saved.mode} choices={MODES} onChange={(mode) => setSaved((s) => ({ ...s, mode }))} />
        </div>
        <div class="control">
          <span class="control-label">Units</span>
          <Segmented label="Units" value={saved.system} choices={SYSTEM_CHOICES} onChange={(value) => setSaved((s) => ({ ...s, system: value }))} />
        </div>
      </div>

      {saved.mode === 'state' && (
        <>
          <div class="st-inputs">
            <label class="control">
              <span class="control-label">Known values</span>
              <select class="input" value={saved.known} onChange={(e) => setSaved((s) => ({ ...s, known: e.currentTarget.value as Known }))} data-testid="st-known">
                {KNOWN.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            {spec.fields.map((field) => (
              <div class="control st-field" key={field}>
                <label class="control-label" for={`st-${field}`}>
                  {FIELD_LABELS[field]}
                </label>
                <div class="st-input-row">
                  <input
                    id={`st-${field}`}
                    class="input st-value"
                    type="text"
                    inputMode="decimal"
                    spellcheck={false}
                    autocomplete="off"
                    value={saved.inputs.text[field]}
                    onInput={(e) => setInput(field, e.currentTarget.value)}
                    data-testid={`st-${field}`}
                  />
                  <select
                    class="input"
                    aria-label={`${FIELD_LABELS[field]} unit`}
                    value={saved.inputs.unit[field]}
                    onChange={(e) => setUnit(field, e.currentTarget.value)}
                    data-testid={`st-${field}-unit`}
                  >
                    {FIELD_UNITS[field].map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
            {gauge && (
              <div class="control st-field">
                <label class="control-label" for="st-atm">
                  Air pressure for gauge readings
                </label>
                <div class="st-input-row">
                  <input id="st-atm" class="input st-value" type="text" inputMode="decimal" value={saved.atm} onInput={(e) => setSaved((s) => ({ ...s, atm: e.currentTarget.value }))} />
                  <span class="st-unit">kPa</span>
                </div>
              </div>
            )}
          </div>

          {result && 'error' in result ? (
            <p class="st-error" role="status" data-testid="st-error">
              <Icon name="alert" size={16} /> {result.error}
            </p>
          ) : (
            result &&
            stateRows && (
              <div class="st-result">
                <div class="st-result-head">
                  <h2 data-testid="st-summary">{result.summary}</h2>
                  <button type="button" class="button button-small" onClick={() => copy(tsv(stateRows), 'the properties')}>
                    <Icon name="copy" size={14} /> Copy
                  </button>
                </div>
                <div class="ref-table-wrap st-table-wrap" {...scrollRegion('Properties')}>
                  <table class="ref-table st-table" data-testid="st-table">
                    <thead>
                      <tr>
                        {stateRows.head.map((cell, i) => (
                          <th key={cell} scope="col" class={i >= 2 ? 'st-num' : undefined}>
                            {cell}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {stateRows.rows.map(([label, unit, ...cells]) => (
                        <tr key={label}>
                          <th scope="row">{label}</th>
                          <td class="ref-muted">{unit}</td>
                          {cells.map((cell, i) => (
                            <td key={`${label}-${i}`} class="st-num">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}
        </>
      )}

      {saved.mode === 'saturation' && (
        <div class="st-inputs">
          <div class="control">
            <span class="control-label">Rows by</span>
            <Segmented
              label="Rows by"
              value={saved.table.by}
              choices={[
                { value: 'T', label: `Temperature (${system.units.T.label})` },
                { value: 'p', label: `Pressure (${system.units.p.label})` },
              ]}
              onChange={(by) => setSaved((s) => ({ ...s, table: { ...s.table, by } }))}
            />
          </div>
          <RangeInputs value={saved.table} onChange={(table) => setSaved((s) => ({ ...s, table: { ...s.table, ...table } }))} />
        </div>
      )}

      {saved.mode === 'isobar' && (
        <div class="st-inputs">
          <label class="control st-field">
            <span class="control-label">Pressure ({system.units.p.label}, absolute)</span>
            <input
              class="input st-value"
              type="text"
              inputMode="decimal"
              value={saved.isobar.p}
              onInput={(e) => setSaved((s) => ({ ...s, isobar: { ...s.isobar, p: e.currentTarget.value } }))}
              data-testid="st-isobar-p"
            />
          </label>
          <RangeInputs value={saved.isobar} unit={system.units.T.label} onChange={(range) => setSaved((s) => ({ ...s, isobar: { ...s.isobar, ...range } }))} />
        </div>
      )}

      {table &&
        ('error' in table ? (
          <p class="st-error" role="status" data-testid="st-error">
            <Icon name="alert" size={16} /> {table.error}
          </p>
        ) : (
          <div class="st-result">
            <div class="st-result-head">
              <h2>
                {saved.mode === 'saturation' ? 'Saturated water and steam' : `Water and steam at ${saved.isobar.p} ${system.units.p.label}`}
                <span class="st-count">
                  {table.rows.length} rows{table.skipped ? `, ${table.skipped} outside the range left out` : ''}
                </span>
              </h2>
              <div class="button-row">
                <button type="button" class="button button-small" onClick={() => copy(tsv(table), `${table.rows.length} rows`)} title="Copy as tab-separated text for a spreadsheet">
                  <Icon name="copy" size={14} /> Copy
                </button>
                <button
                  type="button"
                  class="button button-small"
                  onClick={() =>
                    attempt(async () => {
                      const result = await saveFile(saved.mode === 'saturation' ? 'saturated-steam.csv' : 'steam-table.csv', csv(table), 'text/csv');
                      if (result.saved) notify(`Saved to ${result.location}`);
                    })
                  }
                >
                  <Icon name="save" size={14} /> Save CSV
                </button>
              </div>
            </div>
            <div class="ref-table-wrap st-table-wrap" {...scrollRegion('Steam table')}>
              <table class="ref-table st-table st-grid" data-testid="st-grid">
                <thead>
                  <tr>
                    {table.head.map((cell) => (
                      <th key={cell} scope="col" class="st-num">
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row) => (
                    <tr key={row[0]}>
                      {row.map((cell, i) => (
                        <td key={`${row[0]}-${i}`} class={i === 1 && saved.mode === 'isobar' ? 'ref-muted' : 'st-num'}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

      <p class="st-note">
        IAPWS-IF97 industrial formulation (R7-97(2012)): 0 to 800 °C up to 1000 bar, and 800 to 2000 °C up to 500 bar. Viscosity and thermal conductivity follow the IAPWS 2008 and 2011 industrial
        equations, surface tension IAPWS 2014. Gauge readings add the air pressure set above.
      </p>
    </section>
  );
}

function RangeInputs<T extends { from: string; to: string; step: string }>({ value, unit, onChange }: { value: T; unit?: string; onChange: (next: Partial<T>) => void }) {
  return (
    <>
      {(['from', 'to', 'step'] as const).map((key) => (
        <label class="control st-range" key={key}>
          <span class="control-label">
            {key === 'from' ? 'From' : key === 'to' ? 'To' : 'Step'}
            {unit ? ` (${unit})` : ''}
          </span>
          <input class="input st-value" type="text" inputMode="decimal" value={value[key]} onInput={(e) => onChange({ [key]: e.currentTarget.value } as Partial<T>)} data-testid={`st-${key}`} />
        </label>
      ))}
    </>
  );
}

/** Rows of the properties table: label, unit, then one cell per column (plus the change on evaporation for saturation). */
function stateTableRows(result: Result, systemId: System): Table {
  const units = SYSTEMS[systemId].units;
  const evaporation = result.columns.length === 2 && result.saturation !== undefined;
  const head = ['Property', 'Unit', ...result.columns.map((c) => c.title), ...(evaporation ? ['Change on evaporation'] : [])];
  const rows: string[][] = [];
  for (const row of ROWS) {
    const unit = units[row.quantity];
    const cells = result.columns.map((c) => sig(unit.from(row.get(c.state))));
    if (evaporation) {
      const [liquid, vapour] = result.columns as [Column, Column];
      cells.push(row.evaporation ? sig(unit.from(row.get(vapour.state)) - unit.from(row.get(liquid.state))) : '');
    }
    rows.push([row.label, unit.label, ...cells]);
  }
  const first = (result.columns[0] as Column).state;
  if (first.region === 4) rows.push(['Dryness fraction (quality)', '', sig(first.x ?? 0), ...result.columns.slice(1).map((c) => sig(c.state.x ?? 0))]);
  else if (first.p < P_CRIT && first.x === undefined && first.p >= 0.000611213) {
    const delta = first.T - saturationTemperature(first.p);
    rows.push([delta >= 0 ? 'Superheat above saturation' : 'Subcooling below saturation', units.dT.label, sig(units.dT.from(Math.abs(delta)), 5)]);
  }
  if (result.saturation) {
    const sigma = sig(units.sigma.from(surfaceTension(result.saturation.T)), 5);
    rows.push(['Surface tension', units.sigma.label, ...result.columns.map((c) => (c.title === 'Saturated liquid' ? sigma : ''))]);
  }
  rows.push(['IAPWS-IF97 region', '', ...result.columns.map((c) => String(c.state.region))]);
  // Every row as wide as the header.
  return { head, rows: rows.map((row) => [...row, ...Array.from({ length: Math.max(0, head.length - row.length) }, () => '')]), skipped: 0 };
}

export default defineCustomTool(SteamTables);
