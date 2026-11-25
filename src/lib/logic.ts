/**
 * Logic analysis: a capture of digital lines, measurements on it, and
 * decoders for I²C, SPI and serial (UART) traffic.  A capture is kept as the
 * moments at which any line changes, so a long quiet capture costs little
 * and files that record changes (VCD) need no resampling.
 */

export interface Capture {
  /** Seconds that one tick lasts: the capture's resolution in time (1 / sample rate when it was sampled). */
  readonly tick: number;
  /** How long the capture is, in ticks. */
  readonly length: number;
  readonly names: readonly string[];
  /** When the lines change: tick numbers in ascending order, the first of them 0 ... */
  readonly times: Float64Array;
  /** ... and all the lines from then on, one bit a line (bit 0 is the first line). */
  readonly states: Uint16Array;
  /** The sampling rate in hertz, when the capture was sampled. */
  readonly rate?: number;
}

export const MAX_LINES = 16;

/** A capture from evenly spaced samples, one word a sample. */
export function fromSamples(samples: Uint8Array | Uint16Array, rate: number, names: readonly string[]): Capture {
  const times: number[] = [];
  const states: number[] = [];
  let last = -1;
  for (let i = 0; i < samples.length; i++) {
    const word = samples[i] as number;
    if (word !== last) {
      times.push(i);
      states.push(word);
      last = word;
    }
  }
  if (!times.length) {
    times.push(0);
    states.push(0);
  }
  return { tick: 1 / rate, length: Math.max(1, samples.length), names: names.slice(0, MAX_LINES), times: Float64Array.from(times), states: Uint16Array.from(states), rate };
}

/** Builds a capture a line at a time: used for the demo, for files of changes and for recordings. */
export class CaptureBuilder {
  private readonly changes: { at: number; line: number; level: number }[] = [];
  private readonly start: number[];

  constructor(
    readonly tick: number,
    readonly names: readonly string[],
    idle: readonly number[] = [],
  ) {
    this.start = names.map((_, i) => (idle[i] ? 1 : 0));
  }

  /** The line takes this level from this tick on. */
  set(line: number, level: number | boolean, at: number): void {
    if (line >= 0 && line < this.names.length && line < MAX_LINES) this.changes.push({ at: Math.max(0, Math.round(at)), line, level: level ? 1 : 0 });
  }

  build(length?: number, rate?: number): Capture {
    // Changes at the same tick keep the order they were given in: the last one for a line wins.
    const order = this.changes.map((change, index) => ({ ...change, index })).sort((a, b) => a.at - b.at || a.index - b.index);
    const times: number[] = [0];
    const states: number[] = [this.start.reduce((word, level, i) => word | (level << i), 0)];
    for (const change of order) {
      const current = states[states.length - 1] as number;
      const next = change.level ? current | (1 << change.line) : current & ~(1 << change.line);
      if (next === current) continue;
      if (times[times.length - 1] === change.at) states[states.length - 1] = next;
      else {
        times.push(change.at);
        states.push(next);
      }
    }
    // A change undone at the same tick leaves two equal states in a row.
    const keptTimes: number[] = [];
    const keptStates: number[] = [];
    for (let i = 0; i < times.length; i++) {
      if (i > 0 && states[i] === keptStates[keptStates.length - 1]) continue;
      keptTimes.push(times[i] as number);
      keptStates.push(states[i] as number);
    }
    const end = keptTimes[keptTimes.length - 1] as number;
    return {
      tick: this.tick,
      length: Math.max(length ?? 0, end + 1),
      names: this.names.slice(0, MAX_LINES),
      times: Float64Array.from(keptTimes),
      states: Uint16Array.from(keptStates),
      ...(rate ? { rate } : {}),
    };
  }
}

/** One line of a capture: its level at the start, and the ticks at which it changes. */
export interface Line {
  readonly first: 0 | 1;
  readonly edges: Float64Array;
}

export function lineOf(capture: Capture, channel: number): Line {
  const mask = 1 << channel;
  const edges: number[] = [];
  const first = (capture.states[0] ?? 0) & mask ? 1 : 0;
  let level = first;
  for (let i = 1; i < capture.times.length; i++) {
    const now = (capture.states[i] as number) & mask ? 1 : 0;
    if (now !== level) {
      edges.push(capture.times[i] as number);
      level = now;
    }
  }
  return { first, edges: Float64Array.from(edges) };
}

