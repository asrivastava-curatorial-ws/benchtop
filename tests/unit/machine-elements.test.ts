import { describe, expect, it } from 'vitest';
import {
  type CamDesign,
  type CamSegment,
  camProfile,
  checkCam,
  followerAt,
  geneva,
  genevaAt,
  law,
  type MotionLaw,
  parseTrain,
  planetaryProblems,
  planetarySpeeds,
  programProblems,
  trainRatio,
} from '../../src/lib/machine-elements';

const LAWS: MotionLaw[] = ['uniform', 'shm', 'parabolic', 'cycloidal', 'poly345', 'poly4567'];
const PROGRAM: CamSegment[] = [
  { kind: 'rise', angle: 120, law: 'cycloidal' },
  { kind: 'dwell', angle: 60, law: 'cycloidal' },
  { kind: 'return', angle: 120, law: 'shm' },
  { kind: 'dwell', angle: 60, law: 'shm' },
];

describe('cams', () => {
  it('motion laws run from 0 to 1 with consistent derivatives', () => {
    for (const kind of LAWS) {
      expect(law(kind, 0)[0], kind).toBeCloseTo(0, 12);
      expect(law(kind, 1)[0], kind).toBeCloseTo(1, 12);
      for (const t of [0.13, 0.37, 0.61, 0.88]) {
        const h = 1e-6;
        const [, f1, f2] = law(kind, t);
        expect(f1, `${kind} f′ at ${t}`).toBeCloseTo((law(kind, t + h)[0] - law(kind, t - h)[0]) / (2 * h), 5);
        expect(f2, `${kind} f″ at ${t}`).toBeCloseTo((law(kind, t + h)[1] - law(kind, t - h)[1]) / (2 * h), 3);
      }
    }
    // Cycloidal and polynomial laws start and stop without a jump in acceleration.
    for (const kind of ['cycloidal', 'poly345', 'poly4567'] as const) expect(law(kind, 0)[2], kind).toBeCloseTo(0, 12);
  });

  it('follows a rise-dwell-return-dwell program', () => {
    expect(programProblems(PROGRAM)).toEqual([]);
    expect(followerAt(PROGRAM, 20, 0).y).toBeCloseTo(0, 9);
    expect(followerAt(PROGRAM, 20, 60).y).toBeCloseTo(10, 9);
    expect(followerAt(PROGRAM, 20, 150).y).toBeCloseTo(20, 9);
    expect(followerAt(PROGRAM, 20, 150).v).toBe(0);
    expect(followerAt(PROGRAM, 20, 240).y).toBeCloseTo(10, 9);
    expect(followerAt(PROGRAM, 20, 330).y).toBeCloseTo(0, 9);
    expect(programProblems([{ kind: 'rise', angle: 100, law: 'shm' }])).toHaveLength(2);
  });

  it('draws the profile and checks pressure angle and undercutting', () => {
    const design: CamDesign = { segments: PROGRAM, h: 20, base: 40, roller: 8, offset: 0, follower: 'roller' };
    const profile = camProfile(design, 360);
    // On the dwells the cam is its base circle.
    for (const p of profile.filter((q) => q.theta > 305 && q.theta < 355)) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(40, 6);
      expect(p.pressure).toBeCloseTo(0, 9);
    }
    for (const p of profile.filter((q) => q.theta > 125 && q.theta < 175)) expect(Math.hypot(p.x, p.y)).toBeCloseTo(60, 6);
    const ok = checkCam(design, profile);
    expect(ok.undercut).toBe(false);
    expect(ok.maxPressure).toBeGreaterThan(10);
    expect(ok.maxPressure).toBeLessThan(40);
    const sharp: CamDesign = { ...design, h: 60, base: 15, roller: 14, segments: PROGRAM.map((s) => ({ ...s, angle: s.kind === 'dwell' ? 150 : 30 })) };
    expect(checkCam(sharp, camProfile(sharp, 720)).undercut).toBe(true);
    const flat: CamDesign = { ...design, follower: 'flat' };
    const flatProfile = camProfile(flat, 360);
    expect(Math.hypot(flatProfile[0]?.x ?? 0, flatProfile[0]?.y ?? 0)).toBeCloseTo(40, 6);
    expect(checkCam(flat, flatProfile).faceWidth).toBeGreaterThan(0);
  });
});

describe('Geneva drive and gear trains', () => {
  it('indexes a four-slot Geneva wheel a quarter turn with shockless entry', () => {
    const g = geneva(4, 50);
    expect(g.centres).toBeCloseTo(70.711, 3);
    expect(g.indexing).toBeCloseTo(0.25, 12);
    const l = Math.SQRT1_2;
    expect(genevaAt(g, 0).velocity).toBeCloseTo(l / (1 - l), 9);
    expect(genevaAt(g, g.engage).velocity).toBeCloseTo(0, 9);
    expect(genevaAt(g, g.engage).beta).toBeCloseTo(Math.PI / 4, 9);
    expect(genevaAt(g, Math.PI).engaged).toBe(false);
  });

  it('works out compound and planetary ratios', () => {
    const train = trainRatio(parseTrain('20-40, 15-45'));
    expect(train.ratio).toBeCloseTo(6, 12);
    expect(train.reverses).toBe(false);
    expect(trainRatio(parseTrain('20-40')).reverses).toBe(true);
    expect(trainRatio(parseTrain('20-60i')).reverses).toBe(false);
    expect(() => parseTrain('20 to 40')).toThrow(/not a gear pair/);
    const set = { sun: 24, ring: 72, planet: 24, planets: 3 };
    expect(planetaryProblems(set)).toEqual([]);
    expect(planetarySpeeds(set, 'ring', 'sun', 1000).carrier).toBeCloseTo(250, 9);
    expect(planetarySpeeds(set, 'carrier', 'sun', 1000).ring).toBeCloseTo(-1000 / 3, 9);
    expect(planetarySpeeds(set, 'sun', 'carrier', 1000).ring).toBeCloseTo(4000 / 3, 9);
    expect(planetaryProblems({ ...set, planets: 5 })).toHaveLength(1);
  });
});
