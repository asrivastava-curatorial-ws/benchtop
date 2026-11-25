import { describe, expect, it } from 'vitest';
import {
  type AnalysisSettings,
  frequencyStats,
  magnitudeDb,
  type OperatingPoint,
  operatingPoint,
  partNames,
  phaseDegrees,
  runAnalysis,
  type Signal,
  type Sweep,
  spectrum,
  sweepCsv,
  type Trace,
  timeStats,
  valueAt,
} from '../../src/lib/circuit/analysis';
import { EXAMPLES } from '../../src/lib/circuit/examples';
import { evaluate, isProper, parseTransfer, stateSpace } from '../../src/lib/circuit/laplace';
import { type CircuitDoc, type PlacedPart, parseDoc, terminalPoints, toSpice, type WireSegment } from '../../src/lib/circuit/netlist';
import { defaultProps, PART_BY_TYPE } from '../../src/lib/circuit/parts';

/* A small circuit builder: parts far apart, terminals joined to shared net points by (diagonal) wires. */
class Net {
  readonly parts: PlacedPart[] = [];
  readonly wires: WireSegment[] = [];
  private readonly nets = new Map<string, [number, number]>();
  add(id: string, type: string, props: Record<string, number | string | boolean> = {}): string {
    const def = PART_BY_TYPE.get(type);
    if (!def) throw new Error(type);
    const k = this.parts.length;
    this.parts.push({ id, type, x: 40 * k, y: 7 * k * k, rot: 0, props: { ...defaultProps(def), ...props } });
    return id;
  }
  /** Joins terminal `terminal` of part `id` to the named net ('0' is ground). */
  join(id: string, terminal: string, net: string): void {
    const part = this.parts.find((p) => p.id === id) as PlacedPart;
    const def = PART_BY_TYPE.get(part.type);
    const index = def?.terminals.findIndex((t) => t.name === terminal) ?? -1;
    if (index < 0) throw new Error(`${part.type} has no ${terminal}`);
    const [x, y] = terminalPoints(part)[index] as [number, number];
    let at = this.nets.get(net);
    if (!at) {
      const k = this.nets.size;
      at = [-997 - 131 * k, 1009 + 173 * k + k * k];
      this.nets.set(net, at);
      if (net === '0') {
        const g = this.add(`gnd`, 'ground');
        const gp = this.parts.find((p) => p.id === g) as PlacedPart;
        const [gx, gy] = terminalPoints(gp)[0] as [number, number];
        this.wires.push({ id: `w${this.wires.length}`, x1: gx, y1: gy, x2: at[0], y2: at[1] });
      }
    }
    this.wires.push({ id: `w${this.wires.length}`, x1: x, y1: y, x2: at[0], y2: at[1] });
  }
  doc(analysis?: AnalysisSettings, dt = 1e-5): CircuitDoc {
    return { version: 1, title: 'test', parts: this.parts, wires: this.wires, dt, speed: 1, ...(analysis ? { analysis } : {}) };
  }
}

const close = (a: number, b: number, relative: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.abs(b) * relative);

function divider(): Net {
  const n = new Net();
  n.add('b', 'battery', { v: 12 });
  n.add('r1', 'resistor', { r: 10_000 });
  n.add('r2', 'resistor', { r: 4700 });
  n.join('b', '+', 'top');
  n.join('b', '−', '0');
  n.join('r1', 'a', 'top');
  n.join('r1', 'b', 'mid');
  n.join('r2', 'a', 'mid');
  n.join('r2', 'b', '0');
  return n;
}

function rcLowPass(r = 1000, c = 1e-6): Net {
  const n = new Net();
  n.add('src', 'ac-source', { shape: 'sine', amplitude: 1, f: 100 });
  n.add('r', 'resistor', { r });
  n.add('c', 'capacitor', { c });
  n.add('p', 'probe');
  n.join('src', '+', 'in');
  n.join('src', '−', '0');
  n.join('r', 'a', 'in');
  n.join('r', 'b', 'out');
  n.join('c', 'a', 'out');
  n.join('c', 'b', '0');
  n.join('p', 'probe', 'out');
  return n;
}