/** How many of a line's edges lie at or before a tick. */
export function edgesUpTo(line: Line, at: number): number {
  let low = 0;
  let high = line.edges.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((line.edges[mid] as number) <= at) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** The line's level from a tick on (after any change at that tick). */
export const levelAt = (line: Line, at: number): 0 | 1 => ((line.first + edgesUpTo(line, at)) & 1) as 0 | 1;
/** The line's level just before a tick. */
export const levelBefore = (line: Line, at: number): 0 | 1 => ((line.first + edgesUpTo(line, at - 1e-9)) & 1) as 0 | 1;

export interface Measurement {
  readonly edges: number;
  /** Hertz, from the first rising edge to the last; null with fewer than two. */
  readonly frequency: number | null;
  /** The share of that time the line is high, 0 to 1. */
  readonly duty: number | null;
  /** The shortest time between two edges, in seconds. */
  readonly shortest: number | null;
}

/** What a line does between two ticks. */
export function measure(line: Line, from: number, to: number, tick: number): Measurement {
  const a = edgesUpTo(line, from - 1e-9);
  const b = edgesUpTo(line, to);
  let firstRise = -1;
  let lastRise = -1;
  let rises = 0;
  let high = 0;
  let shortest = Number.POSITIVE_INFINITY;
  for (let i = a; i < b; i++) {
    const at = line.edges[i] as number;
    const rising = ((line.first + i) & 1) === 0;
    if (i > a) shortest = Math.min(shortest, at - (line.edges[i - 1] as number));
    if (rising) {
      if (firstRise < 0) firstRise = at;
      lastRise = at;
      rises++;
    } else if (firstRise >= 0 && i > a) high += at - (line.edges[i - 1] as number);
  }
  // The high time counted runs past the last rising edge when a falling edge follows it: that part is taken off.
  if (rises >= 2) {
    let within = 0;
    for (let i = a; i < b; i++) {
      const at = line.edges[i] as number;
      const rising = ((line.first + i) & 1) === 0;
      if (!rising && i > a && (line.edges[i - 1] as number) >= firstRise && at <= lastRise) within += at - (line.edges[i - 1] as number);
    }
    high = within;
  }
  const span = lastRise - firstRise;
  return {
    edges: b - a,
    frequency: rises >= 2 && span > 0 ? (rises - 1) / (span * tick) : null,
    duty: rises >= 2 && span > 0 ? high / span : null,
    shortest: Number.isFinite(shortest) ? shortest * tick : null,
  };
}

/* ------------------------------------------------------ decoding -- */

export interface Annotation {
  /** Ticks. */
  readonly from: number;
  readonly to: number;
  readonly kind: 'start' | 'restart' | 'stop' | 'address' | 'data' | 'ack' | 'nak' | 'error';
  readonly text: string;
  readonly value?: number;
}

/** A row of the decoded table: one I²C transfer, one SPI frame, one run of serial bytes. */
export interface Packet {
  readonly from: number;
  readonly to: number;
  readonly title: string;
  /** Bytes out (to the device) and in (from it); serial and I²C use `out` alone. */
  readonly out: readonly number[];
  readonly in?: readonly number[];
  readonly note?: string;
}

export interface Decoded {
  readonly annotations: Annotation[];
  readonly packets: Packet[];
}

export const hex = (value: number, digits = 2) => `0x${value.toString(16).toUpperCase().padStart(digits, '0')}`;

/** Two lines' edges as one list in order of time. */
function merged(a: Line, b: Line): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.edges.length || j < b.edges.length) {
    const x = i < a.edges.length ? (a.edges[i] as number) : Number.POSITIVE_INFINITY;
    const y = j < b.edges.length ? (b.edges[j] as number) : Number.POSITIVE_INFINITY;
    const next = Math.min(x, y);
    if (out[out.length - 1] !== next) out.push(next);
    if (x === next) i++;
    if (y === next) j++;
  }
  return out;
}

export interface I2cSetup {
  readonly scl: number;
  readonly sda: number;
}

/**
 * I²C: a start is the data line falling while the clock is high, a stop is it rising; in
 * between, a bit is read at each rise of the clock, nine to a byte (eight and the acknowledge).
 */
