/**
 * From the drawing to the solver: parts and wires on a grid become nodes
 * (points joined by wires, touching terminals or lying on a wire are the
 * same node) and elements.  Also SPICE netlist export.
 */
import { type AnalysisSettings, readAnalysis } from './analysis-settings';
import type { Device } from './bus';
import type { Element } from './engine';
import { Circuit } from './engine';
import { parseTransfer } from './laplace';
import { partNames } from './names';
import { PART_BY_TYPE, type PartContext, type PartDef, type PropValue, type Runtime } from './parts';

export interface PlacedPart {
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  /** Quarter turns clockwise. */
  readonly rot: number;
  /** Mirrored left to right before turning. */
  readonly flip?: boolean;
  readonly props: Readonly<Record<string, PropValue>>;
  /** A reference name chosen for the part (otherwise one is numbered: R1, C2…). */
  readonly name?: string;
}

export interface WireSegment {
  readonly id: string;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface CircuitDoc {
  readonly version: 1;
  readonly title: string;
  readonly parts: readonly PlacedPart[];
  readonly wires: readonly WireSegment[];
  /** Solver time step, seconds. */
  readonly dt: number;
  /** Simulated seconds per real second. */
  readonly speed: number;
  /** Programs for boards, by part id. */
  readonly firmware?: Readonly<Record<string, FirmwareRef>>;
  /** Show part values beside the parts (default true). */
  readonly labels?: boolean;
  /** Show reference names (R1, C2…) beside the parts. */
  readonly names?: boolean;
  /** The analysis set up for this circuit. */
  readonly analysis?: AnalysisSettings;
}

/**
 * A board's program.  Uno programs are kept in the circuit file (examples by
 * name, others as Intel HEX); an ESP32 image loaded from a file is too large to
 * keep, so only its name is saved and it is loaded again after reopening.
 */
export type FirmwareRef =
  | { readonly kind: 'example'; readonly id: string }
  | { readonly kind: 'hex'; readonly name: string; readonly hex: string; readonly sketch?: string }
  | { readonly kind: 'esp32-demo' }
  | { readonly kind: 'esp32-image'; readonly name: string; readonly sketch?: string }
  /** Raspberry Pi Pico firmware from a file (UF2, ELF or binary), loaded again after reopening; `python` is a MicroPython program run once it starts. */
  | { readonly kind: 'pico-image'; readonly name: string; readonly sketch?: string; readonly python?: string };

/** (x, y) turned `rot` quarter turns clockwise (screen coordinates, y down). */
export function rotate(x: number, y: number, rot: number, flip = false): [number, number] {
  let px = flip ? -x : x;
  let py = y;
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) [px, py] = [-py, px];
  return [px, py];
}

export function terminalPoints(part: PlacedPart, def: PartDef = PART_BY_TYPE.get(part.type) as PartDef): [number, number][] {
  return def.terminals.map((t) => {
    const [dx, dy] = rotate(t.x, t.y, part.rot, part.flip);
    return [part.x + dx, part.y + dy];
  });
}

const key = (x: number, y: number) => `${x},${y}`;

/** Whether (px, py) lies on the segment, endpoints included. */
export function onSegment(w: WireSegment, px: number, py: number): boolean {
  const cross = (w.x2 - w.x1) * (py - w.y1) - (w.y2 - w.y1) * (px - w.x1);
  if (Math.abs(cross) > 1e-9) return false;
  return px >= Math.min(w.x1, w.x2) - 1e-9 && px <= Math.max(w.x1, w.x2) + 1e-9 && py >= Math.min(w.y1, w.y2) - 1e-9 && py <= Math.max(w.y1, w.y2) + 1e-9;
}

