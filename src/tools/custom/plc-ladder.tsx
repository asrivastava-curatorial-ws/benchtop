/**
 * PLC ladder logic simulator: rungs typed as conditions and actions, drawn
 * as a ladder diagram whose wires light up as power flows; switches and push
 * buttons for the inputs, lamps for the outputs, timers and counters; a scan
 * cycle that runs, steps or stops; structured text out.
 */
import type { JSX } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { type Action, emptyState, isInput, type Net, type PlcState, type Program, parseProgram, type RungFlow, scan, structuredText } from '../../lib/ladder';
import { saveFile } from '../../platform';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { useClock } from './_lab';
import { usePersistentState } from './_shared';

const EXAMPLES: Readonly<Record<string, string>> = {
  'Start–stop with seal-in': `# A motor starter: Start latches the motor on through its own contact; Stop breaks it.
Start = I0.0
Stop = I0.1
Motor = Q0.0
(Start | Motor) & !Stop -> Motor`,
  'Forward–reverse with interlock': `Fwd = I0.0
Rev = I0.1
Stop = I0.2
MotorFwd = Q0.0
MotorRev = Q0.1
# Each direction blocks the other.
(Fwd | MotorFwd) & !Stop & !MotorRev -> MotorFwd
(Rev | MotorRev) & !Stop & !MotorFwd -> MotorRev`,
  'Traffic lights': `Run = I0.0
Red = Q0.0
Amber = Q0.1
Green = Q0.2
Run & !T2 -> TON T0 4s     # red for 4 s
T0 -> TON T1 4s            # then green for 4 s
T1 -> TON T2 1500ms        # then amber, and round again
Run & !T0 -> Red
T0 & !T1 -> Green
T1 & !T2 -> Amber`,
  'Bottle counter': `Sensor = I0.0
Reset = I0.1
BoxFull = Q0.0
Conveyor = Q0.1
Sensor^ -> CTU C0 6        # count bottles going past
C0 -> BoxFull
!C0 -> Conveyor            # stop the conveyor when the box is full
Reset -> RES C0`,
  Blinker: `Enable = I0.0
Lamp = Q0.0
Enable & !T1 -> TON T0 500ms
T0 -> TON T1 500ms
Enable & !T0 -> Lamp`,
  'Tank filling': `Low = I0.0       # on while the water is above the low switch
High = I0.1      # on while the water is above the high switch
Pump = Q0.0
!Low -> S Pump
High -> R Pump`,
};

interface PState {
  readonly text: string;
  readonly scanMs: number;
  readonly momentary: readonly string[];
}

const read = (v: Values | undefined): PState => ({
  text: typeof v?.text === 'string' ? v.text : (EXAMPLES['Start–stop with seal-in'] ?? ''),
  scanMs: typeof v?.scanMs === 'number' && v.scanMs >= 1 && v.scanMs <= 1000 ? v.scanMs : 20,
  momentary: Array.isArray(v?.momentary) ? (v.momentary as unknown[]).filter((x): x is string => typeof x === 'string') : ['I0.0', 'I0.1', 'I0.2'],
});
const write = (s: PState): Values => ({ ...s, momentary: [...s.momentary] }) as unknown as Values;

/* ------------------------------------------------------------- drawing -- */

const W = 96;
const H = 58;
const COIL_W = 150;

interface Size {
  readonly w: number;
  readonly h: number;
}

function size(net: Net): Size {
  if (net.k === 'contact' || net.k === 'always') return { w: 1, h: 1 };
  const parts = net.parts.map(size);
  return net.k === 'series' ? { w: parts.reduce((s, p) => s + p.w, 0), h: Math.max(...parts.map((p) => p.h)) } : { w: Math.max(...parts.map((p) => p.w)), h: parts.reduce((s, p) => s + p.h, 0) };
}

interface DrawContext {
  readonly flow: RungFlow | undefined;
  readonly name: (address: string) => string | undefined;
  readonly out: JSX.Element[];
  readonly onContact: (address: string, down: boolean) => void;
}

const wire = (x1: number, y: number, x2: number, on: boolean, key: string) => <line key={key} class={on ? 'pl-wire is-on' : 'pl-wire'} x1={x1} y1={y} x2={x2} y2={y} />;