const ac = (source: string, outputs: Signal[], from = 1, to = 1e6, perDecade = 50): AnalysisSettings => ({ kind: 'ac', outputs, ac: { source, from, to, perDecade } });

describe('operating point', () => {
  it('solves a divider with currents and powers', () => {
    const n = divider();
    const op = operatingPoint(n.doc());
    const r2 = op.parts.get('r2');
    const b = op.parts.get('b');
    close(r2?.volts[0] as number, (12 * 4700) / 14_700, 1e-6);
    close(r2?.currents[0] as number, 12 / 14_700, 1e-6);
    close(r2?.power as number, (12 / 14_700) ** 2 * 4700, 1e-6);
    // The battery delivers the power the resistors take.
    close(b?.power as number, -(12 * 12) / 14_700, 1e-6);
    close(b?.currents[0] as number, -12 / 14_700, 1e-6);
  });

  it('puts a silicon diode at its forward voltage', () => {
    const n = new Net();
    n.add('b', 'battery', { v: 5 });
    n.add('r', 'resistor', { r: 1000 });
    n.add('d', 'diode');
    n.join('b', '+', 'top');
    n.join('b', '−', '0');
    n.join('r', 'a', 'top');
    n.join('r', 'b', 'a');
    n.join('d', 'anode', 'a');
    n.join('d', 'cathode', '0');
    const op = operatingPoint(n.doc());
    const d = op.parts.get('d');
    expect(d?.volts[0]).toBeGreaterThan(0.6);
    expect(d?.volts[0]).toBeLessThan(0.8);
    close(d?.currents[0] as number, (5 - (d?.volts[0] as number)) / 1000, 1e-4);
  });

  it('treats capacitors as open and inductors as shorts, and generators at their offset', () => {
    const n = new Net();
    n.add('src', 'ac-source', { shape: 'sine', amplitude: 3, offset: 2, f: 50 });
    n.add('l', 'inductor', { l: 0.1 });
    n.add('c', 'capacitor', { c: 1e-6 });
    n.add('r', 'resistor', { r: 100 });
    n.join('src', '+', 'in');
    n.join('src', '−', '0');
    n.join('l', 'a', 'in');
    n.join('l', 'b', 'x');
    n.join('r', 'a', 'x');
    n.join('r', 'b', '0');
    n.join('c', 'a', 'x');
    n.join('c', 'b', '0');
    const op = operatingPoint(n.doc());
    close(op.parts.get('r')?.volts[0] as number, 2, 1e-6);
    close(op.parts.get('l')?.currents[0] as number, 0.02, 1e-6);
    expect(Math.abs(op.parts.get('c')?.currents[0] as number)).toBeLessThan(1e-9);
  });

  it('names parts by kind unless they have their own name', () => {
    const n = divider();
    const named = { ...n.doc(), parts: n.doc().parts.map((p) => (p.id === 'r2' ? { ...p, name: 'Rload' } : p)) };
    const names = partNames(named);
    expect(names.get('r1')).toBe('R1');
    expect(names.get('r2')).toBe('Rload');
    expect(names.get('b')).toBe('V1');
  });
});

