import { describe, expect, it } from 'vitest';
import {
  asText,
  CaptureBuilder,
  decodeI2c,
  decodeSpi,
  decodeUart,
  demoCapture,
  edgesUpTo,
  fromSamples,
  guessBaud,
  levelAt,
  levelBefore,
  lineOf,
  measure,
  packetsCsv,
  readCsv,
  readSigrok,
  readVcd,
  type SpiSetup,
  type UartSetup,
  writeVcd,
} from '../../src/lib/logic';

const demo = demoCapture();
const SPI: SpiSetup = { clk: 2, mosi: 3, miso: 4, cs: 5, mode: 0, bits: 8, msbFirst: true, csActiveLow: true };
const UART: UartSetup = { rx: 6, baud: 115200, bits: 8, parity: 'none', stop: 1, inverted: false };

/** Serial bytes on line 0 of a new capture, at 1 MHz. */
function serial(bytes: number[], setup: Partial<UartSetup> & { baud: number }, spoil?: (b: CaptureBuilder, start: number, bit: number) => void) {
  const rate = 1_000_000;
  const idle = setup.inverted ? 0 : 1;
  const b = new CaptureBuilder(1 / rate, ['RX'], [idle]);
  const bit = rate / setup.baud;
  const level = (mark: number) => (setup.inverted ? 1 - mark : mark);
  let t = 500;
  for (const value of bytes) {
    const dataBits = setup.bits ?? 8;
    b.set(0, level(0), t);
    let ones = 0;
    for (let i = 0; i < dataBits; i++) {
      const one = (value >> i) & 1;
      ones += one;
      b.set(0, level(one), t + (i + 1) * bit);
    }
    let at = dataBits + 1;
    if (setup.parity && setup.parity !== 'none') {
      b.set(0, level((ones + (setup.parity === 'odd' ? 1 : 0)) % 2), t + at * bit);
      at++;
    }
    b.set(0, level(1), t + at * bit);
    spoil?.(b, t, bit);
    t += Math.round((at + (setup.stop ?? 1)) * bit) + 40;
  }
  return b.build(t + 500, rate);
}

describe('a capture', () => {
  it('is kept as changes, and gives each line its level at any moment', () => {
    const capture = fromSamples(Uint8Array.from([0, 0, 1, 1, 3, 3, 2, 0, 0, 0]), 1000, ['A', 'B']);
    expect(capture.tick).toBe(0.001);
    expect(capture.length).toBe(10);
    expect([...capture.times]).toEqual([0, 2, 4, 6, 7]);
    expect([...capture.states]).toEqual([0, 1, 3, 2, 0]);
    const a = lineOf(capture, 0);
    const b = lineOf(capture, 1);
    expect([a.first, ...a.edges]).toEqual([0, 2, 6]);
    expect([b.first, ...b.edges]).toEqual([0, 4, 7]);
    expect([0, 1, 2, 5, 6, 9].map((at) => levelAt(a, at))).toEqual([0, 0, 1, 1, 0, 0]);
    // Just before a change the line still has its old level.
    expect(levelBefore(a, 2)).toBe(0);
    expect(levelBefore(a, 6)).toBe(1);
    expect(edgesUpTo(b, 4)).toBe(1);
    expect(edgesUpTo(b, 3.5)).toBe(0);
    // Nothing at all still makes a capture.
    expect(fromSamples(new Uint8Array(0), 1000, ['A']).times.length).toBe(1);
  });

  it('is built a line at a time, with changes that cancel left out', () => {
    const b = new CaptureBuilder(1e-6, ['X', 'Y'], [1, 0]);
    b.set(1, 1, 10);
    b.set(0, 0, 10);
    b.set(0, 1, 30);
    // Set and unset at once: no change.
    b.set(1, 0, 40);
    b.set(1, 1, 40);
    b.set(5, 1, 50);
    const capture = b.build(100);
    expect([...capture.times]).toEqual([0, 10, 30]);
    expect([...capture.states]).toEqual([1, 2, 3]);
    expect(capture.length).toBe(100);
  });

  it('measures frequency, duty and the shortest pulse of a line', () => {
    const pwm = lineOf(demo, 7);
    const all = measure(pwm, 0, demo.length, demo.tick);
    expect(all.frequency).toBeCloseTo(1000, 3);
    expect(all.duty).toBeCloseTo(0.25, 6);
    expect(all.shortest).toBeCloseTo(250e-6, 9);
    expect(all.edges).toBe(pwm.edges.length);
    // Two rising edges are enough for a frequency; a stretch with none has nothing to give.
    const two = measure(pwm, 0, 1.2e-3 / demo.tick, demo.tick);
    expect(two.edges).toBe(3);
    expect(two.frequency).toBeCloseTo(1000, 3);
    expect(two.duty).toBeCloseTo(0.25, 6);
    expect(measure(pwm, 0, 300, demo.tick)).toMatchObject({ edges: 0, frequency: null, duty: null, shortest: null });
  });
});