export function decodeI2c(capture: Capture, setup: I2cSetup): Decoded {
  const scl = lineOf(capture, setup.scl);
  const sda = lineOf(capture, setup.sda);
  const annotations: Annotation[] = [];
  const packets: Packet[] = [];
  let active = false;
  let bits = 0;
  let byte = 0;
  let byteFrom = 0;
  let count = 0;
  let lastRise = 0;
  let packet: { from: number; address: number; read: boolean; acked: boolean; bytes: number[]; naks: number } | null = null;
  const close = (at: number, stopped: boolean) => {
    if (packet && count > 0) {
      const { address, read, acked, bytes, naks } = packet;
      packets.push({
        from: packet.from,
        to: at,
        title: `${read ? 'Read from' : 'Write to'} ${hex(address)}`,
        out: bytes,
        note: [acked ? '' : 'no device answered', !read && naks > 0 && acked ? 'a byte was refused' : '', stopped ? '' : 'no stop'].filter(Boolean).join(', ') || undefined,
      });
    }
    packet = null;
  };
  for (const at of merged(scl, sda)) {
    const sclBefore = levelBefore(scl, at);
    const sclAfter = levelAt(scl, at);
    const sdaBefore = levelBefore(sda, at);
    const sdaAfter = levelAt(sda, at);
    if (sdaBefore !== sdaAfter && sclBefore === 1 && (sclAfter === 1 || sdaAfter === 0)) {
      if (sdaAfter === 0) {
        // A start; within a transfer, a repeated start.
        if (active) close(at, false);
        annotations.push({ from: at, to: at, kind: active ? 'restart' : 'start', text: active ? 'Sr' : 'S' });
        active = true;
        bits = 0;
        byte = 0;
        count = 0;
        packet = { from: at, address: 0, read: false, acked: false, bytes: [], naks: 0 };
      } else if (active) {
        annotations.push({ from: at, to: at, kind: 'stop', text: 'P' });
        close(at, true);
        active = false;
      }
      continue;
    }
    if (!active || !(sclBefore === 0 && sclAfter === 1)) continue;
    if (bits === 0) byteFrom = at;
    if (bits < 8) {
      byte = (byte << 1) | sdaAfter;
      bits++;
      lastRise = at;
      continue;
    }
    // The ninth bit: low is an acknowledge.
    const acked = sdaAfter === 0;
    if (count === 0) {
      const address = byte >> 1;
      const read = (byte & 1) === 1;
      annotations.push({ from: byteFrom, to: lastRise, kind: 'address', text: `${hex(address)} ${read ? 'R' : 'W'}`, value: byte });
      if (packet) {
        packet.address = address;
        packet.read = read;
        packet.acked = acked;
      }
    } else {
      annotations.push({ from: byteFrom, to: lastRise, kind: 'data', text: hex(byte), value: byte });
      if (packet) {
        packet.bytes.push(byte);
        if (!acked) packet.naks++;
      }
    }
    annotations.push({ from: at, to: at, kind: acked ? 'ack' : 'nak', text: acked ? 'A' : 'N' });
    count++;
    bits = 0;
    byte = 0;
  }
  if (active) close(capture.length, false);
  return { annotations, packets };
}

export interface SpiSetup {
  readonly clk: number;
  /** -1 for a line that is not connected. */
  readonly mosi: number;
  readonly miso: number;
  readonly cs: number;
  /** 0 to 3: the clock's idle level (modes 2 and 3 idle high) and which edge data is read on. */
  readonly mode: 0 | 1 | 2 | 3;
  readonly bits: number;
  readonly msbFirst: boolean;
  readonly csActiveLow: boolean;
}

