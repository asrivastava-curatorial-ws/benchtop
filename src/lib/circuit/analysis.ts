/**
 * Circuit analyses in the manner of a SPICE-style simulator: the DC
 * operating point (every node's voltage and every part's currents and
 * power), DC sweeps of any part value, time-domain runs, and small-signal
 * frequency response (gain and phase) about the operating point, each of
 * which can be repeated while another part value steps through a list.
 *
 * Frequency analysis linearises the circuit at its operating point: every
 * part stamps its matrix twice, at time steps of 1 s and 0.5 s, and what
 * changes with 1/dt is its capacitance (C/dt), the rest its conductance, so
 * the small-signal admittance is G + jωC.  Parts whose stamp is not of that
 * form (op-amps with a gain–bandwidth, the transfer-function block) stamp
 * their admittance directly.
 */
import type { AcSettings, AnalysisSettings, DcSweepSettings, Signal, SignalKind, Stepping, TransientSettings } from './analysis-settings';
import { CurrentSource, VoltageSource } from './elements';
import { type AcStamp, type Circuit, type Context, DC_STEP, type Element, Stamper } from './engine';
import { partNames } from './names';
import { build, type CircuitDoc, type Connectivity, type PlacedPart } from './netlist';
import { PART_BY_TYPE, type PropValue } from './parts';

export { partNames };

/* ------------------------------------------------------------------ inputs -- */

export type { AcSettings, AnalysisKind, AnalysisSettings, DcSweepSettings, Signal, SignalKind, Stepping, TransientSettings } from './analysis-settings';

/* ----------------------------------------------------------------- results -- */

export interface PartReading {
  /** Current into each terminal, amperes (NaN where it cannot be told). */
  readonly currents: readonly number[];
  /** Voltage at each terminal (NaN for a terminal left out). */
  readonly volts: readonly number[];
  /** Power taken by the part, watts (negative: it delivers power). */
  readonly power: number;
}

export interface OperatingPoint {
  readonly kind: 'op';
  /** Voltage of each node (index = node number; 0 is ground). */
  readonly nodes: Float64Array;
  readonly parts: ReadonlyMap<string, PartReading>;
  readonly connectivity: Connectivity;
  readonly warnings: readonly string[];
}

export interface Trace {
  readonly label: string;
  readonly signal: Signal;
  /** 'V', 'A' or 'W'. */
  readonly unit: string;
  /** The stepped value this trace was run with, if any. */
  readonly stepValue?: number;
  /** Real values, or real parts in frequency analysis. */
  readonly values: Float64Array;
  /** Imaginary parts (frequency analysis only). */
  readonly imag?: Float64Array;
}

export interface Sweep {
  readonly kind: 'dc' | 'tran' | 'ac';
  /** Swept value, time or frequency for every point; with stepping, each run has its own x (same length). */
  readonly x: Float64Array;
  readonly xLabel: string;
  readonly xUnit: string;
  readonly logX: boolean;
  readonly traces: readonly Trace[];
  readonly warnings: readonly string[];
}

export type AnalysisResult = OperatingPoint | Sweep;

export interface RunOptions {
  readonly signal?: AbortSignal;
  /** Called now and then with the fraction done. */
  readonly onProgress?: (fraction: number) => void;
}

export class AnalysisError extends Error {}

/* ------------------------------------------------------------------- names -- */

/** The terminal whose current names a part's current: a transistor's collector or drain, an amplifier's output. */
export function mainTerminal(type: string): number {
  switch (type) {
    case 'npn':
    case 'pnp':
    case 'nmos':
    case 'pmos':
    case 'njfet':
    case 'pjfet':
      return 1;
    case 'opamp':
    case 'comparator':
      return 2;
    default:
      return 0;
  }
}

export function signalLabel(signal: Signal, doc: Pick<CircuitDoc, 'parts'>, names = partNames(doc)): string {
  const part = doc.parts.find((p) => p.id === signal.part);
  const name = names.get(signal.part) ?? '?';
  const def = part ? PART_BY_TYPE.get(part.type) : undefined;
  const terminal = signal.terminal !== undefined ? def?.terminals[signal.terminal]?.name : undefined;
  const at = terminal ? `${name}.${terminal}` : name;
  return `${signal.kind.toUpperCase()}(${at})`;
}

export const signalUnit = (kind: SignalKind) => (kind === 'v' ? 'V' : kind === 'i' ? 'A' : 'W');

/** The signals a part offers for plotting. */
export function signalsFor(part: PlacedPart): Signal[] {
  const def = PART_BY_TYPE.get(part.type);
  if (!def || def.ground) return [];
  const n = def.terminals.length;
  if (part.type === 'probe' || part.type === 'rail' || n === 1) return [{ kind: 'v', part: part.id }];
  const out: Signal[] = [];
  if (n === 2) out.push({ kind: 'v', part: part.id });
  else
    def.terminals.forEach((_, k) => {
      out.push({ kind: 'v', part: part.id, terminal: k });
    });
  out.push({ kind: 'i', part: part.id, ...(n > 2 ? { terminal: mainTerminal(part.type) } : {}) }, { kind: 'p', part: part.id });
  return out;
}

/** A copy of the circuit with one part's property changed. */
export function withProp(doc: CircuitDoc, part: string, prop: string, value: PropValue): CircuitDoc {
  return { ...doc, parts: doc.parts.map((p) => (p.id === part ? { ...p, props: { ...p.props, [prop]: value } } : p)) };
}

/* -------------------------------------------------------- measuring currents -- */

