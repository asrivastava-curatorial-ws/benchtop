/**
 * Planar linkages: joints, rigid links, cranks (turning or rocking inputs)
 * and sliders (a joint kept on the line through two others).  Positions are
 * solved by Levenberg–Marquardt on the distance and line constraints, step by
 * step from the last pose, so a mechanism moves continuously and the solver
 * reports where it locks.
 *
 * Coordinates are drawing units (think millimetres) with y downwards.
 */

export interface Joint {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly ground: boolean;
}

export interface Link {
  readonly id: string;
  readonly a: string;
  readonly b: string;
}

export interface Crank {
  readonly id: string;
  readonly pivot: string;
  readonly tip: string;
  /** Turns per minute; negative turns the other way. */
  readonly rpm: number;
  /** For a rocking input: swing either side of the drawn position, in degrees (0 or absent: full turns). */
  readonly swing?: number;
}

export interface Slider {
  readonly id: string;
  readonly joint: string;
  /** The line runs through these two joints (ground for a fixed rail, moving for a slotted link). */
  readonly a: string;
  readonly b: string;
}

export interface Mechanism {
  readonly joints: readonly Joint[];
  readonly links: readonly Link[];
  readonly cranks: readonly Crank[];
  readonly sliders: readonly Slider[];
  readonly traces: readonly string[];
}

export type Pose = Readonly<Record<string, readonly [number, number]>>;

export const designPose = (m: Mechanism): Pose => Object.fromEntries(m.joints.map((j) => [j.id, [j.x, j.y] as const]));

const dist = (a: readonly [number, number], b: readonly [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Link lengths from the drawing. */
export function linkLengths(m: Mechanism): Map<string, number> {
  const pose = designPose(m);
  const out = new Map<string, number>();
  for (const l of m.links) {
    const a = pose[l.a];
    const b = pose[l.b];
    if (a && b) out.set(l.id, dist(a, b));
  }
  return out;
}

/** Joints the cranks put in place at input angle `t` (crank turns from the drawing, radians, for 1 rpm-unit). */
export function drivenAt(m: Mechanism, t: number): Map<string, [number, number]> {
  const pose = designPose(m);
  const first = m.cranks[0]?.rpm || 1;
  const out = new Map<string, [number, number]>();
  for (const c of m.cranks) {
    const p = pose[c.pivot];
    const q = pose[c.tip];
    if (!p || !q) continue;
    const r = dist(p, q);
    const a0 = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const turn = t * (c.rpm / first);
    // Screen y points down, so a positive turn is drawn anticlockwise by subtracting.
    const a = c.swing ? a0 - ((c.swing * Math.PI) / 180) * Math.sin(turn) : a0 - turn;
    out.set(c.tip, [p[0] + r * Math.cos(a), p[1] + r * Math.sin(a)]);
  }
  return out;
}

/** Degrees of freedom the cranks leave: 2 per moving joint less one per constraint. */
export function freedom(m: Mechanism): number {
  const driven = new Set(m.cranks.map((c) => c.tip));
  const free = m.joints.filter((j) => !j.ground && !driven.has(j.id)).length;
  const crankLinks = m.links.filter((l) => m.cranks.some((c) => (c.pivot === l.a && c.tip === l.b) || (c.pivot === l.b && c.tip === l.a))).length;
  return 2 * free - (m.links.length - crankLinks) - m.sliders.length;
}

function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i] ?? 0]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]?.[col] ?? 0) > Math.abs(M[pivot]?.[col] ?? 0)) pivot = r;
    const pr = M[pivot];
    if (!pr || Math.abs(pr[col] ?? 0) < 1e-14) return null;
    [M[col], M[pivot]] = [pr, M[col] ?? pr];
    const row = M[col] ?? pr;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const target = M[r];
      if (!target) continue;
      const f = (target[col] ?? 0) / (row[col] ?? 1);
      if (f === 0) continue;
      for (let k = col; k <= n; k++) target[k] = (target[k] ?? 0) - f * (row[k] ?? 0);
    }
  }
  return M.map((row, i) => (row[n] ?? 0) / (row[i] ?? 1));
}

