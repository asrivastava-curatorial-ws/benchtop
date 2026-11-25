/**
 * The SUMP protocol, which logic analysers on a serial port speak: the Open
 * Bench Logic Sniffer, analyser firmware for Arduino, ESP32 and Pico boards,
 * the Bus Pirate, and Benchtop's own Logic Probe sketch for the Arduino Uno.
 * The device is told a sample rate, a number of samples and a trigger, takes
 * the capture into its own memory, and sends it back newest sample first.
 */

/** Bytes arriving from a port, to be taken in the amounts a protocol asks for. */
export class ByteQueue {
  private chunks: Uint8Array[] = [];
  private size = 0;
  private wake: (() => void) | null = null;

  push(bytes: Uint8Array): void {
    if (!bytes.length) return;
    this.chunks.push(bytes);
    this.size += bytes.length;
    this.wake?.();
  }

  get length(): number {
    return this.size;
  }

  clear(): void {
    this.chunks = [];
    this.size = 0;
  }

  /** Up to `count` bytes that are already here. */
  takeNow(count: number): Uint8Array {
    const out = new Uint8Array(Math.min(count, this.size));
    let at = 0;
    while (at < out.length) {
      const chunk = this.chunks[0] as Uint8Array;
      const part = chunk.subarray(0, out.length - at);
      out.set(part, at);
      at += part.length;
      if (part.length === chunk.length) this.chunks.shift();
      else this.chunks[0] = chunk.subarray(part.length);
    }
    this.size -= out.length;
    return out;
  }

  /**
   * Exactly `count` bytes, waiting for them.  Gives up when nothing new arrives for `idleMs`,
   * or when `stop` says so; the error then tells how many bytes had come.
   */
  async take(count: number, idleMs: number, stop: () => boolean = () => false, onProgress?: (have: number) => void): Promise<Uint8Array> {
    let seen = this.size;
    let quiet = 0;
    const step = 25;
    while (this.size < count) {
      if (stop()) throw new Error('stopped');
      await new Promise<void>((done) => {
        const timer = setTimeout(() => {
          this.wake = null;
          done();
        }, step);
        this.wake = () => {
          clearTimeout(timer);
          this.wake = null;
          done();
        };
      });
      if (this.size === seen) {
        quiet += step;
        if (quiet >= idleMs) throw new Error(`timeout after ${this.size} of ${count} bytes`);
      } else {
        seen = this.size;
        quiet = 0;
        onProgress?.(Math.min(count, seen));
      }
    }
    return this.takeNow(count);
  }
}

export interface SumpLink {
  write(bytes: Uint8Array): Promise<void>;
  readonly incoming: ByteQueue;
}

export interface SumpDevice {
  readonly name: string;
  readonly version: string;
  /** Lines the device has; 0 when it does not say. */
  readonly probes: number;
  /** Samples its memory holds; 0 when it does not say. */
  readonly memory: number;
  /** Its fastest sample rate in hertz; 0 when it does not say. */
  readonly maxRate: number;
}

const RESET = Uint8Array.from([0, 0, 0, 0, 0]);
/** The clock SUMP's divider counts down from. */
const CLOCK = 100_000_000;

export const SUMP_RATES = [
  10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000, 20_000_000, 50_000_000, 100_000_000,
];

/** Reads the device's own description: a list of keys, each with a text, a 32-bit number or a byte. */
export function readSumpMetadata(bytes: Uint8Array): { device: SumpDevice; used: number } | null {
  let at = 0;
  let name = '';
  let version = '';
  let probes = 0;
  let memory = 0;
  let maxRate = 0;
  while (at < bytes.length) {
    const key = bytes[at++] as number;
    if (key === 0) return { device: { name, version, probes, memory, maxRate }, used: at };
    const kind = key >> 5;
    if (kind === 0) {
      const end = bytes.indexOf(0, at);
      if (end < 0) return null;
      const text = new TextDecoder().decode(bytes.subarray(at, end));
      if (key === 1) name = text;
      else if (key === 2 && !version) version = text;
      at = end + 1;
    } else if (kind === 1) {
      if (at + 4 > bytes.length) return null;
      const value = (((bytes[at] as number) << 24) | ((bytes[at + 1] as number) << 16) | ((bytes[at + 2] as number) << 8) | (bytes[at + 3] as number)) >>> 0;
      if (key === 0x20) probes = value;
      else if (key === 0x21) memory = value;
      else if (key === 0x23) maxRate = value;
      at += 4;
    } else if (kind === 2) {
      if (at + 1 > bytes.length) return null;
      if (key === 0x40) probes = bytes[at] as number;
      at += 1;
    } else return null;
  }
  return null;
}

const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * Finds a SUMP device on the link.  A board that restarts when its port is opened (an Arduino
 * does) needs a second or two before it answers, so the question is asked again for a while.
 */
