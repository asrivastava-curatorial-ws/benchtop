/**
 * Thermodynamic cycles for engines and power plants: the air-standard Otto,
 * Diesel, dual, Brayton (with real compressor and turbine and a
 * regenerator), Carnot and Stirling cycles on an ideal gas, and the Rankine
 * steam cycle on IAPWS-IF97 water.  Each gives its states, the work and heat
 * of each process, the efficiency, and curves for P–v and T–s diagrams.
 */
import { saturationAtP, saturationAtT, statePH, statePS, stateTP, T_CRIT } from './steam/if97';

export type CycleKind = 'otto' | 'diesel' | 'dual' | 'brayton' | 'carnot' | 'stirling' | 'rankine';

export interface CycleState {
  readonly name: string;
  /** Pa */
  readonly p: number;
  /** m³/kg */
  readonly v: number;
  /** K */
  readonly T: number;
  /** J/(kg·K), from the first state (ideal gas) or IF97's reference (steam) */
  readonly s: number;
  /** J/kg, Rankine only */
  readonly h?: number;
  /** Steam quality, Rankine only */
  readonly x?: number;
}

export type ProcessKind = 'isentropic' | 'isochoric' | 'isobaric' | 'isothermal' | 'polytropic' | 'pump' | 'boiler' | 'turbine' | 'condenser';

export interface Process {
  readonly from: number;
  readonly to: number;
  readonly kind: ProcessKind;
  readonly label: string;
  /** J/kg done by the gas (negative when work is done on it) */
  readonly work: number;
  /** J/kg into the gas (negative when heat leaves) */
  readonly heat: number;
  /** Points along the process: [v, p, T, s]. */
  readonly path: readonly (readonly [number, number, number, number])[];
}

export interface CycleResult {
  readonly kind: CycleKind;
  readonly states: readonly CycleState[];
  readonly processes: readonly Process[];
  /** J/kg */
  readonly wNet: number;
  readonly qIn: number;
  readonly qOut: number;
  readonly efficiency: number;
  /** Carnot efficiency between the hottest and coldest states. */
  readonly carnot: number;
  /** Mean effective pressure, Pa (piston engines). */
  readonly mep?: number;
  /** Compressor work over turbine work (Brayton, Rankine). */
  readonly backWork?: number;
  readonly notes: readonly string[];
}

export interface GasInputs {
  /** Ratio of specific heats */
  readonly gamma: number;
  /** Gas constant, J/(kg·K) */
  readonly R: number;
  /** Pa */
  readonly p1: number;
  /** K */
  readonly T1: number;
}

export interface CycleInputs extends GasInputs {
  /** Compression ratio (piston engines, Carnot, Stirling). */
  readonly r: number;
  /** Heat added per kg, J/kg (Otto). */
  readonly qIn: number;
  /** Cut-off ratio (Diesel, dual). */
  readonly rc: number;
  /** Pressure ratio at constant volume (dual). */
  readonly rp: number;
  /** Compressor pressure ratio (Brayton). */
  readonly pr: number;
  /** Turbine inlet or hot-side temperature, K (Brayton, Carnot, Stirling). */
  readonly Tmax: number;
  /** Compressor and turbine isentropic efficiencies (Brayton, Rankine). */
  readonly etaC: number;
  readonly etaT: number;
  /** Feed pump isentropic efficiency (Rankine). */
  readonly etaP: number;
  /** Regenerator effectiveness (Brayton, Stirling). */
  readonly regen: number;
  /** Rankine: boiler and condenser pressures (Pa) and turbine inlet temperature (K). */
  readonly pBoiler: number;
  readonly pCondenser: number;
  readonly Tsteam: number;
}

const STEPS = 40;
const range = (a: number, b: number, n = STEPS) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);

