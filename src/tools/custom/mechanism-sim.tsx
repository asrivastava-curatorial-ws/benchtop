/**
 * Mechanism simulator: draw a planar linkage (ground pivots, pin joints,
 * bars, cranks and sliders) or start from a classic one, run it, trace
 * coupler curves and plot the position, velocity and acceleration of any
 * joint.  Four-bars are named by Grashof's rule, with their transmission
 * angle; any output gets its stroke and quick-return time ratio.
 */
import type { TargetedKeyboardEvent, TargetedPointerEvent, TargetedWheelEvent } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
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
  type Mechanism,
  moveJoint,
  type Pose,
  plates,
  readMechanism,
  removeJoint,
  removeLink,
  removeSlider,
  setCrank,
  setGround,
  setLinkLength,
  strokeOf,
  sweep,
  TEMPLATES,
  toggleTrace,
  transmissionAngle,
} from '../../lib/linkage';
import { pickFiles, saveFile } from '../../platform';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { csv, fmt, LAB_COLORS, NumberBox, Plot, Readouts, useClock } from './_lab';
import { Segmented, usePersistentState } from './_shared';

const FRAMES = 360;
const GRID = 10;
const CUSTOM = 'Your drawing';
const EMPTY_NAME = 'Empty drawing';
const FIRST = 'Four-bar (crank and rocker)';

type Mode = 'move' | 'ground' | 'joint' | 'link' | 'crank' | 'slider' | 'trace' | 'erase';
type Playback = '1' | '0.5' | '0.25' | '0.1';
type Pick = { readonly kind: 'joint' | 'link'; readonly id: string } | null;
type View = readonly [number, number, number, number];
type Pt = readonly [number, number];

interface SimState {
  readonly mech: Mechanism;
  readonly template: string;
  readonly probe: string;
  readonly snap: boolean;
  readonly playback: Playback;
}

const MODES: readonly { readonly mode: Mode; readonly key: string; readonly label: string; readonly hint: readonly string[] }[] = [
  { mode: 'move', key: 'V', label: 'Select', hint: ['Drag a joint to change the drawing, or click a joint or bar to edit it. Drag the paper to pan; scroll to zoom.'] },
  { mode: 'ground', key: 'G', label: 'Ground pivot', hint: ['Click to add a fixed pivot, or click a joint to fix it to the ground or free it.'] },
  { mode: 'joint', key: 'J', label: 'Joint', hint: ['Click to add a pin joint. Click on a bar to add a point fixed to that bar.'] },
  { mode: 'link', key: 'L', label: 'Bar', hint: ['Click a joint (or empty paper) to start a bar.', 'Click the other end. Bars chain on from there; Esc stops.'] },
  { mode: 'crank', key: 'K', label: 'Crank', hint: ['Click the crank’s ground pivot.', 'Click the crank pin. The crank drives the mechanism.'] },
  {
    mode: 'slider',
    key: 'S',
    label: 'Slider',
    hint: ['Click the joint that slides.', 'Click the first point of its line (empty paper makes a fixed rail).', 'Click the second point of the line.'],
  },
  { mode: 'trace', key: 'T', label: 'Trace', hint: ['Click a joint to draw its path, or to stop drawing it.'] },
  { mode: 'erase', key: 'X', label: 'Delete', hint: ['Click a joint, bar or rail to remove it.'] },
];

const PLAYBACK: readonly { readonly value: Playback; readonly label: string }[] = [
  { value: '1', label: '1×' },
  { value: '0.5', label: '½×' },
  { value: '0.25', label: '¼×' },
  { value: '0.1', label: '⅒×' },
];

const make = (name: string): Mechanism => (name === EMPTY_NAME ? EMPTY : (TEMPLATES[name] ?? TEMPLATES[FIRST] ?? (() => EMPTY))());
const firstProbe = (m: Mechanism) => m.traces[0] ?? m.joints.filter((j) => !j.ground).at(-1)?.id ?? '';

const read = (v: Values | undefined): SimState => {
  const mech = v?.mech === undefined ? make(FIRST) : (readMechanism(v.mech) ?? make(FIRST));
  const template = typeof v?.template === 'string' && (v.template === CUSTOM || v.template === EMPTY_NAME || v.template in TEMPLATES) ? v.template : FIRST;
  const probe = typeof v?.probe === 'string' && mech.joints.some((j) => j.id === v.probe) ? v.probe : firstProbe(mech);
  const snap = typeof v?.snap === 'boolean' ? v.snap : true;
  const playback = PLAYBACK.find((p) => p.value === v?.playback)?.value ?? '1';
  return { mech, template, probe, snap, playback };
};
const write = (s: SimState): Values => JSON.parse(JSON.stringify(s)) as Values;

/* ------------------------------------------------------------- helpers -- */

/** A pose between two frames. */
function poseAt(poses: readonly Pose[], phase: number): Pose | null {
  if (!poses.length) return null;
  const i = Math.max(0, Math.min(poses.length - 1, Math.floor(phase)));
  const a = poses[i];
  const b = poses[Math.min(poses.length - 1, i + 1)];
  const f = phase - i;
  if (!a || !b || f <= 0) return a ?? null;
  const out: Record<string, readonly [number, number]> = {};
  for (const [id, p] of Object.entries(a)) {
    const q = b[id] ?? p;
    out[id] = [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
  }
  return out;
}

/** A frame that shows every position the mechanism takes, a little wider than tall. */
function fitView(m: Mechanism, poses: readonly Pose[]): View {
  const pts: Pt[] = m.joints.map((j) => [j.x, j.y]);
  for (const p of poses) for (const q of Object.values(p)) pts.push(q);
  if (!pts.length) return [0, 0, 640, 400];
  let x0 = Math.min(...pts.map((p) => p[0]));
  let x1 = Math.max(...pts.map((p) => p[0]));
  let y0 = Math.min(...pts.map((p) => p[1]));
  let y1 = Math.max(...pts.map((p) => p[1]));
  const pad = Math.max(40, 0.1 * Math.max(x1 - x0, y1 - y0));
  x0 -= pad;
  x1 += pad;
  y0 -= pad;
  y1 += pad;
  let w = x1 - x0;
  let h = y1 - y0;
  if (w < 360) {
    x0 -= (360 - w) / 2;
    w = 360;
  }
  if (h < w * 0.5) {
    y0 -= (w * 0.5 - h) / 2;
    h = w * 0.5;
  }
  if (h > w * 0.8) {
    x0 -= (h / 0.8 - w) / 2;
    w = h / 0.8;
  }
  return [x0, y0, w, h];
}

function segmentDistance(p: Pt, a: Pt, b: Pt): { d: number; t: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy || 1e-12;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return { d: Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy)), t };
}

