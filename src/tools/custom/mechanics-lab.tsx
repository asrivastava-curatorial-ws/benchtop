/**
 * Mechanics lab: projectiles (with air drag), the pendulum, a driven spring–
 * mass–damper, collisions on an air track, planetary orbits, a block on an
 * incline, levers and pulleys, and adding forces — each animated, with
 * read-outs and plots.
 */
import type { TargetedPointerEvent } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  collide,
  type Flight,
  flight,
  idealFlight,
  incline,
  lever,
  MU_SUN,
  magnification,
  orbitElements,
  orbitStep,
  oscillator,
  oscillatorInfo,
  pendulum,
  pendulumPeriod,
  resultant,
  rk4,
  tackle,
} from '../../lib/physics-lab';
import { niceStep } from '../../lib/svg-chart';
import { defineCustomTool, type Values } from '../types';
import { Arrow, fmt, LAB_COLORS, LabTabs, mergeStored, NumberBox, Plot, Readouts, Slider, useClock } from './_lab';
import { Segmented, usePersistentState } from './_shared';

type Tab = 'projectile' | 'pendulum' | 'spring' | 'collision' | 'orbit' | 'incline' | 'machines' | 'forces';
const TABS: readonly { readonly value: Tab; readonly label: string }[] = [
  { value: 'projectile', label: 'Projectile' },
  { value: 'pendulum', label: 'Pendulum' },
  { value: 'spring', label: 'Spring and damper' },
  { value: 'collision', label: 'Collisions' },
  { value: 'orbit', label: 'Orbits' },
  { value: 'incline', label: 'Incline and friction' },
  { value: 'machines', label: 'Levers and pulleys' },
  { value: 'forces', label: 'Adding forces' },
];

const GRAVITY = { earth: 9.80665, moon: 1.62, mars: 3.71, jupiter: 24.79 } as const;
/** Air density relative to Earth's at sea level (Jupiter: at the 1 bar level). */
const AIR = { earth: 1, moon: 0, mars: 0.0167, jupiter: 0.13 } as const;
type Planet = keyof typeof GRAVITY;
const PLANETS: readonly { readonly value: Planet; readonly label: string }[] = [
  { value: 'earth', label: 'Earth' },
  { value: 'moon', label: 'Moon' },
  { value: 'mars', label: 'Mars' },
  { value: 'jupiter', label: 'Jupiter' },
];
/** Drag over mass, k/m = ½ρC_dA/m, for balls in Earth's air (per metre). */
const BALLS = {
  none: { label: 'No air', k: 0 },
  shot: { label: 'Shot put (7.26 kg)', k: 0.00047 },
  cricket: { label: 'Cricket ball', k: 0.0061 },
  football: { label: 'Football', k: 0.0133 },
  tennis: { label: 'Tennis ball', k: 0.0204 },
  pingpong: { label: 'Table-tennis ball', k: 0.14 },
} as const;
type Ball = keyof typeof BALLS;

interface Force {
  readonly size: number;
  readonly angle: number;
}

const DEFAULTS = {
  tab: 'projectile' as Tab,
  projectile: { v0: 25, angle: 45, h0: 0, planet: 'earth' as Planet, ball: 'none' as Ball },
  pendulum: { length: 1, amplitude: 30, planet: 'earth' as Planet, damping: 0 },
  spring: { m: 1, k: 100, c: 1, F0: 0, f: 1.5, x0: 0.1 },
  collision: { m1: 1, u1: 2, m2: 1, u2: -1, e: 1 },
  orbit: { star: 1, r0: 1, speed: 1.2, rate: 0.5, areas: true },
  incline: { angle: 30, muS: 0.5, muK: 0.4, m: 5, push: 0 },
  machines: { kind: 'lever' as 'lever' | 'pulleys', fulcrum: 1, load: 0.4, effort: 3.6, weight: 600, strands: 4, pulleyLoad: 1000, efficiency: 90, pulled: 0 },
  forces: {
    list: [
      { size: 40, angle: 0 },
      { size: 30, angle: 90 },
      { size: 25, angle: 220 },
    ] as readonly Force[],
    polygon: true,
  },
};
type State = typeof DEFAULTS;
type Part<K extends keyof State> = { s: State[K]; set: (patch: Partial<State[K]>) => void };

const read = (v: Values | undefined): State => {
  const s = mergeStored(DEFAULTS, v);
  const oneOf = <T extends string>(value: string, allowed: readonly T[], fallback: T): T => allowed.find((a) => a === value) ?? fallback;
  const planets = PLANETS.map((p) => p.value);
  const forces = (Array.isArray(s.forces.list) ? s.forces.list : [])
    .filter((f): f is Force => typeof f === 'object' && f !== null && Number.isFinite((f as Force).size) && Number.isFinite((f as Force).angle))
    .slice(0, 4)
    .map((f) => ({ size: f.size, angle: f.angle }));
  return {
    ...s,
    tab: oneOf(
      s.tab,
      TABS.map((t) => t.value),
      'projectile',
    ),
    projectile: { ...s.projectile, planet: oneOf(s.projectile.planet, planets, 'earth'), ball: oneOf(s.projectile.ball, Object.keys(BALLS) as Ball[], 'none') },
    pendulum: { ...s.pendulum, planet: oneOf(s.pendulum.planet, planets, 'earth') },
    machines: { ...s.machines, kind: oneOf(s.machines.kind, ['lever', 'pulleys'] as const, 'lever') },
    forces: { ...s.forces, list: forces.length ? forces : DEFAULTS.forces.list },
  };
};
const write = (s: State): Values => JSON.parse(JSON.stringify(s)) as Values;

const W = 640;
const H = 360;
const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;
const KM_S_PER_AU_YR = 4.740470464;

function Ticks({ x0, y0, scale, max, unit, vertical }: { x0: number; y0: number; scale: number; max: number; unit: string; vertical?: boolean }) {
  const step = niceStep(max, 6);
  const out = [];
  for (let v = 0; v <= max + 1e-9; v += step) {
    const p = v * scale;
    out.push(
      vertical ? (
        <g key={v}>
          <line class="lab-faint" x1={x0 - 4} x2={x0} y1={y0 - p} y2={y0 - p} />
          <text class="lab-label is-muted" x={x0 - 7} y={y0 - p + 4} text-anchor="end" font-size="10.5">
            {fmt(v, 3)}
          </text>
        </g>
      ) : (
        <g key={v}>
          <line class="lab-faint" x1={x0 + p} x2={x0 + p} y1={y0} y2={y0 + 4} />
          <text class="lab-label is-muted" x={x0 + p} y={y0 + 16} text-anchor="middle" font-size="10.5">
            {fmt(v, 3)}
            {v === 0 ? '' : ''}
          </text>
        </g>
      ),
    );
  }
  out.push(
    <text key="unit" class="lab-label is-muted" x={vertical ? x0 - 7 : x0 + max * scale + 14} y={vertical ? y0 - max * scale - 10 : y0 + 16} text-anchor={vertical ? 'end' : 'start'} font-size="10.5">
      {unit}
    </text>,
  );
  return <g>{out}</g>;
}

function Ground({ y, x0 = 0, x1 = W }: { y: number; x0?: number; x1?: number }) {
  const hatch = [];
  for (let x = x0 + 4; x < x1; x += 12) hatch.push(<line key={x} class="lab-hatch" x1={x} y1={y + 1} x2={x - 8} y2={y + 9} />);
  return (
    <g>
      <line class="lab-ink" x1={x0} x2={x1} y1={y} y2={y} stroke-width="1.5" />
      {hatch}
    </g>
  );
}