class Joins {
  private readonly parent = new Map<string, string>();
  find(a: string): string {
    let p = this.parent.get(a) ?? a;
    if (p === a) {
      this.parent.set(a, a);
      return a;
    }
    p = this.find(p);
    this.parent.set(a, p);
    return p;
  }
  join(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export interface Connectivity {
  /** Node number of every terminal and wire end ("x,y" → node). 0 is ground; −1 is a board pin left out. */
  readonly nodeAt: ReadonlyMap<string, number>;
  readonly nodeCount: number;
  /** Node of each part's terminals. */
  readonly partNodes: ReadonlyMap<string, number[]>;
  readonly wireNodes: ReadonlyMap<string, number>;
  /** Points where three or more connections meet (for junction dots). */
  readonly junctions: readonly [number, number][];
  readonly grounded: boolean;
}

export function connect(doc: Pick<CircuitDoc, 'parts' | 'wires'>): Connectivity {
  const joins = new Joins();
  const points: [number, number][] = [];
  const degree = new Map<string, number>();
  const bump = (x: number, y: number) => degree.set(key(x, y), (degree.get(key(x, y)) ?? 0) + 1);
  const terminals = new Map<string, [number, number][]>();
  for (const part of doc.parts) {
    const def = PART_BY_TYPE.get(part.type);
    if (!def) continue;
    const pts = terminalPoints(part, def);
    terminals.set(part.id, pts);
    for (const [x, y] of pts) {
      points.push([x, y]);
      joins.find(key(x, y));
      bump(x, y);
    }
    for (const [a, b] of def.internal ?? []) {
      const pa = pts[a];
      const pb = pts[b];
      if (pa && pb) joins.join(key(pa[0], pa[1]), key(pb[0], pb[1]));
    }
  }
  for (const w of doc.wires) {
    joins.join(key(w.x1, w.y1), key(w.x2, w.y2));
    points.push([w.x1, w.y1], [w.x2, w.y2]);
    bump(w.x1, w.y1);
    bump(w.x2, w.y2);
  }
  // A terminal or wire end on the middle of a wire joins it (a T junction).
  for (const w of doc.wires) {
    for (const [x, y] of points) {
      if ((x === w.x1 && y === w.y1) || (x === w.x2 && y === w.y2)) continue;
      if (onSegment(w, x, y)) {
        joins.join(key(x, y), key(w.x1, w.y1));
        bump(x, y);
        bump(x, y);
      }
    }
  }
  const groundRoots = new Set<string>();
  for (const part of doc.parts) {
    if (!PART_BY_TYPE.get(part.type)?.ground) continue;
    for (const [x, y] of terminals.get(part.id) ?? []) groundRoots.add(joins.find(key(x, y)));
  }
  // How many terminals and wire ends meet at each node: a board pin alone at its node is left out.
  const uses = new Map<string, number>();
  const use = (x: number, y: number) => {
    const root = joins.find(key(x, y));
    uses.set(root, (uses.get(root) ?? 0) + 1);
  };
  for (const pts of terminals.values()) for (const [x, y] of pts) use(x, y);
  for (const w of doc.wires) {
    use(w.x1, w.y1);
    use(w.x2, w.y2);
  }
  const unused = new Set<string>();
  for (const part of doc.parts) {
    const from = PART_BY_TYPE.get(part.type)?.floatingFrom;
    if (from === undefined) continue;
    (terminals.get(part.id) ?? []).forEach(([x, y], i) => {
      const root = joins.find(key(x, y));
      if (i >= from && uses.get(root) === 1 && !groundRoots.has(root)) unused.add(root);
    });
  }
  const numbers = new Map<string, number>();
  let next = 1;
  const nodeOf = (x: number, y: number) => {
    const root = joins.find(key(x, y));
    if (groundRoots.has(root)) return 0;
    if (unused.has(root)) return -1;
    let n = numbers.get(root);
    if (n === undefined) {
      n = next++;
      numbers.set(root, n);
    }
    return n;
  };
  const nodeAt = new Map<string, number>();
  for (const [x, y] of points) nodeAt.set(key(x, y), nodeOf(x, y));
  const partNodes = new Map<string, number[]>();
  for (const [id, pts] of terminals)
    partNodes.set(
      id,
      pts.map(([x, y]) => nodeOf(x, y)),
    );
  const wireNodes = new Map<string, number>();
  for (const w of doc.wires) wireNodes.set(w.id, nodeOf(w.x1, w.y1));
  const junctions: [number, number][] = [];
  for (const [k, d] of degree) {
    if (d >= 3) {
      const [x, y] = k.split(',').map(Number) as [number, number];
      junctions.push([x, y]);
    }
  }
  return { nodeAt, nodeCount: next - 1, partNodes, wireNodes, junctions, grounded: groundRoots.size > 0 };
}

export interface Built {
  readonly circuit: Circuit;
  readonly runtimes: ReadonlyMap<string, Runtime>;
  readonly connectivity: Connectivity;
  readonly problems: readonly string[];
}

/** Devices that outlive a rebuild of the circuit, by part id. */
export type DeviceStore = Map<string, { readonly type: string; readonly shape: string; readonly device: Device }>;

/**
 * Builds the solver's circuit from the drawing.  Pass the devices of the
 * previous build to keep them (a display keeps its picture while the
 * circuit is edited); devices of parts that are gone are dropped.
 */
export function build(doc: CircuitDoc, devices: DeviceStore = new Map()): Built {
  const connectivity = connect(doc);
  const runtimes = new Map<string, Runtime>();
  const elements: Element[] = [];
  const problems: string[] = [];
  for (const part of doc.parts) {
    const def = PART_BY_TYPE.get(part.type);
    if (!def) continue;
    const context: PartContext = {
      keep<T extends Device>(make: () => T, shape = ''): T {
        const old = devices.get(part.id);
        if (old && old.type === part.type && old.shape === shape) {
          old.device.configure(part.props);
          return old.device as T;
        }
        old?.device.unlink();
        const device = make();
        devices.set(part.id, { type: part.type, shape, device });
        return device;
      },
    };
    const runtime = def.create(part.props, connectivity.partNodes.get(part.id) ?? [], context);
    runtimes.set(part.id, runtime);
    elements.push(...runtime.elements);
    if (runtime.problem) problems.push(runtime.problem);
  }
  for (const [id, kept] of devices) {
    if (runtimes.get(id)?.device !== kept.device) {
      kept.device.unlink();
      devices.delete(id);
    }
  }
  // Logic parts, rails and boards are referenced to ground themselves; batteries and generators need one.
  const floating = doc.parts.some((p) => p.type === 'battery' || p.type === 'ac-source' || p.type === 'current-source');
  if (!connectivity.grounded && floating) problems.push('There is no ground symbol, so voltages are measured from an arbitrary point. Add a ground to the negative side of the supply.');
  const circuit = new Circuit(connectivity.nodeCount, elements, doc.dt);
  return { circuit, runtimes, connectivity, problems };
}

/* ------------------------------------------------------------------- SPICE -- */

export const spiceNumber = (v: number) => {
  const a = Math.abs(v);
  const scales: [number, string][] = [
    [1e9, 'G'],
    [1e6, 'MEG'],
    [1e3, 'K'],
    [1, ''],
    [1e-3, 'M'],
    [1e-6, 'U'],
    [1e-9, 'N'],
    [1e-12, 'P'],
  ];
  const [s, suffix] = scales.find(([s]) => a >= s) ?? [1e-12, 'P'];
  return `${Number((v / s).toPrecision(6))}${suffix}`;
};

/** A SPICE name for a part: its reference name, with the element letter SPICE needs in front when it lacks it. */
function spiceName(name: string, letter: string): string {
  const clean = name.replace(/[^A-Za-z0-9_]/g, '_');
  return clean.toUpperCase().startsWith(letter) ? clean : `${letter}${clean}`;
}

/** A SPICE netlist for the analog parts (other parts are listed as comments), with the circuit's analysis. */
export function toSpice(doc: CircuitDoc): string {
  const c = connect(doc);
  const names = partNames(doc);
  const lines = [`* ${doc.title || 'Benchtop circuit'}`, '* Exported from Benchtop; node 0 is ground.'];
  const models = new Set<string>();
  const analysis = doc.analysis;
  const acSource = analysis?.kind === 'ac' ? analysis.ac?.source : undefined;
  for (const part of doc.parts) {
    const n = c.partNodes.get(part.id) ?? [];
    const p = part.props;
    const v = (k: string, d: number) => (typeof p[k] === 'number' ? (p[k] as number) : d);
    const ref = names.get(part.id) ?? part.id;
    const name = (letter: string) => spiceName(ref, letter);
    const ac = part.id === acSource ? ' AC 1' : '';
    switch (part.type) {
      case 'resistor':
        lines.push(`${name('R')} ${n[0]} ${n[1]} ${spiceNumber(v('r', 1000))}`);
        break;
      case 'capacitor':
        lines.push(`${name('C')} ${n[0]} ${n[1]} ${spiceNumber(v('c', 1e-6))}`);
        break;
      case 'inductor':
        lines.push(`${name('L')} ${n[0]} ${n[1]} ${spiceNumber(v('l', 1e-3))}`);
        break;
      case 'potentiometer': {
        const r = v('r', 10_000);
        const pos = Math.min(1, Math.max(0, v('position', 0.5)));
        lines.push(`${name('R')}A ${n[0]} ${n[1]} ${spiceNumber(Math.max(pos * r, 0.01))}`, `${name('R')}B ${n[1]} ${n[2]} ${spiceNumber(Math.max((1 - pos) * r, 0.01))}`);
        break;
      }
      case 'battery':
        lines.push(`${name('V')} ${n[0]} ${n[1]} DC ${v('v', 9)}${ac}`);
        break;
      case 'rail':
        lines.push(`${name('V')} ${n[0]} 0 DC ${v('v', 5)}${ac}`);
        break;
      case 'ac-source': {
        const shape = typeof p.shape === 'string' ? p.shape : 'sine';
        const amp = v('amplitude', 5);
        const f = v('f', 50);
        const off = v('offset', 0);
        if (shape === 'sine') lines.push(`${name('V')} ${n[0]} ${n[1]} DC ${off} SIN(${off} ${amp} ${f})${ac}`);
        else if (shape === 'pulse' || shape === 'square') {
          const period = f > 0 ? 1 / f : 1;
          const low = shape === 'pulse' ? off : off - amp;
          const duty = shape === 'pulse' ? v('duty', 0.5) : 0.5;
          lines.push(`${name('V')} ${n[0]} ${n[1]} DC ${off} PULSE(${off + amp} ${low} 0 1n 1n ${spiceNumber(period * (1 - duty))} ${spiceNumber(period)})${ac}`);
        } else lines.push(`${name('V')} ${n[0]} ${n[1]} DC ${off} SIN(${off} ${amp} ${f})${ac} ; ${shape} wave approximated by a sine`);
        break;
      }
      case 'current-source':
        lines.push(`${name('I')} ${n[1]} ${n[0]} DC ${v('i', 0.01)}${ac}`);
        break;
      case 'diode':
      case 'led':
      case 'zener':
        models.add(part.type === 'led' ? '.model LED D(IS=1e-18 N=2)' : part.type === 'zener' ? `.model DZ D(BV=${v('vz', 5.1)} IBV=1m)` : '.model DSI D(IS=2.52n N=1.752)');
        lines.push(`${name('D')} ${n[0]} ${n[1]} ${part.type === 'led' ? 'LED' : part.type === 'zener' ? 'DZ' : 'DSI'}`);
        break;
      case 'npn':
      case 'pnp':
        models.add(part.type === 'npn' ? '.model QN NPN(IS=1e-14 BF=100)' : '.model QP PNP(IS=1e-14 BF=100)');
        lines.push(`${name('Q')} ${n[1]} ${n[0]} ${n[2]} ${part.type === 'npn' ? 'QN' : 'QP'}`);
        break;
      case 'nmos':
      case 'pmos':
        models.add(part.type === 'nmos' ? '.model MN NMOS(VTO=1.5 KP=0.5)' : '.model MP PMOS(VTO=-1.5 KP=0.5)');
        lines.push(`${name('M')} ${n[1]} ${n[0]} ${n[2]} ${n[2]} ${part.type === 'nmos' ? 'MN' : 'MP'}`);
        break;
      case 'njfet':
      case 'pjfet': {
        const model = `J${ref.replace(/[^A-Za-z0-9_]/g, '_')}M`;
        models.add(`.model ${model} ${part.type === 'njfet' ? 'NJF' : 'PJF'}(VTO=-${v('vp', 2)} BETA=${v('beta', 1.3e-3)} LAMBDA=${v('lambda', 0.0023)})`);
        lines.push(`${name('J')} ${n[1]} ${n[0]} ${n[2]} ${model}`);
        break;
      }
      case 'opamp':
        lines.push(`* ${ref}: op-amp (gain ${v('gain', 1e5)}, rails ${v('vneg', -15)} V to ${v('vpos', 15)} V) as a voltage-controlled source without limits`);
        lines.push(`${name('E')} ${n[2]} 0 ${n[1]} ${n[0]} ${v('gain', 1e5)}`);
        break;
      case 'vcvs':
        lines.push(`${name('E')} ${n[0]} ${n[1]} ${n[2]} ${n[3]} ${v('gain', 10)}`);
        break;
      case 'vccs':
        // SPICE's G pushes current into its first node; here it flows out of out+.
        lines.push(`${name('G')} ${n[1]} ${n[0]} ${n[2]} ${n[3]} ${v('gm', 0.001)}`);
        break;
      case 'ccvs':
        lines.push(`V${name('H')}_SENSE ${n[2]} ${n[3]} DC 0`, `${name('H')} ${n[0]} ${n[1]} V${name('H')}_SENSE ${v('r', 1000)}`);
        break;
      case 'cccs':
        lines.push(`V${name('F')}_SENSE ${n[2]} ${n[3]} DC 0`, `${name('F')} ${n[1]} ${n[0]} V${name('F')}_SENSE ${v('gain', 10)}`);
        break;
      case 'transformer': {
        const lp = v('lp', 10);
        const ratio = Math.max(v('ratio', 10), 1e-6);
        const base = name('L');
        const rp = v('rp', 0);
        const rs = v('rs', 0);
        const p1 = rp > 0 ? `${base}_P` : String(n[0]);
        const s1 = rs > 0 ? `${base}_S` : String(n[2]);
        if (rp > 0) lines.push(`R${base}_P ${n[0]} ${p1} ${spiceNumber(rp)}`);
        if (rs > 0) lines.push(`R${base}_S ${n[2]} ${s1} ${spiceNumber(rs)}`);
        lines.push(`${base}P ${p1} ${n[1]} ${spiceNumber(lp)}`, `${base}S ${s1} ${n[3]} ${spiceNumber(lp / (ratio * ratio))}`, `K${base} ${base}P ${base}S ${Math.min(v('k', 0.999), 1)}`);
        break;
      }
      case 'comparator': {
        const hi = v('high', 5);
        const lo = v('low', 0);
        lines.push(`* ${ref}: comparator as a behavioural source (no output resistance or hysteresis)`, `${name('B')} ${n[2]} 0 V=${lo}+${hi - lo}*u(V(${n[1]})-V(${n[0]}))`);
        break;
      }
      case 'regulator':
        lines.push(
          `* ${ref}: regulator as a behavioural source (output current drawn from ground, not IN)`,
          `${name('B')} ${n[2]} ${n[1]} V=min(${v('v', 5)}, max(0, V(${n[0]},${n[1]})-${v('dropout', 2)}))`,
        );
        break;
      case 'laplace': {
        try {
          const h = parseTransfer(typeof p.h === 'string' ? p.h : '1');
          const desc = (q: readonly number[]) =>
            [...q]
              .reverse()
              .map((x) => Number(x.toPrecision(9)))
              .join(' ');
          const model = `${spiceName(ref, 'A')}_TF`;
          lines.push(`* ${ref}: H(s) = ${p.h} (ngspice XSPICE s_xfer)`, `${name('A')} ${n[0]} ${n[1]} ${model}`);
          models.add(`.model ${model} s_xfer(num_coeff=[${desc(h.num)}] den_coeff=[${desc(h.den)}])`);
        } catch {
          lines.push(`* ${ref}: transfer function “${p.h}” does not parse`);
        }
        break;
      }
      case 'switch':
        lines.push(`${name('R')} ${n[0]} ${n[1]} ${p.closed ? '0.01' : '1G'} ; switch, ${p.closed ? 'closed' : 'open'}`);
        break;
      case 'ground':
      case 'probe':
        break;
      default:
        lines.push(`* ${ref}: ${PART_BY_TYPE.get(part.type)?.name ?? part.type} on nodes ${n.join(' ')} has no SPICE equivalent here`);
    }
  }
  lines.push(...models);
  const byId = (id: string | undefined) => doc.parts.find((x) => x.id === id);
  switch (analysis?.kind) {
    case 'op':
      lines.push('.op');
      break;
    case 'dc': {
      const sweep = analysis.dc;
      const part = byId(sweep?.part);
      const ref = part ? (names.get(part.id) ?? '') : '';
      const letter = part?.type === 'current-source' ? 'I' : part?.type === 'resistor' ? 'R' : 'V';
      const sweepable = part && ['battery', 'rail', 'current-source', 'resistor'].includes(part.type);
      if (sweep && sweepable) lines.push(`.dc ${spiceName(ref, letter)} ${sweep.from} ${sweep.to} ${spiceNumber((sweep.to - sweep.from) / Math.max(1, sweep.points - 1))}`);
      else lines.push(`* DC sweep of ${ref || 'a part'} ${sweep?.prop ?? ''}: SPICE sweeps sources and resistors only`);
      break;
    }
    case 'ac':
      if (analysis.ac) lines.push(`.ac dec ${analysis.ac.perDecade} ${spiceNumber(analysis.ac.from)} ${spiceNumber(analysis.ac.to)}`);
      break;
    case 'tran':
      if (analysis.tran) lines.push(`.tran ${spiceNumber(analysis.tran.step || doc.dt)} ${spiceNumber(analysis.tran.stop)}${analysis.tran.fromZero ? ' uic' : ''}`);
      break;
    default:
      lines.push(`.tran ${spiceNumber(doc.dt)} ${spiceNumber(doc.dt * 10_000)}`);
  }
  if (analysis?.stepping) {
    const part = byId(analysis.stepping.part);
    lines.push(`* Stepped: ${part ? names.get(part.id) : '?'} ${analysis.stepping.prop} = ${analysis.stepping.values.join(', ')}`);
  }
  lines.push('.end', '');
  return lines.join('\n');
}

/* ------------------------------------------------------------------- files -- */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function readFirmware(v: unknown): FirmwareRef | null {
  if (!isRecord(v)) return null;
  switch (v.kind) {
    case 'example':
      return typeof v.id === 'string' ? { kind: 'example', id: v.id } : null;
    case 'hex':
      return typeof v.name === 'string' && typeof v.hex === 'string' ? { kind: 'hex', name: v.name, hex: v.hex, ...(typeof v.sketch === 'string' ? { sketch: v.sketch } : {}) } : null;
    case 'esp32-demo':
      return { kind: 'esp32-demo' };
    case 'esp32-image':
      return typeof v.name === 'string' ? { kind: 'esp32-image', name: v.name, ...(typeof v.sketch === 'string' ? { sketch: v.sketch } : {}) } : null;
    case 'pico-image':
      return typeof v.name === 'string'
        ? { kind: 'pico-image', name: v.name, ...(typeof v.sketch === 'string' ? { sketch: v.sketch } : {}), ...(typeof v.python === 'string' ? { python: v.python.slice(0, 100_000) } : {}) }
        : null;
    default:
      return null;
  }
}

/**
 * Reads a saved circuit, keeping what it can: parts of unknown types and
 * malformed wires are dropped (and counted) rather than refusing the file.
 */
export function parseDoc(value: unknown): { doc: CircuitDoc; dropped: number } | null {
  if (!isRecord(value) || !Array.isArray(value.parts) || !Array.isArray(value.wires)) return null;
  let dropped = 0;
  const ids = new Set<string>();
  const parts: PlacedPart[] = [];
  for (const p of value.parts) {
    const def = isRecord(p) && typeof p.type === 'string' ? PART_BY_TYPE.get(p.type) : undefined;
    if (!isRecord(p) || !def || !finite(p.x) || !finite(p.y)) {
      dropped++;
      continue;
    }
    let id = typeof p.id === 'string' && p.id ? p.id : `p${parts.length + 1}`;
    while (ids.has(id)) id = `${id}x`;
    ids.add(id);
    const props: Record<string, PropValue> = {};
    for (const d of def.props) {
      const v = isRecord(p.props) ? p.props[d.key] : undefined;
      props[d.key] =
        d.kind === 'number'
          ? finite(v)
            ? v
            : d.default
          : d.kind === 'boolean'
            ? typeof v === 'boolean'
              ? v
              : d.default
            : typeof v === 'string' && (d.choices?.some(([c]) => c === v) ?? true)
              ? v.slice(0, 500)
              : d.default;
    }
    const name = typeof p.name === 'string' ? p.name.trim().slice(0, 40) : '';
    parts.push({
      id,
      type: def.type,
      x: Math.round(p.x),
      y: Math.round(p.y),
      rot: finite(p.rot) ? ((Math.round(p.rot) % 4) + 4) % 4 : 0,
      ...(p.flip === true ? { flip: true } : {}),
      props,
      ...(name ? { name } : {}),
    });
  }
  const wires: WireSegment[] = [];
  for (const w of value.wires) {
    if (!isRecord(w) || !finite(w.x1) || !finite(w.y1) || !finite(w.x2) || !finite(w.y2) || (w.x1 === w.x2 && w.y1 === w.y2)) {
      dropped++;
      continue;
    }
    let id = typeof w.id === 'string' && w.id ? w.id : `w${wires.length + 1}`;
    while (ids.has(id)) id = `${id}x`;
    ids.add(id);
    wires.push({ id, x1: Math.round(w.x1), y1: Math.round(w.y1), x2: Math.round(w.x2), y2: Math.round(w.y2) });
  }
  const firmware: Record<string, FirmwareRef> = {};
  if (isRecord(value.firmware)) {
    for (const [id, ref] of Object.entries(value.firmware)) {
      const f = readFirmware(ref);
      if (f && ids.has(id)) firmware[id] = f;
    }
  }
  const dt = finite(value.dt) && value.dt >= 1e-7 && value.dt <= 0.1 ? value.dt : 1e-4;
  const analysis = readAnalysis(value.analysis);
  const speed = finite(value.speed) && value.speed > 0 && value.speed <= 1000 ? value.speed : 1;
  return {
    doc: {
      version: 1,
      title: typeof value.title === 'string' ? value.title.slice(0, 200) : '',
      parts,
      wires,
      dt,
      speed,
      ...(Object.keys(firmware).length ? { firmware } : {}),
      ...(value.labels === false ? { labels: false } : {}),
      ...(value.names === true ? { names: true } : {}),
      ...(analysis ? { analysis } : {}),
    },
    dropped,
  };
}
