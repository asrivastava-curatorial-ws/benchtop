import { describe, expect, it } from 'vitest';
import {
  buoyancy,
  collide,
  contour,
  doppler,
  fieldAt,
  fieldLines,
  flight,
  G_EARTH,
  gasState,
  generator,
  harmonic,
  idealFlight,
  incline,
  lever,
  MU_SUN,
  magnification,
  makeGas,
  orbitElements,
  orbitStep,
  oscillatorInfo,
  pendulum,
  pendulumPeriod,
  potentialAt,
  resultant,
  rk4,
  setTemperature,
  stepGas,
  tackle,
  venturi,
} from '../../src/lib/physics-lab';

describe('physics lab', () => {
  it('steps an equation with Runge–Kutta', () => {
    let y = [1];
    for (let i = 0; i < 100; i++) y = rk4((_t, s) => [s[0] ?? 0], i / 100, y, 0.01);
    expect(y[0]).toBeCloseTo(Math.E, 9);
  });

  it('flies projectiles with and without air', () => {
    const launch = { v0: 30, angle: 40, h0: 2, g: G_EARTH, drag: 0 };
    const f = flight(launch);
    const ideal = idealFlight(launch);
    expect(f.range).toBeCloseTo(ideal.range, 3);
    expect(f.time).toBeCloseTo(ideal.time, 4);
    expect(f.apex).toBeCloseTo(ideal.apex, 3);
    // 45° goes furthest from level ground.
    const at = (angle: number) => idealFlight({ v0: 20, angle, h0: 0, g: 9.81, drag: 0 }).range;
    expect(at(45)).toBeGreaterThan(at(40));
    expect(at(45)).toBeGreaterThan(at(50));
    expect(at(45)).toBeCloseTo(400 / 9.81, 9);
    const dragged = flight({ ...launch, drag: 0.02 });
    expect(dragged.range).toBeLessThan(f.range);
    expect(dragged.apex).toBeLessThan(f.apex);
    expect(dragged.impactAngle).toBeGreaterThan(f.impactAngle);
  });

  it('times a pendulum exactly', () => {
    const L = 2;
    expect(pendulumPeriod(L, 9.81, 0.001)).toBeCloseTo(2 * Math.PI * Math.sqrt(L / 9.81), 6);
    expect(pendulumPeriod(1, 1, Math.PI / 2) / (2 * Math.PI)).toBeCloseTo(1.18034, 5);
    // A simulated 60° swing returns on time.
    const T = pendulumPeriod(L, 9.81, Math.PI / 3);
    const f = pendulum(L, 9.81, 0);
    let y = [Math.PI / 3, 0];
    const n = 4000;
    for (let i = 0; i < n; i++) y = rk4(f, (i * T) / n, y, T / n);
    expect(y[0]).toBeCloseTo(Math.PI / 3, 6);
    expect(y[1]).toBeCloseTo(0, 5);
  });

  it('describes a driven, damped oscillator', () => {
    const info = oscillatorInfo({ m: 2, k: 800, c: 8, F0: 10, w: 20 });
    expect(info.wn).toBeCloseTo(20, 9);
    expect(info.zeta).toBeCloseTo(0.1, 9);
    expect(info.regime).toBe('underdamped');
    expect(info.ratio).toBeCloseTo(5, 9);
    expect(info.lag).toBeCloseTo(90, 9);
    expect(magnification(0, 0.3)).toBe(1);
    expect(oscillatorInfo({ m: 1, k: 1, c: 2, F0: 0, w: 1 }).regime).toBe('critically damped');
    expect(oscillatorInfo({ m: 1, k: 1, c: 3, F0: 0, w: 1 }).regime).toBe('overdamped');
  });

  it('conserves momentum in collisions', () => {
    const elastic = collide(1, 3, 1, 0, 1);
    expect(elastic.v1).toBeCloseTo(0, 12);
    expect(elastic.v2).toBeCloseTo(3, 12);
    expect(elastic.lost).toBeCloseTo(0, 12);
    const stuck = collide(2, 3, 1, -3, 0);
    expect(stuck.v1).toBeCloseTo(1, 12);
    expect(stuck.v2).toBeCloseTo(1, 12);
    expect(stuck.pAfter).toBeCloseTo(stuck.p, 12);
    expect(stuck.lost).toBeCloseTo(12, 12);
  });

  it('keeps Kepler’s laws', () => {
    const earth = { x: 1, y: 0, vx: 0, vy: 2 * Math.PI };
    const el = orbitElements(MU_SUN, earth);
    expect(el.e).toBeCloseTo(0, 9);
    expect(el.period).toBeCloseTo(1, 9);
    let b = earth;
    const n = 2000;
    for (let i = 0; i < n; i++) b = orbitStep(MU_SUN, b, 1 / n);
    expect(b.x).toBeCloseTo(1, 4);
    expect(b.y).toBeCloseTo(0, 3);
    // Faster than circular speed at 0.5 AU (but below escape): 0.5 AU is the perihelion.
    const comet = orbitElements(MU_SUN, { x: 0.5, y: 0, vx: 0, vy: 2 * Math.PI * Math.SQRT2 * 1.2 });
    expect(comet.perihelion).toBeCloseTo(0.5, 9);
    expect(comet.a * (1 - comet.e)).toBeCloseTo(0.5, 9);
    expect(comet.aphelion).toBeGreaterThan(1);
    expect(orbitElements(MU_SUN, { x: 1, y: 0, vx: 0, vy: 2 * Math.PI * Math.SQRT2 * 1.01 }).bound).toBe(false);
  });

  it('slides blocks down slopes when friction gives way', () => {
    const slides = incline(30, 0.3, 0.2, 2, 9.81);
    expect(slides.holds).toBe(false);
    expect(slides.accel).toBeCloseTo(9.81 * (Math.sin(Math.PI / 6) - 0.2 * Math.cos(Math.PI / 6)), 9);
    const holds = incline(30, 0.7, 0.5, 2, 9.81);
    expect(holds.holds).toBe(true);
    expect(holds.friction).toBeCloseTo(9.81, 9);
    expect(holds.critical).toBeCloseTo((Math.atan(0.7) * 180) / Math.PI, 9);
    // A hard push up the slope moves it up.
    expect(incline(30, 0.3, 0.2, 2, 9.81, 30).accel).toBeLessThan(0);
  });

  it('works out levers, pulleys and resultants', () => {
    expect(lever(1, 0, 3, 300)).toMatchObject({ kind: 1, force: 150, advantage: 2 });
    expect(lever(0, 1, 3, 300).kind).toBe(2);
    expect(lever(0, 3, 1, 300)).toMatchObject({ kind: 3, force: 900 });
    expect(tackle(4, 1000, 0.8)).toMatchObject({ ideal: 250, effort: 312.5 });
    const r = resultant([
      { size: 3, angle: 0 },
      { size: 4, angle: 90 },
    ]);
    expect(r.size).toBeCloseTo(5, 12);
    expect(r.angle).toBeCloseTo(53.130102, 5);
  });

  it('finds harmonics and the Doppler shift', () => {
    expect(harmonic('string', 2, 0.5, 200)).toBe(400);
    expect(harmonic('closed', 2, 0.5, 340)).toBe(510);
    expect(doppler(440, 343, 34.3, 0)).toBeCloseTo(440 / 0.9, 9);
  });

  it('runs a gas that obeys PV = NkT (roughly) and keeps its energy', () => {
    const g = makeGas(150, 100, 60, 0.6, 1, 7);
    setTemperature(g, 1);
    const e0 = gasState(g).kT;
    for (let i = 0; i < 4000; i++) stepGas(g, 0.02);
    const s = gasState(g);
    expect(s.kT).toBeCloseTo(e0, 9);
    expect(s.pressure / s.ideal).toBeGreaterThan(0.85);
    expect(s.pressure / s.ideal).toBeLessThan(1.25);
  });

  it('computes fields and traces field lines', () => {
    const one = [{ x: 0, y: 0, q: 1 }];
    const [ex, ey] = fieldAt(one, 0.1, 0);
    expect(ex).toBeCloseTo(898.755, 2);
    expect(ey).toBeCloseTo(0, 9);
    expect(potentialAt(one, 0.1, 0)).toBeCloseTo(89.8755, 3);
    const dipole = [
      { x: -0.1, y: 0, q: 1 },
      { x: 0.1, y: 0, q: -1 },
    ];
    const lines = fieldLines(dipole, [-0.5, -0.3, 0.5, 0.3]);
    expect(lines.length).toBe(8);
    expect(lines.some((l) => l.at(-1)?.[0] === 0.1)).toBe(true);
  });

  it('works out generators and fluids', () => {
    const ac = generator(100, 0.2, 0.01, 600, 0, false);
    expect(ac.peak).toBeCloseTo(100 * 0.2 * 0.01 * 20 * Math.PI, 9);
    expect(ac.frequency).toBe(10);
    expect(generator(100, 0.2, 0.01, 600, 0.0125, true).emf).toBeGreaterThan(0);
    const ice = buoyancy(917, 1, 1025, 9.81);
    expect(ice.floats).toBe(true);
    expect(ice.submerged).toBeCloseTo(917 / 1025, 12);
    const iron = buoyancy(7870, 0.001, 1000, 9.81);
    expect(iron.apparent).toBeCloseTo(6.87 * 9.81, 9);
    const v = venturi(0.01, 0.1, 0.05, 1000, 9.81);
    expect(v.v2 / v.v1).toBeCloseTo(4, 12);
    expect(v.drop).toBeCloseTo(0.5 * 1000 * (v.v2 ** 2 - v.v1 ** 2), 9);
  });

  it('draws contours by marching squares', () => {
    // A cone r = √(x² + y²) cut at 1 gives a ring of radius 1.
    const n = 41;
    const values = new Float64Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) values[j * n + i] = Math.hypot(-2 + i * 0.1, -2 + j * 0.1);
    const segs = contour(values, n, n, -2, -2, 0.1, 0.1, 1);
    expect(segs.length).toBeGreaterThan(30);
    for (const [x1, y1, x2, y2] of segs) {
      expect(Math.hypot(x1, y1)).toBeCloseTo(1, 1);
      expect(Math.hypot(x2, y2)).toBeCloseTo(1, 1);
    }
  });
});
