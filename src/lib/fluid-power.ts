/**
 * Pneumatic and hydraulic circuits drawn with ISO 1219 symbols, and a
 * simulation of what they do: which lines are under pressure, which way each
 * valve is switched, and how the cylinders move.
 *
 * Pressure is solved as connectivity: a line joined to a source is at supply
 * pressure, one joined to an exhaust or tank is vented, and one joined to
 * neither keeps what it held (trapped).  Check, shuttle and two-pressure
 * valves pass pressure one way, and one-way flow controls slow a cylinder
 * when its air or oil must leave through the throttle.
 */

export type Medium = 'pneumatic' | 'hydraulic';
export type Kind = 'source' | 'exhaust' | 'valve' | 'cylinder' | 'flow' | 'check' | 'shuttle' | 'twopressure' | 'gauge';
export type ValveType = '3/2-nc' | '3/2-no' | '5/2' | '4/2' | '4/3-closed' | '4/3-tandem' | '4/3-open';
export type Actuator = 'button' | 'lever' | 'solenoid' | 'pilot' | 'roller' | 'spring' | 'detent';
export type Side = 'left' | 'right';

export interface Component {
  readonly id: string;
  readonly kind: Kind;
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly valve?: ValveType;
  readonly left?: Actuator;
  readonly right?: Actuator;
  /** For roller actuators: which cylinder end operates it, such as "A1" (cylinder A out) or "A0" (in). */
  readonly leftRoller?: string;
  readonly rightRoller?: string;
  readonly cylinder?: 'single' | 'double';
  /** Seconds for a full stroke with no throttling. */
  readonly stroke?: number;
  /** Load against extension, as a share of the full piston force. */
  readonly load?: number;
  /** Opening of a flow control, 0.05 to 1. */
  readonly setting?: number;
}

export interface PortRef {
  readonly c: string;
  readonly p: string;
}

export interface Wire {
  readonly id: string;
  readonly a: PortRef;
  readonly b: PortRef;
}

export interface Circuit {
  readonly medium: Medium;
  readonly components: readonly Component[];
  readonly wires: readonly Wire[];
}

/* ------------------------------------------------------------ geometry -- */

export const BOX = 44;
export const ACT = 26;

export interface ValveDef {
  readonly boxes: number;
  /** Box the ports are drawn on (the normal position). */
  readonly home: number;
  /** Ports: name, side and position across the box (0 to 1). */
  readonly ports: readonly (readonly [string, 'top' | 'bottom', number])[];
  /** For each box: flow paths [from, to] and blocked ports. */
  readonly positions: readonly { readonly paths: readonly (readonly [string, string])[]; readonly blocked: readonly string[] }[];
}

const FOUR_PORTS = [
  ['A', 'top', 0.3],
  ['B', 'top', 0.7],
  ['P', 'bottom', 0.3],
  ['T', 'bottom', 0.7],
] as const;
const SIDE_A = { paths: [['P', 'A'] as const, ['B', 'T'] as const], blocked: [] };
const SIDE_B = { paths: [['P', 'B'] as const, ['A', 'T'] as const], blocked: [] };

export const VALVES: Readonly<Record<ValveType, ValveDef>> = {
  '3/2-nc': {
    boxes: 2,
    home: 1,
    ports: [
      ['2', 'top', 0.5],
      ['1', 'bottom', 0.3],
      ['3', 'bottom', 0.7],
    ],
    positions: [
      { paths: [['1', '2']], blocked: ['3'] },
      { paths: [['2', '3']], blocked: ['1'] },
    ],
  },
  '3/2-no': {
    boxes: 2,
    home: 1,
    ports: [
      ['2', 'top', 0.5],
      ['1', 'bottom', 0.3],
      ['3', 'bottom', 0.7],
    ],
    positions: [
      { paths: [['2', '3']], blocked: ['1'] },
      { paths: [['1', '2']], blocked: ['3'] },
    ],
  },
  '5/2': {
    boxes: 2,
    home: 1,
    ports: [
      ['4', 'top', 0.3],
      ['2', 'top', 0.7],
      ['5', 'bottom', 0.18],
      ['1', 'bottom', 0.5],
      ['3', 'bottom', 0.82],
    ],
    positions: [
      {
        paths: [
          ['1', '4'],
          ['2', '3'],
        ],
        blocked: ['5'],
      },
      {
        paths: [
          ['1', '2'],
          ['4', '5'],
        ],
        blocked: ['3'],
      },
    ],
  },
  '4/2': { boxes: 2, home: 1, ports: FOUR_PORTS, positions: [SIDE_A, SIDE_B] },
  '4/3-closed': { boxes: 3, home: 1, ports: FOUR_PORTS, positions: [SIDE_A, { paths: [], blocked: ['A', 'B', 'P', 'T'] }, SIDE_B] },
  '4/3-tandem': { boxes: 3, home: 1, ports: FOUR_PORTS, positions: [SIDE_A, { paths: [['P', 'T']], blocked: ['A', 'B'] }, SIDE_B] },
  '4/3-open': {
    boxes: 3,
    home: 1,
    ports: FOUR_PORTS,
    positions: [
      SIDE_A,
      {
        paths: [
          ['P', 'T'],
          ['A', 'T'],
          ['B', 'T'],
        ],
        blocked: [],
      },
      SIDE_B,
    ],
  },
};