/** Ideal-gas helpers for one set of gas properties, entropy measured from (v1, T1). */
function gas(g: GasInputs, v1: number) {
  const cv = g.R / (g.gamma - 1);
  const cp = cv + g.R;
  const s = (v: number, T: number) => cv * Math.log(T / g.T1) + g.R * Math.log(v / v1);
  const state = (name: string, v: number, T: number): CycleState => ({ name, v, T, p: (g.R * T) / v, s: s(v, T) });
  const point = (v: number, T: number) => [v, (g.R * T) / v, T, s(v, T)] as const;
  const process = (a: CycleState, b: CycleState, from: number, to: number, kind: ProcessKind, label: string): Process => {
    let path: (readonly [number, number, number, number])[];
    let work: number;
    let heat: number;
    if (kind === 'isentropic') {
      path = range(a.v, b.v).map((v) => point(v, a.T * (a.v / v) ** (g.gamma - 1)));
      work = cv * (a.T - b.T);
      heat = 0;
    } else if (kind === 'isochoric') {
      path = range(a.T, b.T).map((T) => point(a.v, T));
      work = 0;
      heat = cv * (b.T - a.T);
    } else if (kind === 'isobaric') {
      path = range(a.v, b.v).map((v) => point(v, (a.p * v) / g.R));
      work = a.p * (b.v - a.v);
      heat = cp * (b.T - a.T);
    } else if (kind === 'isothermal') {
      path = range(a.v, b.v).map((v) => point(v, a.T));
      work = g.R * a.T * Math.log(b.v / a.v);
      heat = work;
    } else {
      // A real compressor or turbine: drawn straight between the end states.
      path = range(0, 1).map((t) => {
        const v = a.v * (b.v / a.v) ** t;
        const T = a.T + (b.T - a.T) * t;
        return point(v, T);
      });
      heat = 0;
      work = cv * (a.T - b.T);
    }
    return { from, to, kind, label, work, heat, path };
  };
  return { cv, cp, state, process };
}

function summarise(kind: CycleKind, states: CycleState[], processes: Process[], notes: string[], extra: Partial<CycleResult> = {}): CycleResult {
  const qIn = processes.reduce((sum, p) => sum + Math.max(0, p.heat), 0);
  const qOut = -processes.reduce((sum, p) => sum + Math.min(0, p.heat), 0);
  const wNet = processes.reduce((sum, p) => sum + p.work, 0);
  const Ts = states.map((s) => s.T);
  const carnot = 1 - Math.min(...Ts) / Math.max(...Ts);
  return { kind, states, processes, wNet, qIn, qOut, efficiency: qIn > 0 ? wNet / qIn : 0, carnot, notes, ...extra };
}

export function otto(i: CycleInputs): CycleResult {
  const v1 = (i.R * i.T1) / i.p1;
  const g = gas(i, v1);
  const s1 = g.state('1', v1, i.T1);
  const v2 = v1 / i.r;
  const s2 = g.state('2', v2, i.T1 * i.r ** (i.gamma - 1));
  const s3 = g.state('3', v2, s2.T + i.qIn / g.cv);
  const s4 = g.state('4', v1, s3.T / i.r ** (i.gamma - 1));
  const processes = [
    g.process(s1, s2, 0, 1, 'isentropic', 'Compression'),
    g.process(s2, s3, 1, 2, 'isochoric', 'Combustion (heat at constant volume)'),
    g.process(s3, s4, 2, 3, 'isentropic', 'Power stroke (expansion)'),
    g.process(s4, s1, 3, 0, 'isochoric', 'Exhaust (heat rejected)'),
  ];
  const r = summarise('otto', [s1, s2, s3, s4], processes, [`η = 1 − 1/r^(γ−1) = ${(1 - 1 / i.r ** (i.gamma - 1)).toFixed(4)}`]);
  return { ...r, mep: r.wNet / (v1 - v2) };
}

export function diesel(i: CycleInputs): CycleResult {
  const v1 = (i.R * i.T1) / i.p1;
  const g = gas(i, v1);
  const s1 = g.state('1', v1, i.T1);
  const v2 = v1 / i.r;
  const s2 = g.state('2', v2, i.T1 * i.r ** (i.gamma - 1));
  const s3 = g.state('3', v2 * i.rc, s2.T * i.rc);
  const s4 = g.state('4', v1, s3.T * (s3.v / v1) ** (i.gamma - 1));
  const processes = [
    g.process(s1, s2, 0, 1, 'isentropic', 'Compression'),
    g.process(s2, s3, 1, 2, 'isobaric', 'Combustion (heat at constant pressure)'),
    g.process(s3, s4, 2, 3, 'isentropic', 'Expansion'),
    g.process(s4, s1, 3, 0, 'isochoric', 'Heat rejected'),
  ];
  const formula = 1 - (1 / i.r ** (i.gamma - 1)) * ((i.rc ** i.gamma - 1) / (i.gamma * (i.rc - 1)));
  const r = summarise('diesel', [s1, s2, s3, s4], processes, [`η = 1 − (1/r^(γ−1))·(rc^γ − 1)/(γ(rc − 1)) = ${formula.toFixed(4)}`]);
  return { ...r, mep: r.wNet / (v1 - v2) };
}

