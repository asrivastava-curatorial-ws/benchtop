/**
 * Geometry lab: drag points to explore triangle centres and Euler's line,
 * polygons and their angles, the circle theorems, transformations with their
 * matrices, conics from a focus and directrix, and the unit circle.
 */
import type { ComponentChildren, TargetedPointerEvent } from 'preact';
import { useRef, useState } from 'preact/hooks';
import {
  type Affine,
  angleAt,
  applyAffine,
  conic,
  conicPoint,
  determinant,
  dist,
  enlargement,
  exactTrig,
  foot,
  interiorAngles,
  isConvex,
  mid,
  type Pt,
  reflection,
  regularPolygon,
  rotation,
  selfCrossing,
  shear,
  signedArea,
  translation,
  triangle,
} from '../../lib/geometry-lab';
import { defineCustomTool, type Values } from '../types';
import { fmt, LAB_COLORS, LabTabs, mergeStored, Plot, Readouts, Slider, useClock } from './_lab';
import { Segmented, usePersistentState } from './_shared';

type Tab = 'triangle' | 'polygon' | 'circle' | 'transform' | 'conic' | 'unit';
const TABS: readonly { readonly value: Tab; readonly label: string }[] = [
  { value: 'triangle', label: 'Triangle centres' },
  { value: 'polygon', label: 'Polygons' },
  { value: 'circle', label: 'Circle theorems' },
  { value: 'transform', label: 'Transformations' },
  { value: 'conic', label: 'Conic sections' },
  { value: 'unit', label: 'Unit circle' },
];
type Theorem = 'centre' | 'segment' | 'semicircle' | 'cyclic' | 'tangent';
type Move = 'translate' | 'rotate' | 'reflect' | 'enlarge' | 'shear';

const DEFAULTS = {
  tab: 'triangle' as Tab,
  triangle: {
    points: [
      [180, 300],
      [500, 320],
      [300, 90],
    ] as readonly Pt[],
    medians: true,
    circum: true,
    incircle: false,
    altitudes: false,
    euler: false,
  },
  polygon: {
    regular: true,
    n: 6,
    side: 5,
    points: [
      [200, 300],
      [420, 320],
      [480, 180],
      [330, 90],
      [190, 160],
    ] as readonly Pt[],
    fan: true,
  },
  circle: { theorem: 'centre' as Theorem, angles: [200, 340, 90, 120] as readonly number[] },
  transform: { move: 'rotate' as Move, dx: 4, dy: -2, angle: 90, cx: 0, cy: 0, mirror: 45, k: 2, kx: 1, ky: 0 },
  conic: { e: 0.7, p: 4, theta: 60 },
  unit: { angle: 30, tan: true },
};
type State = typeof DEFAULTS;
type Part<K extends keyof State> = { s: State[K]; set: (patch: Partial<State[K]>) => void };

const isPt = (p: unknown): p is Pt => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n));
const read = (v: Values | undefined): State => {
  const s = mergeStored(DEFAULTS, v);
  const oneOf = <T extends string>(value: string, allowed: readonly T[], fallback: T): T => allowed.find((a) => a === value) ?? fallback;
  const tri = s.triangle.points.filter(isPt);
  const poly = s.polygon.points.filter(isPt).slice(0, 12);
  const angles = s.circle.angles.filter((a): a is number => typeof a === 'number' && Number.isFinite(a));
  return {
    ...s,
    tab: oneOf(
      s.tab,
      TABS.map((t) => t.value),
      'triangle',
    ),
    triangle: { ...s.triangle, points: tri.length === 3 ? tri : DEFAULTS.triangle.points },
    polygon: { ...s.polygon, points: poly.length >= 3 ? poly : DEFAULTS.polygon.points },
    circle: { theorem: oneOf(s.circle.theorem, ['centre', 'segment', 'semicircle', 'cyclic', 'tangent'] as const, 'centre'), angles: angles.length === 4 ? angles : DEFAULTS.circle.angles },
    transform: { ...s.transform, move: oneOf(s.transform.move, ['translate', 'rotate', 'reflect', 'enlarge', 'shear'] as const, 'rotate') },
  };
};
const write = (s: State): Values => JSON.parse(JSON.stringify(s)) as Values;

const W = 640;
const H = 400;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Pointer dragging of numbered handles inside an SVG drawn in its own units. */
function useHandles(onMove: (index: number, p: Pt) => void) {
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);
  const toSvg = (e: { clientX: number; clientY: number }): Pt => {
    const ctm = svg.current?.getScreenCTM();
    if (!ctm) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return [Math.min(W, Math.max(0, p.x)), Math.min(H, Math.max(0, p.y))];
  };
  return {
    svg,
    grab: (i: number) => (e: TargetedPointerEvent<SVGElement>) => {
      dragging.current = i;
      svg.current?.setPointerCapture(e.pointerId);
      e.stopPropagation();
    },
    events: {
      onPointerMove: (e: TargetedPointerEvent<SVGSVGElement>) => {
        if (dragging.current !== null) onMove(dragging.current, toSvg(e));
      },
      onPointerUp: () => {
        dragging.current = null;
      },
      onPointerCancel: () => {
        dragging.current = null;
      },
    },
    toSvg,
  };
}

function Handle({ p, label, grab, colour, test }: { p: Pt; label?: string; grab: (e: TargetedPointerEvent<SVGElement>) => void; colour?: string; test?: string }) {
  return (
    <g class="ge-handle" onPointerDown={grab} data-testid={test}>
      <circle cx={p[0]} cy={p[1]} r="14" class="ge-hit" />
      <circle cx={p[0]} cy={p[1]} r="6" style={colour ? { fill: colour } : undefined} />
      {label && (
        <text x={p[0] + 10} y={p[1] - 10} class="ge-label">
          {label}
        </text>
      )}
    </g>
  );
}

/** A line through two points, drawn across the whole picture. */
function FullLine({ a, b, cls }: { a: Pt; b: Pt; cls: string }) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const k = 2000 / len;
  return <line class={cls} x1={a[0] - dx * k} y1={a[1] - dy * k} x2={a[0] + dx * k} y2={a[1] + dy * k} />;
}

