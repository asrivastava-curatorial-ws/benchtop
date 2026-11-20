/**
 * A straight beam on any number of supports (pinned, roller or fixed) under
 * point loads, point moments and uniform or linearly varying distributed loads.
 *
 * Deflections come from Euler–Bernoulli beam finite elements with nodes at
 * every support and load boundary, which makes the nodal values exact; shear
 * and moment come from statics with the computed reactions.  SI units: m, N, Pa.
 *
 * Signs: loads act downwards when positive, applied moments are clockwise when
 * positive, reactions are upward forces and anticlockwise moments, bending
 * moments are positive when sagging, deflection is positive upwards.
 */

export type SupportKind = 'pin' | 'roller' | 'fixed';

export interface Support {
  readonly kind: SupportKind;
  readonly x: number;
}

export type Load =
  | { readonly kind: 'point'; readonly x: number; readonly P: number }
  | { readonly kind: 'moment'; readonly x: number; readonly M: number }
  | { readonly kind: 'distributed'; readonly x1: number; readonly x2: number; readonly w1: number; readonly w2: number };

export interface Beam {
  readonly length: number;
  /** Flexural rigidity E·I, N·m². */
  readonly EI: number;
  readonly supports: readonly Support[];
  readonly loads: readonly Load[];
}

export interface Reaction {
  readonly x: number;
  readonly kind: SupportKind;
  /** Upward force, N. */
  readonly force: number;
  /** Anticlockwise moment, N·m (fixed supports only). */
  readonly moment: number;
}

export interface Extreme {
  readonly x: number;
  readonly value: number;
}

export interface BeamResult {
  readonly reactions: readonly Reaction[];
  /** Sample points along the beam with shear (N), moment (N·m), slope (rad) and deflection (m). */
  readonly x: readonly number[];
  readonly shear: readonly number[];
  readonly moment: readonly number[];
  readonly slope: readonly number[];
  readonly deflection: readonly number[];
  readonly maxShear: Extreme;
  readonly maxMoment: Extreme;
  readonly minMoment: Extreme;
  /** Largest deflection by size (usually downwards, so negative). */
  readonly maxDeflection: Extreme;
}

export class BeamError extends RangeError {}

const EPS = 1e-12;

function check(beam: Beam): void {
  const { length: L, EI, supports, loads } = beam;
  if (!(L > 0 && Number.isFinite(L))) throw new BeamError('The span must be a length above zero.');
  if (!(EI > 0 && Number.isFinite(EI))) throw new BeamError('E and I must be above zero.');
  const inside = (x: number) => Number.isFinite(x) && x >= -EPS * L && x <= L * (1 + EPS);
  for (const s of supports) if (!inside(s.x)) throw new BeamError('Every support must be on the beam (between 0 and the span).');
  for (const load of loads) {
    if (load.kind === 'distributed') {
      if (!inside(load.x1) || !inside(load.x2) || load.x2 <= load.x1) throw new BeamError('A distributed load must start before it ends, on the beam.');
      if (!Number.isFinite(load.w1) || !Number.isFinite(load.w2)) throw new BeamError('Distributed loads need numbers.');
    } else if (!inside(load.x) || !Number.isFinite(load.kind === 'point' ? load.P : load.M)) throw new BeamError('Every load must be a number on the beam.');
  }
  const xs = supports.map((s) => s.x).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) if (Math.abs((xs[i] as number) - (xs[i - 1] as number)) < EPS * L) throw new BeamError('Two supports are at the same place.');
  // A beam needs to resist moving up and down and turning.
  const fixed = supports.some((s) => s.kind === 'fixed');
  if (!(fixed || supports.length >= 2)) throw new BeamError('The beam is not held: it needs a fixed support, or at least two supports.');
}

/** Half-bandwidth of the stiffness matrix: two DOFs per node, elements join neighbouring nodes. */
const W = 3;

/**
 * Solves K·u = F for a banded matrix stored as rows of 2W+1 entries (entry j − i + W),
 * by Gaussian elimination without pivoting (the matrix is symmetric positive definite once supported).
 */
function solveBanded(K: Float64Array[], F: Float64Array): Float64Array {
  const n = F.length;
  // A pivot that all but vanishes compared with its starting value means the system is singular.
  const start = K.map((row) => Math.abs(row[W] as number));
  for (let k = 0; k < n; k++) {
    const rowK = K[k] as Float64Array;
    const pivot = rowK[W] as number;
    if (!(Math.abs(pivot) > 1e-9 * (start[k] as number))) throw new BeamError('The beam can move without bending (a mechanism). Add or change supports.');
    for (let i = k + 1; i <= Math.min(n - 1, k + W); i++) {
      const rowI = K[i] as Float64Array;
      const factor = (rowI[k - i + W] as number) / pivot;
      if (factor === 0) continue;
      for (let j = k; j <= Math.min(n - 1, k + W); j++) rowI[j - i + W] = (rowI[j - i + W] as number) - factor * (rowK[j - k + W] as number);
      F[i] = (F[i] as number) - factor * (F[k] as number);
    }
  }
  const u = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    const row = K[i] as Float64Array;
    let sum = F[i] as number;
    for (let j = i + 1; j <= Math.min(n - 1, i + W); j++) sum -= (row[j - i + W] as number) * (u[j] as number);
    u[i] = sum / (row[W] as number);
  }
  return u;
}

