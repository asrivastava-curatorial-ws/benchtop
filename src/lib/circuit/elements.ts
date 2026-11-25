/**
 * Element models for the circuit solver: passive parts, sources, switches,
 * diodes and LEDs, bipolar and MOS transistors, op-amps, the 555 timer,
 * logic gates, flip-flops, counters, decoders, displays, relays and meters.
 */
import { type AcStamp, type Context, type Element, limitJunction, type Stamp, stampDevice, VT } from './engine';

const exp = (x: number) => Math.exp(Math.min(x, 80));

/** Exponential moving average used for brightness and speed displays (time constant τ seconds). */
function smooth(previous: number, value: number, dt: number, tau = 0.02): number {
  const a = Math.min(1, dt / tau);
  return previous + (value - previous) * a;
}

/* ---------------------------------------------------------------- passive -- */

export class Resistor implements Element {
  nodes = [0, 0];
  constructor(public resistance: number) {}
  stamp(s: Stamp): void {
    s.conductance(this.nodes[0] as number, this.nodes[1] as number, 1 / Math.max(this.resistance, 1e-6));
  }
  current(ctx: Context): number {
    return (ctx.v(this.nodes[0] as number) - ctx.v(this.nodes[1] as number)) / Math.max(this.resistance, 1e-6);
  }
}

export class Capacitor implements Element {
  nodes = [0, 0];
  private voltage = 0;
  private flowing = 0;
  constructor(public capacitance: number) {}
  stamp(s: Stamp, ctx: Context): void {
    const g = this.capacitance / ctx.dt;
    const [a, b] = this.nodes as [number, number];
    s.conductance(a, b, g);
    s.current(b, a, g * this.voltage);
  }
  end(ctx: Context): void {
    const v = ctx.v(this.nodes[0] as number) - ctx.v(this.nodes[1] as number);
    this.flowing = (this.capacitance * (v - this.voltage)) / ctx.dt;
    this.voltage = v;
  }
  current(): number {
    return this.flowing;
  }
}

/**
 * An inductor (with optional series resistance) as a branch whose current
 * is a solver unknown: v = R·i + L·di/dt by backward Euler.  At the DC
 * operating point it is a short (plus its resistance).
 */
export class Inductor implements Element {
  nodes = [0, 0];
  readonly sources = 1;
  sourceBase?: number;
  private flowing = 0;
  constructor(
    public inductance: number,
    public resistance = 0,
  ) {}
  stamp(s: Stamp, ctx: Context): void {
    stampBranch(s, this, this.nodes[0] as number, this.nodes[1] as number, this.resistance, Math.max(this.inductance, 0) / ctx.dt, this.flowing);
  }
  end(ctx: Context): void {
    this.flowing = ctx.sourceCurrent(this, 0);
  }
  current(ctx: Context): number {
    return ctx.sourceCurrent(this, 0);
  }
}

/** A series R–L branch on source row 0 of `element`: v(a) − v(b) = R·i + z·(i − i₀), with i flowing in at a and z = L/dt. */
function stampBranch(s: Stamp, element: Element, a: number, b: number, r: number, z: number, previous: number): void {
  const row = s.sourceRow(element, 0);
  s.matrix(s.nodeRow(a), row, 1);
  s.matrix(s.nodeRow(b), row, -1);
  s.matrix(row, s.nodeRow(a), 1);
  s.matrix(row, s.nodeRow(b), -1);
  s.matrix(row, row, -(r + z));
  s.rhs(row, -z * previous);
}

/** Two resistors meeting at the wiper: terminals end, wiper, end. */
export class Potentiometer implements Element {
  nodes = [0, 0, 0];
  constructor(
    public resistance: number,
    /** 0 at the first end, 1 at the second. */
    public position: number,
  ) {}
  stamp(s: Stamp): void {
    const [a, w, b] = this.nodes as [number, number, number];
    const p = Math.min(1, Math.max(0, this.position));
    s.conductance(a, w, 1 / Math.max(p * this.resistance, 0.01));
    s.conductance(w, b, 1 / Math.max((1 - p) * this.resistance, 0.01));
  }
}

const CLOSED = 100;
const OPEN = 1e-9;

