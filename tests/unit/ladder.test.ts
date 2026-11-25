import { describe, expect, it } from 'vitest';
import { emptyState, normalise, type PlcState, parseProgram, scan, structuredText } from '../../src/lib/ladder';

function run(text: string) {
  const program = parseProgram(text);
  expect(program.errors).toEqual([]);
  let state: PlcState = emptyState();
  const step = (inputs: Record<string, boolean>, ms = 10, times = 1) => {
    state = { ...state, inputs: { ...state.inputs, ...inputs } };
    for (let i = 0; i < times; i++) state = scan(program, state, ms).state;
    return state;
  };
  return { program, step, get: (a: string) => state.bits[a] === true, state: () => state };
}

describe('PLC ladder logic', () => {
  it('reads addresses, names and rungs, and explains mistakes', () => {
    expect(normalise('q0.3')).toBe('Q0.3');
    expect(normalise('M15.7')).toBe('M15.7');
    expect(normalise('I4.0')).toBeNull();
    expect(normalise('T31')).toBe('T31');
    const bad = parseProgram('Start = I0.0\nStart & Ghost -> Q0.0\nI0.1 Q0.1\nI0.2 -> TON T0\nI0.3 -> TON Q0.0 2s\n!(I0.0 | I0.1) -> Q0.2');
    expect(bad.errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6]);
    expect(bad.errors[0]?.message).toContain('Ghost');
  });

  it('runs a start–stop seal-in circuit', () => {
    const plc = run('Start = I0.0\nStop = I0.1\nMotor = Q0.0\n(Start | Motor) & !Stop -> Motor  # seal in');
    plc.step({ Start: false });
    expect(plc.get('Q0.0')).toBe(false);
    plc.step({ 'I0.0': true });
    expect(plc.get('Q0.0')).toBe(true);
    plc.step({ 'I0.0': false });
    expect(plc.get('Q0.0')).toBe(true);
    plc.step({ 'I0.1': true });
    expect(plc.get('Q0.0')).toBe(false);
    plc.step({ 'I0.1': false });
    expect(plc.get('Q0.0')).toBe(false);
  });

  it('times with on-delay, off-delay and pulse timers', () => {
    const plc = run('I0.0 -> TON T0 1s\nT0 -> Q0.0\nI0.1 -> TOF T1 500ms\nT1 -> Q0.1\nI0.2 -> TP T2 300ms\nT2 -> Q0.2');
    plc.step({ 'I0.0': true }, 100, 9);
    expect(plc.get('Q0.0')).toBe(false);
    plc.step({}, 100, 2);
    expect(plc.get('Q0.0')).toBe(true);
    plc.step({ 'I0.0': false });
    expect(plc.get('Q0.0')).toBe(false);
    plc.step({ 'I0.1': true }, 100);
    expect(plc.get('Q0.1')).toBe(true);
    plc.step({ 'I0.1': false }, 100, 4);
    expect(plc.get('Q0.1')).toBe(true);
    plc.step({}, 100, 2);
    expect(plc.get('Q0.1')).toBe(false);
    plc.step({ 'I0.2': true }, 100);
    expect(plc.get('Q0.2')).toBe(true);
    plc.step({ 'I0.2': false }, 100, 2);
    expect(plc.get('Q0.2')).toBe(true);
    plc.step({}, 100, 2);
    expect(plc.get('Q0.2')).toBe(false);
  });

  it('counts rising edges, resets counters, sets and resets bits', () => {
    const plc = run('I0.0^ -> CTU C0 3\nC0 -> Q0.0\nI0.1 -> RES C0\nI0.2 -> S M0.0\nI0.3 -> R M0.0\nM0.0 -> Q0.1\nI0.4v -> Q0.2');
    for (let i = 0; i < 3; i++) {
      plc.step({ 'I0.0': true });
      plc.step({ 'I0.0': false });
    }
    expect(plc.state().counters.C0?.count).toBe(3);
    expect(plc.get('Q0.0')).toBe(true);
    // The reset rung comes after the rung that reads C0, so the lamp goes out one scan later, as on a real PLC.
    plc.step({ 'I0.1': true });
    expect(plc.state().counters.C0?.count).toBe(0);
    plc.step({});
    expect(plc.get('Q0.0')).toBe(false);
    plc.step({ 'I0.1': false, 'I0.2': true });
    plc.step({ 'I0.2': false });
    expect(plc.get('Q0.1')).toBe(true);
    plc.step({ 'I0.3': true });
    expect(plc.get('Q0.1')).toBe(false);
    plc.step({ 'I0.4': true });
    expect(plc.get('Q0.2')).toBe(false);
    plc.step({ 'I0.4': false });
    expect(plc.get('Q0.2')).toBe(true);
    plc.step({});
    expect(plc.get('Q0.2')).toBe(false);
  });

  it('writes structured text', () => {
    const text = structuredText(parseProgram('Start = I0.0\nStop = I0.1\n(Start | Q0.0) & !Stop -> Q0.0\nQ0.0 -> TON T0 2s'));
    expect(text).toContain('Q0_0 := (Start OR Q0_0) AND NOT Stop;');
    expect(text).toContain('T0(IN := Q0_0, PT := T#2000MS);');
  });
});
