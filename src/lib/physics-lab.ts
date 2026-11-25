/**
 * Physics for the simulation labs, in SI units unless a function says
 * otherwise: a Runge–Kutta stepper, projectiles with air drag, pendulums,
 * driven oscillators, collisions, orbits, inclines, levers and pulleys,
 * forces, sound, a gas of hard disks, electric fields, generators and fluids.
 */

export const G_EARTH = 9.80665;

/* ------------------------------------------------------------------ RK4 -- */

export type Derivative = (t: number, y: readonly number[]) => number[];

/** One classic fourth-order Runge–Kutta step. */
export function rk4(f: Derivative, t: number, y: readonly number[], h: number): number[] {
  const add = (a: readonly number[], k: readonly number[], s: number) => a.map((v, i) => v + s * (k[i] ?? 0));
  const k1 = f(t, y);
  const k2 = f(t + h / 2, add(y, k1, h / 2));
  const k3 = f(t + h / 2, add(y, k2, h / 2));
  const k4 = f(t + h, add(y, k3, h));
  return y.map((v, i) => v + (h / 6) * ((k1[i] ?? 0) + 2 * (k2[i] ?? 0) + 2 * (k3[i] ?? 0) + (k4[i] ?? 0)));
}

/* ----------------------------------------------------------- projectile -- */

export interface Launch {
  /** Launch speed, m/s. */
  readonly v0: number;
  /** Launch angle above the horizontal, degrees. */
  readonly angle: number;
  /** Launch height, m. */
  readonly h0: number;
  readonly g: number;
  /** Quadratic drag over mass, k/m = ½ρC_dA/m, per metre (0 for none). */
  readonly drag: number;
}

