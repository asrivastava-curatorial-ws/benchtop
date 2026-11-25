/**
 * A small PLC: ladder-logic rungs written as Boolean conditions, a scan cycle
 * with coils, set and reset, on-delay, off-delay and pulse timers, up and
 * down counters, and rising and falling edges.
 *
 * A program is text, one rung per line:
 *
 *     Start = I0.0                     a name for an address
 *     (Start | Motor) & !Stop -> Motor a seal-in circuit
 *     Motor -> TON T0 5s               an on-delay timer
 *     T0 -> Q0.1                       its done bit
 *     Sensor^ -> CTU C0 10             count rising edges
 *
 * Addresses: inputs I0.0–I3.7, outputs Q0.0–Q3.7, memory M0.0–M15.7, timers
 * T0–T31 and counters C0–C31 (their done bits).  In a condition, & (or AND)
 * is series, | (or OR) is parallel, !A (or NOT A) a normally closed contact,
 * A^ a rising edge and Av a falling edge.  Actions: A (coil), S A (set),
 * R A (reset), TON/TOF/TP Tn time, CTU/CTD Cn count, RES Tn or Cn.
 */

export type Contact = { readonly k: 'contact'; readonly address: string; readonly negated: boolean; readonly edge?: 'rising' | 'falling'; readonly id: number };
export type Net = Contact | { readonly k: 'series' | 'parallel'; readonly parts: readonly Net[] } | { readonly k: 'always' };

export type ActionKind = 'coil' | 'set' | 'reset' | 'ton' | 'tof' | 'tp' | 'ctu' | 'ctd' | 'res';

export interface Action {
  readonly kind: ActionKind;
  readonly address: string;
  /** Milliseconds for timers, counts for counters. */
  readonly preset?: number;
}

export interface Rung {
  readonly line: number;
  readonly source: string;
  readonly net: Net;
  readonly actions: readonly Action[];
  readonly comment: string;
}

export interface Program {
  readonly rungs: readonly Rung[];
  /** Name → address */
  readonly symbols: ReadonlyMap<string, string>;
  readonly errors: readonly { readonly line: number; readonly message: string }[];
}

const ADDRESS = /^(?:([IQM])(\d{1,2})\.([0-7])|([TC])(\d{1,2}))$/i;

export function normalise(address: string): string | null {
  const m = ADDRESS.exec(address.trim());
  if (!m) return null;
  if (m[1]) {
    const area = m[1].toUpperCase();
    const byte = Number(m[2]);
    if ((area === 'M' && byte > 15) || (area !== 'M' && byte > 3)) return null;
    return `${area}${byte}.${m[3]}`;
  }
  const n = Number(m[5]);
  return n <= 31 ? `${(m[4] ?? '').toUpperCase()}${n}` : null;
}

export const isInput = (a: string) => a.startsWith('I');
const isBit = (a: string) => /^[QM]/.test(a);

function parseTime(text: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|min)?$/i.exec(text.trim());
  if (!m) return null;
  const v = Number(m[1]);
  const unit = (m[2] ?? 's').toLowerCase();
  return unit === 'ms' ? v : unit === 'min' ? v * 60_000 : v * 1000;
}

const OPERATIONS: Readonly<Record<string, Exclude<ActionKind, 'coil'>>> = { S: 'set', SET: 'set', R: 'reset', RESET: 'reset', TON: 'ton', TOF: 'tof', TP: 'tp', CTU: 'ctu', CTD: 'ctd', RES: 'res' };