export const VALVE_NAMES: Readonly<Record<ValveType, string>> = {
  '3/2-nc': '3/2 normally closed',
  '3/2-no': '3/2 normally open',
  '5/2': '5/2',
  '4/2': '4/2',
  '4/3-closed': '4/3 closed centre',
  '4/3-tandem': '4/3 tandem centre',
  '4/3-open': '4/3 open centre',
};

export const CYLINDER_W = 130;
export const CYLINDER_H = 36;

/** Width and height of a component's symbol. */
export function extent(c: Component): { w: number; h: number } {
  switch (c.kind) {
    case 'valve':
      return { w: VALVES[c.valve ?? '3/2-nc'].boxes * BOX + 2 * ACT, h: BOX };
    case 'cylinder':
      return { w: CYLINDER_W + 110, h: CYLINDER_H };
    case 'source':
      return { w: 40, h: 40 };
    case 'exhaust':
      return { w: 24, h: 24 };
    case 'gauge':
      return { w: 30, h: 36 };
    case 'flow':
      return { w: 56, h: 40 };
    case 'check':
      return { w: 44, h: 28 };
    default:
      return { w: 48, h: 30 };
  }
}

/** Ports of a component in drawing coordinates. */
export function ports(c: Component): { name: string; x: number; y: number; side: 'top' | 'bottom' | 'left' | 'right' }[] {
  const out: { name: string; x: number; y: number; side: 'top' | 'bottom' | 'left' | 'right' }[] = [];
  const at = (name: string, dx: number, dy: number, side: 'top' | 'bottom' | 'left' | 'right') => out.push({ name, x: c.x + dx, y: c.y + dy, side });
  switch (c.kind) {
    case 'source':
      at('out', 20, 0, 'top');
      break;
    case 'exhaust':
      at('in', 12, 0, 'top');
      break;
    case 'gauge':
      at('p', 15, 36, 'bottom');
      break;
    case 'check':
      at('in', 0, 14, 'left');
      at('out', 44, 14, 'right');
      break;
    case 'flow':
      at('in', 0, 20, 'left');
      at('out', 56, 20, 'right');
      break;
    case 'shuttle':
    case 'twopressure':
      at('x', 0, 20, 'left');
      at('y', 48, 20, 'right');
      at('a', 24, 0, 'top');
      break;
    case 'cylinder':
      at('A', 14, CYLINDER_H, 'bottom');
      if (c.cylinder !== 'single') at('B', CYLINDER_W - 14, CYLINDER_H, 'bottom');
      break;
    case 'valve': {
      const def = VALVES[c.valve ?? '3/2-nc'];
      for (const [name, side, f] of def.ports) at(name, ACT + def.home * BOX + f * BOX, side === 'top' ? 0 : BOX, side);
      const { w } = extent(c);
      if (c.left === 'pilot') at('pl', 0, BOX / 2, 'left');
      if (c.right === 'pilot') at('pr', w, BOX / 2, 'right');
      break;
    }
  }
  return out;
}

/* ---------------------------------------------------------- simulation -- */

export interface SimState {
  /** Box index each valve is in. */
  readonly positions: Readonly<Record<string, number>>;
  /** Lever and solenoid switches that are on: "valveId:left". */
  readonly latched: readonly string[];
  /** Cylinder positions, 0 (in) to 1 (out). */
  readonly cylinders: Readonly<Record<string, number>>;
  /** Pressure of each port, 0 to 1 of supply: "componentId:port". */
  readonly pressure: Readonly<Record<string, number>>;
  readonly time: number;
}

