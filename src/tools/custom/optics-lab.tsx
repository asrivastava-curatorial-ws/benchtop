/**
 * Optics bench: ray diagrams for lenses and mirrors (and a pair of lenses),
 * refraction and reflection at a boundary with Fresnel's equations, a prism
 * splitting white light, single and double slits and gratings, and
 * polarisers following Malus's law.
 */
import type { TargetedPointerEvent } from 'preact';
import { useMemo, useRef } from 'preact/hooks';
import {
  brewster,
  colourCss,
  criticalAngle,
  fresnel,
  GLASSES,
  type Glass,
  gratingOrders,
  imageThrough,
  minimumDeviation,
  polarisers,
  prism,
  refractiveIndex,
  slits,
  snell,
  type ThinLens,
  thinLens,
  traceRay,
  wavelengthColour,
} from '../../lib/optics';
import { defineCustomTool, type Values } from '../types';
import { fmt, LAB_COLORS, LabTabs, mergeStored, Plot, Readouts, Slider } from './_lab';
import { Segmented, usePersistentState } from './_shared';

type Tab = 'lens' | 'refraction' | 'prism' | 'slits' | 'polar';
const TABS: readonly { readonly value: Tab; readonly label: string }[] = [
  { value: 'lens', label: 'Lenses and mirrors' },
  { value: 'refraction', label: 'Refraction' },
  { value: 'prism', label: 'Prism' },
  { value: 'slits', label: 'Slits and gratings' },
  { value: 'polar', label: 'Polarisers' },
];
type Element = 'convex' | 'concave' | 'mirror-concave' | 'mirror-convex';
type SlitMode = 'single' | 'double' | 'grating';

const MEDIA = { air: 1.0003, water: 1.333, glass: 1.5, oil: 1.47, diamond: 2.417 } as const;
const MEDIA_NAMES: Readonly<Record<keyof typeof MEDIA, string>> = { air: 'Air', water: 'Water', glass: 'Glass', oil: 'Olive oil', diamond: 'Diamond' };

const DEFAULTS = {
  tab: 'lens' as Tab,
  lens: { element: 'convex' as Element, f: 10, u: 25, h: 3, second: false, f2: 6, sep: 30 },
  refraction: { n1: 1.0003, n2: 1.5, angle: 40 },
  prism: { apex: 60, glass: 'flint' as Glass, incidence: 50, white: true, nm: 589 },
  slits: { mode: 'double' as SlitMode, nm: 532, a: 20, d: 100, lines: 600, n: 20, screen: 1 },
  polar: { analyser: 60, middle: false, middleAngle: 45 },
};
type State = typeof DEFAULTS;
type Part<K extends keyof State> = { s: State[K]; set: (patch: Partial<State[K]>) => void };

const read = (v: Values | undefined): State => {
  const s = mergeStored(DEFAULTS, v);
  const oneOf = <T extends string>(value: string, allowed: readonly T[], fallback: T): T => allowed.find((a) => a === value) ?? fallback;
  return {
    ...s,
    tab: oneOf(
      s.tab,
      TABS.map((t) => t.value),
      'lens',
    ),
    lens: { ...s.lens, element: oneOf(s.lens.element, ['convex', 'concave', 'mirror-concave', 'mirror-convex'] as const, 'convex') },
    prism: { ...s.prism, glass: oneOf(s.prism.glass, Object.keys(GLASSES) as Glass[], 'flint') },
    slits: { ...s.slits, mode: oneOf(s.slits.mode, ['single', 'double', 'grating'] as const, 'double') },
  };
};
const write = (s: State): Values => JSON.parse(JSON.stringify(s)) as Values;

const W = 640;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/* -------------------------------------------------- lenses and mirrors -- */