/** Records what elements stamp, to work out the currents at their terminals. */
class Recorder extends Stamper {
  readonly rows: number[] = [];
  readonly cols: number[] = [];
  readonly vals: number[] = [];
  readonly rhsRows: number[] = [];
  readonly rhsVals: number[] = [];
  constructor(private readonly circuit: Circuit) {
    super();
  }
  sourceRow(element: Element, k: number): number {
    return this.circuit.sourceRow(element, k);
  }
  matrix(row: number, column: number, value: number): void {
    if (row < 0 || column < 0) return;
    this.rows.push(row);
    this.cols.push(column);
    this.vals.push(value);
  }
  rhs(row: number, value: number): void {
    if (row < 0) return;
    this.rhsRows.push(row);
    this.rhsVals.push(value);
  }
  clear(): void {
    this.rows.length = 0;
    this.cols.length = 0;
    this.vals.length = 0;
    this.rhsRows.length = 0;
    this.rhsVals.length = 0;
  }
  /** Current flowing out of the row's node into the recorded elements: (A·x − b) on that row. */
  flowOut(row: number, x: Float64Array): number {
    let sum = 0;
    for (let i = 0; i < this.rows.length; i++) if (this.rows[i] === row) sum += (this.vals[i] as number) * (x[this.cols[i] as number] as number);
    for (let i = 0; i < this.rhsRows.length; i++) if (this.rhsRows[i] === row) sum -= this.rhsVals[i] as number;
    return sum;
  }
}

/** The circuit's present solution seen as the DC operating point. */
function dcContext(c: Circuit): Context {
  return { t: c.t, dt: DC_STEP, dc: true, v: (n) => c.v(n), previous: (n) => c.v(n), sourceCurrent: (e, k) => c.sourceCurrent(e, k) };
}

/** Terminal currents of one part, from its elements' stamps at the present solution. */
function partCurrents(circuit: Circuit, recorder: Recorder, elements: readonly Element[], nodes: readonly number[], ctx: Context): number[] {
  recorder.clear();
  for (const e of elements) e.stamp(recorder, ctx);
  const currents = nodes.map((n) => (n > 0 ? recorder.flowOut(n - 1, circuit.x) : Number.NaN));
  // A grounded terminal takes what the others do not (exact for parts whose elements stay between their terminals).
  const missing = currents.map((c, k) => (Number.isNaN(c) && nodes[k] === 0 ? k : -1)).filter((k) => k >= 0);
  if (missing.length === 1) {
    const rest = currents.reduce((s, c) => (Number.isNaN(c) ? s : s + c), 0);
    currents[missing[0] as number] = -rest;
  }
  return currents;
}

/* -------------------------------------------------------------- operating point -- */

/** Node leakage for analyses: small enough not to disturb megohm circuits, large enough to pin floating nodes. */
const ANALYSIS_GMIN = 1e-12;

function prepare(doc: CircuitDoc): ReturnType<typeof build> {
  const built = build(doc);
  built.circuit.gmin = ANALYSIS_GMIN;
  return built;
}

function readParts(doc: CircuitDoc, built: ReturnType<typeof build>, ctx: Context): Map<string, PartReading> {
  const { circuit, runtimes, connectivity } = built;
  const recorder = new Recorder(circuit);
  const parts = new Map<string, PartReading>();
  for (const part of doc.parts) {
    const runtime = runtimes.get(part.id);
    const nodes = connectivity.partNodes.get(part.id) ?? [];
    if (!runtime?.elements.length) continue;
    const currents = partCurrents(circuit, recorder, runtime.elements, nodes, ctx);
    const volts = nodes.map((n) => (n >= 0 ? circuit.v(n) : Number.NaN));
    let power = 0;
    currents.forEach((i, k) => {
      const v = volts[k] as number;
      if (Number.isFinite(i) && Number.isFinite(v)) power += i * v;
    });
    parts.set(part.id, { currents, volts, power });
  }
  return parts;
}

export function operatingPoint(doc: CircuitDoc): OperatingPoint {
  const built = prepare(doc);
  const { circuit, connectivity } = built;
  const result = circuit.operatingPoint();
  const warnings = [...built.problems];
  if (!result.ok || !result.settled) throw new AnalysisError(circuit.trouble || 'No DC operating point was found.');
  const nodes = new Float64Array(connectivity.nodeCount + 1);
  for (let n = 1; n <= connectivity.nodeCount; n++) nodes[n] = circuit.v(n);
  const parts = readParts(doc, built, dcContext(circuit));
  if (doc.parts.some((p) => BOARD_TYPES.has(p.type))) warnings.push('Boards count only as their power supplies here; their programs run in the live simulation.');
  return { kind: 'op', nodes, parts, connectivity, warnings };
}

const BOARD_TYPES = new Set(['arduino-uno', 'arduino-nano', 'arduino-mega', 'attiny85', 'esp32']);

/* ------------------------------------------------------------------ signals -- */

interface Probe {
  readonly signal: Signal;
  readonly nodes: readonly number[];
  readonly elements: readonly Element[];
}

function probesFor(signals: readonly Signal[], built: ReturnType<typeof build>): Probe[] {
  return signals.map((signal) => ({
    signal,
    nodes: built.connectivity.partNodes.get(signal.part) ?? [],
    elements: built.runtimes.get(signal.part)?.elements ?? [],
  }));
}

