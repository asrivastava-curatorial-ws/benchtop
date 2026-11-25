import { describe, expect, it } from 'vitest';
import {
  angleAt,
  applyAffine,
  conic,
  conicPoint,
  determinant,
  dist,
  enlargement,
  exactTrig,
  interiorAngles,
  isConvex,
  reflection,
  regularPolygon,
  rotation,
  selfCrossing,
  shear,
  signedArea,
  triangle,
} from '../../src/lib/geometry-lab';

describe('geometry lab', () => {
  it('finds a triangle’s centres and keeps Euler’s line', () => {
    const t = triangle([0, 0], [4, 0], [0, 3]);
    expect(t).not.toBeNull();
    if (!t) return;
    expect(t.sides).toEqual([5, 3, 4]);
    expect(t.angles[0]).toBeCloseTo(90, 9);
    expect(t.area).toBe(6);
    expect(t.kind).toBe('scalene, right-angled');
    // The circumcentre of a right triangle is the middle of its hypotenuse.
    expect(t.O[0]).toBeCloseTo(2, 12);
    expect(t.O[1]).toBeCloseTo(1.5, 12);
    expect(t.R).toBeCloseTo(2.5, 12);
    expect(t.r).toBeCloseTo(1, 12);
    expect(t.I[0]).toBeCloseTo(1, 12);
    expect(t.H[0]).toBeCloseTo(0, 12);
    expect(t.H[1]).toBeCloseTo(0, 12);
    // G lies a third of the way from O to H.
    const s = triangle([1, 2], [7, 1], [3, 6]);
    if (!s) throw new Error('degenerate');
    expect(dist(s.O, s.G) * 2).toBeCloseTo(dist(s.G, s.H), 9);
    expect(s.angles.reduce((a, b) => a + b, 0)).toBeCloseTo(180, 9);
    expect(triangle([0, 0], [1, 1], [2, 2])).toBeNull();
    expect(triangle([0, 0], [2, 0], [1, Math.sqrt(3)])?.kind).toBe('equilateral, acute');
  });

  it('measures polygons', () => {
    const hex = regularPolygon(6, [0, 0], 1);
    expect(signedArea(hex)).toBeCloseTo((3 * Math.sqrt(3)) / 2, 12);
    interiorAngles(hex).forEach((a) => {
      expect(a).toBeCloseTo(120, 9);
    });
    expect(isConvex(hex)).toBe(true);
    const dart: [number, number][] = [
      [0, 0],
      [4, 0],
      [2, 1],
      [2, 4],
    ];
    expect(isConvex(dart)).toBe(false);
    expect(interiorAngles(dart).reduce((a, b) => a + b, 0)).toBeCloseTo(360, 9);
    expect(
      selfCrossing([
        [0, 0],
        [2, 2],
        [2, 0],
        [0, 2],
      ]),
    ).toBe(true);
    expect(selfCrossing(hex)).toBe(false);
  });

  it('measures angles', () => {
    expect(angleAt([0, 0], [1, 0], [0, 1])).toBeCloseTo(90, 12);
    expect(angleAt([0, 0], [1, 0], [-1, 0])).toBeCloseTo(180, 12);
  });

  it('transforms shapes', () => {
    const r = rotation(90, [1, 1]);
    const p = applyAffine(r, [2, 1]);
    expect(p[0]).toBeCloseTo(1, 12);
    expect(p[1]).toBeCloseTo(2, 12);
    expect(determinant(r)).toBeCloseTo(1, 12);
    expect(r.m).toEqual([0, -1, 1, 0]);
    const m = applyAffine(reflection(45, [0, 0]), [3, 1]);
    expect(m[0]).toBeCloseTo(1, 12);
    expect(m[1]).toBeCloseTo(3, 12);
    expect(determinant(reflection(30, [0, 0]))).toBeCloseTo(-1, 12);
    expect(applyAffine(enlargement(-2, [1, 0]), [2, 0])).toEqual([-1, 0]);
    expect(determinant(enlargement(3, [0, 0]))).toBe(9);
    expect(determinant(shear(2, 0, [0, 0]))).toBe(1);
  });

  it('draws conics from focus and directrix', () => {
    expect(conic(0.5, 3).kind).toBe('ellipse');
    expect(conic(1, 3).kind).toBe('parabola');
    expect(conic(2, 3).kind).toBe('hyperbola');
    // Every point is e times as far from the focus as from the directrix x = p.
    for (const e of [0.5, 1, 1.8])
      for (const t of [0.3, 1.2, 2]) {
        const q = conicPoint(e, 3, t);
        if (q) expect(Math.hypot(q[0], q[1])).toBeCloseTo(e * (3 - q[0]), 9);
      }
    const el = conic(0.6, 4);
    expect(el.a).toBeCloseTo(2.4 / 0.64, 12);
    expect(el.b).toBeCloseTo(el.a * 0.8, 12);
    expect(conicPoint(1, 3, Math.PI)).toBeNull();
  });

  it('gives exact values on the unit circle', () => {
    expect(exactTrig(30)).toEqual({ sin: '1/2', cos: '√3/2', tan: '√3/3' });
    expect(exactTrig(150)).toEqual({ sin: '1/2', cos: '−√3/2', tan: '−√3/3' });
    expect(exactTrig(225)).toEqual({ sin: '−√2/2', cos: '−√2/2', tan: '1' });
    expect(exactTrig(270)).toEqual({ sin: '−1', cos: '0', tan: 'undefined' });
    expect(exactTrig(180)).toEqual({ sin: '0', cos: '−1', tan: '0' });
    expect(exactTrig(20)).toBeNull();
  });
});