export interface Solved {
  readonly pose: Pose;
  /** Largest constraint error. */
  readonly error: number;
  readonly ok: boolean;
}

/** Positions satisfying every link and slider, as close as possible to `guess`, with `fixed` joints held. */
export function solvePose(m: Mechanism, lengths: ReadonlyMap<string, number>, guess: Pose, fixed: ReadonlyMap<string, readonly [number, number]>): Solved {
  const pose: Record<string, [number, number]> = {};
  for (const j of m.joints) pose[j.id] = [...(fixed.get(j.id) ?? guess[j.id] ?? [j.x, j.y])] as [number, number];
  const unknown = m.joints.filter((j) => !j.ground && !fixed.has(j.id)).map((j) => j.id);
  const index = new Map(unknown.map((id, k) => [id, k]));
  const n = unknown.length * 2;
  const scale = Math.max(1, ...[...lengths.values()]);
  /** Residuals and their analytic Jacobian. */
  const evaluate = (): { r: number[]; J: number[][] } => {
    const r: number[] = [];
    const J: number[][] = [];
    const row = () => new Array<number>(n).fill(0);
    const put = (g: number[], id: string, dx: number, dy: number) => {
      const k = index.get(id);
      if (k === undefined) return;
      g[2 * k] = (g[2 * k] ?? 0) + dx;
      g[2 * k + 1] = (g[2 * k + 1] ?? 0) + dy;
    };
    for (const l of m.links) {
      const a = pose[l.a];
      const b = pose[l.b];
      if (!a || !b) continue;
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1e-12;
      r.push((d - (lengths.get(l.id) ?? 0)) / scale);
      const g = row();
      const ux = (a[0] - b[0]) / d / scale;
      const uy = (a[1] - b[1]) / d / scale;
      put(g, l.a, ux, uy);
      put(g, l.b, -ux, -uy);
      J.push(g);
    }
    for (const sl of m.sliders) {
      const p = pose[sl.joint];
      const a = pose[sl.a];
      const b = pose[sl.b];
      if (!p || !a || !b) continue;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1e-12;
      const c = (p[0] - a[0]) * dy - (p[1] - a[1]) * dx;
      r.push(c / len / scale);
      // d(c/len) = dc/len − c·dlen/len²
      const g = row();
      const k = 1 / (len * scale);
      const q = c / (len * len * len * scale);
      put(g, sl.joint, dy * k, -dx * k);
      put(g, sl.a, (p[1] - b[1]) * k + dx * q, (b[0] - p[0]) * k + dy * q);
      put(g, sl.b, -(p[1] - a[1]) * k - dx * q, (p[0] - a[0]) * k - dy * q);
      J.push(g);
    }
    return { r, J };
  };
  let { r, J } = evaluate();
  let cost = r.reduce((sum, v) => sum + v * v, 0);
  const done = () => r.every((v) => Math.abs(v) < 1e-13);
  let lambda = 1e-3;
  for (let iter = 0; iter < 80 && n > 0 && !done(); iter++) {
    const JTJ: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => J.reduce((sum, g) => sum + (g[i] ?? 0) * (g[j] ?? 0), 0)));
    const JTr = Array.from({ length: n }, (_, i) => -J.reduce((sum, g, k) => sum + (g[i] ?? 0) * (r[k] ?? 0), 0));
    // Marquardt's scaling: damp each unknown in proportion to its own curvature, with a floor for joints no constraint touches yet.
    const floor = 1e-9 * Math.max(1e-30, ...JTJ.map((g, i) => g[i] ?? 0));
    let improved = false;
    for (let tries = 0; tries < 16 && !improved; tries++) {
      const A = JTJ.map((g, i) => g.map((v, j) => (i === j ? v + lambda * Math.max(v, floor) : v)));
      const step = solveLinear(A, JTr);
      if (!step) {
        lambda *= 10;
        continue;
      }
      const saved = unknown.map((id) => [...(pose[id] ?? [0, 0])] as [number, number]);
      unknown.forEach((id, k) => {
        const p = pose[id];
        if (p) {
          p[0] += step[2 * k] ?? 0;
          p[1] += step[2 * k + 1] ?? 0;
        }
      });
      const next = evaluate();
      const cost2 = next.r.reduce((sum, v) => sum + v * v, 0);
      if (cost2 <= cost) {
        ({ r, J } = next);
        improved = cost2 < cost;
        cost = cost2;
        lambda = Math.max(1e-15, lambda / 10);
        if (!improved) break;
      } else {
        unknown.forEach((id, k) => {
          pose[id] = saved[k] ?? [0, 0];
        });
        lambda *= 10;
      }
    }
    if (!improved) break;
  }
  const error = Math.max(0, ...r.map((v) => Math.abs(v) * scale));
  return { pose, error, ok: error < 1e-6 * scale };
}

