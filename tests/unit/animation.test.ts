import { getProject, types } from '@theatre/core';
import { describe, expect, it } from 'vitest';
import {
  type AnimProject,
  addObject,
  animate,
  animationHtml,
  type Curve,
  configSource,
  coreConfig,
  DEFAULTS,
  EASINGS,
  easingOf,
  emptyProject,
  hexToRgba,
  type Keyframe,
  moveKeyframe,
  objectStyle,
  PROPS,
  type PropValues,
  projectFile,
  RUNTIME_STYLE,
  readProjectFile,
  removeKeyframe,
  removeObject,
  renameObject,
  type ShapeKind,
  sampleProject,
  setEasing,
  setKeyframe,
  setLength,
  setStatic,
  stopAnimating,
  theatreStateFile,
  trackOf,
  valuesAt,
} from '../../src/lib/animation';

/** A small deterministic random source, so failures can be reproduced. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const KINDS: ShapeKind[] = ['box', 'ellipse', 'text', 'picture'];
let projectCount = 0;

/** Values from @theatre/core itself for every object at time t. */
async function coreValues(p: AnimProject, times: number[]) {
  projectCount += 1;
  const project = getProject(`Check ${projectCount}`, { state: JSON.parse(JSON.stringify(p.state)) });
  const sheet = project.sheet(p.sheet);
  const objects = p.objects.map((o) => ({ key: o.key, obj: sheet.object(o.key, coreConfig(o.kind, types)) }));
  await project.ready;
  return times.map((t) => {
    sheet.sequence.position = t;
    return Object.fromEntries(objects.map(({ key, obj }) => [key, obj.value as unknown as PropValues]));
  });
}

function expectSame(mine: PropValues, core: PropValues, where: string) {
  for (const spec of PROPS) {
    const a = core[spec.key] as unknown;
    const b = mine[spec.key] as unknown;
    if (spec.type === 'number') expect(b as number, `${where} ${spec.key}`).toBeCloseTo(a as number, 9);
    else for (const c of ['r', 'g', 'b', 'a'] as const) expect((b as Record<string, number>)[c], `${where} ${spec.key}.${c}`).toBeCloseTo((a as Record<string, number>)[c] as number, 9);
  }
}