export class Switch implements Element {
  nodes = [0, 0];
  constructor(public closed: boolean) {}
  stamp(s: Stamp): void {
    s.conductance(this.nodes[0] as number, this.nodes[1] as number, this.closed ? CLOSED : OPEN);
  }
  current(ctx: Context): number {
    return (ctx.v(this.nodes[0] as number) - ctx.v(this.nodes[1] as number)) * (this.closed ? CLOSED : OPEN);
  }
}

/** Common terminal joined to the first or second throw. */
export class ChangeoverSwitch implements Element {
  nodes = [0, 0, 0];
  constructor(public toSecond: boolean) {}
  stamp(s: Stamp): void {
    const [c, a, b] = this.nodes as [number, number, number];
    s.conductance(c, a, this.toSecond ? OPEN : CLOSED);
    s.conductance(c, b, this.toSecond ? CLOSED : OPEN);
  }
}

/** A lamp: a resistor sized from its rating, glowing with the power it takes. */
export class Lamp implements Element {
  nodes = [0, 0];
  glow = 0;
  constructor(
    public volts: number,
    public watts: number,
  ) {}
  get resistance(): number {
    return (this.volts * this.volts) / Math.max(this.watts, 1e-6);
  }
  stamp(s: Stamp): void {
    s.conductance(this.nodes[0] as number, this.nodes[1] as number, 1 / this.resistance);
  }
  end(ctx: Context): void {
    const v = ctx.v(this.nodes[0] as number) - ctx.v(this.nodes[1] as number);
    this.glow = smooth(this.glow, (v * v) / this.resistance / this.watts, ctx.dt, 0.05);
  }
  current(ctx: Context): number {
    return (ctx.v(this.nodes[0] as number) - ctx.v(this.nodes[1] as number)) / this.resistance;
  }
}

/** A small DC motor: winding resistance and inductance; speed follows the current. */
export class Motor implements Element {
  nodes = [0, 0];
  readonly sources = 1;
  sourceBase?: number;
  speed = 0;
  angle = 0;
  private flowing = 0;
  constructor(public resistance = 10) {}
  stamp(s: Stamp, ctx: Context): void {
    // Winding resistance in series with 1 mH.
    stampBranch(s, this, this.nodes[0] as number, this.nodes[1] as number, this.resistance, 0.001 / ctx.dt, this.flowing);
  }
  end(ctx: Context): void {
    this.flowing = ctx.sourceCurrent(this, 0);
    this.speed = smooth(this.speed, this.flowing, ctx.dt, 0.15);
    this.angle = (this.angle + this.speed * Math.min(ctx.dt, 1) * 360 * 8) % 360;
  }
  current(): number {
    return this.flowing;
  }
}

/** A buzzer that sounds above a few milliamps. */
export class Buzzer implements Element {
  nodes = [0, 0];
  level = 0;
  constructor(public resistance = 100) {}
  stamp(s: Stamp): void {
    s.conductance(this.nodes[0] as number, this.nodes[1] as number, 1 / this.resistance);
  }
  end(ctx: Context): void {
    const i = (ctx.v(this.nodes[0] as number) - ctx.v(this.nodes[1] as number)) / this.resistance;
    this.level = smooth(this.level, Math.abs(i) > 0.005 ? 1 : 0, ctx.dt, 0.01);
  }
}

/* ---------------------------------------------------------------- sources -- */

export type Waveform = 'dc' | 'sine' | 'square' | 'triangle' | 'sawtooth' | 'pulse';

export function waveValue(shape: Waveform, t: number, frequency: number, amplitude: number, offset: number, duty = 0.5): number {
  if (shape === 'dc') return offset + amplitude;
  const phase = (((t * frequency) % 1) + 1) % 1;
  switch (shape) {
    case 'sine':
      return offset + amplitude * Math.sin(2 * Math.PI * phase);
    case 'square':
      return offset + (phase < 0.5 ? amplitude : -amplitude);
    case 'pulse':
      return offset + (phase < duty ? amplitude : 0);
    case 'triangle':
      return offset + amplitude * (phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase);
    default:
      return offset + amplitude * (2 * phase - 1);
  }
}

