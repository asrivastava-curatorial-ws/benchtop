import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../src/lib/circuit/examples';
import { type CircuitDoc, connect, onSegment, terminalPoints } from '../../src/lib/circuit/netlist';
import { PART_BY_TYPE } from '../../src/lib/circuit/parts';
import { Session } from '../../src/lib/circuit/session';

const example = (id: string) => {
  const e = EXAMPLES.find((x) => x.id === id);
  if (!e) throw new Error(id);
  return e.make();
};

const partOf = (doc: CircuitDoc, type: string, n = 0) => {
  const p = doc.parts.filter((x) => x.type === type)[n];
  if (!p) throw new Error(`no ${type} ${n}`);
  return p;
};

/** Terminals that may be left unconnected in the examples. */
const OPTIONAL = new Set(['relay:NC', 'counter:RST', 'timer555:CTRL']);

async function started(doc: CircuitDoc, options: ConstructorParameters<typeof Session>[1] = {}): Promise<Session> {
  const session = new Session(doc, options);
  for (let i = 0; i < 200 && session.loading > 0; i++) await new Promise((r) => setTimeout(r, 5));
  return session;
}

const run = (session: Session, seconds: number) => {
  for (let t = 0; t < seconds - 1e-9; t += 0.1) session.advance(Math.min(0.1, seconds - t), session.doc.speed, 1e9);
};

const view = (session: Session, id: string) => session.built.runtimes.get(id)?.view() ?? {};

describe('example circuits are wired', () => {
  for (const e of EXAMPLES) {
    it(e.id, () => {
      const doc = e.make();
      const c = connect(doc);
      // Every terminal shares its node with something else.
      const uses = new Map<number, number>();
      for (const nodes of c.partNodes.values()) for (const n of nodes) uses.set(n, (uses.get(n) ?? 0) + 1);
      for (const w of doc.wires) {
        for (const k of [`${w.x1},${w.y1}`, `${w.x2},${w.y2}`]) {
          const n = c.nodeAt.get(k) as number;
          uses.set(n, (uses.get(n) ?? 0) + 1);
        }
      }
      for (const part of doc.parts) {
        const def = PART_BY_TYPE.get(part.type);
        expect(def).toBeDefined();
        if (!def) continue;
        const nodes = c.partNodes.get(part.id) ?? [];
        def.terminals.forEach((t, i) => {
          const n = nodes[i] as number;
          if (n === 0 || n === -1 || OPTIONAL.has(`${part.type}:${t.name}`)) return;
          // Boards' power and I/O pins may be left unused.
          if (def.floatingFrom !== undefined) return;
          expect(uses.get(n) ?? 0, `${e.id}: ${part.type} ${part.id} ${t.name}`).toBeGreaterThan(1);
        });
      }
      // No terminal sits in the middle of a wire by accident, and wires do not overlap.
      for (const w of doc.wires) {
        for (const part of doc.parts) {
          for (const [x, y] of terminalPoints(part)) {
            const end = (x === w.x1 && y === w.y1) || (x === w.x2 && y === w.y2);
            expect(!end && onSegment(w, x, y), `${e.id}: ${part.type} ${part.id} at ${x},${y} on wire ${w.id}`).toBe(false);
          }
        }
        for (const v of doc.wires) {
          if (v === w) continue;
          const collinear = (w.x1 === w.x2 && v.x1 === v.x2 && w.x1 === v.x1) || (w.y1 === w.y2 && v.y1 === v.y2 && w.y1 === v.y1);
          if (!collinear) continue;
          const [a0, a1] = w.x1 === w.x2 ? [Math.min(w.y1, w.y2), Math.max(w.y1, w.y2)] : [Math.min(w.x1, w.x2), Math.max(w.x1, w.x2)];
          const [b0, b1] = v.x1 === v.x2 ? [Math.min(v.y1, v.y2), Math.max(v.y1, v.y2)] : [Math.min(v.x1, v.x2), Math.max(v.x1, v.x2)];
          expect(Math.min(a1, b1) - Math.max(a0, b0) > 0, `${e.id}: wires ${w.id} and ${v.id} overlap`).toBe(false);
        }
      }
    });
  }
});