describe('animation values match @theatre/core', () => {
  it('for the sample', async () => {
    const p = sampleProject();
    const times = [0, 0.1, 0.4, 0.8, 1.2, 1.37, 1.6, 2, 2.5, 3, 3.5];
    const core = await coreValues(p, times);
    times.forEach((t, i) => {
      for (const o of p.objects) expectSame(valuesAt(p, o.key, t), core[i]?.[o.key] as PropValues, `${o.key}@${t}`);
    });
  });

  it('for random keyframes, easings, holds and colours', async () => {
    for (let seed = 1; seed <= 12; seed++) {
      const r = random(seed);
      let p = setLength(emptyProject(`Random ${seed}`), 4);
      for (let i = 0; i < 3; i++) p = addObject(p, KINDS[Math.floor(r() * KINDS.length)] as ShapeKind, { key: `Thing ${seed} ${i}` }).project;
      for (const o of p.objects) {
        p = setStatic(p, o.key, 'rotation', Math.round(r() * 360));
        for (const spec of PROPS) {
          if (r() < 0.45) continue;
          const count = 1 + Math.floor(r() * 4);
          for (let k = 0; k < count; k++) {
            const t = Math.round(r() * 4 * 30) / 30;
            const value = spec.type === 'rgba' ? { r: r(), g: r(), b: r(), a: r() } : spec.key === 'opacity' ? r() * 1.4 - 0.2 : Math.round((r() * 2 - 0.5) * 800);
            p = setKeyframe(p, o.key, spec.key, t, value);
          }
          for (const k of trackOf(p, o.key, spec.key)?.keyframes ?? []) {
            const pick = r();
            if (pick < 0.15) p = setEasing(p, o.key, spec.key, k.id, 'hold');
            else if (pick < 0.7) p = setEasing(p, o.key, spec.key, k.id, Object.values(EASINGS)[Math.floor(r() * Object.keys(EASINGS).length)] as Curve);
            else p = setEasing(p, o.key, spec.key, k.id, [r(), r() * 2 - 0.5, r(), r() * 2 - 0.5]);
          }
        }
      }
      const times = [0, 4, 5, ...Array.from({ length: 30 }, () => Math.round(r() * 4.4 * 1000) / 1000)];
      // Exact keyframe times too.
      for (const o of p.objects) for (const spec of PROPS) for (const k of trackOf(p, o.key, spec.key)?.keyframes ?? []) times.push(k.position);
      const core = await coreValues(p, times);
      times.forEach((t, i) => {
        for (const o of p.objects) expectSame(valuesAt(p, o.key, t), core[i]?.[o.key] as PropValues, `seed ${seed} ${o.key}@${t}`);
      });
    }
  });

  it('for keyframes that do not connect to the next one', async () => {
    let p = addObject(setLength(emptyProject('Disconnected'), 2), 'box', { key: 'Box one' }).project;
    p = setKeyframe(p, 'Box one', 'x', 0, 10);
    p = setKeyframe(p, 'Box one', 'x', 1, 90);
    p = setKeyframe(p, 'Box one', 'x', 2, 50);
    // Theatre.js Studio writes connectedRight: false for a broken segment.
    const state = JSON.parse(JSON.stringify(p.state));
    const objectTracks = state.sheetsById.Scene.sequence.tracksByObject['Box one'];
    const id = objectTracks.trackIdByPropPath['["x"]'];
    objectTracks.trackData[id].keyframes[0].connectedRight = false;
    const broken = readProjectFile(JSON.stringify({ ...JSON.parse(projectFile(p)), state }));
    const times = [0, 0.5, 0.99, 1, 1.5, 2];
    const core = await coreValues(broken, times);
    for (const [i, t] of times.entries()) expectSame(valuesAt(broken, 'Box one', t), core[i]?.['Box one'] as PropValues, `@${t}`);
    expect(valuesAt(broken, 'Box one', 0.5).x).toBe(10);
  });
});

describe('editing', () => {
  const base = () => addObject(setLength(emptyProject('Editing'), 4), 'box', { key: 'Box one' }).project;

  it('keeps keyframes sorted, refuses collisions and turns static when the last one goes', () => {
    let p = base();
    p = setKeyframe(p, 'Box one', 'x', 2, 200);
    p = setKeyframe(p, 'Box one', 'x', 0.51, 50);
    p = setKeyframe(p, 'Box one', 'x', 1, 100);
    const ks = () => trackOf(p, 'Box one', 'x')?.keyframes as Keyframe[];
    // Times snap to the 30 fps grid.
    expect(ks().map((k) => k.position)).toEqual([0.5, 1, 2]);
    p = moveKeyframe(p, 'Box one', 'x', (ks()[2] as Keyframe).id, 1);
    expect(ks().map((k) => k.position)).toEqual([0.5, 1, 2]);
    p = moveKeyframe(p, 'Box one', 'x', (ks()[2] as Keyframe).id, 0.2);
    expect(ks().map((k) => k.value)).toEqual([200, 50, 100]);
    for (const k of [...ks()].slice(0, 2)) p = removeKeyframe(p, 'Box one', 'x', k.id);
    const last = ks()[0] as Keyframe;
    p = removeKeyframe(p, 'Box one', 'x', last.id);
    expect(trackOf(p, 'Box one', 'x')).toBeUndefined();
    expect(valuesAt(p, 'Box one', 3).x).toBe(100);
  });

  it('names easings and holds', () => {
    let p = base();
    p = setKeyframe(p, 'Box one', 'y', 0, 0);
    p = setKeyframe(p, 'Box one', 'y', 1, 100);
    const first = trackOf(p, 'Box one', 'y')?.keyframes[0] as Keyframe;
    expect(easingOf(p, 'Box one', 'y', first.id)).toBe('Smooth');
    p = setEasing(p, 'Box one', 'y', first.id, EASINGS['Ease out'] as Curve);
    expect(easingOf(p, 'Box one', 'y', first.id)).toBe('Ease out');
    p = setEasing(p, 'Box one', 'y', first.id, 'hold');
    expect(easingOf(p, 'Box one', 'y', first.id)).toBe('Hold');
    expect(valuesAt(p, 'Box one', 0.9).y).toBe(0);
    const second = trackOf(p, 'Box one', 'y')?.keyframes[1] as Keyframe;
    expect(easingOf(p, 'Box one', 'y', second.id)).toBe('');
  });

  it('animates, stops animating, renames and removes objects', () => {
    let p = base();
    p = setStatic(p, 'Box one', 'opacity', 0.25);
    p = animate(p, 'Box one', 'opacity', 0);
    p = setKeyframe(p, 'Box one', 'opacity', 2, 0.75);
    expect(valuesAt(p, 'Box one', 0).opacity).toBe(0.25);
    p = stopAnimating(p, 'Box one', 'opacity', 2);
    expect(trackOf(p, 'Box one', 'opacity')).toBeUndefined();
    expect(valuesAt(p, 'Box one', 0).opacity).toBe(0.75);
    p = setKeyframe(p, 'Box one', 'x', 1, 5);
    p = renameObject(p, 'Box one', 'Hero <block>!');
    expect(p.objects.map((o) => o.key)).toEqual(['Hero block']);
    expect(trackOf(p, 'Hero block', 'x')?.keyframes).toHaveLength(1);
    expect(valuesAt(p, 'Hero block', 0).opacity).toBe(0.75);
    p = removeObject(p, 'Hero block');
    expect(p.objects).toEqual([]);
    expect(p.state.sheetsById.Scene?.staticOverrides.byObject).toEqual({});
    expect(p.state.sheetsById.Scene?.sequence?.tracksByObject).toEqual({});
  });
});