/** A real-valued signal at the present solution. */
function measure(probe: Probe, circuit: Circuit, recorder: Recorder, ctx: Context): number {
  const { signal, nodes } = probe;
  const v = (k: number) => {
    const n = nodes[k];
    return n === undefined || n < 0 ? Number.NaN : circuit.v(n);
  };
  if (signal.kind === 'v') {
    if (signal.terminal !== undefined) return v(signal.terminal);
    return nodes.length >= 2 ? v(0) - v(1) : v(0);
  }
  if (!probe.elements.length) return Number.NaN;
  const currents = partCurrents(circuit, recorder, probe.elements, nodes, ctx);
  if (signal.kind === 'i') return currents[signal.terminal ?? 0] ?? Number.NaN;
  let p = 0;
  currents.forEach((i, k) => {
    const vk = v(k);
    if (Number.isFinite(i) && Number.isFinite(vk)) p += i * vk;
  });
  return p;
}

/* ---------------------------------------------------------------- DC sweep -- */

export function sweepValues(from: number, to: number, points: number, log = false): Float64Array {
  const n = Math.max(2, Math.min(10_000, Math.round(points)));
  const out = new Float64Array(n);
  if (log) {
    if (!(from > 0 && to > 0)) throw new AnalysisError('A logarithmic sweep needs values above zero.');
    const a = Math.log10(from);
    const b = Math.log10(to);
    for (let i = 0; i < n; i++) out[i] = 10 ** (a + ((b - a) * i) / (n - 1));
  } else for (let i = 0; i < n; i++) out[i] = from + ((to - from) * i) / (n - 1);
  return out;
}

function dcSweep(doc: CircuitDoc, s: DcSweepSettings, outputs: readonly Signal[]): { x: Float64Array; values: Float64Array[]; warnings: string[] } {
  const x = sweepValues(s.from, s.to, s.points, s.log);
  const values = outputs.map(() => new Float64Array(x.length).fill(Number.NaN));
  const warnings: string[] = [];
  let previous: Float64Array | null = null;
  let failures = 0;
  x.forEach((value, i) => {
    const built = prepare(withProp(doc, s.part, s.prop, value));
    const { circuit } = built;
    if (previous && previous.length === circuit.x.length) circuit.x.set(previous);
    const r = circuit.operatingPoint();
    if (!r.ok || !r.settled) {
      failures++;
      return;
    }
    previous = Float64Array.from(circuit.x);
    const recorder = new Recorder(circuit);
    const ctx = dcContext(circuit);
    probesFor(outputs, built).forEach((probe, k) => {
      (values[k] as Float64Array)[i] = measure(probe, circuit, recorder, ctx);
    });
  });
  if (failures) warnings.push(`No operating point was found at ${failures} of the ${x.length} points; they are left out.`);
  return { x, values, warnings };
}

/* ------------------------------------------------------------- time domain -- */

/** At most this many points are kept per trace; longer runs keep every n-th step. */
const MAX_POINTS = 4000;
const MAX_STEPS = 5_000_000;

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function transient(
  doc: CircuitDoc,
  s: TransientSettings,
  outputs: readonly Signal[],
  options: RunOptions,
  share: [number, number],
): Promise<{ x: Float64Array; values: Float64Array[]; warnings: string[] }> {
  const dt = s.step > 0 ? s.step : doc.dt;
  if (!(s.stop > 0)) throw new AnalysisError('Set how long to simulate.');
  const steps = Math.ceil(s.stop / dt - 1e-9);
  if (steps > MAX_STEPS) throw new AnalysisError(`That is ${steps.toLocaleString('en')} time steps; use a larger step or a shorter run (at most ${MAX_STEPS.toLocaleString('en')}).`);
  const built = prepare({ ...doc, dt });
  const { circuit } = built;
  const warnings = [...built.problems];
  if (!s.fromZero) {
    const r = circuit.operatingPoint();
    if (!r.ok || !r.settled) warnings.push(`${circuit.trouble || 'No operating point was found.'} The run starts from zero instead.`);
  }
  const every = Math.max(1, Math.ceil(steps / MAX_POINTS));
  const kept = Math.floor(steps / every) + 1;
  const x = new Float64Array(kept);
  const values = outputs.map(() => new Float64Array(kept));
  const probes = probesFor(outputs, built);
  const recorder = new Recorder(circuit);
  const needsCurrents = outputs.some((o) => o.kind !== 'v');
  const record = (index: number, ctx: Context) => {
    x[index] = circuit.t;
    probes.forEach((probe, k) => {
      (values[k] as Float64Array)[index] = measure(probe, circuit, recorder, ctx);
    });
  };
  record(0, s.fromZero ? circuit : dcContext(circuit));
  let index = 1;
  let started = performance.now();
  let failed = '';
  for (let step = 1; step <= steps; step++) {
    const keep = step % every === 0 && index < kept;
    const result = circuit.step(keep && needsCurrents ? () => record(index, circuit) : undefined);
    if (!result.ok) {
      failed = circuit.trouble;
      break;
    }
    if (keep) {
      if (!needsCurrents) record(index, circuit);
      index++;
    }
    if ((step & 255) === 0 && performance.now() - started > 30) {
      options.onProgress?.(share[0] + (share[1] - share[0]) * (step / steps));
      await tick();
      if (options.signal?.aborted) throw new AnalysisError('Stopped.');
      started = performance.now();
    }
  }
  if (circuit.trouble && !failed) warnings.push(circuit.trouble);
  if (failed) {
    warnings.push(`${failed} The run stopped at ${circuit.t.toPrecision(4)} s.`);
    return { x: x.slice(0, index), values: values.map((v) => v.slice(0, index)), warnings };
  }
  return { x, values, warnings };
}

/* --------------------------------------------------------- frequency domain -- */

