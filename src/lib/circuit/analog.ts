/**
 * Analog parts for circuit analysis: the four controlled sources, a
 * transformer (coupled inductors), JFETs, a comparator, a three-terminal
 * regulator and a Laplace transfer-function block.
 */
import { Diode, Mosfet } from './elements';
import type { AcStamp, Context, Element, Stamp } from './engine';
import { evaluate, type Rational, type StateSpace, solveSmall, stateSpace } from './laplace';

/** Adds `value` at (row, column) when both are in the matrix. */
const put = (s: Stamp, row: number, column: number, value: number) => s.matrix(row, column, value);

/* ------------------------------------------------------- controlled sources -- */

/** Voltage-controlled voltage source: v(out+) − v(out−) = gain·(v(in+) − v(in−)).  Terminals out+, out−, in+, in−. */
export class Vcvs implements Element {
  nodes = [0, 0, 0, 0];
  readonly sources = 1;
  sourceBase?: number;
  constructor(public gain: number) {}
  stamp(s: Stamp): void {
    const [op, on, ip, im] = this.nodes as [number, number, number, number];
    const row = s.sourceRow(this, 0);
    put(s, s.nodeRow(op), row, 1);
    put(s, s.nodeRow(on), row, -1);
    put(s, row, s.nodeRow(op), 1);
    put(s, row, s.nodeRow(on), -1);
    put(s, row, s.nodeRow(ip), -this.gain);
    put(s, row, s.nodeRow(im), this.gain);
  }
  current(ctx: Context): number {
    return -ctx.sourceCurrent(this, 0);
  }
}

/** Voltage-controlled current source: gm·(v(in+) − v(in−)) flows out of out+ into the circuit and back in at out−. */
export class Vccs implements Element {
  nodes = [0, 0, 0, 0];
  constructor(public transconductance: number) {}
  stamp(s: Stamp): void {
    const [op, on, ip, im] = this.nodes as [number, number, number, number];
    const g = this.transconductance;
    put(s, s.nodeRow(op), s.nodeRow(ip), -g);
    put(s, s.nodeRow(op), s.nodeRow(im), g);
    put(s, s.nodeRow(on), s.nodeRow(ip), g);
    put(s, s.nodeRow(on), s.nodeRow(im), -g);
  }
  current(ctx: Context): number {
    return this.transconductance * (ctx.v(this.nodes[2] as number) - ctx.v(this.nodes[3] as number));
  }
}

/** A zero-volt sensing branch from sense+ to sense− on source row 0: its current is the controlling current. */
function stampSense(s: Stamp, element: Element, plus: number, minus: number): number {
  s.source(element, 0, plus, minus, 0);
  return s.sourceRow(element, 0);
}

/** Current-controlled voltage source: v(out+) − v(out−) = r·i, where i flows in at sense+ and out at sense−. */
export class Ccvs implements Element {
  nodes = [0, 0, 0, 0];
  readonly sources = 2;
  sourceBase?: number;
  constructor(public transresistance: number) {}
  stamp(s: Stamp): void {
    const [op, on, sp, sm] = this.nodes as [number, number, number, number];
    const sense = stampSense(s, this, sp, sm);
    const row = s.sourceRow(this, 1);
    put(s, s.nodeRow(op), row, 1);
    put(s, s.nodeRow(on), row, -1);
    put(s, row, s.nodeRow(op), 1);
    put(s, row, s.nodeRow(on), -1);
    put(s, row, sense, -this.transresistance);
  }
  current(ctx: Context): number {
    return -ctx.sourceCurrent(this, 1);
  }
}

/** Current-controlled current source: gain·i flows out of out+ into the circuit, where i flows in at sense+ and out at sense−. */
export class Cccs implements Element {
  nodes = [0, 0, 0, 0];
  readonly sources = 1;
  sourceBase?: number;
  constructor(public gain: number) {}
  stamp(s: Stamp): void {
    const [op, on, sp, sm] = this.nodes as [number, number, number, number];
    const sense = stampSense(s, this, sp, sm);
    put(s, s.nodeRow(op), sense, -this.gain);
    put(s, s.nodeRow(on), sense, this.gain);
  }
  current(ctx: Context): number {
    return this.gain * ctx.sourceCurrent(this, 0);
  }
}

