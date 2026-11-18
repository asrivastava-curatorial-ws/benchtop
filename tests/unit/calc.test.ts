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