/** One element's small-signal entries: row, column, conductance and capacitance. */
interface Entries {
  readonly rows: number[];
  readonly cols: number[];
  readonly g: number[];
  readonly c: number[];
}

class ComplexMatrix implements AcStamp {
  readonly re: Float64Array;
  readonly im: Float64Array;
  constructor(
    readonly size: number,
    private readonly circuit: Circuit,
  ) {
    this.re = new Float64Array(size * size);
    this.im = new Float64Array(size * size);
  }
  add(row: number, column: number, re: number, im: number): void {
    if (row < 0 || column < 0) return;
    this.re[row * this.size + column] = (this.re[row * this.size + column] as number) + re;
    this.im[row * this.size + column] = (this.im[row * this.size + column] as number) + im;
  }
  nodeRow(node: number): number {
    return node - 1;
  }
  sourceRow(element: Element, k: number): number {
    return this.circuit.sourceRow(element, k);
  }
}

/** Collects one element's direct small-signal stamp, for its terminal currents. */
class AcRecorder implements AcStamp {
  readonly rows: number[] = [];
  readonly cols: number[] = [];
  readonly re: number[] = [];
  readonly im: number[] = [];
  constructor(private readonly circuit: Circuit) {}
  add(row: number, column: number, re: number, im: number): void {
    if (row < 0 || column < 0) return;
    this.rows.push(row);
    this.cols.push(column);
    this.re.push(re);
    this.im.push(im);
  }
  nodeRow(node: number): number {
    return node - 1;
  }
  sourceRow(element: Element, k: number): number {
    return this.circuit.sourceRow(element, k);
  }
}