/* ------------------------------------------------------------- transformer -- */

/**
 * A transformer as two coupled windings: primary inductance Lp, turns
 * ratio n = Np/Ns (so Ls = Lp/n²), coupling k and winding resistances.
 * Terminals P1, P2, S1, S2; the dots are at P1 and S1.
 */
export class Transformer implements Element {
  nodes = [0, 0, 0, 0];
  readonly sources = 2;
  sourceBase?: number;
  private ip = 0;
  private is = 0;
  constructor(
    public primary: number,
    public ratio: number,
    public coupling = 0.999,
    public rPrimary = 0,
    public rSecondary = 0,
  ) {}
  private get inductances(): [number, number, number] {
    const lp = Math.max(this.primary, 1e-12);
    const n = Math.max(Math.abs(this.ratio), 1e-6);
    const ls = lp / (n * n);
    const k = Math.min(Math.max(this.coupling, 0), 0.99999);
    return [lp, ls, k * Math.sqrt(lp * ls)];
  }
  stamp(s: Stamp, ctx: Context): void {
    const [p1, p2, s1, s2] = this.nodes as [number, number, number, number];
    const [lp, ls, m] = this.inductances;
    const rp = s.sourceRow(this, 0);
    const rs = s.sourceRow(this, 1);
    const dt = ctx.dt;
    put(s, s.nodeRow(p1), rp, 1);
    put(s, s.nodeRow(p2), rp, -1);
    put(s, s.nodeRow(s1), rs, 1);
    put(s, s.nodeRow(s2), rs, -1);
    // v_p = Rp·ip + (Lp·(ip − ip₀) + M·(is − is₀))/dt, and likewise for the secondary.
    put(s, rp, s.nodeRow(p1), 1);
    put(s, rp, s.nodeRow(p2), -1);
    put(s, rp, rp, -(this.rPrimary + lp / dt));
    put(s, rp, rs, -m / dt);
    s.rhs(rp, -(lp * this.ip + m * this.is) / dt);
    put(s, rs, s.nodeRow(s1), 1);
    put(s, rs, s.nodeRow(s2), -1);
    put(s, rs, rp, -m / dt);
    put(s, rs, rs, -(this.rSecondary + ls / dt));
    s.rhs(rs, -(m * this.ip + ls * this.is) / dt);
  }
  end(ctx: Context): void {
    this.ip = ctx.sourceCurrent(this, 0);
    this.is = ctx.sourceCurrent(this, 1);
  }
  current(ctx: Context): number {
    return ctx.sourceCurrent(this, 0);
  }
}

/* ------------------------------------------------------------------- JFETs -- */

/**
 * A JFET (Shichman–Hodges): Id = β·(Vgs − Vp)²·(1 + λ·Vds) when on, with
 * the gate's junctions to source and drain as diodes.  Terminals drain,
 * gate, source.  `pinchOff` is the magnitude of the pinch-off voltage.
 */
export class Jfet implements Element {
  nodes = [0, 0, 0];
  readonly nonlinear = true;
  private readonly channel: Mosfet;
  private readonly gateSource: Diode;
  private readonly gateDrain: Diode;
  constructor(
    public pChannel: boolean,
    pinchOff = 2,
    beta = 1.3e-3,
    lambda = 0.0023,
  ) {
    this.channel = new Mosfet(pChannel, -Math.abs(pinchOff), 2 * beta, lambda);
    const junction = { is: 1e-14, n: 1 };
    this.gateSource = new Diode(junction);
    this.gateDrain = new Diode(junction);
  }
  private wire(): void {
    const [d, g, s] = this.nodes as [number, number, number];
    this.channel.nodes = [d, g, s];
    this.gateSource.nodes = this.pChannel ? [s, g] : [g, s];
    this.gateDrain.nodes = this.pChannel ? [d, g] : [g, d];
  }
  stamp(s: Stamp, ctx: Context): void {
    this.wire();
    this.channel.stamp(s, ctx);
    this.gateSource.stamp(s, ctx);
    this.gateDrain.stamp(s, ctx);
  }
  converged(ctx: Context): boolean {
    return this.channel.converged(ctx) && this.gateSource.converged(ctx) && this.gateDrain.converged(ctx);
  }
  end(ctx: Context): void {
    this.gateSource.end(ctx);
    this.gateDrain.end(ctx);
  }
  /** Drain current (into the drain), from the channel alone. */
  current(): number {
    return this.channel.drain;
  }
}

