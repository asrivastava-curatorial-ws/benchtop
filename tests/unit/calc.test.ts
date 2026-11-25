import * as math from 'mathjs/number';
import { describe, expect, it } from 'vitest';
import { exampleInputs, formatNumber, fromFormula, toFormula } from '../../src/calc/engine';
import { CALCULATORS, findCalculator } from '../../src/calc/library';
import { compile, solve } from '../../src/calc/solver';
import { CALC_CATEGORIES, type Calculator, isChoice, type NumberVar } from '../../src/calc/types';
import { findUnit, unitsOf } from '../../src/calc/units';

const calc = (id: string): Calculator => {
  const found = findCalculator(id);
  if (!found) throw new Error(`No calculator ${id}`);
  return found;
};

/** Solves with typed values given in the units named (or the shown defaults). */
function run(id: string, typed: Record<string, number | [number, string]>, choices: Record<string, number> = {}) {
  const c = calc(id);
  const given: Record<string, number> = {};
  for (const [key, raw] of Object.entries(typed)) {
    const v = c.vars.find((x) => x.key === key) as NumberVar;
    const [value, unit] = Array.isArray(raw) ? raw : [raw, v.show ?? v.unit];
    given[key] = toFormula(v, value, findUnit(v.dim, unit));
  }
  const choiceValues = { ...exampleInputs(c).choices, ...choices };
  const solution = solve(math, c, given, choiceValues);
  const out = (key: string, unit?: string) => {
    const v = c.vars.find((x) => x.key === key) as NumberVar;
    return fromFormula(v, solution.values[key], findUnit(v.dim, unit ?? v.show ?? v.unit));
  };
  return { solution, out };
}

describe('calculator library', () => {
  it('has unique ids, valid units and equations, and fills every category', () => {
    const ids = new Set<string>();
    for (const c of CALCULATORS) {
      expect(ids.has(c.id), c.id).toBe(false);
      ids.add(c.id);
      expect(() => compile(math, c), c.id).not.toThrow();
      for (const v of c.vars) {
        if (isChoice(v)) expect(v.choices.length, `${c.id}.${v.key}`).toBeGreaterThan(1);
        else {
          expect(() => findUnit(v.dim, v.unit), `${c.id}.${v.key}`).not.toThrow();
          if (v.show) expect(() => findUnit(v.dim, v.show as string), `${c.id}.${v.key}`).not.toThrow();
        }
      }
    }
    for (const category of CALC_CATEGORIES)
      expect(
        CALCULATORS.some((c) => c.category === category.id),
        category.id,
      ).toBe(true);
    expect(CALCULATORS.length).toBeGreaterThanOrEqual(150);
  });

  it('gives complete, consistent results from every calculator’s examples', () => {
    for (const c of CALCULATORS) {
      const { given, choices } = exampleInputs(c);
      const s = solve(math, c, given, choices);
      expect(s.missing, `${c.id} missing`).toEqual([]);
      expect(s.conflicts, `${c.id} conflicts`).toEqual([]);
      for (const [key, value] of Object.entries(s.values)) expect(Number.isFinite(value), `${c.id}.${key} = ${value}`).toBe(true);
    }
  });

  it('solves the popular additions correctly', () => {
    expect(run('fixed-deposit', { deposit: 100000, rate: 7, years: 3 }).out('maturity')).toBeCloseTo(123143.9, 0);
    expect(run('ppf', { yearly: 150000, rate: 7.1, years: 15 }).out('value')).toBeCloseTo(4068209, -3);
    expect(run('egfr', { cr: 1, age: 50 }, { s: 0 }).out('egfr')).toBeCloseTo(68.6, 0);
    const mix = run('concrete-mix', { V: 1 });
    expect(mix.out('bags')).toBeCloseTo(8.07, 1);
    expect(mix.out('sand')).toBeCloseTo(0.42, 2);
    expect(run('rebar-weight', { d: 12, L: 1, n: 1 }).out('perM')).toBeCloseTo(0.889, 3);
    expect(run('blood-alcohol', { mass: 70, drinks: 2, t: 1 }, { s: 0.68 }).out('bac')).toBeCloseTo(27, 0);
    expect(run('diagnostic-test', { tp: 90, fp: 30, fn: 10, tn: 870 }).out('ppv')).toBeCloseTo(75, 6);
    expect(run('doppler', { f: 440, vs: 72, vl: 0, c: 343 }).out('heard')).toBeCloseTo(467.2, 1);
    expect(run('snells-law', { n1: 1, n2: 1.5, a1: 30 }).out('a2')).toBeCloseTo(19.47, 2);
    const orbit = run('orbital-velocity', { M: 5.972e24, R: 6371, h: 400 });
    expect(orbit.out('v', 'm/s')).toBeCloseTo(7672.6, 0);
    expect(orbit.out('T')).toBeCloseTo(92.4, 1);
    expect(run('percentage-change', { before: 80, after: 100 }).out('change')).toBeCloseTo(25, 9);
    expect(run('loan-affordability', { emi: 25000, rate: 8.5, years: 20 }).out('loan')).toBeCloseTo(2880604, -3);
  });

  it('every number variable can be shown in each unit of its dimension', () => {
    for (const c of CALCULATORS)
      for (const v of c.vars)
        if (!isChoice(v))
          for (const unit of unitsOf(v.dim)) {
            const there = fromFormula(v, 3, unit);
            expect(toFormula(v, there, unit), `${c.id}.${v.key} ${unit.id}`).toBeCloseTo(3, 9);
          }
  });
});