describe('files and drawing', () => {
  it('reads its own files and bare Theatre.js states', () => {
    const p = sampleProject();
    expect(readProjectFile(projectFile(p))).toEqual(p);
    const bare = readProjectFile(theatreStateFile(p));
    expect(bare.objects.map((o) => o.key).sort()).toEqual(p.objects.map((o) => o.key).sort());
    expect(bare.objects.every((o) => o.kind === 'box')).toBe(true);
    expect(valuesAt(bare, 'Ball', 1.2).y).toBeCloseTo(valuesAt(p, 'Ball', 1.2).y as number, 9);
    expect(() => readProjectFile('{"sheetsById":{},"definitionVersion":"0.3.0"}')).toThrow(/0\.4\.0/);
    expect(() => readProjectFile('nope')).toThrow(/not JSON/);
  });

  it('writes the same configuration as code and as objects', () => {
    const fake = { number: (value: number, options?: unknown) => ({ number: value, options }), rgba: (value: unknown) => ({ rgba: value }) };
    for (const kind of KINDS) {
      const fromSource = new Function('types', `return ${configSource(kind)};`)(fake);
      expect(fromSource).toEqual(coreConfig(kind, fake));
    }
  });

  it('draws the same in the saved page as in the editor', () => {
    const runtime = new Function(`${RUNTIME_STYLE}; return objectStyle;`)() as typeof objectStyle;
    const r = random(7);
    for (let i = 0; i < 50; i++) {
      const kind = KINDS[i % 4] as ShapeKind;
      const v = {
        ...DEFAULTS[kind],
        x: r() * 1000 - 200,
        y: r() * 700,
        width: r() * 600 - 50,
        height: r() * 400,
        rotation: r() * 720 - 360,
        scale: r() * 3,
        opacity: r(),
        radius: r() * 80 - 10,
        fontSize: r() * 100,
        fill: hexToRgba('#336699', r()),
      } as PropValues;
      expect(runtime(kind, v)).toEqual(objectStyle(kind, v));
    }
  });

  it('makes a page that carries Theatre.js and closes every script', () => {
    const html = animationHtml(sampleProject(), { core: 'module.exports = { x: "</script>" };', dataverse: 'module.exports = {};' }, { loop: true });
    expect(html.match(/<\/script>/g)?.length).toBe(html.match(/<script/g)?.length);
    expect(html).toContain("load('@theatre/core')");
    expect(html).toContain('"loop":true');
  });
});