/* -------------------------------------------------------------- comparator -- */

/**
 * A comparator: the output switches when v(+) − v(−) passes the threshold
 * (with optional hysteresis), deciding from the previous step like the
 * logic parts.  Push-pull outputs drive the high or low level through
 * 10 Ω; open-collector outputs only pull low.  Referenced to ground.
 */
export class Comparator implements Element {
  nodes = [0, 0, 0];
  high = false;
  constructor(
    public highLevel = 5,
    public lowLevel = 0,
    public openCollector = false,
    public hysteresis = 0,
  ) {}
  begin(ctx: Context): void {
    const vd = ctx.previous(this.nodes[0] as number) - ctx.previous(this.nodes[1] as number);
    const h = Math.max(0, this.hysteresis) / 2;
    this.high = this.high ? vd > -h : vd > h;
  }
  stamp(s: Stamp): void {
    const out = this.nodes[2] as number;
    const g = 1 / 10;
    if (this.openCollector) {
      if (this.high) s.conductance(out, 0, 1e-9);
      else {
        s.conductance(out, 0, g);
        s.current(0, out, g * this.lowLevel);
      }
      return;
    }
    s.conductance(out, 0, g);
    s.current(0, out, g * (this.high ? this.highLevel : this.lowLevel));
  }
}

/* --------------------------------------------------------------- regulator -- */

/**
 * min(a, b) with the corner rounded over ±w (a quadratic blend, exact
 * outside it), and its slope with respect to b.
 */
function softMin(a: number, b: number, w: number): [number, number] {
  if (b <= a - w) return [b, 1];
  if (b >= a + w) return [a, 0];
  const d = b - a + w;
  return [b - (d * d) / (4 * w), 1 - d / (2 * w)];
}

/** max(y, 0) with the corner rounded over ±w (exactly 0 below −w), and its slope. */
function softPositive(y: number, w: number): [number, number] {
  if (y <= -w) return [0, 0];
  if (y >= w) return [y, 1];
  return [((y + w) * (y + w)) / (4 * w), (y + w) / (2 * w)];
}

/**
 * A three-terminal linear regulator (7805 style): the output holds its
 * voltage above GND while the input stays a dropout above it, and follows
 * the input below that.  The output current comes in at IN; a small
 * quiescent current flows from IN to GND.  Terminals IN, GND, OUT.
 */
export class Regulator implements Element {
  nodes = [0, 0, 0];
  readonly sources = 1;
  sourceBase?: number;
  readonly nonlinear = true;
  private x = 0;
  constructor(
    public volts = 5,
    public dropout = 2,
    public quiescent = 0.005,
  ) {}
  /** The output voltage for an input of x volts above GND, and its slope. */
  private transfer(x: number): [number, number] {
    const w = 0.05;
    const [m, dm] = softMin(this.volts, x - this.dropout, w);
    const [y, dy] = softPositive(m, w);
    return [y, dm * dy];
  }
  stamp(s: Stamp, ctx: Context): void {
    const [vin, gnd, out] = this.nodes as [number, number, number];
    let x = ctx.v(vin) - ctx.v(gnd);
    // Keep Newton's steps moderate.
    x = this.x + Math.max(-5, Math.min(5, x - this.x));
    this.x = x;
    const [f, slope] = this.transfer(x);
    const row = s.sourceRow(this, 0);
    put(s, s.nodeRow(vin), row, 1);
    put(s, s.nodeRow(out), row, -1);
    // v(out) − v(gnd) − slope·(v(in) − v(gnd)) = f − slope·x
    put(s, row, s.nodeRow(out), 1);
    put(s, row, s.nodeRow(gnd), -1 + slope);
    put(s, row, s.nodeRow(vin), -slope);
    s.rhs(row, f - slope * x);
    // Quiescent current: Iq·x/√(x² + 0.25), from IN to GND.
    const q = this.quiescent;
    const r = Math.sqrt(x * x + 0.25);
    const iq = (q * x) / r;
    const gq = (q * 0.25) / (r * r * r) + 1e-12;
    s.conductance(vin, gnd, gq);
    s.current(vin, gnd, iq - gq * x);
  }
  converged(ctx: Context): boolean {
    const x = ctx.v(this.nodes[0] as number) - ctx.v(this.nodes[1] as number);
    return Math.abs(x - this.x) < 1e-5 + 1e-4 * Math.abs(x);
  }
  /** Current out of OUT into the circuit. */
  current(ctx: Context): number {
    return ctx.sourceCurrent(this, 0);
  }
}