/** Draws a network with its top-left at (x, y); returns whether power comes out. */
function draw(net: Net, x: number, y: number, power: boolean, ctx: DrawContext, path: string): boolean {
  const mid = y + H / 2;
  if (net.k === 'always') {
    ctx.out.push(wire(x, mid, x + W, power, `${path}w`));
    return power;
  }
  if (net.k === 'contact') {
    const closed = ctx.flow?.conducting[net.id] ?? false;
    const through = power && closed;
    const label = ctx.name(net.address);
    ctx.out.push(
      wire(x, mid, x + W / 2 - 9, power, `${path}a`),
      wire(x + W / 2 + 9, mid, x + W, through, `${path}b`),
      <g
        key={`${path}c`}
        class={`pl-contact${closed ? ' is-closed' : ''}${isInput(net.address) ? ' is-input' : ''}`}
        onPointerDown={() => isInput(net.address) && ctx.onContact(net.address, true)}
        onPointerUp={() => isInput(net.address) && ctx.onContact(net.address, false)}
        onPointerLeave={() => isInput(net.address) && ctx.onContact(net.address, false)}
        data-address={net.address}
      >
        <rect class="pl-hit" x={x + W / 2 - 16} y={mid - 16} width={32} height={32} />
        <line x1={x + W / 2 - 9} y1={mid - 11} x2={x + W / 2 - 9} y2={mid + 11} />
        <line x1={x + W / 2 + 9} y1={mid - 11} x2={x + W / 2 + 9} y2={mid + 11} />
        {net.negated && <line x1={x + W / 2 - 9} y1={mid + 11} x2={x + W / 2 + 9} y2={mid - 11} />}
        {net.edge && (
          <text class="pl-edge" x={x + W / 2} y={mid + 4} text-anchor="middle">
            {net.edge === 'rising' ? 'P' : 'N'}
          </text>
        )}
        <text class="pl-address" x={x + W / 2} y={mid - 16} text-anchor="middle">
          {net.address}
        </text>
        {label && (
          <text class="pl-name" x={x + W / 2} y={mid + 25} text-anchor="middle">
            {label}
          </text>
        )}
      </g>,
    );
    return through;
  }
  const own = size(net);
  if (net.k === 'series') {
    let cx = x;
    let p = power;
    net.parts.forEach((part, i) => {
      p = draw(part, cx, y, p, ctx, `${path}s${i}`);
      cx += size(part).w * W;
    });
    return p;
  }
  // Parallel branches share the input power; narrower branches are wired through to the right.
  let cy = y;
  let out = false;
  const right = x + own.w * W;
  net.parts.forEach((part, i) => {
    const ps = size(part);
    const got = draw(part, x, cy, power, ctx, `${path}p${i}`);
    if (ps.w < own.w) ctx.out.push(wire(x + ps.w * W, cy + H / 2, right, got, `${path}e${i}`));
    if (i > 0) {
      ctx.out.push(<line key={`${path}l${i}`} class={power ? 'pl-wire is-on' : 'pl-wire'} x1={x} y1={y + H / 2} x2={x} y2={cy + H / 2} />);
      ctx.out.push(<line key={`${path}r${i}`} class={got || out ? 'pl-wire is-on' : 'pl-wire'} x1={right} y1={y + H / 2} x2={right} y2={cy + H / 2} />);
    }
    out = out || got;
    cy += ps.h * H;
  });
  return out;
}

function actionText(a: Action): [string, string] {
  switch (a.kind) {
    case 'coil':
      return ['( )', a.address];
    case 'set':
      return ['(S)', a.address];
    case 'reset':
      return ['(R)', a.address];
    case 'ton':
    case 'tof':
    case 'tp':
      return [a.kind.toUpperCase(), `${a.address} ${(a.preset ?? 0) >= 1000 ? `${(a.preset ?? 0) / 1000} s` : `${a.preset} ms`}`];
    case 'ctu':
    case 'ctd':
      return [a.kind.toUpperCase(), `${a.address} PV ${a.preset}`];
    case 'res':
      return ['(RES)', a.address];
  }
}

