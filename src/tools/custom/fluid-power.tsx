/**
 * Pneumatic and hydraulic circuit simulator with ISO 1219 symbols: build a
 * circuit from sources, exhausts, directional valves (3/2, 5/2, 4/2, 4/3)
 * with push-button, lever, solenoid, pilot and roller operation, cylinders,
 * flow controls, check, shuttle and two-pressure valves and gauges; wire the
 * ports and run it to watch the lines fill and the cylinders move.
 */
import type { JSX } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import {
  ACT,
  type Actuator,
  BOX,
  type Circuit,
  type Component,
  CYLINDER_H,
  CYLINDER_W,
  EXAMPLES,
  extent,
  initialState,
  type Kind,
  type Medium,
  type PortRef,
  ports,
  type Side,
  type SimState,
  step,
  toggle,
  VALVE_NAMES,
  VALVES,
  type ValveType,
} from '../../lib/fluid-power';
import { defineCustomTool, type Values } from '../types';
import { useClock } from './_lab';
import { Segmented, usePersistentState } from './_shared';

interface FState {
  readonly circuit: Circuit;
}

const START = 'Indirect control (memory valve)';
const fresh = (name: string): Circuit => (EXAMPLES[name] ?? EXAMPLES[START] ?? (() => ({ medium: 'pneumatic', components: [], wires: [] })))();

const read = (v: Values | undefined): FState => {
  const c = v?.circuit as Circuit | undefined;
  if (c && Array.isArray(c.components) && Array.isArray(c.wires) && (c.medium === 'pneumatic' || c.medium === 'hydraulic')) return { circuit: c };
  return { circuit: fresh(START) };
};
const write = (s: FState): Values => JSON.parse(JSON.stringify(s)) as Values;

const ACTUATORS: readonly [Actuator, string][] = [
  ['button', 'Push button'],
  ['lever', 'Lever'],
  ['solenoid', 'Solenoid'],
  ['pilot', 'Air or oil pilot'],
  ['roller', 'Roller (cylinder end)'],
  ['spring', 'Spring'],
  ['detent', 'Detent (stays put)'],
];

const PALETTE: readonly { label: string; make: () => Omit<Component, 'id' | 'x' | 'y'> }[] = [
  { label: 'Supply', make: () => ({ kind: 'source', label: 'Supply' }) },
  { label: 'Exhaust or tank', make: () => ({ kind: 'exhaust', label: '' }) },
  { label: '3/2 valve', make: () => ({ kind: 'valve', label: 'V', valve: '3/2-nc', left: 'button', right: 'spring' }) },
  { label: '5/2 valve', make: () => ({ kind: 'valve', label: 'V', valve: '5/2', left: 'lever', right: 'spring' }) },
  { label: '4/3 valve', make: () => ({ kind: 'valve', label: 'V', valve: '4/3-closed', left: 'solenoid', right: 'solenoid' }) },
  { label: 'Single-acting cylinder', make: () => ({ kind: 'cylinder', label: 'B', cylinder: 'single', stroke: 1 }) },
  { label: 'Double-acting cylinder', make: () => ({ kind: 'cylinder', label: 'B', cylinder: 'double', stroke: 1 }) },
  { label: 'Flow control', make: () => ({ kind: 'flow', label: '', setting: 0.4 }) },
  { label: 'Check valve', make: () => ({ kind: 'check', label: '' }) },
  { label: 'Shuttle (OR)', make: () => ({ kind: 'shuttle', label: 'OR' }) },
  { label: 'Two-pressure (AND)', make: () => ({ kind: 'twopressure', label: 'AND' }) },
  { label: 'Gauge', make: () => ({ kind: 'gauge', label: '' }) },
];

const KIND_NAMES: Readonly<Record<Kind, string>> = {
  source: 'Supply',
  exhaust: 'Exhaust or tank',
  valve: 'Valve',
  cylinder: 'Cylinder',
  flow: 'One-way flow control',
  check: 'Check valve',
  shuttle: 'Shuttle valve (OR)',
  twopressure: 'Two-pressure valve (AND)',
  gauge: 'Pressure gauge',
};

/* ----------------------------------------------------------- symbols -- */

function arrowHead(x: number, y: number, dx: number, dy: number): string {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return `M${x} ${y}L${x - ux * 7 - uy * 3.5} ${y - uy * 7 + ux * 3.5}L${x - ux * 7 + uy * 3.5} ${y - uy * 7 - ux * 3.5}Z`;
}

