/**
 * Example circuits for the Circuit Simulator.  Each is drawn with a small
 * builder that places parts on the grid and runs wires between their
 * terminals, so the wiring always lands on the pins.
 */
import type { AnalysisSettings } from './analysis-settings';
import { type CircuitDoc, type FirmwareRef, onSegment, type PlacedPart, rotate, terminalPoints, type WireSegment } from './netlist';
import { defaultProps, PART_BY_TYPE, type PropValue, partOutline } from './parts';

type Point = readonly [number, number];

const dist = ([a, b]: readonly [Point, Point]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

class Placed {
  constructor(readonly part: PlacedPart) {}
  /** The grid point of a terminal, by name. */
  pin(name: string): Point {
    const def = PART_BY_TYPE.get(this.part.type);
    const index = def?.terminals.findIndex((t) => t.name === name) ?? -1;
    if (!def || index < 0) throw new Error(`${this.part.type} has no terminal ${name}`);
    return terminalPoints(this.part, def)[index] as Point;
  }
}

class Builder {
  readonly parts: PlacedPart[] = [];
  readonly wires: WireSegment[] = [];
  readonly firmware: Record<string, FirmwareRef> = {};

  add(type: string, x: number, y: number, props: Record<string, PropValue> = {}, rot = 0, flip = false): Placed {
    const def = PART_BY_TYPE.get(type);
    if (!def) throw new Error(`Unknown part ${type}`);
    const part: PlacedPart = { id: `p${this.parts.length + 1}`, type, x, y, rot, ...(flip ? { flip } : {}), props: { ...defaultProps(def), ...props } };
    this.parts.push(part);
    return new Placed(part);
  }

  /** Straight wires through the points in turn (each step horizontal or vertical). */
  wire(...points: Point[]): void {
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i - 1] as Point;
      const [x2, y2] = points[i] as Point;
      if (x1 !== x2 && y1 !== y2) throw new Error(`Wire from ${x1},${y1} to ${x2},${y2} is not straight`);
      if (x1 === x2 && y1 === y2) continue;
      this.wires.push({ id: `w${this.wires.length + 1}`, x1, y1, x2, y2 });
    }
  }

  /** Two wires with one bend: across then down ('hv') or down then across ('vh'). */
  link(a: Point, b: Point, bend: 'hv' | 'vh' = 'hv'): void {
    const corner: Point = bend === 'hv' ? [b[0], a[1]] : [a[0], b[1]];
    this.wire(a, corner, b);
  }

  /** A part's outline on the grid, after turning. */
  private outline(part: PlacedPart): [number, number, number, number] {
    const def = PART_BY_TYPE.get(part.type);
    const [bx0, by0, bx1, by1] = def ? partOutline(def, part.props) : [0, -1, 3, 1];
    const corners = [rotate(bx0, by0, part.rot, part.flip), rotate(bx1, by1, part.rot, part.flip)];
    const xs = corners.map((c) => c[0] + part.x);
    const ys = corners.map((c) => c[1] + part.y);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  /** Every grid point already joined to a point by wires (the point itself included), and those wires. */
  private net(point: Point): { cells: Set<string>; wires: Set<WireSegment> } {
    const key = (x: number, y: number) => `${x},${y}`;
    // Wires join where an end of one lies on another; wires that only cross do not.
    const ends: Point[] = [point];
    const wires = new Set<WireSegment>();
    let grew = true;
    while (grew) {
      grew = false;
      for (const w of this.wires) {
        if (wires.has(w)) continue;
        const joined = ends.some(([x, y]) => onSegment(w, x, y)) || [...wires].some((v) => onSegment(v, w.x1, w.y1) || onSegment(v, w.x2, w.y2));
        if (!joined) continue;
        wires.add(w);
        ends.push([w.x1, w.y1], [w.x2, w.y2]);
        grew = true;
      }
    }
    const cells = new Set<string>([key(point[0], point[1])]);
    for (const w of wires) {
      const length = Math.abs(w.x2 - w.x1) + Math.abs(w.y2 - w.y1);
      for (let i = 0; i <= length; i++) cells.add(key(w.x1 + Math.sign(w.x2 - w.x1) * i, w.y1 + Math.sign(w.y2 - w.y1) * i));
    }
    // A point where another net's wire crosses cannot start or end a wire: the new end would join both.
    for (const w of this.wires) {
      if (wires.has(w)) continue;
      for (const k of [...cells]) {
        const [x, y] = k.split(',').map(Number) as [number, number];
        if (onSegment(w, x, y) && !(x === point[0] && y === point[1])) cells.delete(k);
      }
    }
    return { cells, wires };
  }

  /**
   * Draws a wire from what `from` is joined to (the point, or a wire already
   * on it) to what `to` is joined to: the shortest way with few bends, never
   * through a part, another terminal or a wire's end, crossing other wires
   * only straight across, and keeping clear of the way in to other terminals.
   */
  route(from: Point, to: Point): void {
    const key = (x: number, y: number) => `${x},${y}`;
    const sources = this.net(from).cells;
    const targets = this.net(to).cells;
    const blocked = new Set<string>();
    // Each terminal's way in: the two points outside its part, which other wires should leave free.
    const reserved = new Map<string, number>();
    this.parts.forEach((part) => {
      const [x0, y0, x1, y1] = this.outline(part);
      for (const [x, y] of terminalPoints(part)) {
        blocked.add(key(x, y));
        if (sources.has(key(x, y)) || targets.has(key(x, y))) continue;
        const out = x <= x0 ? [-1, 0] : x >= x1 ? [1, 0] : y <= y0 ? [0, -1] : y >= y1 ? [0, 1] : null;
        if (!out) continue;
        reserved.set(key(x + out[0], y + out[1]), 20);
        reserved.set(key(x + 2 * out[0], y + 2 * out[1]), Math.max(reserved.get(key(x + 2 * out[0], y + 2 * out[1])) ?? 0, 8));
      }
    });
    const across = new Map<string, 'h' | 'v'>();
    for (const w of this.wires) {
      blocked.add(key(w.x1, w.y1));
      blocked.add(key(w.x2, w.y2));
      const horizontal = w.y1 === w.y2;
      const length = Math.abs(w.x2 - w.x1) + Math.abs(w.y2 - w.y1);
      for (let i = 1; i < length; i++) across.set(key(w.x1 + Math.sign(w.x2 - w.x1) * i, w.y1 + Math.sign(w.y2 - w.y1) * i), horizontal ? 'h' : 'v');
    }
    // Supply and ground symbols are small enough to pass beside.
    const boxes = this.parts.filter((p) => p.type !== 'rail' && p.type !== 'ground').map((p) => this.outline(p));
    // Wires keep off parts, their edges included (where pins and their leads are drawn).
    const inside = (x: number, y: number) => boxes.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
    const xs = [from[0], to[0], ...boxes.flatMap((b) => [b[0], b[2]])];
    const ys = [from[1], to[1], ...boxes.flatMap((b) => [b[1], b[3]])];
    const [minX, maxX, minY, maxY] = [Math.floor(Math.min(...xs)) - 6, Math.ceil(Math.max(...xs)) + 6, Math.floor(Math.min(...ys)) - 6, Math.ceil(Math.max(...ys)) + 6];
    type Dir = '' | 'h' | 'v';
    const steps: readonly [number, number, 'h' | 'v'][] = [
      [1, 0, 'h'],
      [-1, 0, 'h'],
      [0, 1, 'v'],
      [0, -1, 'v'],
    ];
    const best = new Map<string, number>();
    const back = new Map<string, string>();
    const queue: [number, number, number, Dir][] = [];
    // Start anywhere on the source net; from the middle of a wire only straight off it (a T-junction).
    for (const k of sources) {
      const [x, y] = k.split(',').map(Number) as [number, number];
      const along = across.get(k);
      const dir: Dir = along ? (along === 'h' ? 'v' : 'h') : '';
      best.set(`${k}|${dir}`, 0);
      queue.push([0, x, y, dir]);
    }
    let found = '';
    while (queue.length) {
      let at = 0;
      for (let i = 1; i < queue.length; i++) if ((queue[i]?.[0] ?? 0) < (queue[at]?.[0] ?? 0)) at = i;
      const [cost, x, y, dir] = queue.splice(at, 1)[0] as [number, number, number, Dir];
      const here = key(x, y);
      const state = `${here}|${dir}`;
      if (cost > (best.get(state) ?? Number.POSITIVE_INFINITY)) continue;
      if (targets.has(here) && !sources.has(here)) {
        found = state;
        break;
      }
      const crossing = across.get(here);
      const starting = sources.has(here) && cost === 0;
      for (const [dx, dy, d] of steps) {
        // No bend on another wire (the bend would join it); off a source wire only at right angles.
        if (crossing && dir && d !== dir) continue;
        if (starting && dir && d !== dir) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
        const k = key(nx, ny);
        if (targets.has(k)) {
          // Into the middle of a target wire only at right angles.
          const along = across.get(k);
          if (along && along === d) continue;
        } else {
          if (sources.has(k) || blocked.has(k) || inside(nx, ny)) continue;
          const other = across.get(k);
          if (other && other === d) continue;
        }
        const next = cost + 1 + (dir && dir !== d ? 6 : 0) + (reserved.get(k) ?? 0);
        const s2 = `${k}|${d}`;
        if (next < (best.get(s2) ?? Number.POSITIVE_INFINITY)) {
          best.set(s2, next);
          back.set(s2, state);
          queue.push([next, nx, ny, d]);
        }
      }
    }
    if (!found) throw new Error(`No route from ${from} to ${to}`);
    const points: Point[] = [];
    for (let s: string | undefined = found; s; s = back.get(s)) {
      const [x, y] = (s.split('|')[0] as string).split(',').map(Number) as [number, number];
      points.unshift([x, y]);
    }
    // Keep the corners only.
    const corners = points.filter((p, i) => {
      const a = points[i - 1];
      const c = points[i + 1];
      return !a || !c || (a[0] - p[0]) * (c[1] - p[1]) !== (a[1] - p[1]) * (c[0] - p[0]);
    });
    this.wire(...corners);
  }

  /** Routes several connections, trying other orders when one blocks another. */
  routeAll(pairs: readonly (readonly [Point, Point])[]): void {
    const wires = this.wires.length;
    const orders = [pairs, [...pairs].reverse(), [...pairs].sort((a, b) => dist(a) - dist(b)), [...pairs].sort((a, b) => dist(b) - dist(a))];
    // A few more, shuffled the same way every time.
    let seed = 7;
    for (let n = 0; n < 24; n++) {
      const order = [...pairs];
      for (let i = order.length - 1; i > 0; i--) {
        seed = (seed * 16807) % 2147483647;
        const j = seed % (i + 1);
        [order[i], order[j]] = [order[j] as readonly [Point, Point], order[i] as readonly [Point, Point]];
      }
      orders.push(order);
    }
    let last: unknown = null;
    for (const order of orders) {
      try {
        for (const [a, b] of order) this.route(a, b);
        return;
      } catch (error) {
        last = error;
        this.wires.length = wires;
      }
    }
    throw last;
  }

  /** Whether a point is free for a new terminal: on no wire and no terminal, outside every part. */
  private free(x: number, y: number): boolean {
    if (this.wires.some((w) => onSegment(w, x, y))) return false;
    for (const part of this.parts) for (const [tx, ty] of terminalPoints(part)) if (tx === x && ty === y) return false;
    return !this.parts.some((p) => {
      const [x0, y0, x1, y1] = this.outline(p);
      return x >= x0 - 1 && x <= x1 + 1 && y >= y0 - 1.6 && y <= y1 + 1.2;
    });
  }

  /** A supply rail (5 V unless said) or a ground symbol near a terminal, wired to it: the nearest free spot that a wire reaches. */
  power(at: Point, kind: 'rail' | 'ground', volts = 5): void {
    const spots: [number, number][] = [];
    for (let r = 2; r <= 14; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) spots.push([dx, dy]);
    // Rails above and grounds below where they can be, then the left.
    const score = ([dx, dy]: [number, number]) => Math.abs(dx) + Math.abs(dy) + (kind === 'rail' ? (dy > 0 ? 3 : 0) : dy < 0 ? 3 : 0) + (dx > 0 ? 2 : 0);
    spots.sort((a, b) => score(a) - score(b));
    for (const [dx, dy] of spots) {
      const x = at[0] + dx;
      const y = at[1] + dy;
      if (!this.free(x, y)) continue;
      const symbol = kind === 'rail' ? this.add('rail', x, y, { v: volts }) : this.add('ground', x, y);
      const wires = this.wires.length;
      try {
        this.route(at, symbol.pin(kind === 'rail' ? 'rail' : 'ground'));
        return;
      } catch {
        this.parts.pop();
        this.wires.length = wires;
      }
    }
    throw new Error(`No room for a ${kind} symbol near ${at}`);
  }

  /** Value labels are left off where parts sit a grid square apart. */
  labels = true;
  /** The analysis the example is set up for. */
  analysis: AnalysisSettings | null = null;

  doc(title: string, dt: number, speed: number): CircuitDoc {
    return {
      version: 1,
      title,
      parts: this.parts,
      wires: this.wires,
      dt,
      speed,
      ...(Object.keys(this.firmware).length ? { firmware: this.firmware } : {}),
      ...(this.labels ? {} : { labels: false }),
      ...(this.analysis ? { analysis: this.analysis } : {}),
    };
  }
}