/** An ideal voltage source (or one with internal resistance): terminals + and −. */
export class VoltageSource implements Element {
  nodes = [0, 0];
  readonly sources: number;
  sourceBase?: number;
  constructor(
    public shape: Waveform,
    public amplitude: number,
    public frequency = 0,
    public offset = 0,
    public internal = 0,
    public duty = 0.5,
  ) {
    this.sources = internal > 0 ? 0 : 1;
  }
  value(t: number): number {
    return waveValue(this.shape, t, this.frequency, this.amplitude, this.offset, this.duty);
  }
  /** The value at the DC operating point: a battery's voltage, a generator's offset. */
  dcValue(): number {
    return this.shape === 'dc' ? this.amplitude : this.offset;
  }
  /** The value now, allowing for the operating point and source stepping. */
  at(ctx: Context): number {
    return (ctx.dc ? this.dcValue() : this.value(ctx.t)) * (ctx.ramp ?? 1);
  }
  stamp(s: Stamp, ctx: Context): void {
    const [p, n] = this.nodes as [number, number];
    const v = this.at(ctx);
    if (this.internal > 0) {
      const g = 1 / this.internal;
      s.conductance(p, n, g);
      s.current(n, p, g * v);
    } else s.source(this, 0, p, n, v);
  }
  /** Current delivered out of the + terminal into the circuit. */
  current(ctx: Context): number {
    if (this.internal > 0) return (this.at(ctx) - (ctx.v(this.nodes[0] as number) - ctx.v(this.nodes[1] as number))) / this.internal;
    return -ctx.sourceCurrent(this, 0);
  }
}

export class CurrentSource implements Element {
  nodes = [0, 0];
  constructor(public amps: number) {}
  stamp(s: Stamp, ctx: Context): void {
    s.current(this.nodes[0] as number, this.nodes[1] as number, this.amps * (ctx.ramp ?? 1));
  }
  current(): number {
    return this.amps;
  }
}

/* -------------------------------------------------------------- diodes -- */

export interface DiodeModel {
  /** Saturation current, A. */
  readonly is: number;
  /** Emission coefficient. */
  readonly n: number;
  /** Reverse breakdown voltage for Zener diodes (positive number), or 0. */
  readonly zener?: number;
}

export const DIODES: Record<string, DiodeModel> = {
  silicon: { is: 2.52e-9, n: 1.752 },
  schottky: { is: 3.2e-7, n: 1.1 },
  germanium: { is: 1e-6, n: 1.2 },
};

/** LED models: forward voltage at 10 mA close to typical parts. */
export const LED_COLOURS: Record<string, { readonly vf: number; readonly hex: string }> = {
  red: { vf: 1.85, hex: '#ff2a2a' },
  orange: { vf: 1.95, hex: '#ff8a1c' },
  yellow: { vf: 2.05, hex: '#ffd21c' },
  green: { vf: 2.15, hex: '#2ee05a' },
  blue: { vf: 3.0, hex: '#3a7bff' },
  white: { vf: 3.05, hex: '#f4f7ff' },
  infrared: { vf: 1.25, hex: '#8a2040' },
};

export function ledModel(colour: string): DiodeModel {
  const vf = LED_COLOURS[colour]?.vf ?? 2;
  const n = 2;
  return { is: 0.01 / Math.exp(vf / (n * VT)), n };
}

export class Diode implements Element {
  nodes = [0, 0];
  readonly nonlinear = true;
  private vd = 0;
  private flowing = 0;
  /** Average current, for LED brightness. */
  average = 0;
  constructor(public model: DiodeModel) {}
  private get nVt(): number {
    return this.model.n * VT;
  }
  stamp(s: Stamp, ctx: Context): void {
    const [a, c] = this.nodes as [number, number];
    const { is } = this.model;
    const nVt = this.nVt;
    const vCrit = nVt * Math.log(nVt / (Math.SQRT2 * is));
    let v = ctx.v(a) - ctx.v(c);
    v = limitJunction(v, this.vd, nVt, vCrit);
    const z = this.model.zener ?? 0;
    if (z > 0) {
      // Limit the reverse junction the same way, mirrored about the breakdown voltage.
      const reverse = limitJunction(-v - z, -this.vd - z, nVt, vCrit);
      if (-v - z > 0) v = -reverse - z;
    }
    this.vd = v;
    const e = exp(v / nVt);
    let i = is * (e - 1);
    let g = (is / nVt) * e;
    if (z > 0) {
      const er = exp((-v - z) / nVt);
      i -= is * er;
      g += (is / nVt) * er;
    }
    g += 1e-12;
    s.conductance(a, c, g);
    s.current(a, c, i - g * v);
    this.flowing = i;
  }
  converged(ctx: Context): boolean {
    const v = ctx.v(this.nodes[0] as number) - ctx.v(this.nodes[1] as number);
    return Math.abs(v - this.vd) < 1e-5 + 1e-4 * Math.abs(v);
  }
  end(ctx: Context): void {
    this.average = smooth(this.average, this.flowing, ctx.dt);
  }
  current(): number {
    return this.flowing;
  }
}

