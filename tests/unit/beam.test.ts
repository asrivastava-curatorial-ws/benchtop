import { describe, expect, it } from 'vitest';
import { analyseBeam, type Beam, BeamError } from '../../src/lib/beam/beam';
import { SectionError, sectionProperties } from '../../src/lib/beam/sections';

const EI = 1e7;
const L = 6;
const w = 10_000;
const P = 20_000;
const rel = (actual: number, expected: number, tolerance = 1e-6) => expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThan(tolerance);
const beam = (supports: Beam['supports'], loads: Beam['loads'], length = L): Beam => ({ length, EI, supports, loads });
const ss = [
  { kind: 'pin', x: 0 },
  { kind: 'roller', x: L },
] as const;
const udl = { kind: 'distributed', x1: 0, x2: L, w1: w, w2: w } as const;

describe('beam analysis against textbook formulas', () => {
  it('simply supported with a uniform load', () => {
    const r = analyseBeam(beam(ss, [udl]));
    rel(r.reactions[0]?.force ?? 0, (w * L) / 2);
    rel(r.reactions[1]?.force ?? 0, (w * L) / 2);
    rel(r.maxMoment.value, (w * L * L) / 8);
    expect(r.maxMoment.x).toBeCloseTo(3, 6);
    rel(-r.maxDeflection.value, (5 * w * L ** 4) / (384 * EI));
    rel(r.maxShear.value * Math.sign(r.maxShear.value), (w * L) / 2);
  });

  it('simply supported with an off-centre point load', () => {
    const r = analyseBeam(beam(ss, [{ kind: 'point', x: 2, P }]));
    rel(r.reactions[0]?.force ?? 0, (P * 4) / 6);
    rel(r.maxMoment.value, (P * 2 * 4) / 6);
    const a = 2;
    rel(-r.maxDeflection.value, (P * a * (L * L - a * a) ** 1.5) / (9 * Math.sqrt(3) * L * EI), 1e-5);
    expect(r.maxDeflection.x).toBeCloseTo(L - Math.sqrt((L * L - a * a) / 3), 2);
  });

  it('cantilevers with an end load and a uniform load', () => {
    const fixed = [{ kind: 'fixed', x: 0 }] as const;
    const end = analyseBeam(beam(fixed, [{ kind: 'point', x: L, P }]));
    rel(-end.maxDeflection.value, (P * L ** 3) / (3 * EI));
    rel(end.reactions[0]?.moment ?? 0, P * L);
    rel(end.minMoment.value, -P * L);
    const spread = analyseBeam(beam(fixed, [udl]));
    rel(-spread.maxDeflection.value, (w * L ** 4) / (8 * EI));
    rel(spread.minMoment.value, (-w * L * L) / 2);
  });

  it('fixed at both ends and propped cantilevers', () => {
    const both = analyseBeam(
      beam(
        [
          { kind: 'fixed', x: 0 },
          { kind: 'fixed', x: L },
        ],
        [udl],
      ),
    );
    rel(both.minMoment.value, (-w * L * L) / 12);
    rel(both.maxMoment.value, (w * L * L) / 24);
    rel(-both.maxDeflection.value, (w * L ** 4) / (384 * EI));
    const propped = analyseBeam(
      beam(
        [
          { kind: 'fixed', x: 0 },
          { kind: 'roller', x: L },
        ],
        [udl],
      ),
    );
    rel(propped.reactions[1]?.force ?? 0, (3 * w * L) / 8);
    rel(propped.minMoment.value, (-w * L * L) / 8);
    rel(propped.maxMoment.value, (9 * w * L * L) / 128);
    rel(-propped.maxDeflection.value, ((39 + 55 * Math.sqrt(33)) / 65536) * ((w * L ** 4) / EI), 1e-5);
  });

  it('continuous beams, triangular loads and applied moments', () => {
    const two = analyseBeam(
      beam(
        [
          { kind: 'pin', x: 0 },
          { kind: 'roller', x: 3 },
          { kind: 'roller', x: 6 },
        ],
        [udl],
      ),
    );
    rel(two.reactions[0]?.force ?? 0, 0.375 * w * 3);
    rel(two.reactions[1]?.force ?? 0, 1.25 * w * 3);
    rel(two.minMoment.value, (-w * 9) / 8);
    const triangle = analyseBeam(beam(ss, [{ kind: 'distributed', x1: 0, x2: L, w1: 0, w2: w }]));
    rel(triangle.reactions[0]?.force ?? 0, (w * L) / 6);
    rel(triangle.reactions[1]?.force ?? 0, (w * L) / 3);
    rel(triangle.maxMoment.value, (w * L * L) / (9 * Math.sqrt(3)), 1e-4);
    const couple = analyseBeam(beam(ss, [{ kind: 'moment', x: 3, M: 12_000 }]));
    rel(couple.reactions[0]?.force ?? 0, -2000);
    rel(couple.reactions[1]?.force ?? 0, 2000);
    rel(couple.maxMoment.value, 6000);
    rel(couple.minMoment.value, -6000);
  });

  it('refuses beams that are not held', () => {
    expect(() => analyseBeam(beam([{ kind: 'pin', x: 0 }], [udl]))).toThrow(BeamError);
    expect(() => analyseBeam(beam([{ kind: 'pin', x: 9 }], [udl]))).toThrow(BeamError);
  });
});