export const EXAMPLE_GROUPS = ['Basics', 'Analog', 'Analysis', 'Digital', 'Arduino', 'Displays', 'Sensors', 'Motors and controls', 'More boards', 'Raspberry Pi Pico', 'ESP32'] as const;

export interface Example {
  readonly id: string;
  readonly title: string;
  readonly group: (typeof EXAMPLE_GROUPS)[number];
  readonly description: string;
  /** Oscilloscope time window, seconds. */
  readonly scope?: number;
  /** Open the analysis panel (the example is set up for one). */
  readonly analysis?: boolean;
  readonly make: () => CircuitDoc;
}

/* ------------------------------------------------------------------ basics -- */

function ledAndResistor(): CircuitDoc {
  const b = new Builder();
  const battery = b.add('battery', 4, 4, { v: 9 });
  const sw = b.add('switch', 6, 2, { closed: true });
  const r = b.add('resistor', 11, 2, { r: 470 });
  const led = b.add('led', 16, 3, { colour: 'red' }, 1);
  b.add('ground', 4, 9);
  b.link(battery.pin('+'), sw.pin('a'), 'vh');
  b.wire(sw.pin('b'), r.pin('a'));
  b.link(r.pin('b'), led.pin('anode'));
  b.wire(led.pin('cathode'), [16, 9], [4, 9]);
  b.wire(battery.pin('−'), [4, 9]);
  return b.doc('LED and resistor', 1e-4, 1);
}

function voltageDivider(): CircuitDoc {
  const b = new Builder();
  const battery = b.add('battery', 4, 3, { v: 12 });
  const r1 = b.add('resistor', 10, 2, { r: 10_000 }, 1);
  const r2 = b.add('resistor', 10, 6, { r: 4700 }, 1);
  const meter = b.add('voltmeter', 14, 6, {}, 1);
  b.add('ground', 4, 11);
  b.link(battery.pin('+'), r1.pin('a'), 'vh');
  b.wire(r1.pin('b'), r2.pin('a'));
  b.wire(r2.pin('a'), meter.pin('+'));
  b.wire(r2.pin('b'), meter.pin('−'));
  b.wire(r2.pin('b'), [10, 11], [4, 11]);
  b.wire(battery.pin('−'), [4, 11]);
  return b.doc('Voltage divider', 1e-4, 1);
}

function rcCharging(): CircuitDoc {
  const b = new Builder();
  const gen = b.add('ac-source', 4, 3, { shape: 'pulse', amplitude: 5, f: 1, duty: 0.5 });
  const r = b.add('resistor', 7, 2, { r: 10_000 });
  const c = b.add('capacitor', 12, 3, { c: 10e-6 }, 1);
  b.add('probe', 4, 2, { trace: '1' });
  b.add('probe', 12, 2, { trace: '2' });
  b.add('ground', 4, 8);
  b.link(gen.pin('+'), r.pin('a'), 'vh');
  b.link(r.pin('b'), c.pin('a'));
  b.wire(c.pin('b'), [12, 8], [4, 8]);
  b.wire(gen.pin('−'), [4, 8]);
  return b.doc('RC charging and discharging', 1e-3, 1);
}

/* ------------------------------------------------------------------ analog -- */

function transistorSwitch(): CircuitDoc {
  const b = new Builder();
  const battery = b.add('battery', 3, 4, { v: 9 });
  const button = b.add('pushbutton', 10, 3, {}, 1);
  // The LED's resistor and the LED touch end to end, and the LED's cathode touches the collector.
  b.add('resistor', 16, 2, { r: 470 }, 1);
  b.add('led', 16, 5, { colour: 'green' }, 1);
  const rBase = b.add('resistor', 11, 10, { r: 10_000 });
  const q = b.add('npn', 14, 10, { beta: 100 });
  b.add('ground', 3, 14);
  b.wire(battery.pin('+'), [3, 2], [10, 2], [16, 2]);
  b.wire([10, 2], button.pin('a'));
  b.link(button.pin('b'), rBase.pin('a'), 'vh');
  b.wire(q.pin('emitter'), [16, 14], [3, 14]);
  b.wire(battery.pin('−'), [3, 14]);
  return b.doc('Transistor switch', 1e-4, 1);
}

function invertingAmplifier(): CircuitDoc {
  const b = new Builder();
  const gen = b.add('ac-source', 3, 6, { shape: 'sine', amplitude: 1, f: 1000 });
  const rin = b.add('resistor', 5, 5, { r: 10_000 });
  const amp = b.add('opamp', 10, 6, { vpos: 15, vneg: -15 });
  const rf = b.add('resistor', 10, 2, { r: 47_000 });
  b.add('probe', 3, 5, { trace: '1' });
  b.add('probe', 15, 6, { trace: '2' });
  b.add('ground', 3, 11);
  b.link(gen.pin('+'), rin.pin('a'), 'vh');
  b.wire(rin.pin('b'), [9, 5], amp.pin('−'));
  b.link([9, 5], rf.pin('a'), 'vh');
  b.wire(rf.pin('b'), [15, 2], [15, 6]);
  b.wire(amp.pin('out'), [15, 6]);
  b.wire(amp.pin('+'), [10, 11], [3, 11]);
  b.wire(gen.pin('−'), [3, 11]);
  return b.doc('Op-amp inverting amplifier (gain −4.7)', 5e-6, 0.02);
}