describe('decoding the demo capture', () => {
  it('reads the I²C write and the read that follows a repeated start', () => {
    const { annotations, packets } = decodeI2c(demo, { scl: 0, sda: 1 });
    expect(annotations.map((a) => a.text)).toEqual(['S', '0x3C W', 'A', '0x00', 'A', '0xAF', 'A', 'Sr', '0x48 R', 'A', '0x19', 'A', '0x80', 'N', 'P']);
    expect(annotations[0]?.kind).toBe('start');
    expect(annotations[7]?.kind).toBe('restart');
    expect(annotations[13]?.kind).toBe('nak');
    expect(packets).toHaveLength(2);
    expect(packets[0]).toMatchObject({ title: 'Write to 0x3C', out: [0x00, 0xaf], note: 'no stop' });
    expect(packets[1]).toMatchObject({ title: 'Read from 0x48', out: [0x19, 0x80] });
    // The last byte of a read is not acknowledged by the reader: that is the rule, not a fault.
    expect(packets[1]?.note).toBeUndefined();
    // Times are in ticks: the first start comes 200 µs + half a bit into the capture.
    expect((packets[0]?.from ?? 0) * demo.tick).toBeCloseTo(205e-6, 9);
    // Swapping the two lines finds nothing sensible, and does not throw.
    expect(decodeI2c(demo, { scl: 1, sda: 0 }).packets.every((p) => p.out.length <= 1)).toBe(true);
  });

  it('reads the SPI frame in both directions', () => {
    const { annotations, packets } = decodeSpi(demo, SPI);
    expect(packets).toHaveLength(1);
    expect(packets[0]).toMatchObject({ title: '4 words', out: [0x9f, 0, 0, 0], in: [0xff, 0xef, 0x40, 0x18] });
    expect(packets[0]?.note).toBeUndefined();
    expect(annotations.map((a) => a.text)).toEqual(['0x9F / 0xFF', '0x00 / 0xEF', '0x00 / 0x40', '0x00 / 0x18']);
    // One data line alone.
    expect(decodeSpi(demo, { ...SPI, miso: -1 }).packets[0]).toMatchObject({ out: [0x9f, 0, 0, 0], in: undefined });
    expect(decodeSpi(demo, { ...SPI, mosi: -1 }).annotations[1]?.text).toBe('0xEF');
    // Sixteen bits to a word, and the lowest bit first.
    expect(decodeSpi(demo, { ...SPI, bits: 16 }).packets[0]).toMatchObject({ out: [0x9f00, 0], in: [0xffef, 0x4018] });
    expect(decodeSpi(demo, { ...SPI, msbFirst: false }).packets[0]?.out[0]).toBe(0xf9);
    // Without the select line, the pause after the frame still ends it.
    expect(decodeSpi(demo, { ...SPI, cs: -1 }).packets[0]).toMatchObject({ out: [0x9f, 0, 0, 0] });
    // A select line that is active high sees no frame here.
    expect(decodeSpi(demo, { ...SPI, csActiveLow: false }).packets).toHaveLength(0);
  });

  it('finds the speed of the serial line and reads its text', () => {
    expect(guessBaud(demo, 6)).toBe(115200);
    expect(guessBaud(demo, 5)).toBeNull();
    const { annotations, packets } = decodeUart(demo, UART);
    expect(packets).toHaveLength(1);
    expect(asText(packets[0]?.out ?? [])).toBe('Benchtop..');
    expect(packets[0]?.out.slice(-2)).toEqual([0x0d, 0x0a]);
    expect(annotations.map((a) => a.text).join('')).toBe('Benchtop\\r\\n');
    expect(annotations.every((a) => a.kind === 'data')).toBe(true);
    // The wrong speed gives errors or rubbish, not the text.
    expect(asText(decodeUart(demo, { ...UART, baud: 9600 }).packets.flatMap((p) => [...p.out]))).not.toContain('Bench');
  });
});

