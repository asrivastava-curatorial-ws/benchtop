import { describe, expect, it } from 'vitest';
import {
  brewster,
  criticalAngle,
  fresnel,
  gratingOrders,
  imageThrough,
  minimumDeviation,
  polarisers,
  prism,
  refractiveIndex,
  slits,
  snell,
  thinLens,
  traceRay,
  wavelengthColour,
} from '../../src/lib/optics';

const deg = (d: number) => (d * Math.PI) / 180;

describe('optics', () => {
  it('forms images with thin lenses and mirrors', () => {
    expect(thinLens(10, 20)).toEqual({ v: 20, m: -1 });
    const magnifier = thinLens(10, 5);
    expect(magnifier.v).toBeCloseTo(-10, 12);
    expect(magnifier.m).toBeCloseTo(2, 12);
    const diverging = thinLens(-10, 10);
    expect(diverging.v).toBeCloseTo(-5, 12);
    expect(diverging.m).toBeCloseTo(0.5, 12);
    expect(thinLens(10, 10).v).toBe(Number.POSITIVE_INFINITY);
  });

  it('traces rays that meet at the image, through one lens or two', () => {
    const lens = [{ x: 0, f: 10 }];
    // Three rays from the tip of an object 30 in front, 2 high.
    const slopes = [0, -2 / 30, -2 / (30 - 10)];
    const v = thinLens(10, 30).v;
    for (const s of slopes) {
      const { points, slope } = traceRay(lens, -30, 2, s, 100);
      const atLens = points[1] ?? [0, 0];
      expect(atLens[1] + slope * v).toBeCloseTo(-1, 9);
    }
    const pair = [
      { x: 0, f: 10 },
      { x: 25, f: 5 },
    ];
    const img = imageThrough(pair, 30, 2);
    for (const s of slopes) {
      const { points, slope } = traceRay(pair, -30, 2, s, 200);
      const at2 = points[2] ?? [0, 0];
      expect(at2[1] + slope * (img.x - 25)).toBeCloseTo(img.h, 9);
    }
    expect(img.m).toBeCloseTo(img.h / 2, 12);
  });

  it('refracts, reflects and polarises at a boundary', () => {
    expect(snell(1, 1.33, deg(30))).toBeCloseTo(Math.asin(0.5 / 1.33), 12);
    expect(snell(1.5, 1, deg(45))).toBeNull();
    expect(criticalAngle(1.5, 1)).toBeCloseTo(Math.asin(1 / 1.5), 12);
    expect(criticalAngle(1, 1.5)).toBeNull();
    expect(fresnel(1, 1.5, 0).r).toBeCloseTo(0.04, 12);
    expect(fresnel(1, 1.5, brewster(1, 1.5)).rp).toBeCloseTo(0, 12);
    expect(fresnel(1.5, 1, deg(60)).r).toBe(1);
  });

  it('bends and spreads light through a prism', () => {
    const n = 1.5;
    const min = minimumDeviation(deg(60), n);
    expect((min.deviation * 180) / Math.PI).toBeCloseTo(37.18, 2);
    const p = prism(deg(60), n, min.incidence);
    expect(p.deviation).toBeCloseTo(min.deviation, 12);
    expect(p.r1).toBeCloseTo(deg(30), 12);
    // Any other incidence deviates more.
    expect(prism(deg(60), n, min.incidence + 0.1).deviation ?? 0).toBeGreaterThan(min.deviation);
    expect(prism(deg(60), n, deg(10)).exit).toBeNull();
    // Violet bends more than red.
    expect(refractiveIndex('crown', 400)).toBeGreaterThan(refractiveIndex('crown', 700));
    expect(refractiveIndex('crown', 589)).toBeCloseTo(1.517, 2);
  });

  it('works out slit patterns and grating orders', () => {
    const lambda = 0.5;
    expect(slits(0, lambda, 2, 10, 2)).toBe(1);
    // Single slit: first dark fringe at sin θ = λ/a.
    expect(slits(Math.asin(lambda / 2), lambda, 2, 10, 1)).toBeCloseTo(0, 12);
    // Double slit: bright where sin θ = λ/d (inside the envelope), dark halfway.
    expect(slits(Math.asin(lambda / 10), lambda, 0.1, 10, 2)).toBeCloseTo(1, 3);
    expect(slits(Math.asin(lambda / 20), lambda, 0.1, 10, 2)).toBeCloseTo(0, 6);
    const orders = gratingOrders(0.6, 1.666);
    expect(orders.map((o) => o.m)).toEqual([0, 1, 2]);
    expect(orders[1]?.angle).toBeCloseTo(Math.asin(0.6 / 1.666), 12);
  });

  it('follows Malus’s law', () => {
    expect(polarisers(1, [0, 90])).toEqual([0.5, 0]);
    expect(polarisers(1, [0, 45, 90])[2]).toBeCloseTo(1 / 8, 12);
    expect(polarisers(1, [0, 60])[1]).toBeCloseTo(0.125, 12);
  });

  it('colours the visible spectrum', () => {
    expect(wavelengthColour(650)).toEqual([255, 0, 0]);
    expect(wavelengthColour(530)[1]).toBe(255);
    expect(wavelengthColour(300)).toEqual([0, 0, 0]);
  });
});