function ValveBoxes({ c, position }: { c: Component; position: number }) {
  const def = VALVES[c.valve ?? '3/2-nc'];
  const offset = (def.home - position) * BOX;
  const out: JSX.Element[] = [];
  def.positions.forEach((pos, k) => {
    const x0 = ACT + k * BOX + offset;
    out.push(<rect key={`b${k}`} class={k === position ? 'fp-box is-active' : 'fp-box'} x={x0} y={0} width={BOX} height={BOX} />);
    const at = (name: string) => {
      const p = def.ports.find((q) => q[0] === name);
      return p ? { x: x0 + p[2] * BOX, y: p[1] === 'top' ? 4 : BOX - 4, top: p[1] === 'top' } : { x: x0, y: 0, top: true };
    };
    pos.paths.forEach(([from, to], i) => {
      const a = at(from);
      const b = at(to);
      let d: string;
      let head: string;
      if (a.top === b.top) {
        const mid = a.top ? BOX * 0.45 : BOX * 0.55;
        d = `M${a.x} ${a.y}L${a.x} ${mid}L${b.x} ${mid}L${b.x} ${b.y}`;
        head = arrowHead(b.x, b.y, 0, b.y - mid);
      } else {
        d = `M${a.x} ${a.y}L${b.x} ${b.y}`;
        head = arrowHead(b.x, b.y, b.x - a.x, b.y - a.y);
      }
      out.push(<path key={`p${k}-${i}`} class="fp-flow" d={d} />, <path key={`h${k}-${i}`} class="fp-head" d={head} />);
    });
    for (const name of pos.blocked) {
      const p = at(name);
      const y1 = p.top ? 4 : BOX - 4;
      const y2 = p.top ? 12 : BOX - 12;
      out.push(<path key={`t${k}-${name}`} class="fp-flow" d={`M${p.x} ${y1}L${p.x} ${y2}M${p.x - 5} ${y2}L${p.x + 5} ${y2}`} />);
    }
  });
  return <g>{out}</g>;
}

function ActuatorSymbol({ kind, side, width, label }: { kind: Actuator | undefined; side: Side; width: number; label?: string }) {
  if (!kind) return null;
  // Drawn for the left side, mirrored for the right.
  const g = (children: JSX.Element) => <g transform={side === 'right' ? `translate(${width} 0) scale(-1 1)` : undefined}>{children}</g>;
  const mid = BOX / 2;
  switch (kind) {
    case 'button':
      return g(<path class="fp-act" d={`M${ACT} ${mid}H10M10 ${mid - 9}V${mid + 9}M10 ${mid - 9}Q2 ${mid} 10 ${mid + 9}`} />);
    case 'lever':
      return g(
        <>
          <path class="fp-act" d={`M${ACT} ${mid}H12L4 ${mid - 12}`} />
          <circle class="fp-act" cx={4} cy={mid - 12} r={3} />
        </>,
      );
    case 'solenoid':
      return g(
        <>
          <rect class="fp-act" x={6} y={mid - 10} width={ACT - 8} height={20} />
          <path class="fp-act" d={`M6 ${mid + 10}L${ACT - 2} ${mid - 10}`} />
        </>,
      );
    case 'pilot':
      return g(
        <>
          <path class="fp-act fp-pilot" d={`M0 ${mid}H${ACT}`} />
          <path class="fp-head" d={arrowHead(ACT - 2, mid, 1, 0)} />
        </>,
      );
    case 'roller':
      return g(
        <>
          <path class="fp-act" d={`M${ACT} ${mid}H11`} />
          <circle class="fp-act" cx={7} cy={mid} r={5} />
          {label && (
            <text class="fp-small" x={8} y={mid - 10} text-anchor="middle" transform={side === 'right' ? `translate(16 0) scale(-1 1)` : undefined}>
              {label}
            </text>
          )}
        </>,
      );
    case 'spring':
      return g(<path class="fp-act" d={`M${ACT} ${mid}l-3 -8l-4 16l-4 -16l-4 16l-4 -16l-3 8`} />);
    case 'detent':
      return g(<path class="fp-act" d={`M${ACT} ${mid - 8}L${ACT - 10} ${mid - 8}l-4 6l4 6l-4 6`} />);
  }
}