/** Load intensity of a distributed load at x (downwards), with x held inside the load. */
function intensity(load: Extract<Load, { kind: 'distributed' }>, x: number): number {
  const at = Math.min(Math.max(x, load.x1), load.x2);
  return load.w1 + ((load.w2 - load.w1) * (at - load.x1)) / (load.x2 - load.x1);
}

/** Resultant and moment about x of the part of a distributed load left of x (two-point Gauss, exact for linear loads). */
function leftOf(load: Extract<Load, { kind: 'distributed' }>, x: number): [force: number, moment: number] {
  const b = Math.min(x, load.x2);
  const a = load.x1;
  if (b <= a) return [0, 0];
  const half = (b - a) / 2;
  const mid = (a + b) / 2;
  const g = half / Math.sqrt(3);
  let force = 0;
  let moment = 0;
  for (const xi of [mid - g, mid + g]) {
    const q = intensity(load, xi) * half;
    force += q;
    moment += q * (x - xi);
  }
  return [force, moment];
}

export function analyseBeam(beam: Beam, samples = 400): BeamResult {
  check(beam);
  const { length: L, EI } = beam;
  const clamp = (x: number) => Math.min(Math.max(x, 0), L);
  const supports = beam.supports.map((s) => ({ ...s, x: clamp(s.x) }));
  const loads = beam.loads.map((l) => (l.kind === 'distributed' ? { ...l, x1: clamp(l.x1), x2: clamp(l.x2) } : { ...l, x: clamp(l.x) }));

  // Nodes: every support and load boundary, then even subdivisions.
  const keys = new Set<number>([0, L, ...supports.map((s) => s.x)]);
  for (const l of loads) {
    if (l.kind === 'distributed') {
      keys.add(l.x1);
      keys.add(l.x2);
    } else keys.add(l.x);
  }
  const sorted = [...keys].sort((a, b) => a - b).filter((x, i, all) => i === 0 || x - (all[i - 1] as number) > EPS * L);
  const nodes: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i] as number;
    const b = sorted[i + 1] as number;
    const pieces = Math.max(1, Math.round(((b - a) / L) * samples));
    for (let k = 0; k < pieces; k++) nodes.push(a + ((b - a) * k) / pieces);
  }
  nodes.push(L);
  const nodeAt = (x: number) => {
    let best = 0;
    for (let i = 1; i < nodes.length; i++) if (Math.abs((nodes[i] as number) - x) < Math.abs((nodes[best] as number) - x)) best = i;
    return best;
  };

  // Assemble the banded stiffness matrix and the load vector (DOFs: v, θ per node).
  const n = nodes.length * 2;
  const K = Array.from({ length: n }, () => new Float64Array(2 * W + 1));
  const add = (i: number, j: number, value: number) => {
    const row = K[i] as Float64Array;
    row[j - i + W] = (row[j - i + W] as number) + value;
  };
  const F = new Float64Array(n);
  const elements: { i: number; l: number }[] = [];
  for (let e = 0; e < nodes.length - 1; e++) {
    const x1 = nodes[e] as number;
    const x2 = nodes[e + 1] as number;
    const l = x2 - x1;
    elements.push({ i: e, l });
    const c = EI / l ** 3;
    const k = [
      [12, 6 * l, -12, 6 * l],
      [6 * l, 4 * l * l, -6 * l, 2 * l * l],
      [-12, -6 * l, 12, -6 * l],
      [6 * l, 2 * l * l, -6 * l, 4 * l * l],
    ];
    for (let r = 0; r < 4; r++) for (let s = 0; s < 4; s++) add(2 * e + r, 2 * e + s, c * ((k[r] as number[])[s] as number));
    // Distributed loads inside this element: consistent nodal forces (exact for linear intensity).
    for (const load of loads) {
      if (load.kind !== 'distributed' || load.x2 <= x1 + EPS * L || load.x1 >= x2 - EPS * L) continue;
      const p1 = -intensity(load, x1);
      const p2 = -intensity(load, x2);
      F[2 * e] = (F[2 * e] as number) + (l * (7 * p1 + 3 * p2)) / 20;
      F[2 * e + 1] = (F[2 * e + 1] as number) + (l * l * (3 * p1 + 2 * p2)) / 60;
      F[2 * e + 2] = (F[2 * e + 2] as number) + (l * (3 * p1 + 7 * p2)) / 20;
      F[2 * e + 3] = (F[2 * e + 3] as number) - (l * l * (2 * p1 + 3 * p2)) / 60;
    }
  }
  for (const load of loads) {
    if (load.kind === 'point') F[2 * nodeAt(load.x)] = (F[2 * nodeAt(load.x)] as number) - load.P;
    if (load.kind === 'moment') F[2 * nodeAt(load.x) + 1] = (F[2 * nodeAt(load.x) + 1] as number) - load.M;
  }

  // Keep the unsupported system for the reactions, then hold the supported DOFs at zero.
  const applied = Float64Array.from(F);
  const free = K.map((row) => Float64Array.from(row));
  const fixedDofs = new Set<number>();
  for (const s of supports) {
    const node = nodeAt(s.x);
    fixedDofs.add(2 * node);
    if (s.kind === 'fixed') fixedDofs.add(2 * node + 1);
  }
  for (const dof of fixedDofs) {
    const diagonal = (K[dof] as Float64Array)[W] as number;
    for (let j = Math.max(0, dof - W); j <= Math.min(n - 1, dof + W); j++) {
      (K[dof] as Float64Array)[j - dof + W] = 0;
      (K[j] as Float64Array)[dof - j + W] = 0;
    }
    // Keep the diagonal's size so the elimination stays well scaled; F = 0 holds the DOF at zero.
    (K[dof] as Float64Array)[W] = diagonal;
    F[dof] = 0;
  }
  const u = solveBanded(K, F);

  // Reactions: K·u − F at the supported DOFs.
  const internal = (dof: number) => {
    let sum = 0;
    const row = free[dof] as Float64Array;
    for (let j = Math.max(0, dof - W); j <= Math.min(n - 1, dof + W); j++) sum += (row[j - dof + W] as number) * (u[j] as number);
    return sum - (applied[dof] as number);
  };
  const reactions: Reaction[] = supports
    .map((s) => {
      const node = nodeAt(s.x);
      return { x: s.x, kind: s.kind, force: internal(2 * node), moment: s.kind === 'fixed' ? internal(2 * node + 1) : 0 };
    })
    .sort((a, b) => a.x - b.x);

  // Shear and moment by statics, just to the right of each sample point (so jumps show at loads).
  const shearAt = (x: number, right: boolean) => {
    let V = 0;
    for (const r of reactions) if (r.x < x || (right && r.x <= x)) V += r.force;
    for (const load of loads) {
      if (load.kind === 'point' && (load.x < x || (right && load.x <= x))) V -= load.P;
      if (load.kind === 'distributed') V -= leftOf(load, x)[0];
    }
    return V;
  };
  const momentAt = (x: number, right: boolean) => {
    let M = 0;
    for (const r of reactions) {
      if (r.x < x || (right && r.x <= x)) M += r.force * (x - r.x) - r.moment;
    }
    for (const load of loads) {
      if (load.kind === 'point' && (load.x < x || (right && load.x <= x))) M -= load.P * (x - load.x);
      if (load.kind === 'moment' && (load.x < x || (right && load.x <= x))) M += load.M;
      if (load.kind === 'distributed') M -= leftOf(load, x)[1];
    }
    return M;
  };

  // Sample both sides of every key point so the diagrams show jumps.
  const xs: number[] = [];
  const shear: number[] = [];
  const moment: number[] = [];
  const slope: number[] = [];
  const deflection: number[] = [];
  nodes.forEach((x, i) => {
    const isKey = sorted.some((k) => Math.abs(k - x) <= EPS * L);
    const sides = isKey && i > 0 && i < nodes.length - 1 ? [false, true] : [i === 0];
    for (const right of sides) {
      xs.push(x);
      shear.push(i === nodes.length - 1 ? shearAt(x, false) : shearAt(x, right));
      moment.push(i === nodes.length - 1 ? momentAt(x, false) : momentAt(x, right));
      slope.push(u[2 * i + 1] as number);
      deflection.push(u[2 * i] as number);
    }
  });

  const extreme = (values: readonly number[], pick: (a: number, b: number) => boolean): Extreme => {
    let best = 0;
    values.forEach((v, i) => {
      if (pick(v, values[best] as number)) best = i;
    });
    return { x: xs[best] as number, value: values[best] as number };
  };

  // Deflection extreme: refine inside the elements next to the largest nodal value with the cubic shape functions.
  let maxDeflection = extreme(deflection, (a, b) => Math.abs(a) > Math.abs(b));
  for (const { i, l } of elements) {
    const v1 = u[2 * i] as number;
    const t1 = u[2 * i + 1] as number;
    const v2 = u[2 * i + 2] as number;
    const t2 = u[2 * i + 3] as number;
    if (Math.max(Math.abs(v1), Math.abs(v2)) < Math.abs(maxDeflection.value) * 0.98) continue;
    for (let k = 1; k < 20; k++) {
      const s = k / 20;
      const v = v1 * (1 - 3 * s * s + 2 * s ** 3) + t1 * l * (s - 2 * s * s + s ** 3) + v2 * (3 * s * s - 2 * s ** 3) + t2 * l * (-s * s + s ** 3);
      if (Math.abs(v) > Math.abs(maxDeflection.value)) maxDeflection = { x: (nodes[i] as number) + s * l, value: v };
    }
  }

  return {
    reactions,
    x: xs,
    shear,
    moment,
    slope,
    deflection,
    maxShear: extreme(shear, (a, b) => Math.abs(a) > Math.abs(b)),
    maxMoment: extreme(moment, (a, b) => a > b),
    minMoment: extreme(moment, (a, b) => a < b),
    maxDeflection,
  };
}