function blinker555(): CircuitDoc {
  const b = new Builder();
  const battery = b.add('battery', 2, 4, { v: 9 });
  const chip = b.add('timer555', 9, 3);
  const r1 = b.add('resistor', 7, 1, { r: 1000 }, 1);
  const r2 = b.add('resistor', 4, 8, { r: 10_000 });
  const c = b.add('capacitor', 4, 9, { c: 47e-6 }, 1);
  const r3 = b.add('resistor', 17, 4, { r: 470 });
  const led = b.add('led', 20, 5, { colour: 'red' }, 1);
  b.add('ground', 2, 13);
  // Supply rail to VCC and RESET.
  b.wire(battery.pin('+'), [2, 1], r1.pin('a'), [12, 1], chip.pin('VCC'));
  b.wire([12, 1], [16, 1], [16, 8], chip.pin('RESET'));
  // R1 to DIS; R2 from DIS to THR and TRIG; C from there to ground.
  b.wire(r1.pin('b'), [7, 8], chip.pin('DIS'));
  b.wire(r2.pin('b'), [7, 8]);
  b.wire(r2.pin('a'), [4, 6], [8, 6], chip.pin('THR'));
  b.wire(chip.pin('TRIG'), [8, 4], [8, 6]);
  b.wire(r2.pin('a'), c.pin('a'));
  // Output through R3 to the LED.
  b.wire(chip.pin('OUT'), r3.pin('a'));
  b.link(r3.pin('b'), led.pin('anode'));
  // Ground line.
  b.wire(battery.pin('−'), [2, 13], [4, 13], [12, 13], [20, 13]);
  b.wire(c.pin('b'), [4, 13]);
  b.wire(chip.pin('GND'), [12, 13]);
  b.wire(led.pin('cathode'), [20, 13]);
  return b.doc('555 timer blinker', 1e-3, 1);
}

function relayMotor(): CircuitDoc {
  const b = new Builder();
  const battery = b.add('battery', 2, 4, { v: 9 });
  const button = b.add('pushbutton', 5, 1);
  const relay = b.add('relay', 10, 2, { coil: 100, pull: 0.03 });
  const diode = b.add('diode', 8, 6, {}, 3);
  const motor = b.add('motor', 15, 2, { r: 10 });
  const supply = b.add('battery', 20, 3, { v: 12 });
  b.add('ground', 2, 9);
  b.wire(battery.pin('+'), [2, 1], button.pin('a'));
  b.wire(button.pin('b'), [10, 1], relay.pin('coil +'));
  b.wire(diode.pin('cathode'), [8, 2], relay.pin('coil +'));
  b.wire(diode.pin('anode'), relay.pin('coil −'));
  b.wire(relay.pin('NO'), motor.pin('a'));
  b.wire(motor.pin('b'), [20, 2], supply.pin('+'));
  b.wire(battery.pin('−'), [2, 9], [10, 9], [13, 9], [20, 9]);
  b.wire(relay.pin('coil −'), [10, 9]);
  b.wire(relay.pin('COM'), [13, 9]);
  b.wire(supply.pin('−'), [20, 9]);
  return b.doc('Relay switching a motor', 1e-4, 1);
}

/* ----------------------------------------------------------------- digital -- */

function halfAdder(): CircuitDoc {
  const b = new Builder();
  const a = b.add('logic-input', 2, 2, { high: true });
  const bIn = b.add('logic-input', 2, 6, { high: false });
  const xor = b.add('xor', 10, 3);
  const and = b.add('and', 10, 8);
  const sum = b.add('logic-probe', 16, 3);
  const carry = b.add('logic-probe', 16, 8);
  b.wire(a.pin('out'), [7, 2], xor.pin('A'));
  b.wire([7, 2], [7, 7], and.pin('A'));
  b.wire(bIn.pin('out'), [8, 6]);
  b.wire([8, 6], [8, 4], xor.pin('B'));
  b.wire([8, 6], [8, 9], and.pin('B'));
  b.wire(xor.pin('Y'), sum.pin('in'));
  b.wire(and.pin('Y'), carry.pin('in'));
  return b.doc('Half adder (logic gates)', 1e-3, 1);
}

function counterDisplay(): CircuitDoc {
  const b = new Builder();
  const clock = b.add('clock', 2, 3, { f: 2 });
  const counter = b.add('counter', 7, 2, { modulo: 10 });
  const decoder = b.add('decoder', 15, 2);
  const display = b.add('seven-segment', 23, 2, { colour: 'red' });
  b.add('ground', 23, 11);
  b.wire(clock.pin('out'), counter.pin('CLK'));
  ['Q0', 'Q1', 'Q2', 'Q3'].forEach((q, i) => {
    b.wire(counter.pin(q), decoder.pin('ABCD'[i] as string));
  });
  for (const s of 'abcdefg') b.wire(decoder.pin(s), display.pin(s));
  b.wire(display.pin('COM'), [23, 11]);
  return b.doc('Counter and 7-segment display', 1e-3, 1);
}

/* ------------------------------------------------------------- Arduino Uno -- */

/** An Uno at (2, 1) running an example, with its GND pin grounded on the left. */
function uno(b: Builder, program: string): Placed {
  const board = b.add('arduino-uno', 2, 1);
  b.firmware[board.part.id] = { kind: 'example', id: program };
  b.add('ground', 0, 3);
  b.wire(board.pin('GND'), [0, 2], [0, 3]);
  return board;
}

/** A resistor and LED from a pin to a ground symbol, heading right at the pin's row. */
function ledFrom(b: Builder, from: Point, colour = 'red', resistance = 220): void {
  const [x, y] = from;
  const r = b.add('resistor', x + 2, y, { r: resistance });
  const led = b.add('led', x + 5, y, { colour });
  b.wire(from, r.pin('a'));
  b.add('ground', led.pin('cathode')[0], y);
}

function unoBlink(): CircuitDoc {
  const b = new Builder();
  const board = uno(b, 'blink');
  ledFrom(b, board.pin('D13'));
  return b.doc('Arduino: blink', 5e-5, 1);
}

function unoTraffic(): CircuitDoc {
  const b = new Builder();
  b.labels = false;
  const board = uno(b, 'traffic-lights');
  const pins: [string, string][] = [
    ['D2', 'red'],
    ['D3', 'yellow'],
    ['D4', 'green'],
  ];
  for (const [pin, colour] of pins) {
    const [x, y] = board.pin(pin);
    const r = b.add('resistor', x + 2, y, { r: 220 });
    const led = b.add('led', x + 5, y, { colour });
    b.wire([x, y], r.pin('a'));
    b.wire(led.pin('cathode'), [x + 10, y]);
  }
  const [x] = board.pin('D2');
  b.wire([x + 10, 11], [x + 10, 12], [x + 10, 13], [x + 10, 14]);
  b.add('ground', x + 10, 14);
  return b.doc('Arduino: traffic lights', 5e-5, 1);
}

function unoButton(): CircuitDoc {
  const b = new Builder();
  const board = uno(b, 'button');
  ledFrom(b, board.pin('D13'));
  const [x, y] = board.pin('D2');
  const button = b.add('pushbutton', x + 2, y);
  b.wire([x, y], button.pin('a'));
  b.add('ground', button.pin('b')[0], y);
  return b.doc('Arduino: button and LED', 5e-5, 1);
}

function unoFade(): CircuitDoc {
  const b = new Builder();
  const board = uno(b, 'fade');
  ledFrom(b, board.pin('D9'));
  return b.doc('Arduino: fading LED (PWM)', 5e-5, 1);
}

function unoDimmer(): CircuitDoc {
  const b = new Builder();
  const board = b.add('arduino-uno', 2, 1);
  b.firmware[board.part.id] = { kind: 'example', id: 'dimmer' };
  // Turned this way up, a higher position moves the wiper towards 5 V.
  const pot = b.add('potentiometer', -3, 8, { r: 10_000, position: 0.3 }, 1, true);
  b.wire(pot.pin('wiper'), board.pin('A0'));
  b.wire(pot.pin('end 2'), [-3, 3], board.pin('5V'));
  b.wire(board.pin('GND'), [-5, 2], [-5, 8], pot.pin('end 1'));
  b.add('ground', -5, 8);
  ledFrom(b, board.pin('D9'));
  return b.doc('Arduino: dimmer (potentiometer and PWM)', 5e-5, 1);
}

function unoChaser(): CircuitDoc {
  const b = new Builder();
  b.labels = false;
  const board = uno(b, 'led-chaser');
  const [x] = board.pin('D2');
  for (let pin = 2; pin <= 9; pin++) {
    const [, y] = board.pin(`D${pin}`);
    const r = b.add('resistor', x + 2, y, { r: 220 });
    const led = b.add('led', x + 5, y, { colour: pin % 2 ? 'yellow' : 'red' });
    b.wire([x, y], r.pin('a'));
    b.wire(led.pin('cathode'), [x + 10, y]);
  }
  for (let y = 6; y < 14; y++) b.wire([x + 10, y], [x + 10, y + 1]);
  b.add('ground', x + 10, 14);
  return b.doc('Arduino: LED chaser', 5e-5, 1);
}