/** A zig-zag spring from x0 to x1 just under the rod. */
function spring(x0: number, x1: number, y: number): string {
  const turns = 10;
  const step = (x1 - x0) / turns;
  let d = `M${x0} ${y}`;
  for (let i = 1; i <= turns; i++) d += `L${(x0 + step * i).toFixed(1)} ${i % 2 ? y - 6 : y}`;
  return d;
}

function PartSymbol({ c, state, medium }: { c: Component; state: SimState; medium: Medium }) {
  const { w } = extent(c);
  const hydraulic = medium === 'hydraulic';
  switch (c.kind) {
    case 'source':
      return (
        <g>
          <line class="fp-line" x1={20} y1={0} x2={20} y2={6} />
          <circle class="fp-shape" cx={20} cy={20} r={14} />
          <path class={hydraulic ? 'fp-head' : 'fp-shape'} d="M20 8L27 18H13Z" />
        </g>
      );
    case 'exhaust':
      return hydraulic ? <path class="fp-shape" d="M2 6V20H22V6M12 0V14" /> : <path class="fp-shape" d="M12 0V6M4 6H20L12 20Z" />;
    case 'gauge':
      return (
        <g>
          <line class="fp-line" x1={15} y1={26} x2={15} y2={36} />
          <circle class="fp-shape" cx={15} cy={14} r={12} />
          <path class="fp-head" d={arrowHead(22, 6, 1, -1)} />
          <line class="fp-line" x1={8} y1={21} x2={22} y2={7} />
          <text class="fp-small" x={34} y={18}>
            {(((state.pressure[`${c.id}:p`] ?? 0) * (hydraulic ? 100 : 6)) | 0).toString()} bar
          </text>
        </g>
      );
    case 'check':
      return (
        <g>
          <path class="fp-line" d="M0 14H14M30 14H44" />
          <circle class="fp-shape" cx={20} cy={14} r={6} />
          <path class="fp-shape" d="M30 4L24 14L30 24" />
        </g>
      );
    case 'flow':
      return (
        <g>
          <rect class="fp-envelope" x={4} y={0} width={48} height={40} />
          <path class="fp-line" d="M0 20H10V8H18M38 8H46V20H56M10 20V32H22M34 32H46V20" />
          <path class="fp-shape" d="M18 4Q28 10 38 4M18 12Q28 6 38 12" />
          <path class="fp-line" d="M20 18L36 -2" />
          <path class="fp-head" d={arrowHead(36, -2, 1, -1.25)} />
          <circle class="fp-shape" cx={26} cy={32} r={4} />
          <path class="fp-shape" d="M34 25L30 32L34 39" />
          <text class="fp-small" x={28} y={52} text-anchor="middle">
            {Math.round((c.setting ?? 0.5) * 100)} %
          </text>
        </g>
      );
    case 'shuttle':
    case 'twopressure':
      return (
        <g>
          <rect class="fp-shape" x={6} y={10} width={36} height={20} />
          <path class="fp-line" d="M0 20H6M42 20H48M24 0V10" />
          <circle class="fp-shape" cx={24} cy={20} r={6} />
          <text class="fp-small" x={24} y={42} text-anchor="middle">
            {c.kind === 'shuttle' ? 'OR' : 'AND'}
          </text>
        </g>
      );
    case 'cylinder': {
      const x = state.cylinders[c.id] ?? 0;
      const piston = 10 + x * (CYLINDER_W - 30);
      return (
        <g>
          <rect class="fp-shape" x={0} y={0} width={CYLINDER_W} height={CYLINDER_H} />
          <rect class="fp-piston" x={piston} y={2} width={8} height={CYLINDER_H - 4} />
          <rect class="fp-rod" x={piston + 8} y={CYLINDER_H / 2 - 4} width={CYLINDER_W - piston - 8 + x * 100} height={8} />
          {c.cylinder === 'single' && <path class="fp-line" d={spring(piston + 10, CYLINDER_W - 2, CYLINDER_H / 2 + 9)} />}
          <line class="fp-line" x1={14} y1={CYLINDER_H} x2={14} y2={CYLINDER_H - 2} />
          <text class="fp-label" x={-4} y={-6}>
            {c.label}
          </text>
          <text class="fp-small" x={CYLINDER_W + 4} y={-4}>
            {c.label.toLowerCase()}0
          </text>
          <text class="fp-small" x={CYLINDER_W + 96} y={-4}>
            {c.label.toLowerCase()}1
          </text>
        </g>
      );
    }
    case 'valve': {
      const position = state.positions[c.id] ?? VALVES[c.valve ?? '3/2-nc'].home;
      return (
        <g>
          <ValveBoxes c={c} position={position} />
          <ActuatorSymbol kind={c.left} side="left" width={w} label={c.leftRoller} />
          <ActuatorSymbol kind={c.right} side="right" width={w} label={c.rightRoller} />
        </g>
      );
    }
  }
}

