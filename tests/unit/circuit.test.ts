/** The circuit solver and its element models against hand calculations. */
import { describe, expect, it } from 'vitest';
import { Bjt, Capacitor, Clock, Counter, DIODES, Diode, FlipFlop, Gate, LogicInput, ledModel, Mosfet, OpAmp, Resistor, Timer555, VoltageSource } from '../../src/lib/circuit/elements';
import { Circuit, type Element } from '../../src/lib/circuit/engine';

function wire<T extends Element>(element: T, ...nodes: number[]): T {
  element.nodes = nodes;
  return element;
}

function run(circuit: Circuit, seconds: number): void {
  const steps = Math.round(seconds / circuit.dt);
  for (let i = 0; i < steps; i++) circuit.step();
}

describe('Circuit solver', () => {
  it('charges a capacitor through a resistor', () => {
    const c = new Circuit(2, [wire(new VoltageSource('dc', 5), 1, 0), wire(new Resistor(1000), 1, 2), wire(new Capacitor(1e-6), 2, 0)], 1e-5);
    run(c, 1e-3);
    // Backward Euler after 100 steps of τ/100: 5·(1 − 1.01^−100).
    expect(c.v(2)).toBeCloseTo(5 * (1 - 1.01 ** -100), 3);
    run(c, 9e-3);
    expect(c.v(2)).toBeCloseTo(5, 2);
  });

  it('settles a diode and an LED at their forward voltages', () => {
    const d = wire(new Diode(DIODES.silicon as never), 2, 0);
    const c = new Circuit(2, [wire(new VoltageSource('dc', 5), 1, 0), wire(new Resistor(1000), 1, 2), d], 1e-5);
    c.step();
    expect(c.v(2)).toBeGreaterThan(0.6);
    expect(c.v(2)).toBeLessThan(0.8);
    const led = wire(new Diode(ledModel('red')), 2, 0);
    const c2 = new Circuit(2, [wire(new VoltageSource('dc', 5), 1, 0), wire(new Resistor(220), 1, 2), led], 1e-5);
    run(c2, 0.2);
    expect(c2.v(2)).toBeCloseTo(1.87, 1);
    expect(led.average).toBeCloseTo((5 - c2.v(2)) / 220, 3);
  });

  it('switches transistors on and off', () => {
    // NPN low-side switch with base drive: saturated.
    const q = wire(new Bjt(false), 3, 2, 0);
    const npn = new Circuit(3, [wire(new VoltageSource('dc', 5), 1, 0), wire(new Resistor(1000), 1, 2), wire(new Resistor(1000), 1, 3), q], 1e-5);
    run(npn, 1e-4);
    expect(npn.v(3)).toBeLessThan(0.3);
    expect(q.collector).toBeGreaterThan(0.004);
    // N-channel MOSFET: gate high conducts, gate low blocks.
    const gate = wire(new VoltageSource('dc', 5), 2, 0);
    const m = new Circuit(3, [wire(new VoltageSource('dc', 5), 1, 0), gate, wire(new Resistor(100), 1, 3), wire(new Mosfet(false, 1.5, 0.5), 3, 2, 0)], 1e-5);
    run(m, 1e-4);
    expect(m.v(3)).toBeLessThan(0.5);
    gate.amplitude = 0;
    run(m, 1e-4);
    expect(m.v(3)).toBeCloseTo(5, 2);
  });

  it('amplifies with an op-amp and limits at the rails', () => {
    const vin = wire(new VoltageSource('dc', 1), 1, 0);
    const c = new Circuit(3, [vin, wire(new Resistor(10_000), 1, 2), wire(new Resistor(100_000), 2, 3), wire(new OpAmp(15, -15, 1.5), 0, 2, 3)], 1e-5);
    c.step();
    expect(c.v(3)).toBeCloseTo(-10, 2);
    vin.amplitude = 3;
    c.step();
    expect(c.v(3)).toBeCloseTo(-13.5, 1);
  });

  it('runs a 555 astable near its design frequency', () => {
    // Nodes: 1 VCC, 2 between R1 and R2 (DIS), 3 THR/TRIG/C, 4 OUT, 5 CTRL.
    const t = wire(new Timer555(), 0, 3, 4, 1, 5, 3, 2, 1);
    const c = new Circuit(
      5,
      [wire(new VoltageSource('dc', 9), 1, 0), wire(new Resistor(1000), 1, 2), wire(new Resistor(10_000), 2, 3), wire(new Capacitor(10e-6), 3, 0), wire(new Capacitor(10e-9), 5, 0), t],
      5e-5,
    );
    let edges = 0;
    let last = false;
    for (let i = 0; i < 2 / c.dt; i++) {
      c.step();
      if (t.high && !last) edges++;
      last = t.high;
    }
    // f = 1.44 / ((R1 + 2 R2) C) ≈ 6.9 Hz; the first cycle is longer (C charges from 0 V).
    expect(edges).toBeGreaterThanOrEqual(12);
    expect(edges).toBeLessThanOrEqual(15);
  });

  it('runs logic: gates, flip-flops and a counter', () => {
    const a = wire(new LogicInput(true), 1);
    const b = wire(new LogicInput(false), 2);
    const and = wire(new Gate('and', 2), 1, 2, 3);
    const nand = wire(new Gate('nand', 2), 1, 2, 4);
    const clock = wire(new Clock(1000), 5);
    const counter = wire(new Counter(16), 5, 0, 6, 7, 8, 9);
    const t = wire(new FlipFlop('t'), 1, 5, 10, 11);
    const c = new Circuit(11, [a, b, and, nand, clock, counter, t], 1e-5);
    run(c, 0.0102);
    expect(c.v(3)).toBeLessThan(0.5);
    expect(c.v(4)).toBeGreaterThan(4.5);
    expect(counter.count).toBe(11);
    expect(t.q).toBe(true);
    b.high = true;
    run(c, 1e-4);
    expect(c.v(3)).toBeGreaterThan(4.5);
  });
});