function unoSevenSegment(): CircuitDoc {
  const b = new Builder();
  const board = uno(b, 'seven-segment');
  const display = b.add('seven-segment', 20, 6, { colour: 'red' });
  'abcdefg'.split('').forEach((s, i) => {
    b.wire(board.pin(`D${8 - i}`), display.pin(s));
  });
  b.add('ground', 20, 16);
  b.wire(display.pin('COM'), [20, 16]);
  return b.doc('Arduino: seven-segment counter', 5e-5, 1);
}

function unoSerial(): CircuitDoc {
  const b = new Builder();
  const board = uno(b, 'serial-control');
  ledFrom(b, board.pin('D13'));
  return b.doc('Arduino: serial control', 5e-5, 1);
}

/* ----------------------------------------------------------- modules -- */

/** A board at (2, 1) running an example, with its GND pin grounded on the left. */
function boardWith(b: Builder, type: string, program: string): Placed {
  const board = b.add(type, 2, 1);
  b.firmware[board.part.id] = { kind: 'example', id: program };
  const [gx, gy] = board.pin('GND');
  b.add('ground', gx - 2, gy + 1);
  b.wire([gx, gy], [gx - 2, gy], [gx - 2, gy + 1]);
  return board;
}

/** Supply and ground symbols for a module's power terminals. */
function powered(b: Builder, part: Placed, vcc: string, gnd: string, volts = 5): void {
  b.power(part.pin(vcc), 'rail', volts);
  b.power(part.pin(gnd), 'ground');
}

/** A resistor and an LED from a board pin, routed, with the LED's cathode on a ground symbol. */
function ledAt(b: Builder, from: Point, x: number, y: number, colour = 'red', resistance = 220): void {
  const r = b.add('resistor', x, y, { r: resistance });
  const led = b.add('led', x + 3, y, { colour });
  b.route(from, r.pin('a'));
  b.add('ground', led.pin('cathode')[0], y);
}

function unoOled(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'arduino-uno', 'oled-hello');
  const oled = b.add('oled', 18, 6);
  b.routeAll([
    [board.pin('A4'), oled.pin('SDA')],
    [board.pin('A5'), oled.pin('SCL')],
  ]);
  powered(b, oled, 'VCC', 'GND');
  return b.doc('Arduino: OLED display (I²C)', 5e-5, 1);
}

function unoLcdI2c(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'arduino-uno', 'lcd-i2c');
  const lcd = b.add('lcd-i2c', 20, 6);
  b.routeAll([
    [board.pin('A4'), lcd.pin('SDA')],
    [board.pin('A5'), lcd.pin('SCL')],
  ]);
  powered(b, lcd, 'VCC', 'GND');
  return b.doc('Arduino: LCD with I²C backpack', 5e-5, 1);
}

function unoLcd(): CircuitDoc {
  const b = new Builder();
  b.labels = false;
  const board = boardWith(b, 'arduino-uno', 'lcd-parallel');
  const lcd = b.add('lcd', 17, 2);
  const pins: [string, string][] = [
    ['D12', 'RS'],
    ['D11', 'E'],
    ['D5', 'D4'],
    ['D4', 'D5'],
    ['D3', 'D6'],
    ['D2', 'D7'],
  ];
  // The backlight LED through 220 Ω from 5 V.
  const [ax, ay] = lcd.pin('A');
  const r = b.add('resistor', ax, ay + 3, { r: 220 }, 1);
  b.wire([ax, ay], r.pin('a'));
  b.routeAll(pins.map(([from, to]) => [board.pin(from), lcd.pin(to)] as const));
  b.power(lcd.pin('VDD'), 'rail');
  b.power(lcd.pin('VSS'), 'ground');
  b.power(r.pin('b'), 'rail');
  // V0 (contrast) at ground is the darkest; RW at ground writes; K is the backlight's cathode.
  b.routeAll(['V0', 'RW', 'K'].map((name) => [lcd.pin(name), lcd.pin('VSS')] as const));
  return b.doc('Arduino: character LCD (parallel)', 5e-5, 1);
}

function unoTft(): CircuitDoc {
  const b = new Builder();
  b.labels = false;
  const board = boardWith(b, 'arduino-uno', 'tft');
  const tft = b.add('tft', 20, 0);
  b.routeAll([
    [board.pin('D10'), tft.pin('CS')],
    [board.pin('D9'), tft.pin('DC')],
    [board.pin('D11'), tft.pin('MOSI')],
    [board.pin('D13'), tft.pin('SCK')],
  ]);
  b.power(tft.pin('VCC'), 'rail');
  b.power(tft.pin('GND'), 'ground');
  b.power(tft.pin('RESET'), 'rail');
  b.power(tft.pin('LED'), 'rail');
  return b.doc('Arduino: colour TFT (SPI)', 5e-5, 1);
}

function unoMatrix(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'arduino-uno', 'led-matrix');
  const m = b.add('led-matrix', 19, 2);
  b.routeAll([
    [board.pin('D12'), m.pin('DIN')],
    [board.pin('D11'), m.pin('CLK')],
    [board.pin('D10'), m.pin('CS')],
  ]);
  powered(b, m, 'VCC', 'GND');
  return b.doc('Arduino: LED matrix (MAX7219)', 5e-5, 1);
}

function unoNeopixel(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'arduino-uno', 'neopixel-ring');
  const ring = b.add('neopixel-ring', 18, 6, { count: '16' });
  b.route(board.pin('D6'), ring.pin('DIN'));
  powered(b, ring, 'VDD', 'GND');
  return b.doc('Arduino: NeoPixel ring', 5e-5, 1);
}

function unoRgb(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'arduino-uno', 'rgb-led');
  const led = b.add('rgb-led', 24, 5);
  const pins: [string, string][] = [
    ['D9', 'R'],
    ['D10', 'G'],
    ['D11', 'B'],
  ];
  const resistors = pins.map((_, i) => b.add('resistor', 16, 1 + 2 * i, { r: 220 }));
  b.routeAll(pins.flatMap(([pin, lead], i) => [[board.pin(pin), (resistors[i] as Placed).pin('a')] as const, [(resistors[i] as Placed).pin('b'), led.pin(lead)] as const]));
  b.power(led.pin('COM'), 'ground');
  return b.doc('Arduino: RGB LED (PWM)', 5e-5, 1);
}

function unoShiftRegister(): CircuitDoc {
  const b = new Builder();
  b.labels = false;
  const board = boardWith(b, 'arduino-uno', 'shift-register');
  const chip = b.add('shift-register', 18, 4);
  b.routeAll([
    [board.pin('D4'), chip.pin('DS')],
    [board.pin('D6'), chip.pin('SHCP')],
    [board.pin('D5'), chip.pin('STCP')],
  ]);
  b.power(chip.pin('VCC'), 'rail');
  b.power(chip.pin('GND'), 'ground');
  b.power(chip.pin('MR'), 'rail');
  b.power(chip.pin('OE'), 'ground');
  // Eight LEDs, their cathodes on one ground line.
  const [qx] = chip.pin('Q0');
  for (let i = 0; i < 8; i++) {
    const [, y] = chip.pin(`Q${i}`);
    const r = b.add('resistor', qx + 2, y, { r: 220 });
    const led = b.add('led', qx + 5, y, { colour: i % 2 ? 'yellow' : 'green' });
    b.wire([qx, y], r.pin('a'));
    b.wire(led.pin('cathode'), [qx + 10, y]);
    if (i) b.wire([qx + 10, y - 1], [qx + 10, y]);
  }
  const [, last] = chip.pin('Q7');
  b.add('ground', qx + 10, last + 1);
  b.wire([qx + 10, last], [qx + 10, last + 1]);
  return b.doc('Arduino: shift register (74HC595)', 5e-5, 1);
}

function unoDht(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'arduino-uno', 'dht22');
  const dht = b.add('dht22', 19, 11, { temperature: 24, humidity: 55 });
  b.route(board.pin('D2'), dht.pin('DATA'));
  powered(b, dht, 'VCC', 'GND');
  return b.doc('Arduino: temperature and humidity (DHT22)', 5e-5, 1);
}

function unoBme(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'arduino-uno', 'bme280');
  const bme = b.add('bme280', 19, 6);
  b.routeAll([
    [board.pin('A4'), bme.pin('SDA')],
    [board.pin('A5'), bme.pin('SCL')],
  ]);
  powered(b, bme, 'VIN', 'GND', 3.3);
  return b.doc('Arduino: weather sensor (BME280)', 5e-5, 1);
}

function unoMpu(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'arduino-uno', 'mpu6050');
  const mpu = b.add('mpu6050', 19, 6);
  b.routeAll([
    [board.pin('A4'), mpu.pin('SDA')],
    [board.pin('A5'), mpu.pin('SCL')],
  ]);
  powered(b, mpu, 'VCC', 'GND');
  return b.doc('Arduino: motion sensor (MPU6050)', 5e-5, 1);
}