/** An angle mark at p between rays to a and b, with its size. */
function AngleMark({ p, a, b, r = 26, label = true }: { p: Pt; a: Pt; b: Pt; r?: number; label?: boolean }) {
  const a1 = Math.atan2(a[1] - p[1], a[0] - p[0]);
  const a2 = Math.atan2(b[1] - p[1], b[0] - p[0]);
  let d = a2 - a1;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  const value = angleAt(p, a, b);
  const right = Math.abs(value - 90) < 0.05;
  const e1: Pt = [p[0] + r * Math.cos(a1), p[1] + r * Math.sin(a1)];
  const e2: Pt = [p[0] + r * Math.cos(a1 + d), p[1] + r * Math.sin(a1 + d)];
  const m = a1 + d / 2;
  return (
    <g class="ge-angle">
      {right ? (
        <path d={`M${p[0] + 14 * Math.cos(a1)} ${p[1] + 14 * Math.sin(a1)}l${14 * Math.cos(a1 + d)} ${14 * Math.sin(a1 + d)}l${-14 * Math.cos(a1)} ${-14 * Math.sin(a1)}`} />
      ) : (
        <path d={`M${e1[0]} ${e1[1]}A${r} ${r} 0 0 ${d > 0 ? 1 : 0} ${e2[0]} ${e2[1]}`} />
      )}
      {label && (
        <text x={p[0] + (r + 18) * Math.cos(m)} y={p[1] + (r + 18) * Math.sin(m) + 4} text-anchor="middle">
          {fmt(value, 4)}°
        </text>
      )}
    </g>
  );
}

function Grid({ step = 40 }: { step?: number }) {
  const lines = [];
  for (let x = step; x < W; x += step) lines.push(<line key={`x${x}`} x1={x} x2={x} y1={0} y2={H} />);
  for (let y = step; y < H; y += step) lines.push(<line key={`y${y}`} x1={0} x2={W} y1={y} y2={y} />);
  return <g class="ge-grid">{lines}</g>;
}

const UNIT = 40; // one grid square, for lengths and areas

/* ------------------------------------------------------------- triangle -- */