describe('example circuits behave', () => {
  it('lights the LED with about 15 mA', async () => {
    const doc = example('led');
    const s = await started(doc);
    run(s, 0.05);
    expect(view(s, partOf(doc, 'led').id).current).toBeGreaterThan(0.013);
    expect(view(s, partOf(doc, 'led').id).current).toBeLessThan(0.016);
  });

  it('divides 12 V to 3.84 V', async () => {
    const doc = example('divider');
    const s = await started(doc);
    run(s, 0.01);
    expect(view(s, partOf(doc, 'voltmeter').id).reading).toBeCloseTo(12 * (4.7 / 14.7), 2);
  });

  it('charges the capacitor with a 0.1 s time constant', async () => {
    const doc = example('rc');
    const s = await started(doc);
    run(s, 0.1);
    const cap = s.scope.traces[1];
    const latest = cap?.since(0).v.at(-1) ?? 0;
    expect(latest).toBeGreaterThan(5 * (1 - Math.exp(-1)) - 0.2);
    expect(latest).toBeLessThan(5 * (1 - Math.exp(-1)) + 0.2);
  });

  it('switches the transistor with the button', async () => {
    const doc = example('transistor');
    const s = await started(doc);
    const led = partOf(doc, 'led').id;
    run(s, 0.01);
    expect(view(s, led).current).toBeLessThan(1e-4);
    s.interact(partOf(doc, 'pushbutton').id, 'press');
    // LED readings are averaged over about 20 ms.
    run(s, 0.1);
    expect(view(s, led).current).toBeGreaterThan(0.012);
  });

  it('amplifies by −4.7', async () => {
    const doc = example('opamp');
    const s = await started(doc);
    run(s, 0.0025 / doc.speed);
    const out = s.scope.traces[1]?.since(0.001).v ?? [];
    expect(Math.max(...out)).toBeGreaterThan(4.5);
    expect(Math.min(...out)).toBeLessThan(-4.5);
  });

  it('blinks with the 555', async () => {
    const doc = example('555');
    const s = await started(doc);
    const led = partOf(doc, 'led').id;
    let changes = 0;
    let lit = false;
    for (let i = 0; i < 60; i++) {
      run(s, 0.05);
      const now = (view(s, led).current as number) > 0.005;
      if (now !== lit) changes++;
      lit = now;
    }
    expect(changes).toBeGreaterThanOrEqual(4);
  });

  it('runs the motor through the relay', async () => {
    const doc = example('relay');
    const s = await started(doc);
    const motor = partOf(doc, 'motor').id;
    run(s, 0.05);
    expect(view(s, motor).speed).toBeLessThan(0.01);
    s.interact(partOf(doc, 'pushbutton').id, 'press');
    run(s, 0.3);
    expect(Math.abs(view(s, motor).speed as number)).toBeGreaterThan(0.1);
  });

  it('adds bits', async () => {
    const doc = example('half-adder');
    const s = await started(doc);
    run(s, 0.01);
    expect(view(s, partOf(doc, 'logic-probe', 0).id).high).toBe(true);
    expect(view(s, partOf(doc, 'logic-probe', 1).id).high).toBe(false);
    s.interact(partOf(doc, 'logic-input', 1).id, 'toggle');
    run(s, 0.01);
    expect(view(s, partOf(doc, 'logic-probe', 0).id).high).toBe(false);
    expect(view(s, partOf(doc, 'logic-probe', 1).id).high).toBe(true);
  });

  it('counts onto the display', async () => {
    const doc = example('counter');
    const s = await started(doc);
    // The clock starts high, so the first count comes straight away: 6 after 2.6 s.
    run(s, 2.6);
    expect(view(s, partOf(doc, 'counter').id).count).toBe(6);
    const lit = (view(s, partOf(doc, 'seven-segment').id).segments as number[]).map((i) => i > 0.005);
    expect(lit).toEqual([true, false, true, true, true, true, true]);
  });

  it('blinks the Uno', async () => {
    const doc = example('uno-blink');
    const s = await started(doc);
    const led = partOf(doc, 'led').id;
    run(s, 0.3);
    expect(view(s, led).current).toBeGreaterThan(0.01);
    run(s, 0.5);
    expect(view(s, led).current).toBeLessThan(1e-4);
  });

  it('reads the button on the Uno', async () => {
    const doc = example('uno-button');
    const s = await started(doc);
    const led = partOf(doc, 'led').id;
    run(s, 0.05);
    expect(view(s, led).current).toBeLessThan(1e-4);
    s.interact(partOf(doc, 'pushbutton').id, 'press');
    run(s, 0.05);
    expect(view(s, led).current).toBeGreaterThan(0.01);
  });

  it('dims with the potentiometer and prints readings', async () => {
    const doc = example('uno-dimmer');
    let printed = '';
    const s = await started(doc, { onSerial: (_id, text) => (printed += text) });
    run(s, 0.6);
    expect(printed).toMatch(/\d/);
    const dim = view(s, partOf(doc, 'led').id).current as number;
    s.adjust(partOf(doc, 'potentiometer').id, 1);
    run(s, 0.3);
    const bright = view(s, partOf(doc, 'led').id).current as number;
    expect(bright).toBeGreaterThan(dim * 1.5);
  });

  it('shows 0 on the Uno seven-segment display', async () => {
    const doc = example('uno-7seg');
    const s = await started(doc);
    run(s, 0.1);
    const lit = (view(s, partOf(doc, 'seven-segment').id).segments as number[]).map((i) => i > 0.005);
    expect(lit).toEqual([true, true, true, true, true, true, false]);
  });

  it('obeys serial commands', async () => {
    const doc = example('uno-serial');
    const s = await started(doc);
    const led = partOf(doc, 'led').id;
    const board = partOf(doc, 'arduino-uno').id;
    run(s, 0.05);
    s.serialSend(board, '1');
    run(s, 0.15);
    expect(view(s, led).current).toBeGreaterThan(0.01);
    s.serialSend(board, '0');
    run(s, 0.3);
    expect(view(s, led).current).toBeLessThan(1e-4);
  });

  it('asks for the desktop app for the ESP32', async () => {
    const doc = example('esp32-demo');
    const problems: string[] = [];
    const s = await started(doc, { onBoardProblem: (_id, message) => problems.push(message) });
    expect(problems.join()).toMatch(/desktop app/);
    expect(s.realTime).toBe(true);
    run(s, 0.01);
    expect(s.failure).toBe('');
  });
});