/** SPI: a bit of each data line at every reading edge of the clock while the device is selected. */
export function decodeSpi(capture: Capture, setup: SpiSetup): Decoded {
  const clk = lineOf(capture, setup.clk);
  const mosi = setup.mosi >= 0 ? lineOf(capture, setup.mosi) : null;
  const miso = setup.miso >= 0 ? lineOf(capture, setup.miso) : null;
  const cs = setup.cs >= 0 ? lineOf(capture, setup.cs) : null;
  const bitsPerWord = Math.max(1, Math.min(32, Math.round(setup.bits)));
  // Modes 0 and 3 read on the rising edge, 1 and 2 on the falling one.
  const readOnRise = setup.mode === 0 || setup.mode === 3;
  const selected = (at: number) => !cs || (levelAt(cs, at) === 0) === setup.csActiveLow;
  const annotations: Annotation[] = [];
  const packets: Packet[] = [];
  // Without a select line, a pause in the clock much longer than its beat starts a new word.
  const gaps: number[] = [];
  for (let i = 2; i < clk.edges.length; i += 2) gaps.push((clk.edges[i] as number) - (clk.edges[i - 2] as number));
  gaps.sort((a, b) => a - b);
  const beat = gaps.length ? (gaps[gaps.length >> 1] as number) : 0;
  let frame: { from: number; to: number; out: number[]; in: number[] } | null = null;
  let bits = 0;
  let out = 0;
  let back = 0;
  let wordFrom = 0;
  let lastRead = Number.NEGATIVE_INFINITY;
  const endFrame = (at: number) => {
    if (frame && (frame.out.length || frame.in.length)) {
      const note = bits > 0 ? `${bits} bit${bits === 1 ? '' : 's'} left over` : undefined;
      packets.push({
        from: frame.from,
        to: at,
        title: `${Math.max(frame.out.length, frame.in.length)} word${Math.max(frame.out.length, frame.in.length) === 1 ? '' : 's'}`,
        out: mosi ? frame.out : [],
        in: miso ? frame.in : undefined,
        note,
      });
    }
    frame = null;
    bits = 0;
    out = 0;
    back = 0;
  };
  // The select line's own edges end and begin frames.
  const csEdges = cs ? [...cs.edges] : [];
  let nextCs = 0;
  for (let i = 0; i < clk.edges.length; i++) {
    const at = clk.edges[i] as number;
    while (nextCs < csEdges.length && (csEdges[nextCs] as number) <= at) {
      const edge = csEdges[nextCs] as number;
      if (!selected(edge)) endFrame(edge);
      nextCs++;
    }
    const rising = ((clk.first + i) & 1) === 0;
    if (rising !== readOnRise || !selected(at)) continue;
    if (!cs && frame && beat > 0 && at - lastRead > beat * 4) endFrame(lastRead);
    if (!frame) frame = { from: cs ? Math.max(0, cs.edges[edgesUpTo(cs, at) - 1] ?? at) : at, to: at, out: [], in: [] };
    if (bits === 0) wordFrom = at;
    const o = mosi ? levelAt(mosi, at) : 0;
    const b = miso ? levelAt(miso, at) : 0;
    if (setup.msbFirst) {
      out = out * 2 + o;
      back = back * 2 + b;
    } else {
      out += o * 2 ** bits;
      back += b * 2 ** bits;
    }
    bits++;
    lastRead = at;
    if (bits === bitsPerWord) {
      const digits = Math.ceil(bitsPerWord / 4);
      const text = [mosi ? hex(out, digits) : '', miso ? hex(back, digits) : ''].filter(Boolean).join(' / ');
      annotations.push({ from: wordFrom, to: at, kind: 'data', text, value: mosi ? out : back });
      frame.out.push(out);
      frame.in.push(back);
      frame.to = at;
      bits = 0;
      out = 0;
      back = 0;
    }
  }
  while (nextCs < csEdges.length) {
    const edge = csEdges[nextCs] as number;
    if (!selected(edge)) endFrame(edge);
    nextCs++;
  }
  if (frame) endFrame(Math.max(lastRead, (frame as { to: number }).to));
  return { annotations, packets };
}

export interface UartSetup {
  readonly rx: number;
  readonly baud: number;
  readonly bits: number;
  readonly parity: 'none' | 'even' | 'odd';
  readonly stop: 1 | 2;
  /** Idle low and bits upside down, as on an RS-232 line before its level shifter. */
  readonly inverted: boolean;
}

export const BAUDS = [300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 28800, 31250, 38400, 57600, 74880, 115200, 230400, 250000, 460800, 500000, 921600, 1000000, 2000000];

/** The speed of a serial line, from the shortest of its pulses: the nearest usual rate, or null with too little to go on. */
export function guessBaud(capture: Capture, channel: number): number | null {
  const line = lineOf(capture, channel);
  if (line.edges.length < 4) return null;
  const gaps: number[] = [];
  for (let i = 1; i < line.edges.length; i++) gaps.push((line.edges[i] as number) - (line.edges[i - 1] as number));
  gaps.sort((a, b) => a - b);
  // A glitch or two must not set the speed: the bit time is taken a little way up from the shortest.
  const bit = (gaps[Math.floor(gaps.length * 0.05)] as number) * capture.tick;
  if (!(bit > 0)) return null;
  const raw = 1 / bit;
  const nearest = BAUDS.reduce((best, rate) => (Math.abs(Math.log(rate / raw)) < Math.abs(Math.log(best / raw)) ? rate : best), BAUDS[0] as number);
  return Math.abs(nearest / raw - 1) < 0.12 ? nearest : Math.round(raw);
}

const printable = (value: number) => (value >= 0x20 && value < 0x7f ? String.fromCharCode(value) : value === 0x0a ? '\\n' : value === 0x0d ? '\\r' : value === 0x09 ? '\\t' : hex(value));

