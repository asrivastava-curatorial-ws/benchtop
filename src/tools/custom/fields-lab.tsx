/**
 * Waves, heat and fields lab: beats, standing waves and the Doppler effect
 * (all of them heard as well as seen), a gas of particles that shows
 * pressure, temperature and the speed distribution, electric fields and
 * equipotentials of charges you place, a generator with slip rings or a
 * commutator, and fluids — floating and sinking, and Bernoulli in a Venturi.
 */
import type { ComponentChildren, TargetedPointerEvent } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  buoyancy,
  type Charge,
  contour,
  doppler,
  fieldAt,
  fieldLines,
  type Gas,
  gasState,
  generator,
  harmonic,
  makeGas,
  maxwell2d,
  potentialAt,
  setTemperature,
  setWidth,
  stepGas,
  venturi,
} from '../../lib/physics-lab';
import { defineCustomTool, type Values } from '../types';
import { Arrow, fmt, LAB_COLORS, LabTabs, mergeStored, NumberBox, Plot, Readouts, Slider, useClock } from './_lab';
import { Segmented, usePersistentState } from './_shared';

type Tab = 'waves' | 'gas' | 'field' | 'generator' | 'fluids';
const TABS: readonly { readonly value: Tab; readonly label: string }[] = [
  { value: 'waves', label: 'Sound and waves' },
  { value: 'gas', label: 'Gas particles' },
  { value: 'field', label: 'Electric field' },
  { value: 'generator', label: 'Generator' },
  { value: 'fluids', label: 'Floating and flow' },
];
type WaveMode = 'beats' | 'standing' | 'doppler';
type Medium = 'string' | 'open' | 'closed';

const MATERIALS = { cork: 240, pine: 500, ice: 917, polythene: 950, aluminium: 2700, steel: 7850, gold: 19300 } as const;
const FLUIDS = { water: 1000, sea: 1025, oil: 910, glycerine: 1260, mercury: 13534 } as const;
const FLUID_NAMES: Readonly<Record<keyof typeof FLUIDS, string>> = { water: 'Fresh water', sea: 'Sea water', oil: 'Olive oil', glycerine: 'Glycerine', mercury: 'Mercury' };

const DEFAULTS = {
  tab: 'waves' as Tab,
  waves: { mode: 'beats' as WaveMode, f1: 440, f2: 444, a1: 1, a2: 1, medium: 'string' as Medium, length: 0.65, tension: 70, density: 1.2, temp: 20, n: 1, fs: 440, vs: 40, vo: 0 },
  gas: { n: 150, temp: 300, volume: 100, points: [] as readonly (readonly [number, number])[] },
  field: { charges: [] as readonly Charge[], lines: true, contours: true },
  generator: { turns: 200, field: 0.2, area: 50, rpm: 600, dc: false },
  fluids: { mode: 'buoyancy' as 'buoyancy' | 'venturi', material: 'pine' as keyof typeof MATERIALS, fluid: 'water' as keyof typeof FLUIDS, volume: 1000, flow: 2, d1: 50, d2: 25 },
};
type State = typeof DEFAULTS;
type Part<K extends keyof State> = { s: State[K]; set: (patch: Partial<State[K]>) => void };

const PRESETS: Readonly<Record<string, readonly Charge[]>> = {
  Dipole: [
    { x: 0.35, y: 0.3, q: 2 },
    { x: 0.65, y: 0.3, q: -2 },
  ],
  'One charge': [{ x: 0.5, y: 0.3, q: 2 }],
  'Like charges': [
    { x: 0.35, y: 0.3, q: 2 },
    { x: 0.65, y: 0.3, q: 2 },
  ],
  'Parallel plates': [...Array.from({ length: 9 }, (_, i) => ({ x: 0.2 + i * 0.075, y: 0.18, q: 0.6 })), ...Array.from({ length: 9 }, (_, i) => ({ x: 0.2 + i * 0.075, y: 0.42, q: -0.6 }))],
  Quadrupole: [
    { x: 0.4, y: 0.2, q: 1.5 },
    { x: 0.6, y: 0.2, q: -1.5 },
    { x: 0.6, y: 0.4, q: 1.5 },
    { x: 0.4, y: 0.4, q: -1.5 },
  ],
};

const read = (v: Values | undefined): State => {
  const s = mergeStored(DEFAULTS, v);
  const oneOf = <T extends string>(value: string, allowed: readonly T[], fallback: T): T => allowed.find((a) => a === value) ?? fallback;
  const charges = (Array.isArray(s.field.charges) ? s.field.charges : [])
    .filter((c): c is Charge => typeof c === 'object' && c !== null && [c.x, c.y, c.q].every((n) => typeof n === 'number' && Number.isFinite(n)))
    .slice(0, 30)
    .map((c) => ({ x: Math.min(1, Math.max(0, c.x)), y: Math.min(0.6, Math.max(0, c.y)), q: c.q }));
  const points = (Array.isArray(s.gas.points) ? s.gas.points : [])
    .filter((p): p is readonly [number, number] => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n)))
    .slice(-20);
  return {
    ...s,
    tab: oneOf(
      s.tab,
      TABS.map((t) => t.value),
      'waves',
    ),
    waves: { ...s.waves, mode: oneOf(s.waves.mode, ['beats', 'standing', 'doppler'] as const, 'beats'), medium: oneOf(s.waves.medium, ['string', 'open', 'closed'] as const, 'string') },
    gas: { ...s.gas, points },
    field: { ...s.field, charges: v === undefined || !Array.isArray((v.field as Record<string, unknown> | undefined)?.charges) ? (PRESETS.Dipole ?? []) : charges },
    fluids: {
      ...s.fluids,
      mode: oneOf(s.fluids.mode, ['buoyancy', 'venturi'] as const, 'buoyancy'),
      material: oneOf(s.fluids.material, Object.keys(MATERIALS) as (keyof typeof MATERIALS)[], 'pine'),
      fluid: oneOf(s.fluids.fluid, Object.keys(FLUIDS) as (keyof typeof FLUIDS)[], 'water'),
    },
  };
};
const write = (s: State): Values => JSON.parse(JSON.stringify(s)) as Values;

const W = 640;

/* ---------------------------------------------------------------- sound -- */

interface Tone {
  readonly f: number;
  readonly a: number;
}

