/**
 * An Arduino Uno with the Logic Probe sketch on it, emulated (avr8js), with
 * the demo capture's first six lines played over and over on its pins 8 to
 * 13.  It lets the Logic Analyser's capture from a device be tried, and
 * tested, without a board: the bytes go to the real firmware and come back
 * from it.
 */
import { parseIntelHex } from './circuit/firmware-files';
import { type Capture, demoCapture } from './logic';
import { LOGIC_PROBE_HEX } from './logic-probe';
import { ByteQueue, type SumpLink } from './sump';

const FREQUENCY = 16_000_000;

export interface SimulatedProbe extends SumpLink {
  close(): void;
}

/** Starts the emulated board; `signal` is what its pins see (the demo capture by default), repeated without end. */
export async function simulatedProbe(signal: Capture = demoCapture()): Promise<SimulatedProbe> {
  const avr = await import('avr8js');
  const cpu = new avr.CPU(new Uint16Array(parseIntelHex(LOGIC_PROBE_HEX, 0x8000).buffer));
  new avr.AVRTimer(cpu, avr.timer0Config);
  new avr.AVRTimer(cpu, avr.timer1Config);
  new avr.AVRTimer(cpu, avr.timer2Config);
  const pins = new avr.AVRIOPort(cpu, avr.portBConfig);
  const usart = new avr.AVRUSART(cpu, avr.usart0Config, FREQUENCY);
  new avr.AVRClock(cpu, FREQUENCY, avr.clockConfig);
  const incoming = new ByteQueue();
  const pending: number[] = [];
  let sent: number[] = [];
  usart.onByteTransmit = (value: number) => sent.push(value);

  // The signal's changes, at the processor cycle each falls on.  It plays over and over, and begins anew
  // a moment after each capture is asked for, as a board does when its button is pressed: a capture then
  // always catches the traffic from its beginning.
  const perTick = signal.tick * FREQUENCY;
  const period = Math.max(1, Math.round(signal.length * perTick));
  const RESTART_AFTER = 4800;
  let index = 0;
  let base = 0;
  const apply = (state: number) => {
    for (let bit = 0; bit < 6; bit++) pins.setPin(bit, ((state >> bit) & 1) === 1);
  };
  const next = () => {
    apply(signal.states[index] as number);
    index++;
    if (index >= signal.times.length) {
      index = 0;
      base += period;
    }
    cpu.addClockEvent(next, Math.max(1, base + Math.round((signal.times[index] as number) * perTick) - cpu.cycles));
  };
  const restart = () => {
    cpu.clearClockEvent(next);
    index = 0;
    base = cpu.cycles + RESTART_AFTER;
    apply(signal.states[0] as number);
    cpu.addClockEvent(next, RESTART_AFTER);
  };
  next();

  /** A byte with this bit set is the command that starts a capture. */
  const RUN = 0x100;
  const step = () => {
    // About 12 ms of the board's time at a go; a slow computer simply runs it slower than life.
    const target = cpu.cycles + 200_000;
    while (cpu.cycles < target) {
      if (pending.length && !usart.rxBusy) {
        const byte = pending.shift() as number;
        if (byte & RUN) restart();
        usart.writeByte(byte & 0xff);
      }
      avr.avrInstruction(cpu);
      cpu.tick();
    }
    if (sent.length) {
      incoming.push(Uint8Array.from(sent));
      sent = [];
    }
  };
  const timer = setInterval(step, 4);
  return {
    incoming,
    write: async (bytes) => {
      // The client sends each command by itself: a lone 0x01 is "run".
      if (bytes.length === 1 && bytes[0] === 0x01) pending.push(RUN | 0x01);
      else pending.push(...bytes);
    },
    close: () => clearInterval(timer),
  };
}