function unoClock(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'arduino-uno', 'rtc-clock');
  const rtc = b.add('rtc', 19, 13);
  const lcd = b.add('lcd-i2c', 20, 3);
  b.routeAll([
    [board.pin('A4'), rtc.pin('SDA')],
    [board.pin('A5'), rtc.pin('SCL')],
  ]);
  b.routeAll([
    [board.pin('A4'), lcd.pin('SDA')],
    [board.pin('A5'), lcd.pin('SCL')],
  ]);
  powered(b, rtc, 'VCC', 'GND');
  powered(b, lcd, 'VCC', 'GND');
  return b.doc('Arduino: clock (DS1307 and I²C LCD)', 5e-5, 1);
}

function unoSonar(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'arduino-uno', 'ultrasonic');
  const sonar = b.add('ultrasonic', 20, 3, { distance: 42 });
  b.routeAll([
    [board.pin('D9'), sonar.pin('TRIG')],
    [board.pin('D10'), sonar.pin('ECHO')],
  ]);
  powered(b, sonar, 'VCC', 'GND');
  return b.doc('Arduino: ultrasonic distance (HC-SR04)', 5e-5, 1);
}

function unoPir(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'arduino-uno', 'motion-sensor');
  const pir = b.add('pir', 19, 11, { hold: 2 });
  b.route(board.pin('D2'), pir.pin('OUT'));
  powered(b, pir, 'VCC', 'GND');
  ledAt(b, board.pin('D13'), 16, 2, 'red');
  return b.doc('Arduino: motion detector (PIR)', 5e-5, 1);
}

/** A sensor that is a resistance, from 5 V to A0 with a 10 kΩ resistor below it. */
function divider(b: Builder, board: Placed, type: string, props: Record<string, PropValue>): void {
  const sensor = b.add(type, -6, 3, props, 1);
  const fixed = b.add('resistor', -6, 8, { r: 10_000 }, 1);
  b.route(sensor.pin('b'), board.pin('A0'));
  b.wire(sensor.pin('b'), fixed.pin('a'));
  b.power(sensor.pin('a'), 'rail');
  b.power(fixed.pin('b'), 'ground');
}

function unoLdr(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'arduino-uno', 'light-sensor');
  divider(b, board, 'ldr', { light: 200 });
  ledAt(b, board.pin('D13'), 16, 2, 'yellow');
  return b.doc('Arduino: light sensor (LDR)', 5e-5, 1);
}

function unoNtc(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'arduino-uno', 'thermistor');
  divider(b, board, 'ntc', { temperature: 30 });
  return b.doc('Arduino: thermometer (NTC thermistor)', 5e-5, 1);
}

function unoServo(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'arduino-uno', 'servo-sweep');
  const servo = b.add('servo', 20, 6);
  b.route(board.pin('D9'), servo.pin('SIG'));
  powered(b, servo, 'V+', 'GND');
  return b.doc('Arduino: servo sweep', 5e-5, 1);
}

function unoServoKnob(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'arduino-uno', 'servo-knob');
  const pot = b.add('potentiometer', -4, 4, { r: 10_000, position: 0.25 }, 1, true);
  b.route(pot.pin('wiper'), board.pin('A0'));
  b.power(pot.pin('end 2'), 'rail');
  b.power(pot.pin('end 1'), 'ground');
  const servo = b.add('servo', 20, 6);
  b.route(board.pin('D9'), servo.pin('SIG'));
  powered(b, servo, 'V+', 'GND');
  return b.doc('Arduino: servo knob', 5e-5, 1);
}

function unoStepper(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'arduino-uno', 'stepper');
  const motor = b.add('stepper', 19, 5);
  b.routeAll(['D8', 'D9', 'D10', 'D11'].map((pin, i) => [board.pin(pin), motor.pin(`IN${i + 1}`)] as const));
  b.power(motor.pin('+'), 'rail');
  b.power(motor.pin('−'), 'ground');
  return b.doc('Arduino: stepper motor (28BYJ-48)', 5e-5, 1);
}

function unoKeypad(): CircuitDoc {
  const b = new Builder();
  b.labels = false;
  const board = boardWith(b, 'arduino-uno', 'keypad');
  const keypad = b.add('keypad', 18, 1);
  b.routeAll([
    ...['D9', 'D8', 'D7', 'D6'].map((pin, i) => [board.pin(pin), keypad.pin(`R${i + 1}`)] as const),
    ...['D5', 'D4', 'D3', 'D2'].map((pin, i) => [board.pin(pin), keypad.pin(`C${i + 1}`)] as const),
  ]);
  return b.doc('Arduino: keypad lock', 5e-5, 1);
}

function unoEncoder(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'arduino-uno', 'encoder');
  const knob = b.add('encoder', 19, 9);
  b.routeAll([
    [board.pin('D2'), knob.pin('CLK')],
    [board.pin('D3'), knob.pin('DT')],
    [board.pin('D4'), knob.pin('SW')],
  ]);
  powered(b, knob, '+', 'GND');
  return b.doc('Arduino: rotary encoder', 5e-5, 1);
}

function unoJoystick(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'arduino-uno', 'joystick');
  const stick = b.add('joystick', -9, 4, { x: 0.5, y: 0.5 });
  b.routeAll([
    [stick.pin('VRx'), board.pin('A0')],
    [stick.pin('VRy'), board.pin('A1')],
    [stick.pin('SW'), board.pin('D2')],
  ]);
  powered(b, stick, 'VCC', 'GND');
  return b.doc('Arduino: joystick', 5e-5, 1);
}

/* ------------------------------------------------------------ more boards -- */

function nanoOled(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'arduino-nano', 'oled-hello');
  const oled = b.add('oled', 16, 6);
  b.routeAll([
    [board.pin('A4'), oled.pin('SDA')],
    [board.pin('A5'), oled.pin('SCL')],
  ]);
  powered(b, oled, 'VCC', 'GND');
  return b.doc('Arduino Nano: OLED display', 5e-5, 1);
}

function megaBlink(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'arduino-mega', 'mega-blink');
  ledAt(b, board.pin('D13'), 14, -4, 'red');
  return b.doc('Arduino Mega: blink', 5e-5, 1);
}

function megaBarGraph(): CircuitDoc {
  const b = new Builder();
  b.labels = false;
  const board = boardWith(b, 'arduino-mega', 'mega-bar-graph');
  const pot = b.add('potentiometer', -6, 13, { r: 10_000, position: 0.6 }, 1, true);
  b.route(pot.pin('wiper'), board.pin('A8'));
  b.power(pot.pin('end 2'), 'rail');
  b.power(pot.pin('end 1'), 'ground');
  for (let i = 0; i < 10; i++) {
    const [x, y] = board.pin(`D${22 + i}`);
    const r = b.add('resistor', x, y + 2, { r: 220 }, 1);
    const led = b.add('led', x, y + 5, { colour: i < 6 ? 'green' : i < 8 ? 'yellow' : 'red' }, 1);
    b.wire([x, y], r.pin('a'));
    b.wire(led.pin('cathode'), [x, y + 9]);
    if (i) b.wire([x - 1, y + 9], [x, y + 9]);
  }
  const [x0, y0] = board.pin('D22');
  b.add('ground', x0, y0 + 10);
  b.wire([x0, y0 + 9], [x0, y0 + 10]);
  return b.doc('Arduino Mega: bar graph', 5e-5, 1);
}

function megaOled(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'arduino-mega', 'mega-oled');
  const oled = b.add('oled', 42, 6);
  b.routeAll([
    [board.pin('D20'), oled.pin('SDA')],
    [board.pin('D21'), oled.pin('SCL')],
  ]);
  powered(b, oled, 'VCC', 'GND');
  const pot = b.add('potentiometer', -6, 5, { r: 10_000, position: 0.4 }, 1, true);
  b.route(pot.pin('wiper'), board.pin('A0'));
  b.power(pot.pin('end 2'), 'rail');
  b.power(pot.pin('end 1'), 'ground');
  return b.doc('Arduino Mega: OLED on pins 20 and 21', 5e-5, 1);
}

function tinyBlink(id: 'tiny-blink' | 'tiny-fade' | 'tiny-serial', title: string): () => CircuitDoc {
  return () => {
    const b = new Builder();
    const board = boardWith(b, 'attiny85', id);
    ledAt(b, board.pin('PB1'), 12, 3, 'green');
    return b.doc(title, 5e-5, 1);
  };
}

function tinyNeopixel(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'attiny85', 'tiny-neopixel');
  const strip = b.add('neopixel-strip', 14, 7, { count: 8 });
  b.route(board.pin('PB3'), strip.pin('DIN'));
  powered(b, strip, 'VDD', 'GND');
  return b.doc('ATtiny85: NeoPixel strip', 5e-5, 1);
}

/* ------------------------------------------------------------ Raspberry Pi Pico -- */

/** A potentiometer between 3.3 V and ground beside the Pico, its wiper on GP26 (A0). */
function picoPot(b: Builder, board: Placed, position = 0.5): void {
  const pot = b.add('potentiometer', 15, 14, { r: 10_000, position }, 3);
  b.route(pot.pin('wiper'), board.pin('GP26'));
  b.power(pot.pin('end 2'), 'rail', 3.3);
  b.power(pot.pin('end 1'), 'ground');
}

function picoLed(id: 'pico-blink' | 'pico-fade', title: string): () => CircuitDoc {
  return () => {
    const b = new Builder();
    const board = boardWith(b, 'pi-pico', id);
    ledAt(b, board.pin('GP16'), 14, 2, 'green', 100);
    return b.doc(title, 5e-5, 1);
  };
}