export interface FlightPoint {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

export interface Flight {
  readonly points: readonly FlightPoint[];
  readonly time: number;
  readonly range: number;
  readonly apex: number;
  /** Speed and angle below the horizontal at landing. */
  readonly impactSpeed: number;
  readonly impactAngle: number;
}

/** The flight to the ground (y = 0), drag or none, sampled finely enough to draw. */
export function flight(l: Launch, dt = 0.001): Flight {
  const a = (l.angle * Math.PI) / 180;
  let y = [0, l.h0, l.v0 * Math.cos(a), l.v0 * Math.sin(a)];
  const f: Derivative = (_t, s) => {
    const vx = s[2] ?? 0;
    const vy = s[3] ?? 0;
    const v = Math.hypot(vx, vy);
    return [vx, vy, -l.drag * v * vx, -l.g - l.drag * v * vy];
  };
  const points: FlightPoint[] = [];
  let t = 0;
  let apex = l.h0;
  // Long flights are sampled more coarsely (at most about 4000 steps), short ones at 1 ms.
  const vy0 = l.v0 * Math.sin(a);
  const guess = (vy0 + Math.sqrt(Math.max(0, vy0 * vy0 + 2 * l.g * l.h0))) / Math.max(l.g, 1e-9);
  const h = Math.max(dt, guess / 4000);
  const push = () => points.push({ t, x: y[0] ?? 0, y: y[1] ?? 0, vx: y[2] ?? 0, vy: y[3] ?? 0 });
  push();
  for (let i = 0; i < 2_000_000; i++) {
    const next = rk4(f, t, y, h);
    if ((next[1] ?? 0) < 0 && (next[3] ?? 0) < 0) {
      // Land exactly on y = 0 by interpolating within the step.
      const y0 = y[1] ?? 0;
      const y1 = next[1] ?? 0;
      const s = y0 / (y0 - y1 || 1);
      y = y.map((v, k) => v + ((next[k] ?? 0) - v) * s);
      t += h * s;
      y[1] = 0;
      push();
      break;
    }
    y = next;
    t += h;
    apex = Math.max(apex, y[1] ?? 0);
    push();
    if (l.v0 === 0 && l.h0 === 0) break;
  }
  const last = points[points.length - 1] ?? { t: 0, x: 0, y: 0, vx: 0, vy: 0 };
  return {
    points: thin(points, 1500),
    time: last.t,
    range: last.x,
    apex,
    impactSpeed: Math.hypot(last.vx, last.vy),
    impactAngle: (Math.atan2(-last.vy, last.vx) * 180) / Math.PI,
  };
}

/** Without air: the textbook results. */
export function idealFlight(l: Launch): { time: number; range: number; apex: number } {
  const a = (l.angle * Math.PI) / 180;
  const vx = l.v0 * Math.cos(a);
  const vy = l.v0 * Math.sin(a);
  const time = (vy + Math.sqrt(vy * vy + 2 * l.g * l.h0)) / l.g;
  return { time, range: vx * time, apex: l.h0 + (vy * vy) / (2 * l.g) };
}

/** Keeps every nth point (and the last) so a long list stays drawable. */
export function thin<T>(points: readonly T[], most: number): T[] {
  if (points.length <= most) return [...points];
  const step = Math.ceil(points.length / most);
  const out = points.filter((_, i) => i % step === 0);
  const last = points[points.length - 1];
  if (last !== undefined && out[out.length - 1] !== last) out.push(last);
  return out;
}

/* ------------------------------------------------------------- pendulum -- */

/** The complete elliptic integral of the first kind, K(k), by the arithmetic–geometric mean. */
export function ellipticK(k: number): number {
  let a = 1;
  let b = Math.sqrt(1 - k * k);
  for (let i = 0; i < 40 && Math.abs(a - b) > 1e-15 * a; i++) [a, b] = [(a + b) / 2, Math.sqrt(a * b)];
  return Math.PI / (2 * a);
}

/** The exact period of a simple pendulum swinging to `amplitude` radians either side. */
export const pendulumPeriod = (length: number, g: number, amplitude: number) => 4 * Math.sqrt(length / g) * ellipticK(Math.sin(Math.abs(amplitude) / 2));

/** θ'' = −(g/L) sin θ − b θ' for [θ, ω]. */
export const pendulum =
  (length: number, g: number, damping: number): Derivative =>
  (_t, [theta = 0, omega = 0]) => [omega, -(g / length) * Math.sin(theta) - damping * omega];

/* ----------------------------------------------------------- oscillator -- */

export interface Oscillator {
  /** Mass (kg), stiffness (N/m) and damping (N·s/m). */
  readonly m: number;
  readonly k: number;
  readonly c: number;
  /** Driving force amplitude (N) and angular frequency (rad/s). */
  readonly F0: number;
  readonly w: number;
}

export const oscillator =
  (o: Oscillator): Derivative =>
  (t, [x = 0, v = 0]) => [v, (o.F0 * Math.cos(o.w * t) - o.c * v - o.k * x) / o.m];

export function oscillatorInfo(o: Oscillator) {
  const wn = Math.sqrt(o.k / o.m);
  const zeta = o.c / (2 * Math.sqrt(o.k * o.m));
  const wd = zeta < 1 ? wn * Math.sqrt(1 - zeta * zeta) : 0;
  const r = o.w / wn;
  const ratio = 1 / Math.sqrt((1 - r * r) ** 2 + (2 * zeta * r) ** 2);
  const regime = zeta === 0 ? 'undamped' : zeta < 1 - 1e-9 ? 'underdamped' : zeta <= 1 + 1e-9 ? 'critically damped' : 'overdamped';
  return {
    wn,
    zeta,
    wd,
    regime,
    /** Steady amplitude under the drive, m, and how far it lags the force, degrees. */
    amplitude: (o.F0 / o.k) * ratio,
    lag: (Math.atan2(2 * zeta * r, 1 - r * r) * 180) / Math.PI,
    /** Amplitude over static deflection at frequency ratio r. */
    ratio,
  };
}

/** Amplitude ratio X/(F₀/k) of a driven oscillator at frequency ratio r. */
export const magnification = (r: number, zeta: number) => 1 / Math.sqrt((1 - r * r) ** 2 + (2 * zeta * r) ** 2);

/* ------------------------------------------------------------ collisions -- */

/** A head-on collision with restitution e (1 elastic, 0 sticking). */
export function collide(m1: number, u1: number, m2: number, u2: number, e: number) {
  const p = m1 * u1 + m2 * u2;
  const v1 = (p - m2 * e * (u1 - u2)) / (m1 + m2);
  const v2 = (p + m1 * e * (u1 - u2)) / (m1 + m2);
  const before = 0.5 * m1 * u1 * u1 + 0.5 * m2 * u2 * u2;
  const after = 0.5 * m1 * v1 * v1 + 0.5 * m2 * v2 * v2;
  return { v1, v2, p, pAfter: m1 * v1 + m2 * v2, before, after, lost: before - after };
}

/* ---------------------------------------------------------------- orbits -- */

/** GM of the Sun in AU³/year². */
export const MU_SUN = 4 * Math.PI * Math.PI;

export interface Body {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

/** One velocity-Verlet step about a mass at the origin (keeps energy over many orbits). */
export function orbitStep(mu: number, b: Body, dt: number): Body {
  const acc = (x: number, y: number) => {
    const r3 = Math.hypot(x, y) ** 3 || 1e-12;
    return [(-mu * x) / r3, (-mu * y) / r3] as const;
  };
  const [ax, ay] = acc(b.x, b.y);
  const x = b.x + b.vx * dt + 0.5 * ax * dt * dt;
  const y = b.y + b.vy * dt + 0.5 * ay * dt * dt;
  const [bx, by] = acc(x, y);
  return { x, y, vx: b.vx + 0.5 * (ax + bx) * dt, vy: b.vy + 0.5 * (ay + by) * dt };
}

/** Kepler's elements of the orbit through `b`. */
export function orbitElements(mu: number, b: Body) {
  const r = Math.hypot(b.x, b.y);
  const v2 = b.vx * b.vx + b.vy * b.vy;
  const energy = v2 / 2 - mu / r;
  const h = b.x * b.vy - b.y * b.vx;
  // The eccentricity vector.
  const rv = b.x * b.vx + b.y * b.vy;
  const ex = ((v2 - mu / r) * b.x - rv * b.vx) / mu;
  const ey = ((v2 - mu / r) * b.y - rv * b.vy) / mu;
  const e = Math.hypot(ex, ey);
  const bound = energy < 0;
  const a = bound ? -mu / (2 * energy) : Number.POSITIVE_INFINITY;
  return {
    energy,
    h,
    e,
    a,
    bound,
    period: bound ? 2 * Math.PI * Math.sqrt((a * a * a) / mu) : Number.POSITIVE_INFINITY,
    perihelion: (h * h) / mu / (1 + e),
    aphelion: bound ? a * (1 + e) : Number.POSITIVE_INFINITY,
    /** Direction of perihelion, radians. */
    argument: Math.atan2(ey, ex),
  };
}

/* --------------------------------------------------------------- incline -- */

export function incline(angleDeg: number, muS: number, muK: number, m: number, g: number, push = 0) {
  const a = (angleDeg * Math.PI) / 180;
  const weight = m * g;
  const along = weight * Math.sin(a);
  const normal = weight * Math.cos(a);
  // Net drive down the slope before friction (a push up the slope counts against it).
  const drive = along - push;
  const holds = Math.abs(drive) <= muS * normal + 1e-12;
  const friction = holds ? drive : Math.sign(drive) * muK * normal;
  const accel = holds ? 0 : (drive - friction) / m;
  return {
    weight,
    along,
    normal,
    drive,
    holds,
    /** Friction acting up the slope (negative: down the slope), N. */
    friction,
    /** Acceleration down the slope, m/s². */
    accel,
    critical: (Math.atan(muS) * 180) / Math.PI,
  };
}

/* ------------------------------------------------------- simple machines -- */

/** Effort to hold a lever level: positions along the beam, m; load, N. */
export function lever(fulcrum: number, load: number, effort: number, weight: number) {
  const dl = Math.abs(load - fulcrum);
  const de = Math.abs(effort - fulcrum);
  const between = (x: number, a: number, b: number) => x > Math.min(a, b) && x < Math.max(a, b);
  const kind = between(fulcrum, load, effort) ? 1 : between(load, fulcrum, effort) ? 2 : between(effort, fulcrum, load) ? 3 : 0;
  const force = de > 1e-12 ? (weight * dl) / de : Number.POSITIVE_INFINITY;
  return { kind, force, advantage: weight / force, ratio: de / (dl || Number.NaN) };
}

/** A block and tackle with `strands` ropes holding the load, at an overall efficiency (0–1). */
export function tackle(strands: number, weight: number, efficiency: number) {
  const ideal = weight / strands;
  const effort = ideal / efficiency;
  return { ideal, effort, advantage: weight / effort, idealAdvantage: strands, rope: strands };
}

/* ---------------------------------------------------------------- forces -- */

export function resultant(forces: readonly { readonly size: number; readonly angle: number }[]) {
  let x = 0;
  let y = 0;
  for (const f of forces) {
    x += f.size * Math.cos((f.angle * Math.PI) / 180);
    y += f.size * Math.sin((f.angle * Math.PI) / 180);
  }
  return { x, y, size: Math.hypot(x, y), angle: ((((Math.atan2(y, x) * 180) / Math.PI) % 360) + 360) % 360 };
}

/* ------------------------------------------------------------------ sound -- */

export const SOUND_SPEED_AIR = 343;

/** Standing-wave frequencies: a string fixed at both ends, or a pipe open at both ends or one. */
export function harmonic(kind: 'string' | 'open' | 'closed', n: number, length: number, speed: number): number {
  if (kind === 'closed') return ((2 * n - 1) * speed) / (4 * length);
  return (n * speed) / (2 * length);
}

/** Frequency heard from a source moving at `source` m/s towards an observer moving at `observer` m/s towards it. */
export const doppler = (f: number, c: number, source: number, observer: number) => (f * (c + observer)) / (c - source);

/* ------------------------------------------------------------------- gas -- */

/** A gas of equal hard disks in a box, in simulation units (mass 1, Boltzmann's constant 1). */
export interface Gas {
  readonly n: number;
  readonly r: number;
  width: number;
  readonly height: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  /** Momentum given to the walls, and the time over which it was gathered. */
  impulse: number;
  time: number;
}

/** A small, repeatable random number source (mulberry32). */
export function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Particles on a jittered grid with random directions, each at the speed for temperature kT (in 2D, ½mv² = kT on average). */
export function makeGas(n: number, width: number, height: number, r: number, kT: number, seed = 1): Gas {
  const rand = random(seed);
  const g: Gas = { n, r, width, height, x: new Float64Array(n), y: new Float64Array(n), vx: new Float64Array(n), vy: new Float64Array(n), impulse: 0, time: 0 };
  const cols = Math.ceil(Math.sqrt((n * width) / height));
  const rows = Math.ceil(n / cols);
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const row = Math.floor(i / cols);
    g.x[i] = ((c + 0.5 + (rand() - 0.5) * 0.3) * width) / cols;
    g.y[i] = ((row + 0.5 + (rand() - 0.5) * 0.3) * height) / rows;
    // Speeds drawn from the 2D Maxwell distribution: v² is exponential with mean 2kT.
    const v = Math.sqrt(-2 * kT * Math.log(1 - rand()));
    const a = 2 * Math.PI * rand();
    g.vx[i] = v * Math.cos(a);
    g.vy[i] = v * Math.sin(a);
  }
  return g;
}

/** Moves the gas on by dt: walls bounce particles (and feel the push), particles bounce off each other. */
export function stepGas(g: Gas, dt: number): void {
  const { n, r, x, y, vx, vy } = g;
  for (let i = 0; i < n; i++) {
    x[i] = (x[i] ?? 0) + (vx[i] ?? 0) * dt;
    y[i] = (y[i] ?? 0) + (vy[i] ?? 0) * dt;
    if ((x[i] ?? 0) < r) {
      x[i] = 2 * r - (x[i] ?? 0);
      g.impulse += 2 * Math.abs(vx[i] ?? 0);
      vx[i] = Math.abs(vx[i] ?? 0);
    } else if ((x[i] ?? 0) > g.width - r) {
      x[i] = 2 * (g.width - r) - (x[i] ?? 0);
      g.impulse += 2 * Math.abs(vx[i] ?? 0);
      vx[i] = -Math.abs(vx[i] ?? 0);
    }
    if ((y[i] ?? 0) < r) {
      y[i] = 2 * r - (y[i] ?? 0);
      g.impulse += 2 * Math.abs(vy[i] ?? 0);
      vy[i] = Math.abs(vy[i] ?? 0);
    } else if ((y[i] ?? 0) > g.height - r) {
      y[i] = 2 * (g.height - r) - (y[i] ?? 0);
      g.impulse += 2 * Math.abs(vy[i] ?? 0);
      vy[i] = -Math.abs(vy[i] ?? 0);
    }
  }
  // Collisions between particles, found through a grid of cells one diameter wide.
  const cell = 2 * r;
  const cols = Math.max(1, Math.ceil(g.width / cell));
  const rows = Math.max(1, Math.ceil(g.height / cell));
  const head = new Int32Array(cols * rows).fill(-1);
  const next = new Int32Array(n).fill(-1);
  const cellOf = (i: number) => Math.min(cols - 1, Math.max(0, Math.floor((x[i] ?? 0) / cell))) + cols * Math.min(rows - 1, Math.max(0, Math.floor((y[i] ?? 0) / cell)));
  for (let i = 0; i < n; i++) {
    const c = cellOf(i);
    next[i] = head[c] ?? -1;
    head[c] = i;
  }
  const d2min = 4 * r * r;
  for (let i = 0; i < n; i++) {
    const cx = Math.min(cols - 1, Math.max(0, Math.floor((x[i] ?? 0) / cell)));
    const cy = Math.min(rows - 1, Math.max(0, Math.floor((y[i] ?? 0) / cell)));
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const qx = cx + dx;
        const qy = cy + dy;
        if (qx < 0 || qy < 0 || qx >= cols || qy >= rows) continue;
        for (let j = head[qx + cols * qy] ?? -1; j >= 0; j = next[j] ?? -1) {
          if (j <= i) continue;
          const ex = (x[j] ?? 0) - (x[i] ?? 0);
          const ey = (y[j] ?? 0) - (y[i] ?? 0);
          const d2 = ex * ex + ey * ey;
          if (d2 >= d2min || d2 === 0) continue;
          const rvx = (vx[j] ?? 0) - (vx[i] ?? 0);
          const rvy = (vy[j] ?? 0) - (vy[i] ?? 0);
          const along = rvx * ex + rvy * ey;
          if (along >= 0) continue; // already moving apart
          // Equal masses: swap the velocity components along the line of centres.
          const k = along / d2;
          vx[i] = (vx[i] ?? 0) + k * ex;
          vy[i] = (vy[i] ?? 0) + k * ey;
          vx[j] = (vx[j] ?? 0) - k * ex;
          vy[j] = (vy[j] ?? 0) - k * ey;
        }
      }
  }
  g.time += dt;
}