describe('frequency analysis', () => {
  it('finds an RC low-pass corner at 1/(2πRC) with −45° there', async () => {
    const n = rcLowPass();
    const sweep = (await runAnalysis(n.doc(), ac('src', [{ kind: 'v', part: 'p' }]))) as Sweep;
    const tr = sweep.traces[0];
    expect(tr?.imag).toBeDefined();
    const stats = frequencyStats(sweep.x, tr?.values as Float64Array, tr?.imag as Float64Array);
    const fc = 1 / (2 * Math.PI * 1000 * 1e-6);
    close(stats.upperCorner, fc, 0.01);
    expect(Math.abs(stats.lowGain)).toBeLessThan(0.01);
    const re = valueAt(sweep.x, tr?.values as Float64Array, fc, true);
    const im = valueAt(sweep.x, tr?.imag as Float64Array, fc, true);
    expect(phaseDegrees(re, im)).toBeCloseTo(-45, 0);
    // Current through the capacitor at high frequency ≈ input / R.
    const current = (await runAnalysis(n.doc(), ac('src', [{ kind: 'i', part: 'r' }], 1e5, 1e5, 1))) as Sweep;
    const ir = current.traces[0];
    close(Math.hypot(ir?.values[0] as number, ir?.imag?.[0] as number), 1 / 1000, 0.01);
  });

  it('gives an inverting amplifier its gain and the op-amp’s bandwidth', async () => {
    const n = new Net();
    n.add('src', 'ac-source', { shape: 'sine', amplitude: 0.1, f: 1000 });
    n.add('rin', 'resistor', { r: 10_000 });
    n.add('rf', 'resistor', { r: 47_000 });
    n.add('u', 'opamp', { gbw: 1e6 });
    n.add('p', 'probe');
    n.join('src', '+', 'in');
    n.join('src', '−', '0');
    n.join('rin', 'a', 'in');
    n.join('rin', 'b', 'sum');
    n.join('rf', 'a', 'sum');
    n.join('rf', 'b', 'out');
    n.join('u', '−', 'sum');
    n.join('u', '+', '0');
    n.join('u', 'out', 'out');
    n.join('p', 'probe', 'out');
    const sweep = (await runAnalysis(n.doc(), ac('src', [{ kind: 'v', part: 'p' }], 10, 1e7, 40))) as Sweep;
    const tr = sweep.traces[0];
    const stats = frequencyStats(sweep.x, tr?.values as Float64Array, tr?.imag as Float64Array);
    close(stats.lowGain, 20 * Math.log10(4.7), 0.002);
    expect(Math.abs(phaseDegrees(tr?.values[0] as number, tr?.imag?.[0] as number))).toBeCloseTo(180, 0);
    // Closed-loop bandwidth ≈ GBW / noise gain (1 + 4.7).
    close(stats.upperCorner, 1e6 / 5.7, 0.1);
  });

  it('steps a transformer down by its turns ratio', async () => {
    const n = new Net();
    n.add('src', 'ac-source', { shape: 'sine', amplitude: 10, f: 50 });
    n.add('t', 'transformer', { ratio: 10, lp: 10, k: 0.9999 });
    n.add('load', 'resistor', { r: 1000 });
    n.join('src', '+', 'in');
    n.join('src', '−', '0');
    n.join('t', 'P1', 'in');
    n.join('t', 'P2', '0');
    n.join('t', 'S1', 'sec');
    n.join('t', 'S2', '0');
    n.join('load', 'a', 'sec');
    n.join('load', 'b', '0');
    const sweep = (await runAnalysis(n.doc(), ac('src', [{ kind: 'v', part: 'load' }], 50, 5000, 10))) as Sweep;
    const tr = sweep.traces[0];
    expect(magnitudeDb(tr?.values[0] as number, tr?.imag?.[0] as number)).toBeCloseTo(-20, 1);
  });

  it('matches a Laplace block to its transfer function', async () => {
    const n = new Net();
    n.add('src', 'ac-source', { shape: 'sine', amplitude: 1, f: 10 });
    n.add('h', 'laplace', { h: '100/(s^2 + 10s + 100)' });
    n.add('p', 'probe');
    n.join('src', '+', 'in');
    n.join('src', '−', '0');
    n.join('h', 'in', 'in');
    n.join('h', 'out', 'out');
    n.join('p', 'probe', 'out');
    const sweep = (await runAnalysis(n.doc(), ac('src', [{ kind: 'v', part: 'p' }], 0.1, 100, 20))) as Sweep;
    const tr = sweep.traces[0];
    const h = parseTransfer('100/(s^2 + 10s + 100)');
    sweep.x.forEach((f, i) => {
      const [re, im] = evaluate(h, 2 * Math.PI * f);
      expect(tr?.values[i]).toBeCloseTo(re, 9);
      expect(tr?.imag?.[i]).toBeCloseTo(im, 9);
    });
  });

  it('steps a part value and overlays the runs', async () => {
    const n = rcLowPass();
    const settings: AnalysisSettings = { ...ac('src', [{ kind: 'v', part: 'p' }], 1, 1e5, 40), stepping: { part: 'r', prop: 'r', values: [1000, 2000] } };
    const sweep = (await runAnalysis(n.doc(), settings)) as Sweep;
    expect(sweep.traces).toHaveLength(2);
    expect(sweep.traces[1]?.label).toContain('R1 resistance = 2 kΩ');
    const corners = sweep.traces.map((tr) => frequencyStats(sweep.x, tr.values, tr.imag as Float64Array).upperCorner);
    close(corners[0] as number, 159.15, 0.01);
    close(corners[1] as number, 79.58, 0.01);
    expect(sweepCsv(sweep).split('\n')[0]).toBe(
      'Frequency (Hz),V(P1) (R1 resistance = 1 kΩ) gain (dB),V(P1) (R1 resistance = 1 kΩ) phase (degrees),V(P1) (R1 resistance = 2 kΩ) gain (dB),V(P1) (R1 resistance = 2 kΩ) phase (degrees)',
    );
  });
});