/* -------------------------------------------------------------- tool -- */

function stub(p: { x: number; y: number; side: string }): { x: number; y: number } {
  if (p.side === 'top') return { x: p.x, y: p.y - 12 };
  if (p.side === 'bottom') return { x: p.x, y: p.y + 12 };
  if (p.side === 'left') return { x: p.x - 12, y: p.y };
  return { x: p.x + 12, y: p.y };
}

function wirePath(p1: { x: number; y: number; side: string }, p2: { x: number; y: number; side: string }): string {
  const a = stub(p1);
  const b = stub(p2);
  const v1 = p1.side === 'top' || p1.side === 'bottom';
  const v2 = p2.side === 'top' || p2.side === 'bottom';
  let mid: string;
  if (v1 && v2) mid = `L${a.x} ${(a.y + b.y) / 2}L${b.x} ${(a.y + b.y) / 2}`;
  else if (!v1 && !v2) mid = `L${(a.x + b.x) / 2} ${a.y}L${(a.x + b.x) / 2} ${b.y}`;
  else {
    // One end leaves sideways, the other up or down: turn once, on the side that does not
    // double back across the part the line leaves.
    const backwards = v1 ? (p1.side === 'top' ? b.y > a.y : b.y < a.y) : p1.side === 'left' ? b.x > a.x : b.x < a.x;
    const verticalFirst = v1 ? !backwards : backwards;
    mid = verticalFirst ? `L${a.x} ${b.y}` : `L${b.x} ${a.y}`;
  }
  return `M${p1.x} ${p1.y}L${a.x} ${a.y}${mid}L${b.x} ${b.y}L${p2.x} ${p2.y}`;
}