/** Mean kinetic energy per particle (= kT in two dimensions) and pressure (force per unit length of wall). */
export function gasState(g: Gas) {
  let ke = 0;
  for (let i = 0; i < g.n; i++) ke += 0.5 * ((g.vx[i] ?? 0) ** 2 + (g.vy[i] ?? 0) ** 2);
  const kT = ke / g.n;
  // Centres stay a radius away from each wall, so that is the room they have.
  const area = (g.width - 2 * g.r) * (g.height - 2 * g.r);
  const perimeter = 2 * (g.width + g.height);
  return { kT, pressure: g.time > 0 ? g.impulse / (g.time * perimeter) : Number.NaN, ideal: (g.n * kT) / area, area };
}

/** Scales every speed so the gas sits at temperature kT. */
export function setTemperature(g: Gas, kT: number): void {
  const now = gasState(g).kT;
  if (!(now > 0)) return;
  const s = Math.sqrt(kT / now);
  for (let i = 0; i < g.n; i++) {
    g.vx[i] = (g.vx[i] ?? 0) * s;
    g.vy[i] = (g.vy[i] ?? 0) * s;
  }
}

/** Moves the right-hand wall (a piston); particles beyond it are put back inside. */
export function setWidth(g: Gas, width: number): void {
  g.width = width;
  for (let i = 0; i < g.n; i++) if ((g.x[i] ?? 0) > width - g.r) g.x[i] = width - g.r - ((i * 0.618) % 1) * Math.min(width / 2, g.r * 4);
  g.impulse = 0;
  g.time = 0;
}