describe('time domain', () => {
  it('charges a capacitor to 63 % in one time constant', async () => {
    const n = new Net();
    n.add('b', 'battery', { v: 5 });
    n.add('r', 'resistor', { r: 10_000 });
    n.add('c', 'capacitor', { c: 1e-6 });
    n.join('b', '+', 'in');
    n.join('b', '−', '0');
    n.join('r', 'a', 'in');
    n.join('r', 'b', 'out');
    n.join('c', 'a', 'out');
    n.join('c', 'b', '0');
    const settings: AnalysisSettings = {
      kind: 'tran',
      outputs: [
        { kind: 'v', part: 'c' },
        { kind: 'i', part: 'c' },
      ],
      tran: { stop: 0.03, step: 1e-5, fromZero: true },
    };
    const sweep = (await runAnalysis(n.doc(), settings)) as Sweep;
    const v = sweep.traces[0]?.values as Float64Array;
    close(valueAt(sweep.x, v, 0.01), 5 * (1 - Math.exp(-1)), 0.005);
    // The current starts at 5 V / 10 kΩ.
    close(sweep.traces[1]?.values[1] as number, 5e-4, 0.01);
    // From the operating point instead, it is already charged.
    const settled = (await runAnalysis(n.doc(), { ...settings, tran: { stop: 0.001, step: 1e-5 } })) as Sweep;
    close(settled.traces[0]?.values[0] as number, 5, 1e-6);
  });

  it('runs a Laplace block’s step response', async () => {
    const n = new Net();
    n.add('b', 'battery', { v: 1 });
    n.add('h', 'laplace', { h: '1/(1 + s/1k)' });
    n.add('p', 'probe');
    n.join('b', '+', 'in');
    n.join('b', '−', '0');
    n.join('h', 'in', 'in');
    n.join('h', 'out', 'out');
    n.join('p', 'probe', 'out');
    const sweep = (await runAnalysis(n.doc(), { kind: 'tran', outputs: [{ kind: 'v', part: 'p' }], tran: { stop: 0.005, step: 1e-6, fromZero: true } })) as Sweep;
    close(valueAt(sweep.x, sweep.traces[0]?.values as Float64Array, 0.001), 1 - Math.exp(-1), 0.005);
  });

  it('measures a sine wave and its spectrum', async () => {
    const n = rcLowPass(10, 1e-9);
    const sweep = (await runAnalysis(n.doc(), { kind: 'tran', outputs: [{ kind: 'v', part: 'p' }], tran: { stop: 0.05, step: 2e-5 } })) as Sweep;
    const v = sweep.traces[0]?.values as Float64Array;
    const stats = timeStats(sweep.x, v);
    close(stats.max, 1, 0.01);
    close(stats.rms, Math.SQRT1_2, 0.01);
    close(stats.frequency, 100, 0.01);
    const sp = spectrum(sweep.x, v, 0.01, 0.05);
    close(sp.fundamental, 100, 0.05);
    expect(sp.thd).toBeLessThan(0.01);
  });

  it('finds the harmonics of a square wave', () => {
    const t = Float64Array.from({ length: 20_000 }, (_, i) => i * 1e-5);
    const v = Float64Array.from(t, (x) => ((x * 50) % 1 < 0.5 ? 1 : -1));
    const sp = spectrum(t, v, 0, 0.2);
    close(sp.fundamental, 50, 0.05);
    // A square wave's THD is about 48 % (harmonics 3, 5, 7, 9 here).
    expect(sp.thd).toBeGreaterThan(0.4);
    expect(sp.thd).toBeLessThan(0.5);
  });
});