describe('serial lines of other kinds', () => {
  it('checks parity, reads two stop bits, and reads a line that idles low', () => {
    const even = serial([0x41, 0x42, 0x43], { baud: 9600, parity: 'even' });
    expect(decodeUart(even, { ...UART, rx: 0, baud: 9600, parity: 'even' }).packets[0]).toMatchObject({ out: [0x41, 0x42, 0x43], note: undefined });
    // Read as odd parity, every byte is wrong.
    const wrong = decodeUart(even, { ...UART, rx: 0, baud: 9600, parity: 'odd' });
    expect(wrong.annotations.every((a) => a.kind === 'error' && a.text.includes('parity'))).toBe(true);
    expect(wrong.packets[0]?.note).toBe('3 with errors');
    const seven = serial([0x55, 0x7f], { baud: 19200, bits: 7, stop: 2 });
    expect(decodeUart(seven, { ...UART, rx: 0, baud: 19200, bits: 7, stop: 2 }).packets[0]?.out).toEqual([0x55, 0x7f]);
    const upsideDown = serial([0x31, 0x32], { baud: 9600, inverted: true });
    expect(decodeUart(upsideDown, { ...UART, rx: 0, baud: 9600, inverted: true }).packets[0]?.out).toEqual([0x31, 0x32]);
    expect(guessBaud(upsideDown, 0)).toBe(9600);
  });

  it('reports a missing stop bit, and ignores a glitch', () => {
    // The stop bit of the first byte is held low for a while.
    const broken = serial([0x00, 0x41], { baud: 9600 }, (b, start, bit) => {
      if (start === 500) {
        b.set(0, 0, start + 9 * bit);
        b.set(0, 1, start + 9.9 * bit);
      }
    });
    const read = decodeUart(broken, { ...UART, rx: 0, baud: 9600 });
    expect(read.annotations[0]).toMatchObject({ kind: 'error', value: 0 });
    expect(read.annotations[0]?.text).toContain('framing');
    expect(read.annotations[1]).toMatchObject({ kind: 'data', value: 0x41 });
    // A dip much shorter than a bit is not a start bit.
    const b = new CaptureBuilder(1e-6, ['RX'], [1]);
    b.set(0, 0, 1000);
    b.set(0, 1, 1010);
    expect(decodeUart(b.build(5000, 1e6), { ...UART, rx: 0, baud: 9600 }).annotations).toEqual([]);
    // A speed too high for the capture's resolution reads nothing rather than nonsense.
    expect(decodeUart(broken, { ...UART, rx: 0, baud: 2_000_000 }).annotations).toEqual([]);
  });
});

