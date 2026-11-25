/**
 * A transient circuit solver by modified nodal analysis: each time step the
 * elements stamp conductances, currents and voltage sources into a matrix,
 * Newton iterations settle the non-linear ones (diodes, transistors, op-amp
 * limits), and backward Euler integrates capacitors and inductors.  Digital
 * parts read their inputs from the previous step and drive their outputs
 * through a small resistance, which also gives them a one-step delay.
 */

export interface Stamp {
  /** Conductance between two nodes (0 is ground). */
  conductance(a: number, b: number, g: number): void;
  /** A current of `i` amperes flowing out of node `from` and into node `to` through the element. */
  current(from: number, to: number, i: number): void;
  /** Voltage source number `k` (0-based within the element) holding v(pos) − v(neg) = volts. */
  source(element: Element, k: number, pos: number, neg: number, volts: number): void;
  /** Raw access for controlled sources: adds to the matrix at (row, column) using node numbers or source rows. */
  matrix(row: number, column: number, value: number): void;
  rhs(row: number, value: number): void;
  /** The matrix row of a node (−1 for ground) or of an element's voltage source. */
  nodeRow(node: number): number;
  sourceRow(element: Element, k: number): number;
}

export interface Context {
  readonly t: number;
  readonly dt: number;
  /** Solving for the DC operating point: sources take their DC values (capacitors open and inductors short through a very long time step). */
  readonly dc?: boolean;
  /** Source stepping while the operating point is found: independent sources are scaled by this (1 normally). */
  readonly ramp?: number;
  /** Voltage of a node in the latest iteration (ground is 0). */
  v(node: number): number;
  /** Voltage of a node at the end of the previous step. */
  previous(node: number): number;
  /** Current through an element's voltage source k (from the latest iteration). */
  sourceCurrent(element: Element, k: number): number;
}

export interface Element {
  /** Node numbers of the terminals, set when the circuit is built. */
  nodes: number[];
  /** How many voltage sources (extra matrix rows) the element needs. */
  readonly sources?: number;
  /** First source row index, set by the circuit. */
  sourceBase?: number;
  readonly nonlinear?: boolean;
  /** Before the Newton iterations of a step: read inputs, update digital state. */
  begin?(ctx: Context): void;
  stamp(s: Stamp, ctx: Context): void;
  /** After a step has converged: keep history (capacitor voltage, inductor current), measure. */
  end?(ctx: Context): void;
  /** The current into terminal 0, for display, in amperes. */
  current?(ctx: Context): number;
  /** Whether the latest Newton step moved this element's operating point too much to stop. */
  converged?(ctx: Context): boolean;
  /**
   * Small-signal stamp for frequency analysis, for elements whose stamp is not
   * conductance plus capacitance (conductance + C/dt): adds admittances at
   * angular frequency ω.  Elements without it are measured from their stamp.
   */
  ac?(s: AcStamp, omega: number, ctx: Context): void;
}

/** A complex matrix for frequency analysis. */
export interface AcStamp {
  add(row: number, column: number, re: number, im: number): void;
  nodeRow(node: number): number;
  sourceRow(element: Element, k: number): number;
}

/** Dense LU solve with partial pivoting; A is overwritten.  Returns false for a singular matrix. */
export function solve(A: Float64Array, b: Float64Array, n: number, pivots: Int32Array): boolean {
  for (let k = 0; k < n; k++) {
    let best = k;
    let max = Math.abs(A[k * n + k] as number);
    for (let r = k + 1; r < n; r++) {
      const v = Math.abs(A[r * n + k] as number);
      if (v > max) {
        max = v;
        best = r;
      }
    }
    if (max < 1e-30) return false;
    pivots[k] = best;
    if (best !== k) {
      for (let c = 0; c < n; c++) {
        const t = A[k * n + c] as number;
        A[k * n + c] = A[best * n + c] as number;
        A[best * n + c] = t;
      }
      const t = b[k] as number;
      b[k] = b[best] as number;
      b[best] = t;
    }
    const pivot = A[k * n + k] as number;
    for (let r = k + 1; r < n; r++) {
      const f = (A[r * n + k] as number) / pivot;
      if (f === 0) continue;
      A[r * n + k] = 0;
      for (let c = k + 1; c < n; c++) A[r * n + c] = (A[r * n + c] as number) - f * (A[k * n + c] as number);
      b[r] = (b[r] as number) - f * (b[k] as number);
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r] as number;
    for (let c = r + 1; c < n; c++) sum -= (A[r * n + c] as number) * (b[c] as number);
    b[r] = sum / (A[r * n + r] as number);
  }
  return true;
}

/**
 * The stamping helpers in terms of raw matrix and right-hand-side access,
 * shared by the solver and by the analyses that record what parts stamp.
 */