describe('Arduino Uno emulation', () => {
  const example = async (id: string) => {
    const { AVR_EXAMPLES: UNO_EXAMPLES } = await import('../../src/lib/circuit/avr-examples');
    const { AvrMcu: UnoMcu } = await import('../../src/lib/circuit/avr');
    const found = UNO_EXAMPLES.find((e) => e.id === id);
    if (!found) throw new Error(id);
    return UnoMcu.fromHex(found.hex);
  };

  it('blinks pin 13 every half second', async () => {
    const mcu = await example('blink');
    mcu.runUntil(0.25);
    expect(mcu.mode(13)).toBe('high');
    mcu.runUntil(0.75);
    expect(mcu.mode(13)).toBe('low');
    mcu.runUntil(1.25);
    expect(mcu.mode(13)).toBe('high');
  });

  it('prints on the serial port, reads input and the ADC', async () => {
    const control = await example('serial-control');
    let text = '';
    control.onSerial = (t) => {
      text += t;
    };
    control.runUntil(0.05);
    expect(text).toContain('Type 1 or 0');
    control.serialSend('1');
    for (let t = 0.05; t < 0.2; t += 0.001) control.runUntil(t);
    expect(text).toContain('LED on');
    expect(control.mode(13)).toBe('high');

    const dimmer = await example('dimmer');
    let printed = '';
    dimmer.onSerial = (t) => {
      printed += t;
    };
    dimmer.setAnalog(14, 2.5);
    dimmer.runUntil(0.3);
    expect(printed).toMatch(/A0 = 51[0-2]/);
    expect(printed).toContain('2.50 V');
    // PWM on pin 9 at about half duty: count the time it is high.
    let high = 0;
    let samples = 0;
    for (let t = 0.3; t < 0.35; t += 20e-6) {
      dimmer.runUntil(t);
      samples++;
      if (dimmer.mode(9) === 'high') high++;
    }
    expect(high / samples).toBeGreaterThan(0.4);
    expect(high / samples).toBeLessThan(0.6);
  });

  it('reads a button through the pull-up', async () => {
    const mcu = await example('button');
    mcu.runUntil(0.02);
    expect(mcu.mode(2)).toBe('pullup');
    mcu.setInput(2, true);
    mcu.runUntil(0.05);
    expect(mcu.mode(13)).toBe('low');
    mcu.setInput(2, false);
    mcu.runUntil(0.08);
    expect(mcu.mode(13)).toBe('high');
  });
});