describe('I²C and SPI of other kinds', () => {
  it('says when no device answers its address', () => {
    const b = new CaptureBuilder(1e-6, ['SCL', 'SDA'], [1, 1]);
    let t = 100;
    b.set(1, 0, t);
    t += 5;
    b.set(0, 0, t);
    for (const level of [1, 0, 1, 0, 0, 0, 0, 0, 1]) {
      b.set(1, level, t + 1);
      t += 5;
      b.set(0, 1, t);
      t += 5;
      b.set(0, 0, t);
    }
    b.set(1, 0, t + 1);
    t += 5;
    b.set(0, 1, t);
    t += 5;
    b.set(1, 1, t);
    const { annotations, packets } = decodeI2c(b.build(t + 100, 1e6), { scl: 0, sda: 1 });
    expect(annotations.map((a) => a.text)).toEqual(['S', '0x50 W', 'N', 'P']);
    expect(packets[0]).toMatchObject({ title: 'Write to 0x50', out: [], note: 'no device answered' });
  });

  it('reads SPI on the other edge when the clock idles high', () => {
    // Mode 3: the clock idles high, data changes as it falls and is read as it rises.
    const b = new CaptureBuilder(1e-6, ['CLK', 'MOSI'], [1, 0]);
    let t = 50;
    for (const value of [0xa5, 0x3c]) {
      for (let i = 7; i >= 0; i--) {
        b.set(0, 0, t);
        b.set(1, (value >> i) & 1, t + 1);
        t += 2;
        b.set(0, 1, t);
        t += 2;
      }
      t += 200;
    }
    const capture = b.build(t + 50, 1e6);
    const setup: SpiSetup = { clk: 0, mosi: 1, miso: -1, cs: -1, mode: 3, bits: 8, msbFirst: true, csActiveLow: true };
    // The long pauses split the two bytes into two frames.
    expect(decodeSpi(capture, setup).packets.map((p) => [...p.out])).toEqual([[0xa5], [0x3c]]);
    // Read on the falling edge (mode 2) every bit is the one before: a different answer.
    expect(decodeSpi(capture, { ...setup, mode: 2 }).packets.map((p) => [...p.out])).not.toEqual([[0xa5], [0x3c]]);
    // A frame cut short says how many bits were left over.
    const cut = new CaptureBuilder(1e-6, ['CLK', 'MOSI', 'CS'], [0, 1, 1]);
    cut.set(2, 0, 10);
    for (let i = 0; i < 11; i++) {
      cut.set(0, 1, 20 + i * 4);
      cut.set(0, 0, 22 + i * 4);
    }
    cut.set(2, 1, 80);
    expect(decodeSpi(cut.build(100, 1e6), { ...setup, mode: 0, cs: 2 }).packets[0]).toMatchObject({ out: [0xff], note: '3 bits left over' });
  });
});

