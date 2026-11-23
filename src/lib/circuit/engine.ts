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

export interface StepResult {
  readonly ok: boolean;
  readonly iterations: number;
}

/** Leakage from every node to ground, so floating nodes (unconnected inputs) still solve. */
const GMIN = 1e-9;

export class Circuit implements Stamp, Context {
  t = 0;
  dt: number;
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
  nodeRow(node: number): number {
    return node - 1;
  }
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

  /** Advances one time step.  Returns false when the matrix is singular or Newton fails. */
  step(): StepResult {
    this.last.set(this.x);
    this.t += this.dt;
    for (const e of this.elements) e.begin?.(this);
    const limit = this.nonlinear ? 60 : 1;
    let iterations = 0;
    let ok = true;
    for (; iterations < limit; iterations++) {
      this.A.fill(0);
      this.b.fill(0);
      for (let r = 0; r < this.nodeCount; r++) this.A[r * this.size + r] = GMIN;
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
    if (ok && iterations >= limit) this.trouble = 'The simulation did not settle; a smaller time step may help.';
    else if (ok) this.trouble = '';
    for (let r = 0; r < this.size; r++) if (!Number.isFinite(this.x[r] as number)) this.x[r] = 0;
    for (const e of this.elements) e.end?.(this);
    return { ok, iterations: iterations + 1 };
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