/** Dense complex LU with partial pivoting; solves in place into (br, bi). */
export function solveComplex(ar: Float64Array, ai: Float64Array, br: Float64Array, bi: Float64Array, n: number): boolean {
  for (let k = 0; k < n; k++) {
    let best = k;
    let max = -1;
    for (let r = k; r < n; r++) {
      const m = Math.hypot(ar[r * n + k] as number, ai[r * n + k] as number);
      if (m > max) {
        max = m;
        best = r;
      }
    }
    if (max < 1e-300) return false;
    if (best !== k) {
      for (let c = 0; c < n; c++) {
        const i = k * n + c;
        const j = best * n + c;
        let t = ar[i] as number;
        ar[i] = ar[j] as number;
        ar[j] = t;
        t = ai[i] as number;
        ai[i] = ai[j] as number;
        ai[j] = t;
      }
      let t = br[k] as number;
      br[k] = br[best] as number;
      br[best] = t;
      t = bi[k] as number;
      bi[k] = bi[best] as number;
      bi[best] = t;
    }
    const pr = ar[k * n + k] as number;
    const pi = ai[k * n + k] as number;
    const pd = pr * pr + pi * pi;
    for (let r = k + 1; r < n; r++) {
      const xr = ar[r * n + k] as number;
      const xi = ai[r * n + k] as number;
      if (xr === 0 && xi === 0) continue;
      // f = x / p
      const fr = (xr * pr + xi * pi) / pd;
      const fi = (xi * pr - xr * pi) / pd;
      ar[r * n + k] = 0;
      ai[r * n + k] = 0;
      for (let c = k + 1; c < n; c++) {
        const yr = ar[k * n + c] as number;
        const yi = ai[k * n + c] as number;
        ar[r * n + c] = (ar[r * n + c] as number) - (fr * yr - fi * yi);
        ai[r * n + c] = (ai[r * n + c] as number) - (fr * yi + fi * yr);
      }
      const yr = br[k] as number;
      const yi = bi[k] as number;
      br[r] = (br[r] as number) - (fr * yr - fi * yi);
      bi[r] = (bi[r] as number) - (fr * yi + fi * yr);
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let sr = br[r] as number;
    let si = bi[r] as number;
    for (let c = r + 1; c < n; c++) {
      const xr = ar[r * n + c] as number;
      const xi = ai[r * n + c] as number;
      const yr = br[c] as number;
      const yi = bi[c] as number;
      sr -= xr * yr - xi * yi;
      si -= xr * yi + xi * yr;
    }
    const pr = ar[r * n + r] as number;
    const pi = ai[r * n + r] as number;
    const pd = pr * pr + pi * pi;
    br[r] = (sr * pr + si * pi) / pd;
    bi[r] = (si * pr - sr * pi) / pd;
  }
  return true;
}

export function frequencies(from: number, to: number, perDecade: number): Float64Array {
  if (!(from > 0 && to >= from)) throw new AnalysisError('Set a frequency range above zero, with the end above the start.');
  if (to === from) return Float64Array.of(from);
  const decades = Math.log10(to / from);
  const n = Math.max(2, Math.min(20_000, Math.round(decades * Math.max(1, perDecade)) + 1));
  return sweepValues(from, to, n, true);
}

function smallSignal(doc: CircuitDoc, s: AcSettings, outputs: readonly Signal[]): { x: Float64Array; re: Float64Array[]; im: Float64Array[]; warnings: string[] } {
  const built = prepare(doc);
  const { circuit, runtimes, connectivity } = built;
  const warnings = [...built.problems];
  const sourcePart = doc.parts.find((p) => p.id === s.source);
  const source = runtimes.get(s.source)?.elements[0];
  if (!sourcePart || !(source instanceof VoltageSource || source instanceof CurrentSource)) throw new AnalysisError('Choose a battery, signal generator, supply rail or current source as the input.');
  const op = circuit.operatingPoint();
  if (!op.ok || !op.settled) throw new AnalysisError(circuit.trouble || 'No DC operating point was found to work from.');
  const n = circuit.rows;
  const x0 = circuit.x;
  // Each element's stamp at dt = 1 s and dt = 0.5 s: conductance g and capacitance c with value = g + c/dt.
  const ctxAt = (dt: number): Context => ({ t: circuit.t, dt, dc: false, v: (k) => circuit.v(k), previous: (k) => circuit.v(k), sourceCurrent: (e, k) => circuit.sourceCurrent(e, k) });
  const one = ctxAt(1);
  const half = ctxAt(0.5);
  const entries = new Map<Element, Entries>();
  const direct: Element[] = [];
  const recorder = new Recorder(circuit);
  for (const e of circuit.elements) {
    if (e.ac) {
      direct.push(e);
      continue;
    }
    recorder.clear();
    e.stamp(recorder, one);
    const rows = [...recorder.rows];
    const cols = [...recorder.cols];
    const v1 = [...recorder.vals];
    recorder.clear();
    e.stamp(recorder, half);
    const v2 = recorder.vals;
    const same = v2.length === v1.length && recorder.rows.every((r, i) => r === rows[i] && recorder.cols[i] === cols[i]);
    const g: number[] = [];
    const c: number[] = [];
    v1.forEach((a, i) => {
      const b = same ? (v2[i] as number) : a;
      c.push(b - a);
      g.push(2 * a - b);
    });
    entries.set(e, { rows, cols, g, c });
  }
  // The excitation: one volt (or ampere) at the chosen source.
  const exciteRe = new Float64Array(n);
  if (source instanceof VoltageSource) {
    const [p, m] = source.nodes as [number, number];
    if (source.sources) exciteRe[circuit.sourceRow(source, 0)] = 1;
    else {
      const g = 1 / source.internal;
      if (p > 0) exciteRe[p - 1] = (exciteRe[p - 1] as number) + g;
      if (m > 0) exciteRe[m - 1] = (exciteRe[m - 1] as number) - g;
    }
  } else {
    const [from, to] = source.nodes as [number, number];
    if (from > 0) exciteRe[from - 1] = (exciteRe[from - 1] as number) - 1;
    if (to > 0) exciteRe[to - 1] = (exciteRe[to - 1] as number) + 1;
  }
  const x = frequencies(s.from, s.to, s.perDecade);
  const re = outputs.map(() => new Float64Array(x.length).fill(Number.NaN));
  const im = outputs.map(() => new Float64Array(x.length).fill(Number.NaN));
  const probes = probesFor(outputs, built);
  const partEntries = (probe: Probe) => probe.elements.map((e) => entries.get(e)).filter((e): e is Entries => e !== undefined);
  const partDirect = (probe: Probe) => probe.elements.filter((e) => e.ac);
  const acRecorder = (omega: number, elements: readonly Element[]) => {
    const r = new AcRecorder(circuit);
    for (const e of elements) e.ac?.(r, omega, circuit);
    return r;
  };
  let singular = 0;
  x.forEach((f, i) => {
    const omega = 2 * Math.PI * f;
    const m = new ComplexMatrix(n, circuit);
    for (let r = 0; r < connectivity.nodeCount; r++) m.add(r, r, circuit.gmin, 0);
    for (const en of entries.values()) for (let k = 0; k < en.rows.length; k++) m.add(en.rows[k] as number, en.cols[k] as number, en.g[k] as number, omega * (en.c[k] as number));
    for (const e of direct) e.ac?.(m, omega, circuit);
    const br = Float64Array.from(exciteRe);
    const bi = new Float64Array(n);
    if (!solveComplex(m.re, m.im, br, bi, n)) {
      singular++;
      return;
    }
    const node = (k: number): [number, number] => (k > 0 ? [br[k - 1] as number, bi[k - 1] as number] : [0, 0]);
    probes.forEach((probe, k) => {
      const { signal, nodes } = probe;
      let value: [number, number] = [Number.NaN, Number.NaN];
      if (signal.kind === 'v') {
        if (signal.terminal !== undefined) {
          const nd = nodes[signal.terminal];
          if (nd !== undefined && nd >= 0) value = node(nd);
        } else if (nodes.length >= 2 && (nodes[0] ?? -1) >= 0 && (nodes[1] ?? -1) >= 0) {
          const a = node(nodes[0] as number);
          const b = node(nodes[1] as number);
          value = [a[0] - b[0], a[1] - b[1]];
        } else if ((nodes[0] ?? -1) >= 0) value = node(nodes[0] as number);
      } else if (signal.kind === 'i') {
        const t = signal.terminal ?? 0;
        const flow = (terminal: number): [number, number] | null => {
          const nd = nodes[terminal];
          if (nd === undefined || nd <= 0) return null;
          const row = nd - 1;
          let sr = 0;
          let si = 0;
          for (const en of partEntries(probe))
            for (let q = 0; q < en.rows.length; q++) {
              if (en.rows[q] !== row) continue;
              const col = en.cols[q] as number;
              const gr = en.g[q] as number;
              const gi = omega * (en.c[q] as number);
              sr += gr * (br[col] as number) - gi * (bi[col] as number);
              si += gr * (bi[col] as number) + gi * (br[col] as number);
            }
          const d = partDirect(probe);
          if (d.length) {
            const r = acRecorder(omega, d);
            for (let q = 0; q < r.rows.length; q++) {
              if (r.rows[q] !== row) continue;
              const col = r.cols[q] as number;
              sr += (r.re[q] as number) * (br[col] as number) - (r.im[q] as number) * (bi[col] as number);
              si += (r.re[q] as number) * (bi[col] as number) + (r.im[q] as number) * (br[col] as number);
            }
          }
          return [sr, si];
        };
        const direct = flow(t);
        if (direct) value = direct;
        else if (nodes.length === 2) {
          const other = flow(1 - t);
          if (other) value = [-other[0], -other[1]];
        }
      }
      (re[k] as Float64Array)[i] = value[0];
      (im[k] as Float64Array)[i] = value[1];
    });
  });
  void x0;
  if (singular) warnings.push(`The circuit could not be solved at ${singular} frequencies.`);
  if (outputs.some((o) => o.kind === 'p')) warnings.push('Power is not shown in frequency analysis.');
  return { x, re, im, warnings };
}

/* --------------------------------------------------------------------- run -- */

function stepLabel(doc: CircuitDoc, stepping: Stepping, value: number, names: Map<string, string>): string {
  const part = doc.parts.find((p) => p.id === stepping.part);
  const def = part ? PART_BY_TYPE.get(part.type)?.props.find((d) => d.key === stepping.prop) : undefined;
  const unit = def?.unit ?? '';
  return `${names.get(stepping.part) ?? '?'} ${def?.label.toLowerCase() ?? stepping.prop} = ${formatValue(value, unit)}`;
}

/** A value with an SI prefix, as in the editor (1 kΩ, 4.7 µF). */
export function formatValue(v: number, unit: string, digits = 4): string {
  if (!Number.isFinite(v)) return '—';
  if (v === 0) return `0 ${unit}`.trim();
  const prefixes: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'G'],
    [1e6, 'M'],
    [1e3, 'k'],
    [1, ''],
    [1e-3, 'm'],
    [1e-6, 'µ'],
    [1e-9, 'n'],
    [1e-12, 'p'],
    [1e-15, 'f'],
  ];
  const a = Math.abs(v);
  const [scale, prefix] = prefixes.find(([s]) => a >= s * 0.9995) ?? [1e-15, 'f'];
  const text = String(Number((v / scale).toPrecision(digits))).replace('-', '−');
  return `${text} ${prefix}${unit}`.trim();
}