/* ------------------------------------------------------------ Laplace block -- */

/**
 * A transfer function H(s) from the voltage at IN to the voltage at OUT
 * (both measured from ground): exact in frequency analysis, and in the time
 * domain a state-space model stepped by backward Euler.  IN draws no
 * current.
 */
export class LaplaceBlock implements Element {
  nodes = [0, 0];
  readonly sources = 1;
  sourceBase?: number;
  private readonly model: StateSpace;
  private state: Float64Array;
  private cachedDt = Number.NaN;
  /** (I − dt·A)⁻¹ as columns, and the gains derived from it for the cached step. */
  private inverse = new Float64Array(0);
  private gain = 0;
  constructor(public readonly h: Rational) {
    this.model = stateSpace(h);
    this.state = new Float64Array(this.model.order);
  }
  private prepare(dt: number): void {
    if (dt === this.cachedDt) return;
    const { order: n, a, c, d } = this.model;
    this.inverse = new Float64Array(n * n);
    for (let col = 0; col < n; col++) {
      const m = new Float64Array(n * n);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) m[i * n + j] = (i === j ? 1 : 0) - dt * (a[i * n + j] as number);
      const e = new Float64Array(n);
      e[col] = 1;
      solveSmall(m, e, n);
      for (let i = 0; i < n; i++) this.inverse[i * n + col] = e[i] as number;
    }
    // y = C·M·(x + dt·B·u) + D·u, with B the last unit vector.
    let k = d;
    for (let i = 0; i < n; i++) k += (c[i] as number) * dt * (this.inverse[i * n + n - 1] as number);
    this.gain = k;
    this.cachedDt = dt;
  }
  /** C·M·x for the present state. */
  private carried(): number {
    const { order: n, c } = this.model;
    let y = 0;
    for (let i = 0; i < n; i++) {
      let mx = 0;
      for (let j = 0; j < n; j++) mx += (this.inverse[i * n + j] as number) * (this.state[j] as number);
      y += (c[i] as number) * mx;
    }
    return y;
  }
  stamp(s: Stamp, ctx: Context): void {
    const [vin, out] = this.nodes as [number, number];
    this.prepare(ctx.dt);
    const row = s.sourceRow(this, 0);
    put(s, s.nodeRow(out), row, 1);
    put(s, row, s.nodeRow(out), 1);
    put(s, row, s.nodeRow(vin), -this.gain);
    s.rhs(row, this.carried());
  }
  end(ctx: Context): void {
    const { order: n } = this.model;
    if (!n) return;
    this.prepare(ctx.dt);
    const u = ctx.v(this.nodes[0] as number);
    const next = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) sum += (this.inverse[i * n + j] as number) * ((this.state[j] as number) + (j === n - 1 ? ctx.dt * u : 0));
      next[i] = sum;
    }
    this.state = next;
  }
  ac(s: AcStamp, omega: number): void {
    const [vin, out] = this.nodes as [number, number];
    const row = s.sourceRow(this, 0);
    const [re, im] = evaluate(this.h, omega);
    s.add(s.nodeRow(out), row, 1, 0);
    s.add(row, s.nodeRow(out), 1, 0);
    s.add(row, s.nodeRow(vin), -re, -im);
  }
  current(ctx: Context): number {
    return -ctx.sourceCurrent(this, 0);
  }
}