/* --------------------------------------------------------- transistors -- */

export interface BjtModel {
  readonly is: number;
  readonly betaF: number;
  readonly betaR: number;
}

/** Ebers–Moll bipolar transistor; terminals collector, base, emitter. */
export class Bjt implements Element {
  nodes = [0, 0, 0];
  readonly nonlinear = true;
  private vbe = 0;
  private vbc = 0;
  collector = 0;
  base = 0;
  constructor(
    public pnp: boolean,
    public model: BjtModel = { is: 1e-14, betaF: 100, betaR: 1 },
  ) {}
  stamp(s: Stamp, ctx: Context): void {
    const [nc, nb, ne] = this.nodes as [number, number, number];
    const p = this.pnp ? -1 : 1;
    const { is, betaF, betaR } = this.model;
    const vCrit = VT * Math.log(VT / (Math.SQRT2 * is));
    const vb = ctx.v(nb);
    let vbe = p * (vb - ctx.v(ne));
    let vbc = p * (vb - ctx.v(nc));
    vbe = limitJunction(vbe, this.vbe, VT, vCrit);
    vbc = limitJunction(vbc, this.vbc, VT, vCrit);
    this.vbe = vbe;
    this.vbc = vbc;
    const e1 = exp(vbe / VT);
    const e2 = exp(vbc / VT);
    const iF = is * (e1 - 1);
    const iR = is * (e2 - 1);
    const ic = iF - iR * (1 + 1 / betaR);
    const ib = iF / betaF + iR / betaR;
    const gF = (is * e1) / VT + 1e-12;
    const gR = (is * e2) / VT + 1e-12;
    const icBe = gF;
    const icBc = -gR * (1 + 1 / betaR);
    const ibBe = gF / betaF;
    const ibBc = gR / betaR;
    const rowC = [-icBc, icBe + icBc, -icBe];
    const rowB = [-ibBc, ibBe + ibBc, -ibBe];
    const rowE = rowC.map((v, k) => -(v + (rowB[k] as number)));
    const v0 = [vb - p * vbc, vb, vb - p * vbe];
    stampDevice(s, [nc, nb, ne], [p * ic, p * ib, -p * (ic + ib)], [rowC, rowB, rowE], v0);
    this.collector = p * ic;
    this.base = p * ib;
  }
  converged(ctx: Context): boolean {
    const p = this.pnp ? -1 : 1;
    const [nc, nb, ne] = this.nodes as [number, number, number];
    const vbe = p * (ctx.v(nb) - ctx.v(ne));
    const vbc = p * (ctx.v(nb) - ctx.v(nc));
    return Math.abs(vbe - this.vbe) < 1e-5 + 1e-4 * Math.abs(vbe) && Math.abs(vbc - this.vbc) < 1e-5 + 1e-4 * Math.abs(vbc);
  }
  current(): number {
    return this.collector;
  }
}