/** The two-dimensional Maxwell–Boltzmann speed distribution for unit mass. */
export const maxwell2d = (v: number, kT: number) => (v / kT) * Math.exp((-v * v) / (2 * kT));

/* -------------------------------------------------------- electric field -- */

export const COULOMB = 8.9875517923e9;

export interface Charge {
  /** Position, m, and charge, nC. */
  readonly x: number;
  readonly y: number;
  readonly q: number;
}

export function fieldAt(charges: readonly Charge[], x: number, y: number): [number, number] {
  let ex = 0;
  let ey = 0;
  for (const c of charges) {
    const dx = x - c.x;
    const dy = y - c.y;
    const r2 = dx * dx + dy * dy;
    if (r2 < 1e-12) continue;
    const s = (COULOMB * c.q * 1e-9) / (r2 * Math.sqrt(r2));
    ex += s * dx;
    ey += s * dy;
  }
  return [ex, ey];
}

export function potentialAt(charges: readonly Charge[], x: number, y: number): number {
  let v = 0;
  for (const c of charges) v += (COULOMB * c.q * 1e-9) / Math.max(1e-6, Math.hypot(x - c.x, y - c.y));
  return v;
}

/**
 * Field lines leaving each positive charge (or arriving at each negative one
 * when there are no positives), traced with RK4 in steps of `step` metres
 * until they hit a charge or leave the box.
 */
