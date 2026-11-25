/**
 * Recording the simulated Arduino Uno's pins as a logic capture: what the Circuit Simulator
 * hands to the Logic Analyser.
 */
import { describe, expect, it } from 'vitest';
import { AvrMcu as UnoMcu } from '../../src/lib/circuit/avr';
import { AVR_EXAMPLES as UNO_EXAMPLES } from '../../src/lib/circuit/avr-examples';
import { asText, type Capture, decodeUart, guessBaud, lineOf, measure, readVcd, writeVcd } from '../../src/lib/logic';

const example = (id: string) => UNO_EXAMPLES.find((e) => e.id === id)?.hex ?? '';

async function recorded(id: string, seconds: number, prepare?: (mcu: UnoMcu) => void): Promise<{ capture: Capture; printed: string }> {
  const mcu = await UnoMcu.fromHex(example(id));
  let printed = '';
  mcu.onSerial = (text) => {
    printed += text;
  };
  prepare?.(mcu);
  // Let the sketch start, then record.
  mcu.runUntil(0.05);
  printed = '';
  let capture: Capture | null = null;
  mcu.record(seconds, (taken) => {
    capture = taken;
  });
  // The circuit runs its boards a slice at a time; the recording ends inside one of them.
  for (let t = 0.05; t < 0.05 + seconds + 0.02; t += 0.004) mcu.runUntil(t);
  if (!capture) throw new Error('The recording did not finish.');
  return { capture, printed };
}

describe('recording the pins of the simulated Arduino Uno', () => {
  it('records the blinking LED on pin 13 to the processor cycle', async () => {
    const { capture } = await recorded('blink', 1.2);
    expect(capture.names).toHaveLength(14);
    expect(capture.names[13]).toBe('D13');
    expect(capture.tick).toBe(1 / 16e6);
    expect(capture.length).toBe(1.2 * 16e6);
    const led = lineOf(capture, 13);
    // Half a second on, half a second off: two changes in 1.2 s, half a second apart (to within a millisecond).
    expect(led.edges.length).toBe(2);
    expect(((led.edges[1] as number) - (led.edges[0] as number)) * capture.tick).toBeCloseTo(0.5, 2);
    // Nothing else moves.
    for (const pin of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) expect(lineOf(capture, pin).edges.length, `pin ${pin}`).toBe(0);
  });

  it('records PWM, and draws what the sketch prints on the serial pin', async () => {
    // The dimmer reads A0 and sets pin 9's PWM to a quarter of the reading: 2.5 V of 5 V is half on.
    const { capture, printed } = await recorded('dimmer', 0.6, (mcu) => mcu.setAnalog(14, 2.5));
    const pwm = measure(lineOf(capture, 9), 0, capture.length, capture.tick);
    expect(pwm.frequency).toBeGreaterThan(400);
    expect(pwm.frequency).toBeLessThan(600);
    expect(pwm.duty).toBeGreaterThan(0.45);
    expect(pwm.duty).toBeLessThan(0.55);
    // The serial line: found to be 9600 baud, and it reads as the text the serial monitor got.
    expect(printed).toContain('A0 = 51');
    expect(guessBaud(capture, 1)).toBe(9600);
    const bytes = decodeUart(capture, { rx: 1, baud: 9600, bits: 8, parity: 'none', stop: 1, inverted: false }).packets.flatMap((packet) => [...packet.out]);
    const text = String.fromCharCode(...bytes);
    expect(text.length).toBeGreaterThan(20);
    expect(printed).toContain(text.trim().split('\r\n')[0] as string);
    expect(asText(bytes)).toContain('A0 = 51');
    // As a VCD file, which is how it reaches the Logic Analyser, it reads back the same.
    const back = readVcd(writeVcd(capture));
    expect(back.names).toEqual([...capture.names]);
    expect(back.times.length).toBe(capture.times.length);
    expect(guessBaud(back, 1)).toBe(9600);
  });
});