describe('known answers', () => {
  it('loan EMI, and the rate back from the EMI', () => {
    expect(run('emi', { principal: 1000000, rate: 8.5, years: 20 }).out('payment')).toBeCloseTo(8678.23, 1);
    expect(run('emi', { principal: 1000000, payment: 8678.23, years: 20 }).out('rate')).toBeCloseTo(8.5, 3);
    expect(run('emi', { total: 2082775.2, rate: 8.5, years: 20 }).out('principal')).toBeCloseTo(1000000, -1);
  });

  it('SIP, compound interest and recurring deposits', () => {
    expect(run('sip', { monthly: 5000, rate: 12, years: 10 }).out('value')).toBeCloseTo(1161695, -1);
    expect(run('compound-interest', { principal: 100000, rate: 7, years: 5 }, { k: 4 }).out('total')).toBeCloseTo(141478, -1);
    // Each monthly deposit compounds quarterly for the months it stays in the account.
    let direct = 0;
    for (let m = 1; m <= 60; m++) direct += 5000 * (1 + 0.07 / 4) ** (m / 3);
    expect(run('recurring-deposit', { monthly: 5000, rate: 7, years: 5 }).out('maturity')).toBeCloseTo(direct, 4);
  });

  it('BMI, body fat and calorie needs', () => {
    const bmi = run('bmi', { mass: 70, height: 175 });
    expect(bmi.out('bmi')).toBeCloseTo(22.857, 3);
    expect(run('body-fat-navy', { height: 175, neck: 38, waist: 85 }, { s: 1 }).out('fat')).toBeCloseTo(16.94, 1);
    expect(run('bmr', { mass: 70, height: 170, age: 35 }, { s: 0 }).out('bmr')).toBeCloseTo(1426.5, 1);
    expect(run('bmr', { mass: 70, height: 170, age: 35 }, { s: 1 }).out('bmr')).toBeCloseTo(1592.5, 1);
  });

  it('pace, temperature and fuel economy', () => {
    const pace = run('pace', { distance: 10, time: 55 });
    expect(pace.out('pace')).toBeCloseTo(5.5, 9);
    expect(pace.out('speed')).toBeCloseTo(10.909, 3);
    expect(run('temperature', { c: 37 }).out('f')).toBeCloseTo(98.6, 9);
    expect(run('temperature', { f: 212 }).out('c')).toBeCloseTo(100, 9);
    const fuel = run('fuel-economy', { economy: [15, 'km/L'], distance: 300 });
    expect(fuel.out('fuel')).toBeCloseTo(20, 9);
    expect(fuel.out('economy', 'L/100km')).toBeCloseTo(6.6667, 3);
    expect(fuel.out('economy', 'mpg')).toBeCloseTo(35.28, 2);
  });

  it('geometry and algebra in any direction', () => {
    expect(run('pythagoras', { a: 3, b: 4 }).out('c')).toBeCloseTo(5, 9);
    expect(run('pythagoras', { c: 5, b: 4 }).out('a')).toBeCloseTo(3, 9);
    const q = run('quadratic', { a: 1, b: -3, c: 2 });
    expect([q.out('x1'), q.out('x2')]).toEqual([2, 1]);
    expect(run('circle', { A: [78.5398163, 'cm²'] }).out('r', 'cm')).toBeCloseTo(5, 6);
    expect(run('proportion', { a: 3, b: 4, c: 15 }).out('d')).toBeCloseTo(20, 9);
  });

  it('weather formulas', () => {
    expect(run('dew-point', { T: 30, rh: 70 }).out('Td')).toBeCloseTo(23.9, 1);
    expect(run('wind-chill', { T: -5, v: 30 }).out('WC')).toBeCloseTo(-13, 0);
    expect(run('heat-index', { T: [90, '°F'], rh: 60 }).out('HI', '°F')).toBeCloseTo(100, 0);
  });

  it('cricket overs written as overs.balls', () => {
    const r = run('cricket-run-rate', { runs: 145, overs: 16.3, target: 210, total: 20 });
    expect(r.out('rate')).toBeCloseTo(8.788, 3);
    expect(r.out('required')).toBeCloseTo(18.571, 3);
  });

  it('uses only the equations for the chosen option', () => {
    const tank = calc('water-tank');
    const round = solve(math, tank, { d: 1, h: 1 }, { round: 1 });
    expect(round.active.has('l')).toBe(false);
    expect(round.values.V).toBeCloseTo(Math.PI / 4, 9);
  });

  it('reports values that contradict each other', () => {
    const s = solve(math, calc('pythagoras'), { a: 3, b: 4, c: 6 }, {});
    expect(s.conflicts.length).toBe(1);
  });

  it('formats results', () => {
    expect(formatNumber(8678.2264, 'en-US')).toBe('8,678.23');
    expect(formatNumber(1161695.38, 'en-IN')).toBe('11,61,695.38');
    expect(formatNumber(0.000012345, 'en-US')).toBe('0.000012345');
    expect(formatNumber(6.02214076e23, 'en-US')).toBe('6.0221e+23');
  });
});