describe('DC sweep', () => {
  it('traces a diode’s current against its supply', async () => {
    const n = new Net();
    n.add('b', 'battery', { v: 1 });
    n.add('r', 'resistor', { r: 100 });
    n.add('d', 'diode');
    n.join('b', '+', 'top');
    n.join('b', '−', '0');
    n.join('r', 'a', 'top');
    n.join('r', 'b', 'a');
    n.join('d', 'anode', 'a');
    n.join('d', 'cathode', '0');
    const sweep = (await runAnalysis(n.doc(), { kind: 'dc', outputs: [{ kind: 'i', part: 'd' }], dc: { part: 'b', prop: 'v', from: 0, to: 2, points: 41 } })) as Sweep;
    const i = sweep.traces[0]?.values as Float64Array;
    expect(sweep.xLabel).toBe('V1 voltage');
    expect(i[0]).toBeCloseTo(0, 9);
    for (let k = 1; k < i.length; k++) expect(i[k] as number).toBeGreaterThanOrEqual((i[k - 1] as number) - 1e-12);
    expect(i[40] as number).toBeGreaterThan(0.01);
  });
});

describe('analog parts', () => {
  const op = (n: Net): OperatingPoint => operatingPoint(n.doc());

  it('controlled sources give their gains', () => {
    const n = new Net();
    n.add('b', 'battery', { v: 1 });
    n.add('e', 'vcvs', { gain: 10 });
    n.add('g', 'vccs', { gm: 0.001 });
    n.add('rg', 'resistor', { r: 1000 });
    for (const id of ['e', 'g']) {
      n.join(id, 'in+', 'in');
      n.join(id, 'in−', '0');
      n.join(id, 'out−', '0');
    }
    n.join('b', '+', 'in');
    n.join('b', '−', '0');
    n.join('e', 'out+', 'eout');
    n.join('g', 'out+', 'gout');
    n.join('rg', 'a', 'gout');
    n.join('rg', 'b', '0');
    // 5 V through 5 kΩ: 1 mA through the sensing branches of H and F in series.
    n.add('b2', 'battery', { v: 5 });
    n.add('rs', 'resistor', { r: 5000 });
    n.add('h', 'ccvs', { r: 1000 });
    n.add('f', 'cccs', { gain: 10 });
    n.add('rf', 'resistor', { r: 100 });
    n.join('b2', '+', 's1');
    n.join('b2', '−', '0');
    n.join('rs', 'a', 's1');
    n.join('rs', 'b', 's2');
    n.join('h', 'sense+', 's2');
    n.join('h', 'sense−', 's3');
    n.join('f', 'sense+', 's3');
    n.join('f', 'sense−', '0');
    n.join('h', 'out+', 'hout');
    n.join('h', 'out−', '0');
    n.join('f', 'out+', 'fout');
    n.join('f', 'out−', '0');
    n.join('rf', 'a', 'fout');
    n.join('rf', 'b', '0');
    const result = op(n);
    close(result.parts.get('e')?.volts[0] as number, 10, 1e-6);
    close(result.parts.get('rg')?.volts[0] as number, 1, 1e-6);
    close(result.parts.get('h')?.volts[0] as number, 1, 1e-6);
    close(result.parts.get('rf')?.volts[0] as number, 1, 1e-6);
  });

  it('a JFET with its gate on its source passes its saturation current', () => {
    const n = new Net();
    n.add('b', 'battery', { v: 10 });
    n.add('j', 'njfet', { vp: 2, beta: 1.3e-3, lambda: 0.0023 });
    n.join('b', '+', 'd');
    n.join('b', '−', '0');
    n.join('j', 'drain', 'd');
    n.join('j', 'gate', '0');
    n.join('j', 'source', '0');
    close(op(n).parts.get('j')?.currents[1] as number, 1.3e-3 * 4 * (1 + 0.0023 * 10), 0.01);
  });

  it('a regulator holds its output until the input drops out', () => {
    const run = (vin: number) => {
      const n = new Net();
      n.add('b', 'battery', { v: vin });
      n.add('u', 'regulator', { v: 5 });
      n.add('load', 'resistor', { r: 100 });
      n.join('b', '+', 'in');
      n.join('b', '−', '0');
      n.join('u', 'IN', 'in');
      n.join('u', 'GND', '0');
      n.join('u', 'OUT', 'out');
      n.join('load', 'a', 'out');
      n.join('load', 'b', '0');
      return op(n);
    };
    const nine = run(9);
    close(nine.parts.get('load')?.volts[0] as number, 5, 0.002);
    // The input supplies the load's 50 mA and the quiescent 5 mA.
    close(-(nine.parts.get('b')?.currents[0] as number), 0.055, 0.01);
    close(run(6).parts.get('load')?.volts[0] as number, 4, 0.002);
  });

  it('a comparator switches its output', () => {
    const run = (plus: number) => {
      const n = new Net();
      n.add('b', 'battery', { v: plus });
      n.add('ref', 'battery', { v: 1 });
      n.add('u', 'comparator', { high: 5, low: 0 });
      n.add('load', 'resistor', { r: 100_000 });
      n.join('b', '+', 'p');
      n.join('b', '−', '0');
      n.join('ref', '+', 'm');
      n.join('ref', '−', '0');
      n.join('u', '+', 'p');
      n.join('u', '−', 'm');
      n.join('u', 'out', 'out');
      n.join('load', 'a', 'out');
      n.join('load', 'b', '0');
      return op(n).parts.get('load')?.volts[0] as number;
    };
    expect(run(2)).toBeGreaterThan(4.9);
    expect(run(0.5)).toBeLessThan(0.1);
  });

  it('keeps analysis settings and part names in the file', () => {
    const n = rcLowPass();
    const settings = ac('src', [{ kind: 'v', part: 'p' }]);
    const doc = { ...n.doc(settings), parts: n.doc().parts.map((p) => (p.id === 'r' ? { ...p, name: 'Rin' } : p)) };
    const back = parseDoc(JSON.parse(JSON.stringify(doc)))?.doc;
    expect(back?.analysis).toEqual(settings);
    expect(back?.parts.find((p) => p.id === 'r')?.name).toBe('Rin');
  });
});