/** Bytes as text: what can be printed as it is, the rest as a dot. */
export const asText = (bytes: readonly number[]) => bytes.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');

/** Serial (UART): a start bit, the data bits from the lowest up, an optional parity bit, and stop bits. */
export function decodeUart(capture: Capture, setup: UartSetup): Decoded {
  const raw = lineOf(capture, setup.rx);
  const annotations: Annotation[] = [];
  const packets: Packet[] = [];
  const bitTicks = 1 / (setup.baud * capture.tick);
  if (!(bitTicks >= 1.5) || !Number.isFinite(bitTicks)) return { annotations, packets };
  const dataBits = Math.max(5, Math.min(9, Math.round(setup.bits)));
  // A level as the wire means it: 1 is idle (mark), whichever way up the line is.
  const mark = (at: number) => (levelAt(raw, at) === 1) !== setup.inverted;
  const frameBits = 1 + dataBits + (setup.parity === 'none' ? 0 : 1) + setup.stop;
  let run: { from: number; to: number; bytes: number[]; errors: number } | null = null;
  const endRun = () => {
    if (run?.bytes.length)
      packets.push({ from: run.from, to: run.to, title: `${run.bytes.length} byte${run.bytes.length === 1 ? '' : 's'}`, out: run.bytes, note: run.errors ? `${run.errors} with errors` : undefined });
    run = null;
  };
  let free = 0;
  for (let i = 0; i < raw.edges.length; i++) {
    const at = raw.edges[i] as number;
    // A start bit is the line leaving idle once the last frame is over.
    if (at < free || mark(at)) continue;
    // Read in the middle of each bit; a start bit that is not there half a bit later was a glitch.
    if (mark(at + bitTicks / 2)) continue;
    let value = 0;
    let ones = 0;
    for (let b = 0; b < dataBits; b++) {
      if (mark(at + (b + 1.5) * bitTicks)) {
        value |= 1 << b;
        ones++;
      }
    }
    let problem = '';
    if (setup.parity !== 'none') {
      const bit = mark(at + (dataBits + 1.5) * bitTicks) ? 1 : 0;
      if ((ones + bit) % 2 !== (setup.parity === 'even' ? 0 : 1)) problem = 'parity';
    }
    const stopAt = at + (frameBits - setup.stop + 0.5) * bitTicks;
    if (stopAt > capture.length) break;
    if (!mark(stopAt)) problem = 'framing';
    const end = at + (frameBits - setup.stop + 1) * bitTicks;
    annotations.push({ from: at, to: Math.min(capture.length, end), kind: problem ? 'error' : 'data', text: problem ? `${printable(value)} (${problem} error)` : printable(value), value });
    if (run && at - run.to > bitTicks * frameBits * 2) endRun();
    if (!run) run = { from: at, to: end, bytes: [], errors: 0 };
    run.bytes.push(value);
    run.to = end;
    if (problem) run.errors++;
    // The next start bit may come as soon as the stop bit has been read.
    free = stopAt;
  }
  endRun();
  return { annotations, packets };
}

/* --------------------------------------------------------- files -- */

const UNITS: Readonly<Record<string, number>> = { s: 1, ms: 1e-3, us: 1e-6, µs: 1e-6, ns: 1e-9, ps: 1e-12, fs: 1e-15 };

/**
 * Reads a Value Change Dump (VCD), the file that sigrok and PulseView, GTKWave and logic
 * simulators write.  Single wires become lines; a bus gives one line for each of its bits,
 * the lowest first, as far as the sixteen lines go.
 */