export function parseProgram(text: string): Program {
  const symbols = new Map<string, string>();
  const lookup = new Map<string, string>();
  const errors: { line: number; message: string }[] = [];
  const rungs: Rung[] = [];
  let contactId = 0;
  const lines = text.split('\n');
  // Names first, so a rung may use a name defined further down.
  lines.forEach((raw, i) => {
    const line = raw.replace(/(#|\/\/).*$/, '').trim();
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\S+)$/.exec(line);
    if (!m || line.includes('->')) return;
    const address = normalise(m[2] ?? '');
    if (!address) errors.push({ line: i + 1, message: `${m[2]} is not an address (I0.0, Q0.0, M0.0, T0 or C0).` });
    else if (normalise(m[1] ?? '')) errors.push({ line: i + 1, message: `${m[1]} looks like an address; choose another name.` });
    else {
      symbols.set(m[1] ?? '', address);
      lookup.set((m[1] ?? '').toLowerCase(), address);
    }
  });
  const resolve = (word: string, line: number): string | null => {
    const address = normalise(word) ?? lookup.get(word.toLowerCase()) ?? null;
    if (!address) errors.push({ line, message: `“${word}” is neither an address nor a name defined with “name = address”.` });
    return address;
  };
  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const comment = /(#|\/\/)(.*)$/.exec(raw)?.[2]?.trim() ?? '';
    const line = raw.replace(/(#|\/\/).*$/, '').trim();
    if (!line || (/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*\S+$/.test(line) && !line.includes('->'))) return;
    const arrow = line.indexOf('->');
    if (arrow < 0) {
      errors.push({ line: lineNo, message: 'A rung needs a condition, “->” and what it does, such as “Start -> Q0.0”.' });
      return;
    }
    const before = errors.length;
    const tokens = line.slice(0, arrow).match(/[A-Za-z_][A-Za-z0-9_.]*|\d+(?:\.\d+)?|[()&|!*+^]|\S/g) ?? [];
    let at = 0;
    const fail = (message: string): Net => {
      errors.push({ line: lineNo, message });
      at = tokens.length;
      return { k: 'always' };
    };
    const atom = (): Net => {
      const t = tokens[at++];
      if (t === undefined) return fail('The condition ends too soon.');
      if (t === '(') {
        const inner = parallel();
        if (tokens[at++] !== ')') return fail('A bracket is not closed.');
        return inner;
      }
      if (t === '!' || t.toUpperCase() === 'NOT') {
        const inner = atom();
        if (inner.k !== 'contact' || inner.negated) return fail('NOT applies to a single contact here (a normally closed contact); use a memory bit for a whole group.');
        return { ...inner, negated: true };
      }
      if (t === '1' || t.toUpperCase() === 'TRUE') return { k: 'always' };
      if (/^[A-Za-z_]/.test(t)) {
        let word = t;
        let edge: 'rising' | 'falling' | undefined;
        if (tokens[at] === '^') {
          at++;
          edge = 'rising';
        } else if (/^(.*[0-9a-z_])v$/i.test(word) && !normalise(word) && !lookup.has(word.toLowerCase())) {
          word = word.slice(0, -1);
          edge = 'falling';
        }
        const address = resolve(word, lineNo);
        if (!address) return { k: 'always' };
        return edge ? { k: 'contact', address, negated: false, edge, id: contactId++ } : { k: 'contact', address, negated: false, id: contactId++ };
      }
      return fail(`Unexpected “${t}” in the condition.`);
    };
    const series = (): Net => {
      const parts = [atom()];
      while (tokens[at] === '&' || tokens[at] === '*' || tokens[at]?.toUpperCase() === 'AND') {
        at++;
        parts.push(atom());
      }
      return parts.length === 1 ? (parts[0] as Net) : { k: 'series', parts };
    };
    function parallel(): Net {
      const parts = [series()];
      while (tokens[at] === '|' || tokens[at] === '+' || tokens[at]?.toUpperCase() === 'OR') {
        at++;
        parts.push(series());
      }
      return parts.length === 1 ? (parts[0] as Net) : { k: 'parallel', parts };
    }
    const net = tokens.length ? parallel() : fail('Write a condition before “->” (use 1 for always).');
    if (at < tokens.length) fail(`Unexpected “${tokens[at]}” in the condition.`);
    const actions: Action[] = [];
    for (const part of line
      .slice(arrow + 2)
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)) {
      const words = part.split(/\s+/);
      const op = (words[0] ?? '').toUpperCase();
      const target = words[1] ?? '';
      const kind = OPERATIONS[op];
      if (!kind) {
        if (words.length !== 1) {
          errors.push({ line: lineNo, message: `“${part}” is not an action.` });
          continue;
        }
        const address = resolve(words[0] ?? '', lineNo);
        if (address && !isBit(address)) errors.push({ line: lineNo, message: `${address}: only outputs (Q) and memory bits (M) can be coils.` });
        else if (address) actions.push({ kind: 'coil', address });
        continue;
      }
      const address = resolve(target, lineNo);
      if (!address) continue;
      if ((kind === 'set' || kind === 'reset') && !isBit(address)) {
        errors.push({ line: lineNo, message: `${address}: set and reset work on outputs (Q) and memory bits (M).` });
        continue;
      }
      if ((kind === 'ton' || kind === 'tof' || kind === 'tp') && !address.startsWith('T')) {
        errors.push({ line: lineNo, message: `A timer needs a timer address such as T0, not ${address}.` });
        continue;
      }
      if ((kind === 'ctu' || kind === 'ctd') && !address.startsWith('C')) {
        errors.push({ line: lineNo, message: `A counter needs a counter address such as C0, not ${address}.` });
        continue;
      }
      if (kind === 'res' && !/^[TC]/.test(address)) {
        errors.push({ line: lineNo, message: 'RES resets a timer or a counter.' });
        continue;
      }
      if (kind === 'ton' || kind === 'tof' || kind === 'tp') {
        const ms = parseTime(words.slice(2).join(' '));
        if (ms === null) errors.push({ line: lineNo, message: `${op} ${address} needs a time, such as 2s or 500ms.` });
        else actions.push({ kind, address, preset: ms });
      } else if (kind === 'ctu' || kind === 'ctd') {
        const n = Number(words[2]);
        if (!Number.isInteger(n) || n < 1) errors.push({ line: lineNo, message: `${op} ${address} needs a preset count, such as 10.` });
        else actions.push({ kind, address, preset: n });
      } else actions.push({ kind, address });
    }
    if (!actions.length && errors.length === before) errors.push({ line: lineNo, message: 'Say what the rung does after “->”.' });
    if (errors.length === before) rungs.push({ line: lineNo, source: line, net, actions, comment });
  });
  return { rungs, symbols, errors };
}

/* ----------------------------------------------------------------- scan -- */

export interface TimerState {
  readonly acc: number;
  readonly preset: number;
  readonly done: boolean;
  readonly running: boolean;
  /** Was the rung on in the last scan (for pulse timers)? */
  readonly last: boolean;
}

export interface CounterState {
  readonly count: number;
  readonly preset: number;
  readonly done: boolean;
  readonly last: boolean;
}

export interface PlcState {
  readonly inputs: Readonly<Record<string, boolean>>;
  readonly bits: Readonly<Record<string, boolean>>;
  readonly timers: Readonly<Record<string, TimerState>>;
  readonly counters: Readonly<Record<string, CounterState>>;
  /** Values contacts saw in the previous scan, for edges (by contact id). */
  readonly previous: Readonly<Record<number, boolean>>;
  readonly scans: number;
}

export const emptyState = (): PlcState => ({ inputs: {}, bits: {}, timers: {}, counters: {}, previous: {}, scans: 0 });

/** Power flow of a rung after a scan: whether each contact conducted, and whether the rung was on. */
export interface RungFlow {
  readonly on: boolean;
  readonly conducting: Readonly<Record<number, boolean>>;
}

/** One PLC scan: read inputs, solve the rungs top to bottom, update timers and counters by `dt` ms. */
export function scan(program: Program, state: PlcState, dt: number): { state: PlcState; flows: RungFlow[] } {
  const bits: Record<string, boolean> = { ...state.bits };
  const timers: Record<string, TimerState> = { ...state.timers };
  const counters: Record<string, CounterState> = { ...state.counters };
  const previous: Record<number, boolean> = { ...state.previous };
  const read = (address: string): boolean => {
    if (address.startsWith('I')) return state.inputs[address] === true;
    if (address.startsWith('T')) return timers[address]?.done === true;
    if (address.startsWith('C')) return counters[address]?.done === true;
    return bits[address] === true;
  };
  const flows: RungFlow[] = [];
  for (const rung of program.rungs) {
    const conducting: Record<number, boolean> = {};
    const solve = (net: Net): boolean => {
      if (net.k === 'always') return true;
      if (net.k === 'contact') {
        const raw = read(net.address);
        // Edge memory starts off, as an R_TRIG's does: an input already on at start-up is a rising edge.
        const before = state.previous[net.id] ?? false;
        previous[net.id] = raw;
        let value: boolean;
        if (net.edge === 'rising') value = raw && !before;
        else if (net.edge === 'falling') value = !raw && before;
        else value = net.negated ? !raw : raw;
        conducting[net.id] = value;
        return value;
      }
      // Every part is evaluated (no short circuit), so each contact shows its state.
      const values = net.parts.map(solve);
      return net.k === 'series' ? values.every(Boolean) : values.some(Boolean);
    };
    const on = solve(rung.net);
    flows.push({ on, conducting });
    for (const action of rung.actions) {
      const a = action.address;
      switch (action.kind) {
        case 'coil':
          bits[a] = on;
          break;
        case 'set':
          if (on) bits[a] = true;
          break;
        case 'reset':
          if (on) bits[a] = false;
          break;
        case 'ton': {
          const t = timers[a];
          const preset = action.preset ?? 0;
          const acc = on ? Math.min(preset, (t?.running ? t.acc : 0) + dt) : 0;
          timers[a] = { acc, preset, done: on && acc >= preset, running: on, last: on };
          break;
        }
        case 'tof': {
          const t = timers[a];
          const preset = action.preset ?? 0;
          if (on) timers[a] = { acc: 0, preset, done: true, running: false, last: on };
          else if (t?.done) {
            const acc = Math.min(preset, t.acc + dt);
            timers[a] = { acc, preset, done: acc < preset, running: acc < preset, last: on };
          } else timers[a] = { acc: 0, preset, done: false, running: false, last: on };
          break;
        }
        case 'tp': {
          const t = timers[a];
          const preset = action.preset ?? 0;
          if (t?.running) {
            const acc = Math.min(preset, t.acc + dt);
            timers[a] = { acc, preset, done: acc < preset, running: acc < preset, last: on };
          } else if (on && !t?.last) timers[a] = { acc: 0, preset, done: true, running: true, last: on };
          else timers[a] = { acc: t?.acc ?? 0, preset, done: false, running: false, last: on };
          break;
        }
        case 'ctu':
        case 'ctd': {
          const c = counters[a];
          const preset = action.preset ?? 0;
          const start = c?.count ?? (action.kind === 'ctd' ? preset : 0);
          const count = on && !c?.last ? start + (action.kind === 'ctu' ? 1 : -1) : start;
          counters[a] = { count, preset, done: action.kind === 'ctu' ? count >= preset : count <= 0, last: on };
          break;
        }
        case 'res':
          if (on) {
            if (a.startsWith('T')) timers[a] = { acc: 0, preset: timers[a]?.preset ?? 0, done: false, running: false, last: false };
            else {
              const c = counters[a];
              counters[a] = { count: 0, preset: c?.preset ?? 0, done: false, last: c?.last ?? false };
            }
          }
          break;
      }
    }
  }
  return { state: { inputs: state.inputs, bits, timers, counters, previous, scans: state.scans + 1 }, flows };
}

/* -------------------------------------------------------------- export -- */

/** The program as IEC 61131-3 structured text. */
export function structuredText(program: Program): string {
  const name = (a: string) => {
    for (const [n, addr] of program.symbols) if (addr === a) return n;
    return a.replace('.', '_');
  };
  const expr = (net: Net): string => {
    if (net.k === 'always') return 'TRUE';
    if (net.k === 'contact') {
      const base = /^[TC]/.test(net.address) ? `${name(net.address)}.Q` : name(net.address);
      if (net.edge) return `${net.edge === 'rising' ? 'R' : 'F'}_TRIG_${net.id}(CLK := ${base})`;
      return net.negated ? `NOT ${base}` : base;
    }
    const inner = net.parts.map(expr).join(net.k === 'series' ? ' AND ' : ' OR ');
    return net.k === 'parallel' ? `(${inner})` : inner;
  };
  const lines: string[] = [];
  for (const r of program.rungs) {
    if (r.comment) lines.push(`(* ${r.comment} *)`);
    const condition = expr(r.net);
    for (const a of r.actions) {
      const t = name(a.address);
      if (a.kind === 'coil') lines.push(`${t} := ${condition};`);
      else if (a.kind === 'set') lines.push(`IF ${condition} THEN ${t} := TRUE; END_IF;`);
      else if (a.kind === 'reset') lines.push(`IF ${condition} THEN ${t} := FALSE; END_IF;`);
      else if (a.kind === 'ton' || a.kind === 'tof' || a.kind === 'tp') lines.push(`${t}(IN := ${condition}, PT := T#${a.preset}MS);`);
      else if (a.kind === 'ctu') lines.push(`${t}(CU := ${condition}, PV := ${a.preset});`);
      else if (a.kind === 'ctd') lines.push(`${t}(CD := ${condition}, PV := ${a.preset});`);
      else lines.push(`IF ${condition} THEN ${t}(RESET := TRUE); END_IF;`);
    }
  }
  return `${lines.join('\n')}\n`;
}
