/**
 * The Logic Probe firmware, run in an emulated ATmega328P (avr8js) and driven by the same
 * SUMP client the Logic Analyser uses: what the two say to each other, and whether the
 * firmware samples at the rate it is asked for, cycle for cycle.
 */
import { readFileSync } from 'node:fs';
import { AVRClock, AVRIOPort, AVRTimer, AVRUSART, avrInstruction, CPU, clockConfig, portBConfig, timer0Config, timer1Config, timer2Config, usart0Config } from 'avr8js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseIntelHex } from '../../src/lib/circuit/firmware-files';
import { decodeI2c, decodeSpi, fromSamples, lineOf } from '../../src/lib/logic';
import { LOGIC_PROBE_HEX, LOGIC_PROBE_SKETCH } from '../../src/lib/logic-probe';
import { simulatedProbe } from '../../src/lib/logic-probe-sim';
import { ByteQueue, readSumpMetadata, type SumpDevice, type SumpLink, sumpCapture, sumpIdentify, sumpSetup } from '../../src/lib/sump';

const FREQUENCY = 16e6;

class Board implements SumpLink {
  readonly incoming = new ByteQueue();
  readonly cpu: CPU;
  readonly pins: AVRIOPort;
  private readonly usart: AVRUSART;
  private readonly pending: number[] = [];
  private sent: number[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly waves: { bit: number; half: number; start: number; first: boolean; level: boolean }[] = [];

  constructor() {
    this.cpu = new CPU(new Uint16Array(parseIntelHex(LOGIC_PROBE_HEX, 0x8000).buffer));
    new AVRTimer(this.cpu, timer0Config);
    new AVRTimer(this.cpu, timer1Config);
    new AVRTimer(this.cpu, timer2Config);
    this.pins = new AVRIOPort(this.cpu, portBConfig);
    this.usart = new AVRUSART(this.cpu, usart0Config, FREQUENCY);
    this.usart.onByteTransmit = (value) => this.sent.push(value);
    new AVRClock(this.cpu, FREQUENCY, clockConfig);
  }

  async write(bytes: Uint8Array): Promise<void> {
    this.pending.push(...bytes);
  }

  /** Runs the processor, handing it the bytes that wait as fast as its serial port takes them. */
  run(cycles: number): void {
    const target = this.cpu.cycles + cycles;
    while (this.cpu.cycles < target) {
      if (this.pending.length && !this.usart.rxBusy) this.usart.writeByte(this.pending.shift() as number);
      avrInstruction(this.cpu);
      this.cpu.tick();
      for (const wave of this.waves) {
        const level = Math.floor((this.cpu.cycles - wave.start) / wave.half) % 2 === 1 ? !wave.first : wave.first;
        if (level !== wave.level) {
          wave.level = level;
          this.pins.setPin(wave.bit, level);
        }
      }
    }
    if (this.sent.length) {
      this.incoming.push(Uint8Array.from(this.sent));
      this.sent = [];
    }
  }

  /** Keeps the board running while the client waits for it: 25 ms of its time every millisecond or so. */
  power(on: boolean): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = on ? setInterval(() => this.run(400_000), 1) : null;
  }

  /**
   * A square wave on one of pins 8 to 13, changing every `half` processor cycles.  The level is worked out from the
   * cycle count after every instruction, so each change lands at the end of the instruction it falls in, exactly
   * as a pin would.  (Clock events would not do: avr8js handles one per instruction, so two waves changing in the
   * same instruction would put one of them off by an instruction.)
   */
  wave(bit: number, half: number, level = false): void {
    this.pins.setPin(bit, level);
    this.waves.push({ bit, half, start: this.cpu.cycles, first: level, level });
  }
}

/** The lengths of a line's stretches between edges, in samples, without the cut-off first and last. */
const runs = (samples: Uint8Array | Uint16Array, bit: number) => {
  const edges = lineOf(fromSamples(samples, 1, ['a', 'b', 'c', 'd', 'e', 'f']), bit).edges;
  return [...edges].slice(1).map((at, i) => at - (edges[i] as number));
};