/**
 * Runs an analysis.  Sweeps return traces for every output (and every
 * stepped value); the operating point returns every node and part.
 */
export async function runAnalysis(doc: CircuitDoc, settings: AnalysisSettings, options: RunOptions = {}): Promise<AnalysisResult> {
  if (settings.kind === 'op') return operatingPoint(doc);
  const outputs = settings.outputs.filter((o) => doc.parts.some((p) => p.id === o.part));
  if (!outputs.length) throw new AnalysisError('Choose at least one voltage or current to plot.');
  const names = partNames(doc);
  const stepping = settings.stepping?.values.length && doc.parts.some((p) => p.id === settings.stepping?.part) ? settings.stepping : null;
  const runs: (number | undefined)[] = stepping ? stepping.values.slice(0, 20) : [undefined];
  const traces: Trace[] = [];
  const warnings: string[] = [];
  let x: Float64Array = new Float64Array(0);
  for (let r = 0; r < runs.length; r++) {
    const value = runs[r];
    const d = stepping && value !== undefined ? withProp(doc, stepping.part, stepping.prop, value) : doc;
    const suffix = stepping && value !== undefined ? ` (${stepLabel(doc, stepping, value, names)})` : '';
    const label = (o: Signal) => `${signalLabel(o, doc, names)}${suffix}`;
    const extra = stepping && value !== undefined ? { stepValue: value } : {};
    if (settings.kind === 'dc') {
      if (!settings.dc) throw new AnalysisError('Choose a part value to sweep.');
      const out = dcSweep(d, settings.dc, outputs);
      x = out.x;
      out.values.forEach((values, k) => {
        traces.push({ label: label(outputs[k] as Signal), signal: outputs[k] as Signal, unit: signalUnit((outputs[k] as Signal).kind), values, ...extra });
      });
      warnings.push(...out.warnings);
    } else if (settings.kind === 'tran') {
      if (!settings.tran) throw new AnalysisError('Set how long to simulate.');
      const out = await transient(d, settings.tran, outputs, options, [r / runs.length, (r + 1) / runs.length]);
      // Runs that stopped early are padded so every trace shares the time axis of the first.
      if (!x.length) x = out.x;
      out.values.forEach((values, k) => {
        const padded = new Float64Array(x.length).fill(Number.NaN);
        padded.set(values.subarray(0, Math.min(values.length, x.length)));
        traces.push({ label: label(outputs[k] as Signal), signal: outputs[k] as Signal, unit: signalUnit((outputs[k] as Signal).kind), values: padded, ...extra });
      });
      warnings.push(...out.warnings);
    } else {
      if (!settings.ac) throw new AnalysisError('Choose the input source for frequency analysis.');
      const out = smallSignal(d, settings.ac, outputs);
      x = out.x;
      out.re.forEach((values, k) => {
        const signal = outputs[k] as Signal;
        if (signal.kind === 'p') return;
        traces.push({ label: label(signal), signal, unit: signalUnit(signal.kind), values, imag: out.im[k] as Float64Array, ...extra });
      });
      warnings.push(...out.warnings);
    }
    options.onProgress?.((r + 1) / runs.length);
    if (options.signal?.aborted) throw new AnalysisError('Stopped.');
    if (runs.length > 1) await tick();
  }
  const kind = settings.kind;
  const sweepPart = settings.dc ? doc.parts.find((p) => p.id === settings.dc?.part) : undefined;
  const sweepDef = sweepPart ? PART_BY_TYPE.get(sweepPart.type)?.props.find((p) => p.key === settings.dc?.prop) : undefined;
  return {
    kind,
    x,
    xLabel: kind === 'tran' ? 'Time' : kind === 'ac' ? 'Frequency' : `${names.get(settings.dc?.part ?? '') ?? ''} ${sweepDef?.label.toLowerCase() ?? ''}`.trim(),
    xUnit: kind === 'tran' ? 's' : kind === 'ac' ? 'Hz' : (sweepDef?.unit ?? ''),
    logX: kind === 'ac' || (kind === 'dc' && settings.dc?.log === true),
    traces,
    warnings: [...new Set(warnings)],
  };
}