describe('section properties', () => {
  it('rectangles, round bars, tubes and boxes match closed forms', () => {
    const rect = sectionProperties('rectangle', { b: 100, h: 200 });
    rel(rect.area, 20000);
    rel(rect.Ix, (100 * 200 ** 3) / 12);
    rel(rect.Iy, (200 * 100 ** 3) / 12);
    rel(rect.SxTop, (100 * 200 ** 2) / 6);
    rel(rect.Zx, (100 * 200 ** 2) / 4);
    rel(rect.J, 0.22888 * 200 * 100 ** 3, 1e-4);
    const bar = sectionProperties('circle', { d: 50 });
    rel(bar.Ix, (Math.PI * 50 ** 4) / 64);
    rel(bar.Zx, 50 ** 3 / 6);
    rel(bar.J, (Math.PI * 50 ** 4) / 32);
    const tube = sectionProperties('tube', { d: 114.3, t: 4.5 });
    rel(tube.area, (Math.PI * (114.3 ** 2 - 105.3 ** 2)) / 4);
    rel(tube.Ix, (Math.PI * (114.3 ** 4 - 105.3 ** 4)) / 64);
    const box = sectionProperties('box', { b: 100, h: 200, t: 6 });
    rel(box.area, 100 * 200 - 88 * 188);
    rel(box.Ix, (100 * 200 ** 3 - 88 * 188 ** 3) / 12);
    rel(box.Zx, (100 * 200 ** 2 - 88 * 188 ** 2) / 4);
  });

  it('I-beams, angles and tees', () => {
    const i = sectionProperties('ibeam', { b: 125, h: 250, tf: 12.5, tw: 6.9 });
    rel(i.area, 4677.5);
    rel(i.Ix, (125 * 250 ** 3 - (125 - 6.9) * 225 ** 3) / 12);
    rel(i.cy, 125);
    const angle = sectionProperties('angle', { b: 75, h: 75, t: 8 });
    rel(angle.area, 1136);
    rel(angle.cx, (600 * 37.5 + 536 * 4) / 1136);
    rel(angle.Ix, angle.Iy);
    expect(angle.angle).toBeCloseTo(45, 9);
    expect(angle.I1 + angle.I2).toBeCloseTo(angle.Ix + angle.Iy, 3);
    const tee = sectionProperties('tee', { b: 150, h: 150, tf: 12, tw: 10 });
    rel(tee.Zx, 150 * 10.6 * 5.3 + 150 * 1.4 * 0.7 + 1380 * (1.4 + 69), 1e-6);
    expect(() => sectionProperties('ibeam', { b: 100, h: 20, tf: 12, tw: 6 })).toThrow(SectionError);
  });
});
