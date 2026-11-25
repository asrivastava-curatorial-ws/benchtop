import { describe, expect, it } from 'vitest';
import {
  addCrank,
  addJoint,
  addLink,
  addSlider,
  derivative,
  designPose,
  EMPTY,
  fixedOnBar,
  fourBar,
  freedom,
  grashof,
  linkLengths,
  type Pose,
  plates,
  readMechanism,
  removeJoint,
  removeLink,
  setLinkLength,
  strokeOf,
  sweep,
  TEMPLATES,
  transmissionAngle,
} from '../../src/lib/linkage';

const make = (name: string) => {
  const t = TEMPLATES[name];
  if (!t) throw new Error(name);
  return t();
};
const xs = (poses: readonly Pose[], id: string) => poses.map((p) => p[id]?.[0] ?? Number.NaN);
const ys = (poses: readonly Pose[], id: string) => poses.map((p) => p[id]?.[1] ?? Number.NaN);
const span = (v: number[]) => Math.max(...v) - Math.min(...v);

describe('linkages', () => {
  it('every template is fully driven and runs a whole cycle without locking', () => {
    for (const name of Object.keys(TEMPLATES)) {
      const m = make(name);
      expect(freedom(m), name).toBe(0);
      const s = sweep(m, 120);
      expect(s.lockedAt, name).toBeNull();
      expect(s.poses).toHaveLength(121);
      // Links keep their lengths all the way round.
      const lengths = linkLengths(m);
      for (const pose of s.poses)
        for (const l of m.links) {
          const a = pose[l.a];
          const b = pose[l.b];
          if (a && b) expect(Math.hypot(a[0] - b[0], a[1] - b[1]), `${name} ${l.id}`).toBeCloseTo(lengths.get(l.id) ?? 0, 5);
        }
    }
  });

  it('checks Grashof’s condition', () => {
    expect(grashof([60, 180, 140, 200]).turns).toBe(true);
    expect(grashof([100, 300, 150, 140]).turns).toBe(false);
  });

  it('slider-crank stroke, Scotch yoke motion and quick return', () => {
    const slider = sweep(make('Slider-crank (engine)'), 180);
    expect(span(xs(slider.poses, 'B'))).toBeCloseTo(140, 3);
    const yoke = sweep(make('Scotch yoke'), 72);
    yoke.poses.forEach((p, i) => {
      expect((p.Y1?.[0] ?? 0) - 250).toBeCloseTo(70 * Math.cos((2 * Math.PI * i) / 72), 5);
    });
    const quick = sweep(make('Quick return (crank and slotted lever)'), 360);
    const x = xs(quick.poses, 'R');
    let forward = 0;
    let back = 0;
    for (let i = 1; i < x.length; i++) {
      const dx = (x[i] ?? 0) - (x[i - 1] ?? 0);
      if (dx > 0) forward++;
      else if (dx < 0) back++;
    }
    expect(Math.max(forward, back) / Math.min(forward, back)).toBeGreaterThan(1.3);
  });

  it('Peaucellier–Lipkin draws an exact straight line; Jansen’s foot lifts', () => {
    const pl = sweep(make('Peaucellier–Lipkin (exact straight line)'), 90);
    expect(span(xs(pl.poses, 'P'))).toBeLessThan(1e-4);
    expect(span(ys(pl.poses, 'P'))).toBeGreaterThan(40);
    const leg = sweep(make('Jansen’s leg (Strandbeest)'), 120);
    expect(span(ys(leg.poses, 'H'))).toBeGreaterThan(40);
    expect(designPose(make('Jansen’s leg (Strandbeest)')).H?.[1]).toBeGreaterThan(300);
  });

  it('names four-bars by Grashof’s rule and finds the transmission angle', () => {
    const m = make('Four-bar (crank and rocker)');
    const f = fourBar(m);
    expect(f?.kind).toBe('crank–rocker');
    expect(f?.lengths.crank).toBeCloseTo(60, 6);
    const s = sweep(m, 90);
    const mu = s.poses.map((p) => (f ? transmissionAngle(f, p) : Number.NaN));
    expect(Math.min(...mu)).toBeGreaterThan(0);
    expect(Math.max(...mu)).toBeLessThan(180);
    expect(fourBar(make('Slider-crank (engine)'))).toBeNull();
    expect(plates(m)).toEqual([['A', 'B', 'C']]);
  });

  it('measures stroke and time ratio', () => {
    const slider = sweep(make('Slider-crank (engine)'), 360);
    const b = strokeOf(
      slider.poses.map((p) => p.B ?? [0, 0]),
      slider.angles,
    );
    expect(b?.length).toBeCloseTo(140, 3);
    expect(b?.ratio).toBeCloseTo(1, 2);
    const quick = sweep(make('Quick return (crank and slotted lever)'), 360);
    const r = strokeOf(
      quick.poses.map((p) => p.R ?? [0, 0]),
      quick.angles,
    );
    expect(r?.ratio).toBeGreaterThan(1.3);
    expect(Math.abs(r?.axis[0] ?? 0)).toBeCloseTo(1, 6);
  });

  it('differentiates periodic and open signals', () => {
    const n = 360;
    const dt = (2 * Math.PI) / n;
    const v = Array.from({ length: n + 1 }, (_, i) => Math.sin(i * dt));
    derivative(v, dt, true).forEach((d, i) => {
      expect(d).toBeCloseTo(Math.cos(i * dt), 3);
    });
    expect(derivative([0, 1, 4, 9], 1, false)).toEqual([1, 2, 4, 5]);
  });

  it('builds a four-bar from clicks, then edits and reads it back', () => {
    const [m1, o2] = addJoint(EMPTY, 0, 0, true);
    const [m2, o4] = addJoint(m1, 200, 0, true);
    const [m3, a] = addJoint(m2, 60, 0, false);
    let [m, b] = addJoint(m3, 200, -150, false);
    expect([o2, o4, a, b]).toEqual(['G1', 'G2', 'J1', 'J2']);
    m = addCrank(m, o2, a, 30);
    m = addLink(m, a, b);
    m = addLink(m, a, b);
    m = addLink(m, o4, b);
    expect(m.links).toHaveLength(3);
    expect(freedom(m)).toBe(0);
    expect(sweep(m, 60).lockedAt).toBeNull();
    expect(fixedOnBar(make('Hoekens straight-line linkage'), make('Hoekens straight-line linkage').sliders[0] ?? { id: '', joint: '', a: '', b: '' })).toBe(true);
    const slider = make('Slider-crank (engine)');
    expect(fixedOnBar(slider, slider.sliders[0] ?? { id: '', joint: '', a: '', b: '' })).toBe(false);
    const longer = setLinkLength(m, m.links[2]?.id ?? '', 160);
    expect(linkLengths(longer).get(m.links[2]?.id ?? '')).toBeCloseTo(160, 9);
    expect(removeLink(m, m.links[0]?.id ?? '').cranks).toHaveLength(0);
    const gone = removeJoint(addSlider(m, b, o2, o4), a);
    expect(gone.links.map((l) => [l.a, l.b])).toEqual([[o4, b]]);
    expect(gone.cranks).toHaveLength(0);
    expect(gone.sliders).toHaveLength(1);
    expect(readMechanism(JSON.parse(JSON.stringify(m)))).toEqual(m);
    expect(readMechanism({ joints: [{ id: 'A' }] })).toBeNull();
    expect(readMechanism({ joints: [{ id: 'A', x: 0, y: 0 }], links: [{ id: 'L1', a: 'A', b: 'Z' }] })?.links).toEqual([]);
  });
});