export function readVcd(text: string): Capture {
  if (!/\$enddefinitions\b/.test(text) && !/\$var\b/.test(text)) throw new Error('This is not a VCD file: it declares no signals.');
  let tick = 1e-9;
  const scale = /\$timescale\s+(\d+)\s*(fs|ps|ns|us|µs|ms|s)\s+\$end/.exec(text);
  if (scale) tick = Number(scale[1]) * (UNITS[scale[2] as string] as number);
  // Each identifier's first line and its width.
  const wires = new Map<string, { line: number; width: number }>();
  const names: string[] = [];
  let skipped = 0;
  for (const match of text.matchAll(/\$var\s+(\S+)\s+(\d+)\s+(\S+)\s+([^$]*?)\s*\$end/g)) {
    const width = Number(match[2]);
    const id = match[3] as string;
    const name = (match[4] as string).replace(/\s*\[[^\]]*\]$/, '').trim() || id;
    if (wires.has(id)) continue;
    if (match[1] === 'real' || match[1] === 'event' || width < 1 || names.length + width > MAX_LINES) {
      skipped++;
      continue;
    }
    wires.set(id, { line: names.length, width });
    for (let bit = 0; bit < width; bit++) names.push(width === 1 ? name : `${name}[${bit}]`);
  }
  if (!names.length) throw new Error(skipped ? 'This VCD file holds no single lines or small buses that can be shown (up to 16 lines in all).' : 'This VCD file declares no signals.');
  const builder = new CaptureBuilder(tick, names);
  const body = text.slice(Math.max(0, text.search(/\$enddefinitions\b/)));
  let now = 0;
  let last = 0;
  let changes = 0;
  for (const token of body.matchAll(/#(\d+)|b([01xzXZ]+)\s+(\S+)|([01xzXZ])(\S+)/g)) {
    if (token[1] !== undefined) {
      now = Number(token[1]);
      last = Math.max(last, now);
    } else if (token[2] !== undefined) {
      const wire = wires.get(token[3] as string);
      if (!wire) continue;
      const bits = token[2] as string;
      for (let bit = 0; bit < wire.width; bit++) builder.set(wire.line + bit, bits[bits.length - 1 - bit] === '1', now);
      changes++;
    } else {
      const wire = wires.get(token[5] as string);
      if (!wire) continue;
      builder.set(wire.line, token[4] === '1', now);
      changes++;
    }
    if (changes > 8_000_000) throw new Error('This VCD file holds more than eight million changes, too many to show.');
  }
  // A last moment with no change marks the end; without one, a little is added so that the last state shows.
  const capture = builder.build();
  const end = capture.times[capture.times.length - 1] as number;
  return { ...capture, length: last > end ? last : Math.ceil(end * 1.02) + 1 };
}

/** The capture as a VCD file, which PulseView, GTKWave and others open. */
export function writeVcd(capture: Capture, date = ''): string {
  // The timescale must be 1, 10 or 100 of a unit: the unit is the largest in which a tick is a whole number.
  const units = ['s', 'ms', 'us', 'ns', 'ps', 'fs'];
  let unit = 'fs';
  let factor = Math.max(1, Math.round(capture.tick / 1e-15));
  for (const [index, name] of units.entries()) {
    const size = 10 ** (-3 * index);
    const ratio = capture.tick / size;
    if (ratio >= 1 && Math.abs(ratio - Math.round(ratio)) < 1e-6 * ratio) {
      unit = name;
      factor = Math.round(ratio);
      break;
    }
  }
  const ids = capture.names.map((_, i) => String.fromCharCode(33 + i));
  const lines = [`$date ${date || 'unknown'} $end`, '$version Benchtop Logic Analyser $end', `$timescale 1 ${unit} $end`, '$scope module logic $end'];
  for (const [i, name] of capture.names.entries()) lines.push(`$var wire 1 ${ids[i]} ${name.replace(/\s+/g, '_') || `D${i}`} $end`);
  lines.push('$upscope $end', '$enddefinitions $end');
  let before = -1;
  for (let i = 0; i < capture.times.length; i++) {
    const state = capture.states[i] as number;
    lines.push(`#${Math.round((capture.times[i] as number) * factor)}`);
    for (let line = 0; line < capture.names.length; line++) {
      const level = (state >> line) & 1;
      if (before < 0 || ((before >> line) & 1) !== level) lines.push(`${level}${ids[line]}`);
    }
    before = state;
  }
  lines.push(`#${Math.round(capture.length * factor)}`);
  return `${lines.join('\n')}\n`;
}

/**
 * Reads a table of text.  With a first column of times (in seconds unless its heading names
 * another unit) each row is a change; without one each row is a sample, taken at `rate`.
 */