export abstract class Stamper implements Stamp {
  abstract matrix(row: number, column: number, value: number): void;
  abstract rhs(row: number, value: number): void;
  abstract sourceRow(element: Element, k: number): number;
  nodeRow(node: number): number {
    return node - 1;
  }
  conductance(a: number, b: number, g: number): void {
    const ra = a - 1;
    const rb = b - 1;
    this.matrix(ra, ra, g);
    this.matrix(rb, rb, g);
    this.matrix(ra, rb, -g);
    this.matrix(rb, ra, -g);
  }
  current(from: number, to: number, i: number): void {
    this.rhs(from - 1, -i);
    this.rhs(to - 1, i);
  }
  source(element: Element, k: number, pos: number, neg: number, volts: number): void {
    const row = this.sourceRow(element, k);
    this.matrix(row, pos - 1, 1);
    this.matrix(row, neg - 1, -1);
    this.matrix(pos - 1, row, 1);
    this.matrix(neg - 1, row, -1);
    this.rhs(row, volts);
  }
}

export interface StepResult {
  /** False when the matrix is singular (a step that did not settle still counts, with a warning in `trouble`). */
  readonly ok: boolean;
  readonly iterations: number;
  /** Whether Newton's method converged. */
  readonly settled?: boolean;
}

/** Leakage from every node to ground, so floating nodes (unconnected inputs) still solve. */
export const GMIN = 1e-9;

/** The time step that turns capacitors into open circuits and inductors into shorts for the DC operating point. */
export const DC_STEP = 1e9;

export class Circuit extends Stamper implements Context {
  t = 0;
  dt: number;
  dc = false;
  ramp = 1;
  /** Leakage to ground from every node (the analyses use less than the live simulation). */
  gmin = GMIN;
  readonly nodeCount: number;
  readonly elements: Element[];
  private readonly size: number;
  private readonly sourceCount: number;
  private A: Float64Array;
  private b: Float64Array;
  private readonly pivots: Int32Array;
  /** Latest solution: node voltages (rows 0…nodeCount−1 for nodes 1…n) then source currents. */
  x: Float64Array;
  private last: Float64Array;
  private readonly iterate: Float64Array;
  /** Set when a step fails to converge; the solver then shortens its iterations' moves. */
  trouble = '';
  readonly nonlinear: boolean;

  constructor(nodeCount: number, elements: Element[], dt: number) {
    super();
    this.nodeCount = nodeCount;
    this.elements = elements;
    this.dt = dt;
    let rows = 0;
    for (const e of elements) {
      if (e.sources) {
        e.sourceBase = rows;
        rows += e.sources;
      }
    }
    this.sourceCount = rows;
    this.size = nodeCount + rows;
    this.A = new Float64Array(this.size * this.size);
    this.b = new Float64Array(this.size);
    this.pivots = new Int32Array(this.size);
    this.x = new Float64Array(this.size);
    this.last = new Float64Array(this.size);
    this.iterate = new Float64Array(this.size);
    this.nonlinear = elements.some((e) => e.nonlinear);
  }

  /* Stamp */
  sourceRow(element: Element, k: number): number {
    return this.nodeCount + (element.sourceBase ?? 0) + k;
  }
  matrix(row: number, column: number, value: number): void {
    if (row < 0 || column < 0) return;
    this.A[row * this.size + column] = (this.A[row * this.size + column] as number) + value;
  }
  rhs(row: number, value: number): void {
    if (row < 0) return;
    this.b[row] = (this.b[row] as number) + value;
  }

  /* Context */
  v(node: number): number {
    return node <= 0 ? 0 : (this.x[node - 1] as number);
  }
  previous(node: number): number {
    return node <= 0 ? 0 : (this.last[node - 1] as number);
  }
  sourceCurrent(element: Element, k: number): number {
    return this.x[this.sourceRow(element, k)] as number;
  }

  /**
   * Advances one time step; `ok` is false when the matrix is singular.
   * `observe` runs once the step has converged, before the parts keep their
   * history (the analyses measure currents there).
   */
  step(observe?: () => void): StepResult {
    this.last.set(this.x);
    this.t += this.dt;
    for (const e of this.elements) e.begin?.(this);
    const result = this.newton(this.nonlinear ? 60 : 1);
    observe?.();
    for (const e of this.elements) e.end?.(this);
    return result;
  }