export function initialState(circuit: Circuit): SimState {
  const positions: Record<string, number> = {};
  const cylinders: Record<string, number> = {};
  for (const c of circuit.components) {
    if (c.kind === 'valve') positions[c.id] = VALVES[c.valve ?? '3/2-nc'].home;
    if (c.kind === 'cylinder') cylinders[c.id] = 0;
  }
  return { positions, latched: [], cylinders, pressure: {}, time: 0 };
}

const key = (r: PortRef) => `${r.c}:${r.p}`;

/** Whether a valve's actuator on one side is operating it. */
function operating(c: Component, side: Side, state: SimState, pressed: ReadonlySet<string>, cylinders: Readonly<Record<string, Component>>): boolean {
  const kind = side === 'left' ? c.left : c.right;
  const id = `${c.id}:${side}`;
  switch (kind) {
    case 'button':
      return pressed.has(id);
    case 'lever':
    case 'solenoid':
      return state.latched.includes(id);
    case 'pilot':
      return (state.pressure[`${c.id}:${side === 'left' ? 'pl' : 'pr'}`] ?? 0) > 0.5;
    case 'roller': {
      const ref = (side === 'left' ? c.leftRoller : c.rightRoller) ?? '';
      const m = /^(.+?)([01])$/.exec(ref.trim());
      const cyl = m ? cylinders[(m[1] ?? '').toUpperCase()] : undefined;
      if (!m || !cyl) return false;
      const x = state.cylinders[cyl.id] ?? 0;
      return m[2] === '1' ? x >= 0.97 : x <= 0.03;
    }
    default:
      return false;
  }
}

interface Nets {
  readonly root: (k: string) => string;
  readonly pressure: Map<string, number>;
  readonly source: Set<string>;
  readonly vented: Set<string>;
  readonly capacity: Map<string, number>;
}

function solveNets(circuit: Circuit, positions: Readonly<Record<string, number>>, previous: Readonly<Record<string, number>>, flowOpen = false): Nets {
  // Which way does air or oil go through each flow control?  Look at its two sides with it taken out.
  const direction = new Map<string, number>();
  if (!flowOpen) {
    const apart = solveNets(circuit, positions, previous, true);
    for (const c of circuit.components) {
      if (c.kind !== 'flow') continue;
      const rin = apart.root(`${c.id}:in`);
      const rout = apart.root(`${c.id}:out`);
      const inSrc = apart.source.has(rin);
      const outSrc = apart.source.has(rout);
      const inVent = apart.vented.has(rin);
      const outVent = apart.vented.has(rout);
      // Free flow runs from in to out (through the check valve); out to in goes through the throttle.
      const throttled = (outSrc && !inSrc) || (inVent && !outVent && !outSrc);
      direction.set(c.id, throttled ? (c.setting ?? 0.5) : 1);
    }
  }
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r) ?? r;
    let x = k;
    while (x !== r) {
      const next = parent.get(x) ?? r;
      parent.set(x, r);
      x = next;
    }
    if (!parent.has(r)) parent.set(r, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const c of circuit.components) for (const p of ports(c)) find(`${c.id}:${p.name}`);
  for (const w of circuit.wires) union(key(w.a), key(w.b));
  const before = (k: string) => previous[k] ?? 0;
  const capacities: [string, number][] = [];
  for (const c of circuit.components) {
    const id = (p: string) => `${c.id}:${p}`;
    if (c.kind === 'valve') {
      const def = VALVES[c.valve ?? '3/2-nc'];
      const position = def.positions[positions[c.id] ?? def.home];
      for (const [a, b] of position?.paths ?? []) union(id(a), id(b));
    } else if (c.kind === 'flow') {
      if (!flowOpen) {
        union(id('in'), id('out'));
        capacities.push([id('in'), direction.get(c.id) ?? 1]);
      }
    } else if (c.kind === 'check') {
      if (before(id('in')) > before(id('out')) + 0.01) union(id('in'), id('out'));
    } else if (c.kind === 'shuttle') {
      union(id('a'), before(id('x')) >= before(id('y')) ? id('x') : id('y'));
    } else if (c.kind === 'twopressure') {
      union(id('a'), before(id('x')) <= before(id('y')) ? id('x') : id('y'));
    }
  }
  const source = new Set<string>();
  const vented = new Set<string>();
  const wired = new Set(circuit.wires.flatMap((w) => [key(w.a), key(w.b)]));
  for (const c of circuit.components) {
    if (c.kind === 'source') source.add(find(`${c.id}:out`));
    if (c.kind === 'exhaust') vented.add(find(`${c.id}:in`));
    // A valve's exhaust or tank port with nothing on it breathes to the open air.
    if (c.kind === 'valve') for (const p of ['3', '5', 'T']) if (ports(c).some((q) => q.name === p) && !wired.has(`${c.id}:${p}`)) vented.add(find(`${c.id}:${p}`));
  }
  const pressure = new Map<string, number>();
  const members = new Map<string, string[]>();
  for (const k of parent.keys()) {
    const r = find(k);
    const list = members.get(r);
    if (list) list.push(k);
    else members.set(r, [k]);
  }
  for (const [r, list] of members) {
    if (source.has(r)) pressure.set(r, 1);
    else if (vented.has(r)) pressure.set(r, 0);
    else pressure.set(r, Math.max(0, ...list.map(before)));
  }
  const capacity = new Map<string, number>();
  for (const [k, f] of capacities) {
    const r = find(k);
    capacity.set(r, Math.min(capacity.get(r) ?? 1, f));
  }
  return { root: find, pressure, source, vented, capacity };
}

