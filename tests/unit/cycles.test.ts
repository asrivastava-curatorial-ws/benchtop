import { describe, expect, it } from 'vitest';
import { type CycleInputs, runCycle, steamDome } from '../../src/lib/cycles';

const base: CycleInputs = {
  gamma: 1.4,
  R: 287,
  p1: 100_000,
  T1: 300,
  r: 8,
  qIn: 1_800_000,
  rc: 2,
  rp: 1.5,
  pr: 10,
  Tmax: 1400,
  etaC: 1,
  etaT: 1,
  etaP: 1,
  regen: 0,
  pBoiler: 8e6,
  pCondenser: 8e3,
  Tsteam: 500,
};

describe('engine and power cycles', () => {
  it('Otto, Diesel and dual cycles match their textbook efficiencies', () => {
    const otto = runCycle('otto', base);
    expect(otto.efficiency).toBeCloseTo(1 - 8 ** -0.4, 9);
    expect(otto.wNet).toBeCloseTo(otto.qIn - otto.qOut, 6);
    expect(otto.states[1]?.T).toBeCloseTo(300 * 8 ** 0.4, 6);
    expect(otto.mep).toBeGreaterThan(0);
    const diesel = runCycle('diesel', { ...base, r: 18 });
    expect(diesel.efficiency).toBeCloseTo(1 - (1 / 18 ** 0.4) * ((2 ** 1.4 - 1) / (1.4 * 1)), 9);
    // The dual cycle becomes Diesel with no constant-volume heating, and Otto with no constant-pressure heating.
    expect(runCycle('dual', { ...base, r: 18, rp: 1 }).efficiency).toBeCloseTo(diesel.efficiency, 9);
    expect(runCycle('dual', { ...base, rc: 1 }).efficiency).toBeCloseTo(otto.efficiency, 9);
    // Work around the closed loop equals net heat, and entropy returns to where it started.
    for (const kind of ['otto', 'diesel', 'dual', 'carnot', 'stirling'] as const) {
      const c = runCycle(kind, base);
      expect(c.wNet, kind).toBeCloseTo(
        c.processes.reduce((sum, p) => sum + p.heat, 0),
        3,
      );
      expect(
        c.processes.reduce((sum, p) => sum + (p.path.at(-1)?.[3] ?? 0) - (p.path[0]?.[3] ?? 0), 0),
        kind,
      ).toBeCloseTo(0, 6);
    }
  });

  it('Brayton: ideal, with real machines and with a regenerator', () => {
    const ideal = runCycle('brayton', base);
    expect(ideal.efficiency).toBeCloseTo(1 - 10 ** (-0.4 / 1.4), 9);
    expect(ideal.backWork).toBeCloseTo((300 * 10 ** (0.4 / 1.4)) / 1400, 9);
    const real = runCycle('brayton', { ...base, etaC: 0.85, etaT: 0.88 });
    expect(real.efficiency).toBeLessThan(ideal.efficiency);
    const regenerated = runCycle('brayton', { ...base, pr: 5, etaC: 0.85, etaT: 0.88, regen: 0.8 });
    const plain = runCycle('brayton', { ...base, pr: 5, etaC: 0.85, etaT: 0.88 });
    expect(regenerated.efficiency).toBeGreaterThan(plain.efficiency);
    expect(regenerated.wNet).toBeCloseTo(plain.wNet, 6);
    expect(regenerated.states).toHaveLength(6);
  });

  it('Carnot and Stirling reach the Carnot efficiency', () => {
    expect(runCycle('carnot', base).efficiency).toBeCloseTo(1 - 300 / 1400, 9);
    expect(runCycle('stirling', { ...base, regen: 1 }).efficiency).toBeCloseTo(1 - 300 / 1400, 9);
    expect(runCycle('stirling', { ...base, regen: 0 }).efficiency).toBeLessThan(1 - 300 / 1400);
  });

  it('Rankine: Moran and Shapiro’s example 8.1 (8 MPa saturated steam, 8 kPa condenser)', () => {
    const r = runCycle('rankine', base);
    expect(r.states[0]?.h).toBeCloseTo(173_880, -2);
    expect(r.states[2]?.h).toBeCloseTo(2_758_600, -3);
    expect(r.states[3]?.x).toBeCloseTo(0.6745, 2);
    expect(r.efficiency).toBeCloseTo(0.371, 2);
    expect(r.backWork).toBeCloseTo(0.0084, 3);
    expect(r.notes.join(' ')).toContain('wet');
    const superheated = runCycle('rankine', { ...base, Tsteam: 753.15, etaT: 0.85, etaP: 0.85 });
    expect(superheated.states[2]?.T).toBeCloseTo(753.15, 6);
    const dome = steamDome();
    expect(dome.liquid[0]?.[0]).toBeLessThan(100);
    expect(dome.vapour[0]?.[0]).toBeGreaterThan(9000);
  });
});