function Ladder({ program, flows, state, onContact }: { program: Program; flows: readonly RungFlow[]; state: PlcState; onContact: (address: string, down: boolean) => void }) {
  const names = new Map<string, string>();
  for (const [n, a] of program.symbols) names.set(a, n);
  const netWidth = Math.max(1, ...program.rungs.map((r) => size(r.net).w));
  const left = 18;
  const coilX = left + 14 + netWidth * W + 24;
  const rightRail = coilX + COIL_W + 20;
  const out: JSX.Element[] = [];
  let y = 8;
  program.rungs.forEach((rung, i) => {
    const flow = flows[i];
    const s = size(rung.net);
    const rows = Math.max(s.h, rung.actions.length);
    if (rung.comment) {
      out.push(
        <text key={`c${i}`} class="pl-comment" x={left + 14} y={y + 12}>
          {rung.comment}
        </text>,
      );
      y += 18;
    }
    out.push(
      <text key={`n${i}`} class="pl-rung-no" x={left - 4} y={y + H / 2 + 4} text-anchor="end">
        {i + 1}
      </text>,
    );
    const ctx: DrawContext = { flow, name: (a) => names.get(a), out, onContact };
    out.push(wire(left, y + H / 2, left + 14, true, `in${i}`));
    const on = draw(rung.net, left + 14, y, true, ctx, `r${i}`);
    out.push(wire(left + 14 + s.w * W, y + H / 2, coilX, on, `to${i}`));
    rung.actions.forEach((a, j) => {
      const cy = y + j * H + H / 2;
      if (j > 0) out.push(<line key={`v${i}-${j}`} class={on ? 'pl-wire is-on' : 'pl-wire'} x1={coilX} y1={y + H / 2} x2={coilX} y2={cy} />);
      const [symbol, text] = actionText(a);
      let lit = a.kind === 'coil' || a.kind === 'set' || a.kind === 'reset' ? state.bits[a.address] === true : false;
      let extra = '';
      if (a.kind === 'ton' || a.kind === 'tof' || a.kind === 'tp') {
        const t = state.timers[a.address];
        lit = t?.done === true;
        extra = `${((t?.acc ?? 0) / 1000).toFixed(1)} s`;
      } else if (a.kind === 'ctu' || a.kind === 'ctd') {
        const c = state.counters[a.address];
        lit = c?.done === true;
        extra = `count ${c?.count ?? (a.kind === 'ctd' ? a.preset : 0)}`;
      }
      out.push(
        wire(coilX, cy, coilX + 18, on, `cw${i}-${j}`),
        <g key={`a${i}-${j}`} class={`pl-coil${lit ? ' is-on' : ''}`}>
          <rect x={coilX + 18} y={cy - 15} width={COIL_W - 18} height={30} rx={symbol.startsWith('(') ? 15 : 3} />
          <text class="pl-coil-symbol" x={coilX + 34} y={cy + 4}>
            {symbol}
          </text>
          <text class="pl-address" x={coilX + 62} y={cy - 2}>
            {text}
          </text>
          <text class="pl-name" x={coilX + 62} y={cy + 11}>
            {extra || names.get(a.address) || ''}
          </text>
        </g>,
        wire(coilX + COIL_W, cy, rightRail, false, `rw${i}-${j}`),
      );
    });
    y += rows * H + 8;
  });
  const height = Math.max(y, 60);
  return (
    <svg class="lab-scene pl-ladder" viewBox={`0 0 ${rightRail + 10} ${height}`} width={rightRail + 10} role="img" aria-label="Ladder diagram" data-testid="pl-ladder">
      <line class="pl-rail" x1={left} y1={0} x2={left} y2={height} />
      <line class="pl-rail" x1={rightRail} y1={0} x2={rightRail} y2={height} />
      {out}
    </svg>
  );
}

/* --------------------------------------------------------------- tool -- */