/** The angle of `tip` about `pivot`, anticlockwise from the right, degrees 0–360 (screen y points down). */
const angleOf = (pivot: Pt, tip: Pt) => ((((Math.atan2(pivot[1] - tip[1], tip[0] - pivot[0]) * 180) / Math.PI) % 360) + 360) % 360;

/** Unwraps angles in degrees so a full turn reads 0…360 rather than jumping back. */
function unwrap(values: readonly number[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    const prev = out.at(-1);
    if (prev === undefined) out.push(v);
    else out.push(prev + ((((v - prev + 180) % 360) + 360) % 360) - 180);
  }
  return out;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const fileSafe = (name: string) =>
  name
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 60) || 'mechanism';

/** A drawing of the mechanism at one pose, with its traces, for saving as SVG. */
function svgDrawing(m: Mechanism, pose: Pose, poses: readonly Pose[], view: View, closed: boolean): string {
  const u = view[2] / 640;
  const pt = (id: string) => pose[id];
  const parts: string[] = [];
  const colours = ['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#e69f00', '#56b4e9'];
  m.traces.forEach((id, i) => {
    const pts = poses.map((p) => p[id]).filter((p): p is readonly [number, number] => !!p);
    if (pts.length > 1)
      parts.push(
        `<path d="M${pts.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('L')}${closed ? 'Z' : ''}" fill="none" stroke="${colours[i % colours.length]}" stroke-width="${(1.5 * u).toFixed(2)}"/>`,
      );
  });
  for (const s of m.sliders) {
    const a = pt(s.a);
    const b = pt(s.b);
    const ja = m.joints.find((j) => j.id === s.a);
    const jb = m.joints.find((j) => j.id === s.b);
    if (a && b && ja?.ground && jb?.ground) parts.push(`<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#55626d" stroke-width="${(2 * u).toFixed(2)}"/>`);
  }
  for (const l of m.links) {
    const a = pt(l.a);
    const b = pt(l.b);
    const crank = m.cranks.some((c) => (c.pivot === l.a && c.tip === l.b) || (c.pivot === l.b && c.tip === l.a));
    if (a && b)
      parts.push(
        `<line x1="${a[0].toFixed(2)}" y1="${a[1].toFixed(2)}" x2="${b[0].toFixed(2)}" y2="${b[1].toFixed(2)}" stroke="${crank ? '#17694e' : '#19222a'}" stroke-width="${(6 * u).toFixed(2)}" stroke-linecap="round" opacity="0.85"/>`,
      );
  }
  for (const j of m.joints) {
    const p = pt(j.id);
    if (!p) continue;
    if (j.ground) parts.push(`<path d="M${p[0]} ${p[1]}l${-9 * u} ${14 * u}h${18 * u}Z" fill="#b4bec6" stroke="#19222a" stroke-width="${u.toFixed(2)}"/>`);
    parts.push(`<circle cx="${p[0].toFixed(2)}" cy="${p[1].toFixed(2)}" r="${(4.5 * u).toFixed(2)}" fill="#ffffff" stroke="#19222a" stroke-width="${(1.5 * u).toFixed(2)}"/>`);
    parts.push(`<text x="${(p[0] + 8 * u).toFixed(2)}" y="${(p[1] - 8 * u).toFixed(2)}" font-family="sans-serif" font-size="${(11 * u).toFixed(2)}" fill="#19222a">${j.id}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view.map((v) => v.toFixed(2)).join(' ')}" width="${Math.round(view[2])}" height="${Math.round(view[3])}"><rect x="${view[0]}" y="${view[1]}" width="${view[2]}" height="${view[3]}" fill="#ffffff"/>${parts.join('')}</svg>\n`;
}

/* ----------------------------------------------------------- component -- */

function MechanismSim({ toolId }: { toolId: string }) {
  const [s, setState] = usePersistentState(toolId, read, write);
  const set = (patch: Partial<SimState>) => setState((p) => ({ ...p, ...patch }));
  const [mode, setModeRaw] = useState<Mode>('move');
  const [pending, setPending] = useState<readonly string[]>([]);
  const [pick, setPick] = useState<Pick>(null);
  const [draft, setDraft] = useState<Mechanism | null>(null);
  const [running, setRunning] = useState(true);
  const [phase, setPhase] = useState(0);
  const [hover, setHover] = useState<Pt | null>(null);
  const [refit, setRefit] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: 'joint'; id: string } | { kind: 'pan'; from: Pt; view: View } | null>(null);
  const bounce = useRef(1);

  const mech = s.mech;
  const run = useMemo(() => sweep(mech, FRAMES, 4), [mech]);
  const [view, setView] = useState<View>(() => fitView(mech, run.poses));
  useEffect(() => {
    if (!refit) return;
    setView(fitView(mech, run.poses));
    setRefit(false);
  }, [refit, run, mech]);

  const crank = mech.cranks[0];
  const rpm = crank?.rpm ?? 0;
  const lastFrame = Math.max(0, run.poses.length - 1);
  const locked = run.lockedAt !== null;
  const cyclic = !locked && lastFrame === FRAMES;
  const shownPhase = Math.min(phase, lastFrame);
  const atDrawing = !draft && shownPhase === 0 && !running;

  useClock(running && lastFrame > 0 && rpm !== 0 && !draft, (dt) => {
    const step = ((Math.abs(rpm) * 6 * Number(s.playback) * dt * FRAMES) / 360) * Math.sign(rpm);
    setPhase((p) => {
      if (cyclic) return (((p + step) % lastFrame) + lastFrame) % lastFrame;
      // A linkage that locks goes back and forth over the range it can reach.
      let next = Math.min(p, lastFrame) + step * bounce.current;
      if (next > lastFrame) {
        next = 2 * lastFrame - next;
        bounce.current = -bounce.current;
      }
      if (next < 0) {
        next = -next;
        bounce.current = -bounce.current;
      }
      return Math.max(0, Math.min(lastFrame, next));
    });
  });

  const shown: Pose = draft ? designPose(draft) : (poseAt(run.poses, shownPhase) ?? designPose(mech));
  const drawn = draft ?? mech;
  const origin: Pt = (() => {
    const id = mech.cranks[0]?.pivot ?? mech.joints.find((j) => j.ground)?.id;
    const j = mech.joints.find((x) => x.id === id);
    return j ? [j.x, j.y] : [0, 0];
  })();

  /* ---------------------------------------------------------- analysis -- */

  const omega = (Math.abs(rpm) * 2 * Math.PI) / 60;
  const dt = omega > 0 ? (2 * Math.PI) / FRAMES / omega : 1;
  const probe = mech.joints.some((j) => j.id === s.probe) ? s.probe : firstProbe(mech);
  const analysis = useMemo(() => {
    const X = run.poses.map((p) => (p[probe]?.[0] ?? Number.NaN) - origin[0]);
    const Y = run.poses.map((p) => origin[1] - (p[probe]?.[1] ?? Number.NaN));
    const sign = Math.sign(rpm) || 1;
    const vx = derivative(X, dt, cyclic).map((v) => (sign * v) / 1000);
    const vy = derivative(Y, dt, cyclic).map((v) => (sign * v) / 1000);
    const ax = derivative(vx, dt, cyclic).map((v) => sign * v);
    const ay = derivative(vy, dt, cyclic).map((v) => sign * v);
    const pts = run.poses.map((p) => p[probe]).filter((p): p is readonly [number, number] => !!p);
    const stroke = pts.length === run.poses.length ? strokeOf(pts, run.angles) : null;
    return { X, Y, vx, vy, ax, ay, stroke };
  }, [run, probe, rpm, origin[0], origin[1]]);
  const bar = useMemo(() => fourBar(mech), [mech]);
  const barMotion = useMemo(() => {
    if (!bar) return null;
    const mu = run.poses.map((p) => transmissionAngle(bar, p)).filter(Number.isFinite);
    const out = unwrap(run.poses.map((p) => angleOf(p[bar.o4] ?? [0, 0], p[bar.b] ?? [0, 0])));
    return { mu, out };
  }, [bar, run]);
  const dof = freedom(mech);
  const frame = Math.round(shownPhase);
  const at = <T,>(values: readonly T[]) => values[Math.min(frame, values.length - 1)];
  const angles = run.angles;

  /* ----------------------------------------------------------- editing -- */

  const setMode = (m: Mode) => {
    setModeRaw(m);
    setPending([]);
  };
  const toDrawing = () => {
    setRunning(false);
    setPhase(0);
    bounce.current = 1;
  };
  const edit = (m: Mechanism) => {
    const probeOk = m.joints.some((j) => j.id === s.probe);
    set({ mech: m, template: CUSTOM, ...(probeOk ? {} : { probe: firstProbe(m) }) });
    toDrawing();
    if (pick && !(pick.kind === 'joint' ? m.joints : m.links).some((x) => x.id === pick.id)) setPick(null);
  };
  const loadTemplate = (name: string) => {
    const m = make(name);
    set({ mech: m, template: name, probe: firstProbe(m) });
    setPick(null);
    setPending([]);
    setPhase(0);
    bounce.current = 1;
    setRunning(name !== EMPTY_NAME);
    setRefit(true);
    if (name === EMPTY_NAME) setMode('ground');
  };

  const world = (e: { clientX: number; clientY: number }): Pt => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return [p.x, p.y];
  };
  const pixel = () => 1 / (svgRef.current?.getScreenCTM()?.a || 1);
  const snapped = (p: Pt): Pt => (s.snap ? [Math.round(p[0] / GRID) * GRID, Math.round(p[1] / GRID) * GRID] : p);

  const hitJoint = (p: Pt): string | null => {
    let best: string | null = null;
    let bestD = 11 * pixel();
    for (const j of drawn.joints) {
      const q = shown[j.id];
      if (!q) continue;
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d <= bestD) {
        best = j.id;
        bestD = d;
      }
    }
    return best;
  };
  const hitLink = (p: Pt): { id: string; t: number } | null => {
    let best: { id: string; t: number } | null = null;
    let bestD = 8 * pixel();
    for (const l of drawn.links) {
      const a = shown[l.a];
      const b = shown[l.b];
      if (!a || !b) continue;
      const { d, t } = segmentDistance(p, a, b);
      if (d <= bestD) {
        best = { id: l.id, t };
        bestD = d;
      }
    }
    return best;
  };
  const hitRail = (p: Pt): string | null => {
    for (const sl of drawn.sliders) {
      const ja = drawn.joints.find((j) => j.id === sl.a);
      const jb = drawn.joints.find((j) => j.id === sl.b);
      const a = shown[sl.a];
      const b = shown[sl.b];
      if (ja?.ground && jb?.ground && a && b && segmentDistance(p, a, b).d <= 7 * pixel()) return sl.id;
    }
    return null;
  };

  /** The joint clicked, or a new one there (ground or not). */
  const jointAt = (m: Mechanism, p: Pt, ground: boolean): [Mechanism, string] => {
    const hit = hitJoint(p);
    if (hit) return [m, hit];
    const q = snapped(p);
    return addJoint(m, q[0], q[1], ground);
  };

  const click = (p: Pt) => {
    let m = mech;
    if (mode === 'ground') {
      const hit = hitJoint(p);
      if (hit) {
        const j = m.joints.find((x) => x.id === hit);
        edit(setGround(m, hit, !j?.ground));
      } else {
        const q = snapped(p);
        edit(addJoint(m, q[0], q[1], true)[0]);
      }
      return;
    }
    if (mode === 'joint') {
      if (hitJoint(p)) return;
      const onBar = hitLink(p);
      const l = onBar && m.links.find((x) => x.id === onBar.id);
      const a = l && shown[l.a];
      const b = l && shown[l.b];
      if (l && a && b) {
        // A point fixed on the bar: a set distance from one end, on the line through both.
        const q: Pt = [a[0] + (b[0] - a[0]) * onBar.t, a[1] + (b[1] - a[1]) * onBar.t];
        const [m1, id] = addJoint(m, q[0], q[1], false);
        edit(addSlider(addLink(m1, l.a, id), id, l.a, l.b));
        return;
      }
      const q = snapped(p);
      edit(addJoint(m, q[0], q[1], false)[0]);
      return;
    }
    if (mode === 'trace') {
      const hit = hitJoint(p);
      if (!hit) return;
      edit(toggleTrace(m, hit));
      if (!m.traces.includes(hit)) set({ probe: hit });
      return;
    }
    if (mode === 'erase') {
      const hit = hitJoint(p);
      const l = hit ? null : hitLink(p);
      const rail = hit || l ? null : hitRail(p);
      if (hit) edit(removeJoint(m, hit));
      else if (l) edit(removeLink(m, l.id));
      else if (rail) {
        const sl = m.sliders.find((x) => x.id === rail);
        m = removeSlider(m, rail);
        // Rail ends used by nothing else go too.
        for (const end of [sl?.a, sl?.b]) {
          if (!end) continue;
          const used = m.links.some((x) => x.a === end || x.b === end) || m.sliders.some((x) => x.joint === end || x.a === end || x.b === end) || m.cranks.some((c) => c.pivot === end);
          if (!used) m = removeJoint(m, end);
        }
        edit(m);
      }
      return;
    }
    if (mode === 'link') {
      const [m1, id] = jointAt(m, p, false);
      const first = pending[0];
      if (first && first !== id) {
        edit(addLink(m1, first, id));
        setPending([id]);
      } else {
        if (m1 !== m) edit(m1);
        setPending([id]);
      }
      return;
    }
    if (mode === 'crank') {
      const first = pending[0];
      if (!first) {
        const [m1, id] = jointAt(m, p, true);
        if (m1 !== m) edit(m1);
        setPending([id]);
        return;
      }
      const [m1, id] = jointAt(m, p, false);
      if (id === first) return;
      const turning = m1.cranks[0]?.rpm ?? 30;
      edit(addCrank(m1, first, id, turning));
      setPending([]);
      return;
    }
    if (mode === 'slider') {
      const [m1, id] = jointAt(m, p, pending.length > 0);
      if (pending.includes(id)) return;
      const next = [...pending, id];
      if (next.length === 3) {
        edit(addSlider(m1, next[0] ?? '', next[1] ?? '', next[2] ?? ''));
        setPending([]);
      } else {
        if (m1 !== m) edit(m1);
        setPending(next);
      }
    }
  };

  const onPointerDown = (e: TargetedPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = world(e);
    canvasRef.current?.focus({ preventScroll: true });
    if (mode === 'move') {
      const hit = hitJoint(p);
      if (hit) {
        setPick({ kind: 'joint', id: hit });
        set({ probe: hit });
        if (atDrawing) {
          drag.current = { kind: 'joint', id: hit };
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        return;
      }
      const l = hitLink(p);
      if (l) {
        setPick({ kind: 'link', id: l.id });
        return;
      }
      setPick(null);
      drag.current = { kind: 'pan', from: [e.clientX, e.clientY], view };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    click(p);
  };
  const onPointerMove = (e: TargetedPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) {
      if (pending.length) setHover(world(e));
      return;
    }
    if (d.kind === 'pan') {
      const k = pixel();
      setView([d.view[0] - (e.clientX - d.from[0]) * k, d.view[1] - (e.clientY - d.from[1]) * k, d.view[2], d.view[3]]);
      return;
    }
    const q = snapped(world(e));
    setDraft((m) => moveJoint(m ?? mech, d.id, q[0], q[1]));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === 'joint' && draft) {
      const moved = draft.joints.find((j) => j.id === d.id);
      const before = mech.joints.find((j) => j.id === d.id);
      if (moved && before && (moved.x !== before.x || moved.y !== before.y)) edit(draft);
    }
    setDraft(null);
  };
  const onWheel = (e: TargetedWheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const p = world(e);
    const f = Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY * 0.0015)));
    setView((v) => [p[0] - (p[0] - v[0]) * f, p[1] - (p[1] - v[1]) * f, v[2] * f, v[3] * f]);
  };
  const onKeyDown = (e: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLButtonElement && (e.key === ' ' || e.key === 'Enter')) return;
    const m = MODES.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
    if (m) {
      setMode(m.mode);
      e.preventDefault();
    } else if (e.key === ' ') {
      setRunning((r) => !r);
      e.preventDefault();
    } else if (e.key === 'Escape') {
      setPending([]);
      setPick(null);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && pick) {
      edit(pick.kind === 'joint' ? removeJoint(mech, pick.id) : removeLink(mech, pick.id));
      setPick(null);
      e.preventDefault();
    }
  };

  /* --------------------------------------------------------- the scene -- */

  const u = view[2] / 640;
  const isCrankLink = (a: string, b: string) => drawn.cranks.some((c) => (c.pivot === a && c.tip === b) || (c.pivot === b && c.tip === a));
  const jointById = new Map(drawn.joints.map((j) => [j.id, j]));
  const traceColour = (id: string) =>
    LAB_COLORS[
      Math.max(
        0,
        drawn.joints.findIndex((j) => j.id === id),
      ) % LAB_COLORS.length
    ];
  const tracePaths = draft
    ? []
    : mech.traces.map((id) => {
        const pts = run.poses.map((p) => p[id]).filter((p): p is readonly [number, number] => !!p);
        return { id, d: pts.length > 1 ? `M${pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L')}${cyclic ? 'Z' : ''}` : '' };
      });
  const plateList = useMemo(() => plates(drawn), [drawn]);
  /** How far along each fixed rail its slider travels (0 and 1 are the rail's two points), so the rail is drawn long enough. */
  const railSpan = useMemo(() => {
    const out = new Map<string, readonly [number, number]>();
    const design = designPose(mech);
    for (const sl of mech.sliders) {
      const a = design[sl.a];
      const b = design[sl.b];
      if (!a || !b) continue;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy || 1;
      let lo = 0;
      let hi = 1;
      for (const pose of run.poses) {
        const q = pose[sl.joint];
        if (!q) continue;
        const t = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / len2;
        lo = Math.min(lo, t);
        hi = Math.max(hi, t);
      }
      out.set(sl.id, [lo, hi]);
    }
    return out;
  }, [mech, run]);
  const stepHint = MODES.find((x) => x.mode === mode)?.hint ?? [];
  const hint = stepHint[Math.min(pending.length, stepHint.length - 1)] ?? '';
  const pendingPoint = pending.length ? shown[pending[pending.length - 1] ?? ''] : undefined;

  const scene = (
    <svg
      ref={svgRef}
      class="lab-scene ms-scene"
      viewBox={view.map((v) => v.toFixed(2)).join(' ')}
      aria-hidden="true"
      data-testid="ms-scene"
      data-mode={mode}
      data-frame={frame}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onWheel={onWheel}
      onContextMenu={(e) => {
        if (pending.length) {
          e.preventDefault();
          setPending([]);
        }
      }}
    >
      <defs>
        <pattern id="ms-grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
          <path d={`M${GRID} 0H0V${GRID}`} class="ms-grid-line" stroke-width={0.5 * u} />
        </pattern>
        <pattern id="ms-hatch" width={6 * u} height={6 * u} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2={6 * u} class="ms-hatch-line" stroke-width={1.2 * u} />
        </pattern>
      </defs>
      <rect x={view[0]} y={view[1]} width={view[2]} height={view[3]} class="ms-paper" />
      {s.snap && <rect x={view[0]} y={view[1]} width={view[2]} height={view[3]} fill="url(#ms-grid)" pointer-events="none" />}
      {drawn.sliders.map((sl) => {
        const a = shown[sl.a];
        const b = shown[sl.b];
        if (!a || !b || fixedOnBar(drawn, sl)) return null;
        const ground = jointById.get(sl.a)?.ground && jointById.get(sl.b)?.ground;
        if (!ground && drawn.links.some((l) => (l.a === sl.a && l.b === sl.b) || (l.a === sl.b && l.b === sl.a))) return null;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const n: Pt = [(-(b[1] - a[1]) / len) * 9 * u, ((b[0] - a[0]) / len) * 9 * u];
        const [lo, hi] = railSpan.get(sl.id) ?? [0, 1];
        const pad = (24 * u) / len;
        const along = (t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const r0 = along(Math.min(0, lo - pad));
        const r1 = along(Math.max(1, hi + pad));
        return ground ? (
          <g key={sl.id} class="ms-rail" data-testid={`ms-rail-${sl.id}`}>
            <line x1={r0[0]} y1={r0[1]} x2={r1[0]} y2={r1[1]} stroke-width={1.5 * u} />
            <path d={`M${r0[0] + n[0]} ${r0[1] + n[1]}L${r1[0] + n[0]} ${r1[1] + n[1]}l${n[0] * 0.6} ${n[1] * 0.6}L${r0[0] + n[0] * 1.6} ${r0[1] + n[1] * 1.6}Z`} fill="url(#ms-hatch)" />
          </g>
        ) : (
          <line key={sl.id} class="ms-guide" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke-width={1.5 * u} stroke-dasharray={`${6 * u} ${4 * u}`} />
        );
      })}
      {drawn.cranks.map((c) => {
        const p = shown[c.pivot];
        const j = jointById.get(c.tip);
        const pv = jointById.get(c.pivot);
        if (!p || !j || !pv) return null;
        const r = Math.hypot(j.x - pv.x, j.y - pv.y);
        if (!c.swing) return <circle key={c.id} class="ms-crank-path" cx={p[0]} cy={p[1]} r={r} stroke-width={u} stroke-dasharray={`${4 * u} ${4 * u}`} />;
        const a0 = Math.atan2(j.y - pv.y, j.x - pv.x);
        const w = (c.swing * Math.PI) / 180;
        const e1: Pt = [p[0] + r * Math.cos(a0 - w), p[1] + r * Math.sin(a0 - w)];
        const e2: Pt = [p[0] + r * Math.cos(a0 + w), p[1] + r * Math.sin(a0 + w)];
        return <path key={c.id} class="ms-crank-path" d={`M${e1[0]} ${e1[1]}A${r} ${r} 0 ${2 * w > Math.PI ? 1 : 0} 1 ${e2[0]} ${e2[1]}`} stroke-width={u} stroke-dasharray={`${4 * u} ${4 * u}`} />;
      })}
      {tracePaths.map((t) => (
        <path key={t.id} class="ms-trace" d={t.d} style={{ stroke: traceColour(t.id) }} stroke-width={2 * u} data-testid={`ms-trace-${t.id}`} />
      ))}
      {plateList.map(([a, b, c]) => {
        const pa = shown[a];
        const pb = shown[b];
        const pc = shown[c];
        return pa && pb && pc ? <path key={`${a}${b}${c}`} class="ms-plate" d={`M${pa[0]} ${pa[1]}L${pb[0]} ${pb[1]}L${pc[0]} ${pc[1]}Z`} stroke-width={u} /> : null;
      })}
      {drawn.links.map((l) => {
        const a = shown[l.a];
        const b = shown[l.b];
        if (!a || !b) return null;
        const crankBar = isCrankLink(l.a, l.b);
        const frameBar = jointById.get(l.a)?.ground && jointById.get(l.b)?.ground;
        const selected = pick?.kind === 'link' && pick.id === l.id;
        return (
          <line
            key={l.id}
            class={`ms-bar${crankBar ? ' is-crank' : ''}${frameBar ? ' is-frame' : ''}${selected ? ' is-selected' : ''}`}
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
            stroke-width={7 * u}
            data-testid={`ms-bar-${l.id}`}
          />
        );
      })}
      {drawn.sliders.map((sl) => {
        const p = shown[sl.joint];
        const a = shown[sl.a];
        const b = shown[sl.b];
        if (!p || !a || !b || fixedOnBar(drawn, sl)) return null;
        const angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
        return <rect key={sl.id} class="ms-block" x={p[0] - 15 * u} y={p[1] - 8 * u} width={30 * u} height={16 * u} rx={2 * u} transform={`rotate(${angle} ${p[0]} ${p[1]})`} stroke-width={1.5 * u} />;
      })}
      {drawn.joints.map((j) => {
        const p = shown[j.id];
        if (!p) return null;
        const selected = pick?.kind === 'joint' && pick.id === j.id;
        const traced = mech.traces.includes(j.id);
        const anchorOnly = j.ground && !drawn.links.some((l) => l.a === j.id || l.b === j.id) && drawn.sliders.some((sl) => sl.a === j.id || sl.b === j.id);
        return (
          <g
            key={j.id}
            class={`ms-joint${j.ground ? ' is-ground' : ''}${selected ? ' is-selected' : ''}${j.id === probe ? ' is-probe' : ''}${pending.includes(j.id) ? ' is-pending' : ''}`}
            data-testid={`ms-joint-${j.id}`}
          >
            {j.ground && !anchorOnly && (
              <>
                <path class="ms-ground" d={`M${p[0]} ${p[1]}l${-9 * u} ${15 * u}h${18 * u}Z`} stroke-width={u} />
                <rect class="ms-ground-base" x={p[0] - 14 * u} y={p[1] + 15 * u} width={28 * u} height={6 * u} fill="url(#ms-hatch)" />
              </>
            )}
            {(selected || j.id === probe) && <circle class="ms-halo" cx={p[0]} cy={p[1]} r={9 * u} stroke-width={2 * u} />}
            <circle class="ms-pin" cx={p[0]} cy={p[1]} r={(anchorOnly ? 3 : 4.5) * u} stroke-width={1.5 * u} style={traced ? { fill: traceColour(j.id) } : undefined} />
            <text class="ms-label" x={p[0] + 8 * u} y={p[1] - 8 * u} font-size={11 * u}>
              {j.id}
            </text>
          </g>
        );
      })}
      {pendingPoint && hover && <line class="ms-rubber" x1={pendingPoint[0]} y1={pendingPoint[1]} x2={hover[0]} y2={hover[1]} stroke-width={1.5 * u} stroke-dasharray={`${5 * u} ${4 * u}`} />}
    </svg>
  );

  /* ---------------------------------------------------------- side panel -- */

  const picked = pick ? (pick.kind === 'joint' ? mech.joints.find((j) => j.id === pick.id) : mech.links.find((l) => l.id === pick.id)) : undefined;
  const pickedJoint = pick?.kind === 'joint' ? mech.joints.find((j) => j.id === pick.id) : undefined;
  const pickedLink = pick?.kind === 'link' ? mech.links.find((l) => l.id === pick.id) : undefined;
  const pickedCrank = pickedLink ? mech.cranks.find((c) => (c.pivot === pickedLink.a && c.tip === pickedLink.b) || (c.pivot === pickedLink.b && c.tip === pickedLink.a)) : undefined;
  const linkLength = (id: string) => {
    const l = mech.links.find((x) => x.id === id);
    const a = mech.joints.find((j) => j.id === l?.a);
    const b = mech.joints.find((j) => j.id === l?.b);
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const slidersOf = (id: string) => mech.sliders.filter((sl) => sl.joint === id);

  const driveControls = (c: NonNullable<typeof crank>, test: string) => (
    <>
      <div class="ms-field">
        Speed
        <NumberBox
          value={Math.abs(c.rpm)}
          min={1}
          max={3000}
          step={1}
          label="Crank speed (rpm)"
          test={`${test}-rpm`}
          onChange={(v) => edit(setCrank(mech, c.id, { rpm: v * (Math.sign(c.rpm) || 1) }))}
        />
        <span class="lab-unit">rpm</span>
      </div>
      <Segmented
        label="Turning direction"
        value={c.rpm < 0 ? 'cw' : 'ccw'}
        choices={[
          { value: 'ccw', label: 'Anticlockwise' },
          { value: 'cw', label: 'Clockwise' },
        ]}
        onChange={(d) => edit(setCrank(mech, c.id, { rpm: Math.abs(c.rpm) * (d === 'cw' ? -1 : 1) }))}
      />
      <Segmented
        label="Input motion"
        value={c.swing ? 'rock' : 'turn'}
        choices={[
          { value: 'turn', label: 'Full turns' },
          { value: 'rock', label: 'Rocking' },
        ]}
        onChange={(v) => edit(setCrank(mech, c.id, { swing: v === 'rock' ? 30 : 0 }))}
      />
      {!!c.swing && (
        <div class="ms-field">
          Swing ±
          <NumberBox value={c.swing} min={1} max={170} step={1} label="Swing either side (degrees)" test={`${test}-swing`} onChange={(v) => edit(setCrank(mech, c.id, { swing: v }))} />
          <span class="lab-unit">°</span>
        </div>
      )}
    </>
  );

  const save = (kind: 'design' | 'csv' | 'svg') =>
    attempt(async () => {
      const base = fileSafe(s.template === CUSTOM ? 'mechanism' : s.template);
      let out: Awaited<ReturnType<typeof saveFile>>;
      if (kind === 'design') out = await saveFile(`${base}.mechanism.json`, `${JSON.stringify({ format: 'benchtop-mechanism', version: 1, mechanism: mech }, null, 2)}\n`, 'application/json');
      else if (kind === 'svg') out = await saveFile(`${base}.svg`, svgDrawing(mech, shown, mech.traces.length ? run.poses : [], view, cyclic), 'image/svg+xml');
      else {
        const ids = mech.joints.filter((j) => !j.ground).map((j) => j.id);
        const header = ['input (deg)', 'time (s)', ...ids.flatMap((id) => [`${id} x (mm)`, `${id} y (mm)`]), `${probe} vx (m/s)`, `${probe} vy (m/s)`, `${probe} ax (m/s²)`, `${probe} ay (m/s²)`];
        const rows = run.poses.map((p, i) => [
          angles[i] ?? 0,
          i * dt,
          ...ids.flatMap((id) => [(p[id]?.[0] ?? Number.NaN) - origin[0], origin[1] - (p[id]?.[1] ?? Number.NaN)]),
          analysis.vx[i] ?? 0,
          analysis.vy[i] ?? 0,
          analysis.ax[i] ?? 0,
          analysis.ay[i] ?? 0,
        ]);
        out = await saveFile(`${base}-motion.csv`, csv(header, rows), 'text/csv');
      }
      if (out.saved) notify(`Saved to ${out.location}`);
    });
  const open = () =>
    attempt(async () => {
      const [file] = await pickFiles('.json,application/json');
      if (!file) return;
      const data = JSON.parse(await file.text()) as Record<string, unknown>;
      const m = readMechanism(data.mechanism ?? data);
      if (!m) throw new Error(`${file.name} does not hold a mechanism.`);
      set({ mech: m, template: CUSTOM, probe: firstProbe(m) });
      setPick(null);
      setPhase(0);
      setRunning(true);
      setRefit(true);
      notify(`Opened ${file.name}`);
    });

  /* ----------------------------------------------------------- read-outs -- */

  const crankAngle = crank && shown[crank.pivot] && shown[crank.tip] ? angleOf(shown[crank.pivot] ?? [0, 0], shown[crank.tip] ?? [0, 0]) : null;
  const vNow = Math.hypot(at(analysis.vx) ?? 0, at(analysis.vy) ?? 0);
  const aNow = Math.hypot(at(analysis.ax) ?? 0, at(analysis.ay) ?? 0);
  const peakV = Math.max(0, ...analysis.vx.map((v, i) => Math.hypot(v, analysis.vy[i] ?? 0)).filter(Number.isFinite));
  const peakA = Math.max(0, ...analysis.ax.map((v, i) => Math.hypot(v, analysis.ay[i] ?? 0)).filter(Number.isFinite));
  const dofText = dof === 0 ? '0 (moves with the input)' : dof > 0 ? `${dof} too many` : `${-dof} too few (locked)`;
  const items: [string, string][] = [];
  if (crankAngle !== null) items.push(['Crank angle', `${crankAngle.toFixed(1)}°`]);
  items.push(['Degrees of freedom left', dofText]);
  if (bar && barMotion) {
    items.push(['Four-bar type', bar.kind]);
    items.push(['Grashof: s + l against p + q', `${fmt(bar.sl, 4)} ${bar.sl <= bar.pq ? '≤' : '>'} ${fmt(bar.pq, 4)}`]);
    if (barMotion.mu.length) items.push(['Transmission angle', `${Math.min(...barMotion.mu).toFixed(1)}° to ${Math.max(...barMotion.mu).toFixed(1)}°`]);
    if (barMotion.out.length) items.push(['Rocker swing', `${(Math.max(...barMotion.out) - Math.min(...barMotion.out)).toFixed(1)}°`]);
  }
  if (probe && run.poses.length) {
    items.push([`${probe} position (x, y)`, `${fmt(at(analysis.X) ?? Number.NaN, 4)}, ${fmt(at(analysis.Y) ?? Number.NaN, 4)} mm`]);
    if (rpm) {
      items.push([`${probe} speed`, `${fmt(vNow)} m/s (peak ${fmt(peakV)})`]);
      items.push([`${probe} acceleration`, `${fmt(aNow)} m/s² (peak ${fmt(peakA)})`]);
    }
    if (analysis.stroke && analysis.stroke.length > 1e-6) {
      items.push([`${probe} stroke`, `${fmt(analysis.stroke.length, 4)} mm`]);
      if (cyclic && crank && !crank.swing)
        items.push(['Time ratio (slower ÷ faster stroke)', `${analysis.stroke.ratio.toFixed(3)} (${analysis.stroke.out.toFixed(0)}° : ${analysis.stroke.back.toFixed(0)}°)`]);
    }
  }

  const xLabel = crank?.swing ? 'Input cycle (°)' : 'Crank turned from the drawing (°)';
  const series = (values: readonly number[]) => angles.map((a, i) => [a, values[i] ?? Number.NaN] as const);
  const marker = angles[frame];

  return (
    <section class="tool lab-tool ms-tool" data-testid="tool" data-state={run.poses.length ? 'done' : 'error'}>
      <div class="lab-layout">
        <div class="lab-controls">
          <h3>Mechanism</h3>
          <select class="input" aria-label="Mechanism" value={s.template} onChange={(e) => loadTemplate(e.currentTarget.value)} data-testid="ms-template">
            {s.template === CUSTOM && <option value={CUSTOM}>{CUSTOM}</option>}
            {Object.keys(TEMPLATES).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            <option value={EMPTY_NAME}>{EMPTY_NAME}</option>
          </select>
          <div class="button-row">
            <button type="button" class="button button-small" onClick={() => setRefit(true)}>
              Fit view
            </button>
            <button type="button" class="button button-small" onClick={open}>
              Open…
            </button>
            <button type="button" class="button button-small" onClick={() => save('design')}>
              Save…
            </button>
          </div>
          <h3>Draw</h3>
          <div class="ms-tools" role="radiogroup" aria-label="Drawing tool">
            {MODES.map((m) => (
              <button
                key={m.mode}
                type="button"
                role="radio"
                aria-checked={mode === m.mode}
                class={`button button-small${mode === m.mode ? ' is-active' : ''}`}
                onClick={() => setMode(m.mode)}
                data-testid={`ms-mode-${m.mode}`}
              >
                {m.label}
                <kbd>{m.key}</kbd>
              </button>
            ))}
          </div>
          <p class="lab-note" data-testid="ms-hint">
            {hint}
          </p>
          <label class="ms-check">
            <input type="checkbox" checked={s.snap} onChange={(e) => set({ snap: e.currentTarget.checked })} /> Snap to a {GRID} mm grid
          </label>
          {crank && (
            <>
              <h3>Drive</h3>
              {driveControls(crank, 'ms-drive')}
            </>
          )}
          {picked && (
            <div class="ms-selected" data-testid="ms-selected">
              {pickedJoint && (
                <>
                  <h3>Joint {pickedJoint.id}</h3>
                  <div class="ms-field">
                    x
                    <NumberBox
                      value={pickedJoint.x - origin[0]}
                      min={-100000}
                      max={100000}
                      step={0.1}
                      label="Joint x (mm)"
                      onChange={(v) => edit(moveJoint(mech, pickedJoint.id, origin[0] + v, pickedJoint.y))}
                    />
                    <span class="lab-unit">mm</span>
                  </div>
                  <div class="ms-field">
                    y
                    <NumberBox
                      value={origin[1] - pickedJoint.y}
                      min={-100000}
                      max={100000}
                      step={0.1}
                      label="Joint y (mm)"
                      onChange={(v) => edit(moveJoint(mech, pickedJoint.id, pickedJoint.x, origin[1] - v))}
                    />
                    <span class="lab-unit">mm</span>
                  </div>
                  <label class="ms-check">
                    <input type="checkbox" checked={pickedJoint.ground} onChange={(e) => edit(setGround(mech, pickedJoint.id, e.currentTarget.checked))} /> Fixed to the ground
                  </label>
                  <label class="ms-check">
                    <input type="checkbox" checked={mech.traces.includes(pickedJoint.id)} onChange={() => edit(toggleTrace(mech, pickedJoint.id))} data-testid="ms-trace-toggle" /> Trace its path
                  </label>
                  <div class="button-row">
                    {slidersOf(pickedJoint.id).map((sl) => (
                      <button key={sl.id} type="button" class="button button-small" onClick={() => edit(removeSlider(mech, sl.id))}>
                        {fixedOnBar(mech, sl) ? 'Free it from the bar' : 'Take off its slide'}
                      </button>
                    ))}
                    <button type="button" class="button button-small" onClick={() => edit(removeJoint(mech, pickedJoint.id))}>
                      Delete joint
                    </button>
                  </div>
                </>
              )}
              {pickedLink && (
                <>
                  <h3>
                    {pickedCrank ? 'Crank' : 'Bar'} {pickedLink.a}–{pickedLink.b}
                  </h3>
                  <div class="ms-field">
                    Length
                    <NumberBox
                      value={linkLength(pickedLink.id)}
                      min={0.1}
                      max={100000}
                      step={0.1}
                      label="Bar length (mm)"
                      test="ms-length"
                      onChange={(v) => edit(setLinkLength(mech, pickedLink.id, v))}
                    />
                    <span class="lab-unit">mm</span>
                  </div>
                  {pickedCrank && pickedCrank !== crank && driveControls(pickedCrank, 'ms-crank')}
                  <div class="button-row">
                    <button type="button" class="button button-small" onClick={() => edit(removeLink(mech, pickedLink.id))}>
                      Delete {pickedCrank ? 'crank' : 'bar'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <div class="lab-stage">
          <div class="button-row lab-run">
            <button type="button" class="button button-primary button-small" onClick={() => setRunning((r) => !r)} disabled={lastFrame === 0 || !rpm} data-testid="ms-run">
              {running ? 'Pause' : 'Run'}
            </button>
            <button type="button" class="button button-small" onClick={toDrawing} data-testid="ms-rewind">
              Back to the drawing
            </button>
            <input
              type="range"
              class="ms-scrub"
              min={0}
              max={lastFrame}
              step={1}
              value={frame}
              aria-label="Input position"
              data-testid="ms-scrub"
              onInput={(e) => {
                setRunning(false);
                setPhase(Number(e.currentTarget.value));
              }}
            />
            <Segmented label="Playback speed" value={s.playback} choices={PLAYBACK} onChange={(playback) => set({ playback })} />
          </div>
          <div
            ref={canvasRef}
            class="ms-canvas"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the drawing takes keys (V, G, J, L, K, S, T and X pick tools; Space runs or pauses) like any editor
            tabIndex={0}
            role="application"
            aria-roledescription="mechanism drawing"
            aria-label="Mechanism drawing. V, G, J, L, K, S, T and X pick the drawing tools; Space runs or pauses; Delete removes the selection."
            onKeyDown={onKeyDown}
          >
            {scene}
          </div>
          <div class="ms-status" data-testid="ms-status">
            {!run.poses.length && (
              <p class="recipe-error" role="alert">
                The drawing cannot be put together as it stands: check that every sliding joint sits on its line and that a crank pin is not also held by a rail.
              </p>
            )}
            {locked && run.poses.length > 0 && (
              <p class="ms-warning">It locks when the input has turned {fmt(run.lockedAt ?? 0)}° — a dead point, where the bars line up. It runs back and forth over the range it can reach.</p>
            )}
            {!crank && mech.joints.length > 0 && <p class="lab-note">Add a crank (K) to drive the mechanism.</p>}
            {crank && dof > 0 && <p class="ms-warning">{plural(dof, 'degree of freedom is', 'degrees of freedom are')} not driven, so some joints can flop: add bars or sliders, or another crank.</p>}
            {crank && dof < 0 && <p class="ms-warning">There {dof === -1 ? 'is one constraint' : `are ${-dof} constraints`} too many: this is a structure unless its proportions are special.</p>}
          </div>
          <Readouts test="ms-readouts" items={items} />
          {probe && run.poses.length > 1 && (
            <>
              <div class="lab-plots">
                <Plot
                  title={`Position of ${probe}`}
                  test="ms-plot-position"
                  series={[
                    { name: 'x', points: series(analysis.X) },
                    { name: 'y', points: series(analysis.Y) },
                  ]}
                  xLabel={xLabel}
                  yLabel="mm"
                  marker={marker}
                  xRange={[0, 360]}
                />
                {!!rpm && (
                  <Plot
                    title={`Velocity of ${probe}`}
                    test="ms-plot-velocity"
                    series={[
                      { name: 'vx', points: series(analysis.vx) },
                      { name: 'vy', points: series(analysis.vy) },
                    ]}
                    xLabel={xLabel}
                    yLabel="m/s"
                    marker={marker}
                    xRange={[0, 360]}
                  />
                )}
                {!!rpm && (
                  <Plot
                    title={`Acceleration of ${probe}`}
                    test="ms-plot-acceleration"
                    series={[
                      { name: 'ax', points: series(analysis.ax) },
                      { name: 'ay', points: series(analysis.ay) },
                    ]}
                    xLabel={xLabel}
                    yLabel="m/s²"
                    marker={marker}
                    xRange={[0, 360]}
                  />
                )}
                {bar && barMotion && (
                  <Plot
                    title={`Rocker ${bar.o4}–${bar.b} angle`}
                    test="ms-plot-rocker"
                    series={[{ name: 'rocker angle', points: series(barMotion.out) }]}
                    xLabel={xLabel}
                    yLabel="°"
                    marker={marker}
                    xRange={[0, 360]}
                  />
                )}
              </div>
              <div class="button-row">
                <label class="ms-field ms-probe">
                  Plot joint
                  <select class="input" value={probe} onChange={(e) => set({ probe: e.currentTarget.value })} data-testid="ms-probe">
                    {mech.joints.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.id}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" class="button button-small" onClick={() => save('csv')}>
                  Motion (CSV)
                </button>
                <button type="button" class="button button-small" onClick={() => save('svg')}>
                  Drawing (SVG)
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export default defineCustomTool(MechanismSim);