/* --------------------------------------------------------- projectile -- */

function ProjectileLab({ s, set }: Part<'projectile'>) {
  const g = GRAVITY[s.planet];
  const k = BALLS[s.ball].k * AIR[s.planet];
  const launch = { v0: s.v0, angle: s.angle, h0: s.h0, g, drag: k };
  const f = useMemo(() => flight(launch), [s.v0, s.angle, s.h0, g, k]);
  const ideal = idealFlight(launch);
  const idealPath = useMemo(() => (k > 0 ? flight({ ...launch, drag: 0 }) : null), [s.v0, s.angle, s.h0, g, k]);
  const sweep = useMemo(() => {
    const out: [number, number][] = [];
    for (let a = 0; a <= 90; a += 2) out.push([a, flight({ v0: s.v0, angle: a, h0: s.h0, g, drag: k }, 0.004).range]);
    return out;
  }, [s.v0, s.h0, g, k]);
  const best = sweep.reduce((b, p) => (p[1] > b[1] ? p : b), [0, 0]);
  const [kept, setKept] = useState<readonly Flight[]>([]);
  const [t, setT] = useState(0);
  const [running, setRunning] = useState(true);
  useClock(running && t < f.time, (dt) => setT((x) => Math.min(f.time, x + dt)));
  const now = Math.min(t, f.time);
  // Where the ball is now, between samples.
  const pts = f.points;
  let i = 0;
  while (i < pts.length - 2 && (pts[i + 1]?.t ?? 0) < now) i++;
  const p0 = pts[i] ?? { t: 0, x: 0, y: s.h0, vx: 0, vy: 0 };
  const p1 = pts[i + 1] ?? p0;
  const w = p1.t > p0.t ? (now - p0.t) / (p1.t - p0.t) : 0;
  const ball = { x: p0.x + (p1.x - p0.x) * w, y: p0.y + (p1.y - p0.y) * w, vx: p0.vx + (p1.vx - p0.vx) * w, vy: p0.vy + (p1.vy - p0.vy) * w };
  // One metre is the same size across and up.
  const all = [f, ...kept, ...(idealPath ? [idealPath] : [])];
  const xmax = Math.max(1, ...all.map((x) => x.range));
  const ymax = Math.max(1, ...all.map((x) => x.apex));
  const left = 48;
  const base = H - 34;
  const scale = Math.min((W - left - 30) / xmax, (base - 24) / ymax);
  const X = (x: number) => left + x * scale;
  const Y = (y: number) => base - y * scale;
  const path = (fl: Flight) => `M${fl.points.map((p) => `${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join('L')}`;
  const arrow = 55 / Math.max(1, s.v0);
  const apex = f.points.reduce((a, p) => (p.y > a.y ? p : a), f.points[0] ?? { t: 0, x: 0, y: 0, vx: 0, vy: 0 });
  const launchNow = () => {
    setT(0);
    setRunning(true);
  };
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <Slider label="Launch speed" value={s.v0} min={1} max={100} step={0.5} unit="m/s" onChange={(v0) => set({ v0 })} test="pl-v0" />
        <Slider label="Angle" value={s.angle} min={0} max={90} step={0.5} unit="°" onChange={(angle) => set({ angle })} test="pl-angle" />
        <Slider label="Height" value={s.h0} min={0} max={100} step={0.5} unit="m" onChange={(h0) => set({ h0 })} />
        <h3>Gravity</h3>
        <Segmented label="Gravity" value={s.planet} choices={PLANETS} onChange={(planet) => set({ planet })} />
        <h3>Air drag</h3>
        <select class="input" aria-label="Ball (air drag)" value={s.ball} onChange={(e) => set({ ball: e.currentTarget.value as Ball })} data-testid="pl-ball">
          {(Object.keys(BALLS) as Ball[]).map((b) => (
            <option key={b} value={b}>
              {BALLS[b].label}
            </option>
          ))}
        </select>
        {s.ball !== 'none' && s.planet === 'moon' && <p class="lab-note">The Moon has no air, so the ball flies as if in a vacuum.</p>}
        <div class="button-row">
          <button type="button" class="button button-primary button-small" onClick={launchNow} data-testid="pl-launch">
            Launch
          </button>
          <button type="button" class="button button-small" onClick={() => setKept((k0) => [...k0.slice(-3), f])}>
            Keep this path
          </button>
          {kept.length > 0 && (
            <button type="button" class="button button-small" onClick={() => setKept([])}>
              Clear kept
            </button>
          )}
        </div>
      </div>
      <div class="lab-stage">
        <svg class="lab-scene" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Projectile path" data-testid="pl-scene">
          <Ground y={base} x0={left - 20} />
          {s.h0 > 0 && <rect class="lab-solid" x={left - 16} y={Y(s.h0)} width={16} height={base - Y(s.h0)} />}
          <Ticks x0={left} y0={base + 10} scale={scale} max={xmax} unit="m" />
          {kept.map((k0, n) => (
            <path key={n} d={path(k0)} fill="none" stroke="var(--line-strong)" stroke-width="1.5" />
          ))}
          {idealPath && <path d={path(idealPath)} class="lab-dash" />}
          <path d={path(f)} fill="none" stroke={LAB_COLORS[0]} stroke-width="2.5" data-testid="pl-path" />
          <circle cx={X(apex.x)} cy={Y(apex.y)} r="3" fill="var(--muted)" />
          <text class="lab-label is-muted" x={X(apex.x)} y={Y(apex.y) - 8} text-anchor="middle">
            {fmt(apex.y, 3)} m
          </text>
          <text class="lab-label is-muted" x={X(f.range)} y={base - 8} text-anchor="middle">
            {fmt(f.range, 4)} m
          </text>
          <Arrow x1={X(ball.x)} y1={Y(ball.y)} x2={X(ball.x) + ball.vx * arrow} y2={Y(ball.y)} color={LAB_COLORS[4]} width={1.5} />
          <Arrow x1={X(ball.x)} y1={Y(ball.y)} x2={X(ball.x)} y2={Y(ball.y) - ball.vy * arrow} color={LAB_COLORS[4]} width={1.5} />
          <Arrow x1={X(ball.x)} y1={Y(ball.y)} x2={X(ball.x) + ball.vx * arrow} y2={Y(ball.y) - ball.vy * arrow} color={LAB_COLORS[5]} width={2.2} />
          <circle cx={X(ball.x)} cy={Y(ball.y)} r="7" fill={LAB_COLORS[1]} stroke="var(--text)" stroke-width="1.2" />
        </svg>
        <Readouts
          test="pl-results"
          items={[
            ['Time of flight', `${fmt(f.time, 4)} s`],
            ['Range', `${fmt(f.range, 4)} m`],
            ['Highest point', `${fmt(f.apex, 4)} m`],
            ['Lands at', `${fmt(f.impactSpeed, 3)} m/s, ${fmt(f.impactAngle, 3)}° below level`],
            ['Now', `t = ${now.toFixed(2)} s, v = ${fmt(Math.hypot(ball.vx, ball.vy), 3)} m/s`],
            ...(k > 0 ? ([['Without air', `${fmt(ideal.range, 4)} m far, ${fmt(ideal.apex, 4)} m high`]] as [string, string][]) : []),
            ['Furthest angle', `${best[0]}° (${fmt(best[1], 4)} m)`],
          ]}
        />
        <div class="lab-plots">
          <Plot
            title="Velocity against time"
            test="pl-plot-v"
            series={[
              { name: 'across (vx)', points: f.points.map((p) => [p.t, p.vx] as const) },
              { name: 'up (vy)', points: f.points.map((p) => [p.t, p.vy] as const) },
            ]}
            xLabel="time (s)"
            yLabel="m/s"
            marker={now}
          />
          <Plot
            title="Range against launch angle"
            test="pl-plot-range"
            series={[{ name: 'range', points: sweep }]}
            xLabel="angle (°)"
            yLabel="range (m)"
            xRange={[0, 90]}
            points={[{ x: s.angle, y: f.range, live: true }]}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ pendulum -- */

function PendulumLab({ s, set }: Part<'pendulum'>) {
  const g = GRAVITY[s.planet];
  const amp = rad(s.amplitude);
  const T = pendulumPeriod(s.length, g, amp);
  const T0 = 2 * Math.PI * Math.sqrt(s.length / g);
  const sim = useRef({ t: 0, y: [amp, 0], history: [[0, s.amplitude]] as [number, number][] });
  const [, tick] = useState(0);
  const [running, setRunning] = useState(true);
  const reset = () => {
    sim.current = { t: 0, y: [amp, 0], history: [[0, s.amplitude]] };
    tick((n) => n + 1);
  };
  useEffect(reset, [s.length, s.amplitude, s.planet]);
  useClock(running, (dt) => {
    const f = pendulum(s.length, g, s.damping);
    const n = Math.max(1, Math.ceil(dt / 0.002));
    let { t, y } = sim.current;
    for (let i = 0; i < n; i++) {
      y = rk4(f, t, y, dt / n);
      t += dt / n;
    }
    const history = sim.current.history.filter(([x]) => x >= t - 10);
    history.push([t, deg(y[0] ?? 0)]);
    sim.current = { t, y, history };
    tick((k) => k + 1);
  });
  const { t, y } = sim.current;
  const theta = y[0] ?? 0;
  const omega = y[1] ?? 0;
  const cx = W / 2;
  const cy = 170;
  const r = 140;
  const bob = { x: cx + r * Math.sin(theta), y: cy + r * Math.cos(theta) };
  const vmax = Math.sqrt(2 * g * s.length * (1 - Math.cos(amp)));
  const v = s.length * omega;
  const arrow = 60 / Math.max(1e-6, vmax);
  const arc = (a: number) => [cx + r * Math.sin(a), cy + r * Math.cos(a)] as const;
  const [ax, ay] = arc(-amp);
  const [bx, by] = arc(amp);
  const periodCurve = useMemo(() => {
    const out: [number, number][] = [];
    for (let a = 1; a <= 175; a += 2) out.push([a, pendulumPeriod(1, 1, rad(a)) / (2 * Math.PI)]);
    return out;
  }, []);
  const t0 = Math.max(0, t - 10);
  const model: [number, number][] = [];
  for (let k = 0; k <= 200; k++) {
    const x = t0 + (k / 200) * (t - t0);
    model.push([x, s.amplitude * Math.cos((2 * Math.PI * x) / T0)]);
  }
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <Slider label="Length" value={s.length} min={0.1} max={10} step={0.01} unit="m" onChange={(length) => set({ length })} test="pd-length" />
        <Slider label="Swing" value={s.amplitude} min={1} max={175} step={1} unit="°" onChange={(amplitude) => set({ amplitude })} test="pd-amplitude" />
        <Slider label="Damping" value={s.damping} min={0} max={1} step={0.01} unit="1/s" onChange={(damping) => set({ damping })} />
        <h3>Gravity</h3>
        <Segmented label="Gravity" value={s.planet} choices={PLANETS} onChange={(planet) => set({ planet })} />
        <div class="button-row">
          <button type="button" class="button button-primary button-small" onClick={() => setRunning((x) => !x)}>
            {running ? 'Pause' : 'Run'}
          </button>
          <button type="button" class="button button-small" onClick={reset}>
            Let go again
          </button>
        </div>
      </div>
      <div class="lab-stage">
        <svg class="lab-scene" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Pendulum" data-testid="pd-scene">
          <line class="lab-ink" x1={cx - 50} x2={cx + 50} y1={cy} y2={cy} stroke-width="3" />
          <line class="lab-faint" x1={cx} x2={cx} y1={cy} y2={cy + r + 24} stroke-dasharray="3 4" />
          <path class="lab-dash" d={`M${ax} ${ay}A${r} ${r} 0 ${2 * amp > Math.PI ? 1 : 0} 0 ${bx} ${by}`} />
          <line class="lab-ink" x1={cx} y1={cy} x2={bob.x} y2={bob.y} stroke-width="2" />
          <circle cx={cx} cy={cy} r="4" fill="var(--text)" />
          <Arrow x1={bob.x} y1={bob.y} x2={bob.x + v * arrow * Math.cos(theta)} y2={bob.y - v * arrow * Math.sin(theta)} color={LAB_COLORS[5]} />
          <circle cx={bob.x} cy={bob.y} r="14" fill={LAB_COLORS[1]} stroke="var(--text)" stroke-width="1.2" />
          <text class="lab-label is-muted" x={cx + 8} y={cy - 10}>
            L = {fmt(s.length, 3)} m
          </text>
        </svg>
        <Readouts
          test="pd-results"
          items={[
            ['Period', `${fmt(T, 5)} s`],
            ['Small-swing formula 2π√(L/g)', `${fmt(T0, 5)} s (${fmt((T / T0 - 1) * 100, 3)} % short)`],
            ['Frequency', `${fmt(1 / T, 4)} Hz`],
            ['Fastest (at the bottom)', `${fmt(vmax, 3)} m/s`],
            ['Now', `${fmt(deg(theta), 3)}°, ${fmt(v, 3)} m/s`],
          ]}
        />
        <div class="lab-plots">
          <Plot
            title="Angle against time"
            test="pd-plot"
            series={[
              { name: 'simulated', points: sim.current.history },
              { name: 'small-swing model', points: model, dashed: true },
            ]}
            xLabel="time (s)"
            yLabel="angle (°)"
            xRange={[t0, Math.max(t0 + 1, t)]}
          />
          <Plot
            title="Period against swing (as a multiple of 2π√(L/g))"
            series={[{ name: 'period', points: periodCurve }]}
            xLabel="swing (°)"
            yLabel="T ÷ T₀"
            xRange={[0, 180]}
            points={[{ x: s.amplitude, y: T / T0, live: true }]}
          />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- the spring -- */

function SpringLab({ s, set }: Part<'spring'>) {
  const w = 2 * Math.PI * s.f;
  const o = { m: s.m, k: s.k, c: s.c, F0: s.F0, w };
  const info = oscillatorInfo(o);
  const sim = useRef({ t: 0, y: [s.x0, 0], history: [[0, s.x0 * 1000]] as [number, number][] });
  const [, tick] = useState(0);
  const [running, setRunning] = useState(true);
  const reset = () => {
    sim.current = { t: 0, y: [s.x0, 0], history: [[0, s.x0 * 1000]] };
    tick((n) => n + 1);
  };
  useEffect(reset, [s.x0]);
  useClock(running, (dt) => {
    const f = oscillator(o);
    const n = Math.max(1, Math.ceil(dt / Math.min(0.002, 0.05 / Math.max(info.wn, w, 1))));
    let { t, y } = sim.current;
    for (let i = 0; i < n; i++) {
      y = rk4(f, t, y, dt / n);
      t += dt / n;
    }
    const history = sim.current.history.filter(([x]) => x >= t - 10);
    history.push([t, (y[0] ?? 0) * 1000]);
    sim.current = { t, y, history };
    tick((k) => k + 1);
  });
  const { t, y } = sim.current;
  const x = y[0] ?? 0;
  const span = Math.max(Math.abs(s.x0), s.F0 > 0 ? info.amplitude * 1.2 : 0, 0.01, ...sim.current.history.map((p) => Math.abs(p[1]) / 1000));
  const px = 130 / span;
  const wall = 60;
  const rest = 330;
  const left = rest + x * px;
  const coil = (y0: number) => {
    const n = 14;
    const pts = [`M${wall} ${y0}`, `L${wall + 14} ${y0}`];
    const len = left - wall - 28;
    for (let k = 0; k < n; k++) pts.push(`L${wall + 14 + ((k + 0.5) * len) / n} ${y0 + (k % 2 ? 11 : -11)}`);
    pts.push(`L${left - 14} ${y0}`, `L${left} ${y0}`);
    return pts.join('');
  };
  const curve = useMemo(() => {
    const out: [number, number][] = [];
    for (let r = 0; r <= 3; r += 0.01) out.push([r, Math.min(magnification(r, info.zeta), 50)]);
    return out;
  }, [info.zeta]);
  const drive = s.F0 * Math.cos(w * t);
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <Slider label="Mass" value={s.m} min={0.05} max={20} step={0.05} unit="kg" onChange={(m) => set({ m })} />
        <Slider label="Spring stiffness" value={s.k} min={1} max={2000} step={1} unit="N/m" onChange={(k) => set({ k })} test="sp-k" />
        <Slider label="Damping" value={s.c} min={0} max={100} step={0.1} unit="N·s/m" onChange={(c) => set({ c })} test="sp-c" />
        <Slider label="Pulled out by" value={s.x0 * 1000} min={-200} max={200} step={1} unit="mm" onChange={(v) => set({ x0: v / 1000 })} />
        <h3>Driving force F₀ cos ωt</h3>
        <Slider label="Force" value={s.F0} min={0} max={100} step={0.5} unit="N" onChange={(F0) => set({ F0 })} />
        <Slider label="Frequency" value={s.f} min={0.05} max={20} step={0.01} unit="Hz" onChange={(f) => set({ f })} />
        <div class="button-row">
          <button type="button" class="button button-primary button-small" onClick={() => setRunning((r) => !r)}>
            {running ? 'Pause' : 'Run'}
          </button>
          <button type="button" class="button button-small" onClick={reset}>
            Pull and let go
          </button>
          <button type="button" class="button button-small" onClick={() => set({ f: Number((info.wn / (2 * Math.PI)).toFixed(2)) })}>
            Drive at resonance
          </button>
        </div>
      </div>
      <div class="lab-stage">
        <svg class="lab-scene" viewBox={`0 0 ${W} 260`} role="img" aria-label="Mass on a spring with a damper" data-testid="sp-scene">
          <rect class="lab-solid" x={wall - 14} y={60} width={14} height={160} />
          <Ground y={220} x0={wall} />
          <line class="lab-faint" x1={rest} x2={rest} y1={40} y2={232} stroke-dasharray="3 4" />
          <path d={coil(105)} fill="none" stroke="var(--text)" stroke-width="2" />
          {s.c > 0 && (
            <g>
              {/* The dashpot: a cylinder fixed to the wall, its piston moving with the mass. */}
              <line class="lab-ink" x1={wall} x2={wall + 12} y1={175} y2={175} stroke-width="2" />
              <path class="lab-ink" d={`M${wall + 12} 160V190M${wall + 12} 160H${rest + 26}M${wall + 12} 190H${rest + 26}`} stroke-width="2" />
              <line class="lab-ink" x1={left - 120} x2={left} y1={175} y2={175} stroke-width="2" />
              <line class="lab-ink" x1={left - 120} x2={left - 120} y1={163} y2={187} stroke-width="4" />
            </g>
          )}
          <rect x={left} y={80} width={80} height={130} rx="4" fill={LAB_COLORS[1]} stroke="var(--text)" stroke-width="1.2" />
          <text class="lab-label" x={left + 40} y={150} text-anchor="middle">
            {fmt(s.m, 3)} kg
          </text>
          {s.F0 > 0 && <Arrow x1={left + 80} y1={145} x2={left + 80 + (drive / Math.max(s.F0, 1e-9)) * 50} y2={145} color={LAB_COLORS[5]} />}
          <text class="lab-label is-muted" x={rest} y={34} text-anchor="middle">
            rest
          </text>
        </svg>
        <Readouts
          test="sp-results"
          items={[
            ['Natural frequency', `${fmt(info.wn / (2 * Math.PI), 4)} Hz (period ${fmt((2 * Math.PI) / info.wn, 4)} s)`],
            ['Damping ratio ζ', `${fmt(info.zeta, 3)}, ${info.regime}`],
            ...(info.zeta < 1 && info.zeta > 0 ? ([['Damped frequency', `${fmt(info.wd / (2 * Math.PI), 4)} Hz`]] as [string, string][]) : []),
            ...(s.F0 > 0
              ? ([
                  ['Frequency ratio ω/ωₙ', fmt(w / info.wn, 3)],
                  ['Steady swing', `${fmt(info.amplitude * 1000, 4)} mm, lagging ${fmt(info.lag, 3)}°`],
                ] as [string, string][])
              : []),
            ['Now', `x = ${fmt(x * 1000, 3)} mm, v = ${fmt(y[1] ?? 0, 3)} m/s`],
          ]}
        />
        <div class="lab-plots">
          <Plot title="Displacement against time" test="sp-plot" series={[{ name: 'x', points: sim.current.history }]} xLabel="time (s)" yLabel="mm" xRange={[Math.max(0, t - 10), Math.max(1, t)]} />
          <Plot
            title="Response to a driving force"
            series={[{ name: 'amplitude ÷ static deflection', points: curve }]}
            xLabel="driving ÷ natural frequency"
            yLabel="X ÷ (F₀/k)"
            xRange={[0, 3]}
            points={s.F0 > 0 ? [{ x: w / info.wn, y: Math.min(info.ratio, 50), live: true }] : []}
          />
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- collisions -- */

function CollisionLab({ s, set }: Part<'collision'>) {
  const c = collide(s.m1, s.u1, s.m2, s.u2, s.e);
  const len = 0.5;
  const start1 = 1;
  const start2 = 4.5;
  const meet = s.u1 > s.u2 ? (start2 - start1 - len) / (s.u1 - s.u2) : Number.POSITIVE_INFINITY;
  const end = Math.min(8, Number.isFinite(meet) ? meet + 4 : 6);
  const pos = (t: number) => {
    if (t <= meet) return [start1 + s.u1 * t, start2 + s.u2 * t] as const;
    const a = start1 + s.u1 * meet;
    const b = start2 + s.u2 * meet;
    return [a + c.v1 * (t - meet), b + c.v2 * (t - meet)] as const;
  };
  const [t, setT] = useState(0);
  const [running, setRunning] = useState(true);
  useEffect(() => {
    setT(0);
    setRunning(true);
  }, [s.m1, s.u1, s.m2, s.u2, s.e]);
  useClock(running && t < end, (dt) => setT((x) => Math.min(end, x + dt)));
  const [x1, x2] = pos(t);
  const scale = 64;
  const X = (x: number) => 40 + (x - 0) * scale;
  const after = t > meet;
  const series = (k: 0 | 1) => Array.from({ length: 161 }, (_, i) => [(i / 160) * end, pos((i / 160) * end)[k]] as const);
  const cart = (x: number, m: number, v: number, colour: string, label: string) => (
    <g>
      <rect x={X(x)} y={150} width={len * scale} height={44} rx="5" fill={colour} stroke="var(--text)" stroke-width="1.2" />
      <circle cx={X(x) + 8} cy={198} r="5" fill="var(--text)" />
      <circle cx={X(x) + len * scale - 8} cy={198} r="5" fill="var(--text)" />
      <text class="lab-label" x={X(x) + (len * scale) / 2} y={176} text-anchor="middle">
        {label} {fmt(m, 3)} kg
      </text>
      <Arrow x1={X(x) + (len * scale) / 2} y1={136} x2={X(x) + (len * scale) / 2 + v * 24} y2={136} color={LAB_COLORS[5]} />
      <text class="lab-label is-muted" x={X(x) + (len * scale) / 2} y={124} text-anchor="middle">
        {fmt(v, 3)} m/s
      </text>
    </g>
  );
  const kind = s.e >= 1 ? 'elastic: no kinetic energy lost' : s.e <= 0 ? 'perfectly inelastic: they stick together' : 'inelastic';
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <h3>Cart A</h3>
        <Slider label="Mass" value={s.m1} min={0.1} max={10} step={0.1} unit="kg" onChange={(m1) => set({ m1 })} />
        <Slider label="Velocity" value={s.u1} min={-5} max={5} step={0.1} unit="m/s" onChange={(u1) => set({ u1 })} />
        <h3>Cart B</h3>
        <Slider label="Mass" value={s.m2} min={0.1} max={10} step={0.1} unit="kg" onChange={(m2) => set({ m2 })} test="co-m2" />
        <Slider label="Velocity" value={s.u2} min={-5} max={5} step={0.1} unit="m/s" onChange={(u2) => set({ u2 })} />
        <h3>Collision</h3>
        <Slider label="Restitution e" value={s.e} min={0} max={1} step={0.01} onChange={(e) => set({ e })} test="co-e" />
        <div class="button-row">
          <button
            type="button"
            class="button button-primary button-small"
            onClick={() => {
              setT(0);
              setRunning(true);
            }}
          >
            Run again
          </button>
        </div>
      </div>
      <div class="lab-stage">
        <svg class="lab-scene" viewBox={`0 0 ${W} 250`} role="img" aria-label="Two carts on an air track" data-testid="co-scene">
          <rect class="lab-solid" x={X(0)} y={204} width={8 * scale} height={10} />
          <Ticks x0={X(0)} y0={222} scale={scale} max={8} unit="m" />
          {cart(x1, s.m1, after ? c.v1 : s.u1, LAB_COLORS[1] ?? '', 'A')}
          {cart(x2, s.m2, after ? c.v2 : s.u2, LAB_COLORS[4] ?? '', 'B')}
        </svg>
        {!Number.isFinite(meet) && <p class="lab-note">Cart A never catches cart B, so they do not collide: give A more speed to the right than B.</p>}
        <Readouts
          test="co-results"
          items={[
            ['After: A', `${fmt(c.v1, 4)} m/s`],
            ['After: B', `${fmt(c.v2, 4)} m/s`],
            ['Momentum before → after', `${fmt(c.p, 4)} → ${fmt(c.pAfter, 4)} kg·m/s`],
            ['Kinetic energy before → after', `${fmt(c.before, 4)} → ${fmt(c.after, 4)} J`],
            ['Energy lost', `${fmt(c.lost, 3)} J (${fmt(c.before > 0 ? (100 * c.lost) / c.before : 0, 3)} %)`],
            ['Collision', kind],
          ]}
        />
        <div class="lab-plots">
          <Plot
            title="Position against time"
            test="co-plot"
            series={[
              { name: 'A', points: series(0) },
              { name: 'B', points: series(1) },
            ]}
            xLabel="time (s)"
            yLabel="position (m)"
            marker={t}
            xRange={[0, end]}
          />
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- orbits -- */

function OrbitLab({ s, set }: Part<'orbit'>) {
  const mu = MU_SUN * s.star;
  const vc = Math.sqrt(mu / s.r0);
  const start = { x: s.r0, y: 0, vx: 0, vy: vc * s.speed };
  const el = orbitElements(mu, start);
  const path = useMemo(() => {
    const out: { x: number; y: number }[] = [];
    let b = start;
    const steps = 2400;
    const dt = el.bound ? el.period / steps : (2 * Math.PI * s.r0) / (vc * s.speed) / 400;
    for (let i = 0; i <= steps; i++) {
      out.push({ x: b.x, y: b.y });
      if (!el.bound && Math.hypot(b.x, b.y) > 12 * s.r0) break;
      b = orbitStep(mu, b, dt);
    }
    return { points: out, dt };
  }, [s.star, s.r0, s.speed]);
  const sim = useRef({ t: 0, b: start });
  const [, tick] = useState(0);
  const [running, setRunning] = useState(true);
  const reset = () => {
    sim.current = { t: 0, b: start };
    tick((n) => n + 1);
  };
  useEffect(reset, [s.star, s.r0, s.speed]);
  useClock(running, (dt) => {
    const span = dt * s.rate;
    const n = Math.max(1, Math.ceil(span / Math.max(1e-6, path.dt)));
    let { t, b } = sim.current;
    for (let i = 0; i < n; i++) b = orbitStep(mu, b, span / n);
    t += span;
    if (!el.bound && Math.hypot(b.x, b.y) > 12 * s.r0) {
      b = start;
      t = 0;
    }
    sim.current = { t, b };
    tick((k) => k + 1);
  });
  const { b, t } = sim.current;
  const xs = path.points.map((p) => p.x);
  const ys = path.points.map((p) => p.y);
  const x0 = Math.min(0, ...xs);
  const x1 = Math.max(0, ...xs);
  const y0 = Math.min(0, ...ys);
  const y1 = Math.max(0, ...ys);
  const scale = Math.min((W - 60) / (x1 - x0 || 1), (H - 50) / (y1 - y0 || 1));
  const X = (x: number) => W / 2 + (x - (x0 + x1) / 2) * scale;
  const Y = (y: number) => H / 2 - (y - (y0 + y1) / 2) * scale;
  const sectors = [];
  if (s.areas && el.bound) {
    const per = Math.floor((path.points.length - 1) / 12);
    for (let k = 0; k < 12; k += 2) {
      const pts = path.points.slice(k * per, (k + 1) * per + 1);
      sectors.push(<path key={k} class="or-sector" d={`M${X(0)} ${Y(0)}${pts.map((p) => `L${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join('')}Z`} />);
    }
  }
  const r = Math.hypot(b.x, b.y);
  const v = Math.hypot(b.vx, b.vy);
  const vScale = 40 / (vc * Math.max(1, s.speed));
  const distance = useMemo(() => {
    if (!el.bound) return [];
    return path.points.map((p, i) => [i * path.dt, Math.hypot(p.x, p.y)] as const);
  }, [path, el.bound]);
  const vp = el.h / el.perihelion;
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <Slider label="Star mass" value={s.star} min={0.1} max={10} step={0.1} unit="M☉" onChange={(star) => set({ star })} />
        <Slider label="Start distance" value={s.r0} min={0.2} max={5} step={0.05} unit="AU" onChange={(r0) => set({ r0 })} />
        <Slider label="Start speed (× circular)" value={s.speed} min={0.3} max={1.6} step={0.01} onChange={(speed) => set({ speed })} test="or-speed" />
        <Slider label="Time" value={s.rate} min={0.05} max={5} step={0.05} unit="yr/s" onChange={(rate) => set({ rate })} />
        <label class="ms-check">
          <input type="checkbox" checked={s.areas} onChange={(e) => set({ areas: e.currentTarget.checked })} /> Show equal areas in equal times
        </label>
        <div class="button-row">
          <button type="button" class="button button-primary button-small" onClick={() => setRunning((x) => !x)}>
            {running ? 'Pause' : 'Run'}
          </button>
          <button type="button" class="button button-small" onClick={reset}>
            Start again
          </button>
        </div>
        <p class="lab-note">Speed 1 is a circle; up to √2 ≈ 1.41 the orbit is an ellipse; faster than that, the planet escapes.</p>
      </div>
      <div class="lab-stage">
        <svg class="lab-scene or-scene" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Planet orbiting a star" data-testid="or-scene">
          {sectors}
          <path class="lab-dash" d={`M${path.points.map((p) => `${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join('L')}`} />
          <circle cx={X(0)} cy={Y(0)} r={8 + 2 * Math.log2(1 + s.star)} fill={LAB_COLORS[1]} />
          <Arrow x1={X(b.x)} y1={Y(b.y)} x2={X(b.x) + b.vx * vScale} y2={Y(b.y) - b.vy * vScale} color={LAB_COLORS[5]} />
          <circle cx={X(b.x)} cy={Y(b.y)} r="6" fill={LAB_COLORS[0]} stroke="var(--panel)" stroke-width="1.5" />
        </svg>
        <Readouts
          test="or-results"
          items={[
            ['Orbit', el.bound ? (el.e < 1e-3 ? 'circle' : 'ellipse') : el.e > 1 ? 'hyperbola: it escapes' : 'parabola: it just escapes'],
            ['Eccentricity', fmt(el.e, 4)],
            ...(el.bound
              ? ([
                  ['Semi-major axis', `${fmt(el.a, 4)} AU`],
                  ['Period', `${fmt(el.period, 4)} years`],
                  ['Nearest and furthest', `${fmt(el.perihelion, 4)} AU, ${fmt(el.aphelion, 4)} AU`],
                  ['Speed nearest and furthest', `${fmt(vp * KM_S_PER_AU_YR, 4)} km/s, ${fmt((el.h / el.aphelion) * KM_S_PER_AU_YR, 4)} km/s`],
                ] as [string, string][])
              : ([['Nearest', `${fmt(el.perihelion, 4)} AU`]] as [string, string][])),
            ['Now', `${fmt(r, 3)} AU, ${fmt(v * KM_S_PER_AU_YR, 3)} km/s, t = ${fmt(t, 3)} yr`],
          ]}
        />
        {el.bound && (
          <div class="lab-plots">
            <Plot title="Distance from the star over one orbit" test="or-plot" series={[{ name: 'distance', points: distance }]} xLabel="time (years)" yLabel="AU" marker={t % el.period} />
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- incline -- */

function InclineLab({ s, set }: Part<'incline'>) {
  const g = 9.80665;
  const res = incline(s.angle, s.muS, s.muK, s.m, g, s.push);
  const ramp = 5;
  const block = 0.6;
  const sim = useRef({ x: 1.5, v: 0 });
  const [, tick] = useState(0);
  const [running, setRunning] = useState(true);
  const reset = () => {
    sim.current = { x: res.accel < 0 ? ramp - block - 0.5 : 0.5, v: 0 };
    setRunning(true);
    tick((n) => n + 1);
  };
  useEffect(reset, [s.angle, s.muS, s.muK, s.m, s.push]);
  const moving = !res.holds && sim.current.x > 0 && sim.current.x < ramp - block;
  useClock(running && moving, (dt) => {
    let { x, v } = sim.current;
    v += res.accel * dt;
    x = Math.max(0, Math.min(ramp - block, x + v * dt));
    sim.current = { x, v };
    tick((k) => k + 1);
  });
  const a = rad(s.angle);
  const Lpx = 300;
  const px = Lpx / ramp;
  const bottom = { x: 560, y: 320 };
  const top = { x: bottom.x - Lpx * Math.cos(a), y: bottom.y - Lpx * Math.sin(a) };
  const along = { x: Math.cos(a), y: Math.sin(a) };
  const normal = { x: Math.sin(a), y: -Math.cos(a) };
  const centre = (x: number) => ({ x: top.x + (x + block / 2) * px * along.x + 13 * normal.x, y: top.y + (x + block / 2) * px * along.y + 13 * normal.y });
  const c = centre(sim.current.x);
  const fs = 90 / Math.max(res.weight, 1e-9);
  const curve = useMemo(() => {
    const out: [number, number][] = [];
    for (let d = 0; d <= 80; d += 0.5) out.push([d, Math.max(0, incline(d, s.muS, s.muK, s.m, g, s.push).accel)]);
    return out;
  }, [s.muS, s.muK, s.m, s.push]);
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <Slider label="Slope" value={s.angle} min={0} max={80} step={0.5} unit="°" onChange={(angle) => set({ angle })} test="in-angle" />
        <Slider label="Static friction μs" value={s.muS} min={0} max={1.5} step={0.01} onChange={(muS) => set({ muS, muK: Math.min(s.muK, muS) })} test="in-mus" />
        <Slider label="Sliding friction μk" value={s.muK} min={0} max={1.5} step={0.01} onChange={(muK) => set({ muK: Math.min(muK, s.muS) })} />
        <Slider label="Mass" value={s.m} min={0.1} max={100} step={0.1} unit="kg" onChange={(m) => set({ m })} />
        <Slider label="Push up the slope" value={s.push} min={0} max={1000} step={1} unit="N" onChange={(push) => set({ push })} />
        <div class="button-row">
          <button type="button" class="button button-primary button-small" onClick={reset}>
            Let go again
          </button>
        </div>
      </div>
      <div class="lab-stage">
        <svg class="lab-scene" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Block on a slope with its forces" data-testid="in-scene">
          <path class="lab-solid" d={`M${top.x} ${top.y}L${bottom.x} ${bottom.y}L${top.x} ${bottom.y}Z`} />
          <Ground y={bottom.y} x0={20} x1={620} />
          <text class="lab-label is-muted" x={bottom.x - 70} y={bottom.y - 8}>
            {fmt(s.angle, 3)}°
          </text>
          <g transform={`rotate(${s.angle} ${c.x} ${c.y})`}>
            <rect x={c.x - (block * px) / 2} y={c.y - 13} width={block * px} height={26} rx="3" fill={LAB_COLORS[1]} stroke="var(--text)" stroke-width="1.2" />
          </g>
          <Arrow x1={c.x} y1={c.y} x2={c.x} y2={c.y + res.weight * fs} color={LAB_COLORS[0]} test="in-weight" />
          <Arrow x1={c.x} y1={c.y} x2={c.x + normal.x * res.normal * fs} y2={c.y + normal.y * res.normal * fs} color={LAB_COLORS[2]} />
          <Arrow x1={c.x} y1={c.y} x2={c.x - along.x * res.friction * fs} y2={c.y - along.y * res.friction * fs} color={LAB_COLORS[5]} />
          {s.push > 0 && <Arrow x1={c.x} y1={c.y} x2={c.x - along.x * s.push * fs} y2={c.y - along.y * s.push * fs} color={LAB_COLORS[3]} />}
        </svg>
        <div class="lab-legend">
          <span>
            <i style={{ background: LAB_COLORS[0] }} />
            weight
          </span>
          <span>
            <i style={{ background: LAB_COLORS[2] }} />
            normal force
          </span>
          <span>
            <i style={{ background: LAB_COLORS[5] }} />
            friction
          </span>
          {s.push > 0 && (
            <span>
              <i style={{ background: LAB_COLORS[3] }} />
              push
            </span>
          )}
        </div>
        <Readouts
          test="in-results"
          items={[
            ['Weight', `${fmt(res.weight, 4)} N`],
            ['Down the slope (mg sin θ)', `${fmt(res.along, 4)} N`],
            ['Normal force (mg cos θ)', `${fmt(res.normal, 4)} N`],
            ['Friction', res.holds ? `${fmt(Math.abs(res.friction), 4)} N static (up to ${fmt(s.muS * res.normal, 4)} N)` : `${fmt(Math.abs(res.friction), 4)} N sliding`],
            ['The block', res.holds ? 'stays put' : res.accel > 0 ? `slides down at ${fmt(res.accel, 4)} m/s²` : `moves up at ${fmt(-res.accel, 4)} m/s²`],
            ['Slips (without a push) above', `${fmt(res.critical, 4)}°`],
            ...(res.holds ? [] : ([['Time to slide 5 m', `${fmt(Math.sqrt((2 * ramp) / Math.abs(res.accel)), 4)} s`]] as [string, string][])),
          ]}
        />
        <div class="lab-plots">
          <Plot
            title="Acceleration down the slope against its angle"
            test="in-plot"
            series={[{ name: 'acceleration', points: curve }]}
            xLabel="slope (°)"
            yLabel="m/s²"
            xRange={[0, 80]}
            points={[{ x: s.angle, y: Math.max(0, res.accel), live: true }]}
          />
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------- levers and pulleys -- */

const LEVER_KINDS = [
  '',
  'Class 1: the fulcrum is between load and effort (seesaw, crowbar, scissors)',
  'Class 2: the load is between fulcrum and effort (wheelbarrow, nutcracker)',
  'Class 3: the effort is between fulcrum and load (tweezers, fishing rod, your forearm)',
];

function MachinesLab({ s, set }: Part<'machines'>) {
  const L = lever(s.fulcrum, s.load, s.effort, s.weight);
  const T = tackle(s.strands, s.pulleyLoad, s.efficiency / 100);
  const X = (x: number) => 60 + x * 130;
  const beamY = 200;
  const effortDown = Math.sign(s.load - s.fulcrum) !== Math.sign(s.effort - s.fulcrum);
  const lift = s.pulled / s.strands;
  const body =
    s.kind === 'lever' ? (
      <>
        <svg class="lab-scene" viewBox={`0 0 ${W} 300`} role="img" aria-label="Lever" data-testid="mc-scene">
          <Ground y={262} x0={20} x1={620} />
          <path class="lab-solid" d={`M${X(s.fulcrum)} ${beamY + 6}L${X(s.fulcrum) - 22} 262L${X(s.fulcrum) + 22} 262Z`} />
          <rect x={X(0)} y={beamY} width={4 * 130} height={10} rx="3" fill="color-mix(in srgb, var(--brass) 55%, var(--panel))" stroke="var(--text)" />
          <rect x={X(s.load) - 24} y={beamY - 48} width={48} height={48} fill={LAB_COLORS[0]} stroke="var(--text)" />
          <text class="lab-label" x={X(s.load)} y={beamY - 20} text-anchor="middle" style={{ fill: '#fff' }}>
            {fmt(s.weight, 3)} N
          </text>
          {Number.isFinite(L.force) && L.kind > 0 && (
            <>
              <Arrow x1={X(s.effort)} y1={effortDown ? beamY - 90 : beamY + 80} x2={X(s.effort)} y2={effortDown ? beamY - 2 : beamY + 12} color={LAB_COLORS[5]} width={3} test="mc-effort" />
              <text class="lab-label" x={X(s.effort) + 8} y={effortDown ? beamY - 70 : beamY + 70}>
                {fmt(L.force, 4)} N
              </text>
            </>
          )}
          <Ticks x0={X(0)} y0={276} scale={130} max={4} unit="m" />
        </svg>
        <Readouts
          test="mc-results"
          items={[
            ['Kind', LEVER_KINDS[L.kind] || 'Move the load, effort and fulcrum apart'],
            ['Effort needed', Number.isFinite(L.force) ? `${fmt(L.force, 4)} N, pushing ${effortDown ? 'down' : 'up'}` : '—'],
            ['Mechanical advantage', fmt(L.advantage, 4)],
            ['Effort moves (for each m the load moves)', `${fmt(L.ratio, 4)} m`],
          ]}
        />
      </>
    ) : (
      <>
        <svg class="lab-scene" viewBox={`0 0 ${W} 320`} role="img" aria-label="Block and tackle" data-testid="mc-scene">
          <rect class="lab-solid" x={180} y={14} width={280} height={12} />
          {(() => {
            const n = s.strands;
            const top = 60;
            const lower = 190 - lift * 60;
            const xs = Array.from({ length: n }, (_, i) => 250 + (i * 140) / Math.max(1, n - 1 || 1));
            const lines = xs.map((x, i) => <line key={i} class="lab-ink" x1={x} x2={x} y1={top} y2={lower} stroke-width="2" />);
            return (
              <g>
                <line class="lab-ink" x1={320} x2={320} y1={26} y2={top - 22} stroke-width="3" />
                <rect class="lab-solid" x={236} y={top - 22} width={206} height={26} rx="10" />
                <rect class="lab-solid" x={236} y={lower - 4} width={168} height={26} rx="10" />
                {lines}
                <line class="lab-ink" x1={428} x2={428} y1={top + 4} y2={200 + s.pulled * 10} stroke-width="2" />
                <Arrow x1={428} y1={200 + s.pulled * 10} x2={428} y2={256 + s.pulled * 10} color={LAB_COLORS[5]} width={3} test="mc-effort" />
                <text class="lab-label" x={438} y={244 + s.pulled * 10}>
                  {fmt(T.effort, 4)} N
                </text>
                <line class="lab-ink" x1={320} x2={320} y1={lower + 22} y2={lower + 40} stroke-width="3" />
                <rect x={290} y={lower + 40} width={60} height={50} fill={LAB_COLORS[0]} stroke="var(--text)" />
                <text class="lab-label" x={320} y={lower + 70} text-anchor="middle" style={{ fill: '#fff' }}>
                  {fmt(s.pulleyLoad, 3)} N
                </text>
              </g>
            );
          })()}
        </svg>
        <Readouts
          test="mc-results"
          items={[
            ['Ropes holding the load', String(s.strands)],
            ['Effort (no friction)', `${fmt(T.ideal, 4)} N`],
            ['Effort (with friction)', `${fmt(T.effort, 4)} N`],
            ['Mechanical advantage', `${fmt(T.advantage, 4)} (ideal ${T.idealAdvantage})`],
            ['Rope to pull for 1 m of lift', `${T.rope} m`],
            ['Load raised so far', `${fmt(lift, 3)} m`],
          ]}
        />
      </>
    );
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <Segmented
          label="Machine"
          value={s.kind}
          choices={[
            { value: 'lever', label: 'Lever' },
            { value: 'pulleys', label: 'Pulleys' },
          ]}
          onChange={(kind) => set({ kind })}
        />
        {s.kind === 'lever' ? (
          <>
            <Slider label="Fulcrum at" value={s.fulcrum} min={0} max={4} step={0.05} unit="m" onChange={(fulcrum) => set({ fulcrum })} test="mc-fulcrum" />
            <Slider label="Load at" value={s.load} min={0} max={4} step={0.05} unit="m" onChange={(load) => set({ load })} />
            <Slider label="Effort at" value={s.effort} min={0} max={4} step={0.05} unit="m" onChange={(effort) => set({ effort })} />
            <Slider label="Load" value={s.weight} min={1} max={5000} step={1} unit="N" onChange={(weight) => set({ weight })} />
          </>
        ) : (
          <>
            <Slider label="Ropes holding the load" value={s.strands} min={1} max={6} step={1} onChange={(strands) => set({ strands, pulled: Math.min(s.pulled, strands) })} test="mc-strands" />
            <Slider label="Load" value={s.pulleyLoad} min={1} max={10000} step={1} unit="N" onChange={(pulleyLoad) => set({ pulleyLoad })} />
            <Slider label="Efficiency" value={s.efficiency} min={10} max={100} step={1} unit="%" onChange={(efficiency) => set({ efficiency })} />
            <Slider label="Rope pulled" value={s.pulled} min={0} max={s.strands} step={0.05} unit="m" onChange={(pulled) => set({ pulled })} />
          </>
        )}
      </div>
      <div class="lab-stage">{body}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- forces -- */

function ForcesLab({ s, set }: Part<'forces'>) {
  const list = s.list;
  const r = resultant(list);
  const cx = W / 2;
  const cy = H / 2;
  const biggest = Math.max(1, r.size, ...list.map((f) => f.size));
  const scale = 140 / biggest;
  const tip = (f: Force) => ({ x: cx + f.size * scale * Math.cos(rad(f.angle)), y: cy - f.size * scale * Math.sin(rad(f.angle)) });
  const drag = useRef<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const setForce = (i: number, patch: Partial<Force>) => set({ list: list.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const onMove = (e: TargetedPointerEvent<SVGSVGElement>) => {
    const i = drag.current;
    const ctm = svg.current?.getScreenCTM();
    if (i === null || !ctm) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const dx = (p.x - cx) / scale;
    const dy = (cy - p.y) / scale;
    setForce(i, { size: Math.round(Math.hypot(dx, dy) * 10) / 10, angle: Math.round(((((Math.atan2(dy, dx) * 180) / Math.PI) % 360) + 360) % 360) });
  };
  let hx = cx;
  let hy = cy;
  const chain = list.map((f) => {
    const x2 = hx + f.size * scale * Math.cos(rad(f.angle));
    const y2 = hy - f.size * scale * Math.sin(rad(f.angle));
    const seg = { x1: hx, y1: hy, x2, y2 };
    hx = x2;
    hy = y2;
    return seg;
  });
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <table class="lab-table fo-table" data-testid="fo-table">
          <thead>
            <tr>
              <th>Force</th>
              <th>Size (N)</th>
              <th>Angle (°)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((f, i) => (
              <tr key={i}>
                <td>
                  <i class="fo-swatch" style={{ background: LAB_COLORS[i] }} />F{i + 1}
                </td>
                <td>
                  <NumberBox
                    className="input fo-num"
                    value={f.size}
                    min={0}
                    max={10000}
                    step={0.1}
                    label={`Force ${i + 1} size (N)`}
                    onChange={(size) => setForce(i, { size })}
                    test={`fo-size-${i}`}
                  />
                </td>
                <td>
                  <NumberBox
                    className="input fo-num"
                    value={f.angle}
                    min={-360}
                    max={360}
                    step={1}
                    label={`Force ${i + 1} angle (degrees)`}
                    onChange={(angle) => setForce(i, { angle })}
                    test={`fo-angle-${i}`}
                  />
                </td>
                <td>
                  {list.length > 1 && (
                    <button type="button" class="button button-small" aria-label={`Remove force ${i + 1}`} onClick={() => set({ list: list.filter((_, j) => j !== i) })}>
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div class="button-row">
          {list.length < 4 && (
            <button type="button" class="button button-small" onClick={() => set({ list: [...list, { size: 20, angle: 135 }] })}>
              Add a force
            </button>
          )}
          <button
            type="button"
            class="button button-small"
            onClick={() => set({ list: [...list, { size: r.size, angle: (r.angle + 180) % 360 }].slice(0, 4) })}
            disabled={list.length >= 4 || r.size < 1e-9}
          >
            Add the balancing force
          </button>
        </div>
        <label class="ms-check">
          <input type="checkbox" checked={s.polygon} onChange={(e) => set({ polygon: e.currentTarget.checked })} /> Draw them nose to tail
        </label>
        <p class="lab-note">Drag an arrow’s head to change it. Angles run anticlockwise from the right.</p>
      </div>
      <div class="lab-stage">
        <svg
          ref={svg}
          class="lab-scene fo-scene"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Forces and their resultant"
          data-testid="fo-scene"
          onPointerMove={onMove}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <line class="lab-faint" x1={20} x2={W - 20} y1={cy} y2={cy} />
          <line class="lab-faint" x1={cx} x2={cx} y1={10} y2={H - 10} />
          {s.polygon && chain.map((c, i) => <Arrow key={i} {...c} color={LAB_COLORS[i]} width={1.2} dashed />)}
          {r.size > 1e-9 && <Arrow x1={cx} y1={cy} x2={cx - r.x * scale} y2={cy + r.y * scale} color="var(--muted)" width={1.5} dashed />}
          {list.map((f, i) => {
            const t = tip(f);
            return <Arrow key={i} x1={cx} y1={cy} x2={t.x} y2={t.y} color={LAB_COLORS[i]} width={2.5} />;
          })}
          {r.size > 1e-9 && <Arrow x1={cx} y1={cy} x2={cx + r.x * scale} y2={cy - r.y * scale} color="var(--text)" width={4} test="fo-resultant" />}
          {list.map((f, i) => {
            const t = tip(f);
            return (
              <circle
                key={i}
                class="fo-handle"
                cx={t.x}
                cy={t.y}
                r="11"
                data-testid={`fo-handle-${i}`}
                onPointerDown={(e) => {
                  drag.current = i;
                  svg.current?.setPointerCapture(e.pointerId);
                }}
              />
            );
          })}
          <circle cx={cx} cy={cy} r="6" fill="var(--text)" />
        </svg>
        <Readouts
          test="fo-results"
          items={[
            ['Resultant', `${fmt(r.size, 4)} N at ${fmt(r.angle, 4)}°`],
            ['Components', `ΣFx = ${fmt(r.x, 4)} N, ΣFy = ${fmt(r.y, 4)} N`],
            ['Balancing force (equilibrant)', r.size > 1e-9 ? `${fmt(r.size, 4)} N at ${fmt((r.angle + 180) % 360, 4)}°` : 'none needed: the forces balance'],
          ]}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ tool -- */

function MechanicsLab({ toolId }: { toolId: string }) {
  const [s, setState] = usePersistentState(toolId, read, write);
  const part =
    <K extends Exclude<keyof State, 'tab'>>(key: K) =>
    (patch: Partial<State[K]>) =>
      setState((p) => ({ ...p, [key]: { ...p[key], ...patch } }));
  return (
    <section class="tool lab-tool" data-testid="tool" data-state="done">
      <LabTabs label="Experiment" value={s.tab} choices={TABS} onChange={(tab) => setState((p) => ({ ...p, tab }))} />
      {s.tab === 'projectile' && <ProjectileLab s={s.projectile} set={part('projectile')} />}
      {s.tab === 'pendulum' && <PendulumLab s={s.pendulum} set={part('pendulum')} />}
      {s.tab === 'spring' && <SpringLab s={s.spring} set={part('spring')} />}
      {s.tab === 'collision' && <CollisionLab s={s.collision} set={part('collision')} />}
      {s.tab === 'orbit' && <OrbitLab s={s.orbit} set={part('orbit')} />}
      {s.tab === 'incline' && <InclineLab s={s.incline} set={part('incline')} />}
      {s.tab === 'machines' && <MachinesLab s={s.machines} set={part('machines')} />}
      {s.tab === 'forces' && <ForcesLab s={s.forces} set={part('forces')} />}
    </section>
  );
}

export default defineCustomTool(MechanicsLab);