export function fieldLines(charges: readonly Charge[], box: readonly [number, number, number, number], perNc = 8, step = 0.004): [number, number][][] {
  const total = charges.reduce((s, c) => s + Math.max(0, c.q), 0);
  const sources = total > 0 ? charges.filter((c) => c.q > 0) : charges.filter((c) => c.q < 0);
  const dir = total > 0 ? 1 : -1;
  const lines: [number, number][][] = [];
  const unit = (x: number, y: number): [number, number] => {
    const [ex, ey] = fieldAt(charges, x, y);
    const e = Math.hypot(ex, ey) || 1;
    return [(dir * ex) / e, (dir * ey) / e];
  };
  const [x0, y0, x1, y1] = box;
  for (const c of sources) {
    const count = Math.max(4, Math.min(32, Math.round(Math.abs(c.q) * perNc)));
    for (let k = 0; k < count; k++) {
      const a = (2 * Math.PI * (k + 0.5)) / count;
      let x = c.x + 0.012 * Math.cos(a);
      let y = c.y + 0.012 * Math.sin(a);
      const line: [number, number][] = [[c.x, c.y]];
      for (let i = 0; i < 1500; i++) {
        line.push([x, y]);
        const [k1x, k1y] = unit(x, y);
        const [k2x, k2y] = unit(x + (step / 2) * k1x, y + (step / 2) * k1y);
        const [k3x, k3y] = unit(x + (step / 2) * k2x, y + (step / 2) * k2y);
        const [k4x, k4y] = unit(x + step * k3x, y + step * k3y);
        x += (step / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
        y += (step / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);
        if (x < x0 || x > x1 || y < y0 || y > y1) break;
        const sink = charges.find((s) => s !== c && Math.hypot(x - s.x, y - s.y) < 0.01 && Math.sign(s.q) === -Math.sign(c.q));
        if (sink) {
          line.push([sink.x, sink.y]);
          break;
        }
      }
      lines.push(line);
    }
  }
  return lines;
}

/* ------------------------------------------------------------- generator -- */

/** The EMF of a coil turning in a uniform field; a split-ring commutator turns it into pulsing DC. */
export function generator(turns: number, field: number, area: number, rpm: number, t: number, commutator: boolean) {
  const w = (2 * Math.PI * rpm) / 60;
  const peak = turns * field * area * w;
  const e = peak * Math.sin(w * t);
  return { emf: commutator ? Math.abs(e) : e, peak, rms: peak / Math.SQRT2, mean: commutator ? (2 * peak) / Math.PI : 0, frequency: rpm / 60 };
}

/* ---------------------------------------------------------------- fluids -- */

/** A solid of density `rho` and volume V (m³) in a fluid of density `fluid`. */
export function buoyancy(rho: number, volume: number, fluid: number, g: number) {
  const weight = rho * volume * g;
  const fullUpthrust = fluid * volume * g;
  const floats = rho < fluid;
  return {
    weight,
    fullUpthrust,
    floats,
    /** Fraction of the volume under the surface when floating (1 when it sinks). */
    submerged: floats ? rho / fluid : 1,
    upthrust: floats ? weight : fullUpthrust,
    /** Weight it seems to have in the fluid (0 when floating). */
    apparent: floats ? 0 : weight - fullUpthrust,
  };
}

/** Flow Q (m³/s) through a Venturi from diameter d1 to d2 (m): speeds and the pressure drop (Pa) from Bernoulli. */
export function venturi(flow: number, d1: number, d2: number, rho: number, g: number) {
  const a1 = (Math.PI * d1 * d1) / 4;
  const a2 = (Math.PI * d2 * d2) / 4;
  const v1 = flow / a1;
  const v2 = flow / a2;
  const drop = 0.5 * rho * (v2 * v2 - v1 * v1);
  return { a1, a2, v1, v2, drop, head: drop / (rho * g) };
}

/* -------------------------------------------------------------- contours -- */

/**
 * Line segments where a gridded field crosses `level` (marching squares).
 * `values[j * nx + i]` sits at (x0 + i·dx, y0 + j·dy); segments come back as
 * [x1, y1, x2, y2] in the same coordinates.
 */
export function contour(values: ArrayLike<number>, nx: number, ny: number, x0: number, y0: number, dx: number, dy: number, level: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const v = (i: number, j: number) => values[j * nx + i] ?? 0;
  // Where along an edge from a to b the field crosses the level (0 to 1).
  const cut = (a: number, b: number) => (a === b ? 0.5 : (level - a) / (b - a));
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = v(i, j);
      const b = v(i + 1, j);
      const c = v(i + 1, j + 1);
      const d = v(i, j + 1);
      if (![a, b, c, d].every(Number.isFinite)) continue;
      const k = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
      if (k === 0 || k === 15) continue;
      const x = x0 + i * dx;
      const y = y0 + j * dy;
      const top: [number, number] = [x + cut(a, b) * dx, y];
      const right: [number, number] = [x + dx, y + cut(b, c) * dy];
      const bottom: [number, number] = [x + cut(d, c) * dx, y + dy];
      const left: [number, number] = [x, y + cut(a, d) * dy];
      const seg = (p: [number, number], q: [number, number]) => out.push([p[0], p[1], q[0], q[1]]);
      switch (k) {
        case 1:
        case 14:
          seg(left, top);
          break;
        case 2:
        case 13:
          seg(top, right);
          break;
        case 3:
        case 12:
          seg(left, right);
          break;
        case 4:
        case 11:
          seg(right, bottom);
          break;
        case 6:
        case 9:
          seg(top, bottom);
          break;
        case 7:
        case 8:
          seg(left, bottom);
          break;
        case 5:
          seg(left, top);
          seg(right, bottom);
          break;
        case 10:
          seg(top, right);
          seg(left, bottom);
          break;
      }
    }
  return out;
}