/* ------------------------------------------------------------- measurements -- */

export const magnitudeDb = (re: number, im: number) => 20 * Math.log10(Math.hypot(re, im));
export const phaseDegrees = (re: number, im: number) => (Math.atan2(im, re) * 180) / Math.PI;

/** Phase in degrees, unwrapped so it runs on without jumping by 360°. */
export function unwrappedPhase(re: Float64Array, im: Float64Array): Float64Array {
  const out = new Float64Array(re.length);
  let offset = 0;
  let last = Number.NaN;
  for (let i = 0; i < re.length; i++) {
    let p = phaseDegrees(re[i] as number, im[i] as number);
    if (!Number.isFinite(p)) {
      out[i] = Number.NaN;
      continue;
    }
    p += offset;
    if (Number.isFinite(last)) {
      while (p - last > 180) {
        p -= 360;
        offset -= 360;
      }
      while (p - last < -180) {
        p += 360;
        offset += 360;
      }
    }
    out[i] = p;
    last = p;
  }
  return out;
}

/** Linear interpolation of y at x (x ascending); log-x interpolates on log(x). */
export function valueAt(xs: Float64Array, ys: Float64Array, at: number, logX = false): number {
  const n = xs.length;
  if (!n) return Number.NaN;
  if (at <= (xs[0] as number)) return ys[0] as number;
  if (at >= (xs[n - 1] as number)) return ys[n - 1] as number;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((xs[mid] as number) <= at) lo = mid;
    else hi = mid;
  }
  const x0 = xs[lo] as number;
  const x1 = xs[hi] as number;
  const f = logX ? Math.log(at / x0) / Math.log(x1 / x0) : (at - x0) / (x1 - x0);
  return (ys[lo] as number) + ((ys[hi] as number) - (ys[lo] as number)) * f;
}

/** Where the curve first crosses `level` after index `from` (interpolated), or NaN. */
function crossing(xs: Float64Array, ys: Float64Array, level: number, from: number, logX: boolean, direction: 'down' | 'up' | 'any' = 'any'): number {
  for (let i = from + 1; i < ys.length; i++) {
    const a = (ys[i - 1] as number) - level;
    const b = (ys[i] as number) - level;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const down = a > 0 && b <= 0;
    const up = a < 0 && b >= 0;
    if ((direction === 'down' && down) || (direction === 'up' && up) || (direction === 'any' && (down || up))) {
      const f = a / (a - b);
      const x0 = xs[i - 1] as number;
      const x1 = xs[i] as number;
      return logX ? x0 * (x1 / x0) ** f : x0 + (x1 - x0) * f;
    }
  }
  return Number.NaN;
}

export interface TimeStats {
  readonly min: number;
  readonly max: number;
  readonly average: number;
  readonly rms: number;
  readonly frequency: number;
}

/** Statistics of a time-domain trace (time-weighted average and RMS; frequency from mean crossings). */
export function timeStats(t: Float64Array, v: Float64Array): TimeStats {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let area = 0;
  let square = 0;
  let span = 0;
  for (let i = 0; i < v.length; i++) {
    const y = v[i] as number;
    if (!Number.isFinite(y)) continue;
    min = Math.min(min, y);
    max = Math.max(max, y);
    if (i > 0 && Number.isFinite(v[i - 1] as number)) {
      const dt = (t[i] as number) - (t[i - 1] as number);
      const a = v[i - 1] as number;
      area += ((a + y) / 2) * dt;
      square += ((a * a + y * y) / 2) * dt;
      span += dt;
    }
  }
  const average = span > 0 ? area / span : Number.NaN;
  const rms = span > 0 ? Math.sqrt(square / span) : Number.NaN;
  // Frequency from rising crossings of the mid-level with a little hysteresis.
  let frequency = Number.NaN;
  if (max - min > 1e-9) {
    const mid = (max + min) / 2;
    const h = (max - min) * 0.05;
    const rises: number[] = [];
    let below = (v[0] as number) < mid - h;
    for (let i = 1; i < v.length; i++) {
      const y = v[i] as number;
      if (below && y > mid + h) {
        rises.push(t[i] as number);
        below = false;
      } else if (!below && y < mid - h) below = true;
    }
    if (rises.length >= 2) frequency = (rises.length - 1) / ((rises.at(-1) as number) - (rises[0] as number));
  }
  return { min, max, average, rms, frequency };
}

export interface FrequencyStats {
  /** Gain at the lowest frequency, dB. */
  readonly lowGain: number;
  readonly peakGain: number;
  readonly peakFrequency: number;
  /** Where the gain is 3 dB below its peak, below and above the peak (NaN if it does not fall that far). */
  readonly lowerCorner: number;
  readonly upperCorner: number;
  /** Where the gain crosses 0 dB going down, and the phase there. */
  readonly unityGain: number;
  readonly phaseAtUnity: number;
}