/** Advances the circuit by dt seconds; `pressed` holds the push buttons held down ("valveId:left"). */
export function step(circuit: Circuit, state: SimState, dt: number, pressed: ReadonlySet<string> = new Set()): SimState {
  const byLabel: Record<string, Component> = {};
  for (const c of circuit.components) if (c.kind === 'cylinder') byLabel[c.label.toUpperCase()] = c;
  // Valves switch according to their actuators.
  const positions: Record<string, number> = { ...state.positions };
  for (const c of circuit.components) {
    if (c.kind !== 'valve') continue;
    const def = VALVES[c.valve ?? '3/2-nc'];
    const left = operating(c, 'left', state, pressed, byLabel);
    const right = operating(c, 'right', state, pressed, byLabel);
    const current = positions[c.id] ?? def.home;
    if (left && !right) positions[c.id] = 0;
    else if (right && !left) positions[c.id] = def.boxes - 1;
    else if (!left && !right) {
      // Two-position valves return on a spring; three-position valves are spring-centred.
      const springs = def.boxes === 3 || c.right === 'spring' || c.left === 'spring';
      positions[c.id] = springs ? def.home : current;
    }
  }
  // Settle the pressures: check and shuttle valves need a few passes.
  let pressure: Record<string, number> = { ...state.pressure };
  let nets = solveNets(circuit, positions, pressure);
  for (let pass = 0; pass < 6; pass++) {
    const next: Record<string, number> = {};
    for (const c of circuit.components) for (const p of ports(c)) next[`${c.id}:${p.name}`] = nets.pressure.get(nets.root(`${c.id}:${p.name}`)) ?? 0;
    const same = Object.keys(next).every((k) => Math.abs((next[k] ?? 0) - (pressure[k] ?? 0)) < 1e-9);
    pressure = next;
    if (same && pass > 0) break;
    nets = solveNets(circuit, positions, pressure);
  }
  // Cylinders move when the forces push them and the air or oil on the other side can get out.
  const cylinders: Record<string, number> = { ...state.cylinders };
  for (const c of circuit.components) {
    if (c.kind !== 'cylinder') continue;
    const single = c.cylinder === 'single';
    const a = `${c.id}:A`;
    const b = `${c.id}:B`;
    const ra = nets.root(a);
    const rb = single ? '' : nets.root(b);
    const pa = pressure[a] ?? 0;
    const pb = single ? 0 : (pressure[b] ?? 0);
    const trapped = (r: string) => r !== '' && !nets.source.has(r) && !nets.vented.has(r);
    const force = pa - 0.7 * pb - (c.load ?? 0) - (single ? 0.3 : 0);
    const capacity = Math.min(nets.capacity.get(ra) ?? 1, single ? 1 : (nets.capacity.get(rb) ?? 1));
    const speed = (capacity / Math.max(0.1, c.stroke ?? 1.5)) * dt;
    let x = cylinders[c.id] ?? 0;
    if (force > 0.02 && !trapped(rb)) x = Math.min(1, x + speed);
    else if (force < -0.02 && !trapped(ra)) x = Math.max(0, x - speed);
    cylinders[c.id] = x;
  }
  return { positions, latched: state.latched, cylinders, pressure, time: state.time + dt };
}