describe('files', () => {
  it('writes a VCD file that reads back the same', () => {
    const text = writeVcd(demo, '2026-11-24');
    expect(text).toContain('$timescale 1 ns $end');
    expect(text).toContain('$var wire 1 ! SCL $end');
    const back = readVcd(text);
    expect(back.names).toEqual([...demo.names]);
    // The file counts in nanoseconds: 250 to a tick of the 4 MHz capture.
    expect(back.tick).toBe(1e-9);
    expect(back.length).toBe(demo.length * 250);
    expect([...back.states]).toEqual([...demo.states]);
    expect([...back.times]).toEqual([...demo.times].map((t) => t * 250));
    expect(decodeI2c(back, { scl: 0, sda: 1 }).packets.map((p) => p.title)).toEqual(['Write to 0x3C', 'Read from 0x48']);
    expect(asText(decodeUart(back, UART).packets[0]?.out ?? [])).toBe('Benchtop..');
    // A capture whose tick is not a whole number of nanoseconds goes down to picoseconds.
    expect(writeVcd(fromSamples(Uint8Array.from([0, 1]), 16e6, ['A']))).toContain('$timescale 1 ps $end');
  });

  it('reads a VCD with a timescale, scopes, a bus and values it cannot show', () => {
    const capture = readVcd(`$date today $end
$timescale 10 us $end
$scope module top $end
$var wire 1 ! clk $end
$var reg 4 # count [3:0] $end
$var real 1 % volts $end
$var wire 1 & en $end
$upscope $end
$enddefinitions $end
$dumpvars
0!
b0000 #
x&
$end
#5
1!
b101 #
r3.3 %
#10
0!
1&
#15
1!
bz #
#40
`);
    expect(capture.tick).toBeCloseTo(1e-5, 12);
    expect(capture.names).toEqual(['clk', 'count[0]', 'count[1]', 'count[2]', 'count[3]', 'en']);
    expect(capture.length).toBe(40);
    expect([...capture.times]).toEqual([0, 5, 10, 15]);
    // clk is bit 0, the bus bits 1 to 4, en bit 5: 0b101 on the bus is bits 1 and 3.
    expect([...capture.states]).toEqual([0, 1 | (0b101 << 1), (0b101 << 1) | 32, 1 | 32]);
    expect(() => readVcd('hello')).toThrow(/not a VCD file/);
    expect(() => readVcd('$var real 1 % volts $end $enddefinitions $end')).toThrow(/no single lines/);
  });

  it('reads tables of changes with times, and tables of samples', () => {
    const timed = readCsv('Time [s],Channel 0,Channel 1\n0.000000000,1,0\n0.000010000,0,0\n0.000025000,0,1\n0.000100000,1,1\n');
    expect(timed.names).toEqual(['Channel 0', 'Channel 1']);
    expect(timed.tick).toBe(1e-9);
    expect([...timed.times]).toEqual([0, 10_000, 25_000, 100_000]);
    expect([...timed.states]).toEqual([1, 0, 2, 3]);
    // Milliseconds named in the heading, semicolons, and a first time that is not zero.
    const ms = readCsv('time_ms;a\n5;0\n7,5;1\n9;0\n'.replace('7,5', '7.5'));
    expect([...ms.times]).toEqual([0, 2_500_000, 4_000_000]);
    const sampled = readCsv('D0,D1\n0,0\n1,0\n1,1\n1,1\n0,1\n', 2000);
    expect(sampled.rate).toBe(2000);
    expect(sampled.length).toBe(5);
    expect([...sampled.states]).toEqual([0, 1, 3, 2]);
    // No headings at all.
    expect(readCsv('0,1\n1,1\n1,0\n', 1000).names).toEqual(['D0', 'D1']);
    expect(() => readCsv('only one row')).toThrow(/no rows/);
  });

  it('reads a sigrok session from its unpacked files', () => {
    const text = new TextEncoder();
    const files = {
      version: text.encode('2'),
      metadata: text.encode('[global]\nsigrok version=0.5.2\n\n[device 1]\ncapturefile=logic-1\ntotal probes=8\nsamplerate=2 MHz\nprobe1=SCK\nprobe2=DATA\nunitsize=1\n'),
      'logic-1-2': Uint8Array.from([3, 3, 0, 0]),
      'logic-1-1': Uint8Array.from([0, 0, 1, 1, 1, 2]),
    };
    const capture = readSigrok(files);
    expect(capture.rate).toBe(2_000_000);
    expect(capture.names.slice(0, 3)).toEqual(['SCK', 'DATA', 'D2']);
    expect(capture.length).toBe(10);
    // The pieces are joined in the order of their numbers.
    expect([...capture.times]).toEqual([0, 2, 5, 6, 8]);
    expect([...capture.states]).toEqual([0, 1, 2, 3, 0]);
    expect(() => readSigrok({ version: text.encode('2') })).toThrow(/no metadata/);
    expect(() => readSigrok({ metadata: text.encode('[device 1]\nsamplerate=1 MHz\n') })).toThrow(/no logic capture/);
  });

  it('lists decoded packets as a table that a spreadsheet opens safely', () => {
    const rows = [...decodeI2c(demo, { scl: 0, sda: 1 }).packets.map((packet) => ({ decoder: 'I²C', packet })), ...decodeSpi(demo, SPI).packets.map((packet) => ({ decoder: 'SPI', packet }))];
    const lines = packetsCsv(demo, rows).trim().split('\r\n');
    expect(lines[0]).toBe('Time (s),Decoder,What,Out (hex),In (hex),Text,Note');
    expect(lines[1]).toBe('0.000205,I²C,Write to 0x3C,00 AF,,..,no stop');
    expect(lines[3]).toContain('SPI,4 words,9F 00 00 00,FF EF 40 18');
    // Text that a spreadsheet would run as a formula is defused.
    const risky = packetsCsv(demo, [{ decoder: 'UART', packet: { from: 0, to: 1, title: '=1+1', out: [0x3d, 0x31] } }]);
    expect(risky).toContain("'=1+1");
    expect(risky).toContain("'=1");
  });
});