export interface Sweep {
  /** Input angle of each frame, degrees. */
  readonly angles: readonly number[];
  readonly poses: readonly Pose[];
  /** Angle at which the mechanism locked, if it did. */
  readonly lockedAt: number | null;
}

/** Moves the mechanism through one turn (or one swing cycle) of its first crank. */
export function sweep(m: Mechanism, frames = 180, substeps = 4): Sweep {
  const lengths = linkLengths(m);
  const angles: number[] = [];
  const poses: Pose[] = [];
  let last: Pose = designPose(m);
  let before: Pose | null = null;
  let lockedAt: number | null = null;
  const solved0 = solvePose(m, lengths, last, drivenAt(m, 0));
  if (!solved0.ok) return { angles, poses, lockedAt: 0 };
  last = solved0.pose;
  angles.push(0);
  poses.push(last);
  for (let i = 1; i <= frames && lockedAt === null; i++) {
    for (let k = 1; k <= substeps; k++) {
      const t = (2 * Math.PI * (i - 1 + k / substeps)) / frames;
      // Guess ahead along the path so far, which keeps the solver on the same branch.
      const guess: Record<string, readonly [number, number]> = {};
      for (const [id, p] of Object.entries(last)) {
        const q = before?.[id];
        guess[id] = q ? [2 * p[0] - q[0], 2 * p[1] - q[1]] : p;
      }
      const solved = solvePose(m, lengths, guess, drivenAt(m, t));
      if (!solved.ok) {
        lockedAt = (i * 360) / frames;
        break;
      }
      before = last;
      last = solved.pose;
    }
    if (lockedAt === null) {
      angles.push((i * 360) / frames);
      poses.push(last);
    }
  }
  return { angles, poses, lockedAt };
}

/** Whether a four-bar with these links has a link that turns fully (Grashof: s + l ≤ p + q). */
export function grashof(lengths: readonly number[]): { s: number; l: number; pq: number; turns: boolean } {
  const sorted = [...lengths].sort((a, b) => a - b);
  const s = sorted[0] ?? 0;
  const l = sorted[3] ?? 0;
  const pq = (sorted[1] ?? 0) + (sorted[2] ?? 0);
  return { s, l, pq, turns: s + l <= pq + 1e-9 };
}

/* ----------------------------------------------------------- analysis -- */

export interface FourBar {
  readonly o2: string;
  readonly a: string;
  readonly b: string;
  readonly o4: string;
  readonly lengths: { readonly ground: number; readonly crank: number; readonly coupler: number; readonly rocker: number };
  /** Grashof's sum s + l against p + q. */
  readonly sl: number;
  readonly pq: number;
  readonly kind: string;
}

const linked = (m: Mechanism, x: string, y: string) => m.links.some((l) => (l.a === x && l.b === y) || (l.a === y && l.b === x));