export function dual(i: CycleInputs): CycleResult {
  const v1 = (i.R * i.T1) / i.p1;
  const g = gas(i, v1);
  const s1 = g.state('1', v1, i.T1);
  const v2 = v1 / i.r;
  const s2 = g.state('2', v2, i.T1 * i.r ** (i.gamma - 1));
  const s3 = g.state('3', v2, s2.T * i.rp);
  const s4 = g.state('4', v2 * i.rc, s3.T * i.rc);
  const s5 = g.state('5', v1, s4.T * (s4.v / v1) ** (i.gamma - 1));
  const processes = [
    g.process(s1, s2, 0, 1, 'isentropic', 'Compression'),
    g.process(s2, s3, 1, 2, 'isochoric', 'Heat at constant volume'),
    g.process(s3, s4, 2, 3, 'isobaric', 'Heat at constant pressure'),
    g.process(s4, s5, 3, 4, 'isentropic', 'Expansion'),
    g.process(s5, s1, 4, 0, 'isochoric', 'Heat rejected'),
  ];
  const r = summarise('dual', [s1, s2, s3, s4, s5], processes, ['The limited-pressure (Sabathé) cycle: between Otto and Diesel.']);
  return { ...r, mep: r.wNet / (v1 - v2) };
}

export function brayton(i: CycleInputs): CycleResult {
  const v1 = (i.R * i.T1) / i.p1;
  const g = gas(i, v1);
  const k = (i.gamma - 1) / i.gamma;
  const s1 = g.state('1', v1, i.T1);
  const p2 = i.p1 * i.pr;
  const T2s = i.T1 * i.pr ** k;
  const T2 = i.T1 + (T2s - i.T1) / i.etaC;
  const s2 = g.state('2', (i.R * T2) / p2, T2);
  const T3 = i.Tmax;
  const s3 = g.state('3', (i.R * T3) / p2, T3);
  const T4s = T3 / i.pr ** k;
  const T4 = T3 - i.etaT * (T3 - T4s);
  const s4 = g.state('4', (i.R * T4) / i.p1, T4);
  const wc = g.cp * (T2 - i.T1);
  const wt = g.cp * (T3 - T4);
  const notes: string[] = [];
  const processes: Process[] = [];
  const states: CycleState[] = [s1, s2];
  const compression = g.process(s1, s2, 0, 1, i.etaC >= 0.9999 ? 'isentropic' : 'polytropic', 'Compressor');
  processes.push({ ...compression, work: -wc });
  // A regenerator heats the compressed air with the exhaust when the exhaust is hotter.
  const useful = i.regen > 0 && T4 > T2;
  if (i.regen > 0 && !useful) notes.push('The exhaust is cooler than the compressed air, so a regenerator cannot help here.');
  if (useful) {
    const Tx = T2 + i.regen * (T4 - T2);
    const sx = g.state('2r', (i.R * Tx) / p2, Tx);
    const Ty = T4 - (Tx - T2);
    const sy = g.state('4r', (i.R * Ty) / i.p1, Ty);
    states.push(sx, s3, s4, sy);
    processes.push(
      { ...g.process(s2, sx, 1, 2, 'isobaric', 'Regenerator (heat from the exhaust)'), heat: 0 },
      g.process(sx, s3, 2, 3, 'isobaric', 'Combustion chamber'),
      { ...g.process(s3, s4, 3, 4, i.etaT >= 0.9999 ? 'isentropic' : 'polytropic', 'Turbine'), work: wt },
      { ...g.process(s4, sy, 4, 5, 'isobaric', 'Regenerator (heat to the compressed air)'), heat: 0 },
      g.process(sy, s1, 5, 0, 'isobaric', 'Exhaust (heat rejected)'),
    );
  } else {
    states.push(s3, s4);
    processes.push(
      g.process(s2, s3, 1, 2, 'isobaric', 'Combustion chamber'),
      { ...g.process(s3, s4, 2, 3, i.etaT >= 0.9999 ? 'isentropic' : 'polytropic', 'Turbine'), work: wt },
      g.process(s4, s1, 3, 0, 'isobaric', 'Exhaust (heat rejected)'),
    );
  }
  // Isobaric processes count p·dv as work; the steady-flow work of a gas turbine is only in the machines.
  const flow = processes.map((p) => (p.kind === 'isobaric' ? { ...p, work: 0 } : p));
  const r = summarise('brayton', states, flow, notes, { backWork: wc / wt });
  if (i.etaC >= 0.9999 && i.etaT >= 0.9999 && !useful) return { ...r, notes: [...r.notes, `η = 1 − 1/rp^((γ−1)/γ) = ${(1 - 1 / i.pr ** k).toFixed(4)}`] };
  return r;
}