export function frequencyStats(f: Float64Array, re: Float64Array, im: Float64Array): FrequencyStats {
  const db = Float64Array.from(re, (r, i) => magnitudeDb(r, im[i] as number));
  let peak = 0;
  for (let i = 1; i < db.length; i++) if ((db[i] as number) > (db[peak] as number)) peak = i;
  const peakGain = db[peak] as number;
  const level = peakGain - 3.0103;
  // Lower corner: the last crossing going up before the peak.
  let lowerCorner = Number.NaN;
  for (let i = peak; i > 0; i--) {
    const a = (db[i - 1] as number) - level;
    const b = (db[i] as number) - level;
    if (a < 0 && b >= 0) {
      const frac = a / (a - b);
      lowerCorner = (f[i - 1] as number) * ((f[i] as number) / (f[i - 1] as number)) ** frac;
      break;
    }
  }
  const upperCorner = crossing(f, db, level, peak, true, 'down');
  const unityGain = crossing(f, db, 0, 0, true, 'down');
  const phase = unwrappedPhase(re, im);
  return {
    lowGain: db[0] as number,
    peakGain,
    peakFrequency: f[peak] as number,
    lowerCorner,
    upperCorner,
    unityGain,
    phaseAtUnity: Number.isFinite(unityGain) ? valueAt(f, phase, unityGain, true) : Number.NaN,
  };
}

/* ---------------------------------------------------------------- spectrum -- */

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i] as number;
      re[i] = re[j] as number;
      re[j] = t;
      t = im[i] as number;
      im[i] = im[j] as number;
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = (re[b] as number) * cr - (im[b] as number) * ci;
        const xi = (re[b] as number) * ci + (im[b] as number) * cr;
        re[b] = (re[a] as number) - xr;
        im[b] = (im[a] as number) - xi;
        re[a] = (re[a] as number) + xr;
        im[a] = (im[a] as number) + xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export interface Spectrum {
  readonly frequency: Float64Array;
  /** Peak amplitude of each component (the first is the average). */
  readonly amplitude: Float64Array;
  readonly fundamental: number;
  /** Total harmonic distortion relative to the fundamental (0.01 = 1 %), from harmonics 2 to 10. */
  readonly thd: number;
}

/**
 * The spectrum of a time-domain trace over [from, to] (a Hann window over
 * up to 8192 evenly spaced samples).
 */
export function spectrum(t: Float64Array, v: Float64Array, from: number, to: number): Spectrum {
  const inside = t.filter((x) => x >= from && x <= to).length;
  let n = 64;
  while (n < Math.min(inside, 8192)) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const span = to - from;
  let sumW = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    const y = valueAt(t, v, from + (span * i) / n);
    re[i] = (Number.isFinite(y) ? y : 0) * w;
    sumW += w;
  }
  fft(re, im);
  const bins = n / 2;
  const frequency = new Float64Array(bins);
  const amplitude = new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
    frequency[k] = k / span;
    amplitude[k] = (Math.hypot(re[k] as number, im[k] as number) / sumW) * (k === 0 ? 1 : 2);
  }
  // Fundamental: the strongest component above DC (skipping the window's leakage next to DC).
  let fk = 2;
  for (let k = 2; k < bins; k++) if ((amplitude[k] as number) > (amplitude[fk] as number)) fk = k;
  const band = (k: number) => {
    let a = 0;
    for (let j = Math.max(1, k - 2); j <= Math.min(bins - 1, k + 2); j++) a += (amplitude[j] as number) ** 2;
    return Math.sqrt(a);
  };
  const fundamentalAmp = band(fk);
  let harmonics = 0;
  for (let h = 2; h <= 10 && h * fk < bins - 2; h++) harmonics += band(h * fk) ** 2;
  return { frequency, amplitude, fundamental: frequency[fk] as number, thd: fundamentalAmp > 0 ? Math.sqrt(harmonics) / fundamentalAmp : Number.NaN };
}

/* --------------------------------------------------------------------- CSV -- */

const csvCell = (v: number) => (Number.isFinite(v) ? String(Number(v.toPrecision(9))) : '');
const csvText = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** The results as CSV: one column for x, then one (or, for frequency analysis, two: dB and degrees) per trace. */
export function sweepCsv(sweep: Sweep): string {
  const head = [`${sweep.xLabel} (${sweep.xUnit})`];
  const columns: Float64Array[] = [sweep.x];
  for (const tr of sweep.traces) {
    if (tr.imag) {
      head.push(`${tr.label} gain (dB)`, `${tr.label} phase (degrees)`);
      columns.push(
        Float64Array.from(tr.values, (r, i) => magnitudeDb(r, tr.imag?.[i] as number)),
        unwrappedPhase(tr.values, tr.imag),
      );
    } else {
      head.push(`${tr.label} (${tr.unit})`);
      columns.push(tr.values);
    }
  }
  const lines = [head.map(csvText).join(',')];
  for (let i = 0; i < sweep.x.length; i++) lines.push(columns.map((c) => csvCell(c[i] as number)).join(','));
  return `${lines.join('\n')}\n`;
}

export function operatingPointCsv(op: OperatingPoint, doc: CircuitDoc): string {
  const names = partNames(doc);
  const lines = ['Part,Terminal,Voltage (V),Current in (A),Power (W)'];
  for (const part of doc.parts) {
    const r = op.parts.get(part.id);
    const def = PART_BY_TYPE.get(part.type);
    if (!r || !def) continue;
    def.terminals.forEach((t, k) => {
      lines.push([csvText(names.get(part.id) ?? part.id), csvText(t.name), csvCell(r.volts[k] as number), csvCell(r.currents[k] as number), k === 0 ? csvCell(r.power) : ''].join(','));
    });
  }
  return `${lines.join('\n')}\n`;
}