function TriangleLab({ s, set }: Part<'triangle'>) {
  const [A, B, C] = s.points as [Pt, Pt, Pt];
  const h = useHandles((i, p) => set({ points: s.points.map((q, j) => (j === i ? p : q)) }));
  const t = triangle(A, B, C);
  const parts: ComponentChildren[] = [];
  if (t) {
    if (s.circum) {
      parts.push(<circle key="cc" class="ge-construct is-blue" cx={t.O[0]} cy={t.O[1]} r={t.R} />);
      for (const [p, q] of [
        [A, B],
        [B, C],
        [C, A],
      ] as [Pt, Pt][]) {
        const m = mid(p, q);
        parts.push(<FullLine key={`pb${m.join()}`} a={m} b={[m[0] - (q[1] - p[1]), m[1] + (q[0] - p[0])]} cls="ge-construct is-blue is-thin" />);
      }
    }
    if (s.incircle) {
      parts.push(<circle key="ic" class="ge-construct is-green" cx={t.I[0]} cy={t.I[1]} r={t.r} />);
      for (const v of [A, B, C]) parts.push(<line key={`ab${v.join()}`} class="ge-construct is-green is-thin" x1={v[0]} y1={v[1]} x2={t.I[0]} y2={t.I[1]} />);
    }
    if (s.medians)
      for (const [v, p, q] of [
        [A, B, C],
        [B, C, A],
        [C, A, B],
      ] as [Pt, Pt, Pt][])
        parts.push(<line key={`md${v.join()}`} class="ge-construct is-orange is-thin" x1={v[0]} y1={v[1]} x2={mid(p, q)[0]} y2={mid(p, q)[1]} />);
    if (s.altitudes)
      for (const [v, p, q] of [
        [A, B, C],
        [B, C, A],
        [C, A, B],
      ] as [Pt, Pt, Pt][]) {
        const f = foot(v, p, q);
        parts.push(<line key={`al${v.join()}`} class="ge-construct is-pink is-thin" x1={v[0]} y1={v[1]} x2={f[0]} y2={f[1]} />);
        parts.push(<FullLine key={`ex${v.join()}`} a={p} b={q} cls="ge-construct is-faint" />);
        parts.push(<line key={`ah${v.join()}`} class="ge-construct is-pink is-faint" x1={f[0]} y1={f[1]} x2={t.H[0]} y2={t.H[1]} />);
      }
    if (s.euler) {
      parts.push(<FullLine key="eu" a={t.O} b={t.H} cls="ge-construct is-euler" />);
      parts.push(<circle key="np" class="ge-construct is-faint" cx={t.N[0]} cy={t.N[1]} r={t.R / 2} />);
    }
  }
  const centre = (p: Pt, label: string, colour: string) => (
    <g key={label} class="ge-centre">
      <circle cx={p[0]} cy={p[1]} r="4.5" style={{ fill: colour }} />
      <text x={p[0] + 8} y={p[1] + 14} class="ge-label is-small">
        {label}
      </text>
    </g>
  );
  const side = (p: Pt, q: Pt, label: string) => {
    const m = mid(p, q);
    return (
      <text key={label} class="ge-label is-muted" x={m[0]} y={m[1]} text-anchor="middle" dy="-6">
        {label} = {fmt(dist(p, q) / UNIT, 3)}
      </text>
    );
  };
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <label class="ms-check">
          <input type="checkbox" checked={s.medians} onChange={(e) => set({ medians: e.currentTarget.checked })} /> Medians and centroid G
        </label>
        <label class="ms-check">
          <input type="checkbox" checked={s.circum} onChange={(e) => set({ circum: e.currentTarget.checked })} /> Perpendicular bisectors and circumcircle O
        </label>
        <label class="ms-check">
          <input type="checkbox" checked={s.incircle} onChange={(e) => set({ incircle: e.currentTarget.checked })} /> Angle bisectors and incircle I
        </label>
        <label class="ms-check">
          <input type="checkbox" checked={s.altitudes} onChange={(e) => set({ altitudes: e.currentTarget.checked })} data-testid="ge-altitudes" /> Altitudes and orthocentre H
        </label>
        <label class="ms-check">
          <input type="checkbox" checked={s.euler} onChange={(e) => set({ euler: e.currentTarget.checked })} /> Euler’s line and the nine-point circle
        </label>
        <div class="button-row">
          <button
            type="button"
            class="button button-small"
            onClick={() =>
              set({
                points: [
                  [200, 320],
                  [440, 320],
                  [320, 320 - 240 * Math.sin(Math.PI / 3)],
                ],
              })
            }
          >
            Equilateral
          </button>
          <button
            type="button"
            class="button button-small"
            onClick={() =>
              set({
                points: [
                  [200, 320],
                  [440, 320],
                  [200, 140],
                ],
              })
            }
            data-testid="ge-right"
          >
            Right-angled
          </button>
        </div>
        <p class="lab-note">Drag the corners. Lengths are in grid squares.</p>
      </div>
      <div class="lab-stage">
        <svg ref={h.svg} class="lab-scene ge-scene" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Triangle and its centres" data-testid="ge-scene" {...h.events}>
          <Grid />
          {parts}
          <path class="ge-shape" d={`M${A[0]} ${A[1]}L${B[0]} ${B[1]}L${C[0]} ${C[1]}Z`} />
          {side(B, C, 'a')}
          {side(C, A, 'b')}
          {side(A, B, 'c')}
          <AngleMark p={A} a={B} b={C} />
          <AngleMark p={B} a={C} b={A} />
          <AngleMark p={C} a={A} b={B} />
          {t && s.medians && centre(t.G, 'G', LAB_COLORS[1] ?? '')}
          {t && s.circum && centre(t.O, 'O', LAB_COLORS[0] ?? '')}
          {t && s.incircle && centre(t.I, 'I', LAB_COLORS[2] ?? '')}
          {t && s.altitudes && centre(t.H, 'H', LAB_COLORS[3] ?? '')}
          {t && s.euler && centre(t.N, 'N', 'var(--muted)')}
          {s.points.map((p, i) => (
            <Handle key={i} p={p} label={'ABC'[i]} grab={h.grab(i)} test={`ge-vertex-${i}`} />
          ))}
        </svg>
        <Readouts
          test="ge-results"
          items={
            t
              ? [
                  ['Triangle', t.kind],
                  [
                    'Angles',
                    `${t.angles.map((a) => fmt(a, 4)).join('° + ')}° = ${fmt(
                      t.angles.reduce((x, y) => x + y, 0),
                      5,
                    )}°`,
                  ],
                  ['Area', `${fmt(t.area / UNIT ** 2, 4)} squares`],
                  ['Perimeter', fmt(t.perimeter / UNIT, 4)],
                  ['Circumradius R', fmt(t.R / UNIT, 4)],
                  ['Inradius r', fmt(t.r / UNIT, 4)],
                  ['Euler: OG and GH', `${fmt(dist(t.O, t.G) / UNIT, 4)} and ${fmt(dist(t.G, t.H) / UNIT, 4)} (always 1 : 2)`],
                ]
              : [['Triangle', 'the corners are in a line: drag one away']]
          }
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- polygons -- */

function PolygonLab({ s, set }: Part<'polygon'>) {
  const points: readonly Pt[] = s.regular ? regularPolygon(s.n, [W / 2, H / 2], 150, -Math.PI / 2) : s.points;
  const h = useHandles((i, p) => !s.regular && set({ points: s.points.map((q, j) => (j === i ? p : q)) }));
  const n = points.length;
  const angles = interiorAngles(points);
  const crossing = selfCrossing(points);
  const convex = !crossing && isConvex(points);
  const area = Math.abs(signedArea(points));
  const perimeter = points.reduce((sum, p, i) => sum + dist(p, points[(i + 1) % n] ?? p), 0);
  const first = points[0] ?? [0, 0];
  const addVertex = () => {
    // Split the longest side.
    let best = 0;
    let bestLen = -1;
    s.points.forEach((p, i) => {
      const l = dist(p, s.points[(i + 1) % s.points.length] ?? p);
      if (l > bestLen) {
        best = i;
        bestLen = l;
      }
    });
    const a = s.points[best] ?? [0, 0];
    const b = s.points[(best + 1) % s.points.length] ?? [0, 0];
    const m = mid(a, b);
    const out = [...s.points];
    out.splice(best + 1, 0, [m[0] + (b[1] - a[1]) * 0.15, m[1] - (b[0] - a[0]) * 0.15]);
    set({ points: out });
  };
  const sideLen = s.side;
  const regularArea = (s.n * sideLen * sideLen) / (4 * Math.tan(Math.PI / s.n));
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <Segmented
          label="Polygon"
          value={s.regular ? 'regular' : 'free'}
          choices={[
            { value: 'regular', label: 'Regular' },
            { value: 'free', label: 'Your own' },
          ]}
          onChange={(v) => set({ regular: v === 'regular' })}
        />
        {s.regular ? (
          <>
            <Slider label="Sides" value={s.n} min={3} max={20} step={1} onChange={(v) => set({ n: v })} test="pg-n" />
            <Slider label="Side length" value={s.side} min={0.1} max={100} step={0.1} unit="cm" onChange={(side) => set({ side })} />
          </>
        ) : (
          <div class="button-row">
            <button type="button" class="button button-small" onClick={addVertex} disabled={s.points.length >= 12}>
              Add a corner
            </button>
            <button type="button" class="button button-small" onClick={() => set({ points: s.points.slice(0, -1) })} disabled={s.points.length <= 3}>
              Remove a corner
            </button>
          </div>
        )}
        <label class="ms-check">
          <input type="checkbox" checked={s.fan} onChange={(e) => set({ fan: e.currentTarget.checked })} /> Split into triangles from one corner
        </label>
        <p class="lab-note">{s.regular ? 'Switch to Your own to drag the corners.' : 'Drag the corners. Lengths are in grid squares.'}</p>
      </div>
      <div class="lab-stage">
        <svg ref={h.svg} class="lab-scene ge-scene" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Polygon" data-testid="pg-scene" {...h.events}>
          <Grid />
          <path class={crossing ? 'ge-shape is-bad' : 'ge-shape'} d={`M${points.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}Z`} />
          {s.fan && convex && points.slice(2, -1).map((p, i) => <line key={i} class="ge-construct is-orange is-thin" x1={first[0]} y1={first[1]} x2={p[0]} y2={p[1]} />)}
          {points.map((p, i) => {
            const prev = points[(i - 1 + n) % n] ?? p;
            const next = points[(i + 1) % n] ?? p;
            const a = angles[i] ?? 0;
            const inward = mid(mid(prev, next), p);
            const dir = Math.atan2(inward[1] - p[1], inward[0] - p[0]);
            const flip = a > 180 ? Math.PI : 0;
            return (
              <text key={`a${i}`} class="ge-label is-small" x={p[0] + 30 * Math.cos(dir + flip)} y={p[1] + 30 * Math.sin(dir + flip) + 4} text-anchor="middle">
                {fmt(a, 4)}°
              </text>
            );
          })}
          {!s.regular && points.map((p, i) => <Handle key={i} p={p} grab={h.grab(i)} test={`pg-vertex-${i}`} />)}
        </svg>
        <Readouts
          test="pg-results"
          items={[
            ['Corners', String(n)],
            [
              'Interior angles add up to',
              `${fmt(
                angles.reduce((x, y) => x + y, 0),
                6,
              )}° = (${n} − 2) × 180°`,
            ],
            ...(s.regular
              ? ([
                  ['Each interior angle', `${fmt(((n - 2) * 180) / n, 6)}°`],
                  ['Each exterior angle', `${fmt(360 / n, 6)}°`],
                  ['Area', `${fmt(regularArea, 5)} cm²`],
                  ['Perimeter', `${fmt(s.n * sideLen, 5)} cm`],
                ] as [string, string][])
              : ([
                  ['Shape', crossing ? 'its sides cross (not a simple polygon)' : convex ? 'convex' : 'concave (one angle is reflex)'],
                  ['Area', `${fmt(area / UNIT ** 2, 4)} squares`],
                  ['Perimeter', fmt(perimeter / UNIT, 4)],
                ] as [string, string][])),
            ['Diagonals', String((n * (n - 3)) / 2)],
          ]}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------- circle theorems -- */

const THEOREMS: Readonly<Record<Theorem, { readonly name: string; readonly points: string; readonly text: string }>> = {
  centre: { name: 'Angle at the centre', points: 'ABP', text: 'The angle at the centre is twice the angle at the edge standing on the same arc.' },
  segment: { name: 'Same segment', points: 'ABPQ', text: 'Angles in the same segment, standing on the same chord, are equal.' },
  semicircle: { name: 'Angle in a semicircle', points: 'AP', text: 'The angle in a semicircle is a right angle.' },
  cyclic: { name: 'Cyclic quadrilateral', points: 'ABCD', text: 'Opposite angles of a cyclic quadrilateral add up to 180°.' },
  tangent: { name: 'Tangent and chord', points: 'ABC', text: 'A tangent meets the radius at 90°; the angle between tangent and chord equals the angle in the alternate segment.' },
};

function CircleLab({ s, set }: Part<'circle'>) {
  const O: Pt = [W / 2, H / 2];
  const R = 150;
  const at = (a: number): Pt => [O[0] + R * Math.cos(rad(a)), O[1] - R * Math.sin(rad(a))];
  const h = useHandles((i, p) => {
    const a = deg(Math.atan2(O[1] - p[1], p[0] - O[0]));
    set({ angles: s.angles.map((x, j) => (j === i ? Math.round(a * 2) / 2 : x)) });
  });
  const th = THEOREMS[s.theorem];
  const [a0 = 0, a1 = 0, a2 = 0, a3 = 0] = s.angles;
  const A = at(a0);
  const Bp = at(s.theorem === 'semicircle' ? a0 + 180 : a1);
  const P = at(a2);
  const Q = at(a3);
  const content: ComponentChildren[] = [];
  const items: [string, string][] = [];
  if (s.theorem === 'centre') {
    content.push(<path key="c" class="ge-shape is-open" d={`M${A[0]} ${A[1]}L${O[0]} ${O[1]}L${Bp[0]} ${Bp[1]}M${A[0]} ${A[1]}L${P[0]} ${P[1]}L${Bp[0]} ${Bp[1]}`} />);
    content.push(<AngleMark key="o" p={O} a={A} b={Bp} />, <AngleMark key="p" p={P} a={A} b={Bp} />);
    const atCentre = angleAt(O, A, Bp);
    const atEdge = angleAt(P, A, Bp);
    // On the minor arc the edge angle stands on the reflex angle at the centre.
    const sameSide = Math.abs(atCentre - 2 * atEdge) < Math.abs(360 - atCentre - 2 * atEdge);
    items.push(['∠AOB at the centre', `${fmt(atCentre, 4)}°${sameSide ? '' : ` (reflex ${fmt(360 - atCentre, 4)}°)`}`]);
    items.push(['∠APB at the edge', `${fmt(atEdge, 4)}°`]);
    items.push(['Twice the edge angle', `${fmt(2 * atEdge, 4)}°`]);
  } else if (s.theorem === 'segment') {
    content.push(
      <path key="c" class="ge-shape is-open" d={`M${A[0]} ${A[1]}L${P[0]} ${P[1]}L${Bp[0]} ${Bp[1]}M${A[0]} ${A[1]}L${Q[0]} ${Q[1]}L${Bp[0]} ${Bp[1]}M${A[0]} ${A[1]}L${Bp[0]} ${Bp[1]}`} />,
    );
    content.push(<AngleMark key="p" p={P} a={A} b={Bp} />, <AngleMark key="q" p={Q} a={A} b={Bp} />);
    items.push(['∠APB', `${fmt(angleAt(P, A, Bp), 4)}°`]);
    items.push(['∠AQB', `${fmt(angleAt(Q, A, Bp), 4)}°`]);
    items.push(['Note', 'equal while P and Q are on the same side of AB; opposite sides add up to 180°']);
  } else if (s.theorem === 'semicircle') {
    content.push(<path key="c" class="ge-shape is-open" d={`M${A[0]} ${A[1]}L${Bp[0]} ${Bp[1]}M${A[0]} ${A[1]}L${P[0]} ${P[1]}L${Bp[0]} ${Bp[1]}`} />);
    content.push(<AngleMark key="p" p={P} a={A} b={Bp} />);
    items.push(['∠APB', `${fmt(angleAt(P, A, Bp), 4)}°`]);
  } else if (s.theorem === 'cyclic') {
    const order = [A, Bp, P, Q].map((p, i) => ({ p, a: [a0, a1, a2, a3][i] ?? 0 })).sort((x, y) => (((x.a % 360) + 360) % 360) - (((y.a % 360) + 360) % 360));
    const [w, x, y, z] = order.map((o) => o.p) as [Pt, Pt, Pt, Pt];
    content.push(<path key="c" class="ge-shape" d={`M${w[0]} ${w[1]}L${x[0]} ${x[1]}L${y[0]} ${y[1]}L${z[0]} ${z[1]}Z`} />);
    content.push(<AngleMark key="1" p={w} a={z} b={x} />, <AngleMark key="2" p={x} a={w} b={y} />, <AngleMark key="3" p={y} a={x} b={z} />, <AngleMark key="4" p={z} a={y} b={w} />);
    const k = [angleAt(w, z, x), angleAt(x, w, y), angleAt(y, x, z), angleAt(z, y, w)];
    items.push(['First pair of opposite angles', `${fmt(k[0] ?? 0, 4)}° + ${fmt(k[2] ?? 0, 4)}° = ${fmt((k[0] ?? 0) + (k[2] ?? 0), 5)}°`]);
    items.push(['Second pair', `${fmt(k[1] ?? 0, 4)}° + ${fmt(k[3] ?? 0, 4)}° = ${fmt((k[1] ?? 0) + (k[3] ?? 0), 5)}°`]);
  } else {
    // Tangent at A; chord AB; C on the circle.
    const C = P;
    const tdir: Pt = [-(A[1] - O[1]), A[0] - O[0]];
    const T1: Pt = [A[0] + tdir[0], A[1] + tdir[1]];
    const T2: Pt = [A[0] - tdir[0], A[1] - tdir[1]];
    // The tangent direction on the far side of the chord from C.
    const side = (p: Pt) => Math.sign((Bp[0] - A[0]) * (p[1] - A[1]) - (Bp[1] - A[1]) * (p[0] - A[0]));
    const T = side(T1) !== side(C) ? T1 : T2;
    content.push(<FullLine key="t" a={A} b={T1} cls="ge-construct is-blue" />);
    content.push(<path key="c" class="ge-shape is-open" d={`M${O[0]} ${O[1]}L${A[0]} ${A[1]}L${Bp[0]} ${Bp[1]}L${C[0]} ${C[1]}L${A[0]} ${A[1]}`} />);
    content.push(<AngleMark key="r" p={A} a={O} b={T} r={18} label={false} />, <AngleMark key="tc" p={A} a={T} b={Bp} r={40} />, <AngleMark key="c" p={C} a={A} b={Bp} />);
    items.push(['Tangent to radius', `${fmt(angleAt(A, O, T), 4)}°`]);
    items.push(['Between tangent and chord AB', `${fmt(angleAt(A, T, Bp), 4)}°`]);
    items.push(['∠ACB in the alternate segment', `${fmt(angleAt(C, A, Bp), 4)}°`]);
  }
  const handles: { i: number; p: Pt; label: string }[] = [];
  const names = th.points;
  if (s.theorem === 'semicircle') handles.push({ i: 0, p: A, label: 'A' }, { i: 2, p: P, label: 'P' });
  else if (s.theorem === 'tangent') handles.push({ i: 0, p: A, label: 'A' }, { i: 1, p: Bp, label: 'B' }, { i: 2, p: P, label: 'C' });
  else
    names.split('').forEach((label, k) => {
      handles.push({ i: k, p: [A, Bp, P, Q][k] ?? A, label });
    });
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <select class="input" aria-label="Theorem" value={s.theorem} onChange={(e) => set({ theorem: e.currentTarget.value as Theorem })} data-testid="ct-theorem">
          {(Object.keys(THEOREMS) as Theorem[]).map((k) => (
            <option key={k} value={k}>
              {THEOREMS[k].name}
            </option>
          ))}
        </select>
        <p class="lab-note">{th.text}</p>
        <p class="lab-note">Drag the points round the circle.</p>
      </div>
      <div class="lab-stage">
        <svg ref={h.svg} class="lab-scene ge-scene" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Circle theorem" data-testid="ct-scene" {...h.events}>
          <circle class="ge-circle" cx={O[0]} cy={O[1]} r={R} />
          {s.theorem === 'semicircle' && <line class="ge-construct is-faint" x1={A[0]} y1={A[1]} x2={Bp[0]} y2={Bp[1]} />}
          {content}
          <circle cx={O[0]} cy={O[1]} r="3.5" fill="var(--text)" />
          <text class="ge-label is-small" x={O[0] + 6} y={O[1] + 16}>
            O
          </text>
          {s.theorem === 'semicircle' && <circle cx={Bp[0]} cy={Bp[1]} r="5" fill="var(--text)" />}
          {s.theorem === 'semicircle' && (
            <text class="ge-label" x={Bp[0] + 10} y={Bp[1] - 10}>
              B
            </text>
          )}
          {handles.map((hd) => (
            <Handle key={hd.label} p={hd.p} label={hd.label} grab={h.grab(hd.i)} test={`ct-${hd.label}`} />
          ))}
        </svg>
        <Readouts test="ct-results" items={items} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------- transformations -- */

const F_SHAPE: readonly Pt[] = [
  [0, 0],
  [0, 4],
  [3, 4],
  [3, 3],
  [1, 3],
  [1, 2.2],
  [2.4, 2.2],
  [2.4, 1.2],
  [1, 1.2],
  [1, 0],
];
const GU = 25; // pixels per unit on the coordinate grid

function TransformLab({ s, set }: Part<'transform'>) {
  const shape = F_SHAPE.map((p) => [p[0] + 1, p[1] + 1] as Pt);
  const centre: Pt = [s.cx, s.cy];
  const f: Affine =
    s.move === 'translate'
      ? translation(s.dx, s.dy)
      : s.move === 'rotate'
        ? rotation(s.angle, centre)
        : s.move === 'reflect'
          ? reflection(s.mirror, centre)
          : s.move === 'enlarge'
            ? enlargement(s.k, centre)
            : shear(s.kx, s.ky, centre);
  const image = shape.map((p) => applyAffine(f, p));
  const X = (x: number) => W / 2 + x * GU;
  const Y = (y: number) => H / 2 - y * GU;
  const path = (pts: readonly Pt[]) => `M${pts.map((p) => `${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join('L')}Z`;
  const det = determinant(f);
  const axes = [];
  for (let x = -12; x <= 12; x++) axes.push(<line key={`gx${x}`} class={x === 0 ? 'ge-axis' : 'ge-gridline'} x1={X(x)} x2={X(x)} y1={0} y2={H} />);
  for (let y = -8; y <= 8; y++) axes.push(<line key={`gy${y}`} class={y === 0 ? 'ge-axis' : 'ge-gridline'} x1={0} x2={W} y1={Y(y)} y2={Y(y)} />);
  const m = f.m;
  const matrix = `[${fmt(m[0], 3)}  ${fmt(m[1], 3)}; ${fmt(m[2], 3)}  ${fmt(m[3], 3)}]`;
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <select class="input" aria-label="Transformation" value={s.move} onChange={(e) => set({ move: e.currentTarget.value as Move })} data-testid="tf-move">
          <option value="translate">Translation</option>
          <option value="rotate">Rotation</option>
          <option value="reflect">Reflection</option>
          <option value="enlarge">Enlargement</option>
          <option value="shear">Shear</option>
        </select>
        {s.move === 'translate' && (
          <>
            <Slider label="Across" value={s.dx} min={-10} max={10} step={0.5} onChange={(dx) => set({ dx })} />
            <Slider label="Up" value={s.dy} min={-7} max={7} step={0.5} onChange={(dy) => set({ dy })} />
          </>
        )}
        {s.move === 'rotate' && <Slider label="Angle" value={s.angle} min={-360} max={360} step={1} unit="°" onChange={(angle) => set({ angle })} test="tf-angle" />}
        {s.move === 'reflect' && <Slider label="Mirror line angle" value={s.mirror} min={0} max={180} step={1} unit="°" onChange={(mirror) => set({ mirror })} />}
        {s.move === 'enlarge' && <Slider label="Scale factor" value={s.k} min={-3} max={3} step={0.1} onChange={(k) => set({ k })} test="tf-k" />}
        {s.move === 'shear' && (
          <>
            <Slider label="Shear along x" value={s.kx} min={-3} max={3} step={0.1} onChange={(kx) => set({ kx })} />
            <Slider label="Shear along y" value={s.ky} min={-3} max={3} step={0.1} onChange={(ky) => set({ ky })} />
          </>
        )}
        {s.move !== 'translate' && (
          <>
            <h3>{s.move === 'reflect' ? 'The mirror line passes through' : 'Centre'}</h3>
            <Slider label="x" value={s.cx} min={-10} max={10} step={0.5} onChange={(cx) => set({ cx })} />
            <Slider label="y" value={s.cy} min={-7} max={7} step={0.5} onChange={(cy) => set({ cy })} />
          </>
        )}
      </div>
      <div class="lab-stage">
        <svg class="lab-scene ge-scene" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Shape and its image" data-testid="tf-scene">
          {axes}
          {s.move === 'reflect' && <FullLine a={[X(s.cx), Y(s.cy)]} b={[X(s.cx + Math.cos(rad(s.mirror))), Y(s.cy + Math.sin(rad(s.mirror)))]} cls="ge-construct is-pink" />}
          {(s.move === 'rotate' || s.move === 'enlarge') &&
            shape.map((p, i) => (
              <line key={i} class="ge-construct is-faint" x1={X(s.cx)} y1={Y(s.cy)} x2={X((s.move === 'enlarge' ? (image[i] ?? p) : p)[0])} y2={Y((s.move === 'enlarge' ? (image[i] ?? p) : p)[1])} />
            ))}
          <path class="tf-object" d={path(shape)} />
          <path class="tf-image" d={path(image)} data-testid="tf-image" />
          {s.move !== 'translate' && <circle cx={X(s.cx)} cy={Y(s.cy)} r="4" fill="var(--text)" />}
        </svg>
        <div class="lab-legend">
          <span>
            <i style={{ background: LAB_COLORS[0] }} />
            object
          </span>
          <span>
            <i style={{ background: LAB_COLORS[1] }} />
            image
          </span>
        </div>
        <Readouts
          test="tf-results"
          items={[
            ['Matrix', matrix],
            ['Then add', `(${fmt(f.t[0], 4)}, ${fmt(f.t[1], 4)})`],
            ['Determinant', `${fmt(det, 4)}: areas ×${fmt(Math.abs(det), 4)}${det < 0 ? ', and the shape is flipped over' : ''}`],
            ['Area of the object and the image', `${fmt(Math.abs(signedArea(shape)), 4)} and ${fmt(Math.abs(signedArea(image)), 4)} squares`],
          ]}
        />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- conics -- */

function ConicLab({ s, set }: Part<'conic'>) {
  const [running, setRunning] = useState(false);
  useClock(running, (dt) => set({ theta: (s.theta + dt * 40) % 360 }));
  const c = conic(s.e, s.p);
  const k = 26; // pixels per unit
  const fx = s.e < 1 ? W / 2 - 60 : W / 2 - 40;
  const X = (x: number) => fx + x * k;
  const Y = (y: number) => H / 2 - y * k;
  const branches: string[] = [];
  let current: string[] = [];
  let farBranch: string[] = [];
  for (let i = 0; i <= 720; i++) {
    const t = (i / 720) * 2 * Math.PI;
    const den = 1 + s.e * Math.cos(t);
    if (Math.abs(den) < 1e-3) {
      if (current.length > 1) branches.push(`M${current.join('L')}`);
      current = [];
      continue;
    }
    const r = (s.e * s.p) / den;
    const px = r * Math.cos(t);
    const py = r * Math.sin(t);
    if (Math.abs(px) > 40 || Math.abs(py) > 40) {
      if (den > 0) {
        if (current.length > 1) branches.push(`M${current.join('L')}`);
        current = [];
      } else if (farBranch.length) {
        branches.push(`M${farBranch.join('L')}`);
        farBranch = [];
      }
      continue;
    }
    const q = `${X(px).toFixed(1)} ${Y(py).toFixed(1)}`;
    if (den > 0) current.push(q);
    else farBranch.push(q);
  }
  if (current.length > 1) branches.push(`M${current.join('L')}`);
  if (farBranch.length > 1) branches.push(`M${farBranch.join('L')}`);
  const P = conicPoint(s.e, s.p, rad(s.theta));
  const items: [string, string][] = [
    ['Curve', c.kind],
    ['Eccentricity e', fmt(s.e, 4)],
    ['Semi-latus rectum', fmt(c.l, 4)],
  ];
  if (c.kind === 'ellipse' || c.kind === 'hyperbola') {
    items.push(['Semi-axes a and b', `${fmt(c.a, 4)} and ${fmt(c.b, 4)}`]);
    items.push(['Centre to focus c = ae', fmt(c.c, 4)]);
    items.push(['Equation about its centre', c.kind === 'ellipse' ? `x²/${fmt(c.a * c.a, 4)} + y²/${fmt(c.b * c.b, 4)} = 1` : `x²/${fmt(c.a * c.a, 4)} − y²/${fmt(c.b * c.b, 4)} = 1`]);
  } else if (c.kind === 'parabola') items.push(['Equation from its vertex', `y² = ${fmt(2 * s.p, 4)}x (focus ${fmt(s.p / 2, 4)} from the vertex)`]);
  if (P) {
    const pf = Math.hypot(P[0], P[1]);
    const pd = Math.abs(s.p - P[0]);
    items.push(['PF and PD', `${fmt(pf, 4)} and ${fmt(pd, 4)}: PF ÷ PD = ${fmt(pf / pd, 4)}`]);
  }
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <Slider label="Eccentricity e" value={s.e} min={0.05} max={2.5} step={0.01} onChange={(e) => set({ e })} test="cn-e" />
        <Slider label="Focus to directrix" value={s.p} min={1} max={8} step={0.1} onChange={(p) => set({ p })} />
        <Slider label="Point P at" value={s.theta} min={0} max={360} step={1} unit="°" onChange={(theta) => set({ theta })} />
        <div class="button-row">
          <button type="button" class="button button-small" onClick={() => setRunning((r) => !r)}>
            {running ? 'Stop P' : 'Move P round'}
          </button>
          <button type="button" class="button button-small" onClick={() => set({ e: 1 })}>
            Parabola (e = 1)
          </button>
        </div>
        <p class="lab-note">Every point is e times as far from the focus F as from the directrix: below 1 an ellipse, exactly 1 a parabola, above 1 a hyperbola.</p>
      </div>
      <div class="lab-stage">
        <svg class="lab-scene ge-scene" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Conic section" data-testid="cn-scene">
          <line class="ge-axis" x1={0} x2={W} y1={Y(0)} y2={Y(0)} />
          <line class="ge-construct is-pink" x1={X(s.p)} x2={X(s.p)} y1={0} y2={H} />
          <text class="ge-label is-small" x={X(s.p) + 6} y={16}>
            directrix
          </text>
          {branches.map((d, i) => (
            <path key={i} class="cn-curve" d={d} />
          ))}
          <circle cx={X(0)} cy={Y(0)} r="5" fill="var(--text)" />
          <text class="ge-label" x={X(0) - 4} y={Y(0) + 20}>
            F
          </text>
          {P && (
            <g>
              <line class="ge-construct is-green" x1={X(0)} y1={Y(0)} x2={X(P[0])} y2={Y(P[1])} />
              <line class="ge-construct is-orange" x1={X(P[0])} y1={Y(P[1])} x2={X(s.p)} y2={Y(P[1])} />
              <circle cx={X(P[0])} cy={Y(P[1])} r="6" fill={LAB_COLORS[1]} stroke="var(--text)" />
              <text class="ge-label" x={X(P[0]) + 8} y={Y(P[1]) - 8}>
                P
              </text>
            </g>
          )}
        </svg>
        <Readouts test="cn-results" items={items} />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- unit circle -- */

function UnitLab({ s, set }: Part<'unit'>) {
  const O: Pt = [190, 200];
  const R = 140;
  const a = rad(s.angle);
  const P: Pt = [O[0] + R * Math.cos(a), O[1] - R * Math.sin(a)];
  const h = useHandles((_, p) => set({ angle: Math.round((((deg(Math.atan2(O[1] - p[1], p[0] - O[0])) % 360) + 360) % 360) * 2) / 2 }));
  const sin = Math.sin(a);
  const cos = Math.cos(a);
  const tan = Math.abs(cos) < 1e-12 ? Number.NaN : sin / cos;
  const exact = exactTrig(s.angle);
  const quadrant = s.angle % 90 === 0 ? 'on an axis' : `quadrant ${Math.floor((s.angle % 360) / 90) + 1}`;
  const ref = (() => {
    const d = ((s.angle % 360) + 360) % 360;
    return d <= 90 ? d : d <= 180 ? 180 - d : d <= 270 ? d - 180 : 360 - d;
  })();
  const piFraction = (() => {
    const f = s.angle / 180;
    for (const den of [1, 2, 3, 4, 6, 12]) {
      const num = f * den;
      if (Math.abs(num - Math.round(num)) < 1e-9) {
        const n = Math.round(num);
        if (n === 0) return '0';
        return `${n === 1 ? '' : n}π${den === 1 ? '' : `/${den}`}`;
      }
    }
    return null;
  })();
  const curve = (fn: (x: number) => number) => Array.from({ length: 361 }, (_, i) => [i, fn(rad(i))] as const);
  const tanY = O[1] - R * tan;
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <Slider label="Angle θ" value={s.angle} min={0} max={360} step={0.5} unit="°" onChange={(angle) => set({ angle })} test="uc-angle" />
        <label class="ms-check">
          <input type="checkbox" checked={s.tan} onChange={(e) => set({ tan: e.currentTarget.checked })} /> Show tan θ on the tangent line
        </label>
        <div class="button-row">
          {[30, 45, 60, 120, 210, 300].map((d) => (
            <button key={d} type="button" class="button button-small" onClick={() => set({ angle: d })}>
              {d}°
            </button>
          ))}
        </div>
        <p class="lab-note">Drag the point round the circle. In each quadrant the ratios that are positive spell All, Sin, Tan, Cos.</p>
      </div>
      <div class="lab-stage">
        <div class="uc-row">
          <svg ref={h.svg} class="lab-scene ge-scene uc-scene" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Unit circle" data-testid="uc-scene" {...h.events}>
            <line class="ge-axis" x1={20} x2={380} y1={O[1]} y2={O[1]} />
            <line class="ge-axis" x1={O[0]} x2={O[0]} y1={20} y2={380} />
            <circle class="ge-circle" cx={O[0]} cy={O[1]} r={R} />
            {[
              ['All', 1, -1],
              ['Sin', -1, -1],
              ['Tan', -1, 1],
              ['Cos', 1, 1],
            ].map(([t, sx, sy]) => (
              <text key={t as string} class="ge-label is-muted" x={O[0] + (sx as number) * 105} y={O[1] + (sy as number) * 105 + 4} text-anchor="middle">
                {t}
              </text>
            ))}
            {s.tan && Number.isFinite(tan) && Math.abs(tan) < 6 && (
              <g>
                <line class="ge-construct is-faint" x1={O[0] + R} x2={O[0] + R} y1={10} y2={390} />
                <line class="ge-construct is-faint" x1={O[0]} y1={O[1]} x2={O[0] + R} y2={tanY} />
                <line class="uc-tan" x1={O[0] + R} y1={O[1]} x2={O[0] + R} y2={tanY} />
              </g>
            )}
            <line class="uc-cos" x1={O[0]} y1={O[1]} x2={P[0]} y2={O[1]} />
            <line class="uc-sin" x1={P[0]} y1={O[1]} x2={P[0]} y2={P[1]} />
            <line class="ge-shape is-open" x1={O[0]} y1={O[1]} x2={P[0]} y2={P[1]} />
            <path class="ge-angle-path" d={`M${O[0] + 30} ${O[1]}A30 30 0 ${s.angle > 180 ? 1 : 0} 0 ${O[0] + 30 * Math.cos(a)} ${O[1] - 30 * Math.sin(a)}`} />
            <Handle p={P} label="P" grab={h.grab(0)} test="uc-point" />
            <text class="ge-label is-small" x={(O[0] + P[0]) / 2} y={O[1] + (sin >= 0 ? 16 : -8)} text-anchor="middle">
              cos θ
            </text>
            <text class="ge-label is-small" x={P[0] + (cos >= 0 ? -8 : 8)} y={(O[1] + P[1]) / 2} text-anchor={cos >= 0 ? 'end' : 'start'}>
              sin θ
            </text>
            {/* The sine wave unrolled beside the circle, fed by a line from P. */}
            <line class="ge-axis" x1={360} x2={630} y1={O[1]} y2={O[1]} />
            <path class="uc-wave" d={`M${Array.from({ length: 121 }, (_, i) => `${(360 + (i / 120) * 260).toFixed(1)} ${(O[1] - R * Math.sin((i / 120) * 2 * Math.PI)).toFixed(1)}`).join('L')}`} />
            <line class="ge-construct is-faint" x1={P[0]} y1={P[1]} x2={360 + ((((s.angle % 360) + 360) % 360) / 360) * 260} y2={P[1]} />
            <circle cx={360 + ((((s.angle % 360) + 360) % 360) / 360) * 260} cy={P[1]} r="5" fill="#e69f00" />
            <text class="ge-label is-small is-muted" x={630} y={O[1] + 16} text-anchor="end">
              360°
            </text>
          </svg>
        </div>
        <Readouts
          test="uc-results"
          items={[
            ['θ', `${fmt(s.angle, 4)}° = ${piFraction ?? fmt(a, 4)} rad${piFraction ? ` (${fmt(a, 4)})` : ''}`],
            ['sin θ', exact ? `${exact.sin} ≈ ${fmt(sin, 4)}` : fmt(sin, 5)],
            ['cos θ', exact ? `${exact.cos} ≈ ${fmt(cos, 4)}` : fmt(cos, 5)],
            ['tan θ', Number.isFinite(tan) && Math.abs(tan) < 1e12 ? (exact ? `${exact.tan} ≈ ${fmt(tan, 4)}` : fmt(tan, 5)) : 'undefined'],
            ['Where', `${quadrant}, reference angle ${fmt(ref, 4)}°`],
          ]}
        />
        <div class="lab-plots">
          <Plot
            title="Sine and cosine unrolled"
            test="uc-plot"
            series={[
              { name: 'sin θ', points: curve(Math.sin), color: LAB_COLORS[1] },
              { name: 'cos θ', points: curve(Math.cos), color: LAB_COLORS[0] },
            ]}
            xLabel="θ (°)"
            yLabel="value"
            xRange={[0, 360]}
            yRange={[-1.1, 1.1]}
            marker={s.angle}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ tool -- */

function GeometryLab({ toolId }: { toolId: string }) {
  const [s, setState] = usePersistentState(toolId, read, write);
  const part =
    <K extends Exclude<keyof State, 'tab'>>(key: K) =>
    (patch: Partial<State[K]>) =>
      setState((p) => ({ ...p, [key]: { ...p[key], ...patch } }));
  return (
    <section class="tool lab-tool" data-testid="tool" data-state="done">
      <LabTabs label="Topic" value={s.tab} choices={TABS} onChange={(tab) => setState((p) => ({ ...p, tab }))} />
      {s.tab === 'triangle' && <TriangleLab s={s.triangle} set={part('triangle')} />}
      {s.tab === 'polygon' && <PolygonLab s={s.polygon} set={part('polygon')} />}
      {s.tab === 'circle' && <CircleLab s={s.circle} set={part('circle')} />}
      {s.tab === 'transform' && <TransformLab s={s.transform} set={part('transform')} />}
      {s.tab === 'conic' && <ConicLab s={s.conic} set={part('conic')} />}
      {s.tab === 'unit' && <UnitLab s={s.unit} set={part('unit')} />}
    </section>
  );
}

export default defineCustomTool(GeometryLab);