/** Level-1 (square law) MOSFET; terminals drain, gate, source. */
export class Mosfet implements Element {
  nodes = [0, 0, 0];
  readonly nonlinear = true;
  private vgs = 0;
  private vds = 0;
  drain = 0;
  constructor(
    public pChannel: boolean,
    public threshold = 1.5,
    /** Transconductance parameter K, A/V². */
    public k = 0.5,
    public lambda = 0.01,
  ) {}
  stamp(s: Stamp, ctx: Context): void {
    const [nd, ng, ns] = this.nodes as [number, number, number];
    const p = this.pChannel ? -1 : 1;
    const vs = ctx.v(ns);
    let vgs = p * (ctx.v(ng) - vs);
    let vds = p * (ctx.v(nd) - vs);
    // Small steps between iterations keep Newton inside one region at a time.
    vgs = this.vgs + Math.max(-0.6, Math.min(0.6, vgs - this.vgs));
    vds = this.vds + Math.max(-2, Math.min(2, vds - this.vds));
    this.vgs = vgs;
    this.vds = vds;
    const swapped = vds < 0;
    const vgsE = swapped ? vgs - vds : vgs;
    const vdsE = swapped ? -vds : vds;
    const vov = vgsE - this.threshold;
    let id = 0;
    let gm = 0;
    let gds = 1e-9;
    if (vov > 0) {
      const lam = 1 + this.lambda * vdsE;
      if (vdsE < vov) {
        id = this.k * (vov * vdsE - (vdsE * vdsE) / 2) * lam;
        gm = this.k * vdsE * lam;
        gds += this.k * (vov - vdsE) * lam + this.lambda * this.k * (vov * vdsE - (vdsE * vdsE) / 2);
      } else {
        id = (this.k / 2) * vov * vov * lam;
        gm = this.k * vov * lam;
        gds += (this.lambda * this.k * vov * vov) / 2;
      }
    }
    // Node voltages consistent with the limited operating point.
    const v0 = [vs + p * vds, vs + p * vgs, vs];
    if (!swapped) {
      // Current into the drain is p·id; derivatives with respect to (d, g, s).
      const row = [gds, gm, -gm - gds];
      stampDevice(s, [nd, ng, ns], [p * id, 0, -p * id], [row, [0, 0, 0], row.map((v) => -v)], v0);
      this.drain = p * id;
    } else {
      // Source and drain trade places: the current flows into the source pin.
      const row = [-gm - gds, gm, gds];
      stampDevice(s, [nd, ng, ns], [-p * id, 0, p * id], [row.map((v) => -v), [0, 0, 0], row], v0);
      this.drain = -p * id;
    }
  }
  converged(ctx: Context): boolean {
    const p = this.pChannel ? -1 : 1;
    const [nd, ng, ns] = this.nodes as [number, number, number];
    const vgs = p * (ctx.v(ng) - ctx.v(ns));
    const vds = p * (ctx.v(nd) - ctx.v(ns));
    return Math.abs(vgs - this.vgs) < 1e-5 + 1e-4 * Math.abs(vgs) && Math.abs(vds - this.vds) < 1e-5 + 1e-4 * Math.abs(vds);
  }
  current(): number {
    return this.drain;
  }
}

/* ---------------------------------------------------------------- op-amp -- */

/**
 * An op-amp with high gain and outputs limited (smoothly) to its supply
 * rails less a headroom; terminals non-inverting, inverting, output.  The
 * output is referenced to ground.  With a gain–bandwidth product the gain
 * falls from its DC value above the dominant pole (gain ÷ GBW gives its
 * time constant), in the time domain and in frequency analysis alike.
 */