export function readCsv(text: string, rate = 1_000_000): Capture {
  const rows = text
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter((row) => row && !row.startsWith('#') && !row.startsWith(';'));
  if (rows.length < 2) throw new Error('This table has no rows to read.');
  const delimiter = (rows[0] as string).includes('\t') ? '\t' : (rows[0] as string).includes(';') ? ';' : ',';
  const cells = (row: string) => row.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, ''));
  const head = cells(rows[0] as string);
  const titled = head.some((cell) => !/^[-+]?[\d.]+(e[-+]?\d+)?$/i.test(cell));
  const data = titled ? rows.slice(1) : rows;
  const first = cells(data[0] as string);
  const timeTitle = titled && /time|^t$|sec/i.test(head[0] as string);
  const timed = timeTitle || (!titled && first.length > 1 && /[.eE]/.test(first[0] as string));
  const columns = first.length - (timed ? 1 : 0);
  if (columns < 1) throw new Error('This table has no columns of 0 and 1 to read as lines.');
  const names = Array.from({ length: Math.min(columns, MAX_LINES) }, (_, i) => (titled ? head[i + (timed ? 1 : 0)] || `D${i}` : `D${i}`));
  const levelOf = (cell: string | undefined) => cell === '1' || /^(true|high|h)$/i.test(cell ?? '');
  if (!timed) {
    if (!(rate > 0)) throw new Error('Give the rate the samples were taken at.');
    if (data.length > 30_000_000) throw new Error('This table has more than thirty million rows.');
    const samples = new Uint16Array(data.length);
    for (const [i, row] of data.entries()) {
      const values = cells(row);
      let word = 0;
      for (let line = 0; line < names.length; line++) if (levelOf(values[line])) word |= 1 << line;
      samples[i] = word;
    }
    return fromSamples(samples, rate, names);
  }
  const unit = /\bms\b|\(ms\)|\[ms\]|_ms/i.test(head[0] ?? '') ? 1e-3 : /\b(us|µs)\b|_us/i.test(head[0] ?? '') ? 1e-6 : /\bns\b|_ns/i.test(head[0] ?? '') ? 1e-9 : 1;
  // Times are kept in nanoseconds, counted from the first row.
  const tick = 1e-9;
  const builder = new CaptureBuilder(tick, names);
  let zero: number | null = null;
  let last = 0;
  for (const row of data) {
    const values = cells(row);
    const seconds = Number(values[0]) * unit;
    if (!Number.isFinite(seconds)) continue;
    zero ??= seconds;
    const at = Math.round((seconds - zero) / tick);
    last = Math.max(last, at);
    for (let line = 0; line < names.length; line++) builder.set(line, levelOf(values[line + 1]), at);
  }
  const capture = builder.build();
  const end = capture.times[capture.times.length - 1] as number;
  return { ...capture, length: last > end ? last : Math.ceil(end * 1.02) + 1 };
}

/**
 * Reads a sigrok session (.sr, as PulseView saves it) from its unpacked files: `metadata`
 * and the pieces of the capture, `logic-1-1`, `logic-1-2` and so on.
 */
export function readSigrok(files: Readonly<Record<string, Uint8Array>>): Capture {
  const metadata = files.metadata;
  if (!metadata) throw new Error('This is not a sigrok session file: it has no metadata.');
  const text = new TextDecoder().decode(metadata);
  const value = (key: string) => new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, 'mi').exec(text)?.[1];
  const rateText = value('samplerate') ?? '';
  const rateMatch = /^([\d.]+)\s*(k|m|g)?hz$/i.exec(rateText.replace(/\s+/g, ''));
  if (!rateMatch) throw new Error('This sigrok session does not give its sample rate.');
  const rate = Number(rateMatch[1]) * ({ k: 1e3, m: 1e6, g: 1e9 }[(rateMatch[2] ?? '').toLowerCase()] ?? 1);
  const unit = Math.max(1, Math.min(8, Number(value('unitsize') ?? 1)));
  const probes = Math.max(1, Math.min(64, Number(value('total probes') ?? unit * 8)));
  const names = Array.from({ length: Math.min(probes, MAX_LINES) }, (_, i) => value(`probe${i + 1}`) ?? `D${i}`);
  const base = value('capturefile') ?? 'logic-1';
  const pieces = Object.keys(files)
    .filter((name) => name === base || name.startsWith(`${base}-`))
    .sort((a, b) => Number(a.slice(base.length + 1) || 0) - Number(b.slice(base.length + 1) || 0));
  if (!pieces.length) throw new Error('This sigrok session holds no logic capture (analogue channels are not read).');
  const total = pieces.reduce((sum, name) => sum + Math.floor((files[name] as Uint8Array).length / unit), 0);
  if (total > 400_000_000) throw new Error('This capture has more than 400 million samples.');
  const times: number[] = [];
  const states: number[] = [];
  let last = -1;
  let index = 0;
  for (const name of pieces) {
    const bytes = files[name] as Uint8Array;
    for (let at = 0; at + unit <= bytes.length; at += unit, index++) {
      const word = unit === 1 ? (bytes[at] as number) : (bytes[at] as number) | ((bytes[at + 1] as number) << 8);
      if (word !== last) {
        times.push(index);
        states.push(word);
        last = word;
      }
    }
  }
  if (!times.length) throw new Error('This sigrok session holds no samples.');
  return { tick: 1 / rate, length: total, names, times: Float64Array.from(times), states: Uint16Array.from(states), rate };
}