/** Flips a lever or solenoid (or releases the other side of a two-sided one). */
export function toggle(state: SimState, id: string): SimState {
  return { ...state, latched: state.latched.includes(id) ? state.latched.filter((x) => x !== id) : [...state.latched, id] };
}

/* ----------------------------------------------------------- examples -- */

let counter = 0;
const nid = (p: string) => `${p}${++counter}`;

function circuit(medium: Medium, parts: Component[], links: [string, string, string, string][]): Circuit {
  return { medium, components: parts, wires: links.map(([c1, p1, c2, p2]) => ({ id: nid('w'), a: { c: c1, p: p1 }, b: { c: c2, p: p2 } })) };
}

export const EXAMPLES: Readonly<Record<string, () => Circuit>> = {
  'Single-acting cylinder, push button': () =>
    circuit(
      'pneumatic',
      [
        { id: 'cyl', kind: 'cylinder', x: 120, y: 40, label: 'A', cylinder: 'single', stroke: 1 },
        { id: 'v1', kind: 'valve', x: 110, y: 160, label: 'V1', valve: '3/2-nc', left: 'button', right: 'spring' },
        { id: 'src', kind: 'source', x: 140, y: 270, label: 'Supply' },
        { id: 'ex', kind: 'exhaust', x: 198, y: 250, label: '' },
      ],
      [
        ['cyl', 'A', 'v1', '2'],
        ['v1', '1', 'src', 'out'],
        ['v1', '3', 'ex', 'in'],
      ],
    ),
  'Double-acting cylinder, speed control': () =>
    circuit(
      'pneumatic',
      [
        { id: 'cyl', kind: 'cylinder', x: 120, y: 30, label: 'A', cylinder: 'double', stroke: 1 },
        { id: 'f1', kind: 'flow', x: 70, y: 110, label: 'Out', setting: 0.35 },
        { id: 'f2', kind: 'flow', x: 260, y: 110, label: 'In', setting: 0.35 },
        { id: 'v1', kind: 'valve', x: 120, y: 190, label: 'V1', valve: '5/2', left: 'lever', right: 'spring' },
        { id: 'src', kind: 'source', x: 172, y: 300, label: 'Supply' },
        { id: 'e1', kind: 'exhaust', x: 140, y: 280, label: '' },
        { id: 'e2', kind: 'exhaust', x: 226, y: 280, label: '' },
      ],
      [
        ['cyl', 'A', 'f1', 'out'],
        ['f1', 'in', 'v1', '4'],
        ['cyl', 'B', 'f2', 'out'],
        ['f2', 'in', 'v1', '2'],
        ['v1', '1', 'src', 'out'],
        ['v1', '5', 'e1', 'in'],
        ['v1', '3', 'e2', 'in'],
      ],
    ),
  'Indirect control (memory valve)': () =>
    circuit(
      'pneumatic',
      [
        { id: 'cyl', kind: 'cylinder', x: 150, y: 20, label: 'A', cylinder: 'double', stroke: 1.2 },
        { id: 'v1', kind: 'valve', x: 150, y: 120, label: 'V1', valve: '5/2', left: 'pilot', right: 'pilot' },
        { id: 'b1', kind: 'valve', x: 20, y: 240, label: 'S1 out', valve: '3/2-nc', left: 'button', right: 'spring' },
        { id: 'b2', kind: 'valve', x: 300, y: 240, label: 'S2 in', valve: '3/2-nc', left: 'button', right: 'spring' },
        { id: 'src', kind: 'source', x: 200, y: 360, label: 'Supply' },
        { id: 'e1', kind: 'exhaust', x: 170, y: 210, label: '' },
        { id: 'e2', kind: 'exhaust', x: 258, y: 210, label: '' },
        { id: 'e3', kind: 'exhaust', x: 90, y: 330, label: '' },
        { id: 'e4', kind: 'exhaust', x: 370, y: 330, label: '' },
      ],
      [
        ['cyl', 'A', 'v1', '4'],
        ['cyl', 'B', 'v1', '2'],
        ['v1', '1', 'src', 'out'],
        ['v1', '5', 'e1', 'in'],
        ['v1', '3', 'e2', 'in'],
        ['b1', '2', 'v1', 'pl'],
        ['b2', '2', 'v1', 'pr'],
        ['b1', '1', 'src', 'out'],
        ['b2', '1', 'src', 'out'],
        ['b1', '3', 'e3', 'in'],
        ['b2', '3', 'e4', 'in'],
      ],
    ),
  'Two-hand safety (AND)': () =>
    circuit(
      'pneumatic',
      [
        { id: 'cyl', kind: 'cylinder', x: 150, y: 20, label: 'A', cylinder: 'single', stroke: 1 },
        { id: 'and', kind: 'twopressure', x: 166, y: 130, label: 'AND' },
        { id: 'b1', kind: 'valve', x: 20, y: 220, label: 'Left hand', valve: '3/2-nc', left: 'button', right: 'spring' },
        { id: 'b2', kind: 'valve', x: 280, y: 220, label: 'Right hand', valve: '3/2-nc', left: 'button', right: 'spring' },
        { id: 'src', kind: 'source', x: 190, y: 340, label: 'Supply' },
        { id: 'e1', kind: 'exhaust', x: 90, y: 310, label: '' },
        { id: 'e2', kind: 'exhaust', x: 350, y: 310, label: '' },
      ],
      [
        ['cyl', 'A', 'and', 'a'],
        ['and', 'x', 'b1', '2'],
        ['and', 'y', 'b2', '2'],
        ['b1', '1', 'src', 'out'],
        ['b2', '1', 'src', 'out'],
        ['b1', '3', 'e1', 'in'],
        ['b2', '3', 'e2', 'in'],
      ],
    ),
  'Automatic back and forth (rollers)': () =>
    circuit(
      'pneumatic',
      [
        { id: 'cyl', kind: 'cylinder', x: 150, y: 20, label: 'A', cylinder: 'double', stroke: 1 },
        { id: 'v1', kind: 'valve', x: 150, y: 120, label: 'V1', valve: '5/2', left: 'pilot', right: 'pilot' },
        { id: 'r1', kind: 'valve', x: 20, y: 240, label: 'a0', valve: '3/2-nc', left: 'roller', leftRoller: 'A0', right: 'spring' },
        { id: 'r2', kind: 'valve', x: 300, y: 240, label: 'a1', valve: '3/2-nc', left: 'roller', leftRoller: 'A1', right: 'spring' },
        { id: 'src', kind: 'source', x: 200, y: 360, label: 'Supply' },
        { id: 'e1', kind: 'exhaust', x: 170, y: 210, label: '' },
        { id: 'e2', kind: 'exhaust', x: 258, y: 210, label: '' },
        { id: 'e3', kind: 'exhaust', x: 90, y: 330, label: '' },
        { id: 'e4', kind: 'exhaust', x: 370, y: 330, label: '' },
      ],
      [
        ['cyl', 'A', 'v1', '4'],
        ['cyl', 'B', 'v1', '2'],
        ['v1', '1', 'src', 'out'],
        ['v1', '5', 'e1', 'in'],
        ['v1', '3', 'e2', 'in'],
        ['r1', '2', 'v1', 'pl'],
        ['r2', '2', 'v1', 'pr'],
        ['r1', '1', 'src', 'out'],
        ['r2', '1', 'src', 'out'],
        ['r1', '3', 'e3', 'in'],
        ['r2', '3', 'e4', 'in'],
      ],
    ),
  'Hydraulic press (4/3 tandem centre)': () =>
    circuit(
      'hydraulic',
      [
        { id: 'cyl', kind: 'cylinder', x: 130, y: 20, label: 'A', cylinder: 'double', stroke: 2, load: 0.2 },
        { id: 'v1', kind: 'valve', x: 120, y: 130, label: 'V1', valve: '4/3-tandem', left: 'solenoid', right: 'solenoid' },
        { id: 'src', kind: 'source', x: 140, y: 250, label: 'Pump' },
        { id: 'tank', kind: 'exhaust', x: 230, y: 240, label: 'Tank' },
        { id: 'g', kind: 'gauge', x: 70, y: 200, label: 'P' },
      ],
      [
        ['cyl', 'A', 'v1', 'A'],
        ['cyl', 'B', 'v1', 'B'],
        ['v1', 'P', 'src', 'out'],
        ['v1', 'T', 'tank', 'in'],
        ['g', 'p', 'src', 'out'],
      ],
    ),
};