export class OpAmp implements Element {
  nodes = [0, 0, 0];
  readonly sources = 1;
  sourceBase?: number;
  readonly nonlinear = true;
  /** The amplified difference after the dominant pole, before the output limits. */
  private lagged = 0;
  /** Small-signal slope of the output limit at the latest solution (1 in the linear range). */
  private slope0 = 1;
  constructor(
    public positiveRail = 15,
    public negativeRail = -15,
    public headroom = 1.5,
    public gain = 1e5,
    /** Gain–bandwidth product in hertz; 0 for unlimited bandwidth. */
    public gbw = 0,
  ) {}
  private get tau(): number {
    return this.gbw > 0 ? this.gain / (2 * Math.PI * this.gbw) : 0;
  }
  /** How much of the new difference reaches the output in one step. */
  private alpha(dt: number): number {
    const tau = this.tau;
    return tau > 0 ? dt / (dt + tau) : 1;
  }
  stamp(s: Stamp, ctx: Context): void {
    const [np, nn, no] = this.nodes as [number, number, number];
    const hi = this.positiveRail - this.headroom;
    const lo = this.negativeRail + this.headroom;
    const mid = (hi + lo) / 2;
    const half = Math.max(1e-3, (hi - lo) / 2);
    const vd = ctx.v(np) - ctx.v(nn);
    const a = this.alpha(ctx.dt);
    const y = a * this.gain * vd + (1 - a) * this.lagged;
    const u = y / half;
    const th = Math.tanh(Math.max(-40, Math.min(40, u)));
    const f = mid + half * th;
    this.slope0 = 1 - th * th;
    const slope = a * this.gain * this.slope0 + 1e-9;
    const row = s.sourceRow(this, 0);
    // v(out) − slope·v(+) + slope·v(−) = f − slope·vd
    s.matrix(row, s.nodeRow(no), 1);
    s.matrix(row, s.nodeRow(np), -slope);
    s.matrix(row, s.nodeRow(nn), slope);
    s.matrix(s.nodeRow(no), row, 1);
    s.rhs(row, f - slope * vd);
  }
  end(ctx: Context): void {
    const vd = ctx.v(this.nodes[0] as number) - ctx.v(this.nodes[1] as number);
    const a = this.alpha(ctx.dt);
    this.lagged = a * this.gain * vd + (1 - a) * this.lagged;
  }
  ac(s: AcStamp, omega: number): void {
    const [np, nn, no] = this.nodes as [number, number, number];
    const row = s.sourceRow(this, 0);
    // Gain g0 / (1 + jωτ).
    const g0 = this.gain * this.slope0 + 1e-9;
    const wt = omega * this.tau;
    const d = 1 + wt * wt;
    const re = g0 / d;
    const im = (-g0 * wt) / d;
    s.add(row, s.nodeRow(no), 1, 0);
    s.add(s.nodeRow(no), row, 1, 0);
    s.add(row, s.nodeRow(np), -re, -im);
    s.add(row, s.nodeRow(nn), re, im);
  }
  current(ctx: Context): number {
    return -ctx.sourceCurrent(this, 0);
  }
}

/* ---------------------------------------------------------------- 555 timer -- */

/** Terminals: GND, TRIG, OUT, RESET, CTRL, THR, DIS, VCC (pins 1–8). */
export class Timer555 implements Element {
  nodes = [0, 0, 0, 0, 0, 0, 0, 0];
  high = false;
  begin(ctx: Context): void {
    const [gnd, trig, , reset, ctrl, thr] = this.nodes as number[];
    const g = ctx.previous(gnd as number);
    const vc = ctx.previous(ctrl as number) - g;
    if (ctx.previous(reset as number) - g < 0.7) this.high = false;
    else if (ctx.previous(trig as number) - g < vc / 2) this.high = true;
    else if (ctx.previous(thr as number) - g > vc) this.high = false;
  }
  stamp(s: Stamp, ctx: Context): void {
    const [gnd, , out, , ctrl, , dis, vcc] = this.nodes as [number, number, number, number, number, number, number, number];
    // The internal divider: 5 kΩ from VCC to CTRL, 10 kΩ from CTRL to GND.
    s.conductance(vcc, ctrl, 1 / 5000);
    s.conductance(ctrl, gnd, 1 / 10000);
    const supply = ctx.previous(vcc) - ctx.previous(gnd);
    const target = this.high ? Math.max(0, supply - 1.5) : 0.05;
    const g = 1 / 10;
    s.conductance(out, gnd, g);
    s.current(gnd, out, g * target);
    s.conductance(dis, gnd, this.high ? 1e-9 : 1 / 15);
  }
}

/* ------------------------------------------------------------- digital -- */

/** Digital outputs: a level through a small resistance, referenced to ground. */
function drive(s: Stamp, node: number, high: boolean, supply: number): void {
  const g = 1 / 50;
  s.conductance(node, 0, g);
  if (high) s.current(0, node, g * supply);
}

const isHigh = (ctx: Context, node: number, supply: number) => ctx.previous(node) > supply / 2;

export type GateKind = 'and' | 'or' | 'nand' | 'nor' | 'xor' | 'xnor' | 'not' | 'buffer';

export function gateOutput(kind: GateKind, inputs: readonly boolean[]): boolean {
  const ones = inputs.filter(Boolean).length;
  switch (kind) {
    case 'and':
      return ones === inputs.length;
    case 'nand':
      return ones !== inputs.length;
    case 'or':
      return ones > 0;
    case 'nor':
      return ones === 0;
    case 'xor':
      return ones % 2 === 1;
    case 'xnor':
      return ones % 2 === 0;
    case 'not':
      return !inputs[0];
    default:
      return Boolean(inputs[0]);
  }
}