describe('heat, acoustics and saw-angle calculators', () => {
  it('adds and subtracts decibels', () => {
    expect(run('decibel-sum', { L1: 85, L2: 82 }).out('L')).toBeCloseTo(86.764, 3);
    expect(run('decibel-sum', { L1: 85, L: 86.764 }).out('L2')).toBeCloseTo(82, 2);
    expect(run('decibel-identical', { L1: 70, n: 4 }).out('L')).toBeCloseTo(76.0206, 4);
    expect(run('sound-distance', { L1: 90, r1: 1, r2: 10 }, { source: 20 }).out('L2')).toBeCloseTo(70, 9);
    expect(run('sound-distance', { L1: 90, r1: 1, r2: 10 }, { source: 10 }).out('L2')).toBeCloseTo(80, 9);
    expect(run('sound-power-pressure', { Lw: 95, r: 5 }, { Q: 2 }).out('Lp')).toBeCloseTo(73.039, 3);
  });

  it('room acoustics, wavelength, weighting, dose and the mass law', () => {
    expect(run('reverberation-time', { V: 300, S: 290, alpha: 0.2 }, { formula: 0 }).out('RT')).toBeCloseTo(0.83276, 4);
    expect(run('reverberation-time', { V: 300, S: 290, alpha: 0.2 }, { formula: 1 }).out('RT')).toBeCloseTo(0.74639, 4);
    expect(run('sound-wavelength', { f: 1000, T: 20 }).out('c')).toBeCloseTo(343.23, 1);
    expect(run('a-weighting', { f: 1000 }).out('A')).toBeCloseTo(0, 1);
    expect(run('a-weighting', { f: 100 }).out('A')).toBeCloseTo(-19.1, 1);
    expect(run('a-weighting', { f: 100 }).out('C')).toBeCloseTo(-0.3, 1);
    expect(run('noise-dose', { L: 95, t: 2 }, { rule: 0 }).out('dose')).toBeCloseTo(251.98, 1);
    expect(run('noise-dose', { L: 95, t: 2 }, { rule: 1 }).out('dose')).toBeCloseTo(50, 6);
    expect(run('mass-law', { rho: 2300, t: 100, f: 500 }).out('TL')).toBeCloseTo(54.21, 2);
  });

  it('insulated pipes, expansion loops and heat exchangers', () => {
    const pipe = run('pipe-insulation', { D: 114.3, t: 50, k: 0.04, Ti: 180, Ta: 25, h: 10, L: 50, hours: 8000 });
    expect(pipe.out('q')).toBeCloseTo(58.503, 2);
    expect(pipe.out('Ts')).toBeCloseTo(33.69, 2);
    // Thickness for a 30 °C surface, solved backwards.
    expect(run('pipe-insulation', { D: 114.3, Ts: 33.6898, k: 0.04, Ti: 180, Ta: 25, h: 10, L: 50, hours: 8000 }).out('t')).toBeCloseTo(50, 1);
    const loop = run('expansion-loop', { La: 60, alpha: 12, dT: 150, D: 114.3, E: 200, sigma: 100 }, { share: 0.5 });
    expect(loop.out('dL')).toBeCloseTo(108, 6);
    expect(loop.out('leg')).toBeCloseTo(6.0854, 3);
    const hx = run('lmtd', { Th1: 90, Th2: 60, Tc1: 20, Tc2: 45, U: 1000, A: 5 }, { flow: 0 });
    expect(hx.out('lmtd')).toBeCloseTo(42.4509, 3);
    expect(hx.out('Q')).toBeCloseTo(212.25, 1);
  });

  it('combustion, fuel, balloons and buoyancy', () => {
    const air = run('combustion-air', { C: 86.5, H: 13.2, O: 0, S: 0.3, O2: 3 });
    expect(air.out('Ast')).toBeCloseTo(14.4967, 3);
    expect(air.out('excess')).toBeCloseTo(16.667, 2);
    const flue = run('flue-gas-loss', { Tf: 180, Ta: 25, O2: 3 }, { fuel: 0 });
    expect(flue.out('loss')).toBeCloseTo(7.0783, 3);
    expect(flue.out('eta')).toBeCloseTo(92.9217, 3);
    expect(flue.out('CO2')).toBeCloseTo(10.114, 3);
    expect(run('fuel-use', { Q: 1000, cv: 46.1, eff: 85, price: 65 }).out('m')).toBeCloseTo(91.873, 2);
    expect(run('hot-air-balloon', { V: 2800, Ta: 15, Ti: 100, p: 101.325 }).out('lift')).toBeCloseTo(781.3, 0);
    const float = run('buoyancy', { V: 50, rhof: 1000, m: 30 });
    expect(float.out('Fb')).toBeCloseTo(490.33, 1);
    expect(float.out('spare')).toBeCloseTo(20, 9);
  });

  it('saw angles for crown moulding and sloped boxes', () => {
    const crown = run('crown-moulding', { spring: 38, corner: 90 });
    expect(crown.out('miter')).toBeCloseTo(31.62, 2);
    expect(crown.out('bevel')).toBeCloseTo(33.86, 2);
    const box = run('compound-miter-box', { n: 4, tilt: 15 });
    expect(box.out('miter')).toBeCloseTo(14.51, 2);
    expect(box.out('bevel')).toBeCloseTo(43.08, 2);
  });
});