  private newton(limit: number): StepResult {
    let iterations = 0;
    let ok = true;
    for (; iterations < limit; iterations++) {
      this.A.fill(0);
      this.b.fill(0);
      for (let r = 0; r < this.nodeCount; r++) this.A[r * this.size + r] = this.gmin;
      for (const e of this.elements) e.stamp(this, this);
      const previous = this.iterate;
      previous.set(this.x);
      if (!solve(this.A, this.b, this.size, this.pivots)) {
        this.trouble = 'The circuit cannot be solved: look for a loop of voltage sources or wires, or a source shorted by a wire.';
        this.x.set(previous);
        ok = false;
        break;
      }
      this.x.set(this.b);
      if (!this.nonlinear) break;
      let settled = true;
      for (let r = 0; r < this.size && settled; r++) {
        const a = this.x[r] as number;
        const p = previous[r] as number;
        if (!Number.isFinite(a)) {
          settled = false;
          break;
        }
        if (Math.abs(a - p) > 1e-6 + 1e-4 * Math.abs(a)) settled = false;
      }
      if (settled) for (const e of this.elements) if (e.converged && !e.converged(this)) settled = false;
      if (settled && iterations > 0) break;
    }
    const unsettled = ok && iterations >= limit;
    if (unsettled) this.trouble = 'The simulation did not settle; a smaller time step may help.';
    else if (ok) this.trouble = '';
    for (let r = 0; r < this.size; r++) if (!Number.isFinite(this.x[r] as number)) this.x[r] = 0;
    return { ok, iterations: Math.min(iterations + 1, limit), settled: ok && !unsettled };
  }

  /**
   * Finds the DC operating point at the present time: capacitors open,
   * inductors shorted, sources at their DC values.  Logic and relays settle
   * over a few rounds.  If Newton's method cannot find it from zero, the
   * sources are raised in steps.  The parts keep the result as their state,
   * so a time-domain run can start from it.
   */
  operatingPoint(): StepResult {
    const dt = this.dt;
    this.dc = true;
    this.dt = DC_STEP;
    let result: StepResult = { ok: true, iterations: 0 };
    let iterations = 0;
    try {
      for (let round = 0; round < 40; round++) {
        this.last.set(this.x);
        for (const e of this.elements) e.begin?.(this);
        result = this.newton(this.nonlinear ? 150 : 1);
        if (result.ok && !result.settled) result = this.stepSources();
        iterations += result.iterations;
        if (!result.ok || !result.settled) break;
        for (const e of this.elements) e.end?.(this);
        let same = round > 0;
        for (let r = 0; r < this.size && same; r++) {
          const a = this.x[r] as number;
          if (Math.abs(a - (this.last[r] as number)) > 1e-6 + 1e-4 * Math.abs(a)) same = false;
        }
        if (same) break;
      }
    } finally {
      this.dt = dt;
      this.dc = false;
      this.ramp = 1;
    }
    if (result.ok && result.settled) this.trouble = '';
    else if (result.ok) this.trouble = 'No DC operating point was found: the circuit may oscillate, or a part may be driven far outside its range.';
    return { ok: result.ok, iterations, settled: result.ok && result.settled === true };
  }

  /** Source stepping: the sources rise from a tenth to full in steps, each solve starting from the last. */
  private stepSources(): StepResult {
    this.x.fill(0);
    let iterations = 0;
    for (let k = 1; k <= 20; k++) {
      this.ramp = k / 20;
      const r = this.newton(200);
      iterations += r.iterations;
      if (!r.ok || !r.settled) return { ...r, iterations };
    }
    return { ok: true, iterations, settled: true };
  }

  /** The solver matrix size: nodes (less ground) plus voltage-source rows. */
  get rows(): number {
    return this.size;
  }

  get sources(): number {
    return this.sourceCount;
  }
}

/* --------------------------------------------- helpers for non-linear parts -- */

/** Thermal voltage at 27 °C. */
export const VT = 0.025852;

/** SPICE's pn-junction limiting: keeps exponential parts from overflowing between iterations. */
export function limitJunction(vNew: number, vOld: number, nVt: number, vCrit: number): number {
  if (vNew > vCrit && Math.abs(vNew - vOld) > 2 * nVt) {
    if (vOld > 0) {
      const arg = 1 + (vNew - vOld) / nVt;
      return arg > 0 ? vOld + nVt * Math.log(arg) : vCrit;
    }
    return nVt * Math.log(vNew / nVt);
  }
  return vNew;
}

/**
 * Stamps a linearised multi-terminal device: currents I_k flowing into the
 * device at each terminal, with Jacobian J[k][j] = ∂I_k/∂V_j, at voltages V0.
 */
export function stampDevice(s: Stamp, nodes: readonly number[], currents: readonly number[], jacobian: readonly (readonly number[])[], v0: readonly number[]): void {
  for (let k = 0; k < nodes.length; k++) {
    const row = s.nodeRow(nodes[k] as number);
    let equivalent = currents[k] as number;
    for (let j = 0; j < nodes.length; j++) {
      const g = (jacobian[k] as readonly number[])[j] as number;
      equivalent -= g * (v0[j] as number);
      s.matrix(row, s.nodeRow(nodes[j] as number), g);
    }
    s.rhs(row, -equivalent);
  }
}