function PlcLadder({ toolId }: { toolId: string }) {
  const [s, setState] = usePersistentState(toolId, read, write);
  const set = (patch: Partial<PState>) => setState((p) => ({ ...p, ...patch }));
  const program = useMemo(() => parseProgram(s.text), [s.text]);
  const [plc, setPlc] = useState<PlcState>(emptyState);
  const [flows, setFlows] = useState<RungFlow[]>([]);
  const [running, setRunning] = useState(true);
  const carry = useRef(0);
  const latest = useRef({ program, plc });
  latest.current = { program, plc };

  const step = (ms: number, base: PlcState = latest.current.plc) => {
    const r = scan(latest.current.program, base, ms);
    setPlc(r.state);
    setFlows(r.flows);
    latest.current = { ...latest.current, plc: r.state };
  };
  useClock(running && program.errors.length === 0, (dt) => {
    carry.current += dt * 1000;
    let scans = 0;
    let state = latest.current.plc;
    let flowsNow: RungFlow[] | null = null;
    while (carry.current >= s.scanMs && scans < 20) {
      carry.current -= s.scanMs;
      const r = scan(latest.current.program, state, s.scanMs);
      state = r.state;
      flowsNow = r.flows;
      scans++;
    }
    if (scans >= 20) carry.current = 0;
    if (flowsNow) {
      setPlc(state);
      setFlows(flowsNow);
      latest.current = { ...latest.current, plc: state };
    }
  });

  const setInput = (address: string, value: boolean) => {
    const next = { ...latest.current.plc, inputs: { ...latest.current.plc.inputs, [address]: value } };
    latest.current = { ...latest.current, plc: next };
    setPlc(next);
    if (!running) step(s.scanMs, next);
  };

  const used = (prefix: string) => {
    const found = new Set<string>();
    const visit = (net: Net) => {
      if (net.k === 'contact' && net.address.startsWith(prefix)) found.add(net.address);
      else if (net.k === 'series' || net.k === 'parallel') net.parts.forEach(visit);
    };
    for (const r of program.rungs) {
      visit(r.net);
      for (const a of r.actions) if (a.address.startsWith(prefix)) found.add(a.address);
    }
    return found;
  };
  const sortAddr = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  const inputs = [...new Set([...Array.from({ length: 8 }, (_, i) => `I0.${i}`), ...used('I')])].sort(sortAddr);
  const outputs = [...new Set([...Array.from({ length: 8 }, (_, i) => `Q0.${i}`), ...used('Q')])].sort(sortAddr);
  const memory = [...used('M')].sort(sortAddr);
  const timers = [...used('T')].sort(sortAddr);
  const counters = [...used('C')].sort(sortAddr);
  const names = new Map<string, string>();
  for (const [n, a] of program.symbols) names.set(a, n);

  const exportSt = () =>
    attempt(async () => {
      const out = await saveFile('program.st', structuredText(program), 'text/plain');
      if (out.saved) notify(`Saved to ${out.location}`);
    });
  const saveProgram = () =>
    attempt(async () => {
      const out = await saveFile('program.ladder.txt', s.text.endsWith('\n') ? s.text : `${s.text}\n`, 'text/plain');
      if (out.saved) notify(`Saved to ${out.location}`);
    });

  return (
    <section class="tool lab-tool" data-testid="tool" data-state={program.errors.length ? 'idle' : 'done'}>
      <div class="button-row">
        <select
          class="input pl-examples"
          aria-label="Load an example"
          value=""
          onChange={(e) => {
            const text = EXAMPLES[e.currentTarget.value];
            if (text) {
              set({ text });
              setPlc(emptyState());
              setFlows([]);
            }
          }}
          data-testid="pl-examples"
        >
          <option value="">Examples…</option>
          {Object.keys(EXAMPLES).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <button type="button" class="button button-primary button-small" onClick={() => setRunning((r) => !r)} data-testid="pl-run">
          {running ? 'Stop the PLC' : 'Run'}
        </button>
        <button type="button" class="button button-small" onClick={() => step(s.scanMs)} disabled={running} data-testid="pl-step">
          One scan
        </button>
        <button
          type="button"
          class="button button-small"
          onClick={() => {
            const fresh = { ...emptyState(), inputs: latest.current.plc.inputs };
            latest.current = { ...latest.current, plc: fresh };
            setPlc(fresh);
            setFlows([]);
          }}
        >
          Reset memory
        </button>
        <label class="pl-scan">
          Scan time
          <input class="input" type="number" min={1} max={1000} value={s.scanMs} onChange={(e) => set({ scanMs: Math.min(1000, Math.max(1, Number(e.currentTarget.value) || 20)) })} /> ms
        </label>
        <span class="tone-muted pl-scans">{plc.scans} scans</span>
        <button type="button" class="button button-small" onClick={() => void saveProgram()}>
          Save program
        </button>
        <button type="button" class="button button-small" onClick={() => void exportSt()} disabled={program.errors.length > 0}>
          Structured text
        </button>
      </div>
      <div class="pl-layout">
        <div class="pl-source">
          <textarea class="input pl-code" spellcheck={false} value={s.text} onInput={(e) => set({ text: e.currentTarget.value })} aria-label="Program: one rung per line" data-testid="pl-code" />
          {program.errors.length > 0 ? (
            <ul class="pl-errors" role="alert" data-testid="pl-errors">
              {program.errors.map((e) => (
                <li key={`${e.line}${e.message}`}>
                  Line {e.line}: {e.message}
                </li>
              ))}
            </ul>
          ) : (
            <p class="lab-note">
              One rung per line: <code>condition -&gt; action</code>. <code>&amp;</code> series, <code>|</code> parallel, <code>!A</code> normally closed, <code>A^</code> rising edge, <code>Av</code>{' '}
              falling edge. Actions: <code>Q0.0</code>, <code>S M0.0</code>, <code>R M0.0</code>, <code>TON T0 2s</code>, <code>TOF</code>, <code>TP</code>, <code>CTU C0 10</code>, <code>CTD</code>,{' '}
              <code>RES C0</code>. Names: <code>Start = I0.0</code>.
            </p>
          )}
        </div>
        <div class="pl-diagram">
          <Ladder program={program} flows={flows} state={plc} onContact={(a, down) => (s.momentary.includes(a) ? setInput(a, down) : down && setInput(a, !plc.inputs[a]))} />
        </div>
        <div class="pl-io">
          <h3>Inputs</h3>
          <ul class="pl-list">
            {inputs.map((a) => {
              const on = plc.inputs[a] === true;
              const momentary = s.momentary.includes(a);
              return (
                <li key={a} class={on ? 'is-on' : ''}>
                  <button
                    type="button"
                    class={`pl-switch${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    onPointerDown={() => momentary && setInput(a, true)}
                    onPointerUp={() => momentary && setInput(a, false)}
                    onPointerLeave={() => momentary && on && setInput(a, false)}
                    onKeyDown={(e) => momentary && (e.key === ' ' || e.key === 'Enter') && !e.repeat && setInput(a, true)}
                    onKeyUp={(e) => momentary && (e.key === ' ' || e.key === 'Enter') && setInput(a, false)}
                    onClick={() => !momentary && setInput(a, !on)}
                    data-testid={`pl-in-${a}`}
                  >
                    <span class="pl-led" />
                    {a}
                    {names.get(a) ? ` ${names.get(a)}` : ''}
                  </button>
                  <label class="pl-mode" title="A push button is on only while held">
                    <input type="checkbox" checked={momentary} onChange={(e) => set({ momentary: e.currentTarget.checked ? [...s.momentary, a] : s.momentary.filter((x) => x !== a) })} /> push
                  </label>
                </li>
              );
            })}
          </ul>
          <h3>Outputs</h3>
          <ul class="pl-list" data-testid="pl-outputs">
            {outputs.map((a) => (
              <li key={a} class={plc.bits[a] ? 'is-on' : ''} data-testid={`pl-out-${a}`} data-on={plc.bits[a] ? 'on' : 'off'}>
                <span class="pl-lamp" />
                {a}
                {names.get(a) ? ` ${names.get(a)}` : ''}
              </li>
            ))}
          </ul>
          {memory.length > 0 && (
            <>
              <h3>Memory</h3>
              <ul class="pl-list">
                {memory.map((a) => (
                  <li key={a} class={plc.bits[a] ? 'is-on' : ''}>
                    <span class="pl-lamp" />
                    {a}
                    {names.get(a) ? ` ${names.get(a)}` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
          {(timers.length > 0 || counters.length > 0) && <h3>Timers and counters</h3>}
          {timers.map((a) => {
            const t = plc.timers[a];
            return (
              <div key={a} class="pl-meter">
                <span>
                  {a} {t?.done ? 'done' : ''}
                </span>
                <meter min={0} max={t?.preset || 1} value={t?.acc ?? 0} />
                <span>{((t?.acc ?? 0) / 1000).toFixed(1)} s</span>
              </div>
            );
          })}
          {counters.map((a) => {
            const c = plc.counters[a];
            return (
              <div key={a} class="pl-meter" data-testid={`pl-counter-${a}`}>
                <span>
                  {a} {c?.done ? 'done' : ''}
                </span>
                <meter min={0} max={c?.preset || 1} value={Math.max(0, c?.count ?? 0)} />
                <span>{c?.count ?? 0}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default defineCustomTool(PlcLadder);