/** Terminals: inputs, then the output. */
export class Gate implements Element {
  nodes: number[];
  out = false;
  constructor(
    public kind: GateKind,
    public inputs: number,
    public supply = 5,
  ) {
    this.nodes = Array.from({ length: inputs + 1 }, () => 0);
  }
  begin(ctx: Context): void {
    this.out = gateOutput(
      this.kind,
      this.nodes.slice(0, this.inputs).map((n) => isHigh(ctx, n, this.supply)),
    );
  }
  stamp(s: Stamp): void {
    drive(s, this.nodes[this.inputs] as number, this.out, this.supply);
  }
}

export type FlipFlopKind = 'd' | 'jk' | 't' | 'sr';

/**
 * Edge-triggered flip-flops (rising clock edge) and an SR latch.
 * Terminals: D: D, CLK, Q, Q̄.  JK: J, CLK, K, Q, Q̄.  T: T, CLK, Q, Q̄.  SR: S, R, Q, Q̄.
 */
export class FlipFlop implements Element {
  nodes: number[];
  q = false;
  private clock = false;
  constructor(
    public kind: FlipFlopKind,
    public supply = 5,
  ) {
    this.nodes = Array.from({ length: kind === 'jk' ? 5 : 4 }, () => 0);
  }
  begin(ctx: Context): void {
    const h = (i: number) => isHigh(ctx, this.nodes[i] as number, this.supply);
    if (this.kind === 'sr') {
      const set = h(0);
      const reset = h(1);
      if (set && !reset) this.q = true;
      else if (reset && !set) this.q = false;
      return;
    }
    const clock = h(1);
    if (clock && !this.clock) {
      if (this.kind === 'd') this.q = h(0);
      else if (this.kind === 't') this.q = h(0) ? !this.q : this.q;
      else {
        const j = h(0);
        const k = h(2);
        this.q = j && k ? !this.q : j ? true : k ? false : this.q;
      }
    }
    this.clock = clock;
  }
  stamp(s: Stamp): void {
    const n = this.nodes.length;
    drive(s, this.nodes[n - 2] as number, this.q, this.supply);
    drive(s, this.nodes[n - 1] as number, !this.q, this.supply);
  }
}

/** A 4-bit binary counter on rising clock edges.  Terminals: CLK, RESET, Q0, Q1, Q2, Q3. */
export class Counter implements Element {
  nodes = [0, 0, 0, 0, 0, 0];
  count = 0;
  private clock = false;
  constructor(
    public modulo = 16,
    public supply = 5,
  ) {}
  begin(ctx: Context): void {
    const clock = isHigh(ctx, this.nodes[0] as number, this.supply);
    if (isHigh(ctx, this.nodes[1] as number, this.supply)) this.count = 0;
    else if (clock && !this.clock) this.count = (this.count + 1) % Math.max(2, this.modulo);
    this.clock = clock;
  }
  stamp(s: Stamp): void {
    for (let bit = 0; bit < 4; bit++) drive(s, this.nodes[2 + bit] as number, ((this.count >> bit) & 1) === 1, this.supply);
  }
}

/** Segments a–g lit for each digit 0–9 (and A–F), bit 0 = a. */
export const SEGMENTS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71];

/** BCD (or hex) to seven-segment decoder for common-cathode displays.  Terminals: A, B, C, D, a–g. */
export class SegmentDecoder implements Element {
  nodes = Array.from({ length: 11 }, () => 0);
  pattern = 0;
  constructor(
    public hex = false,
    public supply = 5,
  ) {}
  begin(ctx: Context): void {
    let value = 0;
    for (let bit = 0; bit < 4; bit++) if (isHigh(ctx, this.nodes[bit] as number, this.supply)) value |= 1 << bit;
    this.pattern = value < 10 || this.hex ? (SEGMENTS[value] as number) : 0;
  }
  stamp(s: Stamp): void {
    for (let k = 0; k < 7; k++) drive(s, this.nodes[4 + k] as number, ((this.pattern >> k) & 1) === 1, this.supply);
  }
}