describe('SPICE export', () => {
  it('writes the new parts and the analysis', () => {
    const n = rcLowPass();
    n.add('e', 'vcvs', { gain: 2 });
    n.add('t', 'transformer', { ratio: 10, lp: 1 });
    n.add('j', 'njfet');
    n.add('h', 'laplace', { h: '1/(1+s/1k)' });
    const text = toSpice({ ...n.doc(ac('src', [{ kind: 'v', part: 'p' }], 10, 1e5, 20)), title: 'Filter' });
    expect(text).toContain('* Filter');
    expect(text).toMatch(/^V1 \d+ 0 DC 0 SIN\(0 1 100\) AC 1$/m);
    expect(text).toMatch(/^E1 /m);
    expect(text).toMatch(/^KLT1 LT1P LT1S 0.999$/m);
    expect(text).toContain('NJF(VTO=-2 BETA=0.0013 LAMBDA=0.0023)');
    expect(text).toContain('s_xfer(num_coeff=[1000] den_coeff=[1 1000])');
    expect(text).toContain('.ac dec 20 10 100K');
    expect(text.trim().endsWith('.end')).toBe(true);
  });
});

describe('transfer functions', () => {
  it('parses expressions into polynomials', () => {
    const h = parseTransfer('1/(1 + s/1k)');
    expect(h.den).toEqual([1000, 1]);
    expect(h.num).toEqual([1000]);
    const g = parseTransfer('(s+1)(s+2)/(s^3 + 2s)');
    expect(g.num).toEqual([2, 3, 1]);
    expect(g.den).toEqual([0, 2, 0, 1]);
    expect(parseTransfer('2pi*10/(s + 2*pi*10)').num[0]).toBeCloseTo(20 * Math.PI, 9);
    expect(() => parseTransfer('1/(s')).toThrow(/closing bracket/);
    expect(() => parseTransfer('1/0')).toThrow();
    expect(isProper(parseTransfer('s^2/(s+1)'))).toBe(false);
    expect(() => stateSpace(parseTransfer('s^2/(s+1)'))).toThrow();
  });

  it('evaluates H(jω)', () => {
    const [re, im] = evaluate(parseTransfer('1/(1 + s/1000)'), 1000);
    expect(re).toBeCloseTo(0.5, 12);
    expect(im).toBeCloseTo(-0.5, 12);
  });
});