describe('circuit files and the ESP32 bridge', () => {
  it('reads saved circuits forgivingly', async () => {
    const { parseDoc } = await import('../../src/lib/circuit/netlist');
    const doc = example('uno-blink');
    const round = parseDoc(JSON.parse(JSON.stringify(doc)));
    expect(round?.doc).toEqual(doc);
    const messy = parseDoc({
      parts: [
        { type: 'resistor', x: 1.4, y: 2, props: { r: 'big' } },
        { type: 'warp-drive', x: 0, y: 0 },
      ],
      wires: [{ x1: 0, y1: 0, x2: 0, y2: 0 }],
      dt: 99,
    });
    expect(messy?.dropped).toBe(2);
    expect(messy?.doc.parts[0]).toMatchObject({ type: 'resistor', x: 1, props: { r: 1000 } });
    expect(messy?.doc.dt).toBe(1e-4);
    expect(parseDoc({ nope: true })).toBeNull();
  });

  it('recognises ESP32 flash images', async () => {
    const { espImageKind } = await import('../../src/lib/circuit/esp32');
    const merged = new Uint8Array(0x9000).fill(0xff);
    merged[0x1000] = 0xe9;
    merged[0x8000] = 0xaa;
    merged[0x8001] = 0x50;
    expect(espImageKind(merged)).toBe('merged');
    const app = new Uint8Array([0xe9, 4, 2, 0x20, 0x18, 0x00, 0x0d, 0x40]);
    expect(espImageKind(app)).toBe('app');
    const boot = new Uint8Array([0xe9, 2, 2, 0x20, 0x6c, 0x04, 0x08, 0x40]);
    expect(espImageKind(boot)).toBe('bootloader');
    expect(espImageKind(new Uint8Array([1, 2, 3]))).toBe('unknown');
  });

  it('turns helper messages into pin states and sends inputs once', async () => {
    const { EspMcu } = await import('../../src/lib/circuit/esp32');
    const sent: string[] = [];
    const mcu = new EspMcu({ send: (l) => sent.push(l), flush: () => undefined, stop: () => undefined });
    let text = '';
    mcu.onSerial = (t) => (text += t);
    mcu.receive(['R', 'D 0 1', 'P 0 1', 'W 10 250', 'U 48', 'U 69 0a']);
    expect(mcu.ready).toBe(true);
    expect(mcu.mode(0)).toBe('high');
    expect(mcu.mode(10)).toBe('pwm');
    expect(mcu.duty(10)).toBeCloseTo(0.25);
    expect(mcu.mode(5)).toBe('input');
    expect(text).toBe('Hi\n');
    mcu.setInput(5, true);
    mcu.setInput(5, true);
    mcu.setInput(0, false);
    expect(sent).toEqual(['I 5 1']);
    mcu.receive(['W 10 -1', 'X The ESP32 emulator stopped.']);
    expect(mcu.mode(10)).toBe('input');
    expect(mcu.halted).toMatch(/stopped/);
  });
});