/** Sine tones through the speakers, faded in and out to avoid clicks. */
function useTones() {
  const ctx = useRef<AudioContext | null>(null);
  const oscs = useRef<{ osc: OscillatorNode; gain: GainNode }[]>([]);
  const [playing, setPlaying] = useState(false);
  const stop = () => {
    const c = ctx.current;
    ctx.current = null;
    oscs.current = [];
    setPlaying(false);
    if (c) void c.close().catch(() => undefined);
  };
  const play = (tones: readonly Tone[], seconds?: number) => {
    stop();
    const AC = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!AC) return;
    const c = new AC();
    ctx.current = c;
    const master = c.createGain();
    master.gain.setValueAtTime(0, c.currentTime);
    master.gain.linearRampToValueAtTime(0.16, c.currentTime + 0.04);
    if (seconds) {
      master.gain.setValueAtTime(0.16, c.currentTime + Math.max(0.05, seconds - 0.06));
      master.gain.linearRampToValueAtTime(0, c.currentTime + seconds);
    }
    master.connect(c.destination);
    oscs.current = tones.map((t) => {
      const osc = c.createOscillator();
      osc.frequency.value = Math.max(1, Math.min(20000, t.f));
      const gain = c.createGain();
      gain.gain.value = t.a;
      osc.connect(gain).connect(master);
      osc.start();
      if (seconds) osc.stop(c.currentTime + seconds);
      return { osc, gain };
    });
    setPlaying(!seconds);
    if (seconds) window.setTimeout(() => ctx.current === c && stop(), seconds * 1000 + 100);
  };
  const update = (tones: readonly Tone[]) => {
    const c = ctx.current;
    if (!c) return;
    oscs.current.forEach((n, i) => {
      const t = tones[i];
      if (!t) return;
      n.osc.frequency.setTargetAtTime(Math.max(1, Math.min(20000, t.f)), c.currentTime, 0.02);
      n.gain.gain.setTargetAtTime(t.a, c.currentTime, 0.02);
    });
  };
  useEffect(() => stop, []);
  return { play, stop, update, playing };
}

