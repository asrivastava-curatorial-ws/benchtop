/**
 * Machine elements lab: a cam and follower designer (motion programs,
 * displacement, velocity, acceleration and jerk, pressure angle, undercut
 * check, profile export), the Geneva drive, and gear trains — compound and
 * planetary — all animated.
 */
import type { JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import {
  type CamDesign,
  type CamSegment,
  camProfile,
  checkCam,
  type FollowerKind,
  followerAt,
  geneva,
  genevaAt,
  LAW_NAMES,
  type Member,
  type MotionLaw,
  parseTrain,
  planetaryProblems,
  planetarySpeeds,
  programProblems,
  type SegmentKind,
  trainRatio,
} from '../../lib/machine-elements';
import { saveFile } from '../../platform';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { csv, fmt, NumberBox, Plot, Readouts, Slider, useClock } from './_lab';
import { Segmented, usePersistentState } from './_shared';

type Tab = 'cam' | 'geneva' | 'gears';
type GearMode = 'compound' | 'planetary';

interface MState {
  readonly tab: Tab;
  readonly segments: readonly CamSegment[];
  readonly lift: number;
  readonly base: number;
  readonly roller: number;
  readonly offset: number;
  readonly follower: FollowerKind;
  readonly camRpm: number;
  readonly slots: number;
  readonly crank: number;
  readonly genevaRpm: number;
  readonly gearMode: GearMode;
  readonly train: string;
  readonly trainRpm: number;
  readonly trainTorque: number;
  readonly meshEfficiency: number;
  readonly sun: number;
  readonly ring: number;
  readonly planets: number;
  readonly fixed: Member;
  readonly input: Member;
  readonly planetRpm: number;
}

const PROGRAMS: Readonly<Record<string, readonly CamSegment[]>> = {
  'Rise, dwell, return, dwell': [
    { kind: 'rise', angle: 120, law: 'cycloidal' },
    { kind: 'dwell', angle: 60, law: 'cycloidal' },
    { kind: 'return', angle: 120, law: 'cycloidal' },
    { kind: 'dwell', angle: 60, law: 'cycloidal' },
  ],
  'Rise and return (no dwell)': [
    { kind: 'rise', angle: 180, law: 'shm' },
    { kind: 'return', angle: 180, law: 'shm' },
  ],
  'Quick rise, long dwell': [
    { kind: 'rise', angle: 90, law: 'poly345' },
    { kind: 'dwell', angle: 150, law: 'poly345' },
    { kind: 'return', angle: 90, law: 'poly345' },
    { kind: 'dwell', angle: 30, law: 'poly345' },
  ],
};

const DEFAULTS: MState = {
  tab: 'cam',
  segments: PROGRAMS['Rise, dwell, return, dwell'] ?? [],
  lift: 25,
  base: 40,
  roller: 10,
  offset: 0,
  follower: 'roller',
  camRpm: 300,
  slots: 6,
  crank: 50,
  genevaRpm: 60,
  gearMode: 'planetary',
  train: '20-40, 15-45',
  trainRpm: 1450,
  trainTorque: 20,
  meshEfficiency: 98,
  sun: 24,
  ring: 72,
  planets: 3,
  fixed: 'ring',
  input: 'sun',
  planetRpm: 60,
};

const LAWS = Object.keys(LAW_NAMES) as MotionLaw[];
const KINDS: readonly SegmentKind[] = ['rise', 'dwell', 'return'];
const MEMBERS: readonly Member[] = ['sun', 'ring', 'carrier'];

const read = (v: Values | undefined): MState => {
  const out: Record<string, unknown> = { ...DEFAULTS };
  for (const [key, value] of Object.entries(DEFAULTS)) {
    const stored = v?.[key];
    if (typeof value === 'number' && typeof stored === 'number' && Number.isFinite(stored)) out[key] = stored;
    if (typeof value === 'string' && typeof stored === 'string') out[key] = stored;
  }
  if (Array.isArray(v?.segments)) {
    const segments = (v.segments as unknown[])
      .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
      .map((x) => ({
        kind: KINDS.find((k) => k === x.kind) ?? 'dwell',
        angle: typeof x.angle === 'number' && x.angle > 0 ? x.angle : 30,
        law: LAWS.find((l) => l === x.law) ?? 'cycloidal',
      }));
    if (segments.length) out.segments = segments;
  }
  if (!['cam', 'geneva', 'gears'].includes(out.tab as string)) out.tab = 'cam';
  if (!['knife', 'roller', 'flat'].includes(out.follower as string)) out.follower = 'roller';
  if (!['compound', 'planetary'].includes(out.gearMode as string)) out.gearMode = 'planetary';
  if (!MEMBERS.includes(out.fixed as Member)) out.fixed = 'ring';
  if (!MEMBERS.includes(out.input as Member) || out.input === out.fixed) out.input = MEMBERS.find((m) => m !== out.fixed) ?? 'sun';
  return out as unknown as MState;
};
const write = (s: MState): Values => ({ ...s, segments: s.segments.map((x) => ({ ...x })) }) as unknown as Values;

const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

function dxf(points: readonly (readonly [number, number])[]): string {
  const lines = ['0', 'SECTION', '2', 'ENTITIES', '0', 'POLYLINE', '8', 'CAM', '66', '1', '70', '1'];
  for (const [x, y] of points) lines.push('0', 'VERTEX', '8', 'CAM', '10', x.toFixed(4), '20', y.toFixed(4));
  lines.push('0', 'SEQEND', '0', 'ENDSEC', '0', 'EOF');
  return `${lines.join('\n')}\n`;
}

/** A gear drawn with simple trapezoid teeth. */
function gearPath(cx: number, cy: number, teeth: number, module: number, angle: number, internal = false): string {
  const r = (teeth * module) / 2;
  const ra = internal ? r - module : r + module;
  const rf = internal ? r + 1.25 * module : r - 1.25 * module;
  const pts: string[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = angle + (2 * Math.PI * i) / teeth;
    const w = Math.PI / teeth;
    const corners: [number, number][] = [
      [rf, a - w * 0.55],
      [ra, a - w * 0.3],
      [ra, a + w * 0.3],
      [rf, a + w * 0.55],
    ];
    for (const [rr, aa] of corners) pts.push(`${(cx + rr * Math.cos(aa)).toFixed(2)} ${(cy + rr * Math.sin(aa)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

/* ------------------------------------------------------------- cam tab -- */

function CamTab({ s, set }: { s: MState; set: (patch: Partial<MState>) => void }) {
  const [running, setRunning] = useState(true);
  const [angle, setAngle] = useState(0);
  useClock(running, (dt) => setAngle((a) => (a + dt * 60) % 360));
  const design: CamDesign = { segments: s.segments, h: s.lift, base: s.base, roller: s.roller, offset: s.offset, follower: s.follower };
  const profile = useMemo(() => camProfile(design, 720), [s.segments, s.lift, s.base, s.roller, s.offset, s.follower]);
  const check = useMemo(() => checkCam(design, profile), [profile]);
  const problems = programProblems(s.segments);
  const omega = (s.camRpm * 2 * Math.PI) / 60;
  const samples = profile.filter((_, i) => i % 2 === 0);
  const now = followerAt(s.segments, s.lift, angle);
  const setSegment = (i: number, patch: Partial<CamSegment>) => set({ segments: s.segments.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const maxV = Math.max(...profile.map((p) => Math.abs(p.motion.v))) * omega;
  const maxA = Math.max(...profile.map((p) => Math.abs(p.motion.a))) * omega * omega;
  const maxJ = Math.max(...profile.map((p) => Math.abs(p.motion.j))) * omega ** 3;
  // The scene: cam turned to the current angle, follower above it.
  const view = s.base + s.lift + s.roller + 20;
  const t = rad(angle);
  const camPath = `M${profile.map((p) => `${(p.x * Math.cos(t) - p.y * Math.sin(t)).toFixed(2)} ${(-(p.x * Math.sin(t) + p.y * Math.cos(t))).toFixed(2)}`).join('L')}Z`;
  const rp = s.base + (s.follower === 'roller' ? s.roller : 0);
  const e = s.follower === 'flat' ? 0 : s.offset;
  const lift0 = Math.sqrt(Math.max(rp * rp - e * e, 0));
  const tip = lift0 + now.y;
  const save = (kind: 'csv' | 'svg' | 'dxf') =>
    attempt(async () => {
      const pts = profile.map((p) => [p.x, p.y] as const);
      let out: Awaited<ReturnType<typeof saveFile>>;
      if (kind === 'csv')
        out = await saveFile(
          'cam-profile.csv',
          csv(
            ['angle (deg)', 'x (mm)', 'y (mm)', 'lift (mm)', 'pressure angle (deg)'],
            profile.map((p) => [p.theta, p.x, p.y, p.motion.y, p.pressure]),
          ),
          'text/csv',
        );
      else if (kind === 'dxf') out = await saveFile('cam-profile.dxf', dxf(pts), 'application/dxf');
      else {
        const r = Math.max(...pts.map(([x, y]) => Math.hypot(x, y))) + 5;
        out = await saveFile(
          'cam-profile.svg',
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-r} ${-r} ${2 * r} ${2 * r}" width="${2 * r}mm" height="${2 * r}mm"><path d="M${pts.map(([x, y]) => `${x.toFixed(3)} ${(-y).toFixed(3)}`).join('L')}Z" fill="none" stroke="#000" stroke-width="0.2"/><circle r="1" fill="#000"/></svg>\n`,
          'image/svg+xml',
        );
      }
      if (out.saved) notify(`Saved to ${out.location}`);
    });
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <h3>Motion program</h3>
        <select
          class="input"
          aria-label="Start from a program"
          value=""
          onChange={(ev) => {
            const program = PROGRAMS[ev.currentTarget.value];
            if (program) set({ segments: program });
          }}
        >
          <option value="">Start from…</option>
          {Object.keys(PROGRAMS).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <table class="me-program" data-testid="me-program">
          <tbody>
            {s.segments.map((seg, i) => (
              <tr key={i}>
                <td>
                  <select class="input" aria-label={`Segment ${i + 1}`} value={seg.kind} onChange={(ev) => setSegment(i, { kind: ev.currentTarget.value as SegmentKind })}>
                    <option value="rise">Rise</option>
                    <option value="dwell">Dwell</option>
                    <option value="return">Return</option>
                  </select>
                </td>
                <td>
                  <NumberBox className="input me-angle" value={seg.angle} min={1} max={360} step={1} label={`Segment ${i + 1} angle in degrees`} onChange={(angle) => setSegment(i, { angle })} />°
                </td>
                <td>
                  {seg.kind !== 'dwell' && (
                    <select class="input" aria-label={`Segment ${i + 1} motion`} value={seg.law} onChange={(ev) => setSegment(i, { law: ev.currentTarget.value as MotionLaw })}>
                      {LAWS.map((l) => (
                        <option key={l} value={l}>
                          {LAW_NAMES[l]}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    class="icon-button"
                    aria-label={`Remove segment ${i + 1}`}
                    title="Remove"
                    disabled={s.segments.length < 2}
                    onClick={() => set({ segments: s.segments.filter((_, j) => j !== i) })}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" class="button button-small" onClick={() => set({ segments: [...s.segments, { kind: 'dwell', angle: 30, law: 'cycloidal' }] })}>
          + Segment
        </button>
        {problems.map((p) => (
          <p key={p} class="recipe-error">
            {p}
          </p>
        ))}
        <h3>Cam and follower</h3>
        <Segmented
          label="Follower"
          value={s.follower}
          choices={[
            { value: 'knife', label: 'Knife edge' },
            { value: 'roller', label: 'Roller' },
            { value: 'flat', label: 'Flat face' },
          ]}
          onChange={(follower) => set({ follower })}
        />
        <Slider label="Lift" value={s.lift} min={1} max={100} step={0.5} unit="mm" onChange={(lift) => set({ lift })} test="me-lift" />
        <Slider label="Base circle radius" value={s.base} min={5} max={150} step={0.5} unit="mm" onChange={(base) => set({ base })} test="me-base" />
        {s.follower === 'roller' && <Slider label="Roller radius" value={s.roller} min={1} max={50} step={0.5} unit="mm" onChange={(roller) => set({ roller })} />}
        {s.follower !== 'flat' && <Slider label="Offset" value={s.offset} min={-40} max={40} step={0.5} unit="mm" onChange={(offset) => set({ offset })} />}
        <Slider label="Cam speed" value={s.camRpm} min={10} max={3000} step={10} unit="rpm" onChange={(camRpm) => set({ camRpm })} />
        <div class="button-row">
          <button type="button" class="button button-small" onClick={() => setRunning((r) => !r)}>
            {running ? 'Stop' : 'Turn the cam'}
          </button>
          <button type="button" class="button button-small" onClick={() => void save('dxf')}>
            DXF
          </button>
          <button type="button" class="button button-small" onClick={() => void save('svg')}>
            SVG
          </button>
          <button type="button" class="button button-small" onClick={() => void save('csv')}>
            CSV
          </button>
        </div>
      </div>
      <div class="lab-stage">
        <Readouts
          test="me-cam-results"
          items={[
            ['Largest velocity', `${fmt(maxV / 1000, 4)} m/s`],
            ['Largest acceleration', `${fmt(maxA / 1000, 4)} m/s²`],
            ['Largest jerk', `${fmt(maxJ / 1000, 4)} m/s³`],
            ['Largest pressure angle', `${check.maxPressure.toFixed(1)}°${check.maxPressure > 30 && s.follower !== 'flat' ? ' (over 30°: enlarge the base circle)' : ''}`],
            ['Smallest radius of curvature', `${fmt(check.minCurvature, 4)} mm`],
            ...(s.follower === 'flat' ? ([['Face width needed', `${fmt(check.faceWidth, 4)} mm`]] as const) : []),
          ]}
        />
        {check.undercut && (
          <p class="recipe-error" role="alert" data-testid="me-undercut">
            The cam is undercut: {s.follower === 'roller' ? 'the roller is bigger than the sharpest part of the pitch curve' : 'the profile folds over itself'}. Enlarge the base circle
            {s.follower === 'roller' ? ' or use a smaller roller' : ''}.
          </p>
        )}
        <div class="me-scene-row">
          <svg
            class="lab-scene me-cam-scene"
            viewBox={`${-view} ${-view - s.lift - s.roller - 40} ${2 * view} ${2 * view + s.lift + s.roller + 40}`}
            role="img"
            aria-label="Cam and follower"
            data-testid="me-cam-scene"
          >
            <circle class="me-base" r={s.base} />
            <path class="me-cam" d={camPath} />
            <circle class="me-hub" r={4} />
            {s.follower === 'roller' && <circle class="me-roller" cx={e} cy={-tip} r={s.roller} />}
            {s.follower === 'flat' && <line class="me-face" x1={-check.faceWidth / 2 - 10} x2={check.faceWidth / 2 + 10} y1={-(s.base + now.y)} y2={-(s.base + now.y)} />}
            {s.follower === 'knife' && <path class="me-follower" d={`M${e} ${-tip}l-5 -12h10z`} />}
            <line class="me-stem" x1={e} x2={e} y1={-(s.follower === 'flat' ? s.base + now.y : tip + (s.follower === 'roller' ? 0 : 12))} y2={-view - s.lift - s.roller - 30} />
          </svg>
        </div>
        <div class="lab-plots">
          <Plot title="Lift" xLabel="cam angle (°)" yLabel="mm" series={[{ name: 'Lift', points: samples.map((p) => [p.theta, p.motion.y]) }]} marker={angle} test="me-lift-plot" />
          <Plot title="Velocity" xLabel="cam angle (°)" yLabel="m/s" series={[{ name: 'Velocity', points: samples.map((p) => [p.theta, (p.motion.v * omega) / 1000]) }]} marker={angle} />
          <Plot
            title="Acceleration"
            xLabel="cam angle (°)"
            yLabel="m/s²"
            series={[{ name: 'Acceleration', points: samples.map((p) => [p.theta, (p.motion.a * omega * omega) / 1000]) }]}
            marker={angle}
          />
          {s.follower !== 'flat' && (
            <Plot title="Pressure angle" xLabel="cam angle (°)" yLabel="degrees" series={[{ name: 'Pressure angle', points: samples.map((p) => [p.theta, p.pressure]) }]} marker={angle} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- Geneva tab -- */

function GenevaTab({ s, set }: { s: MState; set: (patch: Partial<MState>) => void }) {
  const [running, setRunning] = useState(true);
  const [alpha, setAlpha] = useState(-Math.PI);
  useClock(running, (dt) => setAlpha((a) => a + dt * 1.2));
  const g = geneva(s.slots, s.crank);
  const turn = Math.floor((alpha + Math.PI) / (2 * Math.PI));
  const local = alpha - turn * 2 * Math.PI;
  const at = genevaAt(g, local);
  // Each full turn of the crank indexes the wheel one slot.
  const wheelAngle = -(turn * 2 * Math.PI) / s.slots - at.beta;
  const omega = (s.genevaRpm * 2 * Math.PI) / 60;
  const curve = Array.from({ length: 361 }, (_, i) => {
    const a = rad(i - 180);
    return { a: i - 180, m: genevaAt(g, a) };
  });
  const maxRatio = g.crank / (g.centres - g.crank);
  const maxAcc = Math.max(...curve.map((c) => Math.abs(c.m.acceleration))) * omega * omega;
  const pinR = Math.max(3, s.crank * 0.12);
  const C = g.centres;
  const view = C + g.wheel + 20;
  const crankX = -C / 2;
  const wheelX = C / 2;
  const pin = { x: crankX + s.crank * Math.cos(local), y: -s.crank * Math.sin(local) };
  const slots = Array.from({ length: s.slots }, (_, i) => wheelAngle + (2 * Math.PI * i) / s.slots + Math.PI);
  const indexTime = (60 / s.genevaRpm) * g.indexing;
  return (
    <div class="lab-layout">
      <div class="lab-controls">
        <Slider label="Slots" value={s.slots} min={3} max={12} step={1} onChange={(slots) => set({ slots: Math.round(slots) })} test="me-slots" />
        <Slider label="Crank radius" value={s.crank} min={10} max={200} step={1} unit="mm" onChange={(crank) => set({ crank })} />
        <Slider label="Crank speed" value={s.genevaRpm} min={5} max={600} step={5} unit="rpm" onChange={(genevaRpm) => set({ genevaRpm })} />
        <button type="button" class="button button-small" onClick={() => setRunning((r) => !r)}>
          {running ? 'Stop' : 'Run'}
        </button>
      </div>
      <div class="lab-stage">
        <Readouts
          test="me-geneva-results"
          items={[
            ['Centre distance', `${fmt(g.centres, 4)} mm`],
            ['Wheel radius', `${fmt(g.wheel, 4)} mm`],
            ['Crank angle moving the wheel', `${(g.indexing * 360).toFixed(1)}°`],
            ['Crank angle in dwell', `${((1 - g.indexing) * 360).toFixed(1)}°`],
            ['Index time', `${fmt(indexTime, 3)} s`],
            ['Largest speed ratio', `${fmt(maxRatio, 4)} × crank`],
            ['Largest angular acceleration', `${fmt(maxAcc, 4)} rad/s²`],
          ]}
        />
        <svg class="lab-scene me-geneva-scene" viewBox={`${-view} ${-view * 0.7} ${2 * view} ${view * 1.4}`} role="img" aria-label="Geneva drive" data-testid="me-geneva-scene">
          <g transform={`translate(${wheelX} 0)`}>
            <circle class="me-wheel" r={g.wheel + pinR} />
            {slots.map((a) => (
              <line
                key={a}
                class="me-slot"
                x1={(g.wheel + pinR) * Math.cos(a)}
                y1={-(g.wheel + pinR) * Math.sin(a)}
                x2={(C - s.crank - pinR) * Math.cos(a)}
                y2={-(C - s.crank - pinR) * Math.sin(a)}
                stroke-width={pinR * 2.2}
              />
            ))}
            <circle class="me-hub" r={5} />
          </g>
          <g transform={`translate(${crankX} 0)`}>
            <circle class="me-lock" r={s.crank * 0.6} />
            <line class="me-crank" x1={0} y1={0} x2={s.crank * Math.cos(local)} y2={-s.crank * Math.sin(local)} />
            <circle class="me-hub" r={5} />
          </g>
          <circle class="me-pin" cx={pin.x} cy={pin.y} r={pinR} />
        </svg>
        <div class="lab-plots">
          <Plot
            title="Wheel angle"
            xLabel="crank angle (°)"
            yLabel="degrees"
            series={[{ name: 'Wheel angle', points: curve.map((c) => [c.a, deg(c.m.beta)]) }]}
            marker={deg(Math.atan2(Math.sin(local), Math.cos(local)))}
          />
          <Plot
            title="Wheel speed ÷ crank speed"
            xLabel="crank angle (°)"
            yLabel="ratio"
            series={[{ name: 'Speed ratio', points: curve.map((c) => [c.a, c.m.velocity]) }]}
            marker={deg(Math.atan2(Math.sin(local), Math.cos(local)))}
          />
          <Plot
            title="Wheel acceleration"
            xLabel="crank angle (°)"
            yLabel="rad/s²"
            series={[{ name: 'Acceleration', points: curve.map((c) => [c.a, c.m.acceleration * omega * omega]) }]}
            marker={deg(Math.atan2(Math.sin(local), Math.cos(local)))}
          />
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- gears tab -- */

const MEMBER_NAME: Readonly<Record<Member, string>> = { sun: 'Sun', ring: 'Ring', carrier: 'Carrier' };

function GearsTab({ s, set }: { s: MState; set: (patch: Partial<MState>) => void }) {
  const [running, setRunning] = useState(true);
  const [time, setTime] = useState(0);
  useClock(running, (dt) => setTime((t) => t + dt));
  let body: JSX.Element;
  if (s.gearMode === 'compound') {
    let error = '';
    let result = { ratio: 1, reverses: false };
    let meshes: ReturnType<typeof parseTrain> = [];
    try {
      meshes = parseTrain(s.train);
      result = trainRatio(meshes);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const eff = (s.meshEfficiency / 100) ** meshes.length;
    const out = s.trainRpm / result.ratio;
    // Lay the shafts out left to right; gears on a shaft drawn one behind the other.
    const m = 2;
    let x = 0;
    const drawn: { x: number; teeth: number; speed: number; internal: boolean }[] = [];
    let speed = s.trainRpm;
    meshes.forEach((mesh, i) => {
      const r1 = (mesh.driver * m) / 2;
      const r2 = (mesh.driven * m) / 2;
      if (i === 0) x = r1;
      drawn.push({ x, teeth: mesh.driver, speed, internal: false });
      const next = mesh.internal ? x + r2 - r1 : x + r1 + r2;
      speed = (mesh.internal ? 1 : -1) * speed * (mesh.driver / mesh.driven);
      drawn.push({ x: next, teeth: mesh.driven, speed, internal: Boolean(mesh.internal) });
      x = next;
    });
    const width = Math.max(100, x + Math.max(...drawn.map((d) => (d.teeth * m) / 2), 10) + 10);
    const tall = Math.max(60, ...drawn.map((d) => d.teeth * m + 10));
    body = (
      <>
        <label class="me-train">
          Gear pairs (driver-driven; a driven gear shares its shaft with the next driver; add i for an internal gear)
          <input class="input" value={s.train} onInput={(ev) => set({ train: ev.currentTarget.value })} data-testid="me-train" />
        </label>
        <Slider label="Input speed" value={s.trainRpm} min={1} max={10000} step={1} unit="rpm" onChange={(trainRpm) => set({ trainRpm })} />
        <Slider label="Input torque" value={s.trainTorque} min={0.1} max={5000} step={0.1} unit="N·m" onChange={(trainTorque) => set({ trainTorque })} />
        <Slider label="Efficiency per mesh" value={s.meshEfficiency} min={80} max={100} step={0.5} unit="%" onChange={(meshEfficiency) => set({ meshEfficiency })} />
        {error ? (
          <p class="recipe-error">{error}</p>
        ) : (
          <Readouts
            test="me-train-results"
            items={[
              ['Overall ratio', `${fmt(result.ratio, 5)} : 1`],
              ['Output speed', `${fmt(Math.abs(out), 5)} rpm`],
              ['Direction', result.reverses ? 'reversed' : 'same as the input'],
              ['Output torque', `${fmt(s.trainTorque * result.ratio * eff, 5)} N·m`],
              ['Overall efficiency', `${(eff * 100).toFixed(1)} %`],
            ]}
          />
        )}
        <svg class="lab-scene" viewBox={`-10 ${-tall / 2} ${width + 10} ${tall}`} role="img" aria-label="Gear train">
          {drawn.map((d, i) => (
            <path key={i} class={i % 2 ? 'me-gear me-gear-2' : 'me-gear'} d={gearPath(d.x, 0, d.teeth, m, (d.speed / 60) * 2 * Math.PI * time * 0.05, d.internal)} fill-rule="evenodd" />
          ))}
        </svg>
      </>
    );
  } else {
    const planet = (s.ring - s.sun) / 2;
    const set3 = { sun: s.sun, ring: s.ring, planet, planets: s.planets };
    const problems =
      Number.isInteger(planet) && planet >= 6 ? planetaryProblems(set3) : ['The ring needs an even number of teeth more than the sun, so the planets have whole teeth (and at least 6).'];
    const speeds = planetarySpeeds(set3, s.fixed, s.input, s.planetRpm);
    const output = MEMBERS.find((m) => m !== s.fixed && m !== s.input) ?? 'carrier';
    const ratio = s.planetRpm / speeds[output];
    const m = 2;
    const turn = (rpm: number) => (rpm / 60) * 2 * Math.PI * time * 0.15;
    const carrierR = ((s.sun + planet) * m) / 2;
    const R = (s.ring * m) / 2 + 2 * m + 4;
    body = (
      <>
        <Slider label="Sun teeth" value={s.sun} min={8} max={120} step={1} onChange={(sun) => set({ sun: Math.round(sun) })} test="me-sun" />
        <Slider label="Ring teeth" value={s.ring} min={30} max={240} step={1} onChange={(ring) => set({ ring: Math.round(ring) })} test="me-ring" />
        <Slider label="Planets" value={s.planets} min={2} max={8} step={1} onChange={(planets) => set({ planets: Math.round(planets) })} />
        <div class="me-members">
          <label>
            Held still
            <select
              class="input"
              value={s.fixed}
              onChange={(ev) => set({ fixed: ev.currentTarget.value as Member, input: s.input === ev.currentTarget.value ? (MEMBERS.find((x) => x !== ev.currentTarget.value) ?? 'sun') : s.input })}
              data-testid="me-fixed"
            >
              {MEMBERS.map((x) => (
                <option key={x} value={x}>
                  {MEMBER_NAME[x]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Driven by the input
            <select class="input" value={s.input} onChange={(ev) => set({ input: ev.currentTarget.value as Member })} data-testid="me-input">
              {MEMBERS.filter((x) => x !== s.fixed).map((x) => (
                <option key={x} value={x}>
                  {MEMBER_NAME[x]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Slider label="Input speed" value={s.planetRpm} min={1} max={6000} step={1} unit="rpm" onChange={(planetRpm) => set({ planetRpm })} />
        {problems.map((p) => (
          <p key={p} class="recipe-error">
            {p}
          </p>
        ))}
        <Readouts
          test="me-planet-results"
          items={[
            ['Planet teeth', Number.isInteger(planet) ? String(planet) : '—'],
            [`Ratio (input ÷ ${MEMBER_NAME[output].toLowerCase()})`, `${fmt(ratio, 5)} : 1`],
            ['Sun', `${fmt(speeds.sun, 5)} rpm`],
            ['Ring', `${fmt(speeds.ring, 5)} rpm`],
            ['Carrier', `${fmt(speeds.carrier, 5)} rpm`],
            ['Each planet (about its own axis)', `${fmt(speeds.planet - speeds.carrier, 5)} rpm`],
          ]}
        />
        {Number.isInteger(planet) && planet >= 6 && (
          <svg class="lab-scene me-planet-scene" viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`} role="img" aria-label="Planetary gear set" data-testid="me-planet-scene">
            <path
              class="me-gear me-ring"
              d={`${gearPath(0, 0, s.ring, m, turn(speeds.ring), true)}M${R - 2} 0A${R - 2} ${R - 2} 0 1 0 ${-(R - 2)} 0A${R - 2} ${R - 2} 0 1 0 ${R - 2} 0Z`}
              fill-rule="evenodd"
            />
            <path class="me-gear" d={gearPath(0, 0, s.sun, m, turn(speeds.sun))} />
            {Array.from({ length: s.planets }, (_, i) => {
              const a = turn(speeds.carrier) + (2 * Math.PI * i) / s.planets;
              const cx = carrierR * Math.cos(a);
              const cy = carrierR * Math.sin(a);
              return <path key={i} class="me-gear me-gear-2" d={gearPath(cx, cy, planet, m, turn(speeds.planet))} />;
            })}
            <g class="me-carrier">
              {Array.from({ length: s.planets }, (_, i) => {
                const a = turn(speeds.carrier) + (2 * Math.PI * i) / s.planets;
                return <line key={i} x1={0} y1={0} x2={carrierR * Math.cos(a)} y2={carrierR * Math.sin(a)} />;
              })}
            </g>
            <circle class="me-hub" r={3} />
          </svg>
        )}
      </>
    );
  }
  return (
    <div class="lab-stage me-gears">
      <div class="button-row">
        <Segmented
          label="Gear train"
          value={s.gearMode}
          choices={[
            { value: 'planetary', label: 'Planetary (epicyclic)' },
            { value: 'compound', label: 'Simple and compound' },
          ]}
          onChange={(gearMode) => set({ gearMode })}
        />
        <button type="button" class="button button-small" onClick={() => setRunning((r) => !r)}>
          {running ? 'Stop' : 'Run'}
        </button>
      </div>
      {body}
    </div>
  );
}

function MachineElements({ toolId }: { toolId: string }) {
  const [s, setState] = usePersistentState(toolId, read, write);
  const set = (patch: Partial<MState>) => setState((p) => ({ ...p, ...patch }));
  return (
    <section class="tool lab-tool" data-testid="tool" data-state="done">
      <Segmented
        label="Mechanism"
        value={s.tab}
        small={false}
        choices={[
          { value: 'cam', label: 'Cam and follower' },
          { value: 'geneva', label: 'Geneva drive' },
          { value: 'gears', label: 'Gear trains' },
        ]}
        onChange={(tab) => set({ tab })}
      />
      {s.tab === 'cam' && <CamTab s={s} set={set} />}
      {s.tab === 'geneva' && <GenevaTab s={s} set={set} />}
      {s.tab === 'gears' && <GearsTab s={s} set={set} />}
    </section>
  );
}

export default defineCustomTool(MachineElements);