/** The decoded packets as a table for a spreadsheet. */
export function packetsCsv(capture: Capture, rows: readonly { decoder: string; packet: Packet }[]): string {
  const cell = (value: string | number) => {
    const text = String(value);
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const bytes = (list: readonly number[] | undefined) => (list ?? []).map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  const lines = [['Time (s)', 'Decoder', 'What', 'Out (hex)', 'In (hex)', 'Text', 'Note']];
  for (const { decoder, packet } of rows)
    lines.push([
      String(Number((packet.from * capture.tick).toPrecision(9))),
      decoder,
      packet.title,
      bytes(packet.out),
      bytes(packet.in),
      asText(packet.in?.length ? packet.in : packet.out),
      packet.note ?? '',
    ]);
  return `${lines.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

/* ---------------------------------------------------------- demo -- */

export const DEMO_NAMES = ['SCL', 'SDA', 'CLK', 'MOSI', 'MISO', 'CS', 'TX', 'PWM'] as const;

/**
 * A capture to try the analyser on, as a small board might produce it: an I²C write and
 * read, an SPI flash chip asked for its identity, a line of serial text and a PWM output.
 */
export function demoCapture(): Capture {
  const rate = 4_000_000;
  const b = new CaptureBuilder(1 / rate, DEMO_NAMES, [1, 1, 0, 0, 0, 1, 1, 0]);
  const us = (micros: number) => Math.round(micros * (rate / 1e6));
  const [SCL, SDA, CLK, MOSI, MISO, CS, TX, PWM] = [0, 1, 2, 3, 4, 5, 6, 7];

  // I²C at 100 kHz: half a bit is 5 µs.
  let t = us(200);
  const half = us(5);
  const start = () => {
    b.set(SDA, 1, t);
    b.set(SCL, 1, t + us(1));
    t += half;
    b.set(SDA, 0, t);
    t += half;
    b.set(SCL, 0, t);
  };
  const bit = (level: number) => {
    b.set(SDA, level, t + us(1));
    t += half;
    b.set(SCL, 1, t);
    t += half;
    b.set(SCL, 0, t);
  };
  const byte = (value: number, ack: boolean) => {
    for (let i = 7; i >= 0; i--) bit((value >> i) & 1);
    bit(ack ? 0 : 1);
  };
  const stop = () => {
    b.set(SDA, 0, t + us(1));
    t += half;
    b.set(SCL, 1, t);
    t += half;
    b.set(SDA, 1, t);
    t += half * 2;
  };
  start();
  byte(0x3c << 1, true);
  byte(0x00, true);
  byte(0xaf, true);
  start();
  byte((0x48 << 1) | 1, true);
  byte(0x19, true);
  byte(0x80, false);
  stop();

  // SPI mode 0 at 500 kHz: a flash chip asked for its JEDEC identity.
  t += us(300);
  b.set(CS, 0, t);
  t += us(4);
  const out = [0x9f, 0x00, 0x00, 0x00];
  const back = [0xff, 0xef, 0x40, 0x18];
  for (const [index, value] of out.entries()) {
    for (let i = 7; i >= 0; i--) {
      b.set(MOSI, (value >> i) & 1, t);
      b.set(MISO, ((back[index] as number) >> i) & 1, t);
      t += us(1);
      b.set(CLK, 1, t);
      t += us(1);
      b.set(CLK, 0, t);
    }
    t += us(2);
  }
  b.set(MOSI, 0, t);
  b.set(MISO, 0, t);
  t += us(2);
  b.set(CS, 1, t);

  // Serial at 115 200 baud, eight bits, no parity.
  t += us(400);
  const bitTime = rate / 115_200;
  for (const ch of 'Benchtop\r\n') {
    const code = ch.charCodeAt(0);
    b.set(TX, 0, t);
    for (let i = 0; i < 8; i++) b.set(TX, (code >> i) & 1, t + (i + 1) * bitTime);
    b.set(TX, 1, t + 9 * bitTime);
    t += Math.round(10 * bitTime) + us(8);
  }
  const length = t + us(400);
  // PWM at 1 kHz, a quarter of the time high, throughout.
  for (let at = us(100); at + us(250) < length; at += us(1000)) {
    b.set(PWM, 1, at);
    b.set(PWM, 0, at + us(250));
  }
  return b.build(length, rate);
}
