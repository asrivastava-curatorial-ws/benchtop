/**
 * The parts of the circuit editor: their terminals on the grid, editable
 * properties and the solver elements they become.  Drawings live with the
 * editor (src/tools/custom/_circuit-draw.tsx).
 */
import { BoardElement, ESP32, UNO } from './boards';
import {
  Ammeter,
  Bjt,
  Buzzer,
  Capacitor,
  ChangeoverSwitch,
  Clock,
  Counter,
  CurrentSource,
  DIODES,
  Diode,
  type DiodeModel,
  FlipFlop,
  type FlipFlopKind,
  Gate,
  type GateKind,
  Inductor,
  Lamp,
  LogicInput,
  LogicProbe,
  ledModel,
  Mosfet,
  Motor,
  OpAmp,
  Potentiometer,
  Probe,
  Relay,
  Resistor,
  SegmentDecoder,
  SevenSegment,
  Switch,
  Timer555,
  VoltageSource,
  Voltmeter,
  type Waveform,
} from './elements';
import type { Element } from './engine';

export type PropValue = number | string | boolean;
export type Props = Readonly<Record<string, PropValue>>;

export interface PropDef {
  readonly key: string;
  readonly label: string;
  readonly kind: 'number' | 'choice' | 'boolean';
  readonly default: PropValue;
  /** Unit for SI entry and display (Ω, F, H, V, A, Hz, s). */
  readonly unit?: string;
  readonly choices?: readonly (readonly [string, string])[];
  readonly min?: number;
  readonly max?: number;
}

export interface Terminal {
  readonly x: number;
  readonly y: number;
  readonly name: string;
}

export type Group = 'Passive' | 'Sources' | 'Semiconductors' | 'Logic' | 'Outputs' | 'Meters' | 'Boards';

/** What a placed part becomes in the solver, with what the editor shows and changes while it runs. */
export interface Runtime {
  readonly elements: Element[];
  readonly view: () => Readonly<Record<string, number | boolean | string | readonly number[]>>;
  readonly interact?: (action: 'toggle' | 'press' | 'release') => void;
  readonly adjust?: (value: number) => void;
}

export interface PartDef {
  readonly type: string;
  readonly name: string;
  readonly group: Group;
  readonly terminals: readonly Terminal[];
  /** Outline in grid units before rotation: [x0, y0, x1, y1]. */
  readonly box: readonly [number, number, number, number];
  readonly props: readonly PropDef[];
  /** Terminal pairs joined inside the part. */
  readonly internal?: readonly (readonly [number, number])[];
  /** Ground: its terminal is node 0. */
  readonly ground?: boolean;
  /** What clicking it does while the circuit runs. */
  readonly interactive?: 'toggle' | 'press' | 'adjust';
  /** Terminals from this index on are left out of the circuit when nothing connects to them (board pins). */
  readonly floatingFrom?: number;
  readonly keywords?: string;
  create(props: Props, nodes: readonly number[]): Runtime;
}