export function carnot(i: CycleInputs): CycleResult {
  const v1 = (i.R * i.T1) / i.p1;
  const g = gas(i, v1);
  const TL = i.T1;
  const TH = Math.max(i.Tmax, TL * 1.01);
  const s1 = g.state('1', v1, TL);
  const v2 = v1 * (TL / TH) ** (1 / (i.gamma - 1));
  const s2 = g.state('2', v2, TH);
  const v3 = v2 * i.r;
  const s3 = g.state('3', v3, TH);
  const s4 = g.state('4', v3 * (v1 / v2), TL);
  const processes = [
    g.process(s1, s2, 0, 1, 'isentropic', 'Adiabatic compression'),
    g.process(s2, s3, 1, 2, 'isothermal', 'Heat taken in at TH'),
    g.process(s3, s4, 2, 3, 'isentropic', 'Adiabatic expansion'),
    g.process(s4, s1, 3, 0, 'isothermal', 'Heat given out at TL'),
  ];
  return summarise('carnot', [s1, s2, s3, s4], processes, [`η = 1 − TL/TH = ${(1 - TL / TH).toFixed(4)}: no engine between these temperatures can do better.`]);
}

export function stirling(i: CycleInputs): CycleResult {
  const v1 = (i.R * i.T1) / i.p1;
  const g = gas(i, v1);
  const TL = i.T1;
  const TH = Math.max(i.Tmax, TL * 1.01);
  const s1 = g.state('1', v1, TL);
  const s2 = g.state('2', v1 / i.r, TL);
  const s3 = g.state('3', v1 / i.r, TH);
  const s4 = g.state('4', v1, TH);
  const stored = g.cv * (TH - TL);
  const processes = [
    g.process(s1, s2, 0, 1, 'isothermal', 'Compression at TL'),
    { ...g.process(s2, s3, 1, 2, 'isochoric', 'Heating at constant volume'), heat: stored * (1 - i.regen) },
    g.process(s3, s4, 2, 3, 'isothermal', 'Expansion at TH'),
    { ...g.process(s4, s1, 3, 0, 'isochoric', 'Cooling at constant volume'), heat: -stored * (1 - i.regen) },
  ];
  return summarise('stirling', [s1, s2, s3, s4], processes, [
    `With a perfect regenerator the heat of the constant-volume steps is stored and given back, and η reaches Carnot’s ${(1 - TL / TH).toFixed(4)}.`,
  ]);
}