function picoButton(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'pi-pico', 'pico-button');
  ledAt(b, board.pin('GP16'), 14, 2, 'green', 100);
  const button = b.add('pushbutton', 14, 6);
  b.route(board.pin('GP17'), button.pin('a'));
  b.add('ground', button.pin('b')[0], 6);
  return b.doc('Raspberry Pi Pico: button and LED', 5e-5, 1);
}

function picoPotLed(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'pi-pico', 'pico-pot');
  ledAt(b, board.pin('GP16'), 14, 2, 'yellow', 100);
  picoPot(b, board, 0.5);
  return b.doc('Raspberry Pi Pico: potentiometer and PWM', 5e-5, 1);
}

function picoOled(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'pi-pico', 'pico-oled');
  const oled = b.add('oled', 18, 3);
  b.routeAll([
    [board.pin('GP20'), oled.pin('SDA')],
    [board.pin('GP21'), oled.pin('SCL')],
  ]);
  powered(b, oled, 'VCC', 'GND', 3.3);
  picoPot(b, board, 0.6);
  return b.doc('Raspberry Pi Pico: OLED on I2C0 (GP20, GP21)', 5e-5, 1);
}

function picoServo(): CircuitDoc {
  const b = new Builder();
  const board = boardWith(b, 'pi-pico', 'pico-servo');
  const servo = b.add('servo', 18, 2);
  b.route(board.pin('GP18'), servo.pin('SIG'));
  powered(b, servo, 'V+', 'GND', 5);
  picoPot(b, board, 0.25);
  return b.doc('Raspberry Pi Pico: servo knob', 5e-5, 1);
}

/** The MicroPython example's program: it blinks the LED on GP16 and reports in the serial monitor. */
export const MICROPYTHON_BLINK = `from machine import Pin
import time

led = Pin(16, Pin.OUT)
for n in range(1, 1000):
    led.toggle()
    print("Blink", n)
    time.sleep(0.5)
`;

function picoMicroPython(): CircuitDoc {
  const b = new Builder();
  const board = b.add('pi-pico', 2, 1);
  b.firmware[board.part.id] = { kind: 'pico-image', name: 'MicroPython', python: MICROPYTHON_BLINK };
  const [gx, gy] = board.pin('GND');
  b.add('ground', gx - 2, gy + 1);
  b.wire([gx, gy], [gx - 2, gy], [gx - 2, gy + 1]);
  ledAt(b, board.pin('GP16'), 14, 2, 'green', 100);
  return b.doc('Raspberry Pi Pico: MicroPython', 5e-5, 1);
}

/* ------------------------------------------------------------------- ESP32 -- */

function esp32Demo(): CircuitDoc {
  const b = new Builder();
  const board = b.add('esp32', 2, 1);
  b.firmware[board.part.id] = { kind: 'esp32-demo' };
  b.add('ground', 0, 3);
  b.wire(board.pin('GND'), [0, 2], [0, 3]);
  // GPIO2 blinks.
  const [x2, y2] = board.pin('GPIO2');
  const r1 = b.add('resistor', x2 + 10, y2, { r: 220 });
  const led1 = b.add('led', x2 + 13, y2, { colour: 'blue' });
  b.wire([x2, y2], r1.pin('a'));
  b.add('ground', led1.pin('cathode')[0], y2);
  // GPIO14: button to ground with a pull-up to 3.3 V.
  const [x14, y14] = board.pin('GPIO14');
  const pull = b.add('resistor', x14 + 6, y14, { r: 10_000 }, 3);
  b.add('rail', x14 + 6, y14 - 3, { v: 3.3 });
  const button = b.add('pushbutton', x14 + 8, y14);
  b.wire([x14, y14], pull.pin('a'), button.pin('a'));
  b.add('ground', button.pin('b')[0], y14);
  // GPIO16 follows the button; GPIO19 fades.
  ledFrom(b, board.pin('GPIO16'), 'green');
  ledFrom(b, board.pin('GPIO19'), 'yellow');
  return b.doc('ESP32: blink, button and fade', 1e-4, 1);
}

/* ---------------------------------------------------------------- analysis -- */

const id = (p: Placed) => p.part.id;

function rcFilter(): CircuitDoc {
  const b = new Builder();
  const gen = b.add('ac-source', 3, 4, { shape: 'sine', amplitude: 1, f: 1000 });
  const r = b.add('resistor', 5, 3, { r: 1000 });
  const c = b.add('capacitor', 11, 4, { c: 100e-9 }, 1);
  b.add('probe', 4, 3, { trace: '1' });
  const out = b.add('probe', 11, 3, { trace: '2' });
  b.add('ground', 3, 9);
  b.wire(gen.pin('+'), [3, 3], [4, 3], r.pin('a'));
  b.link(r.pin('b'), c.pin('a'));
  b.wire(c.pin('b'), [11, 9], [3, 9]);
  b.wire(gen.pin('−'), [3, 9]);
  b.analysis = {
    kind: 'ac',
    outputs: [{ kind: 'v', part: id(out) }],
    ac: { source: id(gen), from: 10, to: 1e6, perDecade: 30 },
    stepping: { part: id(c), prop: 'c', values: [47e-9, 100e-9, 220e-9] },
  };
  return b.doc('RC low-pass filter (frequency response)', 5e-6, 0.02);
}

function diodeCurves(): CircuitDoc {
  const b = new Builder();
  const battery = b.add('battery', 3, 4, { v: 2 });
  const r1 = b.add('resistor', 8, 1, { r: 100 }, 1);
  const d1 = b.add('diode', 8, 5, { model: 'silicon' }, 1);
  const r2 = b.add('resistor', 14, 1, { r: 100 }, 1);
  const d2 = b.add('led', 14, 5, { colour: 'red' }, 1);
  b.add('ground', 3, 10);
  b.wire(battery.pin('+'), [3, 1], r1.pin('a'), r2.pin('a'));
  b.wire(r1.pin('b'), d1.pin('anode'));
  b.wire(r2.pin('b'), d2.pin('anode'));
  b.wire(battery.pin('−'), [3, 10], [8, 10], [14, 10]);
  b.wire(d1.pin('cathode'), [8, 10]);
  b.wire(d2.pin('cathode'), [14, 10]);
  b.analysis = {
    kind: 'dc',
    outputs: [
      { kind: 'i', part: id(d1) },
      { kind: 'i', part: id(d2) },
    ],
    dc: { part: id(battery), prop: 'v', from: 0, to: 5, points: 101 },
  };
  return b.doc('Diode and LED characteristics (DC sweep)', 1e-4, 1);
}

function commonEmitter(): CircuitDoc {
  const b = new Builder();
  b.add('rail', 12, 0, { v: 12 });
  const r1 = b.add('resistor', 9, 0, { r: 47_000 }, 1);
  const r2 = b.add('resistor', 9, 9, { r: 10_000 }, 1);
  const q = b.add('npn', 12, 6, { beta: 150 });
  const rc = b.add('resistor', 14, 0, { r: 4700 }, 1);
  const re = b.add('resistor', 14, 9, { r: 1000 }, 1);
  const ce = b.add('capacitor', 19, 9, { c: 100e-6 }, 1);
  const cin = b.add('capacitor', 6, 6, { c: 10e-6 });
  const cout = b.add('capacitor', 17, 4, { c: 10e-6 });
  const load = b.add('resistor', 20, 4, { r: 10_000 }, 1);
  const gen = b.add('ac-source', 3, 8, { shape: 'sine', amplitude: 0.01, f: 1000 });
  b.add('probe', 3, 7, { trace: '1' });
  const out = b.add('probe', 20, 4, { trace: '2' });
  b.add('ground', 5, 13);
  b.wire(r1.pin('a'), [12, 0], rc.pin('a'));
  b.wire(r1.pin('b'), cin.pin('b'), r2.pin('a'));
  b.wire(cin.pin('b'), q.pin('base'));
  b.wire(rc.pin('b'), q.pin('collector'));
  b.wire(q.pin('collector'), cout.pin('a'));
  b.wire(q.pin('emitter'), re.pin('a'));
  b.wire(q.pin('emitter'), [19, 8], ce.pin('a'));
  b.wire(gen.pin('+'), [3, 7], [3, 6], cin.pin('a'));
  b.wire(gen.pin('−'), [3, 13], [5, 13], [9, 13], [14, 13], [19, 13], [20, 13]);
  b.wire(r2.pin('b'), [9, 13]);
  b.wire(re.pin('b'), [14, 13]);
  b.wire(ce.pin('b'), [19, 13]);
  b.wire(load.pin('b'), [20, 13]);
  void cout;
  b.analysis = { kind: 'ac', outputs: [{ kind: 'v', part: id(out) }], ac: { source: id(gen), from: 1, to: 1e7, perDecade: 20 } };
  return b.doc('Common-emitter amplifier (bias and gain)', 2e-6, 0.01);
}