const num = (props: Props, key: string, fallback: number) => {
  const v = props[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};
const str = (props: Props, key: string, fallback: string) => {
  const v = props[key];
  return typeof v === 'string' ? v : fallback;
};
const bool = (props: Props, key: string, fallback: boolean) => {
  const v = props[key];
  return typeof v === 'boolean' ? v : fallback;
};

function at<T extends Element>(element: T, nodes: readonly number[], order: readonly number[]): T {
  element.nodes = order.map((i) => nodes[i] as number);
  return element;
}

const TWO: readonly Terminal[] = [
  { x: 0, y: 0, name: 'a' },
  { x: 3, y: 0, name: 'b' },
];
const VERTICAL: readonly Terminal[] = [
  { x: 0, y: 0, name: '+' },
  { x: 0, y: 3, name: '−' },
];

const SUPPLY: PropDef = { key: 'supply', label: 'Logic supply', kind: 'number', default: 5, unit: 'V', min: 1, max: 15 };

const WAVES: readonly (readonly [string, string])[] = [
  ['sine', 'Sine'],
  ['square', 'Square'],
  ['triangle', 'Triangle'],
  ['sawtooth', 'Sawtooth'],
  ['pulse', 'Pulse (0 to peak)'],
];

const LED_CHOICES: readonly (readonly [string, string])[] = [
  ['red', 'Red'],
  ['orange', 'Orange'],
  ['yellow', 'Yellow'],
  ['green', 'Green'],
  ['blue', 'Blue'],
  ['white', 'White'],
  ['infrared', 'Infrared'],
];

function gate(type: GateKind, name: string): PartDef {
  const single = type === 'not' || type === 'buffer';
  return {
    type,
    name,
    group: 'Logic',
    terminals: single
      ? [
          { x: 0, y: 0, name: 'A' },
          { x: 4, y: 0, name: 'Y' },
        ]
      : [
          { x: 0, y: -1, name: 'A' },
          { x: 0, y: 1, name: 'B' },
          { x: 4, y: 0, name: 'Y' },
        ],
    box: single ? [0, -1, 4, 1] : [0, -1.5, 4, 1.5],
    props: [SUPPLY],
    keywords: 'logic gate digital boolean',
    create(props, nodes) {
      const g = at(new Gate(type, single ? 1 : 2, num(props, 'supply', 5)), nodes, single ? [0, 1] : [0, 1, 2]);
      return { elements: [g], view: () => ({ out: g.out }) };
    },
  };
}

function flipFlop(kind: FlipFlopKind, name: string, inputs: readonly Terminal[]): PartDef {
  return {
    type: `${kind}-flipflop`,
    name,
    group: 'Logic',
    terminals: [...inputs, { x: 5, y: 1, name: 'Q' }, { x: 5, y: 3, name: 'Q̄' }],
    box: [0, 0, 5, 4],
    props: [SUPPLY],
    keywords: 'flip flop latch memory register digital',
    create(props, nodes) {
      const f = at(new FlipFlop(kind, num(props, 'supply', 5)), nodes, [...inputs.map((_, i) => i), inputs.length, inputs.length + 1]);
      return { elements: [f], view: () => ({ q: f.q }) };
    },
  };
}

export const PARTS: readonly PartDef[] = [
  /* ------------------------------------------------------------ passive -- */
  {
    type: 'resistor',
    name: 'Resistor',
    group: 'Passive',
    terminals: TWO,
    box: [0, -0.6, 3, 0.6],
    props: [{ key: 'r', label: 'Resistance', kind: 'number', default: 1000, unit: 'Ω', min: 0.001 }],
    keywords: 'ohm resistance',
    create(props, nodes) {
      const r = at(new Resistor(num(props, 'r', 1000)), nodes, [0, 1]);
      return { elements: [r], view: () => ({}) };
    },
  },
  {
    type: 'capacitor',
    name: 'Capacitor',
    group: 'Passive',
    terminals: TWO,
    box: [0, -0.8, 3, 0.8],
    props: [{ key: 'c', label: 'Capacitance', kind: 'number', default: 1e-6, unit: 'F', min: 1e-15 }],
    keywords: 'farad capacitance electrolytic',
    create(props, nodes) {
      const c = at(new Capacitor(num(props, 'c', 1e-6)), nodes, [0, 1]);
      return { elements: [c], view: () => ({}) };
    },
  },
  {
    type: 'inductor',
    name: 'Inductor',
    group: 'Passive',
    terminals: TWO,
    box: [0, -0.6, 3, 0.4],
    props: [{ key: 'l', label: 'Inductance', kind: 'number', default: 1e-3, unit: 'H', min: 1e-12 }],
    keywords: 'henry coil choke',
    create(props, nodes) {
      const l = at(new Inductor(num(props, 'l', 1e-3)), nodes, [0, 1]);
      return { elements: [l], view: () => ({}) };
    },
  },
  {
    type: 'potentiometer',
    name: 'Potentiometer',
    group: 'Passive',
    terminals: [
      { x: 0, y: 0, name: 'end 1' },
      { x: 2, y: -1, name: 'wiper' },
      { x: 4, y: 0, name: 'end 2' },
    ],
    box: [0, -1, 4, 0.8],
    props: [
      { key: 'r', label: 'Resistance', kind: 'number', default: 10_000, unit: 'Ω', min: 1 },
      { key: 'position', label: 'Position (0–1)', kind: 'number', default: 0.5, min: 0, max: 1 },
    ],
    interactive: 'adjust',
    keywords: 'pot variable resistor knob slider',
    create(props, nodes) {
      const p = at(new Potentiometer(num(props, 'r', 10_000), num(props, 'position', 0.5)), nodes, [0, 1, 2]);
      return {
        elements: [p],
        view: () => ({ position: p.position }),
        adjust: (value) => {
          p.position = Math.min(1, Math.max(0, value));
        },
      };
    },
  },
  {
    type: 'switch',
    name: 'Switch',
    group: 'Passive',
    terminals: TWO,
    box: [0, -1, 3, 0.4],
    props: [{ key: 'closed', label: 'Closed', kind: 'boolean', default: false }],
    interactive: 'toggle',
    keywords: 'toggle spst on off',
    create(props, nodes) {
      const s = at(new Switch(bool(props, 'closed', false)), nodes, [0, 1]);
      return {
        elements: [s],
        view: () => ({ closed: s.closed }),
        interact: (action) => {
          if (action === 'toggle') s.closed = !s.closed;
        },
      };
    },
  },
  {
    type: 'pushbutton',
    name: 'Push button',
    group: 'Passive',
    terminals: TWO,
    box: [0, -1.2, 3, 0.4],
    props: [],
    interactive: 'press',
    keywords: 'button momentary tactile',
    create(_props, nodes) {
      const s = at(new Switch(false), nodes, [0, 1]);
      return {
        elements: [s],
        view: () => ({ closed: s.closed }),
        interact: (action) => {
          if (action === 'press') s.closed = true;
          if (action === 'release') s.closed = false;
        },
      };
    },
  },
  {
    type: 'spdt',
    name: 'Changeover switch',
    group: 'Passive',
    terminals: [
      { x: 0, y: 0, name: 'common' },
      { x: 3, y: -1, name: 'A' },
      { x: 3, y: 1, name: 'B' },
    ],
    box: [0, -1, 3, 1],
    props: [{ key: 'toB', label: 'Set to B', kind: 'boolean', default: false }],
    interactive: 'toggle',
    keywords: 'spdt selector two way',
    create(props, nodes) {
      const s = at(new ChangeoverSwitch(bool(props, 'toB', false)), nodes, [0, 1, 2]);
      return {
        elements: [s],
        view: () => ({ toB: s.toSecond }),
        interact: (action) => {
          if (action === 'toggle') s.toSecond = !s.toSecond;
        },
      };
    },
  },
  {
    type: 'relay',
    name: 'Relay',
    group: 'Passive',
    terminals: [
      { x: 0, y: 0, name: 'coil +' },
      { x: 0, y: 4, name: 'coil −' },
      { x: 3, y: 4, name: 'COM' },
      { x: 4, y: 0, name: 'NO' },
      { x: 2, y: 0, name: 'NC' },
    ],
    box: [-0.8, 0, 4.4, 4],
    props: [
      { key: 'coil', label: 'Coil resistance', kind: 'number', default: 100, unit: 'Ω', min: 1 },
      { key: 'pull', label: 'Pull-in current', kind: 'number', default: 0.03, unit: 'A', min: 1e-6 },
    ],
    keywords: 'relay coil contact',
    create(props, nodes) {
      const r = at(new Relay(num(props, 'coil', 100), num(props, 'pull', 0.03)), nodes, [0, 1, 2, 3, 4]);
      return { elements: [r], view: () => ({ on: r.energised }) };
    },
  },
  /* ------------------------------------------------------------ sources -- */
  {
    type: 'battery',
    name: 'Battery or DC supply',
    group: 'Sources',
    terminals: VERTICAL,
    box: [-1, 0, 1, 3],
    props: [
      { key: 'v', label: 'Voltage', kind: 'number', default: 9, unit: 'V' },
      { key: 'r', label: 'Internal resistance', kind: 'number', default: 0, unit: 'Ω', min: 0 },
    ],
    keywords: 'battery cell dc voltage source power supply',
    create(props, nodes) {
      const v = at(new VoltageSource('dc', num(props, 'v', 9), 0, 0, num(props, 'r', 0)), nodes, [0, 1]);
      return { elements: [v], view: () => ({}) };
    },
  },
  {
    type: 'ac-source',
    name: 'Signal generator',
    group: 'Sources',
    terminals: VERTICAL,
    box: [-1, 0, 1, 3],
    props: [
      { key: 'shape', label: 'Waveform', kind: 'choice', default: 'sine', choices: WAVES },
      { key: 'amplitude', label: 'Peak', kind: 'number', default: 5, unit: 'V' },
      { key: 'f', label: 'Frequency', kind: 'number', default: 50, unit: 'Hz', min: 0 },
      { key: 'offset', label: 'Offset', kind: 'number', default: 0, unit: 'V' },
      { key: 'duty', label: 'Pulse duty (0–1)', kind: 'number', default: 0.5, min: 0, max: 1 },
    ],
    keywords: 'ac sine square function generator signal oscillator',
    create(props, nodes) {
      const v = at(new VoltageSource(str(props, 'shape', 'sine') as Waveform, num(props, 'amplitude', 5), num(props, 'f', 50), num(props, 'offset', 0), 0, num(props, 'duty', 0.5)), nodes, [0, 1]);
      return { elements: [v], view: () => ({}) };
    },
  },
  {
    type: 'current-source',
    name: 'Current source',
    group: 'Sources',
    terminals: [
      { x: 0, y: 0, name: 'out' },
      { x: 0, y: 3, name: 'in' },
    ],
    box: [-1, 0, 1, 3],
    props: [{ key: 'i', label: 'Current', kind: 'number', default: 0.01, unit: 'A' }],
    keywords: 'constant current',
    create(props, nodes) {
      const s = at(new CurrentSource(num(props, 'i', 0.01)), nodes, [1, 0]);
      return { elements: [s], view: () => ({}) };
    },
  },
  {
    type: 'rail',
    name: 'Supply rail',
    group: 'Sources',
    terminals: [{ x: 0, y: 0, name: 'rail' }],
    box: [-1, -1.6, 1, 0],
    props: [{ key: 'v', label: 'Voltage', kind: 'number', default: 5, unit: 'V' }],
    keywords: 'vcc vdd power rail supply',
    create(props, nodes) {
      const v = new VoltageSource('dc', num(props, 'v', 5));
      v.nodes = [nodes[0] as number, 0];
      return { elements: [v], view: () => ({}) };
    },
  },
  {
    type: 'ground',
    name: 'Ground',
    group: 'Sources',
    terminals: [{ x: 0, y: 0, name: 'ground' }],
    box: [-1, 0, 1, 1.2],
    props: [],
    ground: true,
    keywords: 'earth 0v common',
    create() {
      return { elements: [], view: () => ({}) };
    },
  },
  /* ------------------------------------------------------ semiconductors -- */
  {
    type: 'diode',
    name: 'Diode',
    group: 'Semiconductors',
    terminals: [
      { x: 0, y: 0, name: 'anode' },
      { x: 3, y: 0, name: 'cathode' },
    ],
    box: [0, -0.7, 3, 0.7],
    props: [
      {
        key: 'model',
        label: 'Type',
        kind: 'choice',
        default: 'silicon',
        choices: [
          ['silicon', 'Silicon (1N4148)'],
          ['schottky', 'Schottky'],
          ['germanium', 'Germanium'],
        ],
      },
    ],
    keywords: 'rectifier 1n4148 1n4007',
    create(props, nodes) {
      const d = at(new Diode(DIODES[str(props, 'model', 'silicon')] ?? (DIODES.silicon as DiodeModel)), nodes, [0, 1]);
      return { elements: [d], view: () => ({ current: d.current() }) };
    },
  },
  {
    type: 'zener',
    name: 'Zener diode',
    group: 'Semiconductors',
    terminals: [
      { x: 0, y: 0, name: 'anode' },
      { x: 3, y: 0, name: 'cathode' },
    ],
    box: [0, -0.7, 3, 0.7],
    props: [{ key: 'vz', label: 'Zener voltage', kind: 'number', default: 5.1, unit: 'V', min: 0.5 }],
    keywords: 'zener regulator reference',
    create(props, nodes) {
      const si = DIODES.silicon as DiodeModel;
      const d = at(new Diode({ is: si.is, n: si.n, zener: num(props, 'vz', 5.1) }), nodes, [0, 1]);
      return { elements: [d], view: () => ({ current: d.current() }) };
    },
  },
  {
    type: 'led',
    name: 'LED',
    group: 'Semiconductors',
    terminals: [
      { x: 0, y: 0, name: 'anode' },
      { x: 3, y: 0, name: 'cathode' },
    ],
    box: [0, -1.4, 3, 0.8],
    props: [{ key: 'colour', label: 'Colour', kind: 'choice', default: 'red', choices: LED_CHOICES }],
    keywords: 'light emitting diode lamp indicator',
    create(props, nodes) {
      const d = at(new Diode(ledModel(str(props, 'colour', 'red'))), nodes, [0, 1]);
      return { elements: [d], view: () => ({ current: d.average }) };
    },
  },
  {
    type: 'npn',
    name: 'NPN transistor',
    group: 'Semiconductors',
    terminals: [
      { x: 0, y: 0, name: 'base' },
      { x: 2, y: -2, name: 'collector' },
      { x: 2, y: 2, name: 'emitter' },
    ],
    box: [0, -2, 2.6, 2],
    props: [{ key: 'beta', label: 'Gain (β)', kind: 'number', default: 100, min: 1 }],
    keywords: 'bjt bipolar 2n2222 bc547',
    create(props, nodes) {
      const q = at(new Bjt(false, { is: 1e-14, betaF: num(props, 'beta', 100), betaR: 1 }), nodes, [1, 0, 2]);
      return { elements: [q], view: () => ({ ic: q.collector, ib: q.base }) };
    },
  },
  {
    type: 'pnp',
    name: 'PNP transistor',
    group: 'Semiconductors',
    terminals: [
      { x: 0, y: 0, name: 'base' },
      { x: 2, y: -2, name: 'collector' },
      { x: 2, y: 2, name: 'emitter' },
    ],
    box: [0, -2, 2.6, 2],
    props: [{ key: 'beta', label: 'Gain (β)', kind: 'number', default: 100, min: 1 }],
    keywords: 'bjt bipolar 2n2907 bc557',
    create(props, nodes) {
      const q = at(new Bjt(true, { is: 1e-14, betaF: num(props, 'beta', 100), betaR: 1 }), nodes, [1, 0, 2]);
      return { elements: [q], view: () => ({ ic: q.collector, ib: q.base }) };
    },
  },
  {
    type: 'nmos',
    name: 'N-channel MOSFET',
    group: 'Semiconductors',
    terminals: [
      { x: 0, y: 0, name: 'gate' },
      { x: 2, y: -2, name: 'drain' },
      { x: 2, y: 2, name: 'source' },
    ],
    box: [0, -2, 2.6, 2],
    props: [
      { key: 'vth', label: 'Threshold', kind: 'number', default: 1.5, unit: 'V' },
      { key: 'k', label: 'K (A/V²)', kind: 'number', default: 0.5, min: 1e-6 },
    ],
    keywords: 'mosfet fet 2n7000 irf540',
    create(props, nodes) {
      const m = at(new Mosfet(false, num(props, 'vth', 1.5), num(props, 'k', 0.5)), nodes, [1, 0, 2]);
      return { elements: [m], view: () => ({ id: m.drain }) };
    },
  },
  {
    type: 'pmos',
    name: 'P-channel MOSFET',
    group: 'Semiconductors',
    terminals: [
      { x: 0, y: 0, name: 'gate' },
      { x: 2, y: -2, name: 'drain' },
      { x: 2, y: 2, name: 'source' },
    ],
    box: [0, -2, 2.6, 2],
    props: [
      { key: 'vth', label: 'Threshold', kind: 'number', default: 1.5, unit: 'V' },
      { key: 'k', label: 'K (A/V²)', kind: 'number', default: 0.5, min: 1e-6 },
    ],
    keywords: 'mosfet fet irf9540',
    create(props, nodes) {
      const m = at(new Mosfet(true, num(props, 'vth', 1.5), num(props, 'k', 0.5)), nodes, [1, 0, 2]);
      return { elements: [m], view: () => ({ id: m.drain }) };
    },
  },
  {
    type: 'opamp',
    name: 'Op-amp',
    group: 'Semiconductors',
    terminals: [
      { x: 0, y: -1, name: '−' },
      { x: 0, y: 1, name: '+' },
      { x: 4, y: 0, name: 'out' },
    ],
    box: [0, -2, 4, 2],
    props: [
      { key: 'vpos', label: 'Positive supply', kind: 'number', default: 15, unit: 'V' },
      { key: 'vneg', label: 'Negative supply', kind: 'number', default: -15, unit: 'V' },
      { key: 'headroom', label: 'Output headroom', kind: 'number', default: 1.5, unit: 'V', min: 0 },
    ],
    keywords: 'operational amplifier comparator lm358 tl072 741',
    create(props, nodes) {
      const o = at(new OpAmp(num(props, 'vpos', 15), num(props, 'vneg', -15), num(props, 'headroom', 1.5)), nodes, [1, 0, 2]);
      return { elements: [o], view: () => ({}) };
    },
  },
  {
    type: 'timer555',
    name: '555 timer',
    group: 'Semiconductors',
    terminals: [
      { x: 3, y: -1, name: 'VCC' },
      { x: 3, y: 7, name: 'GND' },
      { x: 0, y: 1, name: 'TRIG' },
      { x: 0, y: 3, name: 'THR' },
      { x: 0, y: 5, name: 'DIS' },
      { x: 6, y: 1, name: 'OUT' },
      { x: 6, y: 3, name: 'CTRL' },
      { x: 6, y: 5, name: 'RESET' },
    ],
    box: [0, -1, 6, 7],
    props: [],
    keywords: 'ne555 timer astable monostable oscillator',
    create(_props, nodes) {
      const t = at(new Timer555(), nodes, [1, 2, 5, 7, 6, 3, 4, 0]);
      return { elements: [t], view: () => ({ out: t.high }) };
    },
  },
  /* -------------------------------------------------------------- logic -- */
  gate('and', 'AND gate'),
  gate('or', 'OR gate'),
  gate('not', 'NOT gate'),
  gate('nand', 'NAND gate'),
  gate('nor', 'NOR gate'),
  gate('xor', 'XOR gate'),
  gate('xnor', 'XNOR gate'),
  gate('buffer', 'Buffer'),
  flipFlop('d', 'D flip-flop', [
    { x: 0, y: 1, name: 'D' },
    { x: 0, y: 3, name: 'CLK' },
  ]),
  flipFlop('jk', 'JK flip-flop', [
    { x: 0, y: 1, name: 'J' },
    { x: 0, y: 2, name: 'CLK' },
    { x: 0, y: 3, name: 'K' },
  ]),
  flipFlop('t', 'T flip-flop', [
    { x: 0, y: 1, name: 'T' },
    { x: 0, y: 3, name: 'CLK' },
  ]),
  flipFlop('sr', 'SR latch', [
    { x: 0, y: 1, name: 'S' },
    { x: 0, y: 3, name: 'R' },
  ]),
  {
    type: 'counter',
    name: '4-bit counter',
    group: 'Logic',
    terminals: [
      { x: 0, y: 1, name: 'CLK' },
      { x: 0, y: 3, name: 'RST' },
      { x: 5, y: 1, name: 'Q0' },
      { x: 5, y: 2, name: 'Q1' },
      { x: 5, y: 3, name: 'Q2' },
      { x: 5, y: 4, name: 'Q3' },
    ],
    box: [0, 0, 5, 5],
    props: [{ key: 'modulo', label: 'Count up to (exclusive)', kind: 'number', default: 10, min: 2, max: 16 }, SUPPLY],
    keywords: 'binary counter decade 74hc163 4017',
    create(props, nodes) {
      const c = at(new Counter(num(props, 'modulo', 10), num(props, 'supply', 5)), nodes, [0, 1, 2, 3, 4, 5]);
      return { elements: [c], view: () => ({ count: c.count }) };
    },
  },
  {
    type: 'decoder',
    name: 'BCD to 7-segment decoder',
    group: 'Logic',
    terminals: [...['A', 'B', 'C', 'D'].map((name, i) => ({ x: 0, y: 1 + i, name })), ...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name, i) => ({ x: 5, y: 1 + i, name }))],
    box: [0, 0, 5, 8],
    props: [{ key: 'hex', label: 'Show A–F above 9', kind: 'boolean', default: false }, SUPPLY],
    keywords: '4511 7447 decoder seven segment bcd',
    create(props, nodes) {
      const d = at(
        new SegmentDecoder(bool(props, 'hex', false), num(props, 'supply', 5)),
        nodes,
        Array.from({ length: 11 }, (_, i) => i),
      );
      return { elements: [d], view: () => ({ pattern: d.pattern }) };
    },
  },
  {
    type: 'logic-input',
    name: 'Logic input',
    group: 'Logic',
    terminals: [{ x: 3, y: 0, name: 'out' }],
    box: [0, -1, 3, 1],
    props: [{ key: 'high', label: 'High', kind: 'boolean', default: false }, SUPPLY],
    interactive: 'toggle',
    keywords: 'logic switch input high low',
    create(props, nodes) {
      const l = at(new LogicInput(bool(props, 'high', false), num(props, 'supply', 5)), nodes, [0]);
      return {
        elements: [l],
        view: () => ({ high: l.high }),
        interact: (action) => {
          if (action === 'toggle') l.high = !l.high;
        },
      };
    },
  },
  {
    type: 'logic-probe',
    name: 'Logic output',
    group: 'Logic',
    terminals: [{ x: 0, y: 0, name: 'in' }],
    box: [0, -1, 3, 1],
    props: [SUPPLY],
    keywords: 'logic probe indicator output',
    create(props, nodes) {
      const p = at(new LogicProbe(num(props, 'supply', 5)), nodes, [0]);
      return { elements: [p], view: () => ({ high: p.high }) };
    },
  },
  {
    type: 'clock',
    name: 'Clock',
    group: 'Logic',
    terminals: [{ x: 3, y: 0, name: 'out' }],
    box: [0, -1, 3, 1],
    props: [{ key: 'f', label: 'Frequency', kind: 'number', default: 1, unit: 'Hz', min: 1e-3 }, SUPPLY],
    keywords: 'clock oscillator pulse square',
    create(props, nodes) {
      const c = at(new Clock(num(props, 'f', 1), num(props, 'supply', 5)), nodes, [0]);
      return { elements: [c], view: () => ({ high: c.high }) };
    },
  },
  /* ------------------------------------------------------------- outputs -- */
  {
    type: 'seven-segment',
    name: '7-segment display',
    group: 'Outputs',
    terminals: [...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name, i) => ({ x: 0, y: 1 + i, name })), { x: 0, y: 8, name: 'COM' }],
    box: [0, 0, 5, 9],
    props: [
      { key: 'anode', label: 'Common anode', kind: 'boolean', default: false },
      { key: 'colour', label: 'Colour', kind: 'choice', default: 'red', choices: LED_CHOICES },
    ],
    keywords: 'seven segment display digit led',
    create(props, nodes) {
      const s = at(new SevenSegment(bool(props, 'anode', false), str(props, 'colour', 'red')), nodes, [0, 1, 2, 3, 4, 5, 6, 7]);
      return { elements: [s], view: () => ({ segments: s.segments.map((d) => d.average) }) };
    },
  },
  {
    type: 'lamp',
    name: 'Lamp',
    group: 'Outputs',
    terminals: TWO,
    box: [0, -1, 3, 1],
    props: [
      { key: 'v', label: 'Rated voltage', kind: 'number', default: 12, unit: 'V', min: 0.1 },
      { key: 'w', label: 'Rated power', kind: 'number', default: 1, unit: 'W', min: 0.001 },
    ],
    keywords: 'bulb light incandescent',
    create(props, nodes) {
      const l = at(new Lamp(num(props, 'v', 12), num(props, 'w', 1)), nodes, [0, 1]);
      return { elements: [l], view: () => ({ glow: l.glow }) };
    },
  },
  {
    type: 'motor',
    name: 'DC motor',
    group: 'Outputs',
    terminals: TWO,
    box: [0, -1, 3, 1],
    props: [{ key: 'r', label: 'Winding resistance', kind: 'number', default: 10, unit: 'Ω', min: 0.1 }],
    keywords: 'motor fan spin',
    create(props, nodes) {
      const m = at(new Motor(num(props, 'r', 10)), nodes, [0, 1]);
      return { elements: [m], view: () => ({ speed: m.speed, angle: m.angle }) };
    },
  },
  {
    type: 'buzzer',
    name: 'Buzzer',
    group: 'Outputs',
    terminals: TWO,
    box: [0, -1, 3, 1],
    props: [{ key: 'r', label: 'Resistance', kind: 'number', default: 100, unit: 'Ω', min: 1 }],
    keywords: 'beeper piezo sounder alarm',
    create(props, nodes) {
      const b = at(new Buzzer(num(props, 'r', 100)), nodes, [0, 1]);
      return { elements: [b], view: () => ({ level: b.level }) };
    },
  },
  /* -------------------------------------------------------------- meters -- */
  {
    type: 'voltmeter',
    name: 'Voltmeter',
    group: 'Meters',
    terminals: [
      { x: 0, y: 0, name: '+' },
      { x: 3, y: 0, name: '−' },
    ],
    box: [0, -1, 3, 1],
    props: [],
    keywords: 'voltage meter multimeter',
    create(_props, nodes) {
      const m = at(new Voltmeter(), nodes, [0, 1]);
      return { elements: [m], view: () => ({ reading: m.reading }) };
    },
  },
  {
    type: 'ammeter',
    name: 'Ammeter',
    group: 'Meters',
    terminals: [
      { x: 0, y: 0, name: 'in' },
      { x: 3, y: 0, name: 'out' },
    ],
    box: [0, -1, 3, 1],
    props: [],
    keywords: 'current meter multimeter',
    create(_props, nodes) {
      const m = at(new Ammeter(), nodes, [0, 1]);
      return { elements: [m], view: () => ({ reading: m.reading }) };
    },
  },
  {
    type: 'probe',
    name: 'Scope probe',
    group: 'Meters',
    terminals: [{ x: 0, y: 0, name: 'probe' }],
    box: [0, -1.6, 1.6, 0],
    props: [
      {
        key: 'trace',
        label: 'Trace',
        kind: 'choice',
        default: '1',
        choices: [
          ['1', 'Trace 1 (blue)'],
          ['2', 'Trace 2 (orange)'],
          ['3', 'Trace 3 (green)'],
          ['4', 'Trace 4 (pink)'],
        ],
      },
    ],
    keywords: 'oscilloscope scope probe graph',
    create(_props, nodes) {
      const p = at(new Probe(), nodes, [0]);
      return { elements: [p], view: () => ({ reading: p.reading }) };
    },
  },
  /* -------------------------------------------------------------- boards -- */
  {
    type: 'arduino-uno',
    name: 'Arduino Uno',
    group: 'Boards',
    terminals: [
      { x: 0, y: 1, name: 'GND' },
      { x: 0, y: 2, name: '5V' },
      { x: 0, y: 3, name: '3.3V' },
      ...Array.from({ length: 14 }, (_, i) => ({ x: 10, y: 14 - i, name: `D${i}` })),
      ...Array.from({ length: 6 }, (_, i) => ({ x: 0, y: 5 + i, name: `A${i}` })),
    ],
    box: [0, 0, 10, 15],
    props: [],
    floatingFrom: 3,
    keywords: 'arduino uno atmega328p microcontroller avr',
    create(_props, nodes) {
      const b = at(
        new BoardElement(UNO, null),
        nodes,
        Array.from({ length: 23 }, (_, i) => i),
      );
      return { elements: [b], view: () => ({ volts: Array.from(b.volts) }) };
    },
  },
  {
    type: 'esp32',
    name: 'ESP32 DevKit',
    group: 'Boards',
    terminals: [
      { x: 0, y: 1, name: 'GND' },
      { x: 0, y: 2, name: '5V' },
      { x: 0, y: 3, name: '3V3' },
      ...ESP32.pins.map((p, i) => (i < 12 ? { x: 10, y: 1 + i, name: p.name } : { x: 0, y: 5 + (i - 12), name: p.name })),
    ],
    box: [0, 0, 10, 16],
    props: [],
    floatingFrom: 3,
    keywords: 'esp32 wifi microcontroller espressif devkit',
    create(_props, nodes) {
      const b = at(
        new BoardElement(ESP32, null),
        nodes,
        Array.from({ length: 3 + ESP32.pins.length }, (_, i) => i),
      );
      return { elements: [b], view: () => ({ volts: Array.from(b.volts) }) };
    },
  },
];

export const PART_BY_TYPE: ReadonlyMap<string, PartDef> = new Map(PARTS.map((p) => [p.type, p]));

export const GROUPS: readonly Group[] = ['Passive', 'Sources', 'Semiconductors', 'Logic', 'Outputs', 'Meters', 'Boards'];

export function defaultProps(def: PartDef): Record<string, PropValue> {
  return Object.fromEntries(def.props.map((p) => [p.key, p.default]));
}