/** A toggle that outputs a logic level.  Terminal: output. */
export class LogicInput implements Element {
  nodes = [0];
  constructor(
    public high: boolean,
    public supply = 5,
  ) {}
  stamp(s: Stamp): void {
    drive(s, this.nodes[0] as number, this.high, this.supply);
  }
}

/** A square-wave clock.  Terminal: output. */
export class Clock implements Element {
  nodes = [0];
  high = false;
  constructor(
    public frequency: number,
    public supply = 5,
  ) {}
  begin(ctx: Context): void {
    this.high = (ctx.t * this.frequency) % 1 < 0.5;
  }
  stamp(s: Stamp): void {
    drive(s, this.nodes[0] as number, this.high, this.supply);
  }
}

/** A logic indicator: high impedance, lit above half the supply. */
export class LogicProbe implements Element {
  nodes = [0];
  high = false;
  constructor(public supply = 5) {}
  stamp(s: Stamp): void {
    s.conductance(this.nodes[0] as number, 0, 1e-6);
  }
  end(ctx: Context): void {
    this.high = ctx.v(this.nodes[0] as number) > this.supply / 2;
  }
}

/** A seven-segment display made of LEDs.  Terminals: a–g, then the common pin. */
export class SevenSegment implements Element {
  nodes = Array.from({ length: 8 }, () => 0);
  readonly nonlinear = true;
  readonly segments: Diode[];
  constructor(
    public commonAnode: boolean,
    colour = 'red',
  ) {
    this.segments = Array.from({ length: 7 }, () => new Diode(ledModel(colour)));
  }
  private wire(): void {
    const common = this.nodes[7] as number;
    this.segments.forEach((d, k) => {
      d.nodes = this.commonAnode ? [common, this.nodes[k] as number] : [this.nodes[k] as number, common];
    });
  }
  stamp(s: Stamp, ctx: Context): void {
    this.wire();
    for (const d of this.segments) d.stamp(s, ctx);
  }
  converged(ctx: Context): boolean {
    return this.segments.every((d) => d.converged(ctx));
  }
  end(ctx: Context): void {
    for (const d of this.segments) d.end(ctx);
  }
}

/** A relay: coil between the first two terminals, then COM, NO and NC. */
export class Relay implements Element {
  nodes = [0, 0, 0, 0, 0];
  energised = false;
  constructor(
    public coilResistance = 100,
    /** Pull-in current, A. */
    public pullIn = 0.03,
  ) {}
  begin(ctx: Context): void {
    const i = Math.abs(ctx.previous(this.nodes[0] as number) - ctx.previous(this.nodes[1] as number)) / this.coilResistance;
    // Hysteresis: drops out at half the pull-in current.
    this.energised = this.energised ? i > this.pullIn / 2 : i > this.pullIn;
  }
  stamp(s: Stamp): void {
    const [c1, c2, com, no, nc] = this.nodes as [number, number, number, number, number];
    s.conductance(c1, c2, 1 / this.coilResistance);
    s.conductance(com, no, this.energised ? CLOSED : OPEN);
    s.conductance(com, nc, this.energised ? OPEN : CLOSED);
  }
}

/* ------------------------------------------------------------------ meters -- */

export class Voltmeter implements Element {
  nodes = [0, 0];
  reading = 0;
  stamp(s: Stamp): void {
    s.conductance(this.nodes[0] as number, this.nodes[1] as number, 1e-7);
  }
  end(ctx: Context): void {
    this.reading = ctx.v(this.nodes[0] as number) - ctx.v(this.nodes[1] as number);
  }
}

/** A zero-volt source; reads the current flowing in at its first terminal. */
export class Ammeter implements Element {
  nodes = [0, 0];
  readonly sources = 1;
  sourceBase?: number;
  reading = 0;
  stamp(s: Stamp): void {
    s.source(this, 0, this.nodes[0] as number, this.nodes[1] as number, 0);
  }
  end(ctx: Context): void {
    this.reading = ctx.sourceCurrent(this, 0);
  }
  current(ctx: Context): number {
    return ctx.sourceCurrent(this, 0);
  }
}

/** Marks a node for the oscilloscope; takes no current. */
export class Probe implements Element {
  nodes = [0];
  reading = 0;
  stamp(): void {}
  end(ctx: Context): void {
    this.reading = ctx.v(this.nodes[0] as number);
  }
}