function powerSupply(): CircuitDoc {
  const b = new Builder();
  const mains = b.add('ac-source', 2, 4, { shape: 'sine', amplitude: 325, f: 50 });
  const t = b.add('transformer', 5, 3, { ratio: 18, lp: 10, k: 0.999 });
  b.add('ground', 2, 9);
  // Bridge rectifier: the diodes point up, towards the positive rail at the top.
  const d1 = b.add('diode', 13, 3, { model: 'silicon' }, 3);
  const d3 = b.add('diode', 13, 6, { model: 'silicon' }, 3);
  const d2 = b.add('diode', 16, 7, { model: 'silicon' }, 3);
  const d4 = b.add('diode', 16, 10, { model: 'silicon' }, 3);
  const reservoir = b.add('capacitor', 20, 0, { c: 1000e-6 }, 1);
  const reg = b.add('regulator', 22, -1, { v: 5 });
  const c2 = b.add('capacitor', 30, 0, { c: 10e-6 }, 1);
  const load = b.add('resistor', 33, 0, { r: 100 }, 1);
  const p1 = b.add('probe', 21, 0, { trace: '1' });
  const p2 = b.add('probe', 31, 0, { trace: '2' });
  b.add('ground', 22, 10);
  b.link(mains.pin('+'), t.pin('P1'), 'vh');
  b.wire(mains.pin('−'), [2, 7], t.pin('P2'));
  b.wire([2, 7], [2, 9]);
  b.wire(t.pin('S1'), d1.pin('anode'));
  b.wire(t.pin('S2'), d2.pin('anode'));
  b.wire(d1.pin('cathode'), [16, 0], reservoir.pin('a'), [21, 0], reg.pin('IN'));
  b.wire(d2.pin('cathode'), [16, 0]);
  b.wire(d3.pin('anode'), [13, 10], d4.pin('anode'));
  b.wire(reg.pin('OUT'), c2.pin('a'), [31, 0], load.pin('a'));
  b.wire(d4.pin('anode'), [20, 10], [22, 10], [25, 10], [30, 10], [33, 10]);
  b.wire(reservoir.pin('b'), [20, 10]);
  b.wire(reg.pin('GND'), [25, 10]);
  b.wire(c2.pin('b'), [30, 10]);
  b.wire(load.pin('b'), [33, 10]);
  void d3;
  b.analysis = {
    kind: 'tran',
    outputs: [
      { kind: 'v', part: id(p1) },
      { kind: 'v', part: id(p2) },
    ],
    tran: { stop: 0.2, step: 2e-5 },
  };
  return b.doc('Mains power supply: transformer, bridge and 7805', 2e-5, 0.1);
}

function schmitt(): CircuitDoc {
  const b = new Builder();
  const gen = b.add('ac-source', 2, 6, { shape: 'sine', amplitude: 2, f: 50 });
  const cmp = b.add('comparator', 9, 5, { high: 5, low: 0, hysteresis: 1 });
  const load = b.add('resistor', 16, 5, { r: 10_000 }, 1);
  const p1 = b.add('probe', 4, 6, { trace: '1' });
  const p2 = b.add('probe', 14, 5, { trace: '2' });
  b.add('ground', 7, 4);
  b.add('ground', 9, 10);
  b.wire(gen.pin('+'), [4, 6], cmp.pin('+'));
  b.wire(cmp.pin('−'), [7, 4]);
  b.wire(cmp.pin('out'), [14, 5], load.pin('a'));
  b.wire(gen.pin('−'), [2, 10], [9, 10], [16, 10], load.pin('b'));
  b.analysis = {
    kind: 'tran',
    outputs: [
      { kind: 'v', part: id(p1) },
      { kind: 'v', part: id(p2) },
    ],
    tran: { stop: 0.06, step: 2e-5 },
  };
  return b.doc('Comparator with hysteresis', 2e-5, 0.1);
}

function resonantFilter(): CircuitDoc {
  const b = new Builder();
  const gen = b.add('ac-source', 2, 4, { shape: 'square', amplitude: 1, f: 100 });
  const h = b.add('laplace', 5, 3, { h: '(2*pi*1k)^2/(s^2 + s*2*pi*1k/2 + (2*pi*1k)^2)' });
  const out = b.add('probe', 11, 3, { trace: '2' });
  b.add('probe', 3, 3, { trace: '1' });
  b.add('ground', 2, 8);
  b.wire(gen.pin('+'), [2, 3], [3, 3], h.pin('in'));
  b.wire(gen.pin('−'), [2, 8]);
  b.analysis = { kind: 'ac', outputs: [{ kind: 'v', part: id(out) }], ac: { source: id(gen), from: 10, to: 100_000, perDecade: 40 } };
  return b.doc('Transfer function block: resonant low-pass (Q = 2)', 1e-5, 0.05);
}

