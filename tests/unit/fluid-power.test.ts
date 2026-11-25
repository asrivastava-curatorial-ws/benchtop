import { describe, expect, it } from 'vitest';
import { type Circuit, EXAMPLES, initialState, type SimState, step, toggle } from '../../src/lib/fluid-power';

function sim(name: string) {
  const make = EXAMPLES[name];
  if (!make) throw new Error(name);
  const circuit: Circuit = make();
  let state: SimState = initialState(circuit);
  const run = (seconds: number, pressed: string[] = []) => {
    for (let t = 0; t < seconds; t += 0.02) state = step(circuit, state, 0.02, new Set(pressed));
    return state;
  };
  return { circuit, run, toggle: (id: string) => (state = toggle(state, id)), x: () => state.cylinders.cyl ?? 0, state: () => state };
}

describe('pneumatic and hydraulic circuits', () => {
  it('a push button drives a single-acting cylinder out, and its spring brings it back', () => {
    const c = sim('Single-acting cylinder, push button');
    c.run(0.5);
    expect(c.x()).toBe(0);
    c.run(1.2, ['v1:left']);
    expect(c.x()).toBe(1);
    expect(c.state().pressure['cyl:A']).toBe(1);
    c.run(1.2);
    expect(c.x()).toBe(0);
    expect(c.state().pressure['cyl:A']).toBe(0);
  });

  it('meter-out flow controls slow the stroke', () => {
    const c = sim('Double-acting cylinder, speed control');
    c.run(0.2);
    c.toggle('v1:left');
    c.run(1.5);
    // 1 s stroke at full flow, throttled to 35 %: about 2.9 s to go out.
    expect(c.x()).toBeGreaterThan(0.45);
    expect(c.x()).toBeLessThan(0.6);
    c.run(2);
    expect(c.x()).toBe(1);
  });

  it('a double-pilot valve remembers the last signal', () => {
    const c = sim('Indirect control (memory valve)');
    c.run(0.1, ['b1:left']);
    c.run(1.5);
    expect(c.x()).toBe(1);
    c.run(0.1, ['b2:left']);
    c.run(1.5);
    expect(c.x()).toBe(0);
  });

  it('the two-pressure valve needs both hands', () => {
    const c = sim('Two-hand safety (AND)');
    c.run(1.5, ['b1:left']);
    expect(c.x()).toBe(0);
    c.run(1.5, ['b1:left', 'b2:left']);
    expect(c.x()).toBe(1);
  });

  it('roller valves at each end make the cylinder go back and forth', () => {
    const c = sim('Automatic back and forth (rollers)');
    let max = 0;
    let backAfterMax = false;
    for (let i = 0; i < 200; i++) {
      c.run(0.02);
      max = Math.max(max, c.x());
      if (max === 1 && c.x() < 0.5) backAfterMax = true;
    }
    expect(max).toBe(1);
    expect(backAfterMax).toBe(true);
  });

  it('a tandem-centre valve holds the cylinder where it stopped', () => {
    const c = sim('Hydraulic press (4/3 tandem centre)');
    c.toggle('v1:left');
    c.run(1);
    const there = c.x();
    expect(there).toBeGreaterThan(0.3);
    c.toggle('v1:left');
    c.run(1);
    expect(c.x()).toBeCloseTo(there, 9);
    expect(c.state().positions.v1).toBe(1);
  });
});