describe('the SUMP client', () => {
  it('reads a device’s description, and waits for the whole of it', () => {
    const text = (s: string) => [...new TextEncoder().encode(s), 0];
    const full = Uint8Array.from([0x01, ...text('Open Logic Sniffer v1.01'), 0x02, ...text('3.07'), 0x21, 0, 0, 0x60, 0, 0x23, 0x0b, 0xeb, 0xc2, 0, 0x40, 32, 0x41, 2, 0x00, 99]);
    expect(readSumpMetadata(full)).toEqual({ device: { name: 'Open Logic Sniffer v1.01', version: '3.07', probes: 32, memory: 24576, maxRate: 200_000_000 }, used: full.length - 1 });
    // Cut short anywhere, it is not there yet.
    for (const cut of [1, 5, 27, 31, 35, full.length - 2]) expect(readSumpMetadata(full.subarray(0, cut)), `cut at ${cut}`).toBeNull();
    expect(readSumpMetadata(Uint8Array.from([0xe0, 1]))).toBeNull();
  });

  it('turns a request into the device’s own terms', () => {
    const device: SumpDevice = { name: '', version: '', probes: 6, memory: 1536, maxRate: 2_000_000 };
    const setup = sumpSetup(device, { rate: 1_000_000, samples: 1000, lines: 8, triggerMask: 0b10, triggerValue: 0b10 });
    expect(setup.rate).toBe(1_000_000);
    expect(setup.samples).toBe(1000);
    expect(setup.commands.map((c) => [...c])).toEqual([
      [0x80, 99, 0, 0, 0],
      [0x81, 249, 0, 249, 0],
      [0x82, 0x38, 0, 0, 0],
      [0xc0, 2, 0, 0, 0],
      [0xc1, 2, 0, 0, 0],
      [0xc2, 0, 0, 0, 8],
    ]);
    // No more than the device's memory; a rate its clock cannot divide to becomes the nearest it can.
    expect(sumpSetup(device, { rate: 300_000, samples: 99_999, lines: 8, triggerMask: 0, triggerValue: 0 })).toMatchObject({ samples: 1536, rate: 100_000_000 / 333 });
    expect(sumpSetup({ ...device, memory: 0 }, { rate: 10, samples: 3, lines: 16, triggerMask: 0, triggerValue: 0 })).toMatchObject({ samples: 4, rate: 10 });
  });

  it('hands out bytes as they are asked for, and gives up when none come', async () => {
    const queue = new ByteQueue();
    queue.push(Uint8Array.from([1, 2, 3]));
    queue.push(Uint8Array.from([4, 5]));
    expect([...queue.takeNow(2)]).toEqual([1, 2]);
    expect(queue.length).toBe(3);
    setTimeout(() => queue.push(Uint8Array.from([6, 7, 8])), 20);
    expect([...(await queue.take(5, 500))]).toEqual([3, 4, 5, 6, 7]);
    await expect(queue.take(4, 60)).rejects.toThrow('timeout after 1 of 4 bytes');
    await expect(queue.take(4, 5000, () => true)).rejects.toThrow('stopped');
  });
});