function WavesLab({ s, set }: Part<'waves'>) {
  const tones = useTones();
  const [t, setT] = useState(0);
  useClock(s.mode !== 'beats', (dt) => setT((x) => x + dt));
  useEffect(() => {
    if (s.mode === 'beats')
      tones.update([
        { f: s.f1, a: s.a1 },
        { f: s.f2, a: s.a2 },
      ]);
  }, [s.f1, s.f2, s.a1, s.a2, s.mode]);
  useEffect(() => tones.stop(), [s.mode]);
  let body: ComponentChildren = null;
  if (s.mode === 'beats') {
    const beat = Math.abs(s.f1 - s.f2);
    const lo = Math.min(s.f1, s.f2);
    const short = 4 / lo;
    const long = beat > 0.05 ? Math.min(3, 2 / beat) : 0.1;
    const sample = (span: number, n: number, f: (x: number) => number) => Array.from({ length: n + 1 }, (_, i) => [(i / n) * span * 1000, f((i / n) * span)] as const);
    /** A long waveform as the highest and lowest value in each of 700 columns, so thousands of cycles still draw cleanly. */
    const waveform = (span: number, f: (x: number) => number) => {
      if (span * Math.max(s.f1, s.f2) < 350) return sample(span, 3000, f);
      const out: (readonly [number, number])[] = [];
      const cols = 700;
      for (let c = 0; c < cols; c++) {
        let lo = Number.POSITIVE_INFINITY;
        let hi = Number.NEGATIVE_INFINITY;
        for (let k = 0; k <= 16; k++) {
          const v = f(((c + k / 16) / cols) * span);
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
        const x = ((c + 0.5) / cols) * span * 1000;
        out.push([x, hi], [x, lo]);
      }
      return out;
    };
    const w1 = (x: number) => s.a1 * Math.sin(2 * Math.PI * s.f1 * x);
    const w2 = (x: number) => s.a2 * Math.sin(2 * Math.PI * s.f2 * x);
    const envelope = (x: number) => Math.sqrt(s.a1 ** 2 + s.a2 ** 2 + 2 * s.a1 * s.a2 * Math.cos(2 * Math.PI * (s.f1 - s.f2) * x));
    body = (
      <>
        <Readouts
          test="wv-results"
          items={[
            ['Beat frequency |f₁ − f₂|', `${fmt(beat, 4)} Hz`],
            ['Beats come every', beat > 0 ? `${fmt(1 / beat, 4)} s` : 'never (same pitch)'],
            ['Pitch heard', `${fmt((s.f1 + s.f2) / 2, 5)} Hz`],
            ['Loudest and quietest', `${fmt(s.a1 + s.a2, 3)} and ${fmt(Math.abs(s.a1 - s.a2), 3)} (amplitude)`],
          ]}
        />
        <div class="lab-plots">
          <Plot
            title="The two waves"
            test="wv-plot-waves"
            series={[
              { name: `${fmt(s.f1, 5)} Hz`, points: sample(short, 600, w1) },
              { name: `${fmt(s.f2, 5)} Hz`, points: sample(short, 600, w2) },
            ]}
            xLabel="time (ms)"
            yLabel="amplitude"
          />
          <Plot
            title="Added together: beats"
            test="wv-plot-sum"
            series={[
              { name: 'sum', points: waveform(long, (x) => w1(x) + w2(x)) },
              { name: 'envelope', points: sample(long, 400, envelope), dashed: true, color: 'var(--muted)' },
            ]}
            xLabel="time (ms)"
            yLabel="amplitude"
          />
        </div>
      </>
    );
  } else if (s.mode === 'standing') {
    const speed = s.medium === 'string' ? Math.sqrt(s.tension / (s.density / 1000)) : 331.3 * Math.sqrt(1 + s.temp / 273.15);
    const f = harmonic(s.medium, s.n, s.length, speed);
    const lambda = speed / f;
    const k = (2 * Math.PI) / lambda;
    const shape = (x: number) => (s.medium === 'open' ? Math.cos(k * x) : Math.sin(k * x));
    // Shown slowed down to about one swing a second.
    const phase = Math.cos(2 * Math.PI * 0.8 * t);
    const L = 520;
    const X = (x: number) => 60 + (x / s.length) * L;
    const pts = Array.from({ length: 241 }, (_, i) => (i / 240) * s.length);
    const amp = 60;
    const nodes: number[] = [];
    const antinodes: number[] = [];
    for (let m = 0; m <= 4 * s.n + 2; m++) {
      const x = (m * lambda) / 4;
      if (x > s.length + 1e-9) break;
      const v = Math.abs(shape(x));
      (v < 1e-6 ? nodes : antinodes).push(x);
    }
    const kinds = s.medium === 'closed' ? 'odd harmonics only' : 'every harmonic';
    const list = Array.from({ length: 5 }, (_, i) => fmt(harmonic(s.medium, i + 1, s.length, speed), 4)).join(', ');
    body = (
      <>
        <svg class="lab-scene" viewBox={`0 0 ${W} 200`} role="img" aria-label="Standing wave" data-testid="wv-standing">
          {s.medium === 'string' ? (
            <>
              <rect class="lab-solid" x={48} y={50} width={12} height={100} />
              <rect class="lab-solid" x={580} y={50} width={12} height={100} />
            </>
          ) : (
            <>
              <path class="lab-ink" d={`M60 ${100 - amp - 14}H580M60 ${100 + amp + 14}H580`} stroke-width="2" />
              {s.medium === 'closed' && <line class="lab-ink" x1={60} x2={60} y1={100 - amp - 14} y2={100 + amp + 14} stroke-width="5" />}
            </>
          )}
          {[1, 0.5, -0.5, -1].map((g) => (
            <path key={g} d={`M${pts.map((x) => `${X(x).toFixed(1)} ${(100 - amp * g * shape(x)).toFixed(1)}`).join('L')}`} fill="none" stroke="var(--line-strong)" stroke-width="1" />
          ))}
          <path d={`M${pts.map((x) => `${X(x).toFixed(1)} ${(100 - amp * phase * shape(x)).toFixed(1)}`).join('L')}`} fill="none" stroke={LAB_COLORS[0]} stroke-width="3" />
          {nodes.map((x) => (
            <text key={`n${x}`} class="lab-label" x={X(x)} y={190} text-anchor="middle">
              N
            </text>
          ))}
          {antinodes.map((x) => (
            <text key={`a${x}`} class="lab-label is-muted" x={X(x)} y={190} text-anchor="middle">
              A
            </text>
          ))}
        </svg>
        <p class="lab-note">
          {s.medium === 'string' ? 'The string is drawn as it moves; ' : 'The curve shows how far the air moves along the tube; '}N marks nodes (no movement) and A antinodes. Slowed down to be seen.
        </p>
        <Readouts
          test="wv-results"
          items={[
            ['Wave speed', `${fmt(speed, 4)} m/s`],
            [`Harmonic ${s.n}`, `${fmt(f, 5)} Hz`],
            ['Wavelength', `${fmt(lambda, 4)} m`],
            [`First five (${kinds})`, `${list} Hz`],
          ]}
        />
      </>
    );
  } else {
    const c = 343;
    const ahead = doppler(s.fs, c, s.vs, s.vo);
    const behind = doppler(s.fs, c, -s.vs, -s.vo);
    const mach = Math.abs(s.vs) / c;
    // Drawn in slow motion: sound crosses the picture in about four seconds.
    const cv = 150;
    const sv = (s.vs / c) * cv;
    const period = 0.3;
    const cycle = 6;
    const tt = t % cycle;
    const x0 = 320 - (sv * cycle) / 2;
    const fronts = [];
    for (let e = Math.floor(tt / period); e >= 0; e--) {
      const born = e * period;
      const r = cv * (tt - born);
      if (r > 900) break;
      fronts.push(<circle key={e} cx={x0 + sv * born} cy={150} r={r} fill="none" stroke={LAB_COLORS[0]} stroke-width="1.3" opacity={Math.max(0.15, 1 - r / 700)} />);
    }
    const src = x0 + sv * tt;
    body = (
      <>
        <svg class="lab-scene" viewBox={`0 0 ${W} 300`} role="img" aria-label="Wavefronts from a moving source" data-testid="wv-doppler">
          {fronts}
          <circle cx={src} cy={150} r={9} fill={LAB_COLORS[1]} stroke="var(--text)" />
          {Math.abs(sv) > 1 && <Arrow x1={src} y1={150} x2={src + Math.sign(sv) * 40} y2={150} color={LAB_COLORS[5]} />}
          {mach >= 1 && (
            <text class="lab-label" x={320} y={24} text-anchor="middle">
              Faster than sound: the wavefronts pile up into a shock cone (a sonic boom)
            </text>
          )}
        </svg>
        <Readouts
          test="wv-results"
          items={[
            ['Heard ahead (it is coming)', mach < 1 ? `${fmt(ahead, 5)} Hz` : 'nothing until the shock passes'],
            ['Heard behind (it is going)', `${fmt(behind, 5)} Hz`],
            ['Mach number', fmt(mach, 3)],
            ...(mach >= 1 ? ([['Shock cone half-angle', `${fmt((Math.asin(1 / mach) * 180) / Math.PI, 4)}°`]] as [string, string][]) : []),
          ]}
        />
      </>
    );
  }
  const playLabel = tones.playing ? 'Stop' : 'Play';
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <Segmented
          label="Wave experiment"
          value={s.mode}
          choices={[
            { value: 'beats', label: 'Beats' },
            { value: 'standing', label: 'Standing waves' },
            { value: 'doppler', label: 'Doppler' },
          ]}
          onChange={(mode) => set({ mode })}
        />
        {s.mode === 'beats' && (
          <>
            <Slider label="Tone 1" value={s.f1} min={20} max={2000} step={0.5} unit="Hz" onChange={(f1) => set({ f1 })} test="wv-f1" />
            <Slider label="Loudness 1" value={s.a1} min={0} max={1} step={0.01} onChange={(a1) => set({ a1 })} />
            <Slider label="Tone 2" value={s.f2} min={20} max={2000} step={0.5} unit="Hz" onChange={(f2) => set({ f2 })} test="wv-f2" />
            <Slider label="Loudness 2" value={s.a2} min={0} max={1} step={0.01} onChange={(a2) => set({ a2 })} />
            <div class="button-row">
              <button
                type="button"
                class="button button-primary button-small"
                data-testid="wv-play"
                onClick={() =>
                  tones.playing
                    ? tones.stop()
                    : tones.play([
                        { f: s.f1, a: s.a1 },
                        { f: s.f2, a: s.a2 },
                      ])
                }
              >
                {playLabel}
              </button>
            </div>
          </>
        )}
        {s.mode === 'standing' && (
          <>
            <Segmented
              label="Vibrating"
              value={s.medium}
              choices={[
                { value: 'string', label: 'String' },
                { value: 'open', label: 'Open pipe' },
                { value: 'closed', label: 'Closed pipe' },
              ]}
              onChange={(medium) => set({ medium })}
            />
            <Slider label="Length" value={s.length} min={0.05} max={5} step={0.01} unit="m" onChange={(length) => set({ length })} />
            {s.medium === 'string' ? (
              <>
                <Slider label="Tension" value={s.tension} min={1} max={1000} step={1} unit="N" onChange={(tension) => set({ tension })} />
                <Slider label="Mass per length" value={s.density} min={0.1} max={50} step={0.1} unit="g/m" onChange={(density) => set({ density })} />
              </>
            ) : (
              <Slider label="Air temperature" value={s.temp} min={-30} max={50} step={1} unit="°C" onChange={(temp) => set({ temp })} />
            )}
            <Slider label="Harmonic" value={s.n} min={1} max={8} step={1} onChange={(n) => set({ n })} test="wv-n" />
            <div class="button-row">
              <button
                type="button"
                class="button button-primary button-small"
                onClick={() => {
                  const speed = s.medium === 'string' ? Math.sqrt(s.tension / (s.density / 1000)) : 331.3 * Math.sqrt(1 + s.temp / 273.15);
                  tones.play([{ f: harmonic(s.medium, s.n, s.length, speed), a: 1 }], 1.5);
                }}
              >
                Hear it
              </button>
            </div>
          </>
        )}
        {s.mode === 'doppler' && (
          <>
            <Slider label="Source pitch" value={s.fs} min={50} max={2000} step={1} unit="Hz" onChange={(fs) => set({ fs })} />
            <Slider label="Source speed" value={s.vs} min={0} max={500} step={1} unit="m/s" onChange={(vs) => set({ vs })} test="wv-vs" />
            <Slider label="Listener speed (towards)" value={s.vo} min={0} max={200} step={1} unit="m/s" onChange={(vo) => set({ vo })} />
            <div class="button-row">
              <button type="button" class="button button-small" onClick={() => tones.play([{ f: doppler(s.fs, 343, s.vs, s.vo), a: 1 }], 1.2)} disabled={s.vs >= 343}>
                Hear it coming
              </button>
              <button type="button" class="button button-small" onClick={() => tones.play([{ f: doppler(s.fs, 343, -s.vs, -s.vo), a: 1 }], 1.2)}>
                Hear it going
              </button>
            </div>
          </>
        )}
      </div>
      <div class="lab-stage">{body}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ gas -- */

const GAS_H = 60;
const SPEED_COLOURS = ['#0072B2', '#56B4E9', '#E69F00', '#D55E00'];

function GasLab({ s, set }: Part<'gas'>) {
  const width = (100 * s.volume) / 100;
  const gas = useRef<Gas | null>(null);
  const windows = useRef<number[]>([]);
  const acc = useRef({ impulse: 0, time: 0 });
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, tick] = useState(0);
  const [running, setRunning] = useState(true);
  const fresh = () => {
    gas.current = makeGas(s.n, width, GAS_H, 0.7, s.temp, 11);
    windows.current = [];
    acc.current = { impulse: 0, time: 0 };
  };
  if (!gas.current || gas.current.n !== s.n) fresh();
  useEffect(() => {
    if (gas.current) setTemperature(gas.current, s.temp);
    windows.current = [];
  }, [s.temp]);
  useEffect(() => {
    if (gas.current) setWidth(gas.current, width);
    windows.current = [];
    acc.current = { impulse: 0, time: 0 };
  }, [width]);
  const draw = () => {
    const g = gas.current;
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!g || !el || !ctx) return;
    const scale = el.width / 100;
    ctx.clearRect(0, 0, el.width, el.height);
    const vrms = Math.sqrt(2 * s.temp);
    for (let i = 0; i < g.n; i++) {
      const v = Math.hypot(g.vx[i] ?? 0, g.vy[i] ?? 0) / vrms;
      ctx.fillStyle = SPEED_COLOURS[v < 0.6 ? 0 : v < 1 ? 1 : v < 1.4 ? 2 : 3] ?? '#000';
      ctx.beginPath();
      ctx.arc((g.x[i] ?? 0) * scale, (g.y[i] ?? 0) * scale, Math.max(1.5, g.r * scale), 0, 2 * Math.PI);
      ctx.fill();
    }
  };
  useClock(running, (dt) => {
    const g = gas.current;
    if (!g) return;
    const vmax = 4 * Math.sqrt(2 * s.temp);
    const n = Math.min(40, Math.max(1, Math.ceil((dt * vmax) / (g.r * 0.6))));
    const before = { impulse: g.impulse, time: g.time };
    for (let i = 0; i < n; i++) stepGas(g, dt / n);
    acc.current.impulse += g.impulse - before.impulse;
    acc.current.time += g.time - before.time;
    if (acc.current.time >= 0.5) {
      windows.current = [...windows.current.slice(-9), acc.current.impulse / (acc.current.time * 2 * (g.width + g.height))];
      acc.current = { impulse: 0, time: 0 };
    }
    draw();
    tick((k) => k + 1);
  });
  useEffect(draw);
  const g = gas.current;
  const st = g ? gasState(g) : { kT: s.temp, pressure: Number.NaN, ideal: Number.NaN, area: 1 };
  const pressure = windows.current.length ? windows.current.reduce((a, b) => a + b, 0) / windows.current.length : Number.NaN;
  // Speed histogram against the two-dimensional Maxwell–Boltzmann curve.
  const vrms = Math.sqrt(2 * st.kT);
  const top = 3 * vrms;
  const bins = 24;
  const counts = new Array<number>(bins).fill(0);
  if (g) for (let i = 0; i < g.n; i++) counts[Math.min(bins - 1, Math.floor((Math.hypot(g.vx[i] ?? 0, g.vy[i] ?? 0) / top) * bins))]++;
  const bw = top / bins;
  const steps: [number, number][] = [];
  counts.forEach((c, i) => {
    steps.push([i * bw, c], [(i + 1) * bw, c]);
  });
  const theory = Array.from({ length: 121 }, (_, i) => {
    const v = (i / 120) * top;
    return [v, s.n * bw * maxwell2d(v, st.kT)] as const;
  });
  const vol = width * GAS_H;
  const boyle = Array.from({ length: 81 }, (_, i) => {
    const v = GAS_H * (25 + (i / 80) * 80);
    return [v, (s.n * s.temp) / v] as const;
  });
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <Slider label="Particles" value={s.n} min={10} max={400} step={1} onChange={(n) => set({ n })} test="gs-n" />
        <Slider label="Temperature" value={s.temp} min={30} max={1500} step={1} unit="K" onChange={(temp) => set({ temp })} test="gs-temp" />
        <Slider label="Volume (piston)" value={s.volume} min={30} max={100} step={1} unit="%" onChange={(volume) => set({ volume })} test="gs-volume" />
        <div class="button-row">
          <button type="button" class="button button-primary button-small" onClick={() => setRunning((r) => !r)}>
            {running ? 'Pause' : 'Run'}
          </button>
          <button type="button" class="button button-small" onClick={() => Number.isFinite(pressure) && set({ points: [...s.points, [vol, pressure] as const].slice(-20) })} data-testid="gs-record">
            Record pressure and volume
          </button>
          {s.points.length > 0 && (
            <button type="button" class="button button-small" onClick={() => set({ points: [] })}>
              Clear
            </button>
          )}
        </div>
        <p class="lab-note">
          Simulation units: each particle has mass 1 and Boltzmann’s constant is 1, so the numbers show how pressure, volume and temperature relate rather than real values. In two dimensions pressure
          is a force per length of wall.
        </p>
      </div>
      <div class="lab-stage">
        <div class="gs-box" style={{ '--gs-width': `${s.volume}%` }}>
          <canvas ref={canvas} class="gs-canvas" width={800} height={480} data-testid="gs-canvas" />
          <div class="gs-piston" />
        </div>
        <div class="lab-legend">
          {['slow', 'average', 'fast', 'fastest'].map((label, i) => (
            <span key={label}>
              <i style={{ background: SPEED_COLOURS[i] }} />
              {label}
            </span>
          ))}
        </div>
        <Readouts
          test="gs-results"
          items={[
            ['Temperature (mean kinetic energy)', `${fmt(st.kT, 4)} K`],
            ['Pressure measured on the walls', Number.isFinite(pressure) ? fmt(pressure, 4) : 'measuring…'],
            ['Ideal gas law NkT ÷ V', fmt(st.ideal, 4)],
            ['Measured ÷ ideal', Number.isFinite(pressure) ? fmt(pressure / st.ideal, 3) : '—'],
            ['Root-mean-square speed', fmt(vrms, 4)],
          ]}
        />
        <div class="lab-plots">
          <Plot
            title="Speeds of the particles"
            test="gs-plot"
            series={[
              { name: 'particles', points: steps },
              { name: 'Maxwell–Boltzmann', points: theory, dashed: true },
            ]}
            xLabel="speed"
            yLabel="particles"
            xRange={[0, top]}
          />
          {s.points.length > 0 && (
            <Plot
              title="Pressure against volume (Boyle’s law)"
              series={[{ name: 'pV = NkT', points: boyle, dashed: true }]}
              xLabel="volume"
              yLabel="pressure"
              points={s.points.map(([x, y]) => ({ x, y }))}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- electric field -- */

const BOX: readonly [number, number, number, number] = [0, 0, 1, 0.6];
const PX = 640;

function potentialImage(charges: readonly Charge[], scale: number): string {
  if (typeof document === 'undefined') return '';
  const nx = 160;
  const ny = 96;
  const el = document.createElement('canvas');
  el.width = nx;
  el.height = ny;
  const ctx = el.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(nx, ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const v = Math.tanh(potentialAt(charges, ((i + 0.5) / nx) * BOX[2], ((j + 0.5) / ny) * BOX[3]) / scale);
      const k = 4 * (j * nx + i);
      // Vermilion for positive potential, blue for negative, clear at zero.
      const [r, g, b] = v > 0 ? [213, 94, 0] : [0, 114, 178];
      img.data[k] = r;
      img.data[k + 1] = g;
      img.data[k + 2] = b;
      img.data[k + 3] = Math.round(Math.abs(v) * 120);
    }
  ctx.putImageData(img, 0, 0);
  return el.toDataURL();
}

function FieldLab({ s, set }: Part<'field'>) {
  const charges = s.charges;
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [probe, setProbe] = useState<readonly [number, number] | null>(null);
  const [adding, setAdding] = useState<number>(0);
  const lines = useMemo(() => (s.lines && charges.length ? fieldLines(charges, BOX, 6) : []), [charges, s.lines]);
  // Equipotentials: the potential on a grid, then contours at levels spread around its typical size.
  const grid = useMemo(() => {
    const nx = 101;
    const ny = 61;
    const values = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) values[j * nx + i] = potentialAt(charges, (i / (nx - 1)) * BOX[2], (j / (ny - 1)) * BOX[3]);
    const sorted = [...values].map(Math.abs).sort((a, b) => a - b);
    const typical = sorted[Math.floor(sorted.length / 2)] || 1;
    return { values, nx, ny, typical };
  }, [charges]);
  const levels = useMemo(() => {
    if (!s.contours || !charges.length) return [];
    const base = grid.typical;
    const out: number[] = [];
    for (const m of [0.25, 0.5, 1, 2, 4]) out.push(base * m, -base * m);
    if (charges.some((c) => c.q > 0) && charges.some((c) => c.q < 0)) out.push(0);
    return out.map((level) => ({ level, segs: contour(grid.values, grid.nx, grid.ny, 0, 0, BOX[2] / (grid.nx - 1), BOX[3] / (grid.ny - 1), level) }));
  }, [grid, s.contours, charges]);
  const image = useMemo(() => potentialImage(charges, grid.typical * 2), [charges, grid.typical]);
  const world = (e: { clientX: number; clientY: number }): [number, number] => {
    const ctm = svg.current?.getScreenCTM();
    if (!ctm) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return [Math.min(BOX[2], Math.max(0, p.x / PX)), Math.min(BOX[3], Math.max(0, p.y / PX))];
  };
  const hit = (p: readonly [number, number]) => charges.findIndex((c) => Math.hypot(c.x - p[0], c.y - p[1]) < 0.025);
  const onDown = (e: TargetedPointerEvent<SVGSVGElement>) => {
    const p = world(e);
    const i = hit(p);
    if (i >= 0) {
      drag.current = i;
      setSelected(i);
      svg.current?.setPointerCapture(e.pointerId);
      return;
    }
    if (adding !== 0 && charges.length < 30) {
      set({ charges: [...charges, { x: Math.round(p[0] * 100) / 100, y: Math.round(p[1] * 100) / 100, q: adding }] });
      setSelected(charges.length);
      return;
    }
    setSelected(null);
  };
  const onMove = (e: TargetedPointerEvent<SVGSVGElement>) => {
    const p = world(e);
    setProbe(p);
    const i = drag.current;
    if (i === null) return;
    set({ charges: charges.map((c, j) => (j === i ? { ...c, x: Math.round(p[0] * 200) / 200, y: Math.round(p[1] * 200) / 200 } : c)) });
  };
  const E = probe ? fieldAt(charges, probe[0], probe[1]) : null;
  const V = probe ? potentialAt(charges, probe[0], probe[1]) : null;
  const sel = selected !== null ? charges[selected] : undefined;
  const lineArrow = (line: [number, number][]) => {
    const mid = line[Math.floor(line.length / 2)];
    const next = line[Math.floor(line.length / 2) + 1];
    if (!mid || !next) return null;
    return <Arrow x1={mid[0] * PX} y1={mid[1] * PX} x2={mid[0] * PX + (next[0] - mid[0]) * PX * 3} y2={mid[1] * PX + (next[1] - mid[1]) * PX * 3} color="var(--text)" width={1} head={7} />;
  };
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <select
          class="input"
          aria-label="Start from"
          value=""
          data-testid="ef-preset"
          onChange={(e) => {
            const preset = PRESETS[e.currentTarget.value];
            if (preset) {
              set({ charges: preset });
              setSelected(null);
            }
          }}
        >
          <option value="">Start from…</option>
          {Object.keys(PRESETS).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <h3>Click the picture to add</h3>
        <Segmented
          label="Click adds"
          value={String(adding) as '0' | '1' | '-1'}
          choices={[
            { value: '0', label: 'Nothing' },
            { value: '1', label: '+1 nC' },
            { value: '-1', label: '−1 nC' },
          ]}
          onChange={(v) => setAdding(Number(v))}
        />
        <label class="ms-check">
          <input type="checkbox" checked={s.lines} onChange={(e) => set({ lines: e.currentTarget.checked })} /> Field lines
        </label>
        <label class="ms-check">
          <input type="checkbox" checked={s.contours} onChange={(e) => set({ contours: e.currentTarget.checked })} /> Equipotential lines
        </label>
        {sel && selected !== null && (
          <div class="ms-selected">
            <h3>Charge {selected + 1}</h3>
            <div class="ms-field">
              Charge
              <NumberBox value={sel.q} min={-20} max={20} step={0.1} label="Charge (nC)" test="ef-q" onChange={(q) => set({ charges: charges.map((c, j) => (j === selected ? { ...c, q } : c)) })} />
              <span class="lab-unit">nC</span>
            </div>
            <div class="button-row">
              <button
                type="button"
                class="button button-small"
                onClick={() => {
                  set({ charges: charges.filter((_, j) => j !== selected) });
                  setSelected(null);
                }}
              >
                Remove
              </button>
            </div>
          </div>
        )}
        <div class="button-row">
          <button
            type="button"
            class="button button-small"
            onClick={() => {
              set({ charges: [] });
              setSelected(null);
            }}
          >
            Clear all
          </button>
        </div>
        <p class="lab-note">Drag a charge to move it. Point anywhere to read the field there. The picture is 1 m across.</p>
      </div>
      <div class="lab-stage">
        <svg
          ref={svg}
          class="lab-scene ef-scene"
          viewBox={`0 0 ${PX} ${BOX[3] * PX}`}
          role="img"
          aria-label="Electric field of the charges"
          data-testid="ef-scene"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerLeave={() => setProbe(null)}
        >
          {image && <image href={image} x={0} y={0} width={PX} height={BOX[3] * PX} preserveAspectRatio="none" />}
          {levels.map(({ level, segs }) => (
            <path
              key={level}
              class={level === 0 ? 'ef-contour is-zero' : 'ef-contour'}
              d={segs.map(([x1, y1, x2, y2]) => `M${(x1 * PX).toFixed(1)} ${(y1 * PX).toFixed(1)}L${(x2 * PX).toFixed(1)} ${(y2 * PX).toFixed(1)}`).join('')}
            />
          ))}
          {lines.map((line, i) => (
            <g key={i}>
              <path class="ef-line" d={`M${line.map((p) => `${(p[0] * PX).toFixed(1)} ${(p[1] * PX).toFixed(1)}`).join('L')}`} />
              {lineArrow(line)}
            </g>
          ))}
          {charges.map((c, i) => (
            <g key={i} class={`ef-charge${c.q >= 0 ? ' is-positive' : ' is-negative'}${i === selected ? ' is-selected' : ''}`} data-testid={`ef-charge-${i}`}>
              <circle cx={c.x * PX} cy={c.y * PX} r={9 + Math.min(6, Math.abs(c.q))} />
              <text x={c.x * PX} y={c.y * PX + 5} text-anchor="middle">
                {c.q >= 0 ? '+' : '−'}
              </text>
            </g>
          ))}
          {probe && E && Math.hypot(E[0], E[1]) > 0 && (
            <Arrow
              x1={probe[0] * PX}
              y1={probe[1] * PX}
              x2={probe[0] * PX + (E[0] / Math.hypot(E[0], E[1])) * 36}
              y2={probe[1] * PX + (E[1] / Math.hypot(E[0], E[1])) * 36}
              color={LAB_COLORS[2]}
              width={2}
            />
          )}
        </svg>
        <Readouts
          test="ef-results"
          items={[
            [
              'Charges',
              `${charges.length} (total ${fmt(
                charges.reduce((a, c) => a + c.q, 0),
                3,
              )} nC)`,
            ],
            ['Field where you point', E ? `${fmt(Math.hypot(E[0], E[1]), 4)} V/m at ${fmt(((((Math.atan2(-E[1], E[0]) * 180) / Math.PI) % 360) + 360) % 360, 3)}°` : 'point at the picture'],
            ['Potential there', V !== null ? `${fmt(V, 4)} V` : '—'],
            ['Force on +1 nC there', E ? `${fmt(Math.hypot(E[0], E[1]) * 1e-9, 3)} N` : '—'],
          ]}
        />
        <div class="lab-legend">
          <span>
            <i style={{ background: '#D55E00' }} />
            higher potential
          </span>
          <span>
            <i style={{ background: '#0072B2' }} />
            lower potential
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ generator -- */

function GeneratorLab({ s, set }: Part<'generator'>) {
  const area = s.area / 1e4;
  const g0 = generator(s.turns, s.field, area, s.rpm, 0, s.dc);
  const [angle, setAngle] = useState(0);
  const [running, setRunning] = useState(true);
  // Shown at no more than half a turn a second, so the coil can be followed.
  const shownRps = Math.min(s.rpm / 60, 0.5);
  useClock(running, (dt) => setAngle((a) => (a + 360 * shownRps * dt) % 720));
  const th = (angle * Math.PI) / 180;
  const emfAt = (deg: number) => {
    const e = g0.peak * Math.sin((deg * Math.PI) / 180);
    return s.dc ? Math.abs(e) : e;
  };
  const emf = emfAt(angle);
  const curve = Array.from({ length: 361 }, (_, i) => [i * 2, emfAt(i * 2)] as const);
  const cx = 320;
  const cy = 130;
  const half = 90 * Math.sin(th);
  const needle = s.dc ? -Math.PI + (emf / g0.peak) * Math.PI : -Math.PI / 2 + (emf / g0.peak) * (Math.PI / 2.4);
  const fieldLinesDrawn = [70, 100, 130, 160, 190];
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <Slider label="Turns of wire" value={s.turns} min={1} max={2000} step={1} onChange={(turns) => set({ turns })} test="gn-turns" />
        <Slider label="Magnetic field" value={s.field} min={0.01} max={2} step={0.01} unit="T" onChange={(field) => set({ field })} />
        <Slider label="Coil area" value={s.area} min={1} max={500} step={1} unit="cm²" onChange={(a) => set({ area: a })} />
        <Slider label="Speed" value={s.rpm} min={1} max={3600} step={1} unit="rpm" onChange={(rpm) => set({ rpm })} test="gn-rpm" />
        <Segmented
          label="Connections"
          value={s.dc ? 'dc' : 'ac'}
          choices={[
            { value: 'ac', label: 'Slip rings (AC)' },
            { value: 'dc', label: 'Split ring (DC)' },
          ]}
          onChange={(v) => set({ dc: v === 'dc' })}
        />
        <div class="button-row">
          <button type="button" class="button button-primary button-small" onClick={() => setRunning((r) => !r)}>
            {running ? 'Pause' : 'Run'}
          </button>
        </div>
        {s.rpm / 60 > 0.5 && <p class="lab-note">Shown slowed down; the numbers are for the real speed.</p>}
      </div>
      <div class="lab-stage">
        <svg class="lab-scene" viewBox={`0 0 ${W} 300`} role="img" aria-label="Coil turning between magnet poles" data-testid="gn-scene">
          <rect x={60} y={40} width={90} height={180} rx="6" fill="#D55E00" opacity="0.85" />
          <rect x={490} y={40} width={90} height={180} rx="6" fill="#0072B2" opacity="0.85" />
          <text class="lab-label" x={105} y={136} text-anchor="middle" style={{ fill: '#fff' }} font-size="22">
            N
          </text>
          <text class="lab-label" x={535} y={136} text-anchor="middle" style={{ fill: '#fff' }} font-size="22">
            S
          </text>
          {fieldLinesDrawn.map((y) => (
            <Arrow key={y} x1={160} y1={y} x2={480} y2={y} color="var(--line-strong)" width={1} head={7} />
          ))}
          <line class="lab-faint" x1={cx} x2={cx} y1={24} y2={260} stroke-dasharray="4 4" />
          <path
            d={`M${cx - half} ${cy - 70}H${cx + half}V${cy + 70}H${cx - half}Z`}
            fill={Math.cos(th) > 0 ? 'color-mix(in srgb, var(--brass) 25%, transparent)' : 'color-mix(in srgb, var(--brass) 12%, transparent)'}
            stroke="var(--brass)"
            stroke-width="5"
            stroke-linejoin="round"
          />
          <circle cx={cx + half} cy={cy} r="5" fill={LAB_COLORS[2]} />
          {/* Slip rings or the split ring, with brushes. */}
          {s.dc ? (
            <g>
              <path d={`M${cx - 26} 262A26 14 0 0 1 ${cx - 4} 249`} fill="none" stroke="var(--brass)" stroke-width="7" />
              <path d={`M${cx + 4} 249A26 14 0 0 1 ${cx + 26} 262`} fill="none" stroke="var(--brass)" stroke-width="7" />
            </g>
          ) : (
            <g>
              <ellipse cx={cx} cy={250} rx={26} ry={8} fill="none" stroke="var(--brass)" stroke-width="5" />
              <ellipse cx={cx} cy={272} rx={26} ry={8} fill="none" stroke="var(--brass)" stroke-width="5" />
            </g>
          )}
          <rect class="lab-solid" x={cx - 48} y={250} width={14} height={20} />
          <rect class="lab-solid" x={cx + 34} y={250} width={14} height={20} />
          {/* The meter. */}
          <g transform="translate(560 270)">
            <path d="M-46 0A46 46 0 0 1 46 0" fill="none" stroke="var(--line-strong)" stroke-width="2" />
            <line x1={0} y1={0} x2={44 * Math.cos(needle)} y2={44 * Math.sin(needle)} stroke={LAB_COLORS[5]} stroke-width="2.5" />
            <circle r="4" fill="var(--text)" />
          </g>
        </svg>
        <Readouts
          test="gn-results"
          items={[
            ['Peak voltage NBAω', `${fmt(g0.peak, 4)} V`],
            [s.dc ? 'Average (DC)' : 'RMS (AC)', `${fmt(s.dc ? g0.mean : g0.rms, 4)} V`],
            ['Frequency', `${fmt(g0.frequency, 4)} Hz (one turn in ${fmt(1 / g0.frequency, 4)} s)`],
            ['Now', `${fmt(emf, 4)} V at ${fmt(angle % 360, 3)}°`],
          ]}
        />
        <div class="lab-plots">
          <Plot title="Voltage over two turns" test="gn-plot" series={[{ name: 'voltage', points: curve }]} xLabel="coil angle (°)" yLabel="V" marker={angle} xRange={[0, 720]} />
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- fluids -- */

const MATERIAL_NAMES: Readonly<Record<keyof typeof MATERIALS, string>> = { cork: 'Cork', pine: 'Pine wood', ice: 'Ice', polythene: 'Polythene', aluminium: 'Aluminium', steel: 'Steel', gold: 'Gold' };

function FluidsLab({ s, set }: Part<'fluids'>) {
  const g = 9.80665;
  const rho = MATERIALS[s.material];
  const fluid = FLUIDS[s.fluid];
  const vol = s.volume / 1e6;
  const b = buoyancy(rho, vol, fluid, g);
  const [t, setT] = useState(0);
  useClock(true, (dt) => setT((x) => x + dt));
  const [dropAt, setDropAt] = useState(0);
  useEffect(() => setDropAt(t), [s.material, s.fluid, s.volume]);
  let body: ComponentChildren;
  if (s.mode === 'buoyancy') {
    const side = 90;
    const surface = 110;
    const bottom = 280;
    const restTop = b.floats ? surface - side * (1 - b.submerged) : bottom - side;
    // Dropped in from above, settling with a little bounce.
    const age = t - dropAt;
    const start = 10;
    const top = restTop + (start - restTop) * Math.exp(-2.4 * age) * Math.cos(Math.min(age * 7, 40));
    const arrowScale = 80 / Math.max(b.weight, b.fullUpthrust);
    const under = Math.max(0, Math.min(side, top + side - surface)) / side;
    const upthrust = fluid * vol * under * g;
    body = (
      <>
        <svg class="lab-scene" viewBox={`0 0 ${W} 300`} role="img" aria-label="Block in a tank of liquid" data-testid="fl-scene">
          <rect x={170} y={surface} width={300} height={bottom - surface} fill="color-mix(in srgb, #56B4E9 35%, transparent)" />
          <path class="lab-ink" d={`M170 40V${bottom}H470V40`} stroke-width="3" />
          <rect x={320 - side / 2} y={top} width={side} height={side} fill="color-mix(in srgb, var(--brass) 60%, var(--panel))" stroke="var(--text)" stroke-width="1.5" />
          <Arrow x1={320 - 14} y1={top + side / 2} x2={320 - 14} y2={top + side / 2 + b.weight * arrowScale} color={LAB_COLORS[0]} width={3} />
          {upthrust > 0 && <Arrow x1={320 + 14} y1={top + side / 2} x2={320 + 14} y2={top + side / 2 - upthrust * arrowScale} color={LAB_COLORS[2]} width={3} />}
        </svg>
        <div class="lab-legend">
          <span>
            <i style={{ background: LAB_COLORS[0] }} />
            weight
          </span>
          <span>
            <i style={{ background: LAB_COLORS[2] }} />
            upthrust
          </span>
        </div>
        <Readouts
          test="fl-results"
          items={[
            ['It', b.floats ? `floats, ${fmt(b.submerged * 100, 3)} % under the surface` : 'sinks'],
            ['Weight', `${fmt(b.weight, 4)} N`],
            ['Upthrust when fully under', `${fmt(b.fullUpthrust, 4)} N (the weight of liquid pushed aside)`],
            ['Weighs in the liquid', `${fmt(b.apparent, 4)} N`],
          ]}
        />
      </>
    );
  } else {
    const v = venturi(s.flow / 1000, s.d1 / 1000, s.d2 / 1000, 1000, g);
    const wide = 90;
    const narrow = (wide * s.d2) / s.d1;
    const yMid = 212;
    const halfAt = (x: number) => {
      if (x < 220 || x > 480) return wide / 2;
      if (x < 290) return wide / 2 + ((narrow - wide) / 2) * ((x - 220) / 70);
      if (x < 350) return narrow / 2;
      return narrow / 2 + ((wide - narrow) / 2) * ((x - 350) / 130);
    };
    const xs = Array.from({ length: 121 }, (_, i) => 40 + i * 4.67);
    const upper = xs.map((x) => `${x.toFixed(1)} ${(yMid - halfAt(x)).toFixed(1)}`);
    const lower = xs.map((x) => `${x.toFixed(1)} ${(yMid + halfAt(x)).toFixed(1)}`);
    // Tracer dots, drawn slowed down: the time to cross each bit of pipe grows with its area, so they hurry through the throat.
    const speedAt = (x: number) => v.v1 * (wide / 2 / halfAt(x)) ** 2;
    const stations: number[] = [];
    const transit: number[] = [];
    let total = 0;
    for (let x = 40; x <= 600; x += 2) {
      stations.push(x);
      transit.push(total);
      total += (halfAt(x) / (wide / 2)) ** 2;
    }
    const xAt = (share: number) => {
      const want = share * total;
      let lo = 0;
      let hi = transit.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if ((transit[mid] ?? 0) <= want) lo = mid;
        else hi = mid;
      }
      return stations[lo] ?? 40;
    };
    const dots = [];
    for (let lane = -2; lane <= 2; lane++)
      for (let k = 0; k < 8; k++) {
        const x = xAt((((t / 5 + k / 8 + lane * 0.061) % 1) + 1) % 1);
        const y = yMid + (lane / 2.6) * halfAt(x);
        dots.push(<circle key={`${lane}-${k}`} cx={x} cy={y} r="2.6" fill={LAB_COLORS[0]} opacity={Math.min(1, 0.45 + speedAt(x) / (2 * v.v2))} />);
      }
    const headScale = Math.min(110 / Math.max(v.head, 1e-9), 1200);
    const h1 = Math.min(136, 30 + v.head * headScale);
    const h2 = Math.max(0, h1 - v.head * headScale);
    body = (
      <>
        <svg class="lab-scene" viewBox={`0 0 ${W} 280`} role="img" aria-label="Venturi tube with pressure gauges" data-testid="fl-scene">
          <path d={`M${upper.join('L')}L${[...lower].reverse().join('L')}Z`} fill="color-mix(in srgb, #56B4E9 25%, transparent)" stroke="none" />
          <path class="lab-ink" d={`M${upper.join('L')}`} stroke-width="2.5" />
          <path class="lab-ink" d={`M${lower.join('L')}`} stroke-width="2.5" />
          {dots}
          {[
            { x: 130, h: h1, label: 'p₁' },
            { x: 320, h: h2, label: 'p₂' },
          ].map((m) => {
            const base = yMid - halfAt(m.x);
            return (
              <g key={m.label}>
                <rect x={m.x - 7} y={base - 140} width={14} height={140} fill="none" stroke="var(--text)" stroke-width="1.5" />
                <rect x={m.x - 6} y={base - Math.min(136, m.h)} width={12} height={Math.min(136, m.h)} fill="color-mix(in srgb, #56B4E9 60%, transparent)" />
                <text class="lab-label" x={m.x + 14} y={base - 126}>
                  {m.label}
                </text>
              </g>
            );
          })}
        </svg>
        <Readouts
          test="fl-results"
          items={[
            ['Speed in the wide pipe', `${fmt(v.v1, 4)} m/s`],
            ['Speed in the throat', `${fmt(v.v2, 4)} m/s (A₁v₁ = A₂v₂)`],
            ['Pressure drop p₁ − p₂', `${fmt(v.drop, 4)} Pa (½ρ(v₂² − v₁²))`],
            ['Difference in the gauge tubes', `${fmt(v.head * 1000, 4)} mm of water`],
          ]}
        />
      </>
    );
  }
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <Segmented
          label="Fluid experiment"
          value={s.mode}
          choices={[
            { value: 'buoyancy', label: 'Float or sink' },
            { value: 'venturi', label: 'Bernoulli (Venturi)' },
          ]}
          onChange={(mode) => set({ mode })}
        />
        {s.mode === 'buoyancy' ? (
          <>
            <label class="ms-field ms-probe">
              Block
              <select class="input" value={s.material} onChange={(e) => set({ material: e.currentTarget.value as keyof typeof MATERIALS })} data-testid="fl-material">
                {(Object.keys(MATERIALS) as (keyof typeof MATERIALS)[]).map((m) => (
                  <option key={m} value={m}>
                    {MATERIAL_NAMES[m]} ({MATERIALS[m]} kg/m³)
                  </option>
                ))}
              </select>
            </label>
            <label class="ms-field ms-probe">
              Liquid
              <select class="input" value={s.fluid} onChange={(e) => set({ fluid: e.currentTarget.value as keyof typeof FLUIDS })} data-testid="fl-fluid">
                {(Object.keys(FLUIDS) as (keyof typeof FLUIDS)[]).map((f) => (
                  <option key={f} value={f}>
                    {FLUID_NAMES[f]} ({FLUIDS[f]} kg/m³)
                  </option>
                ))}
              </select>
            </label>
            <Slider label="Volume" value={s.volume} min={1} max={10000} step={1} unit="cm³" onChange={(volume) => set({ volume })} />
            <div class="button-row">
              <button type="button" class="button button-small" onClick={() => setDropAt(t)}>
                Drop it in again
              </button>
            </div>
          </>
        ) : (
          <>
            <Slider label="Flow" value={s.flow} min={0.1} max={20} step={0.1} unit="L/s" onChange={(flow) => set({ flow })} test="fl-flow" />
            <Slider label="Pipe diameter" value={s.d1} min={10} max={200} step={1} unit="mm" onChange={(d1) => set({ d1, d2: Math.min(s.d2, d1) })} />
            <Slider label="Throat diameter" value={s.d2} min={5} max={200} step={1} unit="mm" onChange={(d2) => set({ d2: Math.min(d2, s.d1) })} />
          </>
        )}
      </div>
      <div class="lab-stage">{body}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ tool -- */

function FieldsLab({ toolId }: { toolId: string }) {
  const [s, setState] = usePersistentState(toolId, read, write);
  const part =
    <K extends Exclude<keyof State, 'tab'>>(key: K) =>
    (patch: Partial<State[K]>) =>
      setState((p) => ({ ...p, [key]: { ...p[key], ...patch } }));
  return (
    <section class="tool lab-tool" data-testid="tool" data-state="done">
      <LabTabs label="Experiment" value={s.tab} choices={TABS} onChange={(tab) => setState((p) => ({ ...p, tab }))} />
      {s.tab === 'waves' && <WavesLab s={s.waves} set={part('waves')} />}
      {s.tab === 'gas' && <GasLab s={s.gas} set={part('gas')} />}
      {s.tab === 'field' && <FieldLab s={s.field} set={part('field')} />}
      {s.tab === 'generator' && <GeneratorLab s={s.generator} set={part('generator')} />}
      {s.tab === 'fluids' && <FluidsLab s={s.fluids} set={part('fluids')} />}
    </section>
  );
}

export default defineCustomTool(FieldsLab);