/** The Rankine steam cycle; states use IAPWS-IF97 (MPa, kJ/kg inside, SI outside). */
export function rankine(i: CycleInputs): CycleResult {
  const pb = i.pBoiler / 1e6;
  const pc = i.pCondenser / 1e6;
  const satC = saturationAtP(pc);
  const satB = saturationAtP(pb);
  const one = satC.liquid;
  const two = statePS(pb, one.s);
  const h2 = one.h + (two.h - one.h) / i.etaP;
  const pumped = statePH(pb, h2);
  const T3 = Math.max(i.Tsteam, satB.T);
  const three = T3 - satB.T < 0.01 ? satB.vapour : stateTP(pb, T3);
  const fourS = statePS(pc, three.s);
  const h4 = three.h - i.etaT * (three.h - fourS.h);
  const four = statePH(pc, h4);
  const S = (name: string, st: { p: number; v: number; T: number; s: number; h: number; x?: number }): CycleState => ({
    name,
    p: st.p * 1e6,
    v: st.v,
    T: st.T,
    s: st.s * 1000,
    h: st.h * 1000,
    ...(st.x !== undefined && Number.isFinite(st.x) ? { x: st.x } : {}),
  });
  const states = [S('1', { ...one, x: 0 }), S('2', pumped), S('3', three), S('4', four)];
  const line = (a: CycleState, b: CycleState) => range(0, 1, 8).map((t) => [a.v + (b.v - a.v) * t, a.p + (b.p - a.p) * t, a.T + (b.T - a.T) * t, a.s + (b.s - a.s) * t] as const);
  // The boiler line: heating the water, boiling at the saturation temperature, then superheating.
  const boiler: (readonly [number, number, number, number])[] = [];
  for (const T of range(pumped.T, Math.min(satB.T - 0.05, T3), 16)) {
    const st = stateTP(pb, T);
    boiler.push([st.v, pb * 1e6, T, st.s * 1000]);
  }
  boiler.push([satB.liquid.v, pb * 1e6, satB.T, satB.liquid.s * 1000], [satB.vapour.v, pb * 1e6, satB.T, satB.vapour.s * 1000]);
  if (T3 > satB.T + 0.01) {
    for (const T of range(satB.T + 0.05, T3, 16)) {
      const st = stateTP(pb, T);
      boiler.push([st.v, pb * 1e6, T, st.s * 1000]);
    }
  }
  const condenser: (readonly [number, number, number, number])[] = [
    [four.v, pc * 1e6, four.T, four.s * 1000],
    [satC.liquid.v, pc * 1e6, satC.T, satC.liquid.s * 1000],
  ];
  const [s1, s2, s3, s4] = states as [CycleState, CycleState, CycleState, CycleState];
  const wp = (h2 - one.h) * 1000;
  const wt = (three.h - h4) * 1000;
  const processes: Process[] = [
    { from: 0, to: 1, kind: 'pump', label: 'Feed pump', work: -wp, heat: 0, path: line(s1, s2) },
    { from: 1, to: 2, kind: 'boiler', label: 'Boiler and superheater', work: 0, heat: (three.h - h2) * 1000, path: boiler },
    { from: 2, to: 3, kind: 'turbine', label: 'Turbine', work: wt, heat: 0, path: line(s3, s4) },
    { from: 3, to: 0, kind: 'condenser', label: 'Condenser', work: 0, heat: -(h4 - one.h) * 1000, path: condenser },
  ];
  const notes: string[] = [];
  if (four.x !== undefined && Number.isFinite(four.x) && four.x < 0.88)
    notes.push(`The steam leaves the turbine ${((1 - four.x) * 100).toFixed(1)} % wet; more than about 12 % erodes the last blades. Superheat more or reheat.`);
  return summarise('rankine', states, processes, notes, { backWork: wp / wt });
}

export function runCycle(kind: CycleKind, i: CycleInputs): CycleResult {
  switch (kind) {
    case 'otto':
      return otto(i);
    case 'diesel':
      return diesel(i);
    case 'dual':
      return dual(i);
    case 'brayton':
      return brayton(i);
    case 'carnot':
      return carnot(i);
    case 'stirling':
      return stirling(i);
    case 'rankine':
      return rankine(i);
  }
}

/** The water/steam saturation dome on T–s axes: [s (J/kg·K), T (K)] for the liquid then the vapour side. */
export function steamDome(): { liquid: [number, number][]; vapour: [number, number][] } {
  const liquid: [number, number][] = [];
  const vapour: [number, number][] = [];
  for (let T = 274; T < T_CRIT - 0.5; T += (T_CRIT - 274) / 60) {
    const sat = saturationAtT(T);
    liquid.push([sat.liquid.s * 1000, T]);
    vapour.push([sat.vapour.s * 1000, T]);
  }
  return { liquid, vapour };
}