describe('analysis examples', () => {
  const example = (id: string): CircuitDoc => {
    const e = EXAMPLES.find((x) => x.id === id);
    if (!e) throw new Error(id);
    return e.make();
  };
  const run = async (doc: CircuitDoc, change: Partial<AnalysisSettings> = {}) => (await runAnalysis(doc, { ...(doc.analysis as AnalysisSettings), ...change })) as Sweep;

  it('RC filter corners move with the stepped capacitor', async () => {
    const sweep = await run(example('an-rc-filter'));
    const corners = sweep.traces.map((t) => frequencyStats(sweep.x, t.values, t.imag as Float64Array).upperCorner);
    [47e-9, 100e-9, 220e-9].forEach((c, k) => {
      close(corners[k] as number, 1 / (2 * Math.PI * 1000 * c), 0.01);
    });
  });

  it('diode and LED conduct from their forward voltages', async () => {
    const sweep = await run(example('an-diodes'));
    const [diode, led] = sweep.traces;
    expect(valueAt(sweep.x, diode?.values as Float64Array, 0.4)).toBeLessThan(1e-4);
    expect(valueAt(sweep.x, led?.values as Float64Array, 1.5)).toBeLessThan(1e-4);
    close(diode?.values.at(-1) as number, 0.042, 0.1);
    close(led?.values.at(-1) as number, 0.031, 0.15);
  });

  it('the amplifier is biased and gains about 45 dB', async () => {
    const doc = example('an-amplifier');
    const op = operatingPoint(doc);
    const q = doc.parts.find((p) => p.type === 'npn');
    const collector = op.parts.get(q?.id ?? '')?.volts[1] as number;
    expect(collector).toBeGreaterThan(4);
    expect(collector).toBeLessThan(8);
    const sweep = await run(doc);
    const gain = magnitudeDb(valueAt(sweep.x, sweep.traces[0]?.values as Float64Array, 1e5, true), valueAt(sweep.x, sweep.traces[0]?.imag as Float64Array, 1e5, true));
    expect(gain).toBeGreaterThan(42);
    expect(gain).toBeLessThan(48);
  });

  it('the power supply settles at 5 V above its ripple', async () => {
    const sweep = await run(example('an-power-supply'));
    const [reservoir, out] = sweep.traces;
    const late = (tr: Trace | undefined) => {
      const from = sweep.x.findIndex((t) => t >= 0.15);
      return timeStats(sweep.x.slice(from), (tr as Trace).values.slice(from));
    };
    const r = late(reservoir);
    const o = late(out);
    expect(r.min).toBeGreaterThan(8);
    expect(r.max - r.min).toBeGreaterThan(0.2);
    expect(r.max - r.min).toBeLessThan(1.5);
    close(o.average, 5, 0.01);
    expect(o.max - o.min).toBeLessThan(0.02);
  });

  it('the comparator squares the sine at 50 Hz', async () => {
    const sweep = await run(example('an-schmitt'));
    const st = timeStats(sweep.x, sweep.traces[1]?.values as Float64Array);
    expect(st.max).toBeGreaterThan(4.9);
    expect(st.min).toBeLessThan(0.1);
    close(st.frequency, 50, 0.05);
  });

  it('the transfer-function block peaks 6 dB at 1 kHz', async () => {
    const sweep = await run(example('an-laplace'));
    const st = frequencyStats(sweep.x, sweep.traces[0]?.values as Float64Array, sweep.traces[0]?.imag as Float64Array);
    close(st.peakGain, 20 * Math.log10(2.066), 0.02);
    close(st.peakFrequency, 935, 0.05);
  });
});