export const EXAMPLES: readonly Example[] = [
  { id: 'led', title: 'LED and resistor', group: 'Basics', description: 'A 9 V battery lights an LED through a 470 Ω resistor. Click the switch to turn it off.', make: ledAndResistor },
  { id: 'divider', title: 'Voltage divider', group: 'Basics', description: 'Two resistors split 12 V; the voltmeter reads the lower one.', make: voltageDivider },
  {
    id: 'rc',
    title: 'RC charging and discharging',
    group: 'Basics',
    description: 'A 1 Hz square wave charges a capacitor through a resistor (time constant 0.1 s). Probes show both on the oscilloscope.',
    scope: 2,
    make: rcCharging,
  },
  {
    id: 'transistor',
    title: 'Transistor switch',
    group: 'Analog',
    description: 'Pressing the button sends a small base current that switches the LED on through the NPN transistor.',
    make: transistorSwitch,
  },
  {
    id: 'opamp',
    title: 'Op-amp inverting amplifier',
    group: 'Analog',
    description: 'A 1 kHz sine wave amplified 4.7 times and inverted. Runs in slow motion.',
    scope: 0.004,
    make: invertingAmplifier,
  },
  { id: '555', title: '555 timer blinker', group: 'Analog', description: 'The 555 in astable mode flashes an LED about 1.5 times a second.', make: blinker555 },
  {
    id: 'relay',
    title: 'Relay switching a motor',
    group: 'Analog',
    description: 'The button energises the relay coil, whose contact runs a motor from a second battery. The diode protects against the coil’s back-EMF.',
    make: relayMotor,
  },
  {
    id: 'an-rc-filter',
    title: 'RC filter: frequency response',
    group: 'Analysis',
    description: 'A Bode plot of a 1 kΩ, 100 nF low-pass filter with the capacitor stepped through 47, 100 and 220 nF: the corner moves from 3.4 kHz to 720 Hz.',
    analysis: true,
    scope: 0.004,
    make: rcFilter,
  },
  {
    id: 'an-diodes',
    title: 'Diode and LED curves: DC sweep',
    group: 'Analysis',
    description: 'The supply sweeps from 0 to 5 V; the plot shows where a silicon diode and a red LED start to conduct.',
    analysis: true,
    make: diodeCurves,
  },
  {
    id: 'an-amplifier',
    title: 'Common-emitter amplifier',
    group: 'Analysis',
    description: 'Run the operating point to see the bias, then the frequency response: about 45 dB of gain above the corner set by the emitter capacitor.',
    analysis: true,
    scope: 0.004,
    make: commonEmitter,
  },
  {
    id: 'an-power-supply',
    title: 'Mains power supply',
    group: 'Analysis',
    description: '230 V mains through an 18:1 transformer, a bridge rectifier and 1000 µF, regulated to 5 V by a 7805. The time-domain run shows the ripple and the steady output.',
    analysis: true,
    scope: 0.1,
    make: powerSupply,
  },
  {
    id: 'an-schmitt',
    title: 'Comparator with hysteresis',
    group: 'Analysis',
    description: 'A 50 Hz sine into a comparator with 1 V of hysteresis: the output switches at +0.5 V and −0.5 V.',
    analysis: true,
    scope: 0.04,
    make: schmitt,
  },
  {
    id: 'an-laplace',
    title: 'Transfer function block',
    group: 'Analysis',
    description: 'A Laplace block H(s) as a second-order low-pass at 1 kHz with Q = 2: a 6 dB peak, then 40 dB per decade. Try the time domain to see its square-wave ringing.',
    analysis: true,
    scope: 0.02,
    make: resonantFilter,
  },
  { id: 'half-adder', title: 'Half adder', group: 'Digital', description: 'XOR and AND gates add two bits. Click the inputs to change them.', make: halfAdder },
  { id: 'counter', title: 'Counter and 7-segment display', group: 'Digital', description: 'A 2 Hz clock drives a decade counter, decoded onto a seven-segment display.', make: counterDisplay },
  { id: 'uno-blink', title: 'Blink', group: 'Arduino', description: 'The classic first sketch: the LED on pin 13 blinks every half second.', make: unoBlink },
  { id: 'uno-traffic', title: 'Traffic lights', group: 'Arduino', description: 'Red, yellow and green LEDs on pins 2 to 4 run a traffic light sequence.', make: unoTraffic },
  { id: 'uno-button', title: 'Button and LED', group: 'Arduino', description: 'Pin 2 reads the button using its internal pull-up; the LED on pin 13 lights while it is pressed.', make: unoButton },
  { id: 'uno-fade', title: 'Fading LED', group: 'Arduino', description: 'analogWrite fades the LED on pin 9 up and down with PWM.', make: unoFade },
  {
    id: 'uno-dimmer',
    title: 'Dimmer',
    group: 'Arduino',
    description: 'The potentiometer on A0 sets the LED’s brightness; the reading appears in the serial monitor. Drag the knob while it runs.',
    make: unoDimmer,
  },
  { id: 'uno-chaser', title: 'LED chaser', group: 'Arduino', description: 'Eight LEDs on pins 2 to 9 light one after another.', make: unoChaser },
  { id: 'uno-7seg', title: 'Seven-segment counter', group: 'Arduino', description: 'Pins 8 down to 2 drive the segments of a display counting 0 to 9.', make: unoSevenSegment },
  { id: 'uno-serial', title: 'Serial control', group: 'Arduino', description: 'Type 1 or 0 in the serial monitor to switch the LED on pin 13.', make: unoSerial },
  { id: 'uno-oled', title: 'OLED display', group: 'Displays', description: 'An SSD1306 OLED on the I²C bus (A4 and A5) shows text, a frame counter and a bouncing ball.', make: unoOled },
  {
    id: 'uno-lcd-i2c',
    title: 'LCD with I²C backpack',
    group: 'Displays',
    description: 'A 16×2 LCD through a PCF8574 backpack at 0x27: a greeting, a custom heart character and the seconds running.',
    make: unoLcdI2c,
  },
  {
    id: 'uno-lcd',
    title: 'Character LCD (parallel)',
    group: 'Displays',
    description: 'The Arduino tutorial’s 16×2 LCD in 4-bit mode on pins 12, 11 and 5 to 2, with its backlight through 220 Ω.',
    make: unoLcd,
  },
  { id: 'uno-tft', title: 'Colour TFT', group: 'Displays', description: 'An ILI9341 240×320 TFT on the SPI bus draws text, colour bars and shapes, then counts seconds.', make: unoTft },
  {
    id: 'uno-matrix',
    title: 'LED matrix',
    group: 'Displays',
    description: 'A MAX7219 8×8 matrix, sent bit by bit with LedControl: a heart, a smile and a dot running round the edge.',
    make: unoMatrix,
  },
  { id: 'uno-neopixel', title: 'NeoPixel ring', group: 'Displays', description: 'A rainbow turns round a ring of 16 WS2812B LEDs on pin 6.', make: unoNeopixel },
  { id: 'uno-rgb', title: 'RGB LED', group: 'Displays', description: 'PWM on pins 9, 10 and 11 mixes red, green and blue round the colour wheel.', make: unoRgb },
  { id: 'uno-595', title: 'Shift register', group: 'Displays', description: 'A 74HC595 drives eight LEDs from three pins, counting in binary.', make: unoShiftRegister },
  {
    id: 'uno-dht22',
    title: 'Temperature and humidity',
    group: 'Sensors',
    description: 'A DHT22 on pin 2 reports temperature, humidity and the heat index every two seconds. Change its readings while it runs.',
    make: unoDht,
  },
  { id: 'uno-bme280', title: 'Weather sensor', group: 'Sensors', description: 'A BME280 on I²C, read with the datasheet’s formulas: temperature, pressure and humidity every second.', make: unoBme },
  { id: 'uno-mpu6050', title: 'Motion sensor', group: 'Sensors', description: 'An MPU6050 on I²C: acceleration, rotation and temperature. Tilt it with the sliders while it runs.', make: unoMpu },
  { id: 'uno-clock', title: 'Clock', group: 'Sensors', description: 'A DS1307 clock and an I²C LCD share the bus; the clock starts at the computer’s time.', make: unoClock },
  { id: 'uno-sonar', title: 'Ultrasonic distance', group: 'Sensors', description: 'An HC-SR04 measures the distance set on it, from the length of its echo pulse.', make: unoSonar },
  { id: 'uno-pir', title: 'Motion detector', group: 'Sensors', description: 'Click the PIR sensor to make motion; the LED on pin 13 follows its output.', make: unoPir },
  { id: 'uno-ldr', title: 'Light sensor', group: 'Sensors', description: 'An LDR and 10 kΩ divide 5 V into A0; the LED lights when it is dark. Change the light while it runs.', make: unoLdr },
  { id: 'uno-ntc', title: 'Thermometer', group: 'Sensors', description: 'An NTC thermistor and 10 kΩ on A0, worked out with the B equation.', make: unoNtc },
  { id: 'uno-servo', title: 'Servo sweep', group: 'Motors and controls', description: 'The Servo library sweeps a servo on pin 9 from 0 to 180 degrees and back.', make: unoServo },
  { id: 'uno-servo-knob', title: 'Servo knob', group: 'Motors and controls', description: 'The potentiometer on A0 sets the servo’s angle. Drag the knob while it runs.', make: unoServoKnob },
  { id: 'uno-stepper', title: 'Stepper motor', group: 'Motors and controls', description: 'A 28BYJ-48 on a ULN2003 board turns half a turn each way with the Stepper library.', make: unoStepper },
  { id: 'uno-keypad', title: 'Keypad lock', group: 'Motors and controls', description: 'Click the keys: 1 2 3 4 then # lights the LED on pin 13; * clears.', make: unoKeypad },
  {
    id: 'uno-encoder',
    title: 'Rotary encoder',
    group: 'Motors and controls',
    description: 'Click the arrows to turn the knob and the middle to press it; the count appears in the serial monitor.',
    make: unoEncoder,
  },
  { id: 'uno-joystick', title: 'Joystick', group: 'Motors and controls', description: 'Move the joystick with its sliders and press it; A0, A1 and pin 2 report it.', make: unoJoystick },
  { id: 'nano-oled', title: 'Arduino Nano: OLED', group: 'More boards', description: 'The OLED example on an Arduino Nano (the same chip as the Uno).', make: nanoOled },
  { id: 'mega-blink', title: 'Arduino Mega: blink', group: 'More boards', description: 'The Mega 2560 blinks pin 13 and greets the serial monitor.', make: megaBlink },
  { id: 'mega-bars', title: 'Arduino Mega: bar graph', group: 'More boards', description: 'The potentiometer on A8 lights 0 to 10 LEDs on pins 22 to 31.', make: megaBarGraph },
  { id: 'mega-oled', title: 'Arduino Mega: OLED', group: 'More boards', description: 'On the Mega the I²C pins are 20 and 21; the OLED shows the reading of A0.', make: megaOled },
  { id: 'tiny-blink', title: 'ATtiny85: blink', group: 'More boards', description: 'The ATtiny85 blinks an LED on PB1.', make: tinyBlink('tiny-blink', 'ATtiny85: blink') },
  { id: 'tiny-fade', title: 'ATtiny85: fade', group: 'More boards', description: 'PWM on PB1 fades the LED.', make: tinyBlink('tiny-fade', 'ATtiny85: fade') },
  {
    id: 'tiny-serial',
    title: 'ATtiny85: serial output',
    group: 'More boards',
    description: 'The ATtiny85 has no serial port: Serial sends on PB0 by software at 9600 baud, and the serial monitor reads it.',
    make: tinyBlink('tiny-serial', 'ATtiny85: serial output'),
  },
  { id: 'tiny-neopixel', title: 'ATtiny85: NeoPixels', group: 'More boards', description: 'Eight NeoPixels on PB3, driven at 8 MHz.', make: tinyNeopixel },
  {
    id: 'pico-blink',
    title: 'Blink',
    group: 'Raspberry Pi Pico',
    description: 'The LED on the Pico (GP25) and a green LED on GP16 blink in turn; the serial monitor reads UART0.',
    make: picoLed('pico-blink', 'Raspberry Pi Pico: blink'),
  },
  {
    id: 'pico-button',
    title: 'Button and LED',
    group: 'Raspberry Pi Pico',
    description: 'GP17 reads the button with its pull-up; the LED on GP16 lights while it is held, and presses are counted.',
    make: picoButton,
  },
  { id: 'pico-fade', title: 'Fading LED', group: 'Raspberry Pi Pico', description: 'The RP2040’s PWM on GP16 fades the LED up and down.', make: picoLed('pico-fade', 'Raspberry Pi Pico: fading LED') },
  {
    id: 'pico-pot',
    title: 'Potentiometer and PWM',
    group: 'Raspberry Pi Pico',
    description: 'The ADC reads the potentiometer on GP26 (A0); the LED’s brightness follows it and the volts appear in the serial monitor.',
    make: picoPotLed,
  },
  { id: 'pico-oled', title: 'OLED display', group: 'Raspberry Pi Pico', description: 'An SSD1306 OLED on I2C0 at GP20 and GP21 draws the potentiometer’s reading as a bar.', make: picoOled },
  { id: 'pico-servo', title: 'Servo knob', group: 'Raspberry Pi Pico', description: 'The potentiometer on GP26 sets the servo on GP18, driven by 50 Hz PWM.', make: picoServo },
  {
    id: 'pico-micropython',
    title: 'MicroPython',
    group: 'Raspberry Pi Pico',
    description: 'Download MicroPython for the Pico (a .uf2 from micropython.org) and open it on the board: the Python program in its panel then blinks GP16. Edit the program and run it again.',
    make: picoMicroPython,
  },
  {
    id: 'esp32-demo',
    title: 'Blink, button and fade',
    group: 'ESP32',
    description: 'Benchtop’s demo firmware: GPIO2 blinks, GPIO16 follows the button on GPIO14, GPIO19 fades with PWM, and messages appear in the serial monitor. Needs the desktop app.',
    make: esp32Demo,
  },
];