/** The ground, crank, coupler and rocker of a four-bar loop driven by the only crank, if there is one. */
export function fourBar(m: Mechanism): FourBar | null {
  const c = m.cranks[0];
  if (!c || m.cranks.length !== 1) return null;
  const joints = new Map(m.joints.map((j) => [j.id, j]));
  const o2 = joints.get(c.pivot);
  const a = joints.get(c.tip);
  if (!o2?.ground || !a || a.ground) return null;
  for (const l of m.links) {
    const other = l.a === a.id ? l.b : l.b === a.id ? l.a : null;
    const b = other ? joints.get(other) : undefined;
    if (!b || b.ground) continue;
    const o4 = m.joints.find((j) => j.ground && j.id !== o2.id && linked(m, j.id, b.id));
    if (!o4) continue;
    const d = (p: Joint, q: Joint) => Math.hypot(p.x - q.x, p.y - q.y);
    const lengths = { ground: d(o2, o4), crank: d(o2, a), coupler: d(a, b), rocker: d(o4, b) };
    const g = grashof(Object.values(lengths));
    const shortest = (Object.entries(lengths) as [keyof typeof lengths, number][]).reduce((x, y) => (y[1] < x[1] ? y : x))[0];
    const sl = g.s + g.l;
    const kind =
      Math.abs(sl - g.pq) <= 1e-6 * g.l
        ? 'change point (it can fold flat)'
        : !g.turns
          ? 'triple rocker (no link turns fully)'
          : shortest === 'crank'
            ? 'crank–rocker'
            : shortest === 'ground'
              ? 'double crank (drag link)'
              : shortest === 'coupler'
                ? 'double rocker'
                : 'rocker–crank (the output turns fully)';
    return { o2: o2.id, a: a.id, b: b.id, o4: o4.id, lengths, sl, pq: g.pq, kind };
  }
  return null;
}

/** The angle between coupler and rocker at the rocker pin, degrees. */
export function transmissionAngle(f: FourBar, pose: Pose): number {
  const a = pose[f.a];
  const b = pose[f.b];
  const o4 = pose[f.o4];
  if (!a || !b || !o4) return Number.NaN;
  const u = [a[0] - b[0], a[1] - b[1]];
  const v = [o4[0] - b[0], o4[1] - b[1]];
  const cos = ((u[0] ?? 0) * (v[0] ?? 0) + (u[1] ?? 0) * (v[1] ?? 0)) / (Math.hypot(u[0] ?? 0, u[1] ?? 0) * Math.hypot(v[0] ?? 0, v[1] ?? 0));
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

export interface Stroke {
  /** Travel along the direction the point moves most, drawing units. */
  readonly length: number;
  /** Unit vector of that direction. */
  readonly axis: readonly [number, number];
  /** Input angle taken by the stroke from one end to the other, and back, degrees. */
  readonly out: number;
  readonly back: number;
  /** Slower stroke time over faster stroke time (1 for a symmetric motion). */
  readonly ratio: number;
}

/** Stroke and time ratio of a point moved through one input turn (`angles` and `points` from a sweep). */
export function strokeOf(points: readonly (readonly [number, number])[], angles: readonly number[]): Stroke | null {
  const n = points.length;
  if (n < 3) return null;
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of points) {
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
    sxy += (x - mx) * (y - my);
  }
  const t = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const axis = [Math.cos(t), Math.sin(t)] as const;
  const along = points.map(([x, y]) => x * axis[0] + y * axis[1]);
  let lo = 0;
  let hi = 0;
  along.forEach((v, i) => {
    if (v < (along[lo] ?? v)) lo = i;
    if (v > (along[hi] ?? v)) hi = i;
  });
  const length = (along[hi] ?? 0) - (along[lo] ?? 0);
  const out = ((((angles[hi] ?? 0) - (angles[lo] ?? 0)) % 360) + 360) % 360;
  const back = 360 - out;
  return { length, axis, out, back, ratio: Math.min(out, back) > 0 ? Math.max(out, back) / Math.min(out, back) : Number.POSITIVE_INFINITY };
}

/**
 * Rates of change by central differences, `dt` apart.  A periodic signal
 * repeats its first sample as its last.
 */
export function derivative(values: readonly number[], dt: number, periodic: boolean): number[] {
  const n = values.length;
  if (n < 2) return values.map(() => 0);
  const v = (i: number) => values[i] ?? 0;
  return values.map((_, i) => {
    if (periodic && n > 2) {
      const m = n - 1;
      const prev = v((i - 1 + m) % m);
      const next = v((i + 1) % m);
      return (next - prev) / (2 * dt);
    }
    if (i === 0) return (v(1) - v(0)) / dt;
    if (i === n - 1) return (v(n - 1) - v(n - 2)) / dt;
    return (v(i + 1) - v(i - 1)) / (2 * dt);
  });
}

