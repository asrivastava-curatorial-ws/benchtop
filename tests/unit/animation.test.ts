import { getProject, types } from '@theatre/core';
import { describe, expect, it } from 'vitest';
import {
  type AnimProject,
  addClip,
  addObject,
  animate,
  animationHtml,
  type Curve,
  childrenOf,
  clearPath,
  clipTime,
  configSource,
  coreConfig,
  DEFAULTS,
  descendantsOf,
  EASINGS,
  easingOf,
  emptyProject,
  hexToRgba,
  type Keyframe,
  localPoint,
  moveKeyframe,
  objectStyle,
  onPath,
  PROPS,
  type PropValues,
  pathTable,
  pointOnPath,
  presetPath,
  projectFile,
  pruneClips,
  RUNTIME_MOTION,
  RUNTIME_STYLE,
  readProjectFile,
  removeKeyframe,
  removeObject,
  removeTree,
  renameObject,
  reorderObject,
  type ShapeKind,
  sampleProject,
  setEasing,
  setKeyframe,
  setLength,
  setParent,
  setStatic,
  smoothPath,
  stopAnimating,
  theatreStateFile,
  trackOf,
  updateObject,
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

const KINDS: ShapeKind[] = ['box', 'ellipse', 'text', 'picture', 'group', 'clip'];
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
      const kind = KINDS[i % KINDS.length] as ShapeKind;
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

describe('motion paths, groups and clips', () => {
  it('finds places along a path by distance, and the direction there', () => {
    const table = pathTable('M0 0L100 0L100 50');
    expect(table.total).toBe(150);
    expect(pointOnPath(table, 0)).toEqual({ x: 0, y: 0, angle: 0 });
    expect(pointOnPath(table, 0.5)).toEqual({ x: 75, y: 0, angle: 0 });
    expect(pointOnPath(table, 1)).toEqual({ x: 100, y: 50, angle: 90 });
    expect(pointOnPath(table, 7)).toEqual({ x: 100, y: 50, angle: 90 });
    expect(pointOnPath(pathTable('not a path'), 0.5)).toBeNull();
    // A circle of radius r is 2πr long, and every point on it is r from the middle.
    const circle = pathTable(presetPath('circle', 1280, 720));
    expect(circle.total).toBeCloseTo(2 * Math.PI * 252, 0);
    for (const progress of [0, 0.13, 0.5, 0.77, 1]) {
      const place = pointOnPath(circle, progress);
      expect(Math.hypot((place?.x ?? 0) - 640, (place?.y ?? 0) - 360)).toBeCloseTo(252, 0);
    }
    expect(
      pathTable(
        smoothPath([
          [0, 0],
          [100, 100],
          [200, 0],
        ]),
      ).total,
    ).toBeGreaterThan(283);
  });

  it('puts an object on its path and turns it when it follows', () => {
    let p = addObject(emptyProject(), 'box', { key: 'Car', path: 'M0 100L200 100L200 300', follow: true }).project;
    p = setKeyframe(p, 'Car', 'progress', 0, 0);
    p = setKeyframe(p, 'Car', 'progress', 4, 1);
    const car = p.objects[0];
    const at = (t: number) => onPath(car, valuesAt(p, 'Car', t));
    expect([at(0).x, at(0).y, at(0).rotation]).toEqual([0, 100, 0]);
    const end = at(4);
    expect([end.x, end.y, end.rotation]).toEqual([200, 300, 90]);
    expect(onPath({ path: 'M0 100L200 100', follow: false }, valuesAt(p, 'Car', 4)).rotation).toBe(0);
    expect(onPath(undefined, valuesAt(p, 'Car', 0)).x).toBe(640);
  });

  it('has the same path and clip arithmetic in the saved page', () => {
    const runtime = new Function(`${RUNTIME_MOTION}; return { pointOnPath, clipTime };`)() as { pointOnPath: typeof pointOnPath; clipTime: typeof clipTime };
    const table = pathTable(presetPath('eight', 1280, 720));
    const r = random(11);
    for (let i = 0; i < 40; i++) {
      const progress = r() * 1.4 - 0.2;
      expect(runtime.pointOnPath(table, progress)).toEqual(pointOnPath(table, progress));
      const clip = { start: r() * 2, speed: 0.5 + r() * 2, loop: i % 2 === 0 };
      const t = r() * 12 - 1;
      expect(runtime.clipTime(clip, t, 3)).toBeCloseTo(clipTime(clip, t, 3), 12);
    }
    expect(clipTime({ start: 1, speed: 2 }, 0, 3)).toBe(0);
    expect(clipTime({ start: 1, speed: 2 }, 2, 3)).toBe(2);
    expect(clipTime({ start: 1, speed: 2 }, 9, 3)).toBe(3);
    expect(clipTime({ start: 0, loop: true }, 7, 3)).toBe(1);
  });

  it('moves objects into and out of groups without moving them on the stage', () => {
    let p = emptyProject();
    p = addObject(p, 'group', { key: 'Wagon' }).project;
    p = setStatic(p, 'Wagon', 'x', 300);
    p = setStatic(p, 'Wagon', 'y', 200);
    p = addObject(p, 'box', { key: 'Wheel', path: 'M100 100L200 100' }).project;
    p = setStatic(p, 'Wheel', 'x', 350);
    p = setKeyframe(p, 'Wheel', 'y', 0, 260);
    p = setKeyframe(p, 'Wheel', 'y', 2, 300);
    const inside = setParent(p, 'Wheel', 'Wagon');
    expect(childrenOf(inside, 'Wagon').map((o) => o.key)).toEqual(['Wheel']);
    expect(childrenOf(inside, undefined).map((o) => o.key)).toEqual(['Wagon']);
    expect([valuesAt(inside, 'Wheel', 0).x, valuesAt(inside, 'Wheel', 0).y, valuesAt(inside, 'Wheel', 2).y]).toEqual([50, 60, 100]);
    expect(inside.objects.find((o) => o.key === 'Wheel')?.path).toBe('M-200 -100L-100 -100');
    // Only groups hold things, and not themselves.
    expect(setParent(p, 'Wagon', 'Wheel')).toBe(p);
    expect(setParent(p, 'Wagon', 'Wagon')).toBe(p);
    // Renaming the group keeps its members; removing it sets them free where they were.
    const renamed = renameObject(inside, 'Wagon', 'Cart');
    expect(renamed.objects.find((o) => o.key === 'Wheel')?.parent).toBe('Cart');
    const freed = removeObject(renamed, 'Cart');
    expect(freed.objects.map((o) => [o.key, o.parent])).toEqual([['Wheel', undefined]]);
    expect([valuesAt(freed, 'Wheel', 0).x, valuesAt(freed, 'Wheel', 2).y]).toEqual([350, 300]);
    expect(freed.objects[0]?.path).toBe('M100 100L200 100');
  });

  it('measures places inside moved, turned and scaled groups', () => {
    let p = addObject(emptyProject(), 'group', { key: 'Outer' }).project;
    p = setStatic(p, 'Outer', 'x', 100);
    p = setStatic(p, 'Outer', 'y', 50);
    p = setStatic(p, 'Outer', 'rotation', 90);
    p = addObject(p, 'group', { key: 'Inner' }).project;
    p = setParent(p, 'Inner', 'Outer');
    p = setStatic(p, 'Inner', 'x', 10);
    p = setStatic(p, 'Inner', 'y', 0);
    p = setStatic(p, 'Inner', 'scale', 2);
    expect(localPoint(p, undefined, 7, 9, 0)).toEqual({ x: 7, y: 9 });
    const tidy = (place: { x: number; y: number }) => [place.x, place.y].map((n) => Math.round(n * 1e6) / 1e6 + 0);
    // Outer is turned a quarter: a step down the stage is a step along its own x.
    const inOuter = localPoint(p, 'Outer', 100, 60, 0);
    expect(tidy(inOuter)).toEqual([10, 0]);
    // Inner sits at (10, 0) of Outer at double size: 20 further along Outer is 10 inside Inner.
    const inInner = localPoint(p, 'Inner', 100, 80, 0);
    expect(tidy(inInner)).toEqual([10, 0]);
    const moved = localPoint(p, 'Inner', 0, 20, 0, false);
    expect(tidy(moved)).toEqual([10, 0]);
  });

  it('removes a group with everything in it, and takes objects off their paths', () => {
    let p = addObject(emptyProject(), 'group', { key: 'Set' }).project;
    p = addObject(p, 'group', { key: 'Props' }).project;
    p = setParent(p, 'Props', 'Set');
    p = addObject(p, 'box', { key: 'Chair' }).project;
    p = setParent(p, 'Chair', 'Props');
    p = addObject(p, 'ellipse', { key: 'Lamp', path: 'M0 0L50 0', follow: true }).project;
    p = setKeyframe(p, 'Lamp', 'progress', 0, 0);
    p = setKeyframe(p, 'Lamp', 'progress', 2, 1);
    const clip = addClip(p, sampleProject(), 'Sting');
    p = setParent(clip.project, clip.key, 'Set');
    expect(descendantsOf(p, 'Set').map((o) => o.key)).toEqual(['Props', 'Chair', 'Sting']);
    const gone = removeTree(p, 'Set');
    expect(gone.objects.map((o) => o.key)).toEqual(['Lamp']);
    expect(gone.clips).toBeUndefined();
    expect(Object.keys(gone.state.sheetsById[gone.sheet]?.staticOverrides.byObject ?? {})).toEqual(['Lamp']);
    const free = clearPath(gone, 'Lamp');
    expect(free.objects[0]).toEqual({ kind: 'ellipse', key: 'Lamp' });
    expect(trackOf(free, 'Lamp', 'progress')).toBeUndefined();
    expect(clearPath(free, 'Lamp')).toBe(free);
    // Drawing order is among siblings: stepping skips members of other groups.
    let q = addObject(emptyProject(), 'box', { key: 'Alpha' }).project;
    q = addObject(q, 'group', { key: 'Gang' }).project;
    q = addObject(q, 'box', { key: 'Member' }).project;
    q = setParent(q, 'Member', 'Gang');
    q = addObject(q, 'box', { key: 'Beta' }).project;
    expect(reorderObject(q, 'Beta', -1).objects.map((o) => o.key)).toEqual(['Alpha', 'Beta', 'Member', 'Gang']);
    expect(reorderObject(q, 'Alpha', 1).objects.map((o) => o.key)).toEqual(['Gang', 'Alpha', 'Member', 'Beta']);
    expect(reorderObject(q, 'Member', 1)).toBe(q);
    expect(reorderObject(q, 'Alpha', -1)).toBe(q);
  });

  it('keeps paths, groups, clips and the soundtrack in the project file', () => {
    let p = emptyProject('Main film');
    p = addObject(p, 'group', { key: 'Set' }).project;
    p = addObject(p, 'ellipse', { key: 'Moon', path: presetPath('arc', 1280, 720), follow: true }).project;
    p = setParent(p, 'Moon', 'Set');
    const added = addClip(p, sampleProject(), 'Logo sting');
    p = updateObject(added.project, added.key, { start: 1.5, speed: 2, loop: true });
    p = { ...p, audio: { name: 'beat.wav', src: 'data:audio/wav;base64,AAAA' } };
    const again = readProjectFile(projectFile(p));
    expect(again.objects).toEqual(p.objects);
    expect(Object.keys(again.clips ?? {})).toEqual(['Logo sting']);
    expect(again.clips?.['Logo sting']?.objects.map((o) => o.key)).toEqual(['Card', 'Title', 'Ball']);
    expect(again.audio).toEqual(p.audio);
    expect(valuesAt(again, added.key, 0).width).toBe(768);
    // A file that names a parent that is not a group loses that link, and a circle of parents is cut once.
    const raw = JSON.parse(projectFile(p));
    raw.objects.push({ key: 'A', kind: 'group', parent: 'B' }, { key: 'B', kind: 'group', parent: 'A' }, { key: 'C', kind: 'box', parent: 'Moon' });
    raw.audio = { name: 'x', src: 'https://example.org/track.mp3' };
    const cleaned = readProjectFile(JSON.stringify(raw));
    expect(cleaned.objects.filter((o) => ['A', 'B', 'C'].includes(o.key)).map((o) => o.parent)).toEqual([undefined, 'A', undefined]);
    expect(cleaned.audio).toBeUndefined();
    expect(pruneClips(removeObject(p, added.key)).clips).toBeUndefined();
  });

  it('writes a page that knows about groups, paths, clips and sound', () => {
    let p = addObject(emptyProject('Film'), 'group', { key: 'Set' }).project;
    p = addObject(p, 'ellipse', { key: 'Moon', path: 'M0 0L100 0', follow: true }).project;
    p = setParent(p, 'Moon', 'Set');
    p = addClip(p, sampleProject(), 'Sting').project;
    p = { ...p, audio: { name: 'beat.wav', src: 'data:audio/wav;base64,AAAA' } };
    const html = animationHtml(p, { core: '/* core */', dataverse: '/* dataverse */' }, { loop: true });
    const data = JSON.parse(/<script type="application\/json" id="animation">(.*?)<\/script>/s.exec(html)?.[1] ?? '{}');
    expect(data.objects.map((o: { key: string }) => o.key)).toEqual(['Set', 'Moon', 'Sting']);
    expect(data.objects[1]).toMatchObject({ parent: 'Set', follow: true, table: { total: 100 } });
    expect(data.objects[2]).toMatchObject({ kind: 'clip', clip: 'Sting', start: 0, speed: 1, loop: false });
    expect(data.clips.Sting.objects).toHaveLength(3);
    expect(data.audio).toBe('data:audio/wav;base64,AAAA');
    expect(html).toContain('attachAudio');
    expect(html).toContain('progress: types.number(0, { range: [0, 1] })');
    // The page's own script is sound JavaScript.
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] as string);
    expect(scripts).toHaveLength(2);
    for (const script of scripts) expect(() => new Function(script)).not.toThrow();
  });
});