function LensLab({ s, set }: Part<'lens'>) {
  const mirror = s.element.startsWith('mirror');
  const f1 = s.element === 'convex' || s.element === 'mirror-concave' ? s.f : -s.f;
  const two = s.second && !mirror;
  const lenses: ThinLens[] = two
    ? [
        { x: 0, f: f1 },
        { x: s.sep, f: s.f2 },
      ]
    : [{ x: 0, f: f1 }];
  const img = imageThrough(lenses, s.u, s.h);
  const first = thinLens(f1, s.u);
  // Horizontal scale: room for the object, the focal points and a real image nearby.
  const imageX = Number.isFinite(img.x) ? img.x : Number.NaN;
  const xmin =
    Math.min(-s.u, -2 * Math.abs(f1), mirror && Number.isFinite(imageX) && imageX > 0 ? -Math.min(imageX, 150) : 0, Number.isFinite(imageX) && imageX < 0 && !mirror ? Math.max(imageX, -150) : 0) - 4;
  const xmax =
    Math.max(
      2 * Math.abs(f1),
      two ? s.sep + 2 * Math.abs(s.f2) : 0,
      !mirror && Number.isFinite(imageX) ? Math.min(Math.max(imageX, 0), 200) : 0,
      mirror && Number.isFinite(imageX) && imageX < 0 ? Math.min(-imageX, 150) : 0,
      10,
    ) + 4;
  const k = 600 / (xmax - xmin);
  const X = (x: number) => 20 + (x - xmin) * k;
  const H = 300;
  const axis = 150;
  const shownH = Math.max(s.h, Math.min(Math.abs(img.h), 4 * s.h));
  const kv = 110 / shownH;
  const Y = (y: number) => axis - y * kv;
  // Mirrors are drawn unfolded: what leaves the mirror is reflected back to the left.
  const fold = (x: number) => (mirror && x > 0 ? -x : x);
  const segment = (p: readonly [number, number], q: readonly [number, number]) => `M${X(fold(p[0])).toFixed(1)} ${Y(p[1]).toFixed(1)}L${X(fold(q[0])).toFixed(1)} ${Y(q[1]).toFixed(1)}`;
  const slopes = [0, -s.h / s.u, Math.abs(s.u - f1) > 1e-9 ? -s.h / (s.u - f1) : null];
  const reach = mirror ? -xmin + 2 : xmax + 2;
  const last = lenses[lenses.length - 1] ?? { x: 0, f: f1 };
  const virtual = Number.isFinite(img.x) && img.x < last.x;
  const rays = slopes.map((slope, i) => {
    if (slope === null) return null;
    const { points, slope: out } = traceRay(lenses, -s.u, s.h, slope, reach);
    const pathD = points
      .slice(1)
      .map((p, j) => segment(points[j] ?? p, p))
      .join('');
    const exit = points[points.length - 2] ?? [0, 0];
    // A virtual image sits where the outgoing rays seem to come from: draw that dashed.
    const back = virtual && Number.isFinite(img.x) ? segment(exit, [img.x, exit[1] + out * (img.x - exit[0])]) : '';
    return (
      <g key={i} style={{ color: LAB_COLORS[[5, 0, 2][i] ?? 0] }}>
        <path d={pathD} class="op-ray" />
        {back && <path d={back} class="op-ray is-virtual" />}
      </g>
    );
  });
  const lensShape = (x: number, f: number) => {
    const px = X(x);
    const top = axis - 120;
    const bottom = axis + 120;
    const bulge = 14;
    return f > 0 ? (
      <path class="op-lens" d={`M${px} ${top}Q${px + bulge * 2} ${axis} ${px} ${bottom}Q${px - bulge * 2} ${axis} ${px} ${top}Z`} />
    ) : (
      <path class="op-lens" d={`M${px - 10} ${top}H${px + 10}Q${px + 2} ${axis} ${px + 10} ${bottom}H${px - 10}Q${px - 2} ${axis} ${px - 10} ${top}Z`} />
    );
  };
  const mirrorShape = () => {
    const px = X(0);
    // The vertex sits on the line where the rays turn; a concave mirror's edges lean towards the light.
    const sag = s.element === 'mirror-concave' ? 16 : -16;
    const edge = px - sag;
    return (
      <g>
        <path class="op-mirror-back" d={`M${edge} ${axis - 120}Q${px + sag} ${axis} ${edge} ${axis + 120}l8 0Q${px + sag + 8} ${axis} ${edge + 8} ${axis - 120}Z`} />
        <path class="op-mirror" d={`M${edge} ${axis - 120}Q${px + sag} ${axis} ${edge} ${axis + 120}`} />
      </g>
    );
  };
  const focal = (x: number, label: string) => (
    <g key={label}>
      <circle cx={X(x)} cy={axis} r="3" fill="var(--text)" />
      <text class="lab-label is-muted" x={X(x)} y={axis + 16} text-anchor="middle">
        {label}
      </text>
    </g>
  );
  const marks = mirror
    ? [focal(-Math.abs(f1) * Math.sign(f1), 'F'), focal(-2 * Math.abs(f1) * Math.sign(f1), 'C')]
    : [focal(f1, 'F′'), focal(-f1, 'F'), focal(2 * f1, '2F′'), focal(-2 * f1, '2F'), ...(two ? [focal(s.sep + s.f2, 'F₂′'), focal(s.sep - s.f2, 'F₂')] : [])];
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef(false);
  const onMove = (e: TargetedPointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const ctm = svg.current?.getScreenCTM();
    if (!ctm) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const x = xmin + (p.x - 20) / k;
    const h = (axis - p.y) / kv;
    set({ u: Math.round(Math.min(150, Math.max(1, -x)) * 2) / 2, h: Math.round(Math.min(15, Math.max(0.5, h)) * 10) / 10 });
  };
  const imgX = mirror ? -img.x : img.x;
  const showImage = Number.isFinite(img.x) && Math.abs(img.x) < 1000;
  const nature = !Number.isFinite(img.x)
    ? 'none: the rays leave parallel (object at the focal point)'
    : [virtual ? 'virtual' : 'real', img.m < 0 ? 'inverted' : 'upright', Math.abs(Math.abs(img.m) - 1) < 1e-6 ? 'same size' : Math.abs(img.m) > 1 ? 'magnified' : 'diminished'].join(', ');
  const where = !Number.isFinite(img.x)
    ? 'at infinity'
    : mirror
      ? img.x > 0
        ? `${fmt(img.x, 4)} cm in front of the mirror`
        : `${fmt(-img.x, 4)} cm behind the mirror`
      : img.x >= last.x
        ? `${fmt(img.x - last.x, 4)} cm beyond the ${two ? 'second ' : ''}lens`
        : `${fmt(last.x - img.x, 4)} cm in front of the ${two ? 'second ' : ''}lens`;
  const combined = two ? 1 / (1 / f1 + 1 / s.f2 - s.sep / (f1 * s.f2)) : f1;
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <select class="input" aria-label="Lens or mirror" value={s.element} onChange={(e) => set({ element: e.currentTarget.value as Element })} data-testid="op-element">
          <option value="convex">Converging (convex) lens</option>
          <option value="concave">Diverging (concave) lens</option>
          <option value="mirror-concave">Concave mirror</option>
          <option value="mirror-convex">Convex mirror</option>
        </select>
        <Slider label="Focal length" value={s.f} min={2} max={50} step={0.5} unit="cm" onChange={(f) => set({ f })} test="op-f" />
        <Slider label="Object distance" value={s.u} min={1} max={150} step={0.5} unit="cm" onChange={(u) => set({ u })} test="op-u" />
        <Slider label="Object height" value={s.h} min={0.5} max={15} step={0.1} unit="cm" onChange={(h) => set({ h })} />
        {!mirror && (
          <>
            <label class="ms-check">
              <input type="checkbox" checked={s.second} onChange={(e) => set({ second: e.currentTarget.checked })} data-testid="op-second" /> Add a second lens
            </label>
            {s.second && (
              <>
                <Slider label="Its focal length" value={s.f2} min={-50} max={50} step={0.5} unit="cm" onChange={(f2) => set({ f2: f2 === 0 ? 0.5 : f2 })} />
                <Slider label="Lens spacing" value={s.sep} min={1} max={150} step={0.5} unit="cm" onChange={(sep) => set({ sep })} />
              </>
            )}
          </>
        )}
        <p class="lab-note">Drag the object’s arrow to move it. Dashed lines lead back to a virtual image.</p>
      </div>
      <div class="lab-stage">
        <svg
          ref={svg}
          class="lab-scene op-scene"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Ray diagram"
          data-testid="op-scene"
          onPointerMove={onMove}
          onPointerUp={() => {
            drag.current = false;
          }}
        >
          <line class="lab-faint" x1={0} x2={W} y1={axis} y2={axis} />
          {mirror ? mirrorShape() : lenses.map((l) => <g key={l.x}>{lensShape(l.x, l.f)}</g>)}
          {marks}
          {rays}
          <g
            class="op-object"
            onPointerDown={(e) => {
              drag.current = true;
              svg.current?.setPointerCapture(e.pointerId);
            }}
            data-testid="op-object"
          >
            <line x1={X(-s.u)} x2={X(-s.u)} y1={axis} y2={Y(s.h)} />
            <path d={`M${X(-s.u)} ${Y(s.h) - 2}l-6 10h12Z`} />
            <circle cx={X(-s.u)} cy={Y(s.h)} r="12" class="op-handle" />
          </g>
          {showImage && (
            <g class={`op-image${virtual ? ' is-virtual' : ''}`} data-testid="op-image">
              <line x1={X(imgX)} x2={X(imgX)} y1={axis} y2={Y(img.h)} />
              <path d={img.h >= 0 ? `M${X(imgX)} ${Y(img.h) - 2}l-6 10h12Z` : `M${X(imgX)} ${Y(img.h) + 2}l-6 -10h12Z`} />
            </g>
          )}
        </svg>
        <Readouts
          test="op-results"
          items={[
            ['Image', where],
            ['Magnification', Number.isFinite(img.m) ? `${fmt(img.m, 4)} ×` : '—'],
            ['Image height', Number.isFinite(img.h) ? `${fmt(img.h, 4)} cm` : '—'],
            ['It is', nature],
            ...(two
              ? ([
                  ['First lens’s image', Number.isFinite(first.v) ? `${fmt(first.v, 4)} cm beyond it` : 'at infinity'],
                  ['The pair’s focal length', `${fmt(combined, 4)} cm`],
                ] as [string, string][])
              : ([['Power', `${fmt(100 / f1, 4)} dioptres`]] as [string, string][])),
          ]}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ refraction -- */

function RefractionLab({ s, set }: Part<'refraction'>) {
  const t1 = rad(s.angle);
  const t2 = snell(s.n1, s.n2, t1);
  const fr = fresnel(s.n1, s.n2, t1);
  const crit = criticalAngle(s.n1, s.n2);
  const o = { x: 320, y: 170 };
  const len = 160;
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef(false);
  const onPointer = (e: TargetedPointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const ctm = svg.current?.getScreenCTM();
    if (!ctm) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const a = deg(Math.atan2(o.x - p.x, o.y - p.y));
    set({ angle: Math.round(Math.min(89.5, Math.max(0, a)) * 2) / 2 });
  };
  const curve = useMemo(() => {
    const rs: [number, number][] = [];
    const rp: [number, number][] = [];
    const r: [number, number][] = [];
    for (let a = 0; a <= 90; a += 0.5) {
      const f = fresnel(s.n1, s.n2, rad(Math.min(a, 89.999)));
      rs.push([a, f.rs * 100]);
      rp.push([a, f.rp * 100]);
      r.push([a, f.r * 100]);
    }
    return { rs, rp, r };
  }, [s.n1, s.n2]);
  const tint = (n: number) => `color-mix(in srgb, #56B4E9 ${Math.round(Math.min(60, (n - 1) * 45))}%, transparent)`;
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <Slider label="Angle of incidence" value={s.angle} min={0} max={89.5} step={0.5} unit="°" onChange={(angle) => set({ angle })} test="rf-angle" />
        <h3>Light comes from</h3>
        <Segmented
          label="First medium"
          value={(Object.keys(MEDIA) as (keyof typeof MEDIA)[]).find((m) => MEDIA[m] === s.n1) ?? ('' as keyof typeof MEDIA)}
          choices={(Object.keys(MEDIA) as (keyof typeof MEDIA)[]).map((m) => ({ value: m, label: MEDIA_NAMES[m] }))}
          onChange={(m) => set({ n1: MEDIA[m] })}
        />
        <Slider label="Index n₁" value={s.n1} min={1} max={2.6} step={0.001} onChange={(n1) => set({ n1 })} test="rf-n1" />
        <h3>Into</h3>
        <Segmented
          label="Second medium"
          value={(Object.keys(MEDIA) as (keyof typeof MEDIA)[]).find((m) => MEDIA[m] === s.n2) ?? ('' as keyof typeof MEDIA)}
          choices={(Object.keys(MEDIA) as (keyof typeof MEDIA)[]).map((m) => ({ value: m, label: MEDIA_NAMES[m] }))}
          onChange={(m) => set({ n2: MEDIA[m] })}
        />
        <Slider label="Index n₂" value={s.n2} min={1} max={2.6} step={0.001} onChange={(n2) => set({ n2 })} test="rf-n2" />
        <p class="lab-note">Drag the incoming ray to change its angle. A ray’s strength shows how much light goes each way.</p>
      </div>
      <div class="lab-stage">
        <svg
          ref={svg}
          class="lab-scene"
          viewBox={`0 0 ${W} 340`}
          role="img"
          aria-label="Light refracting at a boundary"
          data-testid="rf-scene"
          onPointerDown={(e) => {
            drag.current = true;
            svg.current?.setPointerCapture(e.pointerId);
            onPointer(e);
          }}
          onPointerMove={onPointer}
          onPointerUp={() => {
            drag.current = false;
          }}
        >
          <rect x={0} y={0} width={W} height={o.y} fill={tint(s.n1)} />
          <rect x={0} y={o.y} width={W} height={340 - o.y} fill={tint(s.n2)} />
          <line class="lab-ink" x1={0} x2={W} y1={o.y} y2={o.y} />
          <line class="lab-faint" x1={o.x} x2={o.x} y1={10} y2={330} stroke-dasharray="5 4" />
          <text class="lab-label" x={14} y={24}>
            n₁ = {fmt(s.n1, 4)}
          </text>
          <text class="lab-label" x={14} y={o.y + 24}>
            n₂ = {fmt(s.n2, 4)}
          </text>
          <line class="op-beam" x1={o.x - len * Math.sin(t1)} y1={o.y - len * Math.cos(t1)} x2={o.x} y2={o.y} stroke-width="4" />
          <line class="op-beam" x1={o.x} y1={o.y} x2={o.x + len * Math.sin(t1)} y2={o.y - len * Math.cos(t1)} stroke-width={1 + 3 * fr.r} opacity={0.2 + 0.8 * fr.r} data-testid="rf-reflected" />
          {t2 !== null && (
            <line class="op-beam" x1={o.x} y1={o.y} x2={o.x + len * Math.sin(t2)} y2={o.y + len * Math.cos(t2)} stroke-width={1 + 3 * fr.t} opacity={0.2 + 0.8 * fr.t} data-testid="rf-refracted" />
          )}
          <path class="lab-dash" d={`M${o.x} ${o.y - 50}A50 50 0 0 0 ${o.x - 50 * Math.sin(t1)} ${o.y - 50 * Math.cos(t1)}`} />
          <text class="lab-label" x={o.x - 70 * Math.sin(t1 / 2) - 10} y={o.y - 70 * Math.cos(t1 / 2)}>
            {fmt(s.angle, 3)}°
          </text>
          {t2 !== null && (
            <>
              <path class="lab-dash" d={`M${o.x} ${o.y + 50}A50 50 0 0 0 ${o.x + 50 * Math.sin(t2)} ${o.y + 50 * Math.cos(t2)}`} />
              <text class="lab-label" x={o.x + 70 * Math.sin(t2 / 2) + 16} y={o.y + 70 * Math.cos(t2 / 2) + 4}>
                {fmt(deg(t2), 3)}°
              </text>
            </>
          )}
        </svg>
        <Readouts
          test="rf-results"
          items={[
            ['Refracted at', t2 === null ? 'none: total internal reflection' : `${fmt(deg(t2), 4)}°`],
            ['Reflected', `${fmt(fr.r * 100, 3)} %`],
            ['Passes through', `${fmt(fr.t * 100, 3)} %`],
            ['Critical angle', crit === null ? 'none (light goes into a denser medium)' : `${fmt(deg(crit), 4)}°`],
            ['Brewster’s angle (reflection fully polarised)', `${fmt(deg(brewster(s.n1, s.n2)), 4)}°`],
          ]}
        />
        <div class="lab-plots">
          <Plot
            title="How much is reflected"
            series={[
              { name: 's-polarised', points: curve.rs },
              { name: 'p-polarised', points: curve.rp },
              { name: 'unpolarised', points: curve.r, dashed: true },
            ]}
            xLabel="angle of incidence (°)"
            yLabel="reflected (%)"
            xRange={[0, 90]}
            yRange={[0, 100]}
            marker={s.angle}
          />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- prism -- */

const WHITE = [400, 440, 480, 520, 560, 600, 640, 690];

function PrismLab({ s, set }: Part<'prism'>) {
  const A = rad(s.apex);
  const i1 = rad(s.incidence);
  const apex = { x: 320, y: 46 };
  const L = 250;
  const h = A / 2;
  const left = { x: apex.x - L * Math.sin(h), y: apex.y + L * Math.cos(h) };
  const right = { x: apex.x + L * Math.sin(h), y: apex.y + L * Math.cos(h) };
  const nIn = { x: Math.cos(h), y: Math.sin(h) };
  const nOut = { x: Math.cos(h), y: -Math.sin(h) };
  const rot = (v: { x: number; y: number }, a: number) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
  const q1 = { x: apex.x + 0.55 * (left.x - apex.x), y: apex.y + 0.55 * (left.y - apex.y) };
  const dIn = rot(nIn, -i1);
  const trace = (nm: number) => {
    const n = refractiveIndex(s.glass, nm);
    const p = prism(A, n, i1);
    const d1 = rot(nIn, -p.r1);
    // Where the ray inside meets the second face (apex → right corner).
    const ex = right.x - apex.x;
    const ey = right.y - apex.y;
    const det = d1.x * -ey - d1.y * -ex;
    const t = ((apex.x - q1.x) * -ey - (apex.y - q1.y) * -ex) / det;
    const q2 = { x: q1.x + t * d1.x, y: q1.y + t * d1.y };
    const dOut = p.exit === null ? null : rot(nOut, p.exit);
    return { nm, n, p, q2, dOut };
  };
  const waves = s.white ? WHITE : [s.nm];
  const traced = waves.map(trace);
  const yellow = trace(s.white ? 589 : s.nm);
  const min = minimumDeviation(A, yellow.n);
  const curve = useMemo(() => {
    const out: [number, number][] = [];
    for (let a = 0; a <= 90; a += 0.25) {
      const d = prism(A, yellow.n, rad(a)).deviation;
      if (d !== null) out.push([a, deg(d)]);
    }
    return out;
  }, [s.apex, s.glass, yellow.n]);
  const exits = traced.filter((t) => t.p.exit !== null);
  const spread = exits.length > 1 ? deg((exits[0]?.p.exit ?? 0) - (exits[exits.length - 1]?.p.exit ?? 0)) : 0;
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <select class="input" aria-label="Glass" value={s.glass} onChange={(e) => set({ glass: e.currentTarget.value as Glass })} data-testid="pr-glass">
          {(Object.keys(GLASSES) as Glass[]).map((g) => (
            <option key={g} value={g}>
              {GLASSES[g].name}
            </option>
          ))}
        </select>
        <Slider label="Prism angle" value={s.apex} min={20} max={80} step={0.5} unit="°" onChange={(a) => set({ apex: a })} />
        <Slider label="Angle of incidence" value={s.incidence} min={0} max={89} step={0.5} unit="°" onChange={(incidence) => set({ incidence })} test="pr-incidence" />
        <Segmented
          label="Light"
          value={s.white ? 'white' : 'one'}
          choices={[
            { value: 'white', label: 'White light' },
            { value: 'one', label: 'One colour' },
          ]}
          onChange={(v) => set({ white: v === 'white' })}
        />
        {!s.white && <Slider label="Wavelength" value={s.nm} min={380} max={750} step={1} unit="nm" onChange={(nm) => set({ nm })} />}
        <div class="button-row">
          <button type="button" class="button button-small" onClick={() => set({ incidence: Math.round(deg(min.incidence) * 2) / 2 })} data-testid="pr-min">
            Set for least deviation
          </button>
        </div>
      </div>
      <div class="lab-stage">
        <svg class="lab-scene op-dark" viewBox={`0 0 ${W} 340`} role="img" aria-label="Light through a prism" data-testid="pr-scene">
          <path class="op-prism" d={`M${apex.x} ${apex.y}L${right.x} ${right.y}L${left.x} ${left.y}Z`} />
          <line x1={q1.x - dIn.x * 300} y1={q1.y - dIn.y * 300} x2={q1.x} y2={q1.y} stroke={s.white ? '#fff' : colourCss(s.nm)} stroke-width="3" />
          {traced.map((t) => (
            <g key={t.nm}>
              <line x1={q1.x} y1={q1.y} x2={t.q2.x} y2={t.q2.y} stroke={colourCss(t.nm)} stroke-width={s.white ? 1.4 : 3} opacity="0.9" />
              {t.dOut && <line x1={t.q2.x} y1={t.q2.y} x2={t.q2.x + t.dOut.x * 400} y2={t.q2.y + t.dOut.y * 400} stroke={colourCss(t.nm)} stroke-width={s.white ? 2.5 : 3} />}
            </g>
          ))}
          {traced.some((t) => !t.dOut) && (
            <text class="lab-label" x={320} y={330} text-anchor="middle" style={{ fill: '#fff' }}>
              Totally reflected inside at the second face
            </text>
          )}
        </svg>
        <Readouts
          test="pr-results"
          items={[
            [`Index at ${s.white ? 589 : s.nm} nm`, fmt(yellow.n, 5)],
            ['Deviation', yellow.p.deviation === null ? 'none: it does not come out' : `${fmt(deg(yellow.p.deviation), 4)}°`],
            ['Least deviation', `${fmt(deg(min.deviation), 4)}° at ${fmt(deg(min.incidence), 4)}° incidence`],
            ...(s.white ? ([['Spread from violet to red', `${fmt(spread, 3)}°`]] as [string, string][]) : []),
          ]}
        />
        <div class="lab-plots">
          <Plot
            title="Deviation against angle of incidence"
            series={[{ name: 'deviation', points: curve }]}
            xLabel="incidence (°)"
            yLabel="deviation (°)"
            xRange={[0, 90]}
            points={yellow.p.deviation === null ? [] : [{ x: s.incidence, y: deg(yellow.p.deviation), live: true }]}
          />
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------- slits and gratings -- */

function stripImage(values: readonly number[], nm: number): string {
  if (typeof document === 'undefined') return '';
  const el = document.createElement('canvas');
  el.width = values.length;
  el.height = 1;
  const ctx = el.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(values.length, 1);
  const [r, g, b] = wavelengthColour(nm);
  values.forEach((v, i) => {
    const k = Math.min(1, Math.max(0, v)) ** 0.6;
    img.data[4 * i] = r * k;
    img.data[4 * i + 1] = g * k;
    img.data[4 * i + 2] = b * k;
    img.data[4 * i + 3] = 255;
  });
  ctx.putImageData(img, 0, 0);
  return el.toDataURL();
}

function SlitsLab({ s, set }: Part<'slits'>) {
  const lambda = s.nm / 1000; // µm
  const grating = s.mode === 'grating';
  const d = grating ? 1000 / s.lines : s.d; // µm
  const a = grating ? Math.min(d * 0.4, s.a) : s.a;
  const n = s.mode === 'single' ? 1 : s.mode === 'double' ? 2 : s.n;
  const samples = 801;
  // Position on the screen (mm) for slits; angle (°) for a grating.
  const span = grating
    ? 90
    : s.mode === 'single'
      ? s.screen * 1000 * Math.tan(Math.asin(Math.min(0.99, (3.5 * lambda) / a)))
      : s.screen * 1000 * Math.tan(Math.asin(Math.min(0.99, (1.3 * lambda) / a)));
  const pattern = useMemo(() => {
    const out: [number, number][] = [];
    for (let i = 0; i < samples; i++) {
      const x = -span + (2 * span * i) / (samples - 1);
      const theta = grating ? rad(x) : Math.atan(x / (s.screen * 1000));
      out.push([x, slits(theta, lambda, a, d, n)]);
    }
    return out;
  }, [s.mode, s.nm, s.a, s.d, s.lines, s.n, s.screen]);
  const image = useMemo(
    () =>
      stripImage(
        pattern.map((p) => p[1]),
        s.nm,
      ),
    [pattern, s.nm],
  );
  const envelope = s.mode !== 'single' ? pattern.map(([x]) => [x, slits(grating ? rad(x) : Math.atan(x / (s.screen * 1000)), lambda, a, d, 1)] as const) : [];
  const orders = grating ? gratingOrders(lambda, d) : [];
  const items: [string, string][] = [];
  if (s.mode === 'single') {
    items.push(['First dark fringe at', `${fmt(deg(Math.asin(Math.min(1, lambda / a))), 4)}°`]);
    items.push(['Width of the central bright band', `${fmt(2 * s.screen * 1000 * Math.tan(Math.asin(Math.min(0.999, lambda / a))), 4)} mm`]);
  } else if (s.mode === 'double') {
    items.push(['Fringe spacing λL/d', `${fmt((lambda * s.screen * 1000) / d, 4)} mm`]);
    items.push(['Bright fringes in the central band', String(Math.max(1, 2 * Math.ceil(d / a - 1e-9) - 1))]);
    if (Number.isInteger(Math.round((d / a) * 1e6) / 1e6)) items.push(['Missing orders', `every ${fmt(d / a, 3)}th (they fall on a dark fringe of each slit)`]);
  } else {
    items.push(['Line spacing', `${fmt(d, 4)} µm`]);
    items.push(['Orders', orders.map((o) => `${o.m}: ${fmt(deg(o.angle), 4)}°`).join(', ')]);
    items.push(['Resolving power (first order)', `${fmt(s.n, 4)} (with ${s.n} lines lit)`]);
  }
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <Segmented
          label="Aperture"
          value={s.mode}
          choices={[
            { value: 'single', label: 'Single slit' },
            { value: 'double', label: 'Double slit' },
            { value: 'grating', label: 'Grating' },
          ]}
          onChange={(mode) => set({ mode })}
        />
        <Slider label="Wavelength" value={s.nm} min={380} max={750} step={1} unit="nm" onChange={(nm) => set({ nm })} test="sl-nm" />
        <Slider label="Slit width" value={s.a} min={1} max={200} step={0.5} unit="µm" onChange={(v) => set({ a: v })} test="sl-a" />
        {s.mode === 'double' && <Slider label="Slit spacing" value={s.d} min={5} max={500} step={0.5} unit="µm" onChange={(v) => set({ d: Math.max(v, s.a) })} test="sl-d" />}
        {grating && (
          <>
            <Slider label="Lines per mm" value={s.lines} min={50} max={1800} step={10} onChange={(lines) => set({ lines })} test="sl-lines" />
            <Slider label="Lines lit" value={s.n} min={2} max={200} step={1} onChange={(v) => set({ n: v })} />
          </>
        )}
        {!grating && <Slider label="Screen distance" value={s.screen} min={0.2} max={5} step={0.1} unit="m" onChange={(screen) => set({ screen })} />}
      </div>
      <div class="lab-stage">
        <svg class="lab-scene op-dark" viewBox={`0 0 ${W} 90`} role="img" aria-label="Pattern on the screen" data-testid="sl-screen">
          {image && <image href={image} x={0} y={0} width={W} height={90} preserveAspectRatio="none" />}
        </svg>
        <Readouts test="sl-results" items={items} />
        <div class="lab-plots">
          <Plot
            title="Brightness across the screen"
            test="sl-plot"
            series={[
              { name: 'pattern', points: pattern, color: `color-mix(in srgb, ${colourCss(Math.min(700, Math.max(420, s.nm)))} 70%, var(--text))` },
              ...(envelope.length ? [{ name: 'one slit alone', points: envelope, dashed: true, color: 'var(--muted)' }] : []),
            ]}
            xLabel={grating ? 'angle (°)' : 'position on the screen (mm)'}
            yLabel="relative brightness"
            yRange={[0, 1.05]}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ polarisers -- */

function PolarLab({ s, set }: Part<'polar'>) {
  const angles = s.middle ? [0, s.middleAngle, s.analyser] : [0, s.analyser];
  const out = polarisers(1, angles);
  const final = out[out.length - 1] ?? 0;
  const curve = useMemo(() => {
    const pts: [number, number][] = [];
    for (let a = 0; a <= 360; a += 2) {
      const r = polarisers(1, s.middle ? [0, s.middleAngle, a] : [0, a]);
      pts.push([a, (r[r.length - 1] ?? 0) * 100]);
    }
    return pts;
  }, [s.middle, s.middleAngle]);
  const stations = s.middle ? [200, 340, 480] : [220, 440];
  const beam = (x1: number, x2: number, intensity: number, axis: number | null, key: string) => (
    <g key={key}>
      <rect x={x1} y={140} width={x2 - x1} height={40} fill="#E69F00" opacity={0.08 + 0.85 * intensity} />
      {axis === null ? (
        <g class="lab-faint">
          {[0, 45, 90, 135].map((a) => (
            <line
              key={a}
              x1={(x1 + x2) / 2 - 16 * Math.sin(rad(a))}
              y1={160 - 16 * Math.cos(rad(a))}
              x2={(x1 + x2) / 2 + 16 * Math.sin(rad(a))}
              y2={160 + 16 * Math.cos(rad(a))}
              stroke="var(--text)"
              stroke-width="1.5"
            />
          ))}
        </g>
      ) : (
        intensity > 1e-4 && (
          <line
            x1={(x1 + x2) / 2 - 20 * Math.sin(rad(axis)) * Math.sqrt(intensity * 2)}
            y1={160 - 20 * Math.cos(rad(axis)) * Math.sqrt(intensity * 2)}
            x2={(x1 + x2) / 2 + 20 * Math.sin(rad(axis)) * Math.sqrt(intensity * 2)}
            y2={160 + 20 * Math.cos(rad(axis)) * Math.sqrt(intensity * 2)}
            stroke="var(--text)"
            stroke-width="2.5"
          />
        )
      )}
    </g>
  );
  const parts = [beam(40, stations[0] ?? 0, 1, null, 'in')];
  stations.forEach((x, i) => {
    const next = stations[i + 1] ?? 600;
    parts.push(beam(x + 10, next - (i + 1 < stations.length ? 0 : 0), out[i] ?? 0, angles[i] ?? 0, `b${i}`));
  });
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <Slider label="Second polariser" value={s.analyser} min={0} max={180} step={1} unit="°" onChange={(analyser) => set({ analyser })} test="po-angle" />
        <label class="ms-check">
          <input type="checkbox" checked={s.middle} onChange={(e) => set({ middle: e.currentTarget.checked })} data-testid="po-middle" /> Put another polariser between them
        </label>
        {s.middle && <Slider label="Middle polariser" value={s.middleAngle} min={0} max={180} step={1} unit="°" onChange={(middleAngle) => set({ middleAngle })} />}
        <p class="lab-note">The first polariser passes the upright half of unpolarised light. Angles are measured from upright.</p>
      </div>
      <div class="lab-stage">
        <svg class="lab-scene" viewBox={`0 0 ${W} 300`} role="img" aria-label="Light through polarisers" data-testid="po-scene">
          <circle cx={30} cy={160} r={16} fill="#E69F00" />
          {parts}
          {stations.map((x, i) => (
            <g key={x}>
              <ellipse cx={x + 5} cy={160} rx={14} ry={70} class="op-polariser" />
              <line
                x1={x + 5 - 9 * Math.sin(rad(angles[i] ?? 0))}
                y1={160 - 62 * Math.cos(rad(angles[i] ?? 0))}
                x2={x + 5 + 9 * Math.sin(rad(angles[i] ?? 0))}
                y2={160 + 62 * Math.cos(rad(angles[i] ?? 0))}
                stroke="var(--text)"
                stroke-width="2"
              />
              <text class="lab-label is-muted" x={x + 5} y={252} text-anchor="middle">
                {fmt(angles[i] ?? 0, 3)}°
              </text>
            </g>
          ))}
          <rect x={600} y={130} width={26} height={60} rx={4} class="lab-solid" />
          <text class="lab-label" x={613} y={210} text-anchor="middle">
            {fmt(final * 100, 3)} %
          </text>
        </svg>
        <Readouts
          test="po-results"
          items={[
            ...out.map((v, i) => [`After polariser ${i + 1} (${fmt(angles[i] ?? 0, 3)}°)`, `${fmt(v * 100, 4)} %`] as [string, string]),
            ['Malus’s law', 'I = I₁ cos² θ for each polariser after the first'],
          ]}
        />
        <div class="lab-plots">
          <Plot
            title="Light getting through against the second polariser’s angle"
            test="po-plot"
            series={[{ name: 'through', points: curve }]}
            xLabel="second polariser (°)"
            yLabel="% of the light"
            xRange={[0, 360]}
            marker={s.analyser}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ tool -- */

function OpticsLab({ toolId }: { toolId: string }) {
  const [s, setState] = usePersistentState(toolId, read, write);
  const part =
    <K extends Exclude<keyof State, 'tab'>>(key: K) =>
    (patch: Partial<State[K]>) =>
      setState((p) => ({ ...p, [key]: { ...p[key], ...patch } }));
  return (
    <section class="tool lab-tool" data-testid="tool" data-state="done">
      <LabTabs label="Experiment" value={s.tab} choices={TABS} onChange={(tab) => setState((p) => ({ ...p, tab }))} />
      {s.tab === 'lens' && <LensLab s={s.lens} set={part('lens')} />}
      {s.tab === 'refraction' && <RefractionLab s={s.refraction} set={part('refraction')} />}
      {s.tab === 'prism' && <PrismLab s={s.prism} set={part('prism')} />}
      {s.tab === 'slits' && <SlitsLab s={s.slits} set={part('slits')} />}
      {s.tab === 'polar' && <PolarLab s={s.polar} set={part('polar')} />}
    </section>
  );
}

export default defineCustomTool(OpticsLab);