/** Groups of three joints all joined to each other: drawn as rigid plates. */
export function plates(m: Mechanism): [string, string, string][] {
  const out: [string, string, string][] = [];
  const ids = m.joints.map((j) => j.id);
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      for (let k = j + 1; k < ids.length; k++) {
        const a = ids[i] ?? '';
        const b = ids[j] ?? '';
        const c = ids[k] ?? '';
        if (linked(m, a, b) && linked(m, b, c) && linked(m, a, c)) out.push([a, b, c]);
      }
  return out;
}

/** A slider whose joint is also tied to one end of its line cannot slide: it is a point fixed on a bar. */
export const fixedOnBar = (m: Mechanism, s: Slider): boolean => linked(m, s.joint, s.a) || linked(m, s.joint, s.b);

/* ------------------------------------------------------------ editing -- */

/** A joint id not yet used: G1, G2… for ground, J1, J2… for the rest. */
export function nextId(m: Mechanism, prefix: string): string {
  const used = new Set([...m.joints.map((j) => j.id), ...m.links.map((l) => l.id), ...m.cranks.map((c) => c.id), ...m.sliders.map((s) => s.id)]);
  for (let i = 1; ; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`;
}

export const EMPTY: Mechanism = { joints: [], links: [], cranks: [], sliders: [], traces: [] };

export function addJoint(m: Mechanism, x: number, y: number, ground: boolean): [Mechanism, string] {
  const id = nextId(m, ground ? 'G' : 'J');
  return [{ ...m, joints: [...m.joints, { id, x, y, ground }] }, id];
}

export function addLink(m: Mechanism, a: string, b: string): Mechanism {
  if (a === b || linked(m, a, b)) return m;
  return { ...m, links: [...m.links, { id: nextId(m, 'L'), a, b }] };
}

/** Makes `pivot`–`tip` a crank (adding the bar if needed); a joint has one crank at most. */
export function addCrank(m: Mechanism, pivot: string, tip: string, rpm: number): Mechanism {
  if (pivot === tip || m.cranks.some((c) => c.tip === tip)) return m;
  const withLink = addLink(m, pivot, tip);
  const joints = withLink.joints.map((j) => (j.id === pivot ? { ...j, ground: true } : j.id === tip ? { ...j, ground: false } : j));
  return { ...withLink, joints, cranks: [...withLink.cranks, { id: nextId(withLink, 'K'), pivot, tip, rpm }] };
}

export function addSlider(m: Mechanism, joint: string, a: string, b: string): Mechanism {
  if (joint === a || joint === b || a === b) return m;
  return { ...m, sliders: [...m.sliders, { id: nextId(m, 'S'), joint, a, b }] };
}

export const moveJoint = (m: Mechanism, id: string, x: number, y: number): Mechanism => ({ ...m, joints: m.joints.map((j) => (j.id === id ? { ...j, x, y } : j)) });

export function setGround(m: Mechanism, id: string, ground: boolean): Mechanism {
  // A crank pin cannot be fixed: drop the crank instead.
  const cranks = ground ? m.cranks.filter((c) => c.tip !== id) : m.cranks.filter((c) => c.pivot !== id);
  return { ...m, cranks, joints: m.joints.map((j) => (j.id === id ? { ...j, ground } : j)) };
}

export const toggleTrace = (m: Mechanism, id: string): Mechanism => ({ ...m, traces: m.traces.includes(id) ? m.traces.filter((t) => t !== id) : [...m.traces, id] });

export function removeJoint(m: Mechanism, id: string): Mechanism {
  return {
    joints: m.joints.filter((j) => j.id !== id),
    links: m.links.filter((l) => l.a !== id && l.b !== id),
    cranks: m.cranks.filter((c) => c.pivot !== id && c.tip !== id),
    sliders: m.sliders.filter((s) => s.joint !== id && s.a !== id && s.b !== id),
    traces: m.traces.filter((t) => t !== id),
  };
}

/** Removes a bar, and the crank that drives along it. */
export function removeLink(m: Mechanism, id: string): Mechanism {
  const l = m.links.find((x) => x.id === id);
  if (!l) return m;
  return { ...m, links: m.links.filter((x) => x.id !== id), cranks: m.cranks.filter((c) => !((c.pivot === l.a && c.tip === l.b) || (c.pivot === l.b && c.tip === l.a))) };
}

export const removeCrank = (m: Mechanism, id: string): Mechanism => ({ ...m, cranks: m.cranks.filter((c) => c.id !== id) });
export const removeSlider = (m: Mechanism, id: string): Mechanism => ({ ...m, sliders: m.sliders.filter((s) => s.id !== id) });

/** Gives a bar a new length by moving its free end (the end that is not fixed) along the bar. */
export function setLinkLength(m: Mechanism, id: string, length: number): Mechanism {
  const l = m.links.find((x) => x.id === id);
  const a = m.joints.find((j) => j.id === l?.a);
  const b = m.joints.find((j) => j.id === l?.b);
  if (!l || !a || !b || !(length > 0)) return m;
  const [fixed, moving] = b.ground && !a.ground ? [b, a] : [a, b];
  const d = Math.hypot(moving.x - fixed.x, moving.y - fixed.y) || 1;
  return moveJoint(m, moving.id, fixed.x + ((moving.x - fixed.x) * length) / d, fixed.y + ((moving.y - fixed.y) * length) / d);
}

export const setCrank = (m: Mechanism, id: string, patch: Partial<Pick<Crank, 'rpm' | 'swing'>>): Mechanism => ({ ...m, cranks: m.cranks.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

/** A mechanism from saved data, or null when it does not hold together. */
export function readMechanism(raw: unknown): Mechanism | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : []);
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 && v.length <= 40 ? v : null);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const joints: Joint[] = [];
  for (const j of list(o.joints)) {
    const id = str(j.id);
    const x = num(j.x);
    const y = num(j.y);
    if (id && x !== null && y !== null && !joints.some((k) => k.id === id)) joints.push({ id, x, y, ground: j.ground === true });
  }
  const has = (id: string | null): id is string => id !== null && joints.some((j) => j.id === id);
  const links: Link[] = [];
  for (const l of list(o.links)) {
    const id = str(l.id);
    const a = str(l.a);
    const b = str(l.b);
    if (id && has(a) && has(b) && a !== b) links.push({ id, a, b });
  }
  const cranks: Crank[] = [];
  for (const c of list(o.cranks)) {
    const id = str(c.id);
    const pivot = str(c.pivot);
    const tip = str(c.tip);
    const rpm = num(c.rpm);
    const swing = num(c.swing);
    if (id && has(pivot) && has(tip) && pivot !== tip && rpm !== null && rpm !== 0) cranks.push({ id, pivot, tip, rpm, ...(swing !== null && swing > 0 && swing < 180 ? { swing } : {}) });
  }
  const sliders: Slider[] = [];
  for (const s of list(o.sliders)) {
    const id = str(s.id);
    const joint = str(s.joint);
    const a = str(s.a);
    const b = str(s.b);
    if (id && has(joint) && has(a) && has(b) && joint !== a && joint !== b && a !== b) sliders.push({ id, joint, a, b });
  }
  const traces = Array.isArray(o.traces) ? o.traces.filter((t): t is string => typeof t === 'string' && has(t)) : [];
  if (Array.isArray(o.joints) && o.joints.length > 0 && joints.length === 0) return null;
  return { joints, links, cranks, sliders, traces };
}

/* ---------------------------------------------------------- templates -- */

type P = [number, number];

/** The intersection of two circles; `pick` chooses between the two points. */
function meet(c1: P, r1: number, c2: P, r2: number, pick: (a: P, b: P) => P): P {
  const d = Math.hypot(c2[0] - c1[0], c2[1] - c1[1]);
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const mx = c1[0] + (a * (c2[0] - c1[0])) / d;
  const my = c1[1] + (a * (c2[1] - c1[1])) / d;
  const p1: P = [mx + (h * (c2[1] - c1[1])) / d, my - (h * (c2[0] - c1[0])) / d];
  const p2: P = [mx - (h * (c2[1] - c1[1])) / d, my + (h * (c2[0] - c1[0])) / d];
  return pick(p1, p2);
}
const upper = (a: P, b: P) => (a[1] < b[1] ? a : b);
const lower = (a: P, b: P) => (a[1] > b[1] ? a : b);
const leftmost = (a: P, b: P) => (a[0] < b[0] ? a : b);

function build(points: Record<string, P | [number, number, 'ground']>, links: [string, string][], cranks: Omit<Crank, 'id'>[], sliders: Omit<Slider, 'id'>[], traces: string[]): Mechanism {
  return {
    joints: Object.entries(points).map(([id, p]) => ({ id, x: p[0], y: p[1], ground: p[2] === 'ground' })),
    links: links.map(([a, b], i) => ({ id: `L${i + 1}`, a, b })),
    cranks: cranks.map((c, i) => ({ ...c, id: `K${i + 1}` })),
    sliders: sliders.map((s, i) => ({ ...s, id: `S${i + 1}` })),
    traces,
  };
}

export const TEMPLATES: Readonly<Record<string, () => Mechanism>> = {
  'Four-bar (crank and rocker)': () => {
    const O2: P = [200, 300];
    const O4: P = [400, 300];
    const A: P = [260, 300];
    const B = meet(A, 180, O4, 140, upper);
    const C = meet(A, 150, B, 110, upper);
    return build(
      { O2: [...O2, 'ground'], O4: [...O4, 'ground'], A, B, C },
      [
        ['O2', 'A'],
        ['A', 'B'],
        ['O4', 'B'],
        ['A', 'C'],
        ['B', 'C'],
      ],
      [{ pivot: 'O2', tip: 'A', rpm: 30 }],
      [],
      ['C'],
    );
  },
  'Slider-crank (engine)': () => {
    const O: P = [180, 250];
    const A: P = [180 + 70, 250];
    const B: P = [250 + 200, 250];
    return build(
      { O: [...O, 'ground'], R1: [300, 250, 'ground'], R2: [600, 250, 'ground'], A, B },
      [
        ['O', 'A'],
        ['A', 'B'],
      ],
      [{ pivot: 'O', tip: 'A', rpm: 30 }],
      [{ joint: 'B', a: 'R1', b: 'R2' }],
      ['B'],
    );
  },
  'Hoekens straight-line linkage': () => {
    const O2: P = [200, 330];
    const O4: P = [320, 330];
    const A: P = [260, 330];
    const B = meet(A, 150, O4, 150, upper);
    const P1: P = [A[0] + 2 * (B[0] - A[0]), A[1] + 2 * (B[1] - A[1])];
    return build(
      { O2: [...O2, 'ground'], O4: [...O4, 'ground'], A, B, P: P1 },
      [
        ['O2', 'A'],
        ['A', 'B'],
        ['O4', 'B'],
        ['B', 'P'],
      ],
      [{ pivot: 'O2', tip: 'A', rpm: 30 }],
      [{ joint: 'P', a: 'A', b: 'B' }],
      ['P'],
    );
  },
  'Peaucellier–Lipkin (exact straight line)': () => {
    // Long arms 150 from O, rhombus sides 60; Q runs on a circle through O, so P runs on a straight line.
    const O: P = [300, 250];
    const Op: P = [220, 250];
    const alpha = (110 * Math.PI) / 180;
    const Q: P = [Op[0] + 80 * Math.cos(alpha), Op[1] - 80 * Math.sin(alpha)];
    const A = meet(O, 150, Q, 60, upper);
    const B = meet(O, 150, Q, 60, lower);
    const Pp = meet(A, 60, B, 60, (a, b) => (Math.hypot(a[0] - Q[0], a[1] - Q[1]) > Math.hypot(b[0] - Q[0], b[1] - Q[1]) ? a : b));
    return build(
      { O: [...O, 'ground'], Op: [...Op, 'ground'], Q, A, B, P: Pp },
      [
        ['Op', 'Q'],
        ['O', 'A'],
        ['O', 'B'],
        ['A', 'Q'],
        ['B', 'Q'],
        ['A', 'P'],
        ['B', 'P'],
      ],
      [{ pivot: 'Op', tip: 'Q', rpm: 20, swing: 30 }],
      [],
      ['P'],
    );
  },
  'Jansen’s leg (Strandbeest)': () => {
    // Theo Jansen's lengths, scaled ×4; y is flipped for the screen.
    const k = 4;
    const at = (x: number, y: number): P => [300 + x * k, 160 - y * k];
    const A = at(0, 0);
    const Bp = at(-38, -7.8);
    const C = at(15, 0);
    const D = meet(C, 50 * k, Bp, 41.5 * k, upper);
    const E = meet(Bp, 40.1 * k, D, 55.8 * k, leftmost);
    const F = meet(C, 61.9 * k, Bp, 39.3 * k, lower);
    const G = meet(E, 39.4 * k, F, 36.7 * k, leftmost);
    const H = meet(F, 49 * k, G, 65.7 * k, lower);
    return build(
      { A: [...A, 'ground'], B: [...Bp, 'ground'], C, D, E, F, G, H },
      [
        ['A', 'C'],
        ['C', 'D'],
        ['B', 'D'],
        ['B', 'E'],
        ['D', 'E'],
        ['C', 'F'],
        ['B', 'F'],
        ['E', 'G'],
        ['F', 'G'],
        ['F', 'H'],
        ['G', 'H'],
      ],
      [{ pivot: 'A', tip: 'C', rpm: 30 }],
      [],
      ['H'],
    );
  },
  'Quick return (crank and slotted lever)': () => {
    const O: P = [300, 210];
    const Q: P = [300, 380];
    const A: P = [300 + 70, 210];
    const dir = Math.atan2(A[1] - Q[1], A[0] - Q[0]);
    const S: P = [Q[0] + 300 * Math.cos(dir), Q[1] + 300 * Math.sin(dir)];
    const R: P = [S[0] + Math.sqrt(110 * 110 - (S[1] - 60) ** 2), 60];
    return build(
      { O: [...O, 'ground'], Q: [...Q, 'ground'], G1: [100, 60, 'ground'], G2: [600, 60, 'ground'], A, S, R },
      [
        ['O', 'A'],
        ['Q', 'S'],
        ['S', 'R'],
      ],
      [{ pivot: 'O', tip: 'A', rpm: 30 }],
      [
        { joint: 'A', a: 'Q', b: 'S' },
        { joint: 'R', a: 'G1', b: 'G2' },
      ],
      ['R'],
    );
  },
  'Scotch yoke': () => {
    // The yoke is a rigid triangle sliding on a rail; the crank pin slides in its upright slot.
    const O: P = [250, 250];
    const A: P = [320, 250];
    return build(
      { O: [...O, 'ground'], G1: [150, 330, 'ground'], G2: [470, 330, 'ground'], A, Y1: [320, 330], Y3: [420, 330], Y2: [320, 150] },
      [
        ['O', 'A'],
        ['Y1', 'Y3'],
        ['Y1', 'Y2'],
        ['Y3', 'Y2'],
      ],
      [{ pivot: 'O', tip: 'A', rpm: 30 }],
      [
        { joint: 'Y1', a: 'G1', b: 'G2' },
        { joint: 'Y3', a: 'G1', b: 'G2' },
        { joint: 'A', a: 'Y1', b: 'Y2' },
      ],
      ['Y1'],
    );
  },
  'Watt’s linkage': () => {
    const O1: P = [180, 200];
    const O2: P = [420, 280];
    const A: P = [280, 200];
    const B: P = [320, 280];
    const C: P = [300, 240];
    return build(
      { O1: [...O1, 'ground'], O2: [...O2, 'ground'], A, B, C },
      [
        ['O1', 'A'],
        ['O2', 'B'],
        ['A', 'B'],
        ['A', 'C'],
      ],
      [{ pivot: 'O1', tip: 'A', rpm: 20, swing: 20 }],
      // C is the middle of the coupler: a fixed distance from A along the line AB.
      [{ joint: 'C', a: 'A', b: 'B' }],
      ['C'],
    );
  },
};