describe('machine design and electrical machines', () => {
  it('bearings, columns and principal stresses', () => {
    const bearing = run('bearing-life', { C: 30, P: 5, n: 1500 });
    expect(bearing.out('L10')).toBeCloseTo(216, 6);
    expect(bearing.out('hours')).toBeCloseTo(2400, 6);
    expect(run('bearing-life', { C: 30, P: 5, n: 1500 }, { p: 10 / 3 }).out('L10')).toBeCloseTo(6 ** (10 / 3), 6);
    const euler = run('euler-buckling', { E: 200, I: 125664, A: 1257, L: 1.5 });
    expect(euler.out('Pcr')).toBeCloseTo(110.24, 1);
    expect(run('euler-buckling', { E: 200, I: 125664, A: 1257, L: 1.5 }, { K: 0.5 }).out('Pcr')).toBeCloseTo(4 * euler.out('Pcr'), 6);
    const johnson = run('johnson-buckling', { Sy: 250, E: 200, A: 1257, r: 10, L: 0.8 });
    expect(johnson.out('slender')).toBeCloseTo(80, 9);
    expect(johnson.out('crit')).toBeCloseTo(125.66, 2);
    expect(johnson.out('Pcr')).toBeCloseTo(250.6, 1);
    const mohr = run('mohrs-circle', { sx: 80, sy: -40, txy: 30 });
    expect(mohr.out('s1')).toBeCloseTo(87.08, 2);
    expect(mohr.out('s2')).toBeCloseTo(-47.08, 2);
    expect(mohr.out('tmax')).toBeCloseTo(67.08, 2);
    expect(mohr.out('theta')).toBeCloseTo(13.28, 2);
  });

  it('springs, joints, screws and fatigue', () => {
    const spring = run('helical-spring', { d: 4, D: 32, Na: 10, G: 79.3, F: 200 });
    expect(spring.out('Kw')).toBeCloseTo(1.184, 3);
    expect(spring.out('tau')).toBeCloseTo(301.5, 0);
    expect(spring.out('k')).toBeCloseTo(7.744, 3);
    const joint = run('bolted-joint', { At: 84.3, Sp: 600, kb: 800000, km: 2400000, P: 15 });
    expect(joint.out('Fi')).toBeCloseTo(37.935, 3);
    expect(joint.out('Fb')).toBeCloseTo(41.685, 3);
    expect(joint.out('Fm')).toBeCloseTo(-26.685, 3);
    const screw = run('power-screw', { F: 10, dm: 24, lead: 5, mu: 0.12, muc: 0.1, dc: 40 });
    expect(screw.out('Tr')).toBeCloseTo(42.54, 1);
    expect(screw.out('Tl')).toBeGreaterThan(0);
    expect(screw.out('eff')).toBeCloseTo(18.7, 1);
    const typed = { sa: 80, sm: 120, Se: 210, Sut: 600, Sy: 420 };
    expect(run('fatigue-safety', typed).out('n')).toBeCloseTo(1.721, 3);
    expect(run('fatigue-safety', typed, { rule: 1 }).out('n')).toBeCloseTo(1 / (80 / 210 + 120 / 420), 9);
    expect(run('fatigue-safety', typed, { rule: 2 }).out('n')).toBeCloseTo(2.14, 2);
    const marin = run('marin-endurance', { Sut: 690, d: 30, kd: 1 });
    expect(marin.out('ka')).toBeCloseTo(0.798, 3);
    expect(marin.out('kb')).toBeCloseTo(0.862, 3);
    expect(marin.out('Se')).toBeCloseTo(237.2, 0);
    expect(run('crack-toughness', { sigma: 200, a: 2, Y: 1.12, KIc: 50 }).out('ac')).toBeCloseTo(15.86, 1);
  });

  it('gears, belts, chains and shafts', () => {
    const lewis = run('lewis-gear', { T: 100, m: 3, z: 20, F: 30, Y: 0.32, n: 1000 });
    expect(lewis.out('Wt')).toBeCloseTo(3333.3, 1);
    expect(lewis.out('sigma')).toBeCloseTo(175.3, 0);
    expect(run('spur-gear', { m: 4, z1: 18, z2: 54, phi: 20 }).out('a')).toBeCloseTo(144, 9);
    const belt = run('flat-belt', { P: 15, v: 20, mu: 0.3, theta: 165, mlin: 0.5 });
    expect(belt.out('T1') - belt.out('T2')).toBeCloseTo(750, 6);
    expect(belt.out('T1') / belt.out('T2')).toBeCloseTo(Math.exp(0.3 * ((165 * Math.PI) / 180)), 9);
    expect(run('chain-drive', { p: 15.875, z1: 17, z2: 51, n1: 900, C: 635 }).out('links')).toBeCloseTo(114.73, 2);
    expect(run('shaft-diameter', { M: 400, T: 600, Km: 1.5, Kt: 1, tau: 40 }).out('d')).toBeCloseTo(47.63, 1);
  });

  it('pumps, turbines, motors and the supply', () => {
    expect(run('npsh-available', { patm: 101.325, pv: 3.17, rho: 997, hs: -3, hf: 1.2, NPSHr: 4 }).out('NPSHa')).toBeCloseTo(5.84, 2);
    const affinity = run('pump-affinity', { n1: 1450, n2: 1750, D1: 250, D2: 230, Q1: 100, H1: 30, P1: 11 });
    expect(affinity.out('H2')).toBeCloseTo(30 * (1750 / 1450) ** 2, 9);
    expect(run('hydro-turbine', { Q: 2, H: 40, eta: 88, N: 500 }).out('Ns')).toBeCloseTo(130.6, 0);
    const motor = run('induction-motor', { f: 50, poles: 4, n: 1440, P: 7.5 });
    expect(motor.out('ns')).toBeCloseTo(1500, 9);
    expect(motor.out('s')).toBeCloseTo(4, 9);
    const slip = run('motor-torque-slip', { V: 230, f: 50, poles: 4, R1: 0.5, R2: 0.4, X: 2.4, s: 4 });
    expect(slip.out('T')).toBeCloseTo(87.1, 1);
    expect(slip.out('Tmax')).toBeCloseTo(171.15, 2);
    expect(run('wheatstone-bridge', { Vs: 5, R1: 1000, R2: 1000, R3: 1000, Rx: 1010 }).out('Vout')).toBeCloseTo(12.44, 2);
    const pf = run('pf-correction', { P: 50, pf1: 0.7, pf2: 0.95, VL: 415, f: 50 });
    expect(pf.out('Qc')).toBeCloseTo(34.58, 2);
    expect(pf.out('C')).toBeCloseTo(213.0, 0);
    expect(run('three-phase-power', { VL: 415, IL: 20, pf: 0.85 }, { conn: 1 }).out('Iph')).toBeCloseTo(11.547, 3);
    expect(run('thermocouple', { Th: 300, Tc: 25 }).out('V')).toBeCloseTo(11.275, 3);
    expect(run('thermal-radiation', { eps: 0.9, A: 2, Ts: 150, Tsur: 20 }).out('q')).toBeCloseTo(2518, -1);
    expect(run('taylor-tool-life', { V: 150, n: 0.25, C: 400 }).out('T')).toBeCloseTo((400 / 150) ** 4, 6);
  });
});