describe('the Logic Probe firmware in an emulated Arduino Uno', () => {
  let board: Board;
  let device: SumpDevice;
  beforeEach(async () => {
    board = new Board();
    board.power(true);
    device = await sumpIdentify(board, 3000);
  });
  afterEach(() => board.power(false));

  it('says what it is', () => {
    expect(device).toEqual({ name: 'Benchtop Logic Probe', version: '1.0', probes: 6, memory: 1536, maxRate: 2_000_000 });
    // The sketch offered in the app is the one in firmware/avr (sh firmware/avr/build-probe.sh brings the two in step).
    expect(LOGIC_PROBE_SKETCH).toBe(readFileSync(new URL('../../firmware/avr/logic-probe/logic-probe.ino', import.meta.url), 'utf8'));
  });

  it('samples every 8 cycles at 2 MHz and every 16 at 1 MHz, exactly', async () => {
    // Pin 8 changes every 160 cycles (10 µs), pin 10 every 1000 cycles.
    board.wave(0, 160);
    board.wave(2, 1000, true);
    const fast = await sumpCapture(board, device, { rate: 2_000_000, samples: 1536, lines: 8, triggerMask: 0, triggerValue: 0 });
    expect(fast.rate).toBe(2_000_000);
    expect(fast.samples.length).toBe(1536);
    expect(new Set(runs(fast.samples, 0))).toEqual(new Set([20]));
    expect(new Set(runs(fast.samples, 2))).toEqual(new Set([125]));
    const slower = await sumpCapture(board, device, { rate: 1_000_000, samples: 1000, lines: 8, triggerMask: 0, triggerValue: 0 });
    expect(slower.samples.length).toBe(1000);
    expect(new Set(runs(slower.samples, 0))).toEqual(new Set([10]));
    // Only the six pins are reported.
    expect(slower.samples.every((word) => word < 64)).toBe(true);
  });

  it('keeps time by its timer at lower rates', async () => {
    // The timer is watched in a loop three cycles long, so a sample may be up to 0.2 µs late: a change that falls
    // right at a sample can be counted to either side, but the samples do not drift.
    const steady = (lengths: number[], expected: number) => {
      expect(lengths.length).toBeGreaterThan(8);
      expect(lengths.every((length) => Math.abs(length - expected) <= 1)).toBe(true);
      expect(lengths.reduce((sum, length) => sum + length, 0) / lengths.length).toBeCloseTo(expected, 0);
    };
    // 100 kHz: a sample every 160 cycles.  Pin 9 changes every 1600 cycles: ten samples.
    board.wave(1, 1600);
    const tenth = await sumpCapture(board, device, { rate: 100_000, samples: 400, lines: 8, triggerMask: 0, triggerValue: 0 });
    steady(runs(tenth.samples, 1), 10);
    // 500 kHz, the fastest the timer does: every 32 cycles, so 50 samples to a change.
    const half = await sumpCapture(board, device, { rate: 500_000, samples: 600, lines: 8, triggerMask: 0, triggerValue: 0 });
    steady(runs(half.samples, 1), 50);
  });

  it('counts with a prescaler for slow rates', async () => {
    // 1 kHz: every 16 000 cycles.  Pin 11 changes every 80 000: five samples.
    board.wave(3, 80_000);
    const slow = await sumpCapture(board, device, { rate: 1000, samples: 64, lines: 8, triggerMask: 0, triggerValue: 0 });
    expect(slow.rate).toBe(1000);
    expect(new Set(runs(slow.samples, 3))).toEqual(new Set([5]));
    // 100 Hz needs the timer to count every eighth cycle: 160 000 cycles a sample, pin 12 changing every 480 000.
    board.wave(4, 480_000);
    const slower = await sumpCapture(board, device, { rate: 100, samples: 24, lines: 8, triggerMask: 0, triggerValue: 0 });
    expect(new Set(runs(slower.samples, 4))).toEqual(new Set([3]));
  }, 20_000);

  it('waits for its trigger, and can be told to stop waiting', async () => {
    const states: (string | number)[] = [];
    // Pin 9 high starts the capture; it rises a little while after the capture is asked for.
    setTimeout(() => board.pins.setPin(1, true), 150);
    const taken = await sumpCapture(board, device, { rate: 1_000_000, samples: 200, lines: 8, triggerMask: 0b10, triggerValue: 0b10 }, (state) => states.push(state));
    expect(states[0]).toBe('waiting');
    expect(states[states.length - 1]).toBe(1);
    expect(taken.samples.every((word) => (word & 0b10) !== 0)).toBe(true);
    // A trigger that never comes: the capture is stopped, and the board answers again afterwards.
    let stop = false;
    setTimeout(() => {
      stop = true;
    }, 200);
    await expect(sumpCapture(board, device, { rate: 1_000_000, samples: 200, lines: 8, triggerMask: 0b1, triggerValue: 0b1 }, undefined, () => stop)).rejects.toThrow('The capture was stopped.');
    expect((await sumpIdentify(board, 2000)).name).toBe('Benchtop Logic Probe');
    // A slow capture is given up the same way.
    stop = false;
    setTimeout(() => {
      stop = true;
    }, 150);
    await expect(sumpCapture(board, device, { rate: 10, samples: 1536, lines: 8, triggerMask: 0, triggerValue: 0 }, undefined, () => stop)).rejects.toThrow('The capture was stopped.');
    expect((await sumpIdentify(board, 2000)).name).toBe('Benchtop Logic Probe');
  }, 20_000);

  it('captures the demo signals as the simulated probe plays them, and they decode', async () => {
    board.power(false);
    const probe = await simulatedProbe();
    try {
      const found = await sumpIdentify(probe, 3000);
      expect(found.name).toBe('Benchtop Logic Probe');
      const names = ['SCL', 'SDA', 'CLK', 'MOSI', 'MISO', 'CS'];
      // The signals begin anew a moment after a capture is asked for, so every capture sees the same traffic.
      for (let round = 0; round < 3; round++) {
        const taken = await sumpCapture(probe, found, { rate: 1_000_000, samples: 1536, lines: 8, triggerMask: 0, triggerValue: 0 });
        const capture = fromSamples(taken.samples, taken.rate, names);
        expect(decodeI2c(capture, { scl: 0, sda: 1 }).packets.map((p) => [p.title, [...p.out]])).toEqual([
          ['Write to 0x3C', [0x00, 0xaf]],
          ['Read from 0x48', [0x19, 0x80]],
        ]);
        expect(decodeSpi(capture, { clk: 2, mosi: 3, miso: 4, cs: 5, mode: 0, bits: 8, msbFirst: true, csActiveLow: true }).packets[0]).toMatchObject({
          out: [0x9f, 0, 0, 0],
          in: [0xff, 0xef, 0x40, 0x18],
        });
      }
      // With a trigger on the I²C start (the clock on pin 8 high, the data line on pin 9 low) the capture begins there:
      // the start itself is just before the first sample, and the read after the repeated start is whole.
      const triggered = await sumpCapture(probe, found, { rate: 1_000_000, samples: 1536, lines: 8, triggerMask: 0b11, triggerValue: 0b01 });
      const capture = fromSamples(triggered.samples, triggered.rate, names);
      expect((triggered.samples[0] as number) & 0b11).toBe(0b01);
      expect(decodeI2c(capture, { scl: 0, sda: 1 }).packets.map((p) => [p.title, [...p.out]])).toEqual([['Read from 0x48', [0x19, 0x80]]]);
    } finally {
      probe.close();
    }
  }, 30_000);

  it('reports nothing where no device answers', async () => {
    const silent: SumpLink = { incoming: new ByteQueue(), write: async () => undefined };
    await expect(sumpIdentify(silent, 600)).rejects.toThrow(/No logic analyser answered/);
  });
});