export async function sumpIdentify(link: SumpLink, waitMs = 5000, stop: () => boolean = () => false): Promise<SumpDevice> {
  const deadline = Date.now() + waitMs;
  let answered = false;
  while (!answered) {
    if (stop()) throw new Error('stopped');
    link.incoming.clear();
    await link.write(RESET);
    await link.write(Uint8Array.from([0x02]));
    try {
      const id = new TextDecoder().decode(await link.incoming.take(4, 400, stop));
      if (id === '1ALS' || id === '1SLO') answered = true;
      else await pause(150);
    } catch (error) {
      if (error instanceof Error && error.message === 'stopped') throw error;
    }
    if (!answered && Date.now() > deadline)
      throw new Error('No logic analyser answered on this port. It needs a device that speaks the SUMP protocol at this speed, such as a board with the Logic Probe sketch.');
  }
  // Its description is optional: older devices say nothing.
  await link.write(Uint8Array.from([0x04]));
  const collected: number[] = [];
  const until = Date.now() + 700;
  while (Date.now() < until) {
    await pause(40);
    collected.push(...link.incoming.takeNow(link.incoming.length));
    const read = readSumpMetadata(Uint8Array.from(collected));
    if (read) return { ...read.device, name: read.device.name || 'SUMP logic analyser' };
  }
  link.incoming.clear();
  return { name: 'SUMP logic analyser', version: '', probes: 0, memory: 0, maxRate: 0 };
}

export interface SumpRequest {
  /** Hertz; the device takes the nearest rate its clock divides to. */
  readonly rate: number;
  readonly samples: number;
  /** 8 or 16 lines. */
  readonly lines: 8 | 16;
  /** The capture begins when the lines in the mask have these levels; a mask of 0 begins at once. */
  readonly triggerMask: number;
  readonly triggerValue: number;
}

const word = (command: number, value: number) => Uint8Array.from([command, value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff]);

/** What is sent to set a capture up, and the rate and count the device will really use. */
export function sumpSetup(device: SumpDevice, request: SumpRequest): { commands: Uint8Array[]; rate: number; samples: number } {
  const divider = Math.max(0, Math.min(0xffffff, Math.round(CLOCK / Math.max(1, request.rate)) - 1));
  const limit = Math.min(device.memory || 262_144, 262_144);
  const fours = Math.max(1, Math.min(Math.ceil(request.samples / 4), Math.floor(limit / 4)));
  return {
    rate: CLOCK / (divider + 1),
    samples: fours * 4,
    commands: [
      word(0x80, divider),
      // How many samples to send, and how many to take after the trigger: all of them, in fours less one.
      Uint8Array.from([0x81, (fours - 1) & 0xff, ((fours - 1) >> 8) & 0xff, (fours - 1) & 0xff, ((fours - 1) >> 8) & 0xff]),
      // Channel groups not used are switched off: the third and fourth, and the second for eight lines.
      word(0x82, request.lines === 16 ? 0x30 : 0x38),
      word(0xc0, request.triggerMask),
      word(0xc1, request.triggerValue),
      // The first trigger stage starts the capture.
      Uint8Array.from([0xc2, 0x00, 0x00, 0x00, 0x08]),
    ],
  };
}

export interface SumpCapture {
  /** Oldest sample first, one word a sample. */
  readonly samples: Uint8Array | Uint16Array;
  readonly rate: number;
}

/**
 * Takes a capture.  `onState` hears "waiting" until the first byte arrives (the device may be
 * waiting for its trigger) and then how far the transfer is, 0 to 1.
 */
export async function sumpCapture(
  link: SumpLink,
  device: SumpDevice,
  request: SumpRequest,
  onState: (state: 'waiting' | number) => void = () => undefined,
  stop: () => boolean = () => false,
): Promise<SumpCapture> {
  const { commands, rate, samples } = sumpSetup(device, request);
  const bytesEach = request.lines === 16 ? 2 : 1;
  link.incoming.clear();
  await link.write(RESET);
  for (const command of commands) await link.write(command);
  await link.write(Uint8Array.from([0x01]));
  onState('waiting');
  const total = samples * bytesEach;
  try {
    // Until the first byte there is no telling how long the trigger takes; after it, a pause means trouble.
    while (link.incoming.length === 0) {
      if (stop()) throw new Error('stopped');
      await pause(30);
    }
    const bytes = await link.incoming.take(total, Math.max(3000, (2000 * samples) / rate + 3000), stop, (have) => onState(have / total));
    onState(1);
    const out = bytesEach === 2 ? new Uint16Array(samples) : new Uint8Array(samples);
    for (let i = 0; i < samples; i++) {
      const from = (samples - 1 - i) * bytesEach;
      out[i] = bytesEach === 2 ? (bytes[from] as number) | ((bytes[from + 1] as number) << 8) : (bytes[from] as number);
    }
    return { samples: out, rate };
  } catch (error) {
    // The device is told to give up, whatever went wrong.
    await link.write(RESET).catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'stopped') throw new Error('The capture was stopped.');
    if (message.startsWith('timeout')) throw new Error(`The device stopped sending part of the way through (${message.replace('timeout after ', '')}).`);
    throw error;
  }
}