function FluidPower({ toolId }: { toolId: string }) {
  const [s, setState] = usePersistentState(toolId, read, write);
  const circuit = s.circuit;
  const setCircuit = (next: Circuit) => setState({ circuit: next });
  const [sim, setSim] = useState<SimState>(() => initialState(circuit));
  const [running, setRunning] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<PortRef | null>(null);
  const pressed = useRef(new Set<string>());
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const latest = useRef(sim);
  latest.current = sim;

  useClock(running, (dt) => {
    const next = step(circuit, latest.current, dt, pressed.current);
    latest.current = next;
    setSim(next);
  });

  const portMap = useMemo(() => {
    const map = new Map<string, { x: number; y: number; side: string }>();
    for (const c of circuit.components) for (const p of ports(c)) map.set(`${c.id}:${p.name}`, p);
    return map;
  }, [circuit]);

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const box = svg.current?.getBoundingClientRect();
    const view = svg.current?.viewBox.baseVal;
    const scale = box && view && box.width > 0 ? view.width / box.width : 1;
    return { x: (e.clientX - (box?.left ?? 0)) * scale + (view?.x ?? 0), y: (e.clientY - (box?.top ?? 0)) * scale + (view?.y ?? 0) };
  };

  const update = (id: string, patch: Partial<Component>) => setCircuit({ ...circuit, components: circuit.components.map((c) => (c.id === id ? ({ ...c, ...patch } as Component) : c)) });
  const remove = (id: string) => {
    setCircuit({ ...circuit, components: circuit.components.filter((c) => c.id !== id), wires: circuit.wires.filter((w) => w.id !== id && w.a.c !== id && w.b.c !== id) });
    setSelected(null);
  };
  const load = (name: string) => {
    const next = fresh(name);
    setCircuit(next);
    const state = initialState(next);
    latest.current = state;
    setSim(state);
    setSelected(null);
    setPending(null);
  };
  const reset = () => {
    const state = initialState(circuit);
    latest.current = state;
    setSim(state);
  };
  const add = (make: () => Omit<Component, 'id' | 'x' | 'y'>) => {
    const base = make();
    const id = `${base.kind}${Date.now().toString(36)}`;
    let label = base.label;
    if (base.kind === 'cylinder') {
      const used = new Set(circuit.components.filter((c) => c.kind === 'cylinder').map((c) => c.label.toUpperCase()));
      label = 'ABCDEFGH'.split('').find((l) => !used.has(l)) ?? 'Z';
    }
    const component = { ...base, label, id, x: 20 + ((circuit.components.length * 37) % 300), y: 20 + ((circuit.components.length * 53) % 260) } as Component;
    setCircuit({ ...circuit, components: [...circuit.components, component] });
    if (component.kind === 'valve') setSim({ ...sim, positions: { ...sim.positions, [id]: VALVES[component.valve ?? '3/2-nc'].home } });
    setSelected(id);
  };

  const onPort = (ref: PortRef) => {
    if (!pending) {
      setPending(ref);
      return;
    }
    if (pending.c === ref.c && pending.p === ref.p) {
      setPending(null);
      return;
    }
    const exists = circuit.wires.some(
      (w) => (w.a.c === pending.c && w.a.p === pending.p && w.b.c === ref.c && w.b.p === ref.p) || (w.b.c === pending.c && w.b.p === pending.p && w.a.c === ref.c && w.a.p === ref.p),
    );
    if (!exists) setCircuit({ ...circuit, wires: [...circuit.wires, { id: `w${Date.now().toString(36)}`, a: pending, b: ref }] });
    setPending(null);
  };

  const operate = (c: Component, side: Side, down: boolean) => {
    const kind = side === 'left' ? c.left : c.right;
    const id = `${c.id}:${side}`;
    if (kind === 'button') {
      if (down) pressed.current.add(id);
      else pressed.current.delete(id);
    } else if ((kind === 'lever' || kind === 'solenoid') && down) {
      let next = toggle(latest.current, id);
      // Switching one side of a two-sided lever or solenoid valve releases the other.
      const other = `${c.id}:${side === 'left' ? 'right' : 'left'}`;
      if (next.latched.includes(id) && next.latched.includes(other)) next = toggle(next, other);
      latest.current = next;
      setSim(next);
    }
    if (!running) {
      const next = step(circuit, latest.current, 0.001, pressed.current);
      latest.current = next;
      setSim(next);
    }
  };

  const bounds = circuit.components.reduce(
    (b, c) => {
      const e = extent(c);
      return { x: Math.max(b.x, c.x + e.w + 120), y: Math.max(b.y, c.y + e.h + 60) };
    },
    { x: 480, y: 380 },
  );
  const sel = circuit.components.find((c) => c.id === selected);
  const selWire = circuit.wires.find((w) => w.id === selected);
  const live = (ref: PortRef) => (sim.pressure[`${ref.c}:${ref.p}`] ?? 0) > 0.5;

  return (
    <section class="tool lab-tool" data-testid="tool" data-state="done">
      <div class="button-row">
        <select class="input fp-examples" aria-label="Load an example" value="" onChange={(e) => e.currentTarget.value && load(e.currentTarget.value)} data-testid="fp-examples">
          <option value="">Examples…</option>
          {Object.keys(EXAMPLES).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <Segmented
          label="Medium"
          value={circuit.medium}
          choices={[
            { value: 'pneumatic', label: 'Pneumatic' },
            { value: 'hydraulic', label: 'Hydraulic' },
          ]}
          onChange={(medium) => setCircuit({ ...circuit, medium })}
        />
        <button type="button" class="button button-primary button-small" onClick={() => setRunning((r) => !r)} data-testid="fp-run">
          {running ? 'Stop' : 'Run'}
        </button>
        <button type="button" class="button button-small" onClick={reset}>
          Reset
        </button>
        <button
          type="button"
          class="button button-small"
          onClick={() => {
            setCircuit({ medium: circuit.medium, components: [], wires: [] });
            reset();
          }}
        >
          Clear
        </button>
      </div>
      <div class="fp-layout">
        <div class="lab-controls fp-palette">
          <h3>Add</h3>
          {PALETTE.map((p) => (
            <button key={p.label} type="button" class="button button-small" onClick={() => add(p.make)} data-testid={`fp-add-${p.label.split(' ')[0]?.toLowerCase()}`}>
              {p.label}
            </button>
          ))}
          <p class="lab-note">Drag parts to move them. Click a port, then another, to join them. Click a push button, lever or solenoid on a valve to operate it.</p>
        </div>
        <div class="fp-stage">
          <svg
            ref={svg}
            class={`lab-scene fp-scene fp-${circuit.medium}`}
            viewBox={`-20 -40 ${bounds.x + 40} ${bounds.y + 60}`}
            role="img"
            aria-label="Circuit"
            data-testid="fp-scene"
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              const p = toLocal(e);
              d.moved = true;
              update(d.id, { x: Math.round((p.x - d.dx) / 4) * 4, y: Math.round((p.y - d.dy) / 4) * 4 });
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerDown={(e) => {
              if (e.target === svg.current) {
                setSelected(null);
                setPending(null);
              }
            }}
          >
            {circuit.wires.map((w) => {
              const p1 = portMap.get(`${w.a.c}:${w.a.p}`);
              const p2 = portMap.get(`${w.b.c}:${w.b.p}`);
              if (!p1 || !p2) return null;
              const pilot = w.a.p === 'pl' || w.a.p === 'pr' || w.b.p === 'pl' || w.b.p === 'pr';
              return (
                <g key={w.id} onPointerDown={() => setSelected(w.id)}>
                  <path class="fp-hit" d={wirePath(p1, p2)} />
                  <path
                    class={`fp-wire${live(w.a) ? ' is-live' : ''}${pilot ? ' is-pilot' : ''}${selected === w.id ? ' is-selected' : ''}`}
                    d={wirePath(p1, p2)}
                    data-live={live(w.a) ? 'yes' : 'no'}
                  />
                </g>
              );
            })}
            {circuit.components.map((c) => {
              const e = extent(c);
              return (
                <g key={c.id} transform={`translate(${c.x} ${c.y})`} class={`fp-part${selected === c.id ? ' is-selected' : ''}`} data-testid={`fp-part-${c.id}`}>
                  <rect
                    class="fp-body"
                    x={-4}
                    y={-4}
                    width={e.w + 8}
                    height={e.h + 8}
                    onPointerDown={(ev) => {
                      ev.stopPropagation();
                      setSelected(c.id);
                      const p = toLocal(ev);
                      drag.current = { id: c.id, dx: p.x - c.x, dy: p.y - c.y, moved: false };
                      svg.current?.setPointerCapture(ev.pointerId);
                    }}
                  />
                  <PartSymbol c={c} state={sim} medium={circuit.medium} />
                  {c.kind !== 'cylinder' && c.label && (
                    <text class="fp-label" x={c.kind === 'valve' ? ACT : 0} y={-8}>
                      {c.label}
                    </text>
                  )}
                  {c.kind === 'valve' &&
                    (['left', 'right'] as const).map((side) => {
                      const kind = side === 'left' ? c.left : c.right;
                      if (kind !== 'button' && kind !== 'lever' && kind !== 'solenoid') return null;
                      const on = sim.latched.includes(`${c.id}:${side}`);
                      return (
                        <rect
                          key={side}
                          class={`fp-operate${on ? ' is-on' : ''}`}
                          x={side === 'left' ? -2 : e.w - ACT + 2}
                          y={0}
                          width={ACT}
                          height={BOX}
                          role="button"
                          tabIndex={0}
                          aria-label={`${c.label || 'Valve'}: ${kind === 'button' ? 'press' : 'switch'} ${side} ${kind}`}
                          data-testid={`fp-op-${c.id}-${side}`}
                          onPointerDown={(ev) => {
                            ev.stopPropagation();
                            operate(c, side, true);
                          }}
                          onPointerUp={() => operate(c, side, false)}
                          onPointerLeave={() => kind === 'button' && operate(c, side, false)}
                          onKeyDown={(ev) => {
                            if ((ev.key === 'Enter' || ev.key === ' ') && !ev.repeat) {
                              ev.preventDefault();
                              operate(c, side, true);
                            }
                          }}
                          onKeyUp={(ev) => (ev.key === 'Enter' || ev.key === ' ') && operate(c, side, false)}
                        />
                      );
                    })}
                </g>
              );
            })}
            {circuit.components.flatMap((c) =>
              ports(c).map((p) => {
                const ref = { c: c.id, p: p.name };
                const isPending = pending?.c === c.id && pending.p === p.name;
                return (
                  <circle
                    key={`${c.id}:${p.name}`}
                    class={`fp-port${isPending ? ' is-pending' : ''}${live(ref) ? ' is-live' : ''}`}
                    cx={p.x}
                    cy={p.y}
                    r={4.5}
                    role="button"
                    tabIndex={0}
                    aria-label={`Port ${p.name} of ${c.label || KIND_NAMES[c.kind]}`}
                    data-testid={`fp-port-${c.id}-${p.name}`}
                    onPointerDown={(ev) => {
                      ev.stopPropagation();
                      onPort(ref);
                    }}
                    onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && onPort(ref)}
                  />
                );
              }),
            )}
          </svg>
        </div>
        <div class="lab-controls fp-props" data-testid="fp-props">
          {sel ? (
            <>
              <h3>{KIND_NAMES[sel.kind]}</h3>
              <label class="fp-field">
                Label
                <input class="input" value={sel.label} onInput={(e) => update(sel.id, { label: e.currentTarget.value })} />
              </label>
              {sel.kind === 'valve' && (
                <>
                  <label class="fp-field">
                    Valve
                    <select class="input" value={sel.valve} onChange={(e) => update(sel.id, { valve: e.currentTarget.value as ValveType })} data-testid="fp-valve-type">
                      {(Object.keys(VALVES) as ValveType[]).map((v) => (
                        <option key={v} value={v}>
                          {VALVE_NAMES[v]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(['left', 'right'] as const).map((side) => (
                    <div key={side} class="fp-field">
                      <label class="fp-field">
                        {side === 'left' ? 'Left operator' : 'Right operator'}
                        <select
                          class="input"
                          value={(side === 'left' ? sel.left : sel.right) ?? 'spring'}
                          onChange={(e) => update(sel.id, side === 'left' ? { left: e.currentTarget.value as Actuator } : { right: e.currentTarget.value as Actuator })}
                        >
                          {ACTUATORS.map(([v, label]) => (
                            <option key={v} value={v}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {(side === 'left' ? sel.left : sel.right) === 'roller' && (
                        <label class="fp-field">
                          Operated by cylinder end (such as A1 or A0)
                          <input
                            class="input"
                            value={(side === 'left' ? sel.leftRoller : sel.rightRoller) ?? ''}
                            onInput={(e) => update(sel.id, side === 'left' ? { leftRoller: e.currentTarget.value } : { rightRoller: e.currentTarget.value })}
                          />
                        </label>
                      )}
                    </div>
                  ))}
                </>
              )}
              {sel.kind === 'cylinder' && (
                <>
                  <label class="fp-field">
                    Stroke time at full flow (s)
                    <input
                      class="input"
                      type="number"
                      min={0.2}
                      max={20}
                      step={0.1}
                      value={sel.stroke ?? 1}
                      onChange={(e) => update(sel.id, { stroke: Math.min(20, Math.max(0.2, Number(e.currentTarget.value) || 1)) })}
                    />
                  </label>
                  <label class="fp-field">
                    Load against extending (% of full force)
                    <input
                      class="input"
                      type="number"
                      min={0}
                      max={95}
                      step={5}
                      value={Math.round((sel.load ?? 0) * 100)}
                      onChange={(e) => update(sel.id, { load: Math.min(0.95, Math.max(0, (Number(e.currentTarget.value) || 0) / 100)) })}
                    />
                  </label>
                </>
              )}
              {sel.kind === 'flow' && (
                <label class="fp-field">
                  Opening (%)
                  <input
                    class="input"
                    type="range"
                    min={5}
                    max={100}
                    step={5}
                    value={Math.round((sel.setting ?? 0.5) * 100)}
                    onInput={(e) => update(sel.id, { setting: Number(e.currentTarget.value) / 100 })}
                  />
                </label>
              )}
              <button type="button" class="button button-small button-danger" onClick={() => remove(sel.id)} data-testid="fp-delete">
                Delete
              </button>
            </>
          ) : selWire ? (
            <>
              <h3>Line</h3>
              <button type="button" class="button button-small button-danger" onClick={() => remove(selWire.id)}>
                Delete the line
              </button>
            </>
          ) : (
            <p class="lab-note">{pending ? 'Now click the port to join it to.' : 'Select a part to change it.'}</p>
          )}
          <h3>Cylinders</h3>
          <ul class="fp-cylinders" data-testid="fp-cylinders">
            {circuit.components
              .filter((c) => c.kind === 'cylinder')
              .map((c) => (
                <li key={c.id}>
                  {c.label}: <meter min={0} max={1} value={sim.cylinders[c.id] ?? 0} /> {Math.round((sim.cylinders[c.id] ?? 0) * 100)} % out
                </li>
              ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export default defineCustomTool(FluidPower);
