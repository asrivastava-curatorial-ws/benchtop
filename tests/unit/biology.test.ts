import { describe, expect, it } from 'vitest';
import { enzyme, epidemic, exponential, finalSize, integrate, lineweaverBurk, logistic, lotkaVolterra, lvInvariant, neuron, osmoticPressure, twoCompartments } from '../../src/lib/biology';

describe('biology lab', () => {
  it('grows populations', () => {
    expect(exponential(10, Math.LN2, 3)).toBeCloseTo(80, 9);
    expect(logistic(10, 0.5, 1000, 0)).toBeCloseTo(10, 9);
    expect(logistic(10, 0.5, 1000, 200)).toBeCloseTo(1000, 6);
    // Harvesting a fifth of r lowers the ceiling by a fifth.
    expect(logistic(10, 0.5, 1000, 400, 0.1)).toBeCloseTo(800, 6);
    // The logistic curve is steepest at K/2.
    const t = Math.log(99) / 0.5;
    expect(logistic(10, 0.5, 1000, t)).toBeCloseTo(500, 6);
  });

  it('keeps predator–prey cycles closed', () => {
    const p = { alpha: 1, beta: 0.1, delta: 0.075, gamma: 1.5, k: Number.POSITIVE_INFINITY };
    const run = integrate(lotkaVolterra(p), [10, 5], 30, 0.001, 300);
    const v0 = lvInvariant(p, 10, 5);
    for (const [x = 1, y = 1] of run.y) expect(lvInvariant(p, x, y)).toBeCloseTo(v0, 6);
  });

  it('spreads epidemics and stops them with enough vaccination', () => {
    expect(finalSize(2)).toBeCloseTo(0.7968, 4);
    const sir = epidemic({ population: 1e6, r0: 2, infectious: 7, latent: 0, vaccinated: 0, seed: 10, days: 1000 });
    expect(sir.total / 1e6).toBeCloseTo(finalSize(2), 2);
    expect(sir.peakDay).toBeGreaterThan(50);
    const seir = epidemic({ population: 1e6, r0: 2, infectious: 7, latent: 5, vaccinated: 0, seed: 10, days: 1000 });
    expect(seir.peakDay).toBeGreaterThan(sir.peakDay);
    const herd = epidemic({ population: 1e6, r0: 2, infectious: 7, latent: 0, vaccinated: 0.55, seed: 10, days: 1000 });
    expect(herd.peak).toBeLessThanOrEqual(10 + 1e-6);
  });

  it('follows Michaelis–Menten with inhibitors', () => {
    expect(enzyme(5, 10, 5, 'none', 0, 1).rate).toBe(5);
    const comp = enzyme(5, 10, 5, 'competitive', 2, 1);
    expect(comp.km).toBe(15);
    expect(comp.vmax).toBe(10);
    expect(enzyme(5, 10, 5, 'noncompetitive', 1, 1).vmax).toBe(5);
    const un = enzyme(5, 10, 5, 'uncompetitive', 1, 1);
    expect(un.km).toBe(2.5);
    expect(un.vmax).toBe(5);
    const data = [0.5, 1, 2, 5, 10, 20].map((s) => [s, (8 * s) / (3 + s)] as const);
    const fit = lineweaverBurk(data);
    expect(fit?.vmax).toBeCloseTo(8, 9);
    expect(fit?.km).toBeCloseTo(3, 9);
    expect(fit?.r2).toBeCloseTo(1, 9);
  });

  it('fires a Hodgkin–Huxley neuron', () => {
    const rest = neuron({ current: 0, start: 5, width: 40, every: 0 }, 50);
    expect(rest.spikes).toHaveLength(0);
    expect(rest.v.at(-1)).toBeCloseTo(-65, 0);
    const driven = neuron({ current: 10, start: 5, width: 100, every: 0 }, 60);
    expect(driven.spikes.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...driven.v)).toBeGreaterThan(30);
    // A brief weak pulse stays below threshold.
    expect(neuron({ current: 2, start: 5, width: 1, every: 0 }, 30).spikes).toHaveLength(0);
  });

  it('evens out diffusion and works out osmotic pressure', () => {
    const [l, r] = twoCompartments(100, 0, 0.1, 1000);
    expect(l).toBeCloseTo(50, 9);
    expect(r).toBeCloseTo(50, 9);
    expect(twoCompartments(100, 0, 0.1, 0)).toEqual([100, 0]);
    expect(osmoticPressure(0.1, 2, 298) / 1000).toBeCloseTo(495.5, 1);
  });
});
